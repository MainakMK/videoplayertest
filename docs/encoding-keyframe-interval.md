# Keyframe Interval (GOP Size) Guide

> **Status**: Implemented. This document explains what the keyframe interval
> setting does, why it matters, and what values to use.

## What is a keyframe?

A **keyframe** (also called an I-frame or IDR frame) is a video frame that
contains the complete image data — no references to other frames. All the
frames between two keyframes (P-frames and B-frames) store only the
**differences** from the previous frame, which is how video compression
achieves 50-100x size reduction.

The **keyframe interval** (or **GOP size** — Group of Pictures) controls how
often the encoder inserts these full-image frames.

```
Keyframe    Delta frames         Keyframe    Delta frames         Keyframe
  [I]  →  [P][B][P][B][P][B]  →   [I]  →  [P][B][P][B][P][B]  →   [I]
  ←─── GOP (e.g., 2 seconds) ───→  ←─── GOP (e.g., 2 seconds) ───→
```

## Why it matters for HLS

1. **Every HLS segment MUST start on a keyframe.** If a segment begins with a
   delta frame, the player can't decode it — it needs the previous keyframe
   which is in a different segment. This causes visual corruption or black
   frames.

2. **Seek accuracy** — when a viewer clicks the seekbar, the player jumps to
   the nearest keyframe. If keyframes are 4 seconds apart, seeking can be
   off by up to 4 seconds. With 2-second keyframes, the worst-case seek
   error is 2 seconds.

3. **Quality-adaptive switching** — ABR players can only switch quality at
   segment boundaries (which start on keyframes). More keyframes = more
   opportunities for the player to adapt to network conditions.

4. **File size** — keyframes are 5-10x larger than delta frames. More
   keyframes = bigger files at the same visual quality. This is the main
   trade-off.

## The math

The keyframe interval is configured in **seconds**, and the actual
`-g` value (in frames) is auto-derived from the source's framerate:

```
-g = round(fps × keyframe_seconds)
```

| Source FPS | Keyframe = 1s | Keyframe = 2s | Keyframe = 4s |
|------------|---------------|---------------|---------------|
| 24 fps     | `-g 24`       | `-g 48`       | `-g 96`       |
| 30 fps     | `-g 30`       | `-g 60`       | `-g 120`      |
| 60 fps     | `-g 60`       | `-g 120`      | `-g 240`      |

Previously the worker used a hardcoded `-g 48`, which only aligned correctly
with 24 fps sources. For 60 fps content this produced keyframes every 0.8s
(wasteful, ~15-20% bigger files). The auto-derived approach produces the
correct interval regardless of source framerate.

## Recommended values

| Value | Best for | Seek accuracy | File size impact | Notes |
|-------|----------|---------------|------------------|-------|
| **1s** | Sports, gaming, scrubbing-heavy UIs | Excellent | +15-25% larger | Most keyframes; best seek + ABR switching |
| **2s** | General use (recommended) | Good | Baseline | Apple HLS spec recommendation; YouTube default |
| **3s** | Long-form content (lectures, podcasts) | Acceptable | -8% smaller | Fewer keyframes; slower ABR switching |
| **4s** | Maximum compression | Poor | -15% smaller | Seek can feel sluggish; matches segment duration |

**Default: 2 seconds** — matches Apple's HLS Authoring Specification and is
the most widely used value across the industry.

## What the big platforms use

| Platform | Keyframe interval | Segment duration | Source |
|----------|-------------------|------------------|--------|
| YouTube | 2s (required for live; recommended for VOD) | 2-5s | YouTube Live docs |
| Apple (HLS spec) | 2s ("SHOULD be present every two seconds") | 6s | Apple HLS Authoring Spec |
| Netflix | 2s (with per-title tuning) | 4-6s | Internal; known from public talks |
| Twitch | 2s | 2s | Twitch broadcasting docs |
| AWS MediaConvert | 2s (default) | 6s | AWS docs |

## Relationship with segment duration

The keyframe interval **MUST divide evenly** into the segment duration.

```
Segment = 4 seconds
Keyframe = 2 seconds  →  2 keyframes per segment  ✓ (perfect)
Keyframe = 1 second   →  4 keyframes per segment  ✓ (works, larger files)
Keyframe = 3 seconds  →  1.33... keyframes         ⚠ (misaligned — bad!)
```

