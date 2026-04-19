# Encoding System Guide

> Complete technical reference for the **video encoding system** — every setting,
> every trade-off, every "why we chose X." This is the canonical doc for
> understanding how a video flows from upload to playable HLS.

For the **worker restart flow specifically** (graceful shutdown, exits/respawns),
see [`worker-restart-guide.md`](./worker-restart-guide.md).

---

## Table of contents

1. [The big picture](#the-big-picture)
2. [How a video gets encoded — full pipeline](#how-a-video-gets-encoded--full-pipeline)
3. [Bitrate explained (the most important setting)](#bitrate-explained-the-most-important-setting)
4. [FFmpeg preset explained](#ffmpeg-preset-explained)
5. [Why we use target-bitrate mode (`-b:v`) not CRF](#why-we-use-target-bitrate-mode--bv-not-crf)
6. [HLS chunk size — never affected by encoding settings](#hls-chunk-size--never-affected-by-encoding-settings)
7. [Quality variants and why we have 4](#quality-variants-and-why-we-have-4)
8. [Quality preset tiers (Premium / Balanced / Optimized)](#quality-preset-tiers-premium--balanced--optimized)
9. [Encoding time per preset (full table)](#encoding-time-per-preset-full-table)
10. [Storage cost projections at scale](#storage-cost-projections-at-scale)
11. [Concurrency: quality variants + videos in parallel](#concurrency-quality-variants--videos-in-parallel)
12. [Why we removed auto-detect (and what happens on Bunny MC)](#why-we-removed-auto-detect-and-what-happens-on-bunny-mc)
13. [Per-quality file size breakdown](#per-quality-file-size-breakdown)
14. [What changes vs what stays the same](#what-changes-vs-what-stays-the-same)
15. [Architecture & code references](#architecture--code-references)
16. [Defaults and why we picked them](#defaults-and-why-we-picked-them)

---

## The big picture

The encoding system has 3 things you can control, with very different impacts:

| Control | Affects | Magnitude |
|---------|---------|-----------|
| **Bitrate** | File size + visual quality | 🔥🔥🔥 The main lever |
| **FFmpeg preset** | Encoding speed + tiny quality polish | 🔥 Minor (2–3% size) |
| **Concurrency** | Server CPU usage + throughput | 🔥🔥 Major for ops |

If you only learn one thing: **bitrate is the dominant setting**. Preset and
concurrency are tuning knobs.

---

## How a video gets encoded — full pipeline

Every uploaded video goes through these stages:

```
┌────────────────────────────────────────────────────────┐
│ STAGE 1: MULTER UPLOAD                                 │
│ User uploads file via dashboard                        │
│ → server/uploads/{timestamp}-{originalFilename}        │
│ → INSERT INTO videos (status='uploading')              │
│ → Bull queue.add({ videoId, filePath, ... })           │
└────────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│ STAGE 2: FFMPEG TRANSCODE                              │
│ Worker picks up job from Bull queue                    │
│ → status = 'processing'                                │
│ → mkdir server/uploads/processing/{videoId}/           │
│ → ffprobe to detect source resolution                  │
│ → FOR EACH quality variant ≤ source resolution:        │
│     ffmpeg -i input.mp4 \                              │
│        -c:v h264 \                                     │
│        -preset {ffmpeg_preset} \   ← from settings     │
│        -threads 0 \                                    │
│        -b:v {videoBitrate} \       ← from settings     │
│        -c:a aac \                                      │
│        -b:a {audioBitrate} \       ← from settings     │
│        -hls_time 4 \               ← always 4 seconds  │
│        -hls_segment_type mpegts \                      │
│        -hls_segment_filename {q}_%03d.jpeg \           │
│        {q}.m3u8                                        │
│ → Generate master.m3u8 (combines all quality levels)   │
│ → Generate thumbnail.jpg (at 25% of duration)          │
│ → Generate sprite.jpg + sprite.vtt (for seekbar)       │
└────────────────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────┐
│ STAGE 3: UPLOAD TO STORAGE                             │
│ Read each file in processing dir, upload to:           │
│   - LOCAL: storage/local/videos/{videoId}/hls/...      │
│   - R2:    Bucket key videos/{videoId}/hls/...         │
│ → Set thumbnail_url + sprite_url + qualities + duration│
│ → status = 'ready'                                     │
│ → DELETE temp files (server/uploads/...)               │
│ → triggerWebhooks('video.ready', ...)                  │
└────────────────────────────────────────────────────────┘
```

The whole thing happens in `server/worker.js`, with all encoding parameters
pulled fresh from `server/services/encoding-config.js` on every job.

---

## Bitrate explained (the most important setting)

**Bitrate** = how many bits of data per second of video you're sending.

```
Higher bitrate → more data per second → more detail preserved → bigger files
Lower bitrate  → less data per second → more compression      → smaller files
```

### Why bitrate matters more than anything else

Imagine you're writing a story:

- **Preset** = how good a writer you are
- **Bitrate** = how many pages you have to write the story in

Even the world's best writer (slowest preset) can't fit a novel into 5 pages.
They just don't have the room.

```
1080p video at 3500k:
  ──► Encoder has 3500 bits per second to describe each frame
  ──► Plenty for typical content
  ──► Result: clean output

1080p video at 800k:
  ──► Encoder has only 800 bits per second
  ──► Not enough to capture detail in complex scenes
  ──► Result: visible blocking, smearing, fuzzy text
```

### Bitrate ranges per quality (with visual quality assessment)

#### 1080p (1920×1080) — slider range: 800–8000 kbps

| Bitrate | Visual quality | Use case |
|---------|---------------|----------|
| 800 kbps | 🔴 Bad — heavy blocking, fuzzy details | Don't use for 1080p |
| 1500 kbps | 🟡 Acceptable for static content | Slideshows, low-motion |
| 2500 kbps | 🟢 Good — clean for most content | Cost-optimized tier |
| **3500 kbps** ✅ | 🟢 Great — clean even for action | **Balanced default** |
| 5000 kbps | 🟢 Excellent — pristine | Premium tier |
| 8000 kbps | 🟢 Overkill for streaming | Cinema-grade source archives |

#### 720p (1280×720) — slider range: 500–4500 kbps

| Bitrate | Visual quality | Use case |
|---------|---------------|----------|
| 500 kbps | 🔴 Mobile-only emergency fallback | |
| 1000 kbps | 🟡 OK for talking heads, not action | |
| 1500 kbps | 🟢 Good for typical content | Cost-optimized |
| **2000 kbps** ✅ | 🟢 Great | **Balanced default** |
| 3000 kbps | 🟢 Excellent | Premium |

#### 480p (854×480) — slider range: 300–2000 kbps

| Bitrate | Visual quality | Use case |
|---------|---------------|----------|
| 300 kbps | 🔴 Bad | |
| 600 kbps | 🟡 Watchable on phones | Cost-optimized |
| **1000 kbps** ✅ | 🟢 Clean | **Balanced default** |
| 1500 kbps | 🟢 Excellent | Premium |

#### 360p (640×360) — slider range: 200–1000 kbps

| Bitrate | Visual quality | Use case |
|---------|---------------|----------|
| 200 kbps | 🔴 Heavy artifacts | |
| 400 kbps | 🟡 Acceptable mobile fallback | Cost-optimized |
| **600 kbps** ✅ | 🟢 Clean | **Balanced default** |

### Visual examples — what each bitrate looks like at 1080p

```
800 kbps:
  ▓▓▒▒▒▒▒░░  Faces look "painterly" or "soft"
             Text becomes fuzzy
             Dark scenes show banding
             Fast motion = mosquito artifacts

2500 kbps:
  ▓▓▓▓▓▓▒▒░  Faces are clear
             Text is readable
             Dark scenes mostly clean
             Fast motion mostly fine

3500 kbps (Balanced default):
  ▓▓▓▓▓▓▓▓░  Everything looks good
             Even action scenes are clean
             Standard for most platforms

5000 kbps:
  ▓▓▓▓▓▓▓▓▓  Pristine — viewers can't tell from source
             Diminishing returns above this
             Use only if you have premium content
```

---

## FFmpeg preset explained

FFmpeg has to make a trade-off when encoding video: **how hard should it work
to make the file small?**

A preset is essentially a "how much effort" knob. They're named confusingly
(they sound like speed words) but here's what they really mean:

| Preset | What FFmpeg does | Effort |
|--------|------------------|--------|
| `ultrafast` | Barely thinks — just dumps the video out | Lowest |
| `superfast` | A little smarter | Low |
| `veryfast` | Some optimization | Medium-low |
| `faster` | More optimization | Medium |
| `fast` | Even more | Medium-high |
| `medium` | Default — balanced effort | High |
| `slow` | Spends time finding patterns | Very high |
| `veryslow` | Tries every possible trick | Maximum |

### Lunchbox analogy

Imagine you're packing a lunchbox with the same food (the video):

| Preset | What you do | Result |
|--------|-------------|--------|
| **ultrafast** | Throw food in randomly | Same food, big messy lunchbox |
| **veryfast** | Stack things a bit | Same food, medium lunchbox |
| **medium** | Carefully arrange everything | Same food, compact lunchbox |
| **veryslow** | Tetris-perfect packing | Same food, tiniest possible lunchbox |

**The food (visual quality) is identical.** Only the lunchbox size (file size)
and packing time (encoding speed) change.

### Why slower presets exist

In **CRF mode** (quality-targeted), slower presets produce **smaller files at the
same quality**. Smaller files mean:
- Less disk space (cheaper storage)
- Less bandwidth when viewers watch (cheaper egress, faster loading)
- Worth spending more CPU upfront if encoded once but watched many times

But we use **target-bitrate mode** instead (next section), so this trade-off
doesn't fully apply to us.

---

## Why we use target-bitrate mode (`-b:v`) not CRF

### Two modes FFmpeg can run in

```
CRF MODE: -crf 23
  Quality is the TARGET
  Bitrate varies by content (high for action, low for static)
  File size varies wildly between presets (15–60% difference)

TARGET BITRATE MODE: -b:v 3500k    ← what we use
  Bitrate is the TARGET
  Quality varies by content
  File size is predictable (always ≈ bitrate × duration)
  Preset has only ~2–3% effect on file size
```

### Why we picked target-bitrate

1. **Predictable file sizes** — easier to estimate storage costs
2. **Consistent HLS segment sizes** — better for streaming on slow networks
3. **Industry standard for adaptive streaming** — YouTube, Netflix, etc. use it
4. **Estimated cost projections actually work** — we can show "$8.27/mo for 1k videos" because file sizes are deterministic

### The trade-off you give up

In our setup, lowering the FFmpeg preset slider (ultrafast → medium) does NOT
significantly reduce file sizes. It only changes:
- Encoding TIME (ultrafast = 12× faster than medium)
- Visual QUALITY at the same bitrate (slightly better with slower presets)

**To shrink files in our system, lower the bitrate sliders — not the preset.**

---

## HLS chunk size — never affected by encoding settings

Hardcoded in `server/worker.js`:

```js
'-hls_time 4',                      // chunks are exactly 4 seconds
'-b:v ${quality.videoBitrate}',     // bitrate is fixed per quality
```

### Math (for a 1080p stream)

```
chunk_size  = duration × bitrate
            = 4 seconds × 3500 kbps
            = 14000 kilobits
            = 1750 kilobytes
            = ~1.7 MB per .jpeg segment
```

Math doesn't care about preset. Period.

### What's locked

| Property | Controlled by | Affected by preset? |
|----------|---------------|---------------------|
| Chunk duration (4 seconds) | `-hls_time 4` | ❌ No |
| Chunk file size | bitrate × duration | ❌ No |
| Number of chunks | source duration / 4 | ❌ No |
| Total output size | bitrate × source duration | ❌ Negligible (2–3%) |
| Visual quality | preset + bitrate | ✅ Yes |
| Encoding time | preset | ✅ Yes (HUGE) |

If you ever want to **change chunk duration**, edit the `-hls_time 4` value
in `server/worker.js`. We hardcoded 4 because:
- Industry standard for HLS
- Good balance between latency (smaller = lower latency) and overhead (smaller = more files)
- Most CDNs are tuned for 2–6 second segments

---

## Quality variants and why we have 4

Every video gets transcoded into 4 quality variants:

| Quality | Resolution | Default video bitrate | Default audio | Per 10-min video |
|---------|-----------|----------------------|---------------|------------------|
| 1080p | 1920×1080 | 3500 kbps | 128 kbps | ~266 MB |
| 720p | 1280×720 | 2000 kbps | 128 kbps | ~156 MB |
| 480p | 854×480 | 1000 kbps | 128 kbps | ~80 MB |
| 360p | 640×360 | 600 kbps | 128 kbps | ~49 MB |

The HLS player automatically picks the right one based on the viewer's
connection speed (adaptive bitrate). All 4 are listed in `master.m3u8`.

### Why these 4 specifically

- **1080p**: HD desktop / TV viewing
- **720p**: Most laptops, modern phones on WiFi
- **480p**: Mobile / weak WiFi
- **360p**: 3G mobile / very slow connections

We don't currently encode **2160p (4K)**, **1440p**, or **240p**. Adding more
variants is an `encoding-config.js` change (see "Architecture & code references").

### Source-resolution filtering

The worker only transcodes qualities **at or below the source resolution**:

```js
const selectedQualities = cfg.qualityPresets.filter(q => q.height <= sourceHeight);
```

So a 720p source produces **720p, 480p, 360p** (no upscale to 1080p). A 4K
source still uses the 1080p quality preset (we don't have 4K output yet).

---

## Quality preset tiers (Premium / Balanced / Optimized)

Three quick-pick cards plus a **Custom** option in the dashboard.

### Exact values per tier

| Setting | Premium ⭐ | **Balanced ✓** (default) | Optimized 💰 |
|---------|-----------|--------------------------|-------------|
| 1080p video | 5000 kbps | **3500 kbps** | 2500 kbps |
| 720p video | 3000 kbps | **2000 kbps** | 1500 kbps |
| 480p video | 1500 kbps | **1000 kbps** | 700 kbps |
| 360p video | 1000 kbps | **600 kbps** | 400 kbps |
| Audio | 192 kbps | **128 kbps** | 96 kbps |
| Per 10-min video (all 4 qualities) | ~825 MB | **~551 MB** | ~395 MB |
| Cost (1k videos / mo on R2) | ~$12.40 | **~$8.27** | ~$5.93 |
| Difference vs Balanced | +50% | baseline | −28% |

### What "Custom" means

If you change ANY slider after picking a tier, the active tier auto-switches
to **Custom**. This way:
- No values are silently overwritten
- You can mix-and-match (e.g., Premium 1080p + Balanced 720p + Optimized lower tiers)
- The dashboard always reflects exactly what's saved

### Tier values are duplicated in two places

Both must stay in sync:
1. **Backend**: `TIER_PRESETS` constant in `server/services/encoding-config.js`
2. **Frontend**: `ENC_TIER_PRESETS` in `dashboard/index.html`

If you change one, change the other.

---

## Encoding time per preset (full table)

For a **10-minute 1080p source video** on a **2-vCPU server**, encoding all 4
quality variants:

| Preset | 1080p time | 480p time | **Total per video** | vs `veryslow` |
|--------|-----------|-----------|---------------------|---------------|
| ultrafast | ~5 min | ~1.5 min | **~7 min** | ⚡⚡⚡ 22× faster |
| superfast | ~6 min | ~2 min | **~8 min** | ⚡⚡ 19× |
| **veryfast** ✅ | ~8 min | ~2.5 min | **~10 min** | ⚡ 15× |
| faster | ~11 min | ~3 min | **~14 min** | 11× |
| fast | ~13 min | ~4 min | **~17 min** | 9× |
| medium | ~20 min | ~6 min | **~26 min** | 6× |
| slow | ~40 min | ~12 min | **~52 min** | 3× |
| veryslow | ~120 min | ~34 min | **~154 min** | 1× (baseline) |

### Throughput per server per day (single video at a time)

| Preset | Videos per day | Use case |
|--------|---------------|----------|
| **veryfast** ✅ | ~144/day | Default — recommended |
| medium | ~55/day | Quality-focused |
| veryslow | ~9/day | Mastering archives |

### File size variance is negligible

Same scenario, file size for the 1080p variant only:

| Preset | 1080p output | Variance from `veryfast` |
|--------|--------------|--------------------------|
| ultrafast | ~270 MB | +1.5% |
| superfast | ~268 MB | +0.7% |
| **veryfast** ✅ | **~266 MB** | baseline |
| faster | ~265 MB | -0.4% |
| fast | ~264 MB | -0.7% |
| medium | ~263 MB | -1.1% |
| slow | ~262 MB | -1.5% |
| veryslow | ~261 MB | -1.9% |

The difference between extremes is only ~3.5%. **Effectively no impact on storage costs.**

### What changes per preset (in our setup)

| Preset | Visual quality at 3500k bitrate | Encoding time |
|--------|--------------------------------|---------------|
| ultrafast | ⚠️ Visible blocking on motion (sports, action, fast pans) | 15 sec |
| superfast | ⚠️ Slight blocking in dark scenes | 22 sec |
| **veryfast** ✅ | ✅ Clean — no visible artifacts for typical content | 45 sec |
| faster | ✅ Slightly cleaner gradients | 1 min |
| fast | ✅ Marginally better motion | 1.5 min |
| medium | ✅ Almost imperceptibly cleaner | 3 min |

So in our case, **slower presets buy you better quality, not smaller files**.

---

## Storage cost projections at scale

Cloudflare R2 pricing reference: **$0.015 per GB-month, 10 GB free, $0 egress**.

### Balanced tier (default — 551 MB per 10-min video)

| Number of videos | Total storage | Monthly R2 cost |
|------------------|---------------|-----------------|
| 100 | 55 GB | ~$0.83 |
| 500 | 275 GB | ~$4.13 |
| 1,000 | 551 GB | ~$8.27 |
| 5,000 | 2.7 TB | ~$41.33 |
| 10,000 | 5.4 TB | ~$82.65 |
| 50,000 | 27 TB | ~$413.25 |
| 100,000 | 54 TB | ~$826.50 |

### Tier comparison at 10,000 videos

| Tier | Total storage | Monthly cost | Annual cost |
|------|---------------|--------------|-------------|
| Premium ⭐ | 8.1 TB | ~$124 | ~$1,488 |
| **Balanced ✓** | **5.4 TB** | **~$82.65** | **~$992** |
| Optimized 💰 | 3.9 TB | ~$59.40 | ~$713 |

### Bandwidth cost? Zero.

R2's killer feature: **no egress fees**. So whether 1 viewer or 1 million view
your videos, you pay $0 in bandwidth — only the storage cost shown above.

This is the dominant saving vs traditional CDNs (where egress at scale could
easily be 10–100× the storage cost).

---

## Concurrency: quality variants + videos in parallel

There are **two independent concurrency settings**. They control different layers.

```
Worker process
 ├── Bull queue          (videos in parallel = N)
 │   └── Job 1
 │       ├── FFmpeg encoding 1080p   (quality variants in parallel = M)
 │       ├── FFmpeg encoding 720p
 │       └── ... etc
 │
 └── Job 2 (only if videos in parallel ≥ 2)
     ├── FFmpeg encoding 1080p
     └── ... etc
```

### Quality variants in parallel (1 / 2 / 3 / 4 / 5)

How many quality levels FFmpeg encodes **at the same time per video**.

```
Setting=2 (default):
  Batch 1: 1080p + 720p in parallel → wait → Batch 2: 480p + 360p
Setting=4:
  All 4 qualities encode simultaneously (faster per video)
```

| Setting | Recommended for | Effect |
|---------|-----------------|--------|
| 1 | 2 vCPU servers | Slowest, lowest CPU |
| **2** ✅ | 2–4 vCPU (default) | Balanced |
| 3 | 6–8 vCPU | Faster per video |
| 4 | 8–12 vCPU | Each variant gets full CPU |
| 5 | 16+ vCPU | All 4 variants in parallel + audio |

**Hot-reloadable** — no restart needed. Reads from DB on every job.

### Videos in parallel (1 / 2 / 4 / 8)

How many separate videos the worker processes **simultaneously**.

```
Setting=1 (default):
  Video A → done → Video B → done → Video C → ...
  Result: each video finishes ~5 min apart
  Trade-off: first videos available SOON

Setting=4:
  Videos A, B, C, D all encoding at once, each takes ~20 min
  Result: all 4 finish around the same time, ~20 min in
  Trade-off: nothing playable until 20 min in
```

**Requires worker restart** — Bull queue concurrency is locked at startup.
Use the **Restart Worker** button (see [`worker-restart-guide.md`](./worker-restart-guide.md)).

### Combined CPU pressure

```
total_ffmpeg_processes = videos_in_parallel × quality_variants_in_parallel
```

Examples:
- `videos=1, quality=2` → 2 FFmpeg processes (current default)
- `videos=1, quality=4` → 4 FFmpeg processes
- `videos=2, quality=2` → 4 FFmpeg processes
- `videos=4, quality=4` → 16 FFmpeg processes (need beefy server)

**Rule of thumb**: each FFmpeg process can use up to a full CPU core. So divide
your total cores by the number of parallel processes you want.

### Why we DON'T parallelism by default

```
              ONE-BY-ONE                    ALL PARALLEL
              ──────────                    ────────────
   Min 5:    1 video ready ✅              0 videos ready
   Min 10:   2 videos ready ✅✅            0 videos ready
   Min 15:   3 videos ready ✅✅✅           0 videos ready
   Min 20:   4 videos ready ✅✅✅✅          0 videos ready
   Min 25:   5 videos ready ✅✅✅✅✅         5 videos ready ✅✅✅✅✅
```

CPU is a fixed-size pie. Parallel doesn't bake more pie — it just slices what
you have differently. Sequential gives you usable videos faster (you can share/
test the first one at minute 5 instead of waiting for all 5 at minute 25).

For pure CPU-bound work like FFmpeg, **sequential is the better default UX**.
Bump the parallelism only if you have spare CPU capacity AND want everything
done together.

---

## Why we removed auto-detect (and what happens on Bunny MC)

Originally we considered auto-detecting CPU cores and recommending concurrency
based on `os.cpus().length`. We removed this because:

### Problem 1: It's pure cosmetic

FFmpeg already detects cores at encoding time via `-threads 0`. The dashboard
displaying "16 cores" doesn't change how FFmpeg behaves — it's just a label.

### Problem 2: Multi-process deployments

If you deploy panel + worker on different machines, `os.cpus()` reads the
WRONG machine. Three deployment scenarios:

```
Scenario A: All-in-one (VPS or dedicated server)
   Single box runs API + DB + Redis + Worker
   os.cpus() ✓ correct

Scenario B: VPS + Bunny MC (split worker)
   ┌────────────┐         ┌────────────┐
   │ VPS        │         │ Bunny MC   │
   │ API + DB   │ ──jobs─►│ Worker     │
   │ os.cpus()=2│         │ os.cpus()=8│
   └────────────┘         └────────────┘
   Dashboard reads VPS cores ❌ wrong (worker is on MC)

Scenario C: Fully distributed
   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Bunny MC │ │ Supabase │ │ Upstash  │ │ Bunny MC │
   │ Panel    │ │ Postgres │ │ Redis    │ │ Worker   │
   └──────────┘ └──────────┘ └──────────┘ └──────────┘
   Each component on different infra
   No way for dashboard to know worker's specs
```

To handle scenario B/C properly, we'd need **worker self-registration with
heartbeat** (separate `workers` table, every worker reports its specs to DB,
dashboard shows multi-worker view). That's substantial complexity for a
purely cosmetic feature.

### Decision: Remove the system info display entirely

- Dashboard never tries to detect CPU
- User picks concurrency manually based on their server size
- The dropdown labels guide them ("recommended for 2–4 vCPU" etc.)
- Works identically across all 3 deployment scenarios

**If you need it later** (e.g., you're running multiple workers on different
boxes and want to monitor them), the architecture for self-registration is
documented in `worker-restart-guide.md` Architecture section — about 30 min
to add.

### What still works automatically

`-threads 0` is set in `server/worker.js`:

```js
'-threads 0',
```

This tells FFmpeg "use as many threads as you can." So **each individual
FFmpeg process WILL spread across multiple cores** at encoding time, regardless
of the dashboard concurrency setting.

This means even on a 16-core server with `quality_concurrency=2`:
- 2 FFmpeg processes run in parallel
- Each one uses ~7-8 cores internally
- All 16 cores get used during encoding

---

## Per-quality file size breakdown

### Math

```
per_variant_MB = (video_bitrate_kbps + audio_bitrate_kbps) × duration_sec / 8 / 1024
```

### For Balanced tier @ 10-minute source

| Quality | Combined bitrate | Per 10-min size |
|---------|------------------|-----------------|
| 1080p | 3628 kbps | 266 MB |
| 720p | 2128 kbps | 156 MB |
| 480p | 1096 kbps | 80 MB |
| 360p | 664 kbps | 49 MB |
| **Total** | | **~551 MB** |

Plus ~50 KB thumbnail + ~500 KB sprite + ~few KB manifests.

### Scaling math

For a different source duration `d` (in seconds), multiply by `d / 600`:

```
20-min source: total ≈ 551 × 2 = ~1.1 GB
60-min source: total ≈ 551 × 6 = ~3.3 GB
```

---

## What changes vs what stays the same

When you tweak settings, here's what's actually affected:

| You change | File size | Encoding time | Visual quality | HLS chunks | Restart needed? |
|-----------|-----------|---------------|----------------|------------|-----------------|
| Bitrate (any quality) | 🔥🔥🔥 Major | Slight | 🔥🔥🔥 Major | Same count, different size | ❌ |
| Audio bitrate | Slight | None | Audio quality only | None | ❌ |
| FFmpeg preset | ~2-3% only | 🔥🔥🔥 Major | Slight | None | ❌ |
| Quality concurrency | None | Faster per video | None | None | ❌ |
| **Videos in parallel** | None | Throughput | None | None | ✅ |
| Tier (Premium/etc.) | Bundle of bitrates | Bundle | Bundle | None | ❌ |

---

## Architecture & code references

### File map

| File | Role |
|------|------|
| `server/worker.js` | The Bull worker process. Reads encoding config per-job, runs FFmpeg, uploads to storage |
| `server/services/encoding-config.js` | Single source of truth for all encoding settings: defaults, validation, tier presets, 10-second cache |
| `server/routes/settings.js` | API endpoints `GET /encoding`, `PUT /encoding`, `/encoding/worker-status`, `/encoding/restart-worker` |
| `dashboard/index.html` | Encoding tab UI + JS handlers (`loadEncodingSettings`, `saveEncodingSettings`, `restartWorker`, etc.) |

### Database keys (all in the existing `settings` table)

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `encoding_preset_tier` | string | `balanced` | `premium` / `balanced` / `optimized` / `custom` |
| `encoding_bitrate_1080p` | int (kbps) | `3500` | 800 – 8000 |
| `encoding_bitrate_720p` | int (kbps) | `2000` | 500 – 4500 |
| `encoding_bitrate_480p` | int (kbps) | `1000` | 300 – 2000 |
| `encoding_bitrate_360p` | int (kbps) | `600` | 200 – 1000 |
| `encoding_audio_bitrate` | int (kbps) | `128` | 64 / 96 / 128 / 192 / 256 |
| `encoding_quality_concurrency` | int | `2` | 1 / 2 / 3 / 4 / 5 |
| `encoding_video_concurrency` | int | `1` | 1 / 2 / 4 / 8 |
| `encoding_ffmpeg_preset` | string | `veryfast` | `ultrafast` / `superfast` / `veryfast` / `faster` / `fast` / `medium` |
| `worker_started_at` | ISO 8601 string | (set by worker on boot) | — |
| `worker_restart_requested_at` | ISO 8601 string | (set by API when button clicked) | — |

### Settings flow at runtime

```
USER CHANGES SETTINGS IN UI
         │
         ▼
PUT /api/settings/encoding (validates + clamps every value)
         │
         ▼
INSERT/UPDATE rows in `settings` table
         │
         ▼
encoding-config.js cache cleared
         │
         ▼
WORKER picks up next video from Bull queue
         │
         ▼
loadEncodingConfig() reads from DB (or 10-second cache)
         │
         ▼
FFmpeg invoked with the new bitrates + preset
         │
         ▼
Next video uses new settings — no restart for most settings
```

### How to add a new quality variant (e.g., 1440p)

Three places to update:

#### 1. Backend: `server/services/encoding-config.js`

```js
// Add to BITRATE_RANGES:
'1440p': { min: 4000, max: 16000, default: 8000 },

// Add to TIER_PRESETS for each tier:
premium:   { ..., bitrate_1440p: 12000 },
balanced:  { ..., bitrate_1440p: 8000 },
optimized: { ..., bitrate_1440p: 5000 },

// Add to qualityPresets in loadEncodingConfig():
{
  name: '1440p', height: 1440,
  videoBitrate: `${cfg.bitrate_1440p}k`,
  audioBitrate: `${cfg.audio_bitrate}k`,
  bandwidth: cfg.bitrate_1440p * 1000 + cfg.audio_bitrate * 1000 + 128000,
  resolution: '2560x1440',
},
```

#### 2. Frontend: `dashboard/index.html`

Add a new bitrate slider HTML block matching the 1080p one. Add 1440p to the
`ENC_TIER_PRESETS` constant.

#### 3. Optional: Audit log labels

If you want pretty labels in the audit log for new settings, add them to the
`ACTION_LABELS` map in `server/routes/audit.js`.

### Required FFmpeg version

Tested with **FFmpeg 6.0+**. Earlier versions may work but aren't tested.

---

## Defaults and why we picked them

### Why `veryfast` is the default preset

For our **target-bitrate** setup, slower presets only buy 2–3% smaller files
but take 6–22× longer. `veryfast` gives us:

- ✅ Fast enough to clear 144 videos/day per worker (on 2-vCPU)
- ✅ Visually clean — no perceptible artifacts at our default bitrates
- ✅ 6× faster than `medium` for nearly identical output

### Why `videos_in_parallel = 1` is the default

CPU pie doesn't grow with parallelism (for pure CPU-bound work). Sequential
encoding makes individual videos available SOONER, which is better UX for
sharing/testing. Only bump this if you have spare CPU AND want everything done
at the same time.

### Why `quality_concurrency = 2` is the default

The most common server tier is 2-vCPU (cheap VPS). With 2 parallel quality
variants, each FFmpeg process gets ~1 core via `-threads 0`. Bigger servers
should bump this to 3–5.

### Why bitrates default to "Balanced" tier

| Tier | Visual quality | Cost (1k videos/mo) |
|------|---------------|---------------------|
| Premium | Pristine | $12.40 |
| **Balanced** ✓ | Clean (most viewers can't tell from Premium) | **$8.27** |
| Optimized | Slightly less detail in dark scenes | $5.93 |

Balanced gives 95% of Premium's quality at 67% of its cost. It's the right
default for the largest range of platforms (course platforms, internal tools,
content creators, etc.). Power users who care can pick Premium or Optimized
based on their priorities.

### Why audio defaults to 128 kbps

128 kbps AAC is the sweet spot:
- ✅ Indistinguishable from source for spoken content
- ✅ Nearly transparent for music (most listeners can't ABX 128 vs lossless)
- ✅ Half the bandwidth of 256 kbps for negligible quality loss

Bumps to 192 kbps (Premium) only for music-heavy content where the tiny
difference matters.

### Why we hardcoded `-hls_time 4`

- Industry standard for HLS chunk size
- Good balance: low enough latency, low enough overhead
- Most CDN configurations are tuned for 2–6 second segments
- Works well across all viewer connection speeds

### Why we use H.264 (`-c:v h264`)

- Universal browser support (no codec problems)
- Hardware decoding on every device
- HEVC/AV1 would save ~30% bitrate but break compatibility on older devices
- Future migration path documented (could become a setting)

---

## Summary

The encoding system has 3 layers:

1. **Quality controls** (bitrates + audio + tier) — affect file size + visual quality + cost
2. **Performance controls** (preset + concurrency) — affect encoding speed + throughput
3. **Worker lifecycle** (restart flow) — see [`worker-restart-guide.md`](./worker-restart-guide.md)

For 99% of users, the **Balanced tier with default performance settings** is
the right answer. Power users tweak from there based on their specific needs:

- 💸 **Save costs**: Switch to Optimized tier (lower bitrates)
- 🎨 **Premium quality**: Switch to Premium tier (higher bitrates)
- ⚡ **Faster encoding**: Bump quality_concurrency on bigger servers
- 🚀 **Higher throughput**: Bump videos_in_parallel + restart worker
- 🎯 **Custom mix**: Use Custom tier and set each quality individually
