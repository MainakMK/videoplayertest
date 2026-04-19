const express = require('express');
const db = require('../db/index.js');
const storage = require('../services/storage');
const { verifyToken, verifyKeyToken } = require('../services/signed-url');

const router = express.Router();

// Extensions that can be used as HLS segment files when admin rotates them
// via Settings → Encoding → Segment Extension. Any file in /hls/ with one of
// these extensions is treated as video/MP2T (or video/iso.segment for .m4s).
// This is how we support .jpeg, .webp, .png, etc. simultaneously — the
// admin's choice is stored per-video, and when serving, we detect by path.
const HLS_SEGMENT_EXTS = new Set([
  '.jpeg', '.png', '.webp', '.gif', '.avif',   // image-family (default pool)
  '.html', '.css', '.js', '.ico',               // web-resource family (advanced)
  '.ts',                                         // legacy MPEG-TS (raw)
]);

// MIME types for NON-segment files (thumbnails, subtitles, playlists, init segs)
const MIME_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',  // fMP4 segments (AV1)
  '.mp4': 'video/mp4',          // fMP4 init segment
  '.jpg': 'image/jpeg',   // thumbnails
  '.vtt': 'text/vtt',     // subtitles
  '.srt': 'application/x-subrip',
};

/**
 * Determine the MIME type for a file being served by the CDN route.
 *
 * Special case: HLS segments can have many different extensions (.jpeg,
 * .webp, .png, .html, etc.) when the admin rotates them for cache
 * diversification. We detect segments by URL path — anything inside /hls/
 * that is NOT a .m3u8 playlist AND has a registered segment extension is
 * served as video/MP2T regardless of the file extension.
 *
 * @param {string} filename  The file being served (e.g., '1080p_000.webp')
 * @param {string} urlPath   The request URL path (e.g., '/cdn/videos/X/hls/1080p_000.webp')
 */
function getContentType(filename, urlPath = '') {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

  // Path-based detection: any file inside /hls/ with a known segment extension
  // is a video segment, regardless of what the extension looks like.
  if (urlPath.includes('/hls/') && ext !== '.m3u8' && HLS_SEGMENT_EXTS.has(ext)) {
    return 'video/MP2T';
  }

  // Fall back to extension-based lookup (thumbnails, subtitles, playlists)
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function getClientIp(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip;
}

// Cache security settings for 60s to avoid DB hit on every segment
let securitySettingsCache = null;
let securitySettingsCacheTime = 0;
const CACHE_TTL = 60_000;

async function getSecuritySettings() {
  const now = Date.now();
  if (securitySettingsCache && (now - securitySettingsCacheTime) < CACHE_TTL) {
    return securitySettingsCache;
  }

  const result = await db.query(
    "SELECT key, value FROM settings WHERE key IN ('signed_urls_enabled', 'hotlink_protection_enabled', 'hotlink_allowed_domains')"
  );

  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }

  securitySettingsCache = {
    signedUrlsEnabled: settings.signed_urls_enabled === 'true',
    hotlinkProtectionEnabled: settings.hotlink_protection_enabled === 'true',
    hotlinkAllowedDomains: settings.hotlink_allowed_domains
      ? settings.hotlink_allowed_domains.split(',').map(d => d.trim()).filter(Boolean)
      : [],
  };
  securitySettingsCacheTime = now;
  return securitySettingsCache;
}

/**
 * Middleware: verify signed URL token if enabled.
 */
async function verifySignedUrl(req, res, videoId) {
  const security = await getSecuritySettings();

  if (!security.signedUrlsEnabled) return true;

  const token = req.query.token;
  if (!token) {
    res.status(403).json({ error: 'Access denied: signed URL required' });
    return false;
  }

  const clientIp = getClientIp(req);
  const result = verifyToken(token, videoId, clientIp);

  if (!result.valid) {
    res.status(403).json({ error: `Access denied: ${result.error}` });
    return false;
  }

  return true;
}

/**
 * Middleware: hotlink protection — check referer header.
 */
async function checkHotlink(req, res) {
  const security = await getSecuritySettings();

  if (!security.hotlinkProtectionEnabled) return true;

  const referer = req.headers.referer || req.headers.referrer || '';

  // Allow requests with no referer (direct access, some players)
  if (!referer) return true;

  try {
    const refererHost = new URL(referer).hostname;

    // Always allow same-origin requests
    const host = req.headers.host || '';
    if (refererHost === host || refererHost === host.split(':')[0]) {
      return true;
    }

    // Check allowed domains
    const allowed = security.hotlinkAllowedDomains;
    if (allowed.length === 0) return true; // No domains configured = allow all

    const isAllowed = allowed.some(
      (domain) => refererHost === domain || refererHost.endsWith(`.${domain}`)
    );

    if (!isAllowed) {
      res.status(403).json({ error: 'Hotlink not allowed from this domain' });
      return false;
    }
  } catch {
    // Invalid referer URL, allow through
  }

  return true;
}

