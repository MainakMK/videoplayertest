# Extra FFmpeg Parameters (Power User Escape Hatch)

> **Status**: Implemented. This document explains the escape hatch, what you
> can put in it, security guardrails, and common recipes.

## What it does

A free-text field in **Settings > Encoding** where admins type raw FFmpeg
flags. Whatever you type gets appended to every `transcodeToHLS` command
after all built-in options. This lets power users access the hundreds of
FFmpeg parameters that aren't exposed in the UI — without waiting for a
new setting to be built.

```
Built-in command (from your settings):
ffmpeg -i input.mp4 -c:v libx264 -preset veryfast -b:v 3500k -c:a aac
       -b:a 128k -g 60 -keyint_min 60 -sc_threshold 0 -f hls ...

With extra params "-tune film -profile:v high":
ffmpeg -i input.mp4 -c:v libx264 -preset veryfast -b:v 3500k -c:a aac
       -b:a 128k -g 60 -keyint_min 60 -sc_threshold 0 -f hls ...
       -tune film -profile:v high
```

## Settings

| Key | Type | Default | Max |
|-----|------|---------|-----|
| `encoding_extra_ffmpeg_params` | string | `''` (empty) | 500 chars |

The setting is stored as a plain string. The worker parses it into
individual flags at encode time using `parseExtraFfmpegParams()`.

## How to use

Enter one flag per line in the textarea:

```
-tune film
-profile:v high
-level 4.1
```

Or on a single line separated by spaces:

```
-tune film -profile:v high -level 4.1
```

Both formats work. The parser groups each `-flag` with its following value
(if any).

## Common recipes

### Content tuning (H.264 / H.265)

| Recipe | What it does | Best for |
|--------|-------------|----------|
| `-tune film` | Optimizes for high-detail film grain | Movies, cinematic content |
| `-tune animation` | Optimizes for flat areas + sharp edges | Anime, cartoons, screen recordings |
| `-tune grain` | Preserves film grain instead of smoothing | Archival footage, old films |
| `-tune zerolatency` | Fastest possible encode, minimal buffering | Near-live re-encoding |
| `-tune stillimage` | Optimizes for slideshows / mostly-static video | Presentations, lectures |

### Quality control

| Recipe | What it does |
|--------|-------------|
| `-crf 23` | Switches from target-bitrate to constant-quality mode. Lower = better quality, bigger files. Range: 0-51, default ~23 |
| `-crf 18 -maxrate 5M -bufsize 10M` | CRF with a bitrate cap — quality-based but won't exceed 5 Mbps |
| `-maxrate 5M -bufsize 10M` | Adds a bitrate ceiling to the existing target-bitrate mode |
| `-qmin 10 -qmax 42` | Constrains the quantizer range (advanced quality control) |

### Profile & compatibility

| Recipe | What it does |
|--------|-------------|
| `-profile:v high` | H.264 High profile — better compression, most modern devices support it |
| `-profile:v main` | H.264 Main profile — wider compatibility (older devices, some set-top boxes) |
| `-profile:v baseline` | H.264 Baseline profile — maximum compatibility (very old devices, feature phones) |
| `-level 4.1` | Sets H.264 level — controls max resolution + bitrate per spec. Needed for broadcast compliance |
| `-pix_fmt yuv420p` | Forces YUV 4:2:0 color space — maximum player compatibility |

### Audio processing

| Recipe | What it does |
|--------|-------------|
| `-af loudnorm` | EBU R128 loudness normalization — consistent volume across videos |
| `-af "aresample=48000"` | Force audio sample rate to 48kHz |
| `-af "volume=1.5"` | Boost audio volume by 50% |

### Video processing

| Recipe | What it does |
|--------|-------------|
| `-vf "yadif"` | Deinterlace interlaced TV content |
| `-movflags +faststart` | Move metadata to front of file (progressive download) |

### Codec-specific (H.265)

| Recipe | What it does |
|--------|-------------|
| `-x265-params "no-sao=1"` | Disable SAO filter — faster decode, slightly larger files |
| `-x265-params "bframes=4"` | More B-frames — better compression, slower encode |

