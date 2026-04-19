# Rate Control (ABR vs Constrained VBR) Guide

> **Status**: Implemented. This document explains the two rate control modes,
> when to use each, and how the maxrate/bufsize ratios work.

## What it does

Rate control determines how FFmpeg distributes bits across scenes:

- **ABR (Average Bitrate)** — the default. FFmpeg targets the exact bitrate
  you set (e.g., 3500k for 1080p). Simple, predictable file sizes, but
  quality can drop on complex scenes because it can't spend more bits.

- **Constrained VBR** — adds `-maxrate` and `-bufsize` alongside `-b:v`.
  FFmpeg still targets the average bitrate but CAN spike up to maxrate on
  complex scenes (explosions, fast motion, dark scenes) and save bits on
  simple scenes (talking heads, static shots). Better quality per bit.

## The FFmpeg commands

### ABR mode (current default)
```
ffmpeg -i input.mp4 -b:v 3500k ...
```
That's it — just the target bitrate. No cap, no buffer.

### Constrained VBR mode
```
ffmpeg -i input.mp4 -b:v 3500k -maxrate 5250k -bufsize 7000k ...
```
- `-maxrate 5250k` — peak cap. FFmpeg can temporarily spike to 5250k on
  complex scenes but must stay below this ceiling.
- `-bufsize 7000k` — VBR buffer window. Controls how aggressively FFmpeg
  can vary the bitrate within a time window. Larger = more freedom to
  spike, smaller = more consistent (closer to CBR).

## Settings

| Key | Values | Default | Description |
|-----|--------|---------|-------------|
| `encoding_rate_control` | `abr`, `constrained_vbr` | `abr` | Rate control mode |
| `encoding_maxrate_ratio` | 1.0 - 3.0 | 1.5 | maxrate = target bitrate x this |
| `encoding_bufsize_ratio` | 1.0 - 4.0 | 2.0 | bufsize = target bitrate x this |

## Ratio examples

With default ratios (1.5x maxrate, 2.0x bufsize):

| Quality | Target bitrate | Maxrate (1.5x) | Bufsize (2.0x) |
|---------|---------------|----------------|----------------|
| 2160p (4K) | 14000k | 21000k | 28000k |
| 1440p (2K) | 8000k | 12000k | 16000k |
| 1080p (Full HD) | 3500k | 5250k | 7000k |
| 720p (HD) | 2000k | 3000k | 4000k |
| 480p (SD) | 1000k | 1500k | 2000k |
| 360p (Low SD) | 600k | 900k | 1200k |
| 240p (Mobile) | 300k | 450k | 600k |

## Choosing ratios

### Maxrate ratio (peak cap)

| Ratio | Trade-off | Best for |
|-------|-----------|----------|
| 1.0x | No headroom — same as ABR | Not useful (use ABR mode instead) |
| **1.5x** | **Standard** — 50% headroom for spikes | **General streaming (recommended)** |
| 2.0x | More headroom — better quality on complex scenes | High-action content (sports, gaming) |
| 3.0x | Very permissive — large spikes allowed | Premium quality, bandwidth not a concern |

### Bufsize ratio (VBR buffer)

| Ratio | Trade-off | Best for |
|-------|-----------|----------|
| 1.0x | Tight buffer — almost CBR-like | Bandwidth-constrained networks |
| **2.0x** | **Standard** — good balance of quality and consistency | **General streaming (recommended)** |
| 3.0x | Loose buffer — more bitrate variance | Long-form content, quality-focused |
| 4.0x | Very loose — maximum quality variance | Premium/archival, high bandwidth |

## What the industry uses

| Platform | Mode | Maxrate | Bufsize | Source |
|----------|------|---------|---------|--------|
| Netflix | Constrained VBR | 1.5x | 2.0x | Public engineering talks |
| YouTube | Constrained VBR | ~1.5x | ~2.0x | Inferred from analysis |
| Twitch | Constrained VBR | 1.5x target | 2x target | Broadcasting docs |
| Apple HLS spec | Recommends maxrate | ≤ 1.5x BANDWIDTH | — | HLS Authoring Spec |
| AWS MediaConvert | Constrained VBR | 1.5x default | 2x default | AWS docs |

## File size impact

Constrained VBR may produce slightly larger files (5-15%) compared to pure
ABR at the same target bitrate, because FFmpeg uses the headroom on complex
scenes. The average bitrate stays the same, but peaks are higher.

In practice, the quality improvement is worth the small size increase —
viewers see fewer artifacts on action scenes, dark scenes, and scene
transitions.

## Where it applies

| Function | Rate control? | Why |
|----------|:------------:|-----|
| `transcodeToHLS()` | **Yes** | Main encoding — this is where FFmpeg rate-controls the video |
| `cloneToHLS()` | No | `-c:v copy` — bitrate comes from the source, no re-encoding |
| `encodeAudioOnly()` | No | Audio-only — video rate control doesn't apply |

## Learn more

- [Understanding Rate Control Modes (x264, x265, vpx)](https://slhck.info/video/2017/03/01/rate-control.html) — Werner Robitza (slhck)
  The definitive guide to ABR, CRF, CBR, constrained VBR, and 2-pass.

- [Fixing Peak Bitrate in HLS](https://www.martin-riedl.de/2018/11/03/using-ffmpeg-as-a-hls-streaming-server-part-7-fixing-peak-bitrate/) — Martin Riedl
  Why maxrate matters specifically for HLS streaming.

- [How to Change Video Bitrate with FFmpeg](https://www.mux.com/articles/change-video-bitrate-with-ffmpeg) — Mux
  Practical examples of `-b:v`, `-maxrate`, `-bufsize` combinations.

- [Creating a Production-Ready Multi Bitrate HLS VOD Stream](https://medium.com/@peer5/creating-a-production-ready-multi-bitrate-hls-vod-stream-dff1e2f1612c) — Peer5
  End-to-end HLS setup including rate control.

- [Bitrate Control (Chapter 4)](https://streaminglearningcenter.com/wp-content/uploads/2018/08/Chapter4_BitrateControl.pdf) — Streaming Learning Center
  Academic-level deep dive into VBV, CBR, VBR, and constrained VBR.
