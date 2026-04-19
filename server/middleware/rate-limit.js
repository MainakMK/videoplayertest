const db = require('../db/index');
const Redis = require('ioredis');

// Cache settings for 60s
let settingsCache = null;
let settingsCacheTime = 0;
const CACHE_TTL = 60_000;

// ─────────────────────────────────────────────────────────────────────────────
// Redis-backed counter storage (with in-memory fallback if Redis is down)
// ─────────────────────────────────────────────────────────────────────────────
//
// Why Redis? The old implementation kept counters in a per-process Map.
// In a multi-instance deployment (multiple Node.js workers behind a load
// balancer), each instance had its own counters — an attacker could get
// N× the allowed rate by hitting different instances.
//
// With Redis, all instances share the same counter per IP, so rate limits
// are enforced globally. If Redis is unavailable, we fall back to
// in-memory counters (fail-open on availability, not security — better
// to serve requests than block legitimate users over Redis flake).
// ─────────────────────────────────────────────────────────────────────────────

let redisClient = null;
let redisHealthy = false;
const fallbackHits = new Map();

function getRedisClient() {
  if (redisClient) return redisClient;
  if (!process.env.REDIS_URL) return null;
  try {
    redisClient = new Redis(process.env.REDIS_URL, {
      // Don't spam logs if Redis is down during startup
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    redisClient.on('ready', () => {
      redisHealthy = true;
      console.log('[rate-limit] Redis connected');
    });
    redisClient.on('error', (err) => {
      if (redisHealthy) {
        console.warn('[rate-limit] Redis error, falling back to in-memory:', err.message);
      }
      redisHealthy = false;
    });
    redisClient.on('end', () => { redisHealthy = false; });
    return redisClient;
  } catch (e) {
    console.warn('[rate-limit] Failed to init Redis, using in-memory fallback:', e.message);
    return null;
  }
}

/**
 * Increment the counter for a (settingKey, ip) pair and return the
 * current count + reset time. Uses Redis atomically (INCR + EXPIRE)
 * when available, falls back to in-memory Map otherwise.
 *
 * @returns {Promise<{count: number, resetTime: number}>}
 */
async function incrementCounter(settingKey, ip, windowMs) {
  const client = getRedisClient();
  const key = `rl:${settingKey}:${ip}`;
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));

  // Try Redis first
  if (client && redisHealthy) {
    try {
      // MULTI: increment counter; set expiry only on first increment.
      // Using SET + EXPIRE together avoids TTL resetting on every hit.
      const results = await client.multi()
        .incr(key)
        .pttl(key)
        .exec();
      let count = results[0][1];
      let pttl = results[1][1];
      // If key didn't have an expiry (first hit), set one now
      if (pttl < 0) {
        await client.pexpire(key, windowMs);
        pttl = windowMs;
      }
      return { count, resetTime: Date.now() + pttl };
    } catch (err) {
      // Fall through to in-memory on Redis failure
      redisHealthy = false;
    }
  }

  // In-memory fallback (per-process, not multi-instance safe)
  const now = Date.now();
  let entry = fallbackHits.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + windowMs };
    fallbackHits.set(key, entry);
  }
  entry.count++;
  return { count: entry.count, resetTime: entry.resetTime };
}

// Cleanup fallback map every 5 minutes (prevents unbounded growth)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of fallbackHits) {
    if (now > entry.resetTime) fallbackHits.delete(key);
  }
}, 5 * 60_000).unref();

const DEFAULTS = {
  rate_limit_enabled: true,
  rate_limit_api: 100,
  rate_limit_auth: 10,
  rate_limit_auth_window: 15,
  rate_limit_player: 60,
  rate_limit_cdn: 500,
  rate_limit_upload: 5,
  // AES key endpoint: in normal playback HLS.js fetches the key ONCE per
  // session. A legitimate user refreshing the page might hit this a handful
  // of times; anything higher is almost certainly an attacker or broken
  // client. Keep the ceiling low to limit brute-force / scraping attempts.
  rate_limit_aes_key: 20,
};

async function getRateLimitSettings() {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime) < CACHE_TTL) {
    return settingsCache;
  }

  try {
    const result = await db.query(
      "SELECT key, value FROM settings WHERE key LIKE 'rate_limit_%'"
    );

    const settings = { ...DEFAULTS };
    for (const row of result.rows) {
      if (row.key === 'rate_limit_enabled') {
        settings.rate_limit_enabled = row.value !== 'false';
      } else if (row.value && !isNaN(Number(row.value))) {
        settings[row.key] = Number(row.value);
      }
    }

    settingsCache = settings;
    settingsCacheTime = now;
    return settings;
  } catch {
    return DEFAULTS;
  }
}

/**
 * Clear the settings cache (call after updating rate limit settings).
 */
function clearRateLimitCache() {
  settingsCache = null;
  settingsCacheTime = 0;
}

/**
 * Create a configurable rate limiter that reads limits from DB and stores
 * counters in Redis (falling back to in-memory if Redis is unavailable).
 *
 * @param {string} settingKey - The settings key for this limiter's max value.
 * @param {number} defaultMax - Default max if setting not found.
 * @param {number} windowMs - Time window in ms.
 * @param {string} message - Error message.
 */
function configurableRateLimit(settingKey, defaultMax, windowMs, message) {
  return async (req, res, next) => {
    try {
      const settings = await getRateLimitSettings();

      // Global toggle — if disabled, skip all rate limiting
      if (!settings.rate_limit_enabled) {
        return next();
      }

      const max = settings[settingKey] || defaultMax;
      const window = settingKey === 'rate_limit_auth'
        ? (settings.rate_limit_auth_window || 15) * 60_000
        : windowMs;

      const ip = req.headers['cf-connecting-ip']
        || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.ip;

      const { count, resetTime } = await incrementCounter(settingKey, ip, window);

      const remaining = Math.max(0, max - count);
      res.set({
        'X-RateLimit-Limit': String(max),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetTime / 1000)),
      });

      if (count > max) {
        res.set('Retry-After', String(Math.ceil((resetTime - Date.now()) / 1000)));
        return res.status(429).json({ error: message });
      }

      next();
    } catch {
      // On error, don't block — fail open
      next();
    }
  };
}

const apiLimiter = configurableRateLimit(
  'rate_limit_api', 100, 60_000,
  'Too many API requests, please try again later'
);

const authLimiter = configurableRateLimit(
  'rate_limit_auth', 10, 15 * 60_000,
  'Too many login attempts, please try again later'
);

const playerLimiter = configurableRateLimit(
  'rate_limit_player', 60, 60_000,
  'Too many requests'
);

const cdnLimiter = configurableRateLimit(
  'rate_limit_cdn', 500, 60_000,
  'Too many requests'
);

const uploadLimiter = configurableRateLimit(
  'rate_limit_upload', 5, 60_000,
  'Upload rate limit exceeded'
);

// AES key delivery: tighter than playerLimiter because normal playback only
// fetches the key ONCE per session.
const aesKeyLimiter = configurableRateLimit(
  'rate_limit_aes_key', 20, 60_000,
  'Too many key requests'
);

module.exports = {
  configurableRateLimit,
  clearRateLimitCache,
  apiLimiter,
  authLimiter,
  playerLimiter,
  cdnLimiter,
  uploadLimiter,
  aesKeyLimiter,
};
