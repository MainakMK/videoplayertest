/**
 * Per-route CORS policies.
 *
 * The app has THREE traffic patterns with different CORS needs:
 *
 *   1. ADMIN API (/api/auth, /api/settings, /api/videos, etc.)
 *      → Called from the admin dashboard (same/known origin)
 *      → Uses httpOnly cookies for auth (credentials: true)
 *      → MUST restrict origin or we're vulnerable to CSRF-like attacks
 *
 *   2. PUBLIC PLAYER API (/api/player, /api/video-keys, /api/player/event)
 *      → Called from embed iframes on ANY third-party site
 *      → Uses URL/Bearer tokens (NOT cookies)
 *      → Safe to allow any origin because credentials: false
 *
 *   3. CDN ROUTES (/cdn/*)
 *      → Served as static content to any embedder
 *      → Uses URL tokens (NOT cookies)
 *      → Safe to allow any origin
 *
 * By splitting policies, an attacker on malicious.com can't CSRF the admin
 * (strict CORS blocks them), but your embedded player on medium.com keeps
 * working (permissive CORS allows the read).
 */

const cors = require('cors');
const db = require('../db');

// 60s cache of allowed origins (from DB domain_settings + env vars)
let originCache = null;
let originCacheTime = 0;

/**
 * Compute the list of allowed origins for the admin API.
 * Sources, in priority order:
 *   1. Env var CORS_ADMIN_ORIGINS (comma-separated)
 *   2. DB domain_settings: dashboard domain + player domain
 *   3. Always include localhost for dev
 */
async function getAdminOrigins() {
  const now = Date.now();
  if (originCache && (now - originCacheTime) < 60_000) return originCache;

  const origins = new Set();

  // Env var override (for multi-domain deployments)
  if (process.env.CORS_ADMIN_ORIGINS) {
    process.env.CORS_ADMIN_ORIGINS.split(',').forEach(o => {
      const trimmed = o.trim();
      if (trimmed) origins.add(trimmed);
    });
  }

  // DB-configured dashboard + player domains
  try {
    const r = await db.query(
      "SELECT domain FROM domain_settings WHERE is_active = true AND service_type IN ('admin', 'embed')"
    );
    r.rows.forEach(row => {
      if (row.domain) {
        origins.add(`https://${row.domain}`);
        origins.add(`http://${row.domain}`);   // for dev / non-HTTPS setups
      }
    });
  } catch (_) { /* DB might be down — fall back to env + localhost */ }

  // Always allow localhost (dev, testing). 3002 is the Next.js dashboard dev port.
  origins.add('http://localhost:3000');
  origins.add('http://localhost:3001');
  origins.add('http://localhost:3002');
  origins.add('http://127.0.0.1:3000');
  origins.add('http://127.0.0.1:3001');
  origins.add('http://127.0.0.1:3002');

  originCache = Array.from(origins);
  originCacheTime = now;
  return originCache;
}

/**
 * Clear the origin cache (called when admin changes domain settings).
 */
function clearOriginCache() {
  originCache = null;
  originCacheTime = 0;
}

/**
 * CORS for admin API routes — strict allowlist, credentials enabled (cookies).
 */
const adminCors = cors({
  origin: async function (origin, callback) {
    // No origin = same-origin request (curl, server-to-server, or same-site nav)
    // → allow. Browsers only send Origin on cross-origin requests.
    if (!origin) return callback(null, true);

    try {
      const allowed = await getAdminOrigins();
      if (allowed.includes(origin)) {
        return callback(null, true);
      }
      // Not allowed — reply without Access-Control-Allow-Origin.
      // Browser will block the response.
      return callback(null, false);
    } catch (err) {
      console.warn('[cors] admin origin check failed:', err.message);
      return callback(null, false);
    }
  },
  credentials: true,   // cookies allowed
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
});

/**
 * CORS for public player + CDN routes — allow any origin, NO credentials.
 *
 * Since these endpoints don't use cookies (only URL/Bearer tokens), there's
 * no CSRF risk in letting any origin call them. Required for the embed
 * player to work when iframed on third-party sites.
 */
const publicCors = cors({
  origin: true,         // reflect request origin (any)
  credentials: false,   // NO cookies — tokens only
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposedHeaders: ['Content-Length', 'Content-Range'],
});

module.exports = { adminCors, publicCors, getAdminOrigins, clearOriginCache };
