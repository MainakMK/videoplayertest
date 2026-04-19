require('dotenv').config();

const Queue = require('bull');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const storage = require('./services/storage');
const { triggerWebhooks } = require('./services/webhooks');
const { generateAndStoreKey } = require('./services/aes-keys');

const videoQueue = new Queue('video-processing', process.env.REDIS_URL);

function getVideoInfo(filePath) {
  return new Promise((resolve, reject) => {
    // 30s timeout — corrupted files can hang ffprobe forever
    const timer = setTimeout(() => reject(new Error('ffprobe timed out after 30s')), 30000);
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      clearTimeout(timer);
      if (err) return reject(err);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) return reject(new Error('No video stream found in file'));
      // Collect ALL audio streams so we can produce a separate HLS rendition
      // per language. ffprobe reports language via tags.language (ISO 639-2,
      // e.g. "eng", "spa", "fra"). Missing language → "und" (undetermined).
      // The FIRST audio stream is the "primary" — muxed into video variants
      // as the default rendition (existing behavior). Streams 2+ become
      // separate audio-only renditions in the master playlist.
      const allAudioStreams = metadata.streams.filter(s => s.codec_type === 'audio');
      // SECURITY: the `language` and `title` fields come from media file metadata
      // which is attacker-controlled. Both flow into:
      //   - HLS segment filenames (via `-hls_segment_filename`)
      //   - Master playlist attributes (LANGUAGE="...", NAME="...")
      // Without sanitization, a malicious file with `tags.language = "../../etc/x"`
      // could trigger path traversal via FFmpeg's -hls_segment_filename, OR
      // a title with `"` / newlines could inject fake HLS tags into the playlist.
      //
      // Defense:
      //   language: restrict to [a-z]{2,3} (ISO 639-1/2 format). Anything else → 'und'.
      //   title:    strip control chars, quotes, and limit to 100 chars.
      const sanitizeLanguage = (raw) => {
        const s = String(raw || '').toLowerCase().trim();
        return /^[a-z]{2,3}$/.test(s) ? s : 'und';
      };
      const sanitizeTitle = (raw) => {
        return String(raw || '')
          .replace(/[\r\n\t"'\\]/g, '')       // strip CR/LF/tab/quotes/backslash
          // eslint-disable-next-line no-control-regex
          .replace(/[\x00-\x1F\x7F]/g, '')    // strip control chars
          .trim()
          .slice(0, 100);
      };
      const audioStreams = allAudioStreams.map((s, audioIdx) => ({
        audioIndex: audioIdx,                        // ffmpeg -map 0:a:N index
        streamIndex: s.index,                         // absolute stream index
        codec: s.codec_name || '',
        channels: s.channels || 2,
        language: sanitizeLanguage(s.tags?.language),
        title: sanitizeTitle(s.tags?.title),
      }));
      const audioStream = allAudioStreams[0];  // keep backward-compat variable
      // Source bitrate (in bps) — used by cloneToHLS to set master playlist BANDWIDTH correctly
      const sourceBitrate = parseInt(videoStream.bit_rate || metadata.format.bit_rate || '0', 10) || 0;
      // Parse fps from avg_frame_rate (e.g., "30/1", "30000/1001", "60/1").
      // Falls back to r_frame_rate, then to 30 if both are missing/invalid.
      // IMPORTANT: clamp to 1-240 — corrupted files can report absurd values
      // (999999 fps, Infinity, NaN) which would produce a `-g` so large that
      // HLS segments never get a keyframe → unplayable output. 240 fps is the
      // highest practical framerate (high-speed cameras); anything above that
      // from ffprobe is a data error.
      let fps = 30; // safe default
      const rawFps = videoStream.avg_frame_rate || videoStream.r_frame_rate || '';
      if (rawFps && rawFps.includes('/')) {
        const [num, den] = rawFps.split('/').map(Number);
        if (den > 0 && num > 0) fps = num / den;
      } else if (rawFps && !isNaN(Number(rawFps))) {
        fps = Number(rawFps);
      }
      // Clamp: NaN/Infinity/negative/absurdly high → fall back to 30
      if (!isFinite(fps) || fps < 1) fps = 30;
      if (fps > 240) fps = 240;
      resolve({
        duration: metadata.format.duration,
        width: videoStream.width,
        height: videoStream.height,
        videoCodec: videoStream.codec_name || '',  // e.g., 'h264', 'hevc', 'av1', 'avc1'
        audioCodec: audioStream?.codec_name || '', // e.g., 'aac', 'mp3'
        sourceBitrate,                              // bps; 0 if unknown
        fps,                                        // numeric fps (e.g., 29.97, 30, 60)
        audioChannels: audioStream?.channels || 2,  // e.g., 2 (stereo), 6 (5.1), 8 (7.1)
        audioStreams,                                // full list with language metadata
      });
    });
  });
}

