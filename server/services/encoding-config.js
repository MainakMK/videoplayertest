/**
 * Encoding configuration service.
 *
 * Reads, validates, and writes the encoding-related settings used by the FFmpeg
 * worker. The worker calls `loadEncodingConfig()` on every job, so changes to
 * settings take effect on the NEXT video without requiring a worker restart
 * (except `video_concurrency` — see worker-restart-guide.md).
 *
 * Settings keys (all stored as strings in the `settings` table):
 *   - encoding_preset_tier         premium|balanced|optimized|custom
 *   - encoding_bitrate_2160p       8000..24000 (kbps, integer)  4K UHD
 *   - encoding_bitrate_1440p       4000..16000 (kbps, integer)  2K QHD
 *   - encoding_bitrate_1080p       800..8000   (kbps, integer)  Full HD
 *   - encoding_bitrate_720p        500..4500   (kbps, integer)  HD
 *   - encoding_bitrate_480p        300..2000   (kbps, integer)  SD
 *   - encoding_bitrate_360p        200..1000   (kbps, integer)  Low SD
 *   - encoding_bitrate_240p        100..600    (kbps, integer)  Mobile / weak network
 *   - encoding_audio_bitrate       64|96|128|192|256 (kbps)
 *   - encoding_quality_concurrency 1..5
 *   - encoding_video_concurrency   1|2|4|8
 *   - encoding_ffmpeg_preset       ultrafast|superfast|veryfast|faster|fast|medium
 *   - encoding_clone_top_quality   'true' | 'false'  (default 'true')
 *   - encoding_default_qualities   JSON array of quality names enabled for new uploads
 *   - encoding_encrypt_new_videos  'true' | 'false'  (default 'false')
 *   - encoding_segment_extension    '.jpeg'|'.png'|'.webp'|'.gif'|'.avif'|'.html'|'.css'|'.js'|'.ico' (default '.jpeg')
 *   - encoding_rate_control          'abr' | 'constrained_vbr' (default 'abr')
 *   - encoding_maxrate_ratio         1.0..3.0 float  (default 1.5)
 *   - encoding_bufsize_ratio         1.0..4.0 float  (default 2.0)
 *   - encoding_video_codec          'h264' | 'h265' | 'av1'  (default 'h264')
 *   - encoding_keyframe_seconds    1|2|3|4  (seconds; default 2 = Apple HLS spec)
 *   - encoding_audio_mode          'stereo' | 'surround'  (default 'stereo')
 *   - encoding_ac3_bitrate         256|384|448|640 (kbps; default 384)
 *   - encoding_extra_ffmpeg_params string (free-text FFmpeg flags, max 500 chars)
 *
 * Per-video override:
 *   - videos.encoded_qualities      JSONB array (NULL = use settings defaults)
 */

const db = require('../db');

// ─────────────────────────────────────────────────────────────────────────────
// Defaults & ranges (single source of truth — also used for validation)
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TIERS = ['premium', 'balanced', 'optimized', 'custom'];
const VALID_AUDIO = [64, 96, 128, 192, 256];
const VALID_VIDEO_CONCURRENCY = [1, 2, 4, 8];
const VALID_QUALITY_CONCURRENCY = [1, 2, 3, 4, 5];
const VALID_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'];
const VALID_KEYFRAME_SECONDS = [1, 2, 3, 4];
// HLS segment extensions for cache diversification + scrape resistance.
// Admin picks ONE from this list in Settings; all NEW uploads use it until
// they change it. Existing videos keep their original extension forever.
// AV1 is exempt — fMP4 requires .m4s, browsers reject other extensions.
const VALID_SEGMENT_EXTENSIONS = ['.jpeg', '.png', '.webp', '.gif', '.avif', '.html', '.css', '.js', '.ico'];
const VALID_RATE_CONTROLS = ['abr', 'constrained_vbr'];
const MAXRATE_RATIO_RANGE = { min: 1.0, max: 3.0, default: 1.5 };
const BUFSIZE_RATIO_RANGE = { min: 1.0, max: 4.0, default: 2.0 };
const VALID_AUDIO_MODES = ['stereo', 'surround'];
const VALID_AC3_BITRATES = [256, 384, 448, 640];
const VALID_VIDEO_CODECS = ['h264', 'h265', 'av1'];

/**
 * Maps the user-facing codec name to the FFmpeg flags, container format,
 * bitstream filter (for clone mode), and HLS CODECS string.
 *
 * H.264: universal compatibility. MPEG-TS segments (.jpeg obfuscated).
 * H.265: 30-50% smaller; needs `-tag:v hvc1` for Apple HLS; MPEG-TS ok.
 *        No Firefox support.
 * AV1:   40-60% smaller; MUST use fMP4 (MPEG-TS doesn't support AV1);
 *        SVT-AV1 is 2-5x faster than libaom. Recent browser support.
 */
