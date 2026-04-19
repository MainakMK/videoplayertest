const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const db      = require('../db/index.js');
const auth    = require('../middleware/auth');
const { audit } = require('../services/audit');

const { authLimiter } = require('../middleware/rate-limit');

const router = express.Router();
const TOKEN_EXPIRY = '24h';
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

function generateToken(admin, sessionId) {
  return jwt.sign(
    { id: admin.id, email: admin.email, role: admin.role || 'owner', jti: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function setTokenCookie(res, token) {
  res.cookie('token', token, {
    httpOnly: true,
    // secure: true forces HTTPS-only transmission. Enabled in production so
    // the session cookie never travels over HTTP. Disabled in dev so
    // localhost (http://) works without SSL setup.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 86400000,
  });
}

// Parse a UA string into a short device label e.g. "Chrome on Windows"
function parseDevice(ua) {
  if (!ua) return 'Unknown device';
  const s = ua.toLowerCase();
  let browser = 'Browser';
  if (s.includes('firefox/')) browser = 'Firefox';
  else if (s.includes('edg/')) browser = 'Edge';
  else if (s.includes('opr/') || s.includes('opera')) browser = 'Opera';
  else if (s.includes('chrome/') && !s.includes('edg/')) browser = 'Chrome';
  else if (s.includes('safari/') && !s.includes('chrome/')) browser = 'Safari';
  let os = 'Unknown OS';
  if (s.includes('windows')) os = 'Windows';
  else if (s.includes('mac os x') || s.includes('macos')) os = 'macOS';
  else if (s.includes('android')) os = 'Android';
  else if (s.includes('iphone') || s.includes('ios')) os = 'iOS';
  else if (s.includes('linux')) os = 'Linux';
  return `${browser} on ${os}`;
}

// Create a session row and return its token_id
async function createSession(admin, req) {
  const tokenId = crypto.randomUUID();
  const userAgent = req.headers['user-agent'] || '';
  const deviceInfo = parseDevice(userAgent);
  const ipAddr = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '';
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MS);
  await db.query(
    `INSERT INTO admin_sessions (admin_id, token_id, user_agent, ip_address, device_info, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [admin.id, tokenId, userAgent, ipAddr, deviceInfo, expiresAt]
  );
  return tokenId;
}

// Multer: store avatar uploads in memory, we write to disk manually
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error('Avatar must be a PNG, JPG, WebP or GIF image.'));
    }
    cb(null, true);
  },
});

// POST /login  (2FA-aware) — strict rate limit applied here only
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const login = email || username;
    if (!login || !password) return res.status(400).json({ error: 'Email/username and password are required' });

    const result = await db.query('SELECT * FROM admins WHERE email = $1', [login]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const admin = result.rows[0];

    // Check if account is active
    if (admin.is_active === false) return res.status(401).json({ error: 'Account is disabled' });

    if (!await bcrypt.compare(password, admin.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });

    // Update last_login_at
    await db.query('UPDATE admins SET last_login_at = NOW() WHERE id = $1', [admin.id]);

    // 2FA gate — if enabled, return a short-lived temp token for the challenge step
    if (admin.totp_enabled) {
      const tempToken = jwt.sign({ id: admin.id, type: '2fa_challenge' }, process.env.JWT_SECRET, { expiresIn: '5m' });
      return res.json({ requires2fa: true, tempToken });
    }

    const sessionId = await createSession(admin, req);
    const token = generateToken(admin, sessionId);
    setTokenCookie(res, token);
    await audit(req, 'auth.login', 'admin', admin.id, { email: admin.email, device: parseDevice(req.headers['user-agent']) });
    res.json({
      token,
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role || 'owner',
        display_name: admin.display_name || admin.email,
        avatar_url: admin.avatar_url || null,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /logout
router.post('/logout', auth, async (req, res) => {
  // Revoke this session row so the token can't be reused elsewhere
  if (req.admin.session_id) {
    await db.query('DELETE FROM admin_sessions WHERE token_id = $1', [req.admin.session_id]);
  }
  await audit(req, 'auth.logout', 'admin', req.admin.id, {});
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// POST /refresh-token
router.post('/refresh-token', auth, async (req, res) => {
  try {
    const sessionId = await createSession(req.admin, req);
    const token = generateToken(req.admin, sessionId);
    setTokenCookie(res, token);
    res.json({ token });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /password - Change password
router.put('/password', auth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const result = await db.query('SELECT * FROM admins WHERE id = $1', [req.admin.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(current_password, admin.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [newHash, req.admin.id]);

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /me
router.get('/me', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, role, display_name, created_at, avatar_url, last_login_at FROM admins WHERE id = $1',
      [req.admin.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    res.json({ admin: { ...result.rows[0], session_id: req.admin.session_id } });
  } catch (err) {
    console.error('Get admin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────

// GET /sessions — list current user's active sessions
router.get('/sessions', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, token_id, user_agent, ip_address, device_info, created_at, last_active_at, expires_at
       FROM admin_sessions
       WHERE admin_id = $1 AND expires_at > NOW()
       ORDER BY last_active_at DESC`,
      [req.admin.id]
    );
    const sessions = result.rows.map(s => ({
      id: s.id,
      token_id: s.token_id,
      user_agent: s.user_agent,
      ip_address: s.ip_address,
      device_info: s.device_info || 'Unknown device',
      created_at: s.created_at,
      last_active_at: s.last_active_at,
      expires_at: s.expires_at,
      is_current: s.token_id === req.admin.session_id,
    }));
    res.json({ sessions });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// DELETE /sessions/:id — revoke a specific session (of the current user)
router.delete('/sessions/:id', auth, async (req, res) => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (!sessionId) return res.status(400).json({ error: 'Invalid session id' });

    const result = await db.query(
      'DELETE FROM admin_sessions WHERE id = $1 AND admin_id = $2 RETURNING token_id',
      [sessionId, req.admin.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Session not found' });

    const isCurrent = result.rows[0].token_id === req.admin.session_id;
    await audit(req, 'auth.session_revoked', 'session', sessionId, { is_current: isCurrent });
    if (isCurrent) res.clearCookie('token');
    res.json({ message: 'Session revoked', is_current: isCurrent });
  } catch (err) {
    console.error('Revoke session error:', err);
    res.status(500).json({ error: 'Failed to revoke session' });
  }
});

// DELETE /sessions — revoke ALL sessions except the current one
router.delete('/sessions', auth, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM admin_sessions WHERE admin_id = $1 AND token_id <> $2 RETURNING id',
      [req.admin.id, req.admin.session_id || '']
    );
    await audit(req, 'auth.sessions_revoked_all', 'admin', req.admin.id, { revoked: result.rows.length });
    res.json({ message: 'Other sessions revoked', count: result.rows.length });
  } catch (err) {
    console.error('Revoke all sessions error:', err);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

// ─────────────────────────────────────────
// LOGIN HISTORY (current user only — works for every role)
// ─────────────────────────────────────────
router.get('/login-history', auth, async (req, res) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit) || 5);
    const result = await db.query(
      `SELECT id, action, ip_address, details, created_at
       FROM audit_log
       WHERE admin_id = $1 AND action IN ('auth.login', 'auth.logout', 'auth.2fa_enabled', 'auth.2fa_disabled')
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.admin.id, limit]
    );
    res.json({ entries: result.rows });
  } catch (err) {
    console.error('Login history error:', err);
    res.status(500).json({ error: 'Failed to fetch login history' });
  }
});

// ─────────────────────────────────────────
// AVATAR UPLOAD
// ─────────────────────────────────────────
const AVATAR_DIR = path.join(process.cwd(), 'storage', 'local', 'branding', 'avatars');
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

router.post('/avatar', auth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const ext = (req.file.originalname.match(/\.(png|jpe?g|webp|gif)$/i) || [null, 'png'])[0].replace('.', '') || 'png';
    const fileName = `avatar-${req.admin.id}-${Date.now()}.${ext.toLowerCase()}`;
    const filePath = path.join(AVATAR_DIR, fileName);
    fs.writeFileSync(filePath, req.file.buffer);

    // Public URL served by /cdn/branding
    const publicUrl = `/cdn/branding/avatars/${fileName}`;

    // Remove old avatar file (best-effort)
    const prev = await db.query('SELECT avatar_url FROM admins WHERE id = $1', [req.admin.id]);
    const prevUrl = prev.rows[0]?.avatar_url || '';
    if (prevUrl && prevUrl.startsWith('/cdn/branding/avatars/')) {
      const prevPath = path.join(AVATAR_DIR, path.basename(prevUrl));
      if (fs.existsSync(prevPath)) { try { fs.unlinkSync(prevPath); } catch(e) {} }
    }

    await db.query('UPDATE admins SET avatar_url = $1 WHERE id = $2', [publicUrl, req.admin.id]);
    await audit(req, 'auth.avatar_update', 'admin', req.admin.id, {});
    res.json({ avatar_url: publicUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload avatar' });
  }
});

router.delete('/avatar', auth, async (req, res) => {
  try {
    const prev = await db.query('SELECT avatar_url FROM admins WHERE id = $1', [req.admin.id]);
    const prevUrl = prev.rows[0]?.avatar_url || '';
    if (prevUrl && prevUrl.startsWith('/cdn/branding/avatars/')) {
      const prevPath = path.join(AVATAR_DIR, path.basename(prevUrl));
      if (fs.existsSync(prevPath)) { try { fs.unlinkSync(prevPath); } catch(e) {} }
    }
    await db.query('UPDATE admins SET avatar_url = NULL WHERE id = $1', [req.admin.id]);
    await audit(req, 'auth.avatar_remove', 'admin', req.admin.id, {});
    res.json({ message: 'Avatar removed' });
  } catch (err) {
    console.error('Avatar delete error:', err);
    res.status(500).json({ error: 'Failed to remove avatar' });
  }
});

module.exports = router;