// GET /videos/:videoId/hls/:filename
router.get('/videos/:videoId/hls/:filename', async (req, res) => {
  try {
    const { videoId, filename } = req.params;

    if (!/^[a-zA-Z0-9_-]{1,12}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Security checks
    if (!(await checkHotlink(req, res))) return;
    if (!(await verifySignedUrl(req, res, videoId))) return;

    // Check video exists and is ready.
    // We also read encryption_enabled + storage_type so we can rewrite the
    // #EXT-X-KEY URI in variant .m3u8 playlists for Safari native HLS.
    const videoResult = await db.query(
      'SELECT id, status, visibility, encryption_enabled, storage_type FROM videos WHERE id = $1',
      [videoId]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = videoResult.rows[0];

    if (video.status !== 'ready') {
      return res.status(404).json({ error: 'Video not ready' });
    }

    if (video.visibility === 'private') {
      return res.status(403).json({ error: 'Video is private' });
    }

    const storageKey = `videos/${videoId}/hls/${filename}`;
    // Pass the URL path so getContentType can detect segments by folder
    // (any file in /hls/ with a registered segment extension → video/MP2T).
    const contentType = getContentType(filename, req.originalUrl || req.url);
    const isManifest = filename.endsWith('.m3u8');

    // ─────────────────────────────────────────────────────────────────
    // AES manifest rewrite path (Safari support).
    //
    // Safari's native HLS can't attach custom headers to key requests, so
    // it can't use the Bearer-token scheme HLS.js uses. Instead, when the
    // player appends `?aes_token=<JWT>` to the manifest URL, we rewrite
    // the `#EXT-X-KEY:...URI="..."` line inside the variant playlist to
    // include that token as a `?token=<JWT>` query parameter on the key
    // URI, which the key endpoint accepts.
    //
    // This path:
    //   - Only fires for .m3u8 files of encrypted videos with ?aes_token=
    //   - Validates the key token so we don't hand out tokens that would
    //     fail at the key endpoint (fail fast, clearer errors)
    //   - Sets Cache-Control: no-store (token is viewer-specific)
    //   - Uses storage.readFile (works for R2 and local) because we can't
    //     stream + rewrite simultaneously without extra plumbing
    // ─────────────────────────────────────────────────────────────────
    if (isManifest && video.encryption_enabled && req.query.aes_token) {
      const aesToken = String(req.query.aes_token);
      const clientIp = getClientIp(req);
      const keyVerify = verifyKeyToken(aesToken, videoId, clientIp);
      if (!keyVerify.valid) {
        return res.status(403).json({ error: `AES token invalid: ${keyVerify.error}` });
      }

      let body;
      try {
        body = await storage.readFile(storageKey, video.storage_type);
      } catch (e) {
        if (e.code === 'ENOENT') {
          return res.status(404).json({ error: 'Manifest not found' });
        }
        throw e;
      }
      const text = body.toString('utf8');

      // Rewrite 1: `#EXT-X-KEY:...URI="..."` → inject ?token= so Safari
      // can authenticate the key fetch.
      let rewritten = text.replace(
        /(#EXT-X-KEY:[^\n]*?URI=")([^"]+)(")/g,
        (_m, pre, uri, post) => {
          const sep = uri.includes('?') ? '&' : '?';
          return pre + uri + sep + 'token=' + encodeURIComponent(aesToken) + post;
        }
      );

      // Rewrite 2: `#EXT-X-MEDIA:...URI="..."` → inject ?aes_token= so
      // Safari fetches alternate audio playlists (e.g., audio_ac3.m3u8)
      // with the token. Without this, the audio playlist would be fetched
      // without authentication → its #EXT-X-KEY rewrite never happens →
      // 401 on key fetch for the audio track.
      rewritten = rewritten.replace(
        /(#EXT-X-MEDIA:[^\n]*?URI=")([^"]+)(")/g,
        (_m, pre, uri, post) => {
          const sep = uri.includes('?') ? '&' : '?';
          return pre + uri + sep + 'aes_token=' + encodeURIComponent(aesToken) + post;
        }
      );

      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Vary': 'Origin',
      });
      return res.status(200).send(rewritten);
    }
    // ─────────────────────────────────────────────────────────────────
    // End AES rewrite path; everything below is the unchanged fast path.
    // ─────────────────────────────────────────────────────────────────

    const result = await storage.getFile(storageKey);

    if (result.redirect) {
      return res.redirect(302, result.redirect);
    }

    // For encrypted manifests with NO aes_token (e.g., HLS.js using the
    // Bearer header scheme, or an unauthenticated poke), still disable
    // caching — otherwise a cached manifest could leak to a different
    // viewer whose Bearer token should be independently validated.
    let cacheControl = 'public, max-age=31536000, immutable';
    if (isManifest) {
      cacheControl = video.encryption_enabled
        ? 'private, no-store, no-cache, must-revalidate'
        : 'public, max-age=300';
    }

    res.set({
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
    });

    result.stream.on('error', (err) => {
      if (!res.headersSent) {
        if (err.code === 'ENOENT') {
          res.status(404).json({ error: 'File not found' });
        } else {
          console.error('CDN stream error:', err);
          res.status(500).json({ error: 'Failed to deliver file' });
        }
      }
    });

    result.stream.pipe(res);
  } catch (err) {
    if (res.headersSent) return;
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (err.code === 'FORBIDDEN') {
      return res.status(403).json({ error: 'Access denied' });
    }
    console.error('CDN delivery error:', err);
    res.status(500).json({ error: 'Failed to deliver file' });
  }
});

// GET /videos/:videoId/thumbnail.jpg
router.get('/videos/:videoId/thumbnail.jpg', async (req, res) => {
  try {
    const { videoId } = req.params;

    if (!/^[a-zA-Z0-9_-]{1,12}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }

    // Hotlink check (no signed URL needed for thumbnails)
    if (!(await checkHotlink(req, res))) return;

    const videoResult = await db.query(
      'SELECT id, status, visibility FROM videos WHERE id = $1',
      [videoId]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = videoResult.rows[0];
    if (video.visibility === 'private') {
      return res.status(403).json({ error: 'Video is private' });
    }

    const storageKey = `videos/${videoId}/hls/thumbnail.jpg`;
    const result = await storage.getFile(storageKey);

    if (result.redirect) {
      return res.redirect(302, result.redirect);
    }

    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });

    result.stream.on('error', (err) => {
      if (!res.headersSent) {
        if (err.code === 'ENOENT') {
          res.status(404).json({ error: 'Thumbnail not found' });
        } else {
          res.status(500).json({ error: 'Failed to deliver thumbnail' });
        }
      }
    });

    result.stream.pipe(res);
  } catch (err) {
    if (res.headersSent) return;
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Thumbnail not found' });
    }
    console.error('CDN thumbnail error:', err);
    res.status(500).json({ error: 'Failed to deliver thumbnail' });
  }
});

