# Playback Caching Plan (Future Work)

> **Status**: Not yet implemented. This document captures the design decisions
> reached during the AES encryption planning session so we can build the
> caching layer later without re-deriving the analysis.

## Why this exists

When we audited the playback path before adding AES encryption, we discovered
the CDN route (`server/routes/cdn.js`) hits the database **on every single
HLS segment request**. For a 10-minute video at 4-second segments, that's
~150 DB queries per single playback session. With many concurrent viewers,
the database becomes the bottleneck long before bandwidth or CPU does.

Adding AES doesn't materially worsen this (only +3 queries per session, not
per segment), but the existing per-segment query is the real perf issue.

## Current playback DB query breakdown

For one viewer playing one 10-minute video:

| Step | Queries |
|------|---------|
| 1. `GET /embed/:id` (HTML) | 0 |
| 2. `GET /api/player/:id` (player init) | 8 (video, embed_settings, settings×2, subtitles, ad_config, ad_entries, UPDATE views) |
| 3. `GET /cdn/.../master.m3u8` | 2 (settings cached + video) |
| 4. `GET /cdn/.../1080p.m3u8` | 1 (video) |
| 5. `GET /cdn/.../1080p_NNN.jpeg` | **1 per segment × 150 = 150** |
| **Total per session** | **~161** |

For 1,000 concurrent viewers: ~161,000 queries/play.

## Target architecture

Three cache layers, in order of difficulty:

### Layer 1 — Browser cache (HTTP headers, 5-min effort)
Already partially in place. Make sure:
- `master.m3u8` and per-quality `*.m3u8`: `Cache-Control: public, max-age=300` (5 min)
- HLS segments (`*.jpeg`): `Cache-Control: public, max-age=31536000, immutable` (already set)
- AES key endpoint: `Cache-Control: no-store` (must NOT cache)

### Layer 2 — In-memory cache on Node.js (1-2 hours)
The big win. Add an LRU/TTL cache in `cdn.js` that holds video metadata:

```js
// At top of cdn.js
const _videoCache = new Map();
const VIDEO_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getVideoCached(videoId) {
  const cached = _videoCache.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.row;
  const r = await db.query(
    'SELECT id, status, visibility, encryption_enabled FROM videos WHERE id = $1',
    [videoId]
  );
  if (!r.rows.length) return null;
  _videoCache.set(videoId, { row: r.rows[0], expires: Date.now() + VIDEO_CACHE_TTL_MS });
  return r.rows[0];
}

// Then in the segment route:
const video = await getVideoCached(videoId);
// (replaces the explicit db.query call)
```

**Cache invalidation hooks** (must be added to keep cache fresh):
- `PUT /api/videos/:id` → `_videoCache.delete(req.params.id)`
- `DELETE /api/videos/:id` → `_videoCache.delete(req.params.id)`
- Worker on status change → publish invalidation event (for now: short TTL handles it)

### Layer 3 — AES key cache (when AES is added)
Same pattern but for `video_encryption_keys`:

```js
const _keyCache = new Map();
const KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getKeyCached(videoId) {
  const cached = _keyCache.get(videoId);
  if (cached && cached.expires > Date.now()) return cached.key;
  const r = await db.query('SELECT key_bytes FROM video_encryption_keys WHERE video_id = $1', [videoId]);
  if (!r.rows.length) return null;
  const decrypted = decrypt(r.rows[0].key_bytes); // ENCRYPTION_KEY from .env
  _keyCache.set(videoId, { key: decrypted, expires: Date.now() + KEY_CACHE_TTL_MS });
  return decrypted;
}
```

Memory budget: 100k videos × 16 bytes = 1.6 MB — trivial.

### Layer 4 — Redis (later, when scaling beyond 1 server)
Replace the `Map` with a Redis client (we already use Redis for Bull). Same
TTLs. Lets multiple Node.js instances share the cache without each one having
to populate its own.

## Performance projections after caching

| Scenario | Without cache | With Layer 2+3 cache |
|----------|---------------|----------------------|
| 1 viewer, 10-min video | 161 queries | ~12 queries (93% reduction) |
| 100 viewers (different videos) | 16,100 queries | ~1,200 queries |
| 1,000 viewers | 161,000 queries | ~12,000 queries (then mostly cache hits as they re-use video metadata) |
| 10,000 viewers | 1,610,000 queries | ~50,000 queries |

## Build order when we're ready

1. **Cache invalidation infrastructure first** (the dependency)
   - Add a small `invalidateVideoCache(id)` helper
   - Hook it into all `UPDATE/DELETE videos` paths
2. **Layer 2: video metadata cache** in `cdn.js`
3. **Layer 1: confirm HTTP cache headers** (verify with curl)
4. **Layer 3: AES key cache** (if AES is built by then)
5. **Layer 4: Redis** (only when actually running multiple servers)

## What NOT to cache (be careful)

- **Signed URL tokens**: must be verified per-request (security)
- **JWT validity**: same — always fresh check
- **Audit log writes**: must always hit DB, never cache
- **View count updates**: don't cache the row that's about to be updated
- **Any per-user data**: caching across users = data leak

## Estimated build time

- Layer 1 (HTTP headers): 5 minutes
- Layer 2 (video cache + invalidation): 1.5 hours
- Layer 3 (AES key cache): 30 minutes (only if AES built)
- Layer 4 (Redis): 1.5 hours (skip for now)

**Total for Layers 1-3**: ~2 hours.

## Reference: original audit numbers

(Keep these for "before/after" comparison when we benchmark.)

```
Per single playback session of 10-min video:
  Setup:        8 queries
  Manifests:    3 queries
  Segments:    150 queries (1 per segment)
  Analytics:   variable
  Total:       ~161 queries

Per minute of viewing per viewer: ~16 queries
Per hour per viewer:              ~1,000 queries
Per 1,000 concurrent viewers:     ~16,000 queries/min = 267 queries/sec
```

The current code can probably handle hundreds of concurrent viewers fine on
a small VPS, but the **per-segment query is wasteful**. Caching makes the
same hardware handle ~10x the load.
