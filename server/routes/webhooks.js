const express = require('express');
const crypto = require('crypto');
const db = require('../db/index.js');
const auth = require('../middleware/auth');
const { requireMinRole } = require('../middleware/roles');

const router = express.Router();
router.use(auth, requireMinRole('admin'));

const VALID_EVENTS = [
  'video.uploaded',
  'video.ready',
  'video.error',
  'video.deleted',
];

// GET / - List all webhooks
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT value FROM settings WHERE key = 'webhooks'"
    );

    let webhooks = [];
    if (result.rows.length > 0 && result.rows[0].value) {
      try {
        webhooks = JSON.parse(result.rows[0].value);
      } catch {
        webhooks = [];
      }
    }

    // Mask secrets in response
    const masked = webhooks.map((w, i) => ({
      ...w,
      id: i,
      secret: w.secret ? '••••••••' : '',
    }));

    res.json({ webhooks: masked, available_events: VALID_EVENTS });
  } catch (err) {
    console.error('List webhooks error:', err);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// POST / - Add a webhook
router.post('/', async (req, res) => {
  try {
    const { url, events, secret } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // Load existing
    const result = await db.query(
      "SELECT value FROM settings WHERE key = 'webhooks'"
    );

    let webhooks = [];
    if (result.rows.length > 0 && result.rows[0].value) {
      try { webhooks = JSON.parse(result.rows[0].value); } catch { webhooks = []; }
    }

    // Generate secret if not provided
    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');

    webhooks.push({
      url,
      events: Array.isArray(events) ? events.filter(e => VALID_EVENTS.includes(e)) : [],
      secret: webhookSecret,
      active: true,
      created_at: new Date().toISOString(),
    });

    await db.query(
      `INSERT INTO settings (key, value, is_encrypted, updated_at)
       VALUES ('webhooks', $1, FALSE, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [JSON.stringify(webhooks)]
    );

    res.json({
      message: 'Webhook added',
      secret: webhookSecret,
    });
  } catch (err) {
    console.error('Add webhook error:', err);
    res.status(500).json({ error: 'Failed to add webhook' });
  }
});

// PUT /:index - Update a webhook
router.put('/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const { url, events, active } = req.body;

    const result = await db.query(
      "SELECT value FROM settings WHERE key = 'webhooks'"
    );

    let webhooks = [];
    if (result.rows.length > 0 && result.rows[0].value) {
      try { webhooks = JSON.parse(result.rows[0].value); } catch { webhooks = []; }
    }

    if (index < 0 || index >= webhooks.length) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    if (url !== undefined) {
      try { new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
      webhooks[index].url = url;
    }
    if (events !== undefined) {
      webhooks[index].events = Array.isArray(events) ? events.filter(e => VALID_EVENTS.includes(e)) : [];
    }
    if (active !== undefined) {
      webhooks[index].active = !!active;
    }

    await db.query(
      `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'webhooks'`,
      [JSON.stringify(webhooks)]
    );

    res.json({ message: 'Webhook updated' });
  } catch (err) {
    console.error('Update webhook error:', err);
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

// DELETE /:index - Delete a webhook
router.delete('/:index', async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);

    const result = await db.query(
      "SELECT value FROM settings WHERE key = 'webhooks'"
    );

    let webhooks = [];
    if (result.rows.length > 0 && result.rows[0].value) {
      try { webhooks = JSON.parse(result.rows[0].value); } catch { webhooks = []; }
    }

    if (index < 0 || index >= webhooks.length) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    webhooks.splice(index, 1);

    await db.query(
      `UPDATE settings SET value = $1, updated_at = NOW() WHERE key = 'webhooks'`,
      [JSON.stringify(webhooks)]
    );

    res.json({ message: 'Webhook deleted' });
  } catch (err) {
    console.error('Delete webhook error:', err);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// POST /test - Send a test webhook
router.post('/test', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format and block private/internal networks
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Only HTTP(S) URLs are allowed' });
      }
      const hostname = parsed.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
          || hostname.startsWith('10.') || hostname.startsWith('192.168.')
          || hostname.startsWith('172.') || hostname.endsWith('.local')) {
        return res.status(400).json({ error: 'Private/internal URLs are not allowed' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    const body = JSON.stringify({
      event: 'test',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook from your video platform' },
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Event': 'test' },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    res.json({
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Test webhook sent successfully' : `Failed with status ${response.status}`,
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