The worker automatically enforces this: `-sc_threshold 0` forces FFmpeg to
place keyframes at exactly the configured interval (no scene-change
disruption), and `-keyint_min` prevents the encoder from inserting extra
keyframes between the fixed ones.

## Technical implementation

```js
// In worker.js (transcodeToHLS):
// fps is probed via ffprobe, keyframeSeconds comes from settings
const keyframeInterval = Math.round(fps * keyframeSeconds);

opts.push(`-g ${keyframeInterval}`);          // max GOP size
opts.push(`-keyint_min ${keyframeInterval}`);  // prevent shorter GOPs
opts.push('-sc_threshold 0');                  // disable scene-change keyframes
```

Note: `cloneToHLS` (stream-copy mode) cannot change keyframes because it
doesn't re-encode the video track. The keyframes are whatever the source
already has. This is expected — if clone is active, the source was already
H.264 at the right resolution, and its existing keyframe cadence is
preserved.

## Learn more

### Articles (recommended reading order)

1. **"Set I-frame Interval in Seconds, Not Frames"** — Jan Ozer
   (Streaming Learning Center)
   - Explains exactly why hardcoding `-g 48` is wrong for variable-fps sources
   - https://streaminglearningcenter.com/blogs/lesson-of-the-week-set-i-frame-interval-in-seconds-not-frames.html

2. **"What's the Right Keyframe Interval?"** — Jan Ozer
   - Comprehensive analysis with quality/size data at different intervals
   - https://streaminglearningcenter.com/blogs/whats-the-right-keyframe-interval.html

3. **"Real-World Perspectives on Choosing the Optimal GOP Size"** — Jan Ozer
   - Tests 13 files across genres at intervals from 0.5s to 20s
   - https://streaminglearningcenter.com/encoding/real-world-perspectives-on-choosing-the-optimal-gop-size.html

4. **"Open and Closed GOPs — All You Need to Know"** — Jan Ozer
   - Why HLS requires closed GOPs and how to enforce them in FFmpeg
   - https://streaminglearningcenter.com/blogs/open-and-closed-gops-all-you-need-to-know.html

5. **"Choosing the Optimal Segment Duration"** — Streaming Learning Center
   - How segment duration interacts with keyframe interval
   - https://streaminglearningcenter.com/learning/choosing-the-optimal-segment-duration.html

6. **"Optimal Adaptive Streaming Formats: MPEG-DASH & HLS Segment Length"** — Bitmovin
   - Industry data on segment + keyframe sweet spots
   - https://bitmovin.com/blog/mpeg-dash-hls-segment-length/

7. **"How to Set the Right Keyframe Interval for Streaming"** — Gumlet
   - Practical guide with visual diagrams
   - https://www.gumlet.com/learn/keyframe-interval/

8. **"HLS Streaming, Keyframes, Scene-Cut & GOP"** — Flaeri's Tech Talk
   - Deep dive into `-sc_threshold`, `-g`, and `-keyint_min` interaction
   - https://blog.otterbro.com/hls-streaming-keyframes-and-scenecut/

### Official specifications

- **Apple HLS Authoring Specification** — the canonical spec (Section 1.10: "Use 2-second keyframes")
  https://developer.apple.com/documentation/http-live-streaming/hls-authoring-specification-for-apple-devices

- **FFmpeg H.264 Encoding Guide** — `-g`, `-keyint_min`, preset interactions
  https://trac.ffmpeg.org/wiki/Encode/H.264

- **AWS Elemental — GOP Configuration** — production-grade GOP advice
  https://docs.aws.amazon.com/elemental-live/latest/ug/vq-gop.html

### Video resources

Search YouTube for: **"keyframe interval streaming encoding explained"**
or **"GOP size HLS"** — the topic is well covered by channels like:
- **Streaming Media** — Jan Ozer's conference talks
- **Bitmovin** — technical webinars on ABR encoding
- **Mux** — "Demuxed" conference recordings

### Further reading

- **"The Definitive Guide for Picking a Fragment Length"** — Zattoo Tech Blog (Medium)
  https://medium.com/zattoo_tech/the-definitive-guide-for-picking-a-fragment-length-617f75b9ccf3

- **"Keyframe Interval"** — Cloudinary Glossary (quick visual reference)
  https://cloudinary.com/glossary/keyframe-interval