// GET /videos/:videoId/subtitles/:filename
router.get('/videos/:videoId/subtitles/:filename', async (req, res) => {
  try {
    const { videoId, filename } = req.params;

    if (!/^[a-zA-Z0-9_-]{1,12}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (!(await checkHotlink(req, res))) return;
    if (!(await verifySignedUrl(req, res, videoId))) return;

    const videoResult = await db.query(
      'SELECT id, visibility FROM videos WHERE id = $1',
      [videoId]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (videoResult.rows[0].visibility === 'private') {
      return res.status(403).json({ error: 'Video is private' });
    }

    const storageKey = `videos/${videoId}/subtitles/${filename}`;
    const contentType = getContentType(filename, req.originalUrl || req.url);
    const result = await storage.getFile(storageKey);

    if (result.redirect) {
      return res.redirect(302, result.redirect);
    }

    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });

    result.stream.on('error', (err) => {
      if (!res.headersSent) {
        if (err.code === 'ENOENT') {
          res.status(404).json({ error: 'Subtitle not found' });
        } else {
          res.status(500).json({ error: 'Failed to deliver subtitle' });
        }
      }
    });

    result.stream.pipe(res);
  } catch (err) {
    if (res.headersSent) return;
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Subtitle not found' });
    }
    console.error('CDN subtitle error:', err);
    res.status(500).json({ error: 'Failed to deliver subtitle' });
  }
});

// GET /branding/:filename - Serve logo/watermark images (public, no auth)
router.get('/branding/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const storageKey = `branding/${filename}`;
    const ext = filename.substring(filename.lastIndexOf('.'));
    const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                   '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml' }[ext] || 'image/png';

    const result = await storage.getFile(storageKey);
    if (!result) return res.status(404).json({ error: 'Logo not found' });

    res.set({
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    });

    if (result.stream) {
      result.stream.pipe(res);
    } else if (result.buffer) {
      res.send(result.buffer);
    } else {
      res.status(404).json({ error: 'Logo not found' });
    }
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Logo not found' });
    console.error('CDN branding error:', err);
    res.status(500).json({ error: 'Failed to deliver logo' });
  }
});

// GET /branding/avatars/:filename — Serve team-member avatar images (public, no auth)
router.get('/branding/avatars/:filename', async (req, res) => {
  try {
    const path = require('path');
    const fs = require('fs');
    const filename = req.params.filename;
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    const AVATAR_DIR = path.join(process.cwd(), 'storage', 'local', 'branding', 'avatars');
    const filePath = path.join(AVATAR_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Avatar not found' });

    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    const mime = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                   '.gif':'image/gif', '.webp':'image/webp' }[ext] || 'image/png';
    res.set({
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('CDN avatar error:', err);
    res.status(500).json({ error: 'Failed to deliver avatar' });
  }
});

// CORS preflight for all CDN routes
router.options('*', (req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Origin',
    'Access-Control-Max-Age': '86400',
  });
  res.sendStatus(204);
});

module.exports = router;
