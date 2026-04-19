/**
 * 2FA (TOTP) routes
 * Endpoints:
 *   POST /api/2fa/setup       — generate secret + QR URI (pre-enable)
 *   POST /api/2fa/verify      — verify token + enable 2FA
 *   POST /api/2fa/disable     — disable 2FA (requires current password)
 *   GET  /api/2fa/status      — is 2FA enabled for current admin?
 *   POST /api/2fa/backup      — regenerate backup codes
 *
 * Login flow with 2FA:
 *   /api/auth/login returns { requires2fa: true, tempToken } when 2FA is on.
 *   Frontend then calls POST /api/2fa/challenge with { tempToken, totpCode }.
 *   POST /api/2fa/challenge   — complete login with TOTP code
 */
const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const db      = require('../db/index.js');
const auth    = require('../middleware/auth');
const { generateSecret, totpVerify, totpUri, generateBackupCodes } = require('../services/totp');
const { audit } = require('../services/audit');

const router = express.Router();

// ─── Helper ──────────────────────────────────────────────────────────────────
function makeTempToken(adminId) {
  return jwt.sign({ id: adminId, type: '2fa_challenge' }, process.env.JWT_SECRET, { expiresIn: '5m' });
}
function verifyTempToken(token) {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    if (p.type !== '2fa_challenge') return null;
    return p;
  } catch { return null; }
}

// ─── GET /status ─────────────────────────────────────────────────────────────
router.get('/status', auth, async (req, res) => {
  try {
    const r = await db.query('SELECT totp_enabled FROM admins WHERE id = $1', [req.admin.id]);
    res.json({ enabled: r.rows[0]?.totp_enabled || false });
  } catch (e) {
    res.status(500).json({ error: 'Failed to get 2FA status' });
  }
});

// ─── POST /setup ─────────────────────────────────────────────────────────────
// Generate a new secret + QR URI. Does NOT enable 2FA yet — that happens on /verify.
router.post('/setup', auth, async (req, res) => {
  try {
    const adminRow = await db.query('SELECT email FROM admins WHERE id = $1', [req.admin.id]);
    const email = adminRow.rows[0]?.email || 'admin';

    const secret = generateSecret();
    const uri    = totpUri(secret, email);

    // Store secret (unconfirmed) temporarily — will be activated on /verify
    await db.query('UPDATE admins SET totp_secret = $1 WHERE id = $2', [secret, req.admin.id]);

    res.json({ secret, uri });
  } catch (e) {
    console.error('2FA setup error:', e);
    res.status(500).json({ error: 'Failed to set up 2FA' });
  }
});

