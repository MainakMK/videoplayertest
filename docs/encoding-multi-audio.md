# Multi-codec Audio (5.1 Surround + Stereo) Guide

> **Status**: Implemented. This document explains how the multi-audio feature
> works, when to use it, and how HLS delivers multiple audio tracks.

## What it does

When **Audio Mode** is set to **Surround** in Settings > Encoding, the worker
produces TWO audio tracks for every video whose source has 5.1+ channels:

1. **Stereo AAC** (default) — muxed into every video variant. Works on all
   devices. This is the existing behavior.
2. **5.1 AC3 surround** (alternate) — a separate audio-only HLS rendition
   (`audio_ac3.m3u8` + segments). Declared via `#EXT-X-MEDIA:TYPE=AUDIO` in
   the master playlist.

The player (HLS.js) discovers both tracks from the manifest and shows an
audio selector button. Users on devices that support surround sound can
switch to the 5.1 track; others stay on stereo automatically.

## How it works in the HLS manifest

```
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Stereo",DEFAULT=YES,
  AUTOSELECT=YES,CHANNELS="2"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="5.1 Surround",DEFAULT=NO,
  AUTOSELECT=NO,CHANNELS="6",URI="audio_ac3.m3u8"

#EXT-X-STREAM-INF:BANDWIDTH=3628000,RESOLUTION=1920x1080,AUDIO="audio"
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2128000,RESOLUTION=1280x720,AUDIO="audio"
720p.m3u8
```

Key points:
- The **Stereo** rendition has no `URI=` — it's muxed into each video
  variant's segments (the default behavior). HLS.js always loads it.
- The **5.1 Surround** rendition has `URI="audio_ac3.m3u8"` — a separate
  audio-only playlist with its own `.jpeg` segments.
- All video variants reference `AUDIO="audio"`, tying them to this group.

## Settings

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `encoding_audio_mode` | `stereo`, `surround` | `stereo` | Whether to produce dual audio tracks |
| `encoding_ac3_bitrate` | 256, 384, 448, 640 | 384 | AC3 5.1 bitrate (kbps) |
| `encoding_audio_bitrate` | 64-256 | 128 | AAC stereo bitrate (existing setting) |

## Smart skip for stereo sources

If the source video has fewer than 6 audio channels (e.g., stereo), the
worker **skips** the AC3 5.1 encoding entirely — upmixing stereo to 5.1
produces fake surround with empty rear channels, wastes disk space, and
provides zero benefit. The master playlist is generated without
`#EXT-X-MEDIA` tags, preserving backward compatibility.

```
[worker] abc123: surround mode enabled but source is 2ch — skipping AC3 5.1
```

## AC3 bitrate guide

| Bitrate | Quality | Use case |
|---------|---------|----------|
| 256k | Good | Streaming-optimized, lower bandwidth |
| **384k** | DVD quality | **Recommended default** — standard for most content |
| 448k | Broadcast | Blu-ray/broadcast standard |
| 640k | Premium | Maximum AC3 quality, highest bandwidth |

## AES encryption

When AES-128 HLS encryption is enabled for a video, the AC3 audio segments
are encrypted with the **same key** as the video segments. The player fetches
the key once and uses it for both video and audio renditions.

## Player behavior

The player uses HLS.js's built-in audio track controller:

1. HLS.js parses `#EXT-X-MEDIA:TYPE=AUDIO` from the master playlist
2. `Hls.Events.AUDIO_TRACKS_UPDATED` fires with the list of audio tracks
3. If there are 2+ tracks, the player shows an audio selector button
4. The user can switch between "Stereo" and "5.1 Surround"
5. HLS.js handles the seamless switch (fetches segments from the alternate
   audio playlist)

On devices that don't support AC3 (most mobile browsers), the player
automatically falls back to the default stereo AAC track.

## File size impact

The AC3 5.1 track adds storage proportional to the audio bitrate:

| Video duration | AC3 384k overhead |
|----------------|-------------------|
| 5 min | ~14 MB |
| 30 min | ~86 MB |
| 2 hours | ~346 MB |

This is in addition to the existing video + AAC stereo storage.

## Learn more

- [Using FFmpeg as a HLS Streaming Server — Multiple Audio Languages](https://www.martin-riedl.de/2020/05/31/using-ffmpeg-as-a-hls-streaming-server-part-9-multiple-audio-languages/) — Martin Riedl
- [HLS Packaging using FFmpeg](https://ottverse.com/hls-packaging-using-ffmpeg-live-vod/) — OTTVerse
- [Apple HLS Authoring Specification](https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices) — Section on alternate renditions
- [AWS HLS Audio Rendition Groups Sample Manifest](https://docs.aws.amazon.com/elemental-live/latest/ug/hls-rendition-groups-sample-manifest.html) — AWS Elemental
- [Delivering Premium HLS Audio Experiences](https://bitmovin.com/blog/premium-hls-audio/) — Bitmovin
- [HLS Multiple Audio Tracks Demo](https://bitmovin.com/demos/multi-audio-tracks/) — Bitmovin (live demo)
