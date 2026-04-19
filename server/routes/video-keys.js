/**
 * AES-128 HLS encryption key delivery endpoint.
 *
 * Serves the decrypted 16-byte AES key for a video to the HLS player.
 * This is the URI that FFmpeg writes into `#EXT-X-KEY` during encoding.
 *
 * SECURITY:
 *   - Requires a short-lived JWT (purpose='key', bound to videoId).
 *     The token is minted by /api/player/:id and embedded in the page HTML
 *     so the player can attach it via HLS.js `xhrSetup`.
 *   - Token accepted via `?token=` query OR `Authorization: Bearer` header.
 *   - Cache-Control: no-store — the key MUST NOT sit in any browser/proxy
 *     cache. Every viewer fetches it fresh.
 *   - CORS: responds with Access-Control-Allow-Origin from the requesting
 *     origin because the player may be embedded on third-party sites.
 *     Browsers won't reuse a cached CORS preflight for `no-store` responses.
 *   - Video must be in status='ready' with encryption_enabled=true.
 *     This prevents leaking keys for videos still processing or deliberately
 *     deleted.
 */

const express = require('express');
const db = require('../db');
const { getKeyForVideo } = require('../services/aes-keys');
const { verifyKeyToken } = require('../services/signed-url');
const { audit } = require('../services/audit');

const router = express.Router();

/**
 * Record a failed key fetch. We use audit_log because:
 *   - It already has IP + user-agent + timestamp + JSONB details columns
 *   - The existing Audit tab in the dashboard will surface these events
 *     so admins can spot brute-force / scraping attempts
 *
 * We intentionally DO NOT log successful fetches — for a busy platform
 * that's N views * M viewers of audit-log spam with no defensive value.
 * Failed fetches are the interesting ones. `req.admin` is always null here
 * (viewer context, not an admin), so audit_log.admin_id will be NULL.
 *
 * Rate-limit the logs themselves so an attacker can't fill the audit_log
 * table by spamming failed requests: we debounce to 1 log per IP per
 * minute per reason.
 */
const _keyLogDebounce = new Map();
function _shouldLogFailure(ip, reason) {
  const key = `${ip || 'unknown'}|${reason}`;
  const now = Date.now();
  const last = _keyLogDebounce.get(key) || 0;
  if (now - last < 60_000) return false;
  _keyLogDebounce.set(key, now);
  // Cheap cleanup: if the map grows beyond 10k entries, wipe old ones.
  if (_keyLogDebounce.size > 10_000) {
    for (const [k, t] of _keyLogDebounce) {
      if (now - t > 60_000) _keyLogDebounce.delete(k);
    }
  }
  return true;
}
async function logKeyFailure(req, videoId, reason, extra = {}) {
  try {
    const ip = req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.ip;
    if (!_shouldLogFailure(ip, reason)) return;
    await audit(req, 'video.key_fetch_failed', 'video', videoId, { reason, ...extra });
  } catch (_) { /* never let audit break playback */ }
}

// CORS preflight — permissive because embedded players run cross-origin.
router.options('/:video_id', (req, res) => {
  const origin = req.headers.origin || '*';
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Max-Age', '600');
  res.status(204).end();
});

router.get('/:video_id', async (req, res) => {
  // Always set CORS + no-cache headers, even on errors, so HLS.js receives a
  // useful response in third-party embeds.
  const origin = req.headers.origin || '*';
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Vary', 'Origin');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');

  try {
    const { video_id } = req.params;

    // Token can arrive either way — HLS.js typically uses xhrSetup to add
    // the Authorization header, but a ?token= fallback is useful for native
    // HLS players (Safari) that don't support custom headers on key requests.
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;
    const token = bearerToken || req.query.token;

    if (!token) {
      logKeyFailure(req, video_id, 'missing_token');
      return res.status(401).json({ error: 'Missing token' });
    }

    const clientIp = req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.ip;

    const verified = verifyKeyToken(token, video_id, clientIp);
    if (!verified.valid) {
      logKeyFailure(req, video_id, 'invalid_token', { detail: verified.error });
      return res.status(403).json({ error: verified.error || 'Invalid token' });
    }

    // Require the video to actually exist AND have encryption enabled.
    // Without this, a revoked/deleted video's key could still be handed out
    // if the token hasn't expired yet.
    const videoResult = await db.query(
      'SELECT status, encryption_enabled FROM videos WHERE id = $1',
      [video_id]
    );
    if (!videoResult.rows.length) {
      logKeyFailure(req, video_id, 'video_not_found');
      return res.status(404).json({ error: 'Video not found' });
    }
    const video = videoResult.rows[0];
    if (!video.encryption_enabled) {
      logKeyFailure(req, video_id, 'encryption_disabled');
      return res.status(404).json({ error: 'Video is not encrypted' });
    }
    if (video.status !== 'ready') {
      logKeyFailure(req, video_id, 'video_not_ready', { status: video.status });
      return res.status(409).json({ error: 'Video is not ready' });
    }

    // Fetch + decrypt the key (aes-keys.getKeyForVideo returns a raw Buffer).
    const keyBytes = await getKeyForVideo(video_id);
    if (!keyBytes || keyBytes.length !== 16) {
      console.error(`[video-keys] Key missing or wrong length for ${video_id}`);
      logKeyFailure(req, video_id, 'key_unavailable');
      return res.status(500).json({ error: 'Key unavailable' });
    }

    // Deliver the key as raw 16 bytes. HLS.js reads the response body as
    // an ArrayBuffer and passes it to the Web Crypto AES-128-CBC decoder.
    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Length', '16');
    return res.status(200).end(keyBytes);
  } catch (err) {
    console.error('[video-keys] Delivery error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
