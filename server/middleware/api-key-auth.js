const crypto = require('crypto');
const db = require('../db/index');

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Middleware that authenticates requests using an API key.
 * Accepts key via:
 *   - Header: Authorization: Bearer vp_xxx
 *   - Header: X-API-Key: vp_xxx
 *   - Query: ?api_key=vp_xxx
 *
 * @param {string[]} [requiredPermissions] - Permissions needed (e.g. ['read'], ['write']).
 *   If empty/omitted, any valid key is accepted.
 */
function apiKeyAuth(requiredPermissions = []) {
  return async (req, res, next) => {
    // Extract key from various sources
    let key = null;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer vp_')) {
      key = authHeader.slice(7);
    }

    if (!key && req.headers['x-api-key']) {
      key = req.headers['x-api-key'];
    }

    if (!key && req.query.api_key) {
      key = req.query.api_key;
    }

    if (!key) {
      return res.status(401).json({ error: 'API key required' });
    }

    // Validate prefix
    if (!key.startsWith('vp_')) {
      return res.status(401).json({ error: 'Invalid API key format' });
    }

    try {
      const keyHash = hashKey(key);

      const result = await db.query(
        'SELECT id, permissions, expires_at FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const apiKey = result.rows[0];

      // Check expiry
      if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
        return res.status(401).json({ error: 'API key has expired' });
      }

      // Check permissions
      const permissions = apiKey.permissions || [];
      if (requiredPermissions.length > 0) {
        // 'admin' permission grants everything
        if (!permissions.includes('admin')) {
          const hasPermission = requiredPermissions.every(p => permissions.includes(p));
          if (!hasPermission) {
            return res.status(403).json({ error: 'Insufficient permissions' });
          }
        }
      }

      // Update last_used_at (non-blocking)
      db.query(
        'UPDATE api_keys SET last_used_at = NOW() WHERE id = $1',
        [apiKey.id]
      ).catch(() => {});

      // Attach to request
      req.apiKeyId = apiKey.id;
      req.apiKeyPermissions = permissions;

      next();
    } catch (err) {
      console.error('API key auth error:', err);
      res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

module.exports = apiKeyAuth;
