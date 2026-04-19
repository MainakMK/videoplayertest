# Video Codec Selector (H.264 / H.265 / AV1) Guide

> **Status**: Implemented. This document explains the codec options, trade-offs,
> browser compatibility, and FFmpeg internals behind each codec.

## Overview

The codec selector lets admins choose which video codec the worker uses:

| Codec | FFmpeg encoder | File size | Encode speed | Browser coverage |
|-------|---------------|-----------|-------------|-----------------|
| **H.264** | `libx264` | Baseline (1.0x) | Fast (1x) | ~100% |
| **H.265** (HEVC) | `libx265` | 30-50% smaller (0.6x) | 3-5x slower | ~70% |
| **AV1** | `libsvtav1` | 40-60% smaller (0.5x) | 5-20x slower | ~80% |

Default is **H.264** — universal compatibility. Only switch to H.265/AV1 if
you understand the compatibility and speed trade-offs.

## Browser compatibility

| Codec | Chrome | Firefox | Safari | Edge | iOS Safari | Android Chrome |
|-------|--------|---------|--------|------|------------|---------------|
| H.264 | All | All | All | All | All | All |
| H.265 | 105+ | **None** | 13+ | 79+ | 11+ | 108+ (partial) |
| AV1 | 70+ | 67+ | 17+ | 79+ | 17+ | 108+ |

Sources: [caniuse.com/hevc](https://caniuse.com/hevc), [caniuse.com/av1](https://caniuse.com/av1)

### Key takeaways
- **H.265**: Safari and Chrome work; **Firefox does NOT support H.265 at all**.
  Users on Firefox will see a black screen or error.
- **AV1**: Broad modern browser support, but older devices lack hardware decode
  (CPU decode is possible but battery-intensive on mobile).
- **H.264**: The only codec that works everywhere. Recommended default.

## How it works

### FFmpeg command differences

**H.264** (current default):
```
ffmpeg -i input.mp4 -c:v libx264 -preset veryfast ...
  -hls_segment_type mpegts -hls_segment_filename 1080p_%03d.jpeg
```

**H.265** (HEVC):
```
ffmpeg -i input.mp4 -c:v libx265 -tag:v hvc1 -preset veryfast ...
  -hls_segment_type mpegts -hls_segment_filename 1080p_%03d.jpeg
```
Note: `-tag:v hvc1` is required for Apple HLS compatibility. Without it, Safari
refuses to play HEVC HLS streams.

**AV1** (SVT-AV1):
```
ffmpeg -i input.mp4 -c:v libsvtav1 ...
  -hls_segment_type fmp4 -hls_segment_filename 1080p_%03d.m4s
```
Note: AV1 **cannot use MPEG-TS** — must use fMP4 (`-hls_segment_type fmp4`).
Segments have `.m4s` extension and there's an `init.mp4` init segment.

### Container format

| Codec | Container | Segment extension | Init segment |
|-------|-----------|-------------------|-------------|
| H.264 | MPEG-TS | `.jpeg` (obfuscated) | None |
| H.265 | MPEG-TS | `.jpeg` (obfuscated) | None |
| AV1 | fMP4 (CMAF) | `.m4s` | `init.mp4` |

### Clone (stream-copy) support

The "Clone Top Quality" feature now works across all codecs:

| Source codec | Target setting | Can clone? | Bitstream filter |
|-------------|---------------|------------|-----------------|
| H.264 | h264 | Yes | `h264_mp4toannexb` |
| HEVC | h265 | Yes | `hevc_mp4toannexb` |
| AV1 | av1 | Yes | None (fMP4 native) |
| H.264 | h265 | **No** (codec mismatch) | — |
| HEVC | h264 | **No** (codec mismatch) | — |

Clone only works when source and target codec **match**. Cross-codec cloning
requires re-encoding, which the worker does automatically as a fallback.

### Master playlist CODECS attribute

The master playlist now includes a `CODECS` attribute in every
`#EXT-X-STREAM-INF` line, signaling to the player which codec is used:

```
#EXT-X-STREAM-INF:BANDWIDTH=3628000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p.m3u8
```

| Codec | CODECS value |
|-------|-------------|
| H.264 | `avc1.640028,mp4a.40.2` |
| H.265 | `hvc1.1.6.L93.B0,mp4a.40.2` |
| AV1 | `av01.0.04M.08,mp4a.40.2` |

This helps HLS players (including Safari) determine if they can play the stream
before downloading any segments.

## Estimated Impact panel

The dashboard's Estimated Impact section applies a codec multiplier to all
file size estimates:

- H.264: 1.0x (shown as-is)
- H.265: 0.6x (sizes shown ~40% smaller)
- AV1: 0.5x (sizes shown ~50% smaller)

This reflects that at the same target bitrate, H.265/AV1 produce the same
file size but with better visual quality. In practice, admins who switch
to HEVC/AV1 often also reduce the target bitrate to match H.264's visual
quality at a smaller file size.

## Encoding speed impact

**This is the most important trade-off to communicate to users.**

For a 10-minute 1080p source at `veryfast` preset:

| Codec | Approximate encode time |
|-------|------------------------|
| H.264 | ~2 minutes |
| H.265 | ~6-10 minutes (3-5x) |
| AV1 | ~10-40 minutes (5-20x) |

The worker logs the codec and speed warning on every job:
```
[worker] abc123: encoding with H265 (libx265) — 3-5x slower
```

## Settings

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `encoding_video_codec` | `h264`, `h265`, `av1` | `h264` | Video codec for all new encodes |

The codec setting applies per-job (the worker reads it fresh for every video),
so changing it takes effect on the **next** video without a worker restart.

## SVT-AV1 vs libaom

We use **SVT-AV1** (`libsvtav1`) instead of the reference encoder libaom:
- 2-5x faster encoding at similar quality
- Developed by Intel + Netflix
- Adopted by AOMedia as the official AV1 encoder

SVT-AV1 requires FFmpeg to be compiled with `--enable-libsvtav1`. Most
package-manager FFmpeg builds include it. To check:
```bash
ffmpeg -encoders | grep svtav1
```

## Learn more

- [HEVC browser support (caniuse)](https://caniuse.com/hevc)
- [AV1 browser support (caniuse)](https://caniuse.com/av1)
- [FFmpeg AV1 Encoding Guide](https://trac.ffmpeg.org/wiki/Encode/AV1) — FFmpeg Wiki
- [HEVC/H.265 Encoding (ORI Guidelines)](https://academysoftwarefoundation.github.io/EncodingGuidelines/EncodeHevc.html)
- [AV1 Encoding Optimization Guide](https://www.probe.dev/resources/av1-encoding-optimization-guide) — Probe
- [Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) — codec signaling requirements
- [HEVC in SRS](https://ossrs.net/lts/en-us/docs/v6/doc/hevc) — practical HEVC HLS setup
- [Playing H.265 (Flussonic)](https://flussonic.com/doc/video-playback/playing-h-265/) — real-world HEVC playback guide
