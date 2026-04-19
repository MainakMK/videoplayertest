# Multi-Language Audio (Auto-Detection) Guide

> **Status**: Implemented. This document explains how the worker auto-detects
> multiple audio tracks in a source file and produces per-language HLS
> renditions that the player exposes via a language selector.

## What it does

When you upload a source video that contains multiple audio streams
(e.g., a movie file with English + Spanish + French dubs baked in), the
worker automatically:

1. Detects all audio streams via ffprobe
2. Reads each stream's language tag (`tags.language` → ISO 639-2 code)
3. Encodes each additional language as a separate HLS audio rendition
4. Emits `#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="..."` tags in the master playlist
5. The player's audio selector menu (built for 5.1 surround support)
   automatically shows a language picker — zero extra code needed

No UI, no upload, no admin action. Works the moment you upload a
multi-audio source file.

## Source file requirements

Your source file must have multiple audio streams with language tags.
Most container formats support this:

| Format | Multi-audio support | Language tag support |
|--------|:---:|:---:|
| MKV | ✅ | ✅ (excellent) |
| MP4 / MOV | ✅ | ✅ |
| TS (transport stream) | ✅ | ✅ |
| WebM | ✅ | ✅ |
| AVI | ⚠️ (limited) | ⚠️ |
| FLV | ❌ | ❌ |

Use `ffprobe your-video.mkv` to check — look for multiple `Stream #0:X`
audio lines with language codes like `(eng)`, `(spa)`, `(fra)`.

## Which audio becomes what

```
Source: movie.mkv
 ├── Stream #0:0  Video (H.264)
 ├── Stream #0:1  Audio (AAC, 5.1, language=eng)   ← "primary"
 ├── Stream #0:2  Audio (AAC, stereo, language=spa)
 ├── Stream #0:3  Audio (AAC, stereo, language=fra)
 └── Stream #0:4  Audio (AAC, stereo, language=deu)

Produces:

 ├── master.m3u8                                    ← references all below
 ├── 1080p.m3u8 + 1080p_NNN.jpeg                    ← video + English (primary muxed)
 ├── 720p.m3u8 + 720p_NNN.jpeg                      ← same
 ├── 480p.m3u8 + 480p_NNN.jpeg                      ← same
 ├── audio_ac3.m3u8 + segments                      ← 5.1 AC3 surround (from primary, if ≥6ch)
 ├── audio_spa.m3u8 + segments                      ← Spanish stereo
 ├── audio_fra.m3u8 + segments                      ← French stereo
 └── audio_deu.m3u8 + segments                      ← German stereo
```

**Key points:**
- The FIRST audio stream is always muxed into the video variants as the default audio
- Streams 2+ become separate audio-only renditions
- The player shows: `English [default]`, `Spanish`, `French`, `German`, and `5.1 Surround`
  (the last one only if the primary stream is 5.1 and `audio_mode=surround` is set)

## Master playlist output

### Single-language source (no change from previous behavior)
```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=3628000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=30.000
1080p.m3u8
```
No `#EXT-X-MEDIA` tags — plain single-track HLS, works on every player.

### Multi-language source
```
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="eng",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Spanish",LANGUAGE="spa",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="2",URI="audio_spa.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="French",LANGUAGE="fra",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="2",URI="audio_fra.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3628000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",FRAME-RATE=30.000,AUDIO="audio"
1080p.m3u8
```

The primary track has no `URI` (audio is muxed into the video variants).
Alternate languages each have their own audio-only playlist URI.

### Multi-language + 5.1 surround
```
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="eng",DEFAULT=YES,...
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="5.1 Surround",LANGUAGE="eng",CHANNELS="6",URI="audio_ac3.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Spanish",LANGUAGE="spa",URI="audio_spa.m3u8"
...
```

Surround is always extracted from the primary (first) audio stream, since
that's typically the original 5.1 mix. Alternate languages are downmixed
to stereo for consistent bandwidth.

## Language code mapping

ffprobe reports languages as ISO 639-2 (3-letter) codes in `tags.language`.
The master playlist's `LANGUAGE=` attribute uses the same code.

Display names for the player menu are mapped client-side:

| ISO 639-2 | Display name |
|-----------|-------------|
| eng | English |
| spa | Spanish |
| fra / fre | French |
| deu / ger | German |
| ita | Italian |
| jpn | Japanese |
| kor | Korean |
| zho / chi | Chinese |
| rus | Russian |
| por | Portuguese |
| ara | Arabic |
| hin | Hindi |
| ben | Bengali |
| ... 15+ more |

Missing/unknown codes: shown as the uppercase 3-letter code (e.g., `GLV`)
or "Audio" for `und` (undetermined).

## Duplicate language handling

If the source has two tracks with the same language (common for commentary tracks):

```
Stream #0:1  Audio (AAC, language=eng)   ← primary
Stream #0:2  Audio (AAC, language=eng)   ← tagged "Director's Commentary"
```

The worker produces:
- Primary (muxed): `NAME="English"`
- Alternate: `audio_eng_2.m3u8` with `NAME="Director's Commentary"` (from `tags.title`)

Tags get numeric suffixes (`eng_2`, `eng_3`, ...) to avoid filename collisions.

## Player behavior

Zero new code. The existing audio-track selector (built for 5.1 surround
support) handles multi-language automatically:

1. HLS.js parses `#EXT-X-MEDIA:TYPE=AUDIO` tags from the master playlist
2. Fires `Hls.Events.AUDIO_TRACKS_UPDATED` with the list
3. Existing `buildAudioMenu()` in `player/player.js` renders them

Users see an audio-track button in the player controls when 2+ audio
renditions exist. Clicking it shows the list with language names.

## Limitations (Option A scope)

This is **Option A** from the planning — auto-detect only. Not included:

| Missing | Why |
|---------|-----|
| Manual upload of extra audio tracks | Requires upload UI + storage plumbing |
| Per-track bitrate config | All alt tracks use the global `encoding_audio_bitrate` |
| AC3 5.1 for alternate languages | Only primary gets surround (simpler, less storage) |
| Editing language tags after upload | Re-upload source with correct tags instead |
| Deselecting specific tracks | All detected tracks are encoded |

These can be added later as Option B if users need them.

## Storage impact

Each alternate track adds approximately:
- 96 kbps AAC × video duration = small overhead
- 10-min video with 3 alternate languages: ~22 MB extra (at 128 kbps each)
- Same pattern as existing 5.1 AC3 surround rendition

## Failure handling

If encoding a specific language track fails (rare — usually a source codec
quirk), the worker logs a warning and continues with remaining tracks:

```
[worker] abc123: alt audio track spa failed (non-fatal): Error message
[worker] abc123: encoding alt audio track #3 (lang=fra, ch=2) as audio_fra.m3u8
[worker] abc123: AC3 5.1 rendition complete
```

The video is still playable — just missing that one language. The master
playlist only references tracks that succeeded.

## Testing with a sample file

To create a test source file with multiple audio tracks:

```bash
# Combine a video with 3 audio files, each tagged with a language
ffmpeg -i video.mp4 -i audio_en.m4a -i audio_es.m4a -i audio_fr.m4a \
  -map 0:v -map 1:a -map 2:a -map 3:a \
  -metadata:s:a:0 language=eng \
  -metadata:s:a:1 language=spa \
  -metadata:s:a:2 language=fra \
  -c copy multi-lang-test.mkv
```

Upload to the platform → worker auto-detects and produces per-language HLS.

## Learn more

- [FFmpeg Language Metadata Wiki](https://wiki.multimedia.cx/index.php/FFmpeg_Metadata) — how language tags are stored
- [FFmpeg -map Documentation](https://trac.ffmpeg.org/wiki/Map) — the flag that selects specific streams
- [Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) — `#EXT-X-MEDIA` requirements for Apple devices
- [ISO 639-2 Language Codes](https://www.loc.gov/standards/iso639-2/php/code_list.php) — the official code list
- [FFmpeg HLS Multiple Audio (Martin Riedl)](https://www.martin-riedl.de/2020/05/31/using-ffmpeg-as-a-hls-streaming-server-part-9-multiple-audio-languages/) — blog walkthrough of the technique