const CODEC_CONFIGS = {
  h264: {
    encoder: 'libx264',
    tag: null,
    segmentType: 'mpegts',
    segmentExt: '.jpeg',              // obfuscated MPEG-TS
    bitstreamFilter: 'h264_mp4toannexb',
    codecString: 'avc1.640028',       // High profile, level 4.0
    extraFlags: [],
    cloneCodecs: new Set(['h264', 'avc1', 'avc']),
    sizeMultiplier: 1.0,              // baseline for impact calculations
    speedLabel: '1x (baseline)',
  },
  h265: {
    encoder: 'libx265',
    tag: 'hvc1',                       // required for Apple HLS compat
    segmentType: 'mpegts',
    segmentExt: '.jpeg',
    bitstreamFilter: 'hevc_mp4toannexb',
    codecString: 'hvc1.1.6.L93.B0',   // Main profile, level 3.1
    extraFlags: [],
    cloneCodecs: new Set(['hevc', 'hev1', 'hvc1']),
    sizeMultiplier: 0.6,              // ~40% smaller at same quality
    speedLabel: '3-5x slower',
  },
  av1: {
    encoder: 'libsvtav1',
    tag: null,
    segmentType: 'fmp4',              // AV1 CANNOT use MPEG-TS
    segmentExt: '.m4s',               // fMP4 segments
    bitstreamFilter: null,             // not needed for fMP4
    codecString: 'av01.0.04M.08',     // Main profile, level 3.0
    extraFlags: [],                    // SVT-AV1 defaults are good
    cloneCodecs: new Set(['av1', 'av01']),
    sizeMultiplier: 0.5,              // ~50% smaller at same quality
    speedLabel: '5-20x slower',
    // SVT-AV1 uses NUMERIC presets (0=slowest/best → 13=fastest/worst),
    // NOT the x264/x265 preset names (ultrafast, veryfast, etc.).
    // Passing "-preset veryfast" to libsvtav1 CRASHES FFmpeg.
    // This map translates x264 names to roughly-equivalent SVT-AV1 numbers.
    presetMap: {
      ultrafast: '12',
      superfast: '11',
      veryfast: '10',
      faster: '8',
      fast: '6',
      medium: '4',
    },
  },
};

// All quality variants supported by the worker. Order = highest to lowest.
const ALL_QUALITIES = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p'];

const BITRATE_RANGES = {
  '2160p': { min: 8000, max: 24000, default: 14000 },  // 4K UHD
  '1440p': { min: 4000, max: 16000, default: 8000 },   // 2K QHD
  '1080p': { min: 800,  max: 8000,  default: 3500 },   // Full HD
  '720p':  { min: 500,  max: 4500,  default: 2000 },   // HD
  '480p':  { min: 300,  max: 2000,  default: 1000 },   // SD
  '360p':  { min: 200,  max: 1000,  default: 600 },    // Low SD
  '240p':  { min: 100,  max: 600,   default: 300 },    // Mobile / weak network
};

// The 3 quick-pick tiers — exact bitrate values for each.
// Includes all 7 quality variants (240p / 360p / 480p / 720p / 1080p / 1440p / 2160p).
const TIER_PRESETS = {
  premium: {
    bitrate_2160p: 18000,
    bitrate_1440p: 11000,
    bitrate_1080p: 5000,
    bitrate_720p:  3000,
    bitrate_480p:  1500,
    bitrate_360p:  1000,
    bitrate_240p:  500,
    audio_bitrate: 192,
  },
  balanced: {
    bitrate_2160p: 14000,
    bitrate_1440p: 8000,
    bitrate_1080p: 3500,
    bitrate_720p:  2000,
    bitrate_480p:  1000,
    bitrate_360p:  600,
    bitrate_240p:  300,
    audio_bitrate: 128,
  },
  optimized: {
    bitrate_2160p: 10000,
    bitrate_1440p: 6000,
    bitrate_1080p: 2500,
    bitrate_720p:  1500,
    bitrate_480p:  700,
    bitrate_360p:  400,
    bitrate_240p:  200,
    audio_bitrate: 96,
  },
};

