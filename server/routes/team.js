const express = require('express');
const bcrypt  = require('bcrypt');
const db      = require('../db/index.js');
const auth    = require('../middleware/auth');
const { requireMinRole, requireRole } = require('../middleware/roles');
const { audit } = require('../services/audit');
const { sendWelcomeEmail } = require('../services/email');

const router = express.Router();
router.use(auth);
router.use(requireMinRole('admin'));

// GET / — list all team members
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, display_name, role, is_active, created_at, last_login_at, invited_by, totp_enabled
       FROM admins ORDER BY created_at ASC`
    );
    res.json({ members: result.rows });
  } catch (err) {
    console.error('Team list error:', err);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

// POST / — invite/create a team member
router.post('/', async (req, res) => {
  try {
    const { email, user_email, password, display_name, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!['admin', 'editor'].includes(role)) {
      return res.status(400).json({ error: 'Role must be admin or editor' });
    }

    // Admins can only create editors
    if (req.admin.role === 'admin' && role !== 'editor') {
      return res.status(403).json({ error: 'Admins can only invite editors' });
    }

    // Only owner can create admins
    if (role === 'admin' && req.admin.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can create admin accounts' });
    }

    const hash = await bcrypt.hash(password, 12);

    const result = await db.query(
      `INSERT INTO admins (email, password_hash, role, display_name, invited_by, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, email, display_name, role, is_active, created_at`,
      [email, hash, role, display_name || email, req.admin.id]
    );

    await audit(req, 'team.invite', 'admin', result.rows[0].id, { email, role });

    // Send welcome email if requested and email address provided
    let emailSent = false;
    if (req.body.send_email && user_email) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const dashboardUrl = `${protocol}://${host}`;
      emailSent = await sendWelcomeEmail(user_email, display_name || email, email, password, role, dashboardUrl);
    }

    res.status(201).json({ member: result.rows[0], email_sent: emailSent });
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'A member with this email already exists' });
    }
    console.error('Team create error:', err);
    res.status(500).json({ error: 'Failed to create team member' });
  }
});

// PUT /:id — update member (owner only for role/active changes)
router.put('/:id', async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    const { display_name, role, is_active } = req.body;

    // Fetch the target member
    const target = await db.query('SELECT * FROM admins WHERE id = $1', [memberId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Member not found' });

    const member = target.rows[0];

    // Cannot modify the owner account's role
    if (member.role === 'owner' && role && role !== 'owner') {
      return res.status(403).json({ error: 'Cannot change the owner role' });
    }

    // Cannot make someone else owner
    if (role === 'owner') {
      return res.status(403).json({ error: 'Cannot assign owner role' });
    }

    // Non-owner admins can only edit editors
    if (req.admin.role === 'admin') {
      if (member.role !== 'editor') {
        return res.status(403).json({ error: 'Admins can only edit editors' });
      }
      // Admins can't change role to admin
      if (role === 'admin') {
        return res.status(403).json({ error: 'Admins cannot promote to admin' });
      }
    }

    // Cannot disable yourself
    if (memberId === req.admin.id && is_active === false) {
      return res.status(400).json({ error: 'Cannot disable your own account' });
    }

    // Build update
    const updates = [];
    const values = [];
    let i = 1;

    if (display_name !== undefined) { updates.push(`display_name = $${i++}`); values.push(display_name); }
    if (role !== undefined && req.admin.role === 'owner') { updates.push(`role = $${i++}`); values.push(role); }
    if (is_active !== undefined && req.admin.role === 'owner') { updates.push(`is_active = $${i++}`); values.push(is_active); }

    if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

    values.push(memberId);
    const result = await db.query(
      `UPDATE admins SET ${updates.join(', ')} WHERE id = $${i}
       RETURNING id, email, display_name, role, is_active, created_at, last_login_at`,
      values
    );

    await audit(req, 'team.update', 'admin', memberId, { changes: req.body });
    res.json({ member: result.rows[0] });
  } catch (err) {
    console.error('Team update error:', err);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

// DELETE /:id — delete member (owner only)
router.delete('/:id', requireRole('owner'), async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);

    // Cannot delete yourself
    if (memberId === req.admin.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Fetch target
    const target = await db.query('SELECT email, role FROM admins WHERE id = $1', [memberId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Member not found' });

    if (target.rows[0].role === 'owner') {
      return res.status(403).json({ error: 'Cannot delete the owner account' });
    }

    await db.query('DELETE FROM admins WHERE id = $1 AND role != $2', [memberId, 'owner']);

    await audit(req, 'team.delete', 'admin', memberId, { email: target.rows[0].email });
    res.json({ message: 'Team member deleted' });
  } catch (err) {
    console.error('Team delete error:', err);
    res.status(500).json({ error: 'Failed to delete team member' });
  }
});

// POST /:id/reset-password — owner resets a member's password
router.post('/:id/reset-password', requireRole('owner'), async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    const { new_password } = req.body;

    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const target = await db.query('SELECT id, email FROM admins WHERE id = $1', [memberId]);
    if (!target.rows.length) return res.status(404).json({ error: 'Member not found' });

    // Don't allow resetting own password via this endpoint
    if (memberId === req.admin.id) {
      return res.status(400).json({ error: 'Use Account Settings to change your own password' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [hash, memberId]);

    await audit(req, 'team.password_reset', 'admin', memberId, { email: target.rows[0].email });
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Team password reset error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