function transcodeToHLS(filePath, outputDir, quality, ffmpegPreset = 'veryfast', keyInfoFile = null, keyframeInterval = 48, codecConfig = null, extraParams = [], rateControlOpts = null, trimOpts = null) {
  return new Promise((resolve, reject) => {
    const cc = codecConfig || CODEC_CONFIGS.h264;
    const segExt = cc.segmentExt || '.jpeg';
    const playlistName = `${quality.name}.m3u8`;
    const segmentPattern = path.join(outputDir, `${quality.name}_%03d${segExt}`);
    const playlistPath = path.join(outputDir, playlistName);

    const inputOpts = buildTrimInputOpts(trimOpts);
    const opts = [
      `-c:v ${cc.encoder}`,
    ];
    // Ensure -t / -to apply to the encoded output (paired with input-side -ss).
    if (trimOpts && trimOpts.durationSec != null) {
      opts.unshift(`-t ${trimOpts.durationSec}`);
    }
    if (cc.tag) opts.push(`-tag:v ${cc.tag}`);
    if (cc.extraFlags && cc.extraFlags.length) opts.push(...cc.extraFlags);
    // SVT-AV1 uses numeric presets (0-13), not x264 preset names.
    // If the codec has a presetMap, translate the x264 name; otherwise pass as-is.
    const resolvedPreset = cc.presetMap ? (cc.presetMap[ffmpegPreset] || '10') : ffmpegPreset;
    opts.push(
      `-preset ${resolvedPreset}`,
      '-threads 0',
      // Pixel format: YUV 4:2:0 is REQUIRED by Apple HLS spec §1.16 and is
      // the only format that plays reliably in browsers + mobile. Without
      // this, 10-bit sources or screen recordings can produce 4:2:2/4:4:4
      // output that browsers refuse to decode.
      '-pix_fmt yuv420p',
      // Closed GOP: Apple HLS spec §1.10 requires closed GOPs. Without
      // this flag, B-frames can reference frames from the previous GOP,
      // causing decoder glitches on seek and ABR quality switches.
      '-flags +cgop',
      `-b:v ${quality.videoBitrate}`,
    );
    // Constrained VBR: cap peak bitrate + set VBR buffer window.
    // Only active when rate_control = 'constrained_vbr'. In ABR mode
    // (default), these flags are omitted and FFmpeg uses pure average bitrate.
    if (rateControlOpts && rateControlOpts.mode === 'constrained_vbr') {
      const bitrateKbps = parseInt(quality.videoBitrate, 10) || 0;
      if (bitrateKbps > 0) {
        const maxrate = Math.round(bitrateKbps * rateControlOpts.maxrateRatio);
        const bufsize = Math.round(bitrateKbps * rateControlOpts.bufsizeRatio);
        opts.push(`-maxrate ${maxrate}k`, `-bufsize ${bufsize}k`);
      }
    }
    opts.push(
      '-c:a aac',
      `-b:a ${quality.audioBitrate}`,
      `-g ${keyframeInterval}`,
      `-keyint_min ${keyframeInterval}`,
      '-sc_threshold 0',
      '-f hls',
      '-hls_time 4',
      '-hls_list_size 0',
      // Playlist type VOD: RFC 8216 §4.3.3. Tells players this is a static
      // file list, not a live stream. Without it, some players keep polling
      // the playlist forever waiting for live updates — wastes bandwidth.
      '-hls_playlist_type vod',
      `-hls_segment_type ${cc.segmentType}`,
      `-hls_segment_filename ${segmentPattern}`
    );
    // Extra FFmpeg parameters (power-user escape hatch from Settings).
    // Appended AFTER all built-in options so they can override defaults
    // (e.g., -crf 23 would override the bitrate-based mode set above).
    if (extraParams.length > 0) {
      opts.push(...extraParams);
    }
    // AES-128 HLS encryption — FFmpeg writes #EXT-X-KEY into the playlist
    // and AES-encrypts each segment using the key from the key info file.
    if (keyInfoFile) {
      opts.push(`-hls_key_info_file ${keyInfoFile}`);
    }

    const cmd = ffmpeg(filePath);
    if (inputOpts.length) cmd.inputOptions(inputOpts);
    cmd
      .outputOptions(opts)
      .output(playlistPath)
      .on('end', () => resolve(playlistPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Build the -ss / input-side trim options for a trim config.
 * Returns an empty array when no trim requested.
 *
 * Why input-side -ss? It's fast (skips decoding of skipped section) and
 * frame-accurate in modern FFmpeg (4.4+). When combined with -t on the
 * output side, -t becomes relative to the seek point (output duration),
 * giving the admin exactly the slice they asked for.
 */
function buildTrimInputOpts(trimOpts) {
  if (!trimOpts || typeof trimOpts !== 'object') return [];
  const opts = [];
  if (trimOpts.trimInSec != null && trimOpts.trimInSec > 0) {
    opts.push(`-ss ${trimOpts.trimInSec}`);
  }
  return opts;
}

/**
 * Stream-copy the source into HLS without re-encoding the video track.
 * Saves a huge amount of CPU but only safe when:
 *   - Source video codec matches the target codec (H.264→H.264, HEVC→HEVC, AV1→AV1)
 *   - Source resolution matches the quality preset (no scaling possible with -c copy)
 *
 * Audio is still re-encoded to AAC because (a) source audio could be in formats
 * HLS doesn't support, (b) we want consistent audio bitrate across variants.
 *
 * Applies the correct bitstream filter per codec (h264_mp4toannexb for H.264,
 * hevc_mp4toannexb for HEVC, none for AV1/fMP4).
 *
 * If FFmpeg refuses to clone (e.g., source has unusual codec profile), the caller
 * should catch the rejection and fall back to `transcodeToHLS()`.
 */
function cloneToHLS(filePath, outputDir, quality, keyInfoFile = null, codecConfig = null) {
  return new Promise((resolve, reject) => {
    const cc = codecConfig || CODEC_CONFIGS.h264;
    const segExt = cc.segmentExt || '.jpeg';
    const playlistName = `${quality.name}.m3u8`;
    const segmentPattern = path.join(outputDir, `${quality.name}_%03d${segExt}`);
    const playlistPath = path.join(outputDir, playlistName);

    const opts = [
      '-c:v copy',                               // ← no re-encoding!
    ];
    // Bitstream filter: needed for MPEG-TS containers (H.264 → h264_mp4toannexb,
    // H.265 → hevc_mp4toannexb). Not needed for fMP4 (AV1).
    if (cc.bitstreamFilter) opts.push(`-bsf:v ${cc.bitstreamFilter}`);
    opts.push(
      '-c:a aac',
      `-b:a ${quality.audioBitrate}`,
      '-f hls',
      '-hls_time 4',
      '-hls_list_size 0',
      '-hls_playlist_type vod',
      `-hls_segment_type ${cc.segmentType}`,
      `-hls_segment_filename ${segmentPattern}`,
    );
    if (keyInfoFile) {
      opts.push(`-hls_key_info_file ${keyInfoFile}`);
    }

    ffmpeg(filePath)
      .outputOptions(opts)
      .output(playlistPath)
      .on('end', () => resolve(playlistPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Encode audio-only HLS rendition (e.g., AC3 5.1 surround).
 *
 * Produces a separate audio-only .m3u8 + .jpeg segments that the master
 * playlist references via #EXT-X-MEDIA:TYPE=AUDIO. The player picks this
 * track when the device supports surround sound.
 *
 * Video is dropped (-vn). Audio is re-encoded to the specified codec/channels.
 * Segment duration and encryption match the main video renditions so ABR
 * switching between audio tracks is seamless.
 *
 * @param {string} filePath     Source file
 * @param {string} outputDir    HLS output directory
 * @param {string} codec        FFmpeg audio codec (e.g., 'ac3')
 * @param {string} bitrate      Target bitrate (e.g., '384k')
 * @param {number} channels     Output channel count (e.g., 6 for 5.1)
 * @param {string|null} keyInfoFile  AES key info file (for encryption)
 * @returns {Promise<string>}   Path to the audio playlist
 */
function encodeAudioOnly(filePath, outputDir, codec, bitrate, channels, keyInfoFile = null, segmentExt = '.jpeg', opts2 = {}) {
  return new Promise((resolve, reject) => {
    const trimOpts = opts2.trimOpts || null;
    const inputOpts = buildTrimInputOpts(trimOpts);
    // opts2: { audioIndex, playlistTag, outputLabel }
    //   audioIndex   — which audio stream to extract (0-based). Default: all audio
    //                  (which FFmpeg reduces to first stream anyway)
    //   playlistTag  — distinguishes output filenames when producing multiple
    //                  renditions from one source. E.g. "ac3", "eng", "spa".
    //                  Produces audio_<tag>.m3u8 + audio_<tag>_NNN.ext files.
    //                  Defaults to codec name (current behavior for single-track)
    //
    // SECURITY: strip anything that isn't [a-z0-9_] from the tag. Defense against
    // path traversal via malicious language codes. Caller (getVideoInfo) already
    // sanitizes language, but we defend again here because the filename goes to
    // FFmpeg via -hls_segment_filename and any leak would be a write-anywhere bug.
    const rawTag = opts2.playlistTag || codec || 'audio';
    const tag = String(rawTag).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'audio';
    const playlistName = `audio_${tag}.m3u8`;
    const segmentPattern = path.join(outputDir, `audio_${tag}_%03d${segmentExt}`);
    const playlistPath = path.join(outputDir, playlistName);

    const opts = [
      '-vn',                                      // drop video
    ];
    // When extracting a specific audio stream by index (for multi-language
    // sources), use -map. Without it, FFmpeg picks the first audio stream
    // by default — which is what single-audio sources already want.
    if (typeof opts2.audioIndex === 'number' && opts2.audioIndex >= 0) {
      opts.push(`-map 0:a:${opts2.audioIndex}`);
    }
    opts.push(
      `-c:a ${codec}`,                            // e.g., ac3, aac
      `-b:a ${bitrate}`,                          // e.g., 384k
      `-ac ${channels}`,                          // e.g., 6 for 5.1, 2 for stereo
      '-f hls',
      '-hls_time 4',
      '-hls_list_size 0',
      '-hls_playlist_type vod',
      '-hls_segment_type mpegts',
      `-hls_segment_filename ${segmentPattern}`,
    );
    if (keyInfoFile) {
      opts.push(`-hls_key_info_file ${keyInfoFile}`);
    }
    // Paired with input-side -ss: -t limits output duration (same slice as video).
    if (trimOpts && trimOpts.durationSec != null) {
      opts.unshift(`-t ${trimOpts.durationSec}`);
    }

    const cmd = ffmpeg(filePath);
    if (inputOpts.length) cmd.inputOptions(inputOpts);
    cmd
      .outputOptions(opts)
      .output(playlistPath)
      .on('end', () => resolve(playlistPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Decide whether the TOP-QUALITY variant for this source can be stream-copied.
 *
 * Only checks the FIRST quality in `selectedQualities` (which the caller has
 * sorted highest → lowest and filtered by source resolution). This means we
 * only ever clone the highest variant the user wants for this video — never a
 * lower one — which matches the feature's intent.
 *
 * Returns the matched preset, or null if cloning isn't applicable.
 */
function findCloneablePreset(sourceWidth, sourceHeight, sourceCodec, selectedQualities, cloneEnabled, targetCodec = 'h264') {
  if (!cloneEnabled) return null;
  if (!Array.isArray(selectedQualities) || selectedQualities.length === 0) return null;

  // Source codec must match the target codec family.
  // E.g., if we're encoding to H.265, only clone if source is already HEVC.
  const codec = (sourceCodec || '').toLowerCase();
  const cc = CODEC_CONFIGS[targetCodec] || CODEC_CONFIGS.h264;
  if (!cc.cloneCodecs.has(codec)) return null;

  // Only consider the TOP (first) preset — never clone a lower variant
  const top = selectedQualities[0];
  if (!top) return null;

  // Parse preset's expected width from "1920x1080" string
  const [presetW, presetH] = (top.resolution || '').split('x').map(n => parseInt(n, 10));

  // Tolerance: source within 16 pixels on BOTH dimensions of preset.
  // Checking width too prevents portrait videos (1080x1920) from incorrectly
  // matching landscape presets (1920x1080) just because the height happens to align.
  const heightOk = Math.abs(sourceHeight - top.height) <= 16;
  const widthOk = !presetW || Math.abs(sourceWidth - presetW) <= 16;

  if (heightOk && widthOk) {
    return top;
  }
  return null;
}

function generateThumbnail(filePath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    const safeDur = Number(duration);
    const timestamp = Number.isFinite(safeDur) && safeDur > 0
      ? Math.max(1, safeDur * 0.25)
      : 1;

    ffmpeg(filePath)
      .screenshots({
        timestamps: [timestamp],
        filename: 'thumbnail.jpg',
        folder: path.dirname(outputPath),
        size: '1280x720'
      })
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));
  });
}

/**
 * Generate up to 3 candidate thumbnails at 15%, 50%, 85% of duration — the
 * viewer can pick one as the poster (or upload a custom image). Each file
 * is 1280×720 JPEG next to thumbnail.jpg in outputDir.
 *
 * Failure semantics: non-fatal. Individual candidate failures are caught
 * and logged; the function always resolves with whatever candidates did
 * succeed. A zero/invalid duration short-circuits to an empty array.
 */
function generateCandidateThumbnails(filePath, outputDir, duration) {
  // Defensive: ffmpeg timestamps must be finite & positive. Duration can be
  // null/undefined/NaN for malformed sources — bail out gracefully.
  const safeDuration = Number(duration);
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) return Promise.resolve([]);

  const offsets = [0.15, 0.5, 0.85];
  const runOne = (pct, idx) => new Promise((resolve) => {
    const ts = Math.max(1, safeDuration * pct);
    const filename = `candidate-${idx + 1}.jpg`;
    const cmd = ffmpeg(filePath)
      .screenshots({
        timestamps: [ts],
        filename,
        folder: outputDir,
        size: '1280x720'
      })
      .on('end', () => resolve({ index: idx + 1, timestamp: ts, filename }))
      .on('error', (err) => {
        console.warn(`[worker] candidate-${idx + 1} failed: ${err.message}`);
        try { cmd.kill && cmd.kill('SIGKILL'); } catch (_) { /* ignore */ }
        resolve(null); // non-fatal — return null so Promise.all doesn't reject
      });
  });

  return Promise.all(offsets.map(runOne))
    .then(results => results.filter(Boolean).sort((a, b) => a.index - b.index));
}

/**
 * Generate a sprite sheet of thumbnail frames for seekbar preview.
 * Captures one frame every `interval` seconds at 160×90px.
 * Output: sprite.jpg (grid) + sprite.vtt (WebVTT timestamps)
 */
function generateSprite(filePath, outputDir, duration) {
  return new Promise((resolve, reject) => {
    const safeDur = Number(duration);
    if (!Number.isFinite(safeDur) || safeDur <= 0) { resolve(null); return; }

    const THUMB_W  = 160;
    const THUMB_H  = 90;
    const COLS     = 10;
    const interval = Math.max(5, Math.floor(safeDur / 100)); // ~100 frames max
    const count    = Math.floor(safeDur / interval);

    if (count < 2) { resolve(null); return; } // too short for a sprite

    const spritePath = path.join(outputDir, 'sprite.jpg');
    const vttPath    = path.join(outputDir, 'sprite.vtt');

    ffmpeg(filePath)
      .outputOptions([
        `-vf`, `fps=1/${interval},scale=${THUMB_W}:${THUMB_H},tile=${COLS}x${Math.ceil(count / COLS)}`,
        `-frames:v`, `1`,
        `-q:v`, `5`,
      ])
      .output(spritePath)
      .on('end', () => {
        // Build WebVTT file pointing into the sprite grid
        let vtt = 'WEBVTT\n\n';
        for (let i = 0; i < count; i++) {
          const start = i * interval;
          const end   = start + interval;
          const col   = (i % COLS) * THUMB_W;
          const row   = Math.floor(i / COLS) * THUMB_H;
          const fmt   = s => {
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.000`;
          };
          vtt += `${fmt(start)} --> ${fmt(end)}\nsprite.jpg#xywh=${col},${row},${THUMB_W},${THUMB_H}\n\n`;
        }
        fs.writeFileSync(vttPath, vtt);
        resolve({ spritePath, vttPath });
      })
      .on('error', (err) => {
        // Sprite failure is non-fatal
        console.warn('Sprite generation failed (non-fatal):', err.message);
        resolve(null);
      })
      .run();
  });
}

/**
 * Generate the HLS master playlist.
 *
 * Supports multi-codec audio via #EXT-X-MEDIA:TYPE=AUDIO when
 * `options.hasSurroundTrack` is true (the worker actually produced the
 * AC3 rendition). The stereo AAC track is muxed into each video variant
 * (no separate URI — this is the default rendition), while the surround
 * track points to a separate audio-only playlist.
 *
 * @param {string} outputDir
 * @param {Array}  qualities
 * @param {object} [options]
 * @param {boolean} [options.hasSurroundTrack]  Whether audio_ac3.m3u8 exists
 * @param {string}  [options.codecString]       HLS CODECS value (e.g., 'avc1.640028')
 * @param {number}  [options.fps]               Source frame rate for FRAME-RATE attr
 * @param {Array}   [options.altAudioTracks]    Alternate language audio tracks
 *                                               [{ tag, language, title, channels }]
 * @param {string}  [options.primaryLanguage]   Language code of muxed audio (e.g. "eng")
 */
function generateMasterPlaylist(outputDir, qualities, options = {}) {
  const lines = [
    '#EXTM3U',
    // Version 6 required for FRAME-RATE and modern HLS features (Apple spec §1).
    '#EXT-X-VERSION:6',
    // Apple HLS spec §1.11: REQUIRED when using closed GOPs. Tells players
    // every segment can be decoded independently (no cross-segment references).
    // Without this tag, Safari may be less efficient at seeking + ABR switching.
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];

  // Map ISO 639-2 (3-letter) codes to human-readable names for the player menu.
  // Falls back to the code itself for uncommon languages.
  const LANG_NAMES = {
    eng: 'English',  spa: 'Spanish',   fra: 'French',    fre: 'French',
    deu: 'German',   ger: 'German',    ita: 'Italian',   jpn: 'Japanese',
    kor: 'Korean',   zho: 'Chinese',   chi: 'Chinese',   rus: 'Russian',
    por: 'Portuguese', ara: 'Arabic',  hin: 'Hindi',     ben: 'Bengali',
    tur: 'Turkish',  pol: 'Polish',    nld: 'Dutch',     dut: 'Dutch',
    swe: 'Swedish',  nor: 'Norwegian', dan: 'Danish',    fin: 'Finnish',
    vie: 'Vietnamese', tha: 'Thai',    ind: 'Indonesian', heb: 'Hebrew',
    und: 'Audio',
  };
  function langDisplayName(code, fallback) {
    const c = (code || '').toLowerCase();
    return LANG_NAMES[c] || fallback || (c ? c.toUpperCase() : 'Audio');
  }

  // Audio renditions — emitted when surround OR multi-language audio exists.
  // When there's only stereo, single-language (default), we omit #EXT-X-MEDIA
  // entirely so the master playlist stays backward-compatible.
  const altAudioTracks = Array.isArray(options.altAudioTracks) ? options.altAudioTracks : [];
  const primaryLang = (options.primaryLanguage || 'und').toLowerCase();
  const hasAudioGroup = !!options.hasSurroundTrack || altAudioTracks.length > 0;

  if (hasAudioGroup) {
    // Default rendition — the audio muxed into the video variants. This is
    // the FIRST audio stream from the source (with its language code).
    const primaryName = langDisplayName(primaryLang, 'Default');
    const primaryLangAttr = primaryLang && primaryLang !== 'und' ? `,LANGUAGE="${primaryLang}"` : '';
    lines.push(
      `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${primaryName}"${primaryLangAttr},DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"`
    );

    // 5.1 AC3 surround rendition (same content as primary, just 6 channels)
    if (options.hasSurroundTrack) {
      lines.push(
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="5.1 Surround"${primaryLangAttr},DEFAULT=NO,AUTOSELECT=NO,CHANNELS="6",URI="audio_ac3.m3u8"`
      );
    }

    // Alternate languages (source tracks 2..N). Each points to its own audio playlist.
    for (const t of altAudioTracks) {
      const name = t.title || langDisplayName(t.language);
      const langAttr = t.language && t.language !== 'und' ? `,LANGUAGE="${t.language}"` : '';
      const ch = String(t.channels || 2);
      // Escape quotes in NAME to prevent malformed manifests (defensive — titles
      // come from ffprobe tags.title which could theoretically contain quotes).
      const safeName = name.replace(/"/g, '');
      lines.push(
        `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${safeName}"${langAttr},DEFAULT=NO,AUTOSELECT=YES,CHANNELS="${ch}",URI="audio_${t.tag}.m3u8"`
      );
    }
  }

  // Build CODECS string: video codec + audio codec (always AAC for muxed audio)
  const codecStr = options.codecString || 'avc1.640028';
  const fullCodecs = `${codecStr},mp4a.40.2`;

  // FRAME-RATE attribute (Apple HLS spec §2: EXT-X-STREAM-INF MUST provide
  // FRAME-RATE for video content). Formatted to 3 decimals to match spec
  // examples (e.g., 29.970, 23.976, 60.000).
  const frameRate = (typeof options.fps === 'number' && isFinite(options.fps) && options.fps > 0)
    ? options.fps.toFixed(3)
    : null;

  for (const q of qualities) {
    let inf = `#EXT-X-STREAM-INF:BANDWIDTH=${q.bandwidth},RESOLUTION=${q.resolution},CODECS="${fullCodecs}"`;
    if (frameRate) {
      inf += `,FRAME-RATE=${frameRate}`;
    }
    if (hasAudioGroup) {
      inf += ',AUDIO="audio"';
    }
    lines.push(inf, `${q.name}.m3u8`);
  }

  const masterPath = path.join(outputDir, 'master.m3u8');
  fs.writeFileSync(masterPath, lines.join('\n') + '\n');
  return masterPath;
}

// NOTE: The legacy hardcoded `qualityPresets` array used to live here. It's
// gone now — the worker reads `cfg.qualityPresets` from
// `services/encoding-config.loadEncodingConfig()` on every job, which respects
// per-tier bitrates, custom values, and the new 240p/1440p/2160p variants.

// Read concurrency from encoding settings on startup. The worker process
// has to be restarted for this to take effect (Bull doesn't support changing
// concurrency mid-flight). All other settings (bitrates, preset) are read
// per-job and update without a restart.
const { loadEncodingConfig, resolveQualitiesForVideo, CODEC_CONFIGS, parseExtraFfmpegParams } = require('./services/encoding-config');

// Record this worker's boot time so the restart endpoint can know if a
// pending restart request was already honored.
const _workerStartedAt = new Date().toISOString();
db.query(
  `INSERT INTO settings (key, value) VALUES ('worker_started_at', $1)
   ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
  [_workerStartedAt]
).catch(err => console.warn('[worker] Failed to record worker_started_at:', err.message));

// Poll for restart requests every 10s. When the dashboard's "Restart Worker"
// button is clicked, the API writes a timestamp to settings.worker_restart_requested_at.
// This loop notices and gracefully exits — process manager (PM2/systemd) respawns us.
let _drainingForRestart = false;
async function _checkRestartRequest() {
  try {
    const r = await db.query("SELECT value FROM settings WHERE key = 'worker_restart_requested_at'");
    const requestedAt = r.rows[0]?.value;
    if (!requestedAt) return;

    // Only restart if the request is newer than our boot time
    if (new Date(requestedAt) <= new Date(_workerStartedAt)) return;
    if (_drainingForRestart) return;

    _drainingForRestart = true;
    console.log(`[worker] Restart requested at ${requestedAt}. Draining queue and exiting...`);

    // Wait for active jobs to finish, then close
    try {
      await videoQueue.close();
      console.log('[worker] Queue closed cleanly. Exiting now — process manager should respawn us.');
    } catch (e) {
      console.error('[worker] Error closing queue:', e.message);
    }
    process.exit(0);
  } catch (e) {
    console.warn('[worker] Restart-check tick failed:', e.message);
  }
}
setInterval(_checkRestartRequest, 10_000).unref();

let _initialVideoConcurrency = 1;
loadEncodingConfig()
  .then(cfg => {
    _initialVideoConcurrency = Math.max(1, cfg.video_concurrency || 1);
    console.log(`[worker] Starting with video_concurrency=${_initialVideoConcurrency}`);
  })
  .catch(err => {
    console.warn('[worker] Could not load encoding config; using default concurrency=1:', err.message);
  })
  .finally(() => {
    // Wrap videoQueue.process registration in a try/catch so failures here don't
    // leave a "running but idle" worker. Without this, if the registration throws
    // (Bull internal error, Redis disconnect, etc.) the process stays alive forever
    // doing nothing, hiding the failure from PM2/systemd.
    try {
      videoQueue.process(_initialVideoConcurrency, async (job) => {
      const { videoId, filePath, originalFilename, storageType = 'local', trimIn, trimOut } = job.data;

      // Build trim opts once. Validated on upload, so we trust the values here
      // but still fall back to null when unset (normal full-video encodes).
      let trimOpts = null;
      if (typeof trimIn === 'number' || typeof trimOut === 'number') {
        const inSec = typeof trimIn === 'number' && trimIn > 0 ? trimIn : 0;
        const outSec = typeof trimOut === 'number' && trimOut > inSec ? trimOut : null;
        if (inSec > 0 || outSec != null) {
          trimOpts = {
            trimInSec: inSec > 0 ? inSec : null,
            durationSec: outSec != null ? (outSec - inSec) : null,
          };
        }
      }

      try {
        // Update status to processing AND touch updated_at so cleanup-cron's
        // "stuck-in-processing" detection doesn't kill an actively-encoding video
        await db.query(
          'UPDATE videos SET status = $1, updated_at = NOW() WHERE id = $2',
          ['processing', videoId]
        );

        // Create temp output directory
        const outputDir = path.join(__dirname, 'uploads', 'processing', videoId);
        fs.mkdirSync(outputDir, { recursive: true });

        // Get source video info (single ffprobe call) — now includes codec + bitrate + fps + channels
        const { duration: rawDuration, width: sourceWidth, height: sourceHeight, videoCodec, audioCodec, sourceBitrate, fps: sourceFps, audioChannels: sourceAudioChannels, audioStreams: sourceAudioStreams } = await getVideoInfo(filePath);
        // rawDuration can be undefined/NaN for malformed sources. Clamp to a
        // finite non-negative integer so downstream consumers (ffmpeg timestamps,
        // DB FLOAT column, JSON serialization) never see NaN.
        const durationNum = Number(rawDuration);
        let duration = Number.isFinite(durationNum) && durationNum > 0
          ? Math.max(1, Math.floor(durationNum))
          : 0;
        // If the upload is trimmed, clamp the reported duration to the trimmed slice.
        // This keeps the UI's duration label and the player's timeline honest.
        if (trimOpts && trimOpts.durationSec != null && trimOpts.durationSec > 0) {
          duration = Math.max(1, Math.floor(trimOpts.durationSec));
        } else if (trimOpts && trimOpts.trimInSec != null && trimOpts.trimInSec > 0 && duration > 0) {
          // Only an in-point, no out-point: effective duration is (source - in)
          duration = Math.max(1, Math.floor(duration - trimOpts.trimInSec));
        }

        // Read encoding config fresh for this job (allows per-video setting changes
        // without restarting the worker)
        const cfg = await loadEncodingConfig();

        // Read the per-video quality override (if user picked specific qualities at
        // upload time) and the encryption_enabled flag. Combined into ONE query
        // so we don't hit the DB twice for the same row.
        // encoded_qualities is JSONB → may be null/array.
        let perVideoQualities = null;
        let encryptionEnabled = false;
        try {
          const r = await db.query(
            'SELECT encoded_qualities, encryption_enabled FROM videos WHERE id = $1',
            [videoId]
          );
          perVideoQualities = r.rows[0]?.encoded_qualities || null;
          encryptionEnabled = !!r.rows[0]?.encryption_enabled;
        } catch (e) { /* ignore — fall back to defaults */ }

        const selectedQualities = resolveQualitiesForVideo(
          cfg.qualityPresets,
          perVideoQualities,
          cfg.default_qualities,
          sourceHeight
        );

        // Hard-fail if no qualities matched (e.g., user picked only 4K but source is 720p).
        // Without this, generateMasterPlaylist would write an empty file and the
        // video would be marked 'ready' but unplayable.
        if (selectedQualities.length === 0) {
          throw new Error(
            `No quality variants match source resolution ${sourceWidth}x${sourceHeight}. ` +
            `Picked: ${JSON.stringify(perVideoQualities || cfg.default_qualities)}. ` +
            `All requested qualities are above source resolution — no upscaling allowed.`
          );
        }

        if (perVideoQualities && Array.isArray(perVideoQualities) && perVideoQualities.length > 0) {
          console.log(`[worker] ${videoId}: using per-video quality override → ${selectedQualities.map(q => q.name).join(', ')}`);
        } else {
          console.log(`[worker] ${videoId}: using default qualities → ${selectedQualities.map(q => q.name).join(', ')}`);
        }

        // Defensive: never let concurrency hit 0 (would make the for-loop infinite)
        const TRANSCODE_CONCURRENCY = Math.max(1, parseInt(cfg.quality_concurrency, 10) || 2);
        const ffmpegPreset = cfg.ffmpeg_preset;

        // Video codec config — maps the user's setting to FFmpeg flags.
        const videoCodecName = cfg.video_codec || 'h264';
        const codecConfig = { ...(CODEC_CONFIGS[videoCodecName] || CODEC_CONFIGS.h264) };
        if (videoCodecName !== 'h264') {
          console.log(`[worker] ${videoId}: encoding with ${videoCodecName.toUpperCase()} (${codecConfig.encoder}) — ${codecConfig.speedLabel}`);
        }

        // HLS segment extension: admin picks from ['.jpeg', '.webp', '.png', ...].
        // AV1 is exempt — fMP4 requires '.m4s', browsers reject alternatives.
        // The chosen extension is stored on the video row so CDN serving and
        // playlist references use the same extension forever (immutable).
        let chosenSegmentExt;
        if (codecConfig.segmentType === 'fmp4') {
          chosenSegmentExt = '.m4s';  // AV1 — no choice
        } else {
          chosenSegmentExt = cfg.segment_extension || '.jpeg';
        }
        codecConfig.segmentExt = chosenSegmentExt;
        try {
          await db.query(
            'UPDATE videos SET segment_extension = $1 WHERE id = $2',
            [chosenSegmentExt, videoId]
          );
        } catch (e) { /* non-fatal — fallback still works */ }
        console.log(`[worker] ${videoId}: using segment extension ${chosenSegmentExt}`);

        // Keyframe interval (GOP size) — auto-derived from probed fps × the
        // configured keyframe_seconds so high-fps content doesn't produce
        // wastefully frequent keyframes. See docs/encoding-keyframe-interval.md.
        const keyframeSeconds = cfg.keyframe_seconds || 2;
        const keyframeInterval = Math.max(1, Math.round(sourceFps * keyframeSeconds));
        console.log(`[worker] ${videoId}: keyframe interval = ${keyframeInterval} frames (${sourceFps.toFixed(2)} fps × ${keyframeSeconds}s)`);

        // Rate control config (ABR vs constrained VBR)
        const rateControlOpts = {
          mode: cfg.rate_control || 'abr',
          maxrateRatio: cfg.maxrate_ratio || 1.5,
          bufsizeRatio: cfg.bufsize_ratio || 2.0,
        };
        if (rateControlOpts.mode === 'constrained_vbr') {
          console.log(`[worker] ${videoId}: constrained VBR — maxrate=${rateControlOpts.maxrateRatio}x, bufsize=${rateControlOpts.bufsizeRatio}x`);
        }

        // Extra FFmpeg params — power-user escape hatch. Parsed from the raw
        // settings string into an array of "-flag value" items.
        const extraFfmpegParams = parseExtraFfmpegParams(cfg.extra_ffmpeg_params);
        if (extraFfmpegParams.length > 0) {
          console.log(`[worker] ${videoId}: extra FFmpeg params: ${extraFfmpegParams.join(', ')}`);
        }

        // Determine if the top-quality variant can be stream-copied (massive CPU savings).
        // findCloneablePreset only returns the FIRST (highest) variant — never lower ones.
        const cloneablePreset = findCloneablePreset(
          sourceWidth, sourceHeight, videoCodec,
          selectedQualities, cfg.clone_top_quality, videoCodecName
        );

        if (cloneablePreset) {
          const cloneSavingsPct = Math.round(100 / selectedQualities.length);
          console.log(`[worker] ${videoId}: cloning ${cloneablePreset.name} (source ${sourceWidth}x${sourceHeight} ${videoCodec}, ${sourceBitrate} bps) — saves ~${cloneSavingsPct}% encoding time (skips ${cloneablePreset.name} re-encode)`);
          // Override the cloned variant's master playlist BANDWIDTH with the actual
          // source bitrate (+ audio + 10% safety margin per HLS spec). Without this,
          // ABR players would underestimate the variant's bandwidth requirement and
          // could repeatedly switch to it on slow connections expecting the configured
          // (lower) target bitrate.
          if (sourceBitrate > 0) {
            const audioBps = parseInt(cloneablePreset.audioBitrate, 10) * 1000;
            cloneablePreset.bandwidth = Math.ceil((sourceBitrate + audioBps) * 1.1);
          }
        }

        // ─────────────────────────────────────────────────────────────
        // AES-128 HLS encryption setup (only when enabled for this video)
        //
        // We create TWO files in outputDir that FFmpeg needs:
        //   - enc.key      → raw 16 bytes of the AES key (FFmpeg reads this
        //                    and writes each segment encrypted with it)
        //   - enc.keyinfo  → 3 newline-separated lines FFmpeg uses to populate
        //                    #EXT-X-KEY in the manifest:
        //                      line 1: URI the player should request
        //                      line 2: local path to the key bytes file
        //                      line 3: IV as hex
        //
        // Both files are TEMPORARY — the DB row in video_encryption_keys is
        // the only persistent copy. We:
        //   (a) skip them in the storage upload loop (never let the key leave
        //       this server's local filesystem), and
        //   (b) fs.rmSync(outputDir, ...) deletes them at the end of the job.
        // ─────────────────────────────────────────────────────────────
        let keyInfoFile = null;
        if (encryptionEnabled) {
          try {
            const { keyBytes, ivHex } = await generateAndStoreKey(videoId);
            const keyBinPath  = path.join(outputDir, 'enc.key');
            const keyInfoPath = path.join(outputDir, 'enc.keyinfo');
            fs.writeFileSync(keyBinPath, keyBytes);
            // The URI that goes into #EXT-X-KEY. We use a relative path so the
            // manifest is portable across embed domains — the player resolves
            // it against the page origin, and the API is mounted on every
            // embed/dashboard host.
            const keyUri = `/api/video-keys/${videoId}`;
            // FFmpeg requires forward-slashes even on Windows for the local
            // key path (it's passed to fopen()) — normalize.
            const keyBinPathForInfo = keyBinPath.replace(/\\/g, '/');
            fs.writeFileSync(keyInfoPath, `${keyUri}\n${keyBinPathForInfo}\n${ivHex}\n`);
            keyInfoFile = keyInfoPath;
            console.log(`[worker] ${videoId}: AES-128 encryption enabled (key stored in DB, temp key file at ${keyBinPath})`);
          } catch (keyErr) {
            // If key generation fails we MUST stop — otherwise we'd produce
            // a non-encrypted stream while the DB claims it's encrypted.
            throw new Error(`Failed to generate AES key for ${videoId}: ${keyErr.message}`);
          }
        }

        let completed = 0;
        const runBatch = async (batch) => {
          await Promise.all(batch.map(async (quality) => {
            // Use the clone path ONLY for the matched top-quality variant.
            // Skip the clone fast-path when trimming: -ss + -c copy can land on a
            // non-keyframe and produce a silent gap at the start. Re-encode is
            // both accurate and necessary for a trimmed output.
            const useClone = !trimOpts && cloneablePreset && quality.name === cloneablePreset.name;
            if (useClone) {
              try {
                await cloneToHLS(filePath, outputDir, quality, keyInfoFile, codecConfig);
              } catch (cloneErr) {
                // Clone can fail on unusual codec profiles (e.g., 4:2:2, 10-bit, B-frames
                // with bad timestamps). Fall back to a normal re-encode so the upload doesn't fail.
                console.warn(`[worker] ${videoId}: clone of ${quality.name} failed (${cloneErr.message}); falling back to re-encode`);
                await transcodeToHLS(filePath, outputDir, quality, ffmpegPreset, keyInfoFile, keyframeInterval, codecConfig, extraFfmpegParams, rateControlOpts, trimOpts);
              }
            } else {
              await transcodeToHLS(filePath, outputDir, quality, ffmpegPreset, keyInfoFile, keyframeInterval, codecConfig, extraFfmpegParams, rateControlOpts, trimOpts);
            }
            completed++;
            job.progress(Math.round((completed / selectedQualities.length) * 80));
          }));
        };
        for (let i = 0; i < selectedQualities.length; i += TRANSCODE_CONCURRENCY) {
          await runBatch(selectedQualities.slice(i, i + TRANSCODE_CONCURRENCY));
        }

    // ─────────────────────────────────────────────────────────────
    // Multi-codec audio: produce AC3 5.1 surround rendition when
    // audio_mode is 'surround' AND the source has ≥ 6 channels.
    // Stereo sources skip this — upmixing stereo to 5.1 is fake
    // surround and adds file size for zero benefit.
    //
    // NOTE: 5.1 AC3 is always extracted from the FIRST audio stream
    // (the primary audio). If the source has multi-language tracks,
    // additional languages are handled by the multi-language block below.
    // ─────────────────────────────────────────────────────────────
    let hasSurroundTrack = false;
    if (cfg.audio_mode === 'surround') {
      if (sourceAudioChannels >= 6) {
        try {
          console.log(`[worker] ${videoId}: encoding 5.1 AC3 surround audio (${sourceAudioChannels}ch source, ${cfg.ac3_bitrate}k)`);
          await encodeAudioOnly(filePath, outputDir, 'ac3', `${cfg.ac3_bitrate}k`, 6, keyInfoFile, chosenSegmentExt, { trimOpts });
          hasSurroundTrack = true;
          console.log(`[worker] ${videoId}: AC3 5.1 rendition complete`);
        } catch (audioErr) {
          // Non-fatal: surround failure shouldn't kill the whole encode.
          // The stereo AAC muxed into video segments is still available.
          console.warn(`[worker] ${videoId}: AC3 5.1 encoding failed (non-fatal): ${audioErr.message}`);
        }
      } else {
        console.log(`[worker] ${videoId}: surround mode enabled but source is ${sourceAudioChannels}ch — skipping AC3 5.1`);
      }
    }

    // ─────────────────────────────────────────────────────────────
    // Multi-language audio (auto-detect from source)
    //
    // If the source has multiple audio tracks (e.g. a movie with English,
    // Spanish, French dubs), we produce a separate stereo AAC rendition
    // per track 2..N. The FIRST track is already muxed into the video
    // variants as the default audio; these extras become alternate
    // renditions in the master playlist via #EXT-X-MEDIA tags with
    // LANGUAGE="<iso639-2>".
    //
    // Naming: audio_<lang>.m3u8. Language code comes from ffprobe's
    // tags.language field. Collisions (two tracks with same language)
    // get numeric suffixes: audio_eng.m3u8, audio_eng_2.m3u8.
    // ─────────────────────────────────────────────────────────────
    const altAudioTracks = [];   // populated below — used by generateMasterPlaylist
    if (Array.isArray(sourceAudioStreams) && sourceAudioStreams.length > 1) {
      console.log(`[worker] ${videoId}: source has ${sourceAudioStreams.length} audio tracks — encoding alternates for tracks 2..${sourceAudioStreams.length}`);
      // Reserve 'ac3' (used by surround rendition) AND the primary language.
      // Reserving the primary language means alternates with the same language
      // get clean suffixed tags (eng_2, eng_3) instead of conflicting with what
      // viewers think of as the "main" track.
      const usedTags = new Set(['ac3']);
      const primaryLang = sourceAudioStreams[0]?.language || 'und';
      if (primaryLang) usedTags.add(primaryLang);
      for (let i = 1; i < sourceAudioStreams.length; i++) {
        const track = sourceAudioStreams[i];
        // Build a unique playlist tag based on language. If two tracks share
        // a language (e.g. two English commentaries), suffix with _2, _3, ...
        let tag = track.language || 'und';
        if (usedTags.has(tag)) {
          let n = 2;
          while (usedTags.has(`${tag}_${n}`)) n++;
          tag = `${tag}_${n}`;
        }
        usedTags.add(tag);
        // Downmix to stereo (2ch) for alternate renditions — consistent
        // bandwidth across languages, player-safe on all devices.
        const bitrate = `${cfg.audio_bitrate || 128}k`;
        try {
          console.log(`[worker] ${videoId}: encoding alt audio track #${i + 1} (lang=${track.language}, ch=${track.channels}) as audio_${tag}.m3u8`);
          await encodeAudioOnly(filePath, outputDir, 'aac', bitrate, 2, keyInfoFile, chosenSegmentExt, {
            audioIndex: track.audioIndex,
            playlistTag: tag,
            trimOpts,
          });
          altAudioTracks.push({
            tag,
            language: track.language,
            title: track.title,
            channels: 2,
          });
        } catch (altErr) {
          // Non-fatal — skip this track, continue with the rest.
          // (Most common cause: unsupported source codec for that stream.)
          console.warn(`[worker] ${videoId}: alt audio track ${tag} failed (non-fatal): ${altErr.message}`);
        }
      }
    }

    // Generate master playlist (with audio renditions if surround was produced,
    // CODECS attribute for the configured video codec, and FRAME-RATE
    // attribute from the probed source fps — required by Apple HLS spec).
    generateMasterPlaylist(outputDir, selectedQualities, {
      hasSurroundTrack,
      codecString: codecConfig.codecString,
      fps: sourceFps,
      // Multi-language audio support (auto-detected from source).
      // primaryLanguage = language of the audio muxed into video variants
      // altAudioTracks = additional languages as separate HLS renditions
      altAudioTracks,
      primaryLanguage: sourceAudioStreams?.[0]?.language || 'und',
    });

    // Check if the video already has a custom thumbnail locked by the user.
    // When custom_thumbnail_set is true, we keep the existing thumbnail.jpg
    // and only regenerate the candidates + sprite. Protects user uploads
    // from being overwritten on re-encode.
    const { rows: currentRows } = await db.query(
      'SELECT custom_thumbnail_set FROM videos WHERE id = $1',
      [videoId]
    );
    // If the row vanished mid-job the video was deleted — abort the encode
    // so we don't orphan storage objects or emit a fake ready-event.
    if (currentRows.length === 0) {
      throw new Error(`Video ${videoId} was deleted during encoding`);
    }
    const keepCustomThumbnail = !!currentRows[0].custom_thumbnail_set;

    // Primary thumbnail (only if not user-locked)
    if (!keepCustomThumbnail) {
      const thumbnailPath = path.join(outputDir, 'thumbnail.jpg');
      await generateThumbnail(filePath, thumbnailPath, duration);
    }

    // 3 candidate thumbnails (always regenerated — cheap, gives the user
    // picker options even if they had a custom uploaded before).
    await generateCandidateThumbnails(filePath, outputDir, duration);

    // Generate sprite sheet for seekbar preview (non-fatal)
    await generateSprite(filePath, outputDir, duration);

    job.progress(90);

    // Upload all files to storage in parallel.
    // IMPORTANT: filter out the AES key artifacts (enc.key + enc.keyinfo).
    // These must NEVER be uploaded — the whole point of DB-stored keys is that
    // a leaked CDN/storage backup doesn't expose them. The DB row is the only
    // persistent copy.
    const ENC_KEY_FILES = new Set(['enc.key', 'enc.keyinfo']);
    const allFiles = fs.readdirSync(outputDir);
    const files = allFiles.filter(f => !ENC_KEY_FILES.has(f));
    let thumbnailUrl = '';
    let spriteUrl = '';
    let spriteVttUrl = '';
    const candidateUrls = {};

    // Any file in the /hls/ dir that matches the chosen segment extension is
    // an HLS video segment — upload as video/MP2T. Thumbnails (.jpg), sprite
    // sheets (.jpg), and playlists (.m3u8) have their own specific types.
    // This lets admins rotate extensions (.jpeg → .webp → .png) without
    // breaking R2 uploads' content-type.
    const SEGMENT_EXTS_FOR_UPLOAD = new Set([
      '.jpeg', '.png', '.webp', '.gif', '.avif',
      '.html', '.css', '.js', '.ico', '.ts',
    ]);
    await Promise.all(files.map(async (file) => {
      const localPath = path.join(outputDir, file);
      const remoteKey = `videos/${videoId}/hls/${file}`;
      const fileExt = file.substring(file.lastIndexOf('.')).toLowerCase();

      let contentType = 'application/octet-stream';
      // Thumbnail/sprite/candidate files are always .jpg — match by filename
      // pattern FIRST so rotation extensions can't misclassify them.
      if (file === 'thumbnail.jpg' || file === 'sprite.jpg' || /^candidate-\d+\.jpg$/.test(file)) {
        contentType = 'image/jpeg';
      } else if (fileExt === '.m3u8') {
        contentType = 'application/vnd.apple.mpegurl';
      } else if (fileExt === '.m4s') {
        contentType = 'video/iso.segment';  // fMP4 segments (AV1)
      } else if (fileExt === '.mp4') {
        contentType = 'video/mp4';          // fMP4 init segment
      } else if (fileExt === '.vtt') {
        contentType = 'text/vtt';
      } else if (SEGMENT_EXTS_FOR_UPLOAD.has(fileExt)) {
        // Any of the rotation extensions → HLS video segment
        contentType = 'video/MP2T';
      }

      const buffer = fs.readFileSync(localPath);
      await storage.uploadFileTo(remoteKey, buffer, contentType, storageType);

      if (file === 'thumbnail.jpg') {
        thumbnailUrl = await storage.getFileUrlFor(remoteKey, storageType);
      }
      if (file === 'sprite.jpg') {
        spriteUrl = await storage.getFileUrlFor(remoteKey, storageType);
      }
      if (file === 'sprite.vtt') {
        spriteVttUrl = await storage.getFileUrlFor(remoteKey, storageType);
      }
      const candidateMatch = file.match(/^candidate-(\d+)\.jpg$/);
      if (candidateMatch) {
        candidateUrls[candidateMatch[1]] = await storage.getFileUrlFor(remoteKey, storageType);
      }
    }));

    job.progress(95);

    // Calculate total encoded size before cleanup (key files already filtered out).
    const encodedSize = files.reduce((sum, file) => {
      return sum + fs.statSync(path.join(outputDir, file)).size;
    }, 0);

    // Clean up temp files and original upload
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.unlinkSync(filePath);

    // Update DB with final status, encoded size, and storage type.
    // - thumbnail_url is overwritten with the auto-generated one unless the
    //   user has locked a custom thumbnail (keepCustomThumbnail).
    // - thumbnail_candidates always updated; sprite_vtt_url added.
    const qualityNames = selectedQualities.map(q => q.name);
    const candidatesJson = JSON.stringify([1, 2, 3]
      .filter(i => candidateUrls[i])
      .map(i => ({ index: i, url: candidateUrls[i] })));

    if (keepCustomThumbnail) {
      await db.query(
        `UPDATE videos
         SET status = $1, hls_ready = $2, qualities = $3, duration = $4,
             file_size = $5, storage_type = $6, sprite_url = $7,
             sprite_vtt_url = $8, thumbnail_candidates = $9
         WHERE id = $10`,
        ['ready', true, JSON.stringify(qualityNames), duration, encodedSize,
         storageType, spriteUrl || null, spriteVttUrl || null, candidatesJson, videoId]
      );
    } else {
      await db.query(
        `UPDATE videos
         SET status = $1, hls_ready = $2, qualities = $3, duration = $4,
             thumbnail_url = $5, file_size = $6, storage_type = $7,
             sprite_url = $8, sprite_vtt_url = $9, thumbnail_candidates = $10
         WHERE id = $11`,
        ['ready', true, JSON.stringify(qualityNames), duration, thumbnailUrl,
         encodedSize, storageType, spriteUrl || null, spriteVttUrl || null,
         candidatesJson, videoId]
      );
    }

    job.progress(100);
    console.log(`Video ${videoId} processing complete`);

    // If this video came from a download (torrent/URL), clean up the downloaded files.
    // Path safety: use path.relative() to verify the candidate is INSIDE downloadsRoot,
    // not just sharing a string prefix. Without this, a folder like
    // /downloads/torrents-evil/X would falsely match startsWith('/downloads/torrents').
    const torrentDir = job.data.torrentDir;
    if (torrentDir) {
      try {
        const downloadsRoot = path.resolve(process.env.TORRENT_DOWNLOAD_DIR || path.join(process.cwd(), 'downloads', 'torrents'));
        const resolvedTarget = path.resolve(torrentDir);
        const rel = path.relative(downloadsRoot, resolvedTarget);
        const isInside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));

        if (isInside && rel !== '') {
          // Subfolder: delete entire folder (e.g., torrents/Big Buck Bunny/)
          fs.rmSync(resolvedTarget, { recursive: true, force: true });
          console.log(`Cleaned up download folder: ${resolvedTarget}`);
        } else if (isInside && rel === '' && fs.existsSync(filePath)) {
          // Direct file in root: delete just the file
          fs.unlinkSync(filePath);
          console.log(`Cleaned up download file: ${filePath}`);
        } else {
          console.warn(`[worker] Refused to clean torrentDir outside downloads root: ${torrentDir}`);
        }
      } catch (e) {
        console.error('Download cleanup warning:', e.message);
      }
    }

    // Trigger webhook
    triggerWebhooks('video.ready', {
      id: videoId,
      title: originalFilename,
      status: 'ready',
      qualities: qualityNames,
      duration,
    });

  } catch (error) {
    console.error(`Error processing video ${videoId}:`, error);

    await db.query(
      'UPDATE videos SET status = $1 WHERE id = $2',
      ['error', videoId]
    );

    // Best-effort immediate cleanup of partial artifacts so disk doesn't fill up
    // before the hourly auto-cleanup pass runs. All operations are wrapped
    // individually — one failure must not prevent the others.
    try {
      // STAGE 2: temp processing dir (where FFmpeg was writing HLS segments)
      const outputDir = path.join(__dirname, 'uploads', 'processing', videoId);
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
        console.log(`[worker] Cleaned temp dir after error: ${outputDir}`);
      }
    } catch (e) {
      console.warn(`[worker] Failed to clean temp dir for ${videoId}:`, e.message);
    }

    try {
      // STAGE 1: original multer upload
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[worker] Cleaned original upload after error: ${filePath}`);
      }
    } catch (e) {
      console.warn(`[worker] Failed to clean original upload for ${videoId}:`, e.message);
    }

    try {
      // STAGE 3: any partial files already written to final storage
      // (e.g. uploadFileTo succeeded for 5/20 segments before the 6th crashed)
      const storageType = job.data.storageType === 'r2' ? 'r2' : 'local';
      if (typeof storage.deleteFolderFrom === 'function') {
        await storage.deleteFolderFrom(`videos/${videoId}`, storageType);
        console.log(`[worker] Cleaned partial ${storageType} assets after error: videos/${videoId}/`);
      }
    } catch (e) {
      console.warn(`[worker] Failed to clean partial final storage for ${videoId}:`, e.message);
    }

    triggerWebhooks('video.error', { id: videoId, error: error.message });

    throw error;
  }
      });
      console.log(`[worker] videoQueue.process() registered with concurrency=${_initialVideoConcurrency}`);
    } catch (err) {
      console.error('[worker] FATAL: failed to register videoQueue.process — exiting so process manager can restart us:', err);
      process.exit(1);
    }
  }); // end loadEncodingConfig().finally()

videoQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed for video ${job.data.videoId}:`, err.message);
});

videoQueue.on('completed', (job) => {
  console.log(`Job ${job.id} completed for video ${job.data.videoId}`);
});

console.log('Video processing worker started');
