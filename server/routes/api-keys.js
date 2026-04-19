const express = require('express');
const crypto = require('crypto');
const db = require('../db/index.js');
const auth = require('../middleware/auth');
const { requireMinRole } = require('../middleware/roles');

const router = express.Router();
router.use(auth, requireMinRole('admin'));

/**
 * Generate a secure random API key.
 * Format: vp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (36 chars total)
 */
function generateApiKey() {
  return 'vp_' + crypto.randomBytes(24).toString('hex');
}

/**
 * Hash an API key for storage.
 */
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// GET / - List all API keys (key itself is never shown again after creation)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, permissions, created_at, expires_at, last_used_at,
              CONCAT('vp_', REPEAT('*', 12), RIGHT(key_hash, 8)) as key_preview
       FROM api_keys
       ORDER BY created_at DESC`
    );
    res.json({ api_keys: result.rows });
  } catch (err) {
    console.error('List API keys error:', err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// POST / - Create a new API key
router.post('/', async (req, res) => {
  try {
    const { name, permissions, expires_in_days } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Generate key
    const plainKey = generateApiKey();
    const keyHash = hashKey(plainKey);

    // Parse permissions
    const validPermissions = ['read', 'write', 'upload', 'delete', 'admin'];
    const perms = Array.isArray(permissions)
      ? permissions.filter(p => validPermissions.includes(p))
      : ['read'];

    // Calculate expiry
    let expiresAt = null;
    if (expires_in_days && expires_in_days > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expires_in_days);
    }

    const result = await db.query(
      `INSERT INTO api_keys (key_hash, name, permissions, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, permissions, created_at, expires_at`,
      [keyHash, name.trim(), JSON.stringify(perms), expiresAt]
    );

    res.json({
      api_key: result.rows[0],
      // Only show the plain key ONCE at creation time
      key: plainKey,
      message: 'API key created. Copy it now — it will not be shown again.',
    });
  } catch (err) {
    console.error('Create API key error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// PUT /:id - Update API key (name, permissions, expiry)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, permissions, expires_in_days } = req.body;

    const existing = await db.query('SELECT id FROM api_keys WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(name.trim());
    }

    if (permissions !== undefined) {
      const validPermissions = ['read', 'write', 'upload', 'delete', 'admin'];
      const perms = Array.isArray(permissions)
        ? permissions.filter(p => validPermissions.includes(p))
        : ['read'];
      updates.push(`permissions = $${idx++}`);
      values.push(JSON.stringify(perms));
    }

    if (expires_in_days !== undefined) {
      if (expires_in_days === null || expires_in_days === 0) {
        updates.push(`expires_at = NULL`);
      } else {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expires_in_days);
        updates.push(`expires_at = $${idx++}`);
        values.push(expiresAt);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    values.push(id);
    await db.query(
      `UPDATE api_keys SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    res.json({ message: 'API key updated' });
  } catch (err) {
    console.error('Update API key error:', err);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// DELETE /:id - Revoke/delete an API key
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM api_keys WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ message: `API key "${result.rows[0].name}" revoked` });
  } catch (err) {
    console.error('Delete API key error:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

module.exports = router;
