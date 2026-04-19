const jwt = require('jsonwebtoken');
const db  = require('../db');

const auth = async (req, res, next) => {
  let token = null;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  if (!token && req.cookies) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify account is still active and get current role from DB (source of truth)
    const result = await db.query(
      'SELECT is_active, role, display_name, avatar_url FROM admins WHERE id = $1',
      [decoded.id]
    );

    if (!result.rows.length || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Account is disabled' });
    }

    // If the token has a session_id (jti), verify it hasn't been revoked.
    // Tokens issued before session tracking existed (no `jti`) still pass here for backwards compatibility.
    if (decoded.jti) {
      const sessionResult = await db.query(
        'SELECT id FROM admin_sessions WHERE token_id = $1 AND admin_id = $2 AND expires_at > NOW()',
        [decoded.jti, decoded.id]
      );
      if (!sessionResult.rows.length) {
        return res.status(401).json({ error: 'Session has been revoked' });
      }
      // Bump last_active_at asynchronously (don't block the request)
      db.query('UPDATE admin_sessions SET last_active_at = NOW() WHERE token_id = $1', [decoded.jti])
        .catch(err => console.error('Failed to bump session last_active_at:', err.message));
    }

    req.admin = {
      id: decoded.id,
      email: decoded.email,
      role: result.rows[0].role || 'editor',
      display_name: result.rows[0].display_name || decoded.email,
      avatar_url: result.rows[0].avatar_url || null,
      session_id: decoded.jti || null,
    };
    req.user = req.admin;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

module.exports = auth;
