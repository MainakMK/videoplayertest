const express = require('express');
const db = require('../db/index.js');
const auth = require('../middleware/auth');
const { requireMinRole } = require('../middleware/roles');

const router = express.Router();
router.use(auth, requireMinRole('admin'));

const ACTION_LABELS = {
  'video.upload':       { label: 'Video uploaded',      icon: 'upload' },
  'video.delete':       { label: 'Video deleted',       icon: 'delete' },
  'video.update':       { label: 'Video updated',       icon: 'edit' },
  'video.bulk_delete':  { label: 'Bulk delete',         icon: 'delete_sweep' },
  'video.bulk_edit':    { label: 'Bulk edit',           icon: 'edit_note' },
  'video.migrate':      { label: 'Storage migrated',    icon: 'swap_horiz' },
  'settings.update':    { label: 'Settings changed',    icon: 'settings' },
  'auth.login':         { label: 'Admin login',         icon: 'login' },
  'auth.logout':        { label: 'Admin logout',        icon: 'logout' },
  'auth.password':      { label: 'Password changed',    icon: 'key' },
  'auth.2fa_enabled':   { label: '2FA enabled',         icon: 'verified_user' },
  'auth.2fa_disabled':  { label: '2FA disabled',        icon: 'gpp_bad' },
  'api_key.create':     { label: 'API key created',     icon: 'vpn_key' },
  'api_key.revoke':     { label: 'API key revoked',     icon: 'block' },
  'webhook.create':     { label: 'Webhook created',     icon: 'webhook' },
  'webhook.delete':     { label: 'Webhook deleted',     icon: 'webhook' },
  'ssl.add':            { label: 'SSL domain added',    icon: 'verified_user' },
  'ssl.delete':         { label: 'SSL domain removed',  icon: 'verified_user' },
  'folder.create':      { label: 'Folder created',      icon: 'create_new_folder' },
  'folder.delete':      { label: 'Folder deleted',      icon: 'folder_delete' },
  'team.invite':        { label: 'Team member invited', icon: 'person_add' },
  'team.update':        { label: 'Team member updated', icon: 'manage_accounts' },
  'team.delete':        { label: 'Team member removed', icon: 'person_remove' },
  'team.password_reset':{ label: 'Password reset',      icon: 'lock_reset' },
};

// GET / — list audit log entries (paginated)
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    const action = req.query.action || null;

    let whereMain = '';
    let whereCount = '';
    const params = [limit, offset];
    if (action) {
      params.push(action);
      whereMain = `WHERE al.action = $${params.length}`;
      whereCount = `WHERE action = $1`;
    }

    const [rows, countRow] = await Promise.all([
      db.query(
        `SELECT al.id, al.admin_id, a.email AS admin_email, a.display_name AS admin_name,
                al.action, al.resource_type, al.resource_id, al.details, al.ip_address, al.created_at
         FROM audit_log al
         LEFT JOIN admins a ON a.id = al.admin_id
         ${whereMain}
         ORDER BY al.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      ),
      db.query(`SELECT COUNT(*) FROM audit_log ${whereCount}`, action ? [action] : []),
    ]);

    const entries = rows.rows.map(r => ({
      ...r,
      label: ACTION_LABELS[r.action]?.label || r.action,
      icon:  ACTION_LABELS[r.action]?.icon  || 'info',
    }));

    res.json({
      entries,
      pagination: {
        page,
        limit,
        total: parseInt(countRow.rows[0].count),
        pages: Math.ceil(parseInt(countRow.rows[0].count) / limit),
      },
    });
  } catch (err) {
    console.error('Audit log fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// GET /actions — list distinct action types (for filter dropdown)
router.get('/actions', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT DISTINCT action FROM audit_log ORDER BY action'
    );
    res.json({ actions: result.rows.map(r => r.action) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch actions' });
  }
});

// DELETE / — clear all audit logs (owner only)
const { requireRole } = require('../middleware/roles');
router.delete('/', requireRole('owner'), async (req, res) => {
  try {
    await db.query('DELETE FROM audit_log');
    res.json({ message: 'Audit log cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear audit log' });
  }
});

module.exports = router;
