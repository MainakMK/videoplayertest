# Video Player — Self-Hosted Streaming Platform

A complete, self-hosted video streaming platform with HLS encoding, multiple
storage backends, team management, and a polished admin dashboard.

> **Important**: This README focuses on the **Encoding Settings** module
> (`Settings → Encoding`) because the chat that designed it is ephemeral.
> If something looks confusing in that tab, this is the canonical reference.

---

## Table of Contents

1. [Architecture overview](#architecture-overview)
2. [Settings → Encoding tab](#settings--encoding-tab)
   - [Quality Preset](#1-quality-preset)
   - [Video Bitrates](#2-video-bitrates)
   - [Audio Bitrate](#3-audio-bitrate)
   - [Worker Performance](#4-worker-performance)
   - [Estimated Impact](#5-estimated-impact)
3. [How encoding settings flow at runtime](#how-encoding-settings-flow-at-runtime)
4. [Database keys reference](#database-keys-reference)
5. [Common questions](#common-questions)

## Companion guides (`docs/`)

For deeper technical details on specific subsystems:

| Guide | Covers |
|-------|--------|
| [`docs/encoding-system-guide.md`](docs/encoding-system-guide.md) | Full encoding system reference — bitrate ranges, FFmpeg preset deep-dive, target-bitrate vs CRF mode, HLS chunk math, encoding time tables, storage cost projections at scale, concurrency layers, why we removed auto-detect, deployment scenarios (VPS/Bunny MC), how to add new quality variants |
| [`docs/encoding-keyframe-interval.md`](docs/encoding-keyframe-interval.md) | Keyframe interval (GOP size) deep-dive — what keyframes are, why they matter for HLS, recommended values per content type, what YouTube/Netflix/Apple use, the `-g` auto-derive formula, 10+ external references (Jan Ozer, Apple spec, Bitmovin, FFmpeg wiki) |
| [`docs/encoding-multi-audio.md`](docs/encoding-multi-audio.md) | Multi-codec audio (5.1 AC3 + stereo AAC) — how dual audio works in HLS, `#EXT-X-MEDIA` manifest format, smart skip for stereo sources, AC3 bitrate guide, player integration, file size impact |
| [`docs/multi-language-audio.md`](docs/multi-language-audio.md) | Multi-language audio auto-detection — source with 2+ audio tracks produces per-language HLS renditions, ISO 639-2 code mapping, duplicate language handling, storage impact, testing recipes |
| [`docs/encoding-codec-selector.md`](docs/encoding-codec-selector.md) | Codec selector (H.264/H.265/AV1) — FFmpeg encoder flags, container formats (MPEG-TS vs fMP4), browser compat matrix, clone support per codec, CODECS attribute, SVT-AV1 vs libaom, speed/size trade-offs |
| [`docs/encoding-rate-control.md`](docs/encoding-rate-control.md) | Rate control (ABR vs constrained VBR) — maxrate/bufsize ratios, computed examples per quality tier, industry comparisons (Netflix/YouTube/Apple), file size impact, choosing ratios guide |
| [`docs/encoding-segment-extension.md`](docs/encoding-segment-extension.md) | HLS segment extension rotation — 9 admin-rotatable extensions (.jpeg/.webp/.png/.gif/.avif/.html/.css/.js/.ico), path-based CDN MIME detection, AV1 exception, Cloudflare Page Rules, rotation schedules |
| [`docs/video-chapters.md`](docs/video-chapters.md) | Video chapters — data format (JSONB array), GET/PUT API, dashboard editor behavior, player seekbar markers + menu, validation rules (50 max, time regex, XSS sanitization), edge cases |
| [`docs/encoding-extra-ffmpeg-params.md`](docs/encoding-extra-ffmpeg-params.md) | Extra FFmpeg parameters escape hatch — common recipes (-tune, -crf, -profile:v, -af loudnorm), security guardrails (blocked flags, shell char stripping), parser behavior, what applies where |
| [`docs/player-debug-overlay.md`](docs/player-debug-overlay.md) | Playback debug overlay (`?debug=1`) — live stats panel on the player: quality, bitrate, buffer, dropped frames, bandwidth, segment. hls.js vs Safari field differences, security notes, troubleshooting guide |
| [`docs/worker-restart-guide.md`](docs/worker-restart-guide.md) | Worker restart flow — graceful shutdown, exits/respawns, process managers (PM2/systemd/Docker/K8s), 20-video scenario, mid-encoding safety, troubleshooting |
| [`docs/playback-caching-plan.md`](docs/playback-caching-plan.md) | Playback caching design (future work) — per-segment DB query audit, 4-layer caching strategy (browser / in-memory LRU / AES key cache / Redis), invalidation hooks, performance projections |

---

## Architecture overview

- **Backend**: Node.js + Express
- **Database**: PostgreSQL
- **Job queue**: Bull (Redis-backed)
- **Video processing**: FFmpeg → HLS (`.jpeg`-obfuscated `.ts` segments)
- **Storage**: Per-video — local disk OR Cloudflare R2 (chosen at upload time)
- **Dashboard**: Single HTML file at `dashboard/index.html`
- **Player**: Custom HTML5 + HLS.js

Each uploaded video flows through three stages:

1. **STAGE 1 — Multer temp**: `server/uploads/{timestamp}-{filename}`
2. **STAGE 2 — FFmpeg output**: `server/uploads/processing/{videoId}/`
3. **STAGE 3 — Final storage**: `videos/{videoId}/hls/...` on local disk OR R2

---

## Settings → Encoding tab

The Encoding tab lives at **Settings → Encoding** (between Storage and Player).
It controls **how FFmpeg transcodes uploaded videos** — bitrates, audio
quality, worker concurrency, and the FFmpeg preset.

> **All changes apply to the NEXT video** processed by the worker.
> No worker restart needed — except for the `Videos in parallel` setting.
>
> **For deep details on the worker restart flow** (graceful shutdown, exits/respawns,
> safety guarantees, real-world scenarios), see
> [`docs/worker-restart-guide.md`](docs/worker-restart-guide.md).

The page has 5 sections, in order:

### 1. Quality Preset

Four cards at the top let you pick a starting point:

| Card | What it does | Result |
|------|--------------|--------|
| ⭐ **Premium** | Sets all bitrates to high values | ~825 MB per 10-min video, +50% size vs Balanced. Use for premium content where every viewer is paying. |
| ✓ **Balanced** *(default)* | Recommended bitrates for most content | ~551 MB per 10-min video. Clean visual quality, sensible storage cost. |
| 💰 **Optimized** | Lower bitrates to save storage/bandwidth costs | ~395 MB per 10-min video, −28% size. Slightly less detail in dark/complex scenes — most viewers won't notice. |
| ⚙️ **Custom** | Indicates manual values (auto-selected when you tweak any slider) | Whatever bitrates you've manually set |

**What happens when you click a card:**

- The bitrate sliders below jump to the tier's values
- The audio button highlights to the tier's audio bitrate
- The `preset_tier` settings key is written
- Clicking **Save Settings** persists everything

**Exact values per tier:**

| Setting | Premium ⭐ | Balanced ✓ | Optimized 💰 |
|---------|-----------|------------|-------------|
| 1080p video bitrate | 5000 kbps | **3500 kbps** | 2500 kbps |
| 720p video bitrate | 3000 kbps | **2000 kbps** | 1500 kbps |
| 480p video bitrate | 1500 kbps | **1000 kbps** | 700 kbps |
| 360p video bitrate | 1000 kbps | **600 kbps** | 400 kbps |
| Audio bitrate | 192 kbps | **128 kbps** | 96 kbps |
| Per 10-min video | ~825 MB | **~551 MB** | ~395 MB |
| Cost (1k videos / mo) | ~$12.40 | **~$8.27** | ~$5.93 |

> **Note**: If you select Balanced/Premium/Optimized and then change ANY
> slider, the tier auto-switches to **Custom** — no values are silently
> overwritten.

### 2. Video Bitrates

Four sliders, one per quality variant (1080p, 720p, 480p, 360p).

**What "bitrate" means:**

> Bitrate = bits per second of video data. Higher bitrate = more detail
> preserved per frame = bigger file. Lower bitrate = more compression
> = smaller file but artifacts in complex scenes.

**Slider ranges and effects:**

#### 1080p slider (range: 800 – 8000 kbps)

| Bitrate | Visual quality | Use case |
|---------|---------------|----------|
| 800 kbps | 🔴 Bad — heavy blocking, fuzzy details | Don't use for 1080p |
| 1500 kbps | 🟡 Acceptable for static content | Slideshows, low-motion |
| 2500 kbps | 🟢 Good — clean for most content | Cost-optimized |
| **3500 kbps** ✅ | 🟢 Great — clean even for action | **Default (Balanced)** |
| 5000 kbps | 🟢 Excellent — pristine | Premium platforms |
| 8000 kbps | 🟢 Overkill for streaming | Master-quality archives |

#### 720p slider (range: 500 – 4500 kbps)

| Bitrate | Quality | Use case |
|---------|---------|----------|
| 500 kbps | 🔴 Mobile-only fallback | |
| 1000 kbps | 🟡 OK for talking heads | |
| 1500 kbps | 🟢 Good | Cost-optimized |
| **2000 kbps** ✅ | 🟢 Great | **Default (Balanced)** |
| 3000 kbps | 🟢 Excellent | Premium |

#### 480p slider (range: 300 – 2000 kbps)

| Bitrate | Quality | Use case |
|---------|---------|----------|
| 300 kbps | 🔴 Bad | |
| 600 kbps | 🟡 Watchable on phones | Cost-optimized |
| **1000 kbps** ✅ | 🟢 Clean | **Default (Balanced)** |
| 1500 kbps | 🟢 Excellent | Premium |

#### 360p slider (range: 200 – 1000 kbps)

| Bitrate | Quality | Use case |
|---------|---------|----------|
| 200 kbps | 🔴 Heavy artifacts | |
| 400 kbps | 🟡 Acceptable mobile | Cost-optimized |
| **600 kbps** ✅ | 🟢 Clean | **Default (Balanced)** |

> Each slider shows the **estimated file size for a 10-minute video** below
> it (e.g., "↳ ~266 MB per 10-min video"). This updates live as you drag.

### 3. Audio Bitrate

A row of 5 buttons:

| Button | Use case |
|--------|----------|
| 64k | Voice-only, podcasts on bandwidth-constrained networks |
| 96k | Acceptable for music + voice |
| **128k** ✅ | Default — good for nearly all content |
| 192k | High-quality music, premium platforms |
| 256k | Premium audio (audiobook-quality podcasts, music platforms) |

**Important**: Audio bitrate is applied to **all quality variants**.
You can't have 1080p use 192k while 480p uses 96k — they all share
the same audio bitrate.

### 4. Worker Performance

Three controls that govern how the FFmpeg worker uses your CPU.

#### Quality variants in parallel (1 / 2 / 3 / 4 / 5)

How many quality levels (1080p, 720p, etc.) FFmpeg encodes
**at the same time per video**.

```
Setting=2 (default): 
  Batch 1: 1080p + 720p in parallel → wait → Batch 2: 480p + 360p
Setting=4: 
  All 4 qualities encode simultaneously
```

| Setting | Recommended for |
|---------|-----------------|
| 1 | 2 vCPU servers (cheapest VPS) |
| **2** ✅ | 2–4 vCPU (default) |
| 3 | 6–8 vCPU |
| 4 | 8–12 vCPU |
| 5 | 16+ vCPU |

> **Effect on encoding time**: Higher = each video finishes faster
> but uses more CPU during encoding.
>
> **No restart needed** — change applies to the next video.

#### Videos in parallel (1 / 2 / 4 / 8)

How many separate videos the worker processes **simultaneously**.

```
Setting=1 (default): 
  Video A (5 min) → done → Video B (5 min) → done → ...
  Result: each video finishes 5 min apart
Setting=4:
  Videos A, B, C, D all encode at once, each takes ~20 min
  Result: all 4 finish around the same time, ~20 min in
```

| Setting | Recommended for |
|---------|-----------------|
| **1** ✅ | Default — first videos finish soonest, can be shared earlier |
| 2 | 8+ vCPU servers |
| 4 | 16+ vCPU servers |
| 8 | 32+ vCPU workstations |

> ⚠️ **Requires a worker restart to take effect** — Bull queue
> concurrency is set when the worker starts. Use the **Restart Worker** button
> in the dashboard (Settings → Encoding → Worker Performance section) for a
> safe, graceful restart that waits for active jobs to finish first. See
> [`docs/worker-restart-guide.md`](docs/worker-restart-guide.md) for the full
> flow, safety guarantees, and what happens when you restart mid-encoding.

> **Why "1" is the default**: At fixed CPU, parallelism doesn't make
> the total work finish faster (the CPU pie is the same size, just
> sliced differently). Sequential encoding lets the FIRST video
> become available much sooner — better for sharing/testing.

#### FFmpeg preset (ultrafast → medium)

Trade-off between encoding speed and visual quality at the same bitrate.

| Preset | Speed | Visual quality at same bitrate | Use case |
|--------|-------|-------------------------------|----------|
| `ultrafast` | ⚡⚡⚡ Fastest | ⚠️ Visible blocking on motion | Live streams, screencasts |
| `superfast` | ⚡⚡ | ⚠️ Slight artifacts | Internal previews |
| **`veryfast`** ✅ | ⚡ Fast | 🟢 Clean | **Default (recommended)** |
| `faster` | Slower | 🟢 Slightly cleaner | Quality-focused |
| `fast` | Slower | 🟢 Marginally better | Quality-focused |
| `medium` | Slowest | 🟢 Theoretically best | Premium archives |

> **Important**: Because we use **target-bitrate mode** (`-b:v`),
> the preset has a TINY (2–3%) effect on file size. It mostly
> affects encoding TIME and visual quality at that bitrate.
>
> If you want smaller files, **lower the bitrates** in section 2 —
> don't change the preset.

### 5. Estimated Impact

A live-updating panel showing what your current settings mean in dollars
and disk space:

```
📁 Output size per video        ~551 MB
   ├─ 1080p HLS                 ~266 MB
   ├─ 720p HLS                  ~156 MB
   ├─ 480p HLS                  ~80 MB
   └─ 360p HLS                  ~49 MB

💵 Cloudflare R2 cost
   ├─ 100 videos                ~$0.83 / mo · ~55 GB
   ├─ 1,000 videos              ~$8.27 / mo · ~551 GB
   └─ 10,000 videos             ~$82.65 / mo · ~5.4 TB
   (R2: $0.015/GB-mo · 10 GB free tier · zero egress fees)
```

**How it's calculated:**

For a 10-minute source video:
- size_per_quality_MB = bitrate_kbps × 600 / 8 / 1024
- total_per_video = sum across all 4 qualities + audio
- R2 cost = max(0, total_GB - 10) × $0.015

Updates live as you move sliders or click tier cards — no save needed
to see projections.

---

## How encoding settings flow at runtime

```
USER CHANGES SETTINGS IN UI
         │
         ▼
PUT /api/settings/encoding (validates + clamps every value)
         │
         ▼
INSERT/UPDATE rows in `settings` table:
  encoding_preset_tier         = 'balanced'
  encoding_bitrate_1080p       = '3500'
  encoding_audio_bitrate       = '128'
  encoding_quality_concurrency = '2'
  encoding_video_concurrency   = '1'
  encoding_ffmpeg_preset       = 'veryfast'
  ... etc
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

**Restart required only for**: `encoding_video_concurrency` (Bull queue
concurrency is locked when worker boots).

---

## Database keys reference

All encoding settings live in the existing `settings` table, prefixed with
`encoding_`. No new tables.

| Key | Type | Default | Range / Allowed values |
|-----|------|---------|------------------------|
| `encoding_preset_tier` | string | `balanced` | `premium` / `balanced` / `optimized` / `custom` |
| `encoding_bitrate_1080p` | int (kbps) | `3500` | 800 – 8000 |
| `encoding_bitrate_720p` | int (kbps) | `2000` | 500 – 4500 |
| `encoding_bitrate_480p` | int (kbps) | `1000` | 300 – 2000 |
| `encoding_bitrate_360p` | int (kbps) | `600` | 200 – 1000 |
| `encoding_audio_bitrate` | int (kbps) | `128` | 64 / 96 / 128 / 192 / 256 |
| `encoding_quality_concurrency` | int | `2` | 1 / 2 / 3 / 4 / 5 |
| `encoding_video_concurrency` | int | `1` | 1 / 2 / 4 / 8 |
| `encoding_ffmpeg_preset` | string | `veryfast` | `ultrafast` / `superfast` / `veryfast` / `faster` / `fast` / `medium` |

**Server-side validation**: every value is clamped to the allowed range
on save. Invalid values (out of range, wrong type) fall back to defaults.
You cannot break the worker by writing weird values directly to the DB.

---

## Common questions

### Why do I need both "Quality variants in parallel" AND "Videos in parallel"?

They control different layers of concurrency:

```
  Worker process
    └── Bull queue          (videos in parallel = N)
        └── Job 1
        │   ├── FFmpeg      (quality variants in parallel = M)
        │   ├── 1080p
        │   └── 720p
        └── Job 2
            ├── 1080p
            └── 720p
```

- **Videos in parallel**: how many separate jobs run at once
- **Quality variants in parallel**: how many FFmpeg processes per job

Total CPU usage ≈ `videos_in_parallel × quality_variants_in_parallel × 1 core each`

### Will lowering bitrate make the video look worse?

**Yes**, eventually — but only if you go below sensible thresholds:

- 1080p < 1500 kbps: visible blocking on motion
- 720p < 1000 kbps: noticeable artifacts on action
- 480p < 600 kbps: starts to look soft
- 360p < 400 kbps: visibly fuzzy

Within the slider ranges shown, **most viewers can't tell the difference**.

### Will changing FFmpeg preset shrink my files?

Almost no — only ~2–3% variance. The preset mostly changes encoding TIME
and visual quality at the same bitrate. To shrink files, **lower the
bitrate sliders**.

### Why are HLS chunks always 4 seconds?

Hardcoded in `worker.js`:

```js
'-hls_time 4'
```

This is independent of all encoding settings — chunk duration is fixed.

### What about source resolutions higher than 1080p?

The worker only transcodes qualities **at or below the source resolution**:

```js
const selectedQualities = cfg.qualityPresets.filter(q => q.height <= sourceHeight);
```

So a 720p source produces 720p, 480p, 360p (no 1080p).
A 4K source still uses the 1080p quality preset (we don't have 4K
output yet — could be added to `encoding-config.js`).

### What happens if I save mid-encoding?

The currently encoding video keeps using the OLD settings. The next video
pulled off the Bull queue uses the NEW settings.

### Where in the code do I add a new quality variant (e.g., 1440p)?

Two places in `server/services/encoding-config.js`:

1. Add a new entry to `BITRATE_RANGES`:
   ```js
   '1440p': { min: 4000, max: 16000, default: 8000 },
   ```
2. Add it to `loadEncodingConfig()`'s `qualityPresets` array
3. Add the corresponding slider HTML in the dashboard

---

## License

Private project — not for redistribution.
