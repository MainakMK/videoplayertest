const express = require('express');
const path = require('path');
const db = require('../db/index.js');
const { generateToken, generateKeyToken } = require('../services/signed-url');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multi-CDN domain cache (60s TTL, same pattern as cdn.js security cache)
// ---------------------------------------------------------------------------
let cdnDomainsCache = null;
let cdnDomainsCacheTime = 0;
const CDN_CACHE_TTL = 60000;

async function getActiveCdnDomains() {
  const now = Date.now();
  if (cdnDomainsCache && (now - cdnDomainsCacheTime) < CDN_CACHE_TTL) {
    return cdnDomainsCache;
  }
  const result = await db.query(
    "SELECT domain FROM cloudflare_domains WHERE service_type = 'cdn' AND is_active = true ORDER BY sort_order"
  );
  cdnDomainsCache = result.rows.map(r => r.domain);
  cdnDomainsCacheTime = now;
  return cdnDomainsCache;
}

function detectDevice(userAgent) {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipod/.test(ua)) return 'mobile';
  if (/tablet|ipad/.test(ua)) return 'tablet';
  if (/smart-tv|smarttv|appletv|roku|firetv|googletv/.test(ua)) return 'tv';
  return 'desktop';
}

function detectCountry(req) {
  // Cloudflare header
  const cfCountry = req.headers['cf-ipcountry'];
  if (cfCountry && cfCountry !== 'XX') return cfCountry;

  // Fallback: parse accept-language header
  const acceptLang = req.headers['accept-language'];
  if (acceptLang) {
    const match = acceptLang.match(/[a-z]{2}-([A-Z]{2})/);
    if (match) return match[1];
  }

  return 'unknown';
}