const DEFAULTS = {
  encoding_preset_tier: 'balanced',
  encoding_bitrate_2160p: 14000,
  encoding_bitrate_1440p: 8000,
  encoding_bitrate_1080p: 3500,
  encoding_bitrate_720p:  2000,
  encoding_bitrate_480p:  1000,
  encoding_bitrate_360p:  600,
  encoding_bitrate_240p:  300,
  encoding_audio_bitrate: 128,
  encoding_quality_concurrency: 2,
  encoding_video_concurrency: 1,
  encoding_ffmpeg_preset: 'veryfast',
  encoding_clone_top_quality: 'true',  // skip re-encoding when source matches a preset
  // Default quality variants enabled for new uploads (JSON array of names).
  // Per-video override is stored on videos.encoded_qualities. Keeps 240p disabled
  // by default since most users don't need it.
  encoding_default_qualities: JSON.stringify(['360p', '480p', '720p', '1080p']),
  // AES-128 HLS encryption — global default for newly uploaded videos.
  // Per-video override is stored on videos.encryption_enabled. Off by default
  // because existing behavior should be unchanged unless the admin opts in.
  encoding_encrypt_new_videos: 'false',
  // Keyframe interval in seconds. The worker derives the actual `-g` (in
  // frames) via `round(fps × this)`. 2s matches Apple's HLS Authoring
  // Specification and is used by YouTube, Netflix, Twitch, etc.
  encoding_keyframe_seconds: '2',
  // HLS segment extension — file extension used for NEW uploads' segments.
  // Default .jpeg matches existing videos. Admin can rotate to .webp, .png,
  // etc. for CDN cache diversification without affecting existing uploads.
  encoding_segment_extension: '.jpeg',
  // Rate control mode: 'constrained_vbr' = industry standard, adds -maxrate +
  // -bufsize for better quality-per-bit. 'abr' = pure average bitrate (simpler
  // but lower quality on complex scenes). Default is constrained_vbr to match
  // Netflix/YouTube/Apple HLS recommendations.
  encoding_rate_control: 'constrained_vbr',
  // Maxrate ratio: maxrate = target_bitrate × this. Range 1.0-3.0, default 1.5.
  // e.g., 1080p @ 3500k → maxrate = 3500 × 1.5 = 5250k
  encoding_maxrate_ratio: '1.5',
  // Bufsize ratio: bufsize = target_bitrate × this. Range 1.0-4.0, default 2.0.
  // e.g., 1080p @ 3500k → bufsize = 3500 × 2.0 = 7000k
  encoding_bufsize_ratio: '2.0',
  // Video codec: 'h264' (universal), 'h265' (HEVC, 30-50% smaller, no Firefox),
  // 'av1' (40-60% smaller, slow encode, recent browsers). Default is h264.
  encoding_video_codec: 'h264',
  // Audio mode: 'stereo' = AAC stereo only (default, current behavior).
  // 'surround' = produce BOTH AC3 5.1 surround + AAC stereo. Player auto-
  // selects. AC3 track is only produced when the source has ≥ 6 channels;
  // stereo sources skip the surround track automatically.
  encoding_audio_mode: 'stereo',
  // AC3 5.1 surround bitrate (kbps). Used when audio_mode = 'surround'.
  // 384k is the standard for DVD/broadcast quality 5.1 AC3.
  encoding_ac3_bitrate: '384',
  // Extra FFmpeg parameters — free-text string appended to every encode command.
  // Power-user escape hatch for flags not exposed in the UI (e.g., -tune film).
  // Empty by default. Max 500 chars. Dangerous flags (-i, -y) are blocked.
  encoding_extra_ffmpeg_params: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// Short TTL because the worker calls loadEncodingConfig() on every single video
// (could be many per minute) — without a cache we'd hammer the DB. 10 seconds is
// a deliberate trade-off: settings changes take effect within 10s of saving.
// `clearCache()` is called explicitly after every write in saveEncodingConfig().
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10_000;

let _cache = null;
let _cacheAt = 0;

function clearCache() {
  _cache = null;
  _cacheAt = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read settings from DB and merge with defaults
// ─────────────────────────────────────────────────────────────────────────────

async function loadEncodingConfig() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < CACHE_TTL_MS) return _cache;

  const result = await db.query(
    "SELECT key, value FROM settings WHERE key LIKE 'encoding_%'"
  );

  const map = {};
  for (const row of result.rows) {
    map[row.key] = row.value;
  }

  // Build the final config by merging stored values with defaults + clamping
  const cfg = {
    preset_tier: VALID_TIERS.includes(map.encoding_preset_tier)
      ? map.encoding_preset_tier
      : DEFAULTS.encoding_preset_tier,

    bitrate_2160p: clampInt(map.encoding_bitrate_2160p, BITRATE_RANGES['2160p']),
    bitrate_1440p: clampInt(map.encoding_bitrate_1440p, BITRATE_RANGES['1440p']),
    bitrate_1080p: clampInt(map.encoding_bitrate_1080p, BITRATE_RANGES['1080p']),
    bitrate_720p:  clampInt(map.encoding_bitrate_720p,  BITRATE_RANGES['720p']),
    bitrate_480p:  clampInt(map.encoding_bitrate_480p,  BITRATE_RANGES['480p']),
    bitrate_360p:  clampInt(map.encoding_bitrate_360p,  BITRATE_RANGES['360p']),
    bitrate_240p:  clampInt(map.encoding_bitrate_240p,  BITRATE_RANGES['240p']),

    audio_bitrate: VALID_AUDIO.includes(parseInt(map.encoding_audio_bitrate, 10))
      ? parseInt(map.encoding_audio_bitrate, 10)
      : DEFAULTS.encoding_audio_bitrate,

    quality_concurrency: VALID_QUALITY_CONCURRENCY.includes(parseInt(map.encoding_quality_concurrency, 10))
      ? parseInt(map.encoding_quality_concurrency, 10)
      : DEFAULTS.encoding_quality_concurrency,

    video_concurrency: VALID_VIDEO_CONCURRENCY.includes(parseInt(map.encoding_video_concurrency, 10))
      ? parseInt(map.encoding_video_concurrency, 10)
      : DEFAULTS.encoding_video_concurrency,

    ffmpeg_preset: VALID_PRESETS.includes(map.encoding_ffmpeg_preset)
      ? map.encoding_ffmpeg_preset
      : DEFAULTS.encoding_ffmpeg_preset,

    // Clone top quality — when ON, sources whose codec is h264 AND resolution
    // matches a preset (within tolerance) are stream-copied instead of re-encoded.
    // Saves a huge amount of CPU. Cannot be combined with rendered logos / burned-in
    // subtitles for that quality variant — use re-encoding for those.
    //
    // Strict comparison so typos like 'False' / '' / null don't accidentally
    // re-enable the feature. Only writes via saveEncodingConfig() ever set the value,
    // and that path always writes the literal 'true' or 'false'.
    clone_top_quality: map.encoding_clone_top_quality === undefined
      ? true                                           // never written → use baked default (on)
      : map.encoding_clone_top_quality === 'true',     // strict equality after that

    // Default qualities enabled for new uploads (used when video.encoded_qualities is null)
    default_qualities: parseDefaultQualities(map.encoding_default_qualities),

    // Whether newly uploaded videos should be AES-128 encrypted by default
    // (per-video override: videos.encryption_enabled). Strict string comparison
    // matches the clone_top_quality pattern.
    encrypt_new_videos: map.encoding_encrypt_new_videos === 'true',

    // Keyframe interval in seconds. Worker uses this × probed fps for `-g`.
    // Validated to 1-4 range; default 2 = Apple HLS spec recommendation.
    keyframe_seconds: VALID_KEYFRAME_SECONDS.includes(parseInt(map.encoding_keyframe_seconds, 10))
      ? parseInt(map.encoding_keyframe_seconds, 10)
      : 2,

    // HLS segment extension for new uploads (admin-controlled rotation)
    segment_extension: VALID_SEGMENT_EXTENSIONS.includes(map.encoding_segment_extension)
      ? map.encoding_segment_extension
      : '.jpeg',

    // Rate control mode + ratios
    rate_control: VALID_RATE_CONTROLS.includes(map.encoding_rate_control)
      ? map.encoding_rate_control
      : 'abr',
    maxrate_ratio: clampFloat(map.encoding_maxrate_ratio, MAXRATE_RATIO_RANGE),
    bufsize_ratio: clampFloat(map.encoding_bufsize_ratio, BUFSIZE_RATIO_RANGE),

    // Video codec selection — maps to CODEC_CONFIGS for FFmpeg flags.
    video_codec: VALID_VIDEO_CODECS.includes(map.encoding_video_codec)
      ? map.encoding_video_codec
      : 'h264',

    // Multi-codec audio: 'stereo' (AAC only) or 'surround' (AC3 5.1 + AAC stereo).
    audio_mode: VALID_AUDIO_MODES.includes(map.encoding_audio_mode)
      ? map.encoding_audio_mode
      : 'stereo',

    // AC3 5.1 surround bitrate (kbps). Only used when audio_mode = 'surround'.
    ac3_bitrate: VALID_AC3_BITRATES.includes(parseInt(map.encoding_ac3_bitrate, 10))
      ? parseInt(map.encoding_ac3_bitrate, 10)
      : 384,

    // Extra FFmpeg params — raw string, parsed by the worker at encode time.
    extra_ffmpeg_params: (map.encoding_extra_ffmpeg_params || '').slice(0, 500),
  };

  // Build the qualityPresets array used by the worker.
  // ORDER MATTERS: highest quality first so the master playlist lists
  // the best stream first (HLS players default to the first variant).
  cfg.qualityPresets = [
    {
      name: '2160p', height: 2160,
      videoBitrate: `${cfg.bitrate_2160p}k`,
      audioBitrate: `${cfg.audio_bitrate}k`,
      bandwidth: cfg.bitrate_2160p * 1000 + cfg.audio_bitrate * 1000 + 128000,
      resolution: '3840x2160',
    },
    {
      name: '1440p', height: 1440,
      videoBitrate: `${cfg.bitrate_1440p}k`,
      audioBitrate: `${cfg.audio_bitrate}k`,
      bandwidth: cfg.bitrate_1440p * 1000 + cfg.audio_bitrate * 1000 + 128000,
      resolution: '2560x1440',
    },
    {
      name: '1080p', height: 1080,
      videoBitrate: `${cfg.bitrate_1080p}k`,
      audioBitrate: `${cfg.audio_bitrate}k`,
      bandwidth: cfg.bitrate_1080p * 1000 + cfg.audio_bitrate * 1000 + 128000,
      resolution: '1920x1080',
    },
    {
      name: '720p', height: 720,
      videoBitrate: `${cfg.bitrate_720p}k`,
      audioBitrate: `${cfg.audio_bitrate}k`,
      bandwidth: cfg.bitrate_720p * 1000 + cfg.audio_bitrate * 1000 + 128000,
      resolution: '1280x720',
    },
    {
      name: '480p', height: 480,
      videoBitrate: `${cfg.bitrate_480p}k`,
      audioBitrate: `${cfg.audio_bitrate}k`,
      bandwidth: cfg.bitrate_480p * 1000 + cfg.audio_bitrate * 1000 + 128000,
      resolution: '854x480',
    },
    {
      name: '360p', height: 360,
      videoBitrate: `${cfg.bitrate_360p}k`,
      audioBitrate: `${cfg.audio_bitrate}k`,
      bandwidth: cfg.bitrate_360p * 1000 + cfg.audio_bitrate * 1000 + 128000,
      resolution: '640x360',
    },
    {
      name: '240p', height: 240,
      videoBitrate: `${cfg.bitrate_240p}k`,
      audioBitrate: `${cfg.audio_bitrate}k`,
      bandwidth: cfg.bitrate_240p * 1000 + cfg.audio_bitrate * 1000 + 128000,
      resolution: '426x240',
    },
  ];

  _cache = cfg;
  _cacheAt = now;
  return cfg;
}

