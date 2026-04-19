const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';

// Default token TTL: 6 hours (covers long viewing sessions)
const DEFAULT_TTL = 6 * 60 * 60;

/**
 * Generate a signed token for CDN access.
 * @param {string} videoId - The video ID to grant access to.
 * @param {object} [options]
 * @param {number} [options.ttl] - Token lifetime in seconds (default: 6h).
 * @param {string} [options.ip] - Bind token to a specific IP.
 * @returns {string} JWT token.
 */
function generateToken(videoId, options = {}) {
  const ttl = options.ttl || DEFAULT_TTL;
  const payload = { vid: videoId };

  if (options.ip) {
    payload.ip = options.ip;
  }

  return jwt.sign(payload, SECRET, { expiresIn: ttl });
}

/**
 * Verify a signed CDN token.
 * @param {string} token - The JWT token from query string.
 * @param {string} videoId - Expected video ID.
 * @param {string} [clientIp] - Client IP for IP-binding verification.
 * @returns {{ valid: boolean, error?: string }}
 */
function verifyToken(token, videoId, clientIp) {
  try {
    const decoded = jwt.verify(token, SECRET);

    // Check video ID matches
    if (decoded.vid !== videoId) {
      return { valid: false, error: 'Token video mismatch' };
    }

    // Check IP binding if token has one
    if (decoded.ip && clientIp && decoded.ip !== clientIp) {
      return { valid: false, error: 'IP mismatch' };
    }

    return { valid: true };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    return { valid: false, error: 'Invalid token' };
  }
}

/**
 * Generate a short-lived token for the AES key endpoint.
 *
 * Separate from the CDN segment token (different `purpose` claim) so a leaked
 * key token can't be used to bypass segment authorization, and vice-versa.
 *
 * Default TTL is 2 hours — long enough for any reasonable viewing session but
 * short enough that a leaked token from browser devtools has bounded value.
 *
 * @param {string} videoId
 * @param {object} [options]
 * @param {number} [options.ttl]  Seconds; default 2h.
 * @param {string} [options.ip]   Bind to client IP.
 */
function generateKeyToken(videoId, options = {}) {
  const ttl = options.ttl || (2 * 60 * 60);
  const payload = { vid: videoId, purpose: 'key' };
  if (options.ip) payload.ip = options.ip;
  return jwt.sign(payload, SECRET, { expiresIn: ttl });
}

/**
 * Verify a key-endpoint token. Enforces the `purpose: 'key'` claim so a CDN
 * segment token can't be used here.
 */
function verifyKeyToken(token, videoId, clientIp) {
  try {
    const decoded = jwt.verify(token, SECRET);
    if (decoded.purpose !== 'key') {
      return { valid: false, error: 'Wrong token purpose' };
    }
    if (decoded.vid !== videoId) {
      return { valid: false, error: 'Token video mismatch' };
    }
    if (decoded.ip && clientIp && decoded.ip !== clientIp) {
      return { valid: false, error: 'IP mismatch' };
    }
    return { valid: true };
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return { valid: false, error: 'Token expired' };
    }
    return { valid: false, error: 'Invalid token' };
  }
}

module.exports = { generateToken, verifyToken, generateKeyToken, verifyKeyToken };