// GET /:video_id - Get video data for player
router.get('/:video_id', async (req, res) => {
  try {
    const { video_id } = req.params;

    // Fetch video
    const videoResult = await db.query(
      'SELECT * FROM videos WHERE id = $1',
      [video_id]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = videoResult.rows[0];

    // Check visibility — allow non-ready videos to show processing screen
    if (video.visibility === 'private' && video.status === 'ready') {
      return res.status(403).json({ error: 'This video is private' });
    }

    // Fetch embed settings (video-specific, fall back to global defaults)
    const embedResult = await db.query(
      `SELECT * FROM embed_settings WHERE video_id = $1
       UNION ALL
       SELECT * FROM embed_settings WHERE video_id IS NULL
       LIMIT 1`,
      [video_id]
    );

    const embedSettings = embedResult.rows[0] || {};

    // Check referrer against allowed domains
    const referrer = req.headers.referer || req.headers.referrer || '';
    const allowedDomains = embedSettings.allowed_domains || [];

    if (allowedDomains.length > 0 && referrer) {
      try {
        const referrerHost = new URL(referrer).hostname;
        const isAllowed = allowedDomains.some(
          (domain) => referrerHost === domain || referrerHost.endsWith(`.${domain}`)
        );
        if (!isAllowed) {
          return res.status(403).json({ error: 'Embedding not allowed on this domain' });
        }
      } catch {
        // Invalid referrer URL, skip check
      }
    }

    // Pick a CDN domain (multi-CDN load balancing with fallback to legacy setting)
    const cdnDomains = await getActiveCdnDomains();
    let cdnDomain = '';
    if (cdnDomains.length > 0) {
      cdnDomain = cdnDomains[Math.floor(Math.random() * cdnDomains.length)];
    } else {
      const cdnResult = await db.query("SELECT value FROM settings WHERE key = 'domain_cdn'");
      cdnDomain = cdnResult.rows[0]?.value || '';
    }

    // Check if signed URLs are enabled
    const signedResult = await db.query(
      "SELECT value FROM settings WHERE key = 'signed_urls_enabled'"
    );
    const signedUrlsEnabled = signedResult.rows[0]?.value === 'true';

    // Client IP for IP-bound tokens (CDN + key delivery both use it).
    const clientIp = req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.ip;

    // Generate signed CDN token if enabled (gates segment fetches).
    let tokenParam = '';
    if (signedUrlsEnabled) {
      const token = generateToken(video.id, { ip: clientIp });
      tokenParam = `?token=${token}`;
    }

    // Mint a key-delivery token whenever the video is AES-encrypted. This is
    // INDEPENDENT of signed_urls_enabled: if the video is encrypted we always
    // need to gate the key endpoint. IP-bound + 2h TTL (long viewing sessions).
    let keyToken = null;
    if (video.encryption_enabled) {
      keyToken = generateKeyToken(video.id, { ip: clientIp });
    }

    // Build HLS URL
    let hlsUrl = '';
    const hlsPath = `videos/${video.id}/hls/master.m3u8`;
    if (cdnDomain) {
      hlsUrl = `https://${cdnDomain}/cdn/${hlsPath}${tokenParam}`;
    } else {
      hlsUrl = `/cdn/${hlsPath}${tokenParam}`;
    }

    // Build thumbnail URL via CDN (no token needed for thumbnails)
    let thumbnailUrl = video.thumbnail_url;
    if (!thumbnailUrl || thumbnailUrl.startsWith('/uploads/')) {
      if (cdnDomain) {
        thumbnailUrl = `https://${cdnDomain}/cdn/videos/${video.id}/thumbnail.jpg`;
      } else {
        thumbnailUrl = `/cdn/videos/${video.id}/thumbnail.jpg`;
      }
    }

    // Fetch subtitles
    const subtitlesResult = await db.query(
      'SELECT id, language, label, file_url, is_default FROM subtitles WHERE video_id = $1 ORDER BY is_default DESC, label ASC',
      [video_id]
    );

    // Fetch ad configuration
    const adConfigResult = await db.query('SELECT * FROM ad_configurations LIMIT 1');
    const adConfig = adConfigResult.rows[0] || {};

    let adEntries = [];
    if (adConfig.vast_enabled && adConfig.id) {
      const entriesResult = await db.query(
        'SELECT offset_type, time_offset, skip_offset, vast_url FROM ad_entries WHERE ad_config_id = $1 ORDER BY sort_order',
        [adConfig.id]
      );
      adEntries = entriesResult.rows;
    }

    // Increment views count
    await db.query(
      'UPDATE videos SET views_count = views_count + 1 WHERE id = $1',
      [video_id]
    );

    // Sprite URLs for progress-bar scrub preview — always built from the CDN
    // path (with the same signed-URL token as HLS) so they work in both
    // local-storage mode and under signed URL enforcement. The DB-stored
    // `sprite_url`/`sprite_vtt_url` are ignored here because they may contain
    // stale `/uploads/...` paths from older encodes.
    const spriteJpgPath = `videos/${video.id}/hls/sprite.jpg`;
    const spriteVttPath = `videos/${video.id}/hls/sprite.vtt`;
    const spriteJpgUrl = cdnDomain
      ? `https://${cdnDomain}/cdn/${spriteJpgPath}${tokenParam}`
      : `/cdn/${spriteJpgPath}${tokenParam}`;
    const spriteVttUrl = cdnDomain
      ? `https://${cdnDomain}/cdn/${spriteVttPath}${tokenParam}`
      : `/cdn/${spriteVttPath}${tokenParam}`;

    res.json({
      video: {
        id: video.id,
        title: video.title,
        description: video.description,
        duration: video.duration,
        thumbnail_url: thumbnailUrl,
        qualities: video.qualities,
        hls_url: hlsUrl,
        status: video.status,
        sprite_url: spriteJpgUrl,
        sprite_vtt_url: spriteVttUrl,
      },
      // Chapters are stored as a JSONB array on videos.chapters. Each entry:
      // { time: "mm:ss" | "hh:mm:ss", title: "..." }. Player renders markers
      // on the seekbar + shows a chapter menu. Empty array = no chapters.
      chapters: Array.isArray(video.chapters) ? video.chapters : [],
      subtitles: subtitlesResult.rows.map(sub => {
        const ext = path.extname(sub.file_url || '');
        const subtitlePath = `videos/${video_id}/subtitles/${sub.language}${ext}`;
        let url;
        if (cdnDomain) {
          url = `https://${cdnDomain}/cdn/${subtitlePath}${tokenParam}`;
        } else {
          url = `/cdn/${subtitlePath}${tokenParam}`;
        }
        return {
          language: sub.language,
          label: sub.label,
          url,
          is_default: sub.is_default,
        };
      }),
      embed_settings: {
        player_color:       embedSettings.player_color       || '#00aaff',
        logo_url:           embedSettings.logo_url           || null,
        autoplay:           embedSettings.autoplay           || false,
        controls:           embedSettings.controls           !== false,
        loop:               embedSettings.loop               || false,
        watermark_position: embedSettings.watermark_position || 'bottom-right',
        player_title:       embedSettings.player_title       || '',
        logo_opacity:       embedSettings.logo_opacity       ?? 0.75,
        logo_size:          embedSettings.logo_size          || 'medium',
        logo_link:          embedSettings.logo_link          || '',
      },
      ads: {
        vast: {
          enabled: adConfig.vast_enabled || false,
          entries: adEntries,
        },
        popup: {
          enabled: adConfig.popup_enabled || false,
          popup_limit: adConfig.popup_limit || 0,
          popup_url: adConfig.popup_url || '',
        },
      },
      // Token for HLS segment requests (player appends to each segment URL)
      cdn_token: signedUrlsEnabled ? tokenParam.slice(1) : null,
      // AES-128 HLS encryption metadata. When `encryption.enabled` is true,
      // the player must send `key_token` as a Bearer header (or ?token=)
      // when HLS.js requests the key URI from the manifest.
      encryption: {
        enabled: !!video.encryption_enabled,
        key_token: keyToken,
      },
    });
  } catch (err) {
    console.error('Player get video error:', err);
    res.status(500).json({ error: 'Failed to load video' });
  }
});

// POST /event - Track analytics event
router.post('/event', async (req, res) => {
  try {
    const { video_id, event_type, watch_duration, referrer } = req.body;

    if (!video_id || !event_type) {
      return res.status(400).json({ error: 'video_id and event_type are required' });
    }

    const country = detectCountry(req);
    const device = detectDevice(req.headers['user-agent']);

    await db.query(
      `INSERT INTO analytics_events (video_id, event_type, country, device, referrer, watch_duration, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [video_id, event_type, country, device, referrer || null, watch_duration || 0]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Track event error:', err);
    res.status(500).json({ error: 'Failed to track event' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RESUME WATCHING — viewer progress endpoints
// ─────────────────────────────────────────────────────────────────────────────

// GET /:video_id/progress?viewer_id=xxx  — get saved position for a viewer
router.get('/:video_id/progress', async (req, res) => {
  try {
    const { video_id } = req.params;
    const { viewer_id } = req.query;

    if (!viewer_id || viewer_id.length > 64) {
      return res.json({ position: 0, completed: false });
    }

    const result = await db.query(
      'SELECT position, duration, completed FROM viewer_progress WHERE video_id = $1 AND viewer_id = $2',
      [video_id, viewer_id]
    );

    if (!result.rows.length) {
      return res.json({ position: 0, completed: false });
    }

    const row = result.rows[0];
    res.json({
      position:  row.position,
      duration:  row.duration,
      completed: row.completed,
    });
  } catch (err) {
    console.error('Get progress error:', err);
    res.json({ position: 0, completed: false }); // fail silently
  }
});

// POST /:video_id/progress  — save current position
// Body: { viewer_id, position, duration, completed }
router.post('/:video_id/progress', async (req, res) => {
  try {
    const { video_id } = req.params;
    const { viewer_id, position, duration, completed } = req.body;

    if (!viewer_id || viewer_id.length > 64 || position === undefined) {
      return res.json({ saved: false });
    }

    const pos  = Math.max(0, parseFloat(position) || 0);
    const dur  = Math.max(0, parseFloat(duration)  || 0);
    const done = completed === true || completed === 'true';

    await db.query(
      `INSERT INTO viewer_progress (video_id, viewer_id, position, duration, completed, last_updated)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (video_id, viewer_id)
       DO UPDATE SET position = $3, duration = $4, completed = $5, last_updated = NOW()`,
      [video_id, viewer_id, pos, dur, done]
    );

    res.json({ saved: true });
  } catch (err) {
    console.error('Save progress error:', err);
    res.json({ saved: false }); // fail silently
  }
});

// GET /progress/stats/:video_id  — dashboard stats: how many viewers have progress
router.get('/progress/stats/:video_id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE NOT completed AND position > 5)                          AS in_progress,
         COUNT(*) FILTER (WHERE completed)                                               AS completed,
         ROUND(AVG(CASE WHEN duration > 0 THEN (position / duration) * 100 END)::numeric, 1) AS avg_completion_pct
       FROM viewer_progress
       WHERE video_id = $1`,
      [req.params.video_id]
    );
    const row = result.rows[0];
    res.json({
      in_progress:       parseInt(row.in_progress)  || 0,
      completed:         parseInt(row.completed)     || 0,
      avg_completion_pct: parseFloat(row.avg_completion_pct) || 0,
    });
  } catch (err) {
    res.json({ in_progress: 0, completed: 0, avg_completion_pct: 0 });
  }
});

module.exports = router;
