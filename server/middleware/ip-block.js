const db = require('../db/index');

// Cache IP block list for 60s
let blockedIpsCache = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

function getClientIp(req) {
  return req.headers['cf-connecting-ip']
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.ip;
}

/**
 * Match an IP against a pattern.
 * Supports exact IPs and CIDR-like wildcards (e.g. 192.168.1.*)
 */
function ipMatches(ip, pattern) {
  if (pattern === ip) return true;

  // Wildcard matching (e.g. 192.168.*)
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '\\d+') + '$');
    return regex.test(ip);
  }

  return false;
}

let ipBlockingEnabledCache = false;

async function getBlockedIps() {
  const now = Date.now();
  if (blockedIpsCache && (now - cacheTime) < CACHE_TTL) {
    return blockedIpsCache;
  }

  try {
    const result = await db.query(
      "SELECT key, value FROM settings WHERE key IN ('blocked_ips', 'ip_blocking_enabled')"
    );

    ipBlockingEnabledCache = false;
    blockedIpsCache = [];

    for (const row of result.rows) {
      if (row.key === 'ip_blocking_enabled') {
        ipBlockingEnabledCache = row.value === 'true';
      }
      if (row.key === 'blocked_ips' && row.value) {
        blockedIpsCache = row.value
          .split(',')
          .map(ip => ip.trim())
          .filter(Boolean);
      }
    }
  } catch {
    blockedIpsCache = [];
  }

  cacheTime = now;
  return blockedIpsCache;
}

/**
 * Clear the IP block cache (call after updating blocked IPs).
 */
function clearIpBlockCache() {
  blockedIpsCache = null;
  cacheTime = 0;
}

/**
 * Express middleware that blocks requests from IPs in the block list.
 */
async function ipBlockMiddleware(req, res, next) {
  try {
    const blockedIps = await getBlockedIps();

    if (!ipBlockingEnabledCache || blockedIps.length === 0) {
      return next();
    }

    const clientIp = getClientIp(req);

    const isBlocked = blockedIps.some(pattern => ipMatches(clientIp, pattern));

    if (isBlocked) {
      return res.status(403).json({ error: 'Access denied' });
    }

    next();
  } catch {
    // On error, don't block — fail open
    next();
  }
}

module.exports = { ipBlockMiddleware, clearIpBlockCache };