### Codec-specific (AV1 / SVT-AV1)

| Recipe | What it does |
|--------|-------------|
| `-svtav1-params "tune=0"` | Visual quality tuning mode |
| `-svtav1-params "film-grain=8"` | Film grain synthesis (preserves grain without encoding it) |

## Where extra params are applied

| Function | Extra params? | Why |
|----------|:------------:|-----|
| `transcodeToHLS()` | **Yes** | Main encoding path — this is where FFmpeg re-encodes video |
| `cloneToHLS()` | No | Uses `-c:v copy` (no re-encoding). Video params like `-tune` are meaningless with copy mode |
| `encodeAudioOnly()` | No | Audio-only pass (AC3 5.1). Video params don't apply |

## Security guardrails

### Blocked flags

These flags are rejected with a clear error:

| Flag | Why blocked |
|------|-----------|
| `-i` | Can read any file on the server as FFmpeg input |
| `-y` | Silently overwrites output files without confirmation |
| `-filter_script` | Reads a filter graph from an arbitrary file path |
| `-dump` | Dumps raw packet data to stdout (information leak) |

Reference: [Jellyfin argument injection advisory (GHSA-866x-wj5j-2vf4)](https://github.com/jellyfin/jellyfin/security/advisories/GHSA-866x-wj5j-2vf4)

### Shell character stripping

These characters are silently removed before saving:

```
; | & ` $ \ ! { } ( )
```

fluent-ffmpeg uses `child_process.spawn()` (not `exec()`), so shell
injection is already impossible at the OS level. Stripping these characters
is defense-in-depth — there's no legitimate FFmpeg flag that uses them.

### Other protections

| Protection | How |
|-----------|-----|
| Max 500 characters | Prevents accidental paste of scripts |
| Admin-only access | `requireMinRole('admin')` on the settings route |
| Case-insensitive blocking | `-I`, `-DUMP`, `-Filter_Script` are all caught |
| Safe failure | Bad params → FFmpeg error → video status='error' → no data loss |
| Logged | Worker prints extra params on every job for debugging |

## What happens when encoding fails

If you enter invalid parameters, FFmpeg will reject them and the video will
get `status='error'`. The error message from FFmpeg tells you exactly what
went wrong. To fix:

1. Go to **Settings > Encoding**
2. Check the Extra FFmpeg Parameters field
3. Remove or fix the bad parameter
4. Re-upload the video

The error does NOT corrupt any data, crash the server, or affect other
videos. Only the specific video being encoded fails.

## Parser behavior

The parser splits your input into individual FFmpeg options:

```
Input:  "-tune film -profile:v high -level 4.1"
Parsed: ["-tune film", "-profile:v high", "-level 4.1"]
```

Rules:
- Each `-flag` starts a new option
- One following non-dash word is absorbed as the value (e.g., `-tune film`)
- Words without a leading `-` are ignored (garbage filtering)
- Empty input → no extra params (zero-cost, existing behavior unchanged)

## Learn more

### FFmpeg encoding references
- [FFmpeg H.264 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.264) — complete `-tune`, `-profile`, `-preset` reference
- [FFmpeg H.265 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/H.265) — HEVC-specific parameters
- [FFmpeg AV1 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/AV1) — SVT-AV1 parameters
- [FFmpeg Filtering Guide](https://trac.ffmpeg.org/wiki/FilteringGuide) — `-vf` and `-af` filters

### Security references
- [Jellyfin FFmpeg Argument Injection (GHSA-866x-wj5j-2vf4)](https://github.com/jellyfin/jellyfin/security/advisories/GHSA-866x-wj5j-2vf4) — real-world advisory that informed our blocklist
- [Snyk: Command Injection in extra-ffmpeg](https://security.snyk.io/vuln/SNYK-JS-EXTRAFFMPEG-607911) — why shell metacharacter stripping matters
- [FFmpeg Security Page](https://www.ffmpeg.org/security.html) — official CVE tracking
