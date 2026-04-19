# HLS Segment Extension Rotation Guide

> **Status**: Implemented. This document explains how to rotate segment
> file extensions for CDN cache diversification and scrape resistance.

## What it does

HLS video segments are binary MPEG-TS files (technically `.ts`). This
platform obfuscates them with image-family extensions (default `.jpeg`)
so they look like images to CDNs, scrapers, and casual inspection.

The **HLS Segment Extension** setting lets the admin rotate between
9 different extensions. Each setting change applies to all NEW uploads
from that moment on. Existing videos keep their original extension
forever (the playlist references exact filenames, so they can't be
retroactively renamed).

## Why rotate?

| Benefit | How it helps |
|---------|-------------|
| **CDN cache bucket diversification** | Different extensions land in different Cloudflare cache pools, reducing single-bucket hot-spotting |
| **Scrape resistance** | Bots that hardcode `.jpeg` in their URL patterns miss any videos uploaded during a rotation window |
| **Per-extension cache rule testing** | Set different Page Rules per extension in Cloudflare to A/B test cache TTLs, Polish settings, etc. |
| **Cache-poisoning blast radius limit** | If someone targets a specific extension for cache flush attacks, only that batch is affected |

## Available extensions

### Image-family (recommended — safest)

| Extension | Why it works | Notes |
|-----------|-------------|-------|
| **`.jpeg`** | Default — used for existing videos | Safe starting point |
| **`.png`** | Universal image format | Treated like JPEG by most CDNs |
| **`.webp`** | Modern image format (2010+) | Best aggressive caching on Cloudflare |
| **`.gif`** | Universal image format | Very long default cache TTL |
| **`.avif`** | Next-gen image format (AV1-based) | Favored by newer CDN image optimizers |

### Web-resource family (advanced — test before using)

| Extension | Why it works | Caveat |
|-----------|-------------|--------|
| **`.html`** | Aggressively cached | Cloudflare's HTML minifier may try to parse the "file". Disable Auto Minify for video URLs via Page Rules |
| **`.css`** | Aggressively cached | Cloudflare's CSS minifier may try to parse. Disable Auto Minify for video URLs |
| **`.js`** | Aggressively cached | Cloudflare's JS minifier may try to parse. Disable Auto Minify + Rocket Loader for video URLs |
| **`.ico`** | Favicons — very long cache TTL | Rarely collides with other uses |

### What's NOT in the rotation pool

| Extension | Reason |
|-----------|--------|
| `.jpg` | **Reserved for thumbnails and sprite sheets** (never overlapping with segments) |
| `.ts` | The actual MPEG-TS extension — defeats obfuscation entirely |
| `.m3u8` | Reserved for playlists |
| `.m4s`, `.mp4` | Reserved for AV1 fMP4 mode (see below) |
| `.vtt`, `.srt` | Reserved for subtitles |

## AV1 exception

**AV1-encoded videos always use `.m4s`** regardless of this setting.
This is because AV1 requires the fMP4 (CMAF) container format, and
browsers strictly validate fMP4 segments by extension. Obfuscating AV1
segments would cause playback failure.

If you set the rotation to `.webp` and then upload a video while AV1
is the active codec, that video gets `.m4s` segments. The worker
automatically detects this and overrides the rotation.

## How the flow works

```
1. Admin opens Settings → Encoding → HLS Segment Extension
2. Current selection is '.jpeg' (or whatever was saved)
3. Admin changes to '.webp' and clicks Save
4. Settings cache is cleared instantly
5. Next video uploaded → worker reads '.webp' from cfg
6. Worker encodes segments as 1080p_000.webp, 1080p_001.webp, ...
7. videos.segment_extension column is set to '.webp' for that video
8. Playlist (1080p.m3u8) is written referencing .webp files
9. CDN serves the segments with video/MP2T MIME type regardless of
   the extension (path-based detection — anything in /hls/ that
   isn't .m3u8 is treated as a segment)
```

**No worker restart needed.** The encoding-config cache has a 10-second
TTL and is cleared on every save, so the new extension takes effect
within 10 seconds of clicking Save.

## How the CDN handles this

The CDN route uses **path-based** MIME detection, not extension-based:

```javascript
// cdn.js
if (urlPath.includes('/hls/') && ext !== '.m3u8' && HLS_SEGMENT_EXTS.has(ext)) {
  contentType = 'video/MP2T';
}
```

This means:
- `GET /cdn/videos/X/hls/1080p_000.webp` → served as `video/MP2T` ✓
- `GET /cdn/videos/X/hls/1080p_000.html` → served as `video/MP2T` ✓
- `GET /cdn/videos/X/hls/master.m3u8` → served as `application/vnd.apple.mpegurl` ✓
- `GET /cdn/videos/X/thumbnail.jpg` → served as `image/jpeg` ✓ (not in /hls/)
- `GET /cdn/videos/X/hls/sprite.jpg` (hypothetical) → served as `image/jpeg` ✓ (special-cased by filename)

The browser receives the correct Content-Type for HLS, plays the segment,
and the extension only matters for CDN cache key differentiation.

## Recommended rotation schedule

There's no required cadence — rotate whenever it makes sense for your
operation. Some ideas:

| Cadence | When to use |
|---------|-------------|
| **Weekly** | High-volume upload platforms (thousands of videos/week) |
| **Monthly** | Medium-volume (hundreds of videos/week) |
| **Per 1000 videos** | Batch-correlated analytics (easy to attribute traffic to each batch) |
| **After scrape incident** | Immediate switch to invalidate attacker's cached URL list |
| **Never** | Low-volume platforms — rotation isn't worth the cognitive overhead |

## Cloudflare Page Rules to set up

If you use `.html`, `.css`, or `.js` extensions for segments, add these
Page Rules to prevent Cloudflare's auto-minifier from mangling them:

```
URL pattern: *yourdomain.com/cdn/videos/*/hls/*
Settings:
  - Auto Minify: OFF (all three — HTML, CSS, JS)
  - Rocket Loader: OFF
  - Browser Cache TTL: 1 year (these segments never change)
```

## Storage layout example

After rotating through 3 extensions, your storage might look like:

```
videos/
├── oldvid001/hls/              ← uploaded when ext was .jpeg
│   ├── master.m3u8
│   ├── 1080p.m3u8
│   ├── 1080p_000.jpeg
│   └── 1080p_001.jpeg
├── oldvid002/hls/              ← still .jpeg
│   └── ...
├── midvid001/hls/              ← uploaded when ext was .webp
│   ├── master.m3u8
│   ├── 1080p.m3u8
│   ├── 1080p_000.webp          ← different extension
│   └── 1080p_001.webp
└── newvid001/hls/              ← uploaded when ext was .html
    ├── master.m3u8
    ├── 1080p_000.html          ← yet another extension
    └── 1080p_001.html
```

Each video is internally consistent. The player has no idea what
extension is being used — HLS.js just fetches the URLs the playlist
points at.

## Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `encoding_segment_extension` | string | `.jpeg` | Currently active extension for new uploads |

Per-video column:

| Column | Type | Notes |
|--------|------|-------|
| `videos.segment_extension` | `VARCHAR(8)` | Set immutably at encode time. NULL for pre-feature videos (served as `.jpeg` fallback). |

## Learn more

- [Cloudflare Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/) — setting per-extension cache TTLs
- [Cloudflare Page Rules](https://developers.cloudflare.com/rules/page-rules/) — disabling auto-minification for video URLs
- [HLS obfuscation techniques](https://ottverse.com/hls-packaging-using-ffmpeg-live-vod/) — why segments use non-`.ts` extensions