function clampInt(value, range) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return range.default;
  if (n < range.min) return range.min;
  if (n > range.max) return range.max;
  return n;
}

function clampFloat(value, range) {
  const n = parseFloat(value);
  if (!isFinite(n)) return range.default;
  if (n < range.min) return range.min;
  if (n > range.max) return range.max;
  return Math.round(n * 10) / 10; // round to 1 decimal
}

/**
 * Parse a default_qualities setting value (stored as JSON string) into a
 * filtered array of valid quality names. Falls back to a sensible default if
 * the stored value is missing/invalid.
 */
function parseDefaultQualities(raw) {
  const FALLBACK = ['360p', '480p', '720p', '1080p'];
  if (!raw) return FALLBACK;
  let arr;
  try {
    arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return FALLBACK;
  }
  if (!Array.isArray(arr) || arr.length === 0) return FALLBACK;
  const filtered = arr.filter(q => ALL_QUALITIES.includes(q));
  return filtered.length > 0 ? filtered : FALLBACK;
}

/**
 * Resolve which quality variants the worker should encode for a given video.
 *
 * Priority:
 *   1. Per-video `encoded_qualities` array (if set explicitly at upload time)
 *   2. Settings `default_qualities` (the global default)
 * Then ALWAYS filter by source resolution (no upscaling).
 *
 * @param {Array<{name: string, height: number, ...}>} qualityPresets — full list from cfg
 * @param {Array<string>|null} perVideoQualities — videos.encoded_qualities column value
 * @param {Array<string>} defaultQualities — cfg.default_qualities
 * @param {number} sourceHeight — detected via ffprobe
 */