// ─── POST /verify ─────────────────────────────────────────────────────────────
// Confirm the admin scanned the QR and provide a valid code → enable 2FA.
router.post('/verify', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });

    const r = await db.query('SELECT totp_secret FROM admins WHERE id = $1', [req.admin.id]);
    const secret = r.rows[0]?.totp_secret;
    if (!secret) return res.status(400).json({ error: 'Run /setup first' });

    if (!totpVerify(secret, String(token).replace(/\s/g, ''))) {
      return res.status(401).json({ error: 'Invalid code — check your authenticator app' });
    }

    const codes = generateBackupCodes(8);
    const hashed = await Promise.all(codes.map(c => bcrypt.hash(c.replace(/-/g, ''), 10)));

    await db.query(
      'UPDATE admins SET totp_enabled = TRUE, totp_backup_codes = $1 WHERE id = $2',
      [JSON.stringify(hashed), req.admin.id]
    );

    await audit(req, 'auth.2fa_enabled', 'admin', req.admin.id, {});

    res.json({ enabled: true, backupCodes: codes });
  } catch (e) {
    console.error('2FA verify error:', e);
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

// ─── POST /disable ────────────────────────────────────────────────────────────
router.post('/disable', auth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required to disable 2FA' });

    const r = await db.query('SELECT password_hash FROM admins WHERE id = $1', [req.admin.id]);
    const valid = await bcrypt.compare(password, r.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    await db.query(
      'UPDATE admins SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = $1 WHERE id = $2',
      ['[]', req.admin.id]
    );

    await audit(req, 'auth.2fa_disabled', 'admin', req.admin.id, {});
    res.json({ enabled: false });
  } catch (e) {
    console.error('2FA disable error:', e);
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

// ─── POST /backup ─────────────────────────────────────────────────────────────
// Regenerate backup codes (requires active 2FA + current password).
router.post('/backup', auth, async (req, res) => {
  try {
    const { password } = req.body;
    const r = await db.query('SELECT password_hash, totp_enabled FROM admins WHERE id = $1', [req.admin.id]);
    if (!r.rows[0]?.totp_enabled) return res.status(400).json({ error: '2FA is not enabled' });
    const valid = await bcrypt.compare(password || '', r.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    const codes = generateBackupCodes(8);
    const hashed = await Promise.all(codes.map(c => bcrypt.hash(c.replace(/-/g, ''), 10)));
    await db.query('UPDATE admins SET totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(hashed), req.admin.id]);

    res.json({ backupCodes: codes });
  } catch (e) {
    res.status(500).json({ error: 'Failed to regenerate backup codes' });
  }
});

// ─── POST /challenge ─────────────────────────────────────────────────────────
// Complete login when 2FA is enabled. Called after /api/auth/login returns requires2fa.
router.post('/challenge', async (req, res) => {
  try {
    const { tempToken, totpCode, backupCode } = req.body;
    if (!tempToken) return res.status(400).json({ error: 'tempToken required' });

    const payload = verifyTempToken(tempToken);
    if (!payload) return res.status(401).json({ error: 'Invalid or expired temp token' });

    const r = await db.query(
      'SELECT id, email, role, display_name, totp_secret, totp_backup_codes FROM admins WHERE id = $1',
      [payload.id]
    );
    const admin = r.rows[0];
    if (!admin) return res.status(401).json({ error: 'Admin not found' });

    let authenticated = false;

    // Try TOTP code first
    if (totpCode) {
      authenticated = totpVerify(admin.totp_secret, String(totpCode).replace(/\s/g, ''));
    }

    // Try backup code
    if (!authenticated && backupCode) {
      const normalized = backupCode.replace(/-/g, '').toUpperCase();
      const storedCodes = JSON.parse(admin.totp_backup_codes || '[]');
      for (let i = 0; i < storedCodes.length; i++) {
        if (await bcrypt.compare(normalized, storedCodes[i])) {
          // Consume the backup code (remove it)
          storedCodes.splice(i, 1);
          await db.query('UPDATE admins SET totp_backup_codes = $1 WHERE id = $2', [JSON.stringify(storedCodes), admin.id]);
          authenticated = true;
          break;
        }
      }
    }

    if (!authenticated) {
      return res.status(401).json({ error: 'Invalid authenticator code' });
    }

    // Update last_login_at
    await db.query('UPDATE admins SET last_login_at = NOW() WHERE id = $1', [admin.id]);

    // Create a session row and issue a JWT tied to it
    const crypto = require('crypto');
    const tokenId = crypto.randomUUID();
    const userAgent = req.headers['user-agent'] || '';
    const ua = userAgent.toLowerCase();
    let browser = 'Browser';
    if (ua.includes('firefox/')) browser = 'Firefox';
    else if (ua.includes('edg/')) browser = 'Edge';
    else if (ua.includes('chrome/') && !ua.includes('edg/')) browser = 'Chrome';
    else if (ua.includes('safari/') && !ua.includes('chrome/')) browser = 'Safari';
    let os = 'Unknown OS';
    if (ua.includes('windows')) os = 'Windows';
    else if (ua.includes('mac os x') || ua.includes('macos')) os = 'macOS';
    else if (ua.includes('android')) os = 'Android';
    else if (ua.includes('iphone') || ua.includes('ios')) os = 'iOS';
    else if (ua.includes('linux')) os = 'Linux';
    const deviceInfo = `${browser} on ${os}`;
    const ipAddr = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.connection?.remoteAddress || '';
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      `INSERT INTO admin_sessions (admin_id, token_id, user_agent, ip_address, device_info, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.id, tokenId, userAgent, ipAddr, deviceInfo, expiresAt]
    );

    const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role || 'owner', jti: tokenId }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400000,
    });
    res.json({ token, admin: { id: admin.id, email: admin.email, role: admin.role || 'owner', display_name: admin.display_name || admin.email, avatar_url: admin.avatar_url || null } });
  } catch (e) {
    console.error('2FA challenge error:', e);
    res.status(500).json({ error: 'Failed to complete 2FA login' });
  }
});

module.exports = router;