function resolveQualitiesForVideo(qualityPresets, perVideoQualities, defaultQualities, sourceHeight) {
  let allowedNames;
  if (Array.isArray(perVideoQualities) && perVideoQualities.length > 0) {
    allowedNames = perVideoQualities.filter(q => ALL_QUALITIES.includes(q));
  } else {
    allowedNames = (defaultQualities || []).filter(q => ALL_QUALITIES.includes(q));
  }
  if (allowedNames.length === 0) {
    // Final safety net so we always encode something. Mirrors the system-wide
    // baked-in default for `encoding_default_qualities` so behavior is consistent
    // across "no settings configured" and "all picks were invalid" cases.
    allowedNames = ['360p', '480p', '720p', '1080p'];
  }
  return qualityPresets.filter(q =>
    allowedNames.includes(q.name) && q.height <= sourceHeight
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Save settings (validates + clamps every value)
// ─────────────────────────────────────────────────────────────────────────────

async function saveEncodingConfig(input) {
  const updates = {};

  if (input.preset_tier !== undefined) {
    if (!VALID_TIERS.includes(input.preset_tier)) {
      throw new Error(`Invalid preset_tier. Must be one of: ${VALID_TIERS.join(', ')}`);
    }
    updates.encoding_preset_tier = input.preset_tier;

    // If user picked one of the named tiers, fill in the bitrates from the tier
    if (input.preset_tier !== 'custom') {
      const t = TIER_PRESETS[input.preset_tier];
      updates.encoding_bitrate_2160p = String(t.bitrate_2160p);
      updates.encoding_bitrate_1440p = String(t.bitrate_1440p);
      updates.encoding_bitrate_1080p = String(t.bitrate_1080p);
      updates.encoding_bitrate_720p  = String(t.bitrate_720p);
      updates.encoding_bitrate_480p  = String(t.bitrate_480p);
      updates.encoding_bitrate_360p  = String(t.bitrate_360p);
      updates.encoding_bitrate_240p  = String(t.bitrate_240p);
      updates.encoding_audio_bitrate = String(t.audio_bitrate);
    }
  }

  // Manual bitrate overrides (clamped to valid range; if a tier was selected
  // above, these get overridden when the user explicitly sets them via Custom)
  if (input.bitrate_2160p !== undefined) {
    updates.encoding_bitrate_2160p = String(clampInt(input.bitrate_2160p, BITRATE_RANGES['2160p']));
  }
  if (input.bitrate_1440p !== undefined) {
    updates.encoding_bitrate_1440p = String(clampInt(input.bitrate_1440p, BITRATE_RANGES['1440p']));
  }
  if (input.bitrate_1080p !== undefined) {
    updates.encoding_bitrate_1080p = String(clampInt(input.bitrate_1080p, BITRATE_RANGES['1080p']));
  }
  if (input.bitrate_720p !== undefined) {
    updates.encoding_bitrate_720p  = String(clampInt(input.bitrate_720p,  BITRATE_RANGES['720p']));
  }
  if (input.bitrate_480p !== undefined) {
    updates.encoding_bitrate_480p  = String(clampInt(input.bitrate_480p,  BITRATE_RANGES['480p']));
  }
  if (input.bitrate_360p !== undefined) {
    updates.encoding_bitrate_360p  = String(clampInt(input.bitrate_360p,  BITRATE_RANGES['360p']));
  }
  if (input.bitrate_240p !== undefined) {
    updates.encoding_bitrate_240p  = String(clampInt(input.bitrate_240p,  BITRATE_RANGES['240p']));
  }

  if (input.audio_bitrate !== undefined) {
    const ab = parseInt(input.audio_bitrate, 10);
    if (!VALID_AUDIO.includes(ab)) {
      throw new Error(`Invalid audio_bitrate. Must be one of: ${VALID_AUDIO.join(', ')}`);
    }
    updates.encoding_audio_bitrate = String(ab);
  }

  if (input.quality_concurrency !== undefined) {
    const n = parseInt(input.quality_concurrency, 10);
    if (!VALID_QUALITY_CONCURRENCY.includes(n)) {
      throw new Error(`Invalid quality_concurrency. Must be one of: ${VALID_QUALITY_CONCURRENCY.join(', ')}`);
    }
    updates.encoding_quality_concurrency = String(n);
  }

  if (input.video_concurrency !== undefined) {
    const n = parseInt(input.video_concurrency, 10);
    if (!VALID_VIDEO_CONCURRENCY.includes(n)) {
      throw new Error(`Invalid video_concurrency. Must be one of: ${VALID_VIDEO_CONCURRENCY.join(', ')}`);
    }
    updates.encoding_video_concurrency = String(n);
  }

  if (input.ffmpeg_preset !== undefined) {
    if (!VALID_PRESETS.includes(input.ffmpeg_preset)) {
      throw new Error(`Invalid ffmpeg_preset. Must be one of: ${VALID_PRESETS.join(', ')}`);
    }
    updates.encoding_ffmpeg_preset = input.ffmpeg_preset;
  }

  if (input.clone_top_quality !== undefined) {
    // Coerce truthy/falsy + literal 'true'/'false' strings
    const v = (input.clone_top_quality === true || input.clone_top_quality === 'true');
    updates.encoding_clone_top_quality = v ? 'true' : 'false';
  }

  if (input.encrypt_new_videos !== undefined) {
    const v = (input.encrypt_new_videos === true || input.encrypt_new_videos === 'true');
    updates.encoding_encrypt_new_videos = v ? 'true' : 'false';
  }

  if (input.keyframe_seconds !== undefined) {
    // Use Number() instead of parseInt() — parseInt silently ignores trailing
    // garbage (e.g., parseInt('2; DROP TABLE') → 2). Number() rejects it
    // cleanly (→ NaN). Number.isInteger guards against floats and NaN.
    const n = Number(input.keyframe_seconds);
    if (!Number.isInteger(n) || !VALID_KEYFRAME_SECONDS.includes(n)) {
      throw new Error(`Invalid keyframe_seconds. Must be one of: ${VALID_KEYFRAME_SECONDS.join(', ')}`);
    }
    updates.encoding_keyframe_seconds = String(n);
  }

  if (input.segment_extension !== undefined) {
    if (!VALID_SEGMENT_EXTENSIONS.includes(input.segment_extension)) {
      throw new Error(`Invalid segment_extension. Must be one of: ${VALID_SEGMENT_EXTENSIONS.join(', ')}`);
    }
    updates.encoding_segment_extension = input.segment_extension;
  }

  if (input.rate_control !== undefined) {
    if (!VALID_RATE_CONTROLS.includes(input.rate_control)) {
      throw new Error(`Invalid rate_control. Must be one of: ${VALID_RATE_CONTROLS.join(', ')}`);
    }
    updates.encoding_rate_control = input.rate_control;
  }

  if (input.maxrate_ratio !== undefined) {
    const n = Number(input.maxrate_ratio);
    if (!isFinite(n) || n < MAXRATE_RATIO_RANGE.min || n > MAXRATE_RATIO_RANGE.max) {
      throw new Error(`Invalid maxrate_ratio. Must be ${MAXRATE_RATIO_RANGE.min}-${MAXRATE_RATIO_RANGE.max}`);
    }
    updates.encoding_maxrate_ratio = String(Math.round(n * 10) / 10);
  }

  if (input.bufsize_ratio !== undefined) {
    const n = Number(input.bufsize_ratio);
    if (!isFinite(n) || n < BUFSIZE_RATIO_RANGE.min || n > BUFSIZE_RATIO_RANGE.max) {
      throw new Error(`Invalid bufsize_ratio. Must be ${BUFSIZE_RATIO_RANGE.min}-${BUFSIZE_RATIO_RANGE.max}`);
    }
    updates.encoding_bufsize_ratio = String(Math.round(n * 10) / 10);
  }

  if (input.video_codec !== undefined) {
    if (!VALID_VIDEO_CODECS.includes(input.video_codec)) {
      throw new Error(`Invalid video_codec. Must be one of: ${VALID_VIDEO_CODECS.join(', ')}`);
    }
    updates.encoding_video_codec = input.video_codec;
  }

  if (input.audio_mode !== undefined) {
    if (!VALID_AUDIO_MODES.includes(input.audio_mode)) {
      throw new Error(`Invalid audio_mode. Must be one of: ${VALID_AUDIO_MODES.join(', ')}`);
    }
    updates.encoding_audio_mode = input.audio_mode;
  }

  if (input.ac3_bitrate !== undefined) {
    const n = Number(input.ac3_bitrate);
    if (!Number.isInteger(n) || !VALID_AC3_BITRATES.includes(n)) {
      throw new Error(`Invalid ac3_bitrate. Must be one of: ${VALID_AC3_BITRATES.join(', ')}`);
    }
    updates.encoding_ac3_bitrate = String(n);
  }

  if (input.extra_ffmpeg_params !== undefined) {
    let raw = String(input.extra_ffmpeg_params || '');
    // Security: max length
    if (raw.length > 500) {
      throw new Error('extra_ffmpeg_params must be 500 characters or fewer');
    }
    // Security: strip shell metacharacters that could escape the spawn call.
    // fluent-ffmpeg uses child_process.spawn (not exec), so shell injection
    // via ; | & is already prevented at the OS level. But we strip them
    // anyway as defense-in-depth — there's no legitimate FFmpeg flag that
    // contains these characters.
    raw = raw.replace(/[;|&`$\\!{}()]/g, '');
    // Security: block flags that could read/write arbitrary files.
    // -i: read any file on disk as input
    // -y: silently overwrite output files
    // These are the two most dangerous FFmpeg flags for argument injection.
    // See: https://github.com/jellyfin/jellyfin/security/advisories/GHSA-866x-wj5j-2vf4
    const tokens = raw.split(/\s+/);
    // Blocked flags — could read/write arbitrary files on the server:
    //   -i: read any file as input
    //   -y: silently overwrite output files
    //   -filter_script: read a filter graph from an arbitrary file path
    //   -dump: dump packet data to stdout (info leak)
    // See: https://github.com/jellyfin/jellyfin/security/advisories/GHSA-866x-wj5j-2vf4
    const BLOCKED_FLAGS = new Set(['-i', '-y', '-filter_script', '-dump']);
    const hasBlocked = tokens.find(t => BLOCKED_FLAGS.has(t.toLowerCase()));
    if (hasBlocked) {
      throw new Error(`Blocked FFmpeg flag: ${hasBlocked}. The flags ${[...BLOCKED_FLAGS].join(', ')} are not allowed for security reasons.`);
    }
    updates.encoding_extra_ffmpeg_params = raw.trim();
  }

  if (input.default_qualities !== undefined) {
    let arr = input.default_qualities;
    if (typeof arr === 'string') {
      try { arr = JSON.parse(arr); } catch { arr = null; }
    }
    if (!Array.isArray(arr)) {
      throw new Error('default_qualities must be an array of quality names');
    }
    const valid = arr.filter(q => ALL_QUALITIES.includes(q));
    if (valid.length === 0) {
      throw new Error('default_qualities must contain at least one valid quality (' + ALL_QUALITIES.join(', ') + ')');
    }
    updates.encoding_default_qualities = JSON.stringify(valid);
  }

  for (const [key, value] of Object.entries(updates)) {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  }

  clearCache();
  return loadEncodingConfig();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public exports
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seed all encoding_* defaults into the settings table on first boot.
 * Idempotent — uses ON CONFLICT DO NOTHING so existing values are never overwritten.
 * Call once at server startup (server/index.js) so a fresh DB has explicit rows
 * matching the in-code DEFAULTS.
 */
async function seedDefaults() {
  try {
    const entries = Object.entries(DEFAULTS);
    for (const [key, value] of entries) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        [key, String(value)]
      );
    }
    clearCache();
  } catch (e) {
    console.warn('[encoding-config] Failed to seed defaults:', e.message);
  }
}

/**
 * Parse extra_ffmpeg_params string into an array suitable for
 * fluent-ffmpeg's outputOptions().
 *
 * Input:  "-tune film -profile:v high -level 4.1"
 * Output: ["-tune film", "-profile:v high", "-level 4.1"]
 *
 * Strategy: tokenize by whitespace, then re-group so each "-flag" starts
 * a new group and absorbs exactly ONE following non-dash value. This
 * handles: "-tune film", "-crf 23", "-pix_fmt yuv420p", "-vf yadif",
 * and standalone flags like "-faststart". Trailing garbage without a
 * leading dash is dropped.
 *
 * Returns empty array if input is empty/undefined.
 */
function parseExtraFfmpegParams(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return [];
  const tokens = raw.trim().split(/\s+/);
  const result = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith('-') || t.length < 2) { i++; continue; } // skip garbage
    // If next token exists and is NOT a flag → it's this flag's value
    if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
      result.push(t + ' ' + tokens[i + 1]);
      i += 2;
    } else {
      result.push(t);
      i++;
    }
  }
  return result;
}

module.exports = {
  loadEncodingConfig,
  saveEncodingConfig,
  resolveQualitiesForVideo,
  seedDefaults,
  clearCache,
  VALID_TIERS,
  VALID_AUDIO,
  VALID_VIDEO_CONCURRENCY,
  VALID_QUALITY_CONCURRENCY,
  VALID_PRESETS,
  VALID_KEYFRAME_SECONDS,
  VALID_SEGMENT_EXTENSIONS,
  VALID_RATE_CONTROLS,
  MAXRATE_RATIO_RANGE,
  BUFSIZE_RATIO_RANGE,
  VALID_AUDIO_MODES,
  VALID_AC3_BITRATES,
  VALID_VIDEO_CODECS,
  CODEC_CONFIGS,
  parseExtraFfmpegParams,
  ALL_QUALITIES,
  BITRATE_RANGES,
  TIER_PRESETS,
  DEFAULTS,
};
