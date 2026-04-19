const express = require('express');
const db = require('../db/index.js');
const auth = require('../middleware/auth');
const { requireMinRole } = require('../middleware/roles');
const { encrypt, decrypt } = require('../services/encryption');
const storage = require('../services/storage');

const router = express.Router();
// All settings routes require admin role or higher
router.use(auth, requireMinRole('admin'));

const ENCRYPTED_KEYS = [
  'r2_account_id',
  'r2_access_key_id',
  'r2_secret_access_key',
];

function maskValue(value) {
  if (!value || value.length <= 4) return '****';
  return '*'.repeat(value.length - 4) + value.slice(-4);
}

// GET / - Get all settings
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT key, value, is_encrypted, updated_at FROM settings ORDER BY key');

    const settings = {};
    for (const row of result.rows) {
      let value = row.value;
      if (row.is_encrypted && value) {
        try {
          const decrypted = decrypt(value);
          value = maskValue(decrypted);
        } catch {
          value = '****';
        }
      }
      settings[row.key] = {
        value,
        is_encrypted: row.is_encrypted,
        updated_at: row.updated_at,
      };
    }

    res.json({ settings });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
});

// PUT / - Update multiple settings
router.put('/', async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    const entries = Object.entries(settings);
    for (const [key, value] of entries) {
      const shouldEncrypt = ENCRYPTED_KEYS.includes(key);
      const storedValue = shouldEncrypt && value ? encrypt(value) : value;

      await db.query(
        `INSERT INTO settings (key, value, is_encrypted, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, is_encrypted = $3, updated_at = NOW()`,
        [key, storedValue, shouldEncrypt]
      );
    }

    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// PUT /storage - Update R2 credentials (no global storage mode)
router.put('/storage', async (req, res) => {
  try {
    const {
      r2_account_id,
      r2_access_key_id,
      r2_secret_access_key,
      r2_bucket_name,
      r2_public_url,
    } = req.body;

    const updates = {
      r2_account_id: { value: r2_account_id, encrypted: true },
      r2_access_key_id: { value: r2_access_key_id, encrypted: true },
      r2_secret_access_key: { value: r2_secret_access_key, encrypted: true },
      r2_bucket_name: { value: r2_bucket_name, encrypted: false },
      r2_public_url: { value: r2_public_url, encrypted: false },
    };

    for (const [key, { value, encrypted }] of Object.entries(updates)) {
      if (value === undefined) continue;
      const storedValue = encrypted && value ? encrypt(value) : value;

      await db.query(
        `INSERT INTO settings (key, value, is_encrypted, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, is_encrypted = $3, updated_at = NOW()`,
        [key, storedValue, encrypted]
      );
    }

    res.json({ message: 'Storage settings updated successfully' });
  } catch (err) {
    console.error('Update storage settings error:', err);
    res.status(500).json({ error: 'Failed to update storage settings' });
  }
});

// POST /storage/test - Test R2 connection
router.post('/storage/test', async (req, res) => {
  try {
    const { r2_account_id, r2_access_key_id, r2_secret_access_key, r2_bucket_name } = req.body;

    if (!r2_account_id || !r2_access_key_id || !r2_secret_access_key || !r2_bucket_name) {
      return res.status(400).json({ error: 'All R2 credentials are required' });
    }

    const result = await storage.testR2Connection({
      accountId: r2_account_id,
      accessKeyId: r2_access_key_id,
      secretAccessKey: r2_secret_access_key,
      bucketName: r2_bucket_name,
    });

    res.json({ success: true, message: 'R2 connection successful', result });
  } catch (err) {
    console.error('R2 connection test error:', err);
    res.status(400).json({ success: false, error: err.message || 'R2 connection failed' });
  }
});

// GET /storage/usage - Get storage usage stats for both local and R2
router.get('/storage/usage', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT storage_type, COUNT(*)::int as count,
              COALESCE(SUM(file_size), 0)::bigint as total_size
       FROM videos WHERE status = 'ready'
       GROUP BY storage_type`
    );

    const usage = { local: { count: 0, totalSize: 0 }, r2: { count: 0, totalSize: 0 } };
    for (const row of result.rows) {
      if (row.storage_type === 'local' || row.storage_type === 'r2') {
        usage[row.storage_type] = {
          count: row.count,
          totalSize: Number(row.total_size),
        };
      }
    }

    // Check if R2 is configured
    const r2Bucket = await storage.getSetting('r2_bucket_name');
    const r2Configured = !!(r2Bucket && r2Bucket.trim());

    // Videos added in the last 7 days (for the dashboard "this week" badge)
    const weeklyRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM videos
       WHERE created_at >= NOW() - INTERVAL '7 days'`
    );
    const createdLast7d = weeklyRes.rows[0].count;

    res.json({ usage, r2_configured: r2Configured, createdLast7d });
  } catch (err) {
    console.error('Storage usage error:', err);
    res.status(500).json({ error: 'Failed to get storage usage' });
  }
});

// POST /storage/cleanup - Run the cleanup pass on demand
router.post('/storage/cleanup', async (req, res) => {
  try {
    const { runStorageCleanup } = require('../services/cleanup');
    const days = parseInt(req.body.days, 10);
    const result = await runStorageCleanup({
      olderThanDays: days || null, // null = use saved setting
      requestedBy: req.admin?.id,
      triggerType: 'manual',
    });
    res.json({
      message: `Removed ${result.deleted} item(s)`,
      deleted: result.deleted,
      orphans: result.orphan?.removed || 0,
      bytesReclaimed: result.bytesReclaimed || 0,
      durationMs: result.durationMs || 0,
      runId: result.runId,
      details: result.details,
    });
  } catch (err) {
    console.error('Storage cleanup error:', err);
    res.status(500).json({ error: err.message || 'Cleanup failed' });
  }
});

// GET /storage/cleanup/history - List recent runs + 30-day summary
router.get('/storage/cleanup/history', async (req, res) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const [runs, summary] = await Promise.all([
      db.query(
        `SELECT id, trigger_type, triggered_by, videos_deleted, orphans_deleted,
                bytes_reclaimed, duration_ms, threshold_days, created_at
         FROM cleanup_runs
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      ),
      db.query(
        `SELECT
           COALESCE(SUM(videos_deleted),  0)::int   AS videos_total,
           COALESCE(SUM(orphans_deleted), 0)::int   AS orphans_total,
           COALESCE(SUM(bytes_reclaimed), 0)::bigint AS bytes_total,
           COUNT(*)::int AS run_count
         FROM cleanup_runs
         WHERE created_at > NOW() - INTERVAL '30 days'`
      ),
    ]);
    const s = summary.rows[0] || {};
    res.json({
      runs: runs.rows,
      summary: {
        videos_total:  Number(s.videos_total  || 0),
        orphans_total: Number(s.orphans_total || 0),
        bytes_total:   Number(s.bytes_total   || 0),
        run_count:     Number(s.run_count     || 0),
      },
    });
  } catch (err) {
    console.error('Cleanup history error:', err);
    res.status(500).json({ error: 'Failed to fetch cleanup history' });
  }
});

// DELETE /storage/cleanup/history - Clear the entire cleanup history (user-initiated)
router.delete('/storage/cleanup/history', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM cleanup_runs');
    const { audit } = require('../services/audit');
    await audit(req, 'storage.cleanup_history_cleared', 'storage', null, { cleared: result.rowCount });
    res.json({ message: 'Cleanup history cleared', cleared: result.rowCount });
  } catch (err) {
    console.error('Clear cleanup history error:', err);
    res.status(500).json({ error: 'Failed to clear cleanup history' });
  }
});

// GET /storage/cleanup/history.csv - CSV export of all history rows
router.get('/storage/cleanup/history.csv', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, trigger_type, triggered_by, videos_deleted, orphans_deleted,
              bytes_reclaimed, duration_ms, threshold_days, created_at
       FROM cleanup_runs
       ORDER BY created_at DESC`
    );

    const header = ['id','trigger_type','triggered_by','videos_deleted','orphans_deleted','bytes_reclaimed','duration_ms','threshold_days','created_at'];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const r of result.rows) {
      lines.push(header.map(k => esc(r[k])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cleanup-history-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'Failed to export cleanup history' });
  }
});

// PUT /security - Update security settings
router.put('/security', async (req, res) => {
  try {
    const {
      signed_urls_enabled, hotlink_protection_enabled, hotlink_allowed_domains,
      ip_blocking_enabled, blocked_ips,
      rate_limit_enabled, rate_limit_api, rate_limit_auth, rate_limit_auth_window,
      rate_limit_player, rate_limit_cdn, rate_limit_upload,
    } = req.body;

    const updates = {
      signed_urls_enabled: { value: String(!!signed_urls_enabled), encrypted: false },
      hotlink_protection_enabled: { value: String(!!hotlink_protection_enabled), encrypted: false },
      hotlink_allowed_domains: { value: hotlink_allowed_domains || '', encrypted: false },
      ip_blocking_enabled: { value: String(!!ip_blocking_enabled), encrypted: false },
      blocked_ips: { value: blocked_ips || '', encrypted: false },
      rate_limit_enabled: { value: String(rate_limit_enabled !== false), encrypted: false },
      rate_limit_api: { value: String(rate_limit_api || 100), encrypted: false },
      rate_limit_auth: { value: String(rate_limit_auth || 10), encrypted: false },
      rate_limit_auth_window: { value: String(rate_limit_auth_window || 15), encrypted: false },
      rate_limit_player: { value: String(rate_limit_player || 60), encrypted: false },
      rate_limit_cdn: { value: String(rate_limit_cdn || 500), encrypted: false },
      rate_limit_upload: { value: String(rate_limit_upload || 5), encrypted: false },
    };

    for (const [key, { value, encrypted }] of Object.entries(updates)) {
      if (value === undefined) continue;

      await db.query(
        `INSERT INTO settings (key, value, is_encrypted, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, is_encrypted = $3, updated_at = NOW()`,
        [key, value, encrypted]
      );
    }

    res.json({ message: 'Security settings updated successfully' });
  } catch (err) {
    console.error('Update security settings error:', err);
    res.status(500).json({ error: 'Failed to update security settings' });
  }
});

// PUT /domains - Update domain settings
router.put('/domains', async (req, res) => {
  try {
    const { domain_dashboard, domain_player, domain_cdn } = req.body;

    const updates = { domain_dashboard, domain_player, domain_cdn };

    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;

      await db.query(
        `INSERT INTO settings (key, value, is_encrypted, updated_at)
         VALUES ($1, $2, FALSE, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      );
    }

    res.json({ message: 'Domain settings updated successfully' });
  } catch (err) {
    console.error('Update domain settings error:', err);
    res.status(500).json({ error: 'Failed to update domain settings' });
  }
});

// ---------------------------------------------------------------------------
// CDN Domains (multi-CDN load balancing)
// ---------------------------------------------------------------------------

const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MAX_CDN_DOMAINS = 5;

// GET /cdn-domains - List all CDN domains
router.get('/cdn-domains', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, domain, cf_api_token, cf_zone_id, cf_email, cf_auth_type, is_active, sort_order, created_at FROM cloudflare_domains WHERE service_type = 'cdn' ORDER BY sort_order ASC"
    );

    const cdn_domains = result.rows.map(row => ({
      ...row,
      cf_api_token: row.cf_api_token ? maskValue(decrypt(row.cf_api_token)) : '',
      cf_email: row.cf_email ? maskValue(decrypt(row.cf_email)) : '',
      cf_auth_type: row.cf_auth_type || 'token',
    }));

    res.json({ cdn_domains });
  } catch (err) {
    console.error('Get CDN domains error:', err);
    res.status(500).json({ error: 'Failed to retrieve CDN domains' });
  }
});

// POST /cdn-domains - Add a CDN domain
router.post('/cdn-domains', async (req, res) => {
  try {
    const { domain, cf_api_token, cf_zone_id, cf_email, cf_auth_type } = req.body;
    const authType = cf_auth_type === 'global_key' ? 'global_key' : 'token';

    if (!domain || !DOMAIN_REGEX.test(domain)) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }
    if (!cf_zone_id) {
      return res.status(400).json({ error: 'Cloudflare Zone ID is required' });
    }
    if (!cf_api_token) {
      return res.status(400).json({ error: authType === 'global_key' ? 'Cloudflare Global API Key is required' : 'Cloudflare API Token is required' });
    }
    if (authType === 'global_key' && !cf_email) {
      return res.status(400).json({ error: 'Cloudflare email is required for Global API Key auth' });
    }

    // Check max limit
    const countResult = await db.query("SELECT COUNT(*) FROM cloudflare_domains WHERE service_type = 'cdn'");
    if (parseInt(countResult.rows[0].count) >= MAX_CDN_DOMAINS) {
      return res.status(400).json({ error: `Maximum ${MAX_CDN_DOMAINS} CDN domains allowed` });
    }

    // Check duplicate
    const dupResult = await db.query("SELECT id FROM cloudflare_domains WHERE domain = $1", [domain]);
    if (dupResult.rows.length > 0) {
      return res.status(400).json({ error: 'Domain already exists' });
    }

    const encryptedToken = encrypt(cf_api_token);
    const encryptedEmail = cf_email ? encrypt(cf_email) : null;
    const sortOrder = parseInt(countResult.rows[0].count);

    const result = await db.query(
      `INSERT INTO cloudflare_domains (domain, service_type, cf_api_token, cf_zone_id, cf_email, cf_auth_type, is_active, sort_order)
       VALUES ($1, 'cdn', $2, $3, $4, $5, TRUE, $6) RETURNING id, domain, cf_zone_id, cf_auth_type, is_active, sort_order, created_at`,
      [domain, encryptedToken, cf_zone_id, encryptedEmail, authType, sortOrder]
    );

    res.json({ cdn_domain: { ...result.rows[0], cf_api_token: maskValue(cf_api_token), cf_email: cf_email ? maskValue(cf_email) : '' } });
  } catch (err) {
    console.error('Add CDN domain error:', err);
    res.status(500).json({ error: 'Failed to add CDN domain' });
  }
});

// PUT /cdn-domains/:id - Update a CDN domain
router.put('/cdn-domains/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { domain, cf_api_token, cf_zone_id, cf_email, cf_auth_type, is_active } = req.body;

    // Verify exists
    const existing = await db.query("SELECT id FROM cloudflare_domains WHERE id = $1 AND service_type = 'cdn'", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'CDN domain not found' });
    }

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (domain !== undefined) {
      if (!DOMAIN_REGEX.test(domain)) {
        return res.status(400).json({ error: 'Invalid domain format' });
      }
      // Check duplicate (exclude self)
      const dupResult = await db.query("SELECT id FROM cloudflare_domains WHERE domain = $1 AND id != $2", [domain, id]);
      if (dupResult.rows.length > 0) {
        return res.status(400).json({ error: 'Domain already exists' });
      }
      updates.push(`domain = $${paramIdx++}`);
      values.push(domain);
    }
    if (cf_api_token !== undefined) {
      updates.push(`cf_api_token = $${paramIdx++}`);
      values.push(encrypt(cf_api_token));
    }
    if (cf_zone_id !== undefined) {
      updates.push(`cf_zone_id = $${paramIdx++}`);
      values.push(cf_zone_id);
    }
    if (cf_email !== undefined) {
      updates.push(`cf_email = $${paramIdx++}`);
      values.push(cf_email ? encrypt(cf_email) : null);
    }
    if (cf_auth_type !== undefined) {
      updates.push(`cf_auth_type = $${paramIdx++}`);
      values.push(cf_auth_type === 'global_key' ? 'global_key' : 'token');
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIdx++}`);
      values.push(!!is_active);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    await db.query(
      `UPDATE cloudflare_domains SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values
    );

    res.json({ message: 'CDN domain updated successfully' });
  } catch (err) {
    console.error('Update CDN domain error:', err);
    res.status(500).json({ error: 'Failed to update CDN domain' });
  }
});

// DELETE /cdn-domains/:id - Remove a CDN domain
router.delete('/cdn-domains/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("DELETE FROM cloudflare_domains WHERE id = $1 AND service_type = 'cdn' RETURNING id", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'CDN domain not found' });
    }
    res.json({ message: 'CDN domain removed successfully' });
  } catch (err) {
    console.error('Delete CDN domain error:', err);
    res.status(500).json({ error: 'Failed to remove CDN domain' });
  }
});

// GET /ads - Get ad configuration
router.get('/ads', async (req, res) => {
  try {
    const configResult = await db.query('SELECT * FROM ad_configurations LIMIT 1');
    const config = configResult.rows[0] || {};

    let entries = [];
    if (config.id) {
      const entriesResult = await db.query(
        'SELECT id, offset_type, time_offset, skip_offset, vast_url FROM ad_entries WHERE ad_config_id = $1 ORDER BY sort_order',
        [config.id]
      );
      entries = entriesResult.rows;
    }

    res.json({
      vast: {
        enabled: config.vast_enabled || false,
        ad_type: config.ad_type || 'vast',
        ad_title: config.ad_title || '',
        entries,
      },
      popup: {
        enabled: config.popup_enabled || false,
        popup_limit: config.popup_limit || 0,
        popup_url: config.popup_url || '',
      },
    });
  } catch (err) {
    console.error('Get ad settings error:', err);
    res.status(500).json({ error: 'Failed to retrieve ad settings' });
  }
});

// PUT /ads - Update ad configuration
router.put('/ads', async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const {
      vast_enabled, ad_type, ad_title, entries,
      popup_enabled, popup_limit, popup_url,
    } = req.body;

    // Upsert ad_configurations (singleton row)
    const configResult = await client.query('SELECT id FROM ad_configurations LIMIT 1');
    let configId;

    if (configResult.rows.length > 0) {
      configId = configResult.rows[0].id;
      await client.query(
        `UPDATE ad_configurations SET
          vast_enabled = $1, ad_type = $2, ad_title = $3,
          popup_enabled = $4, popup_limit = $5, popup_url = $6,
          updated_at = NOW()
         WHERE id = $7`,
        [!!vast_enabled, ad_type || 'vast', ad_title || '', !!popup_enabled, popup_limit || 0, popup_url || '', configId]
      );
    } else {
      const insertResult = await client.query(
        `INSERT INTO ad_configurations (vast_enabled, ad_type, ad_title, popup_enabled, popup_limit, popup_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [!!vast_enabled, ad_type || 'vast', ad_title || '', !!popup_enabled, popup_limit || 0, popup_url || '']
      );
      configId = insertResult.rows[0].id;
    }

    // Replace all ad entries
    await client.query('DELETE FROM ad_entries WHERE ad_config_id = $1', [configId]);

    if (Array.isArray(entries)) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        await client.query(
          `INSERT INTO ad_entries (ad_config_id, sort_order, offset_type, time_offset, skip_offset, vast_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [configId, i, entry.offset_type || 'preroll', entry.time_offset || '0', entry.skip_offset || 0, entry.vast_url || '']
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Ad settings saved successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update ad settings error:', err);
    res.status(500).json({ error: 'Failed to update ad settings' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Embed Settings (player color, autoplay, controls, loop)
// ---------------------------------------------------------------------------

// GET /embed - Get global embed settings
router.get('/embed', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM embed_settings WHERE video_id IS NULL LIMIT 1');
    res.json({ embed_settings: result.rows[0] || {} });
  } catch (err) {
    console.error('Get embed settings error:', err);
    res.status(500).json({ error: 'Failed to retrieve embed settings' });
  }
});

// PUT /embed - Update global embed settings (including branding)
router.put('/embed', async (req, res) => {
  try {
    const {
      player_color, autoplay, controls, loop,
      watermark_position, player_title,
      logo_opacity, logo_size, logo_link,
    } = req.body;

    if (player_color && !/^#[0-9a-fA-F]{6}$/.test(player_color)) {
      return res.status(400).json({ error: 'Invalid color format. Use hex like #00aaff' });
    }
    if (logo_opacity !== undefined && (logo_opacity < 0 || logo_opacity > 1)) {
      return res.status(400).json({ error: 'logo_opacity must be between 0 and 1' });
    }

    await db.query(
      `UPDATE embed_settings SET
        player_color        = COALESCE($1,  player_color),
        autoplay            = COALESCE($2,  autoplay),
        controls            = COALESCE($3,  controls),
        loop                = COALESCE($4,  loop),
        watermark_position  = COALESCE($5,  watermark_position),
        player_title        = COALESCE($6,  player_title),
        logo_opacity        = COALESCE($7,  logo_opacity),
        logo_size           = COALESCE($8,  logo_size),
        logo_link           = COALESCE($9,  logo_link)
       WHERE video_id IS NULL`,
      [
        player_color || null,
        autoplay     ?? null,
        controls     ?? null,
        loop         ?? null,
        watermark_position || null,
        player_title !== undefined ? player_title : null,
        logo_opacity !== undefined ? logo_opacity : null,
        logo_size    || null,
        logo_link    !== undefined ? logo_link    : null,
      ]
    );

    res.json({ message: 'Embed settings updated successfully' });
  } catch (err) {
    console.error('Update embed settings error:', err);
    res.status(500).json({ error: 'Failed to update embed settings' });
  }
});

// DELETE /embed/logo - Remove uploaded logo
router.delete('/embed/logo', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT logo_url FROM embed_settings WHERE video_id IS NULL LIMIT 1'
    );
    const logoUrl = result.rows[0]?.logo_url;

    // Delete from storage if local
    if (logoUrl && !logoUrl.startsWith('http')) {
      const fs   = require('fs');
      const path = require('path');
      const localPath = path.join(__dirname, '..', '..', logoUrl.replace(/^\//, ''));
      try { fs.unlinkSync(localPath); } catch (e) { /* ignore if already gone */ }
    }

    await db.query(
      "UPDATE embed_settings SET logo_url = NULL WHERE video_id IS NULL"
    );

    res.json({ message: 'Logo removed' });
  } catch (err) {
    console.error('Remove logo error:', err);
    res.status(500).json({ error: 'Failed to remove logo' });
  }
});

// POST /embed/logo - Upload a logo/watermark image
router.post('/embed/logo', (req, res, next) => {
  const { uploadThumbnail } = require('../middleware/upload');
  uploadThumbnail(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const storage  = require('../services/storage');
    const fs       = require('fs');
    const path     = require('path');

    const buffer      = fs.readFileSync(req.file.path);
    const ext         = path.extname(req.file.originalname).toLowerCase() || '.png';
    const storageKey  = `branding/logo${ext}`;

    await storage.uploadFileTo(storageKey, buffer, req.file.mimetype || 'image/png', 'local');
    fs.unlinkSync(req.file.path); // clean temp

    const logoUrl = `/cdn/${storageKey}`;

    await db.query(
      "UPDATE embed_settings SET logo_url = $1 WHERE video_id IS NULL",
      [logoUrl]
    );

    res.json({ logo_url: logoUrl });
  } catch (err) {
    console.error('Logo upload error:', err);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// SMTP / EMAIL SETTINGS
// ──────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────
// ENCODING CONFIG (FFmpeg quality + concurrency)
// ─────────────────────────────────────────
const encodingConfig = require('../services/encoding-config');

// GET /encoding — return current encoding config + valid ranges
router.get('/encoding', async (req, res) => {
  try {
    const cfg = await encodingConfig.loadEncodingConfig();
    res.json({
      config: {
        preset_tier: cfg.preset_tier,
        bitrate_2160p: cfg.bitrate_2160p,
        bitrate_1440p: cfg.bitrate_1440p,
        bitrate_1080p: cfg.bitrate_1080p,
        bitrate_720p: cfg.bitrate_720p,
        bitrate_480p: cfg.bitrate_480p,
        bitrate_360p: cfg.bitrate_360p,
        bitrate_240p: cfg.bitrate_240p,
        audio_bitrate: cfg.audio_bitrate,
        quality_concurrency: cfg.quality_concurrency,
        video_concurrency: cfg.video_concurrency,
        ffmpeg_preset: cfg.ffmpeg_preset,
        clone_top_quality: cfg.clone_top_quality,
        default_qualities: cfg.default_qualities,
        encrypt_new_videos: cfg.encrypt_new_videos,
        keyframe_seconds: cfg.keyframe_seconds,
        segment_extension: cfg.segment_extension,
        rate_control: cfg.rate_control,
        maxrate_ratio: cfg.maxrate_ratio,
        bufsize_ratio: cfg.bufsize_ratio,
        video_codec: cfg.video_codec,
        audio_mode: cfg.audio_mode,
        ac3_bitrate: cfg.ac3_bitrate,
        extra_ffmpeg_params: cfg.extra_ffmpeg_params,
      },
      ranges: encodingConfig.BITRATE_RANGES,
      validValues: {
        tiers: encodingConfig.VALID_TIERS,
        audio: encodingConfig.VALID_AUDIO,
        videoConcurrency: encodingConfig.VALID_VIDEO_CONCURRENCY,
        qualityConcurrency: encodingConfig.VALID_QUALITY_CONCURRENCY,
        ffmpegPresets: encodingConfig.VALID_PRESETS,
        keyframeSeconds: encodingConfig.VALID_KEYFRAME_SECONDS,
        segmentExtensions: encodingConfig.VALID_SEGMENT_EXTENSIONS,
        rateControls: encodingConfig.VALID_RATE_CONTROLS,
        maxrateRatioRange: encodingConfig.MAXRATE_RATIO_RANGE,
        bufsizeRatioRange: encodingConfig.BUFSIZE_RATIO_RANGE,
        videoCodecs: encodingConfig.VALID_VIDEO_CODECS,
        audioModes: encodingConfig.VALID_AUDIO_MODES,
        ac3Bitrates: encodingConfig.VALID_AC3_BITRATES,
        allQualities: encodingConfig.ALL_QUALITIES,
      },
      tierPresets: encodingConfig.TIER_PRESETS,
      defaults: encodingConfig.DEFAULTS,
    });
  } catch (err) {
    console.error('Get encoding config error:', err);
    res.status(500).json({ error: 'Failed to load encoding config' });
  }
});

// Singleton Bull queue — created once at module load. Re-creating per request
// opens new Redis connections every poll which is wasteful and slow.
let _settingsQueueSingleton = null;
function _getQueue() {
  if (_settingsQueueSingleton) return _settingsQueueSingleton;
  const Queue = require('bull');
  _settingsQueueSingleton = new Queue('video-processing', process.env.REDIS_URL);
  // Don't close on errors — keep retrying. Bull handles reconnects internally.
  _settingsQueueSingleton.on('error', (err) => {
    console.warn('[settings] Bull queue error (will reconnect):', err.message);
  });
  return _settingsQueueSingleton;
}

// GET /encoding/worker-status — current Bull queue stats (used by Restart Worker button)
router.get('/encoding/worker-status', async (req, res) => {
  try {
    const queue = _getQueue();
    const [waiting, active, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getDelayedCount(),
    ]);

    // Also check if a restart was already requested (timestamp from settings)
    const r = await db.query("SELECT value FROM settings WHERE key = 'worker_restart_requested_at'");
    const restartRequestedAt = r.rows[0]?.value || null;

    // Worker reports its boot time via heartbeat — read most recent
    const h = await db.query("SELECT value FROM settings WHERE key = 'worker_started_at'");
    const workerStartedAt = h.rows[0]?.value || null;

    // If the worker started AFTER the most recent restart request, the restart already happened
    let restartPending = false;
    if (restartRequestedAt && workerStartedAt) {
      restartPending = new Date(restartRequestedAt) > new Date(workerStartedAt);
    } else if (restartRequestedAt && !workerStartedAt) {
      restartPending = true;
    }

    res.json({
      activeJobs: active,
      waitingJobs: waiting,
      delayedJobs: delayed,
      totalPending: active + waiting + delayed,
      workerStartedAt,
      restartRequestedAt,
      restartPending,
    });
  } catch (err) {
    console.error('Worker status error:', err);
    res.status(500).json({ error: 'Failed to get worker status' });
  }
});

// POST /encoding/restart-worker — request worker process to gracefully exit
// (process manager — PM2/systemd/etc — must be configured to auto-respawn it)
router.post('/encoding/restart-worker', async (req, res) => {
  try {
    const queue = _getQueue();
    const active = await queue.getActiveCount();
    const waiting = await queue.getWaitingCount();

    const force = req.body?.force === true;

    if (active > 0 && !force) {
      return res.status(409).json({
        error: 'Worker has active jobs. Wait for them to finish, or pass force=true to drain & restart.',
        activeJobs: active,
        waitingJobs: waiting,
      });
    }

    // Set the timestamp — worker polls this every 10s and self-exits when seen
    const now = new Date().toISOString();
    await db.query(
      `INSERT INTO settings (key, value) VALUES ('worker_restart_requested_at', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [now]
    );

    const { audit } = require('../services/audit');
    await audit(req, 'worker.restart_requested', 'worker', null, { activeJobs: active, force });

    res.json({
      message: active > 0
        ? `Worker will drain ${active} active job(s) then restart (within ~10 seconds of completion).`
        : 'Worker will restart within 10 seconds.',
      activeJobs: active,
      waitingJobs: waiting,
      restartRequestedAt: now,
    });
  } catch (err) {
    console.error('Restart worker error:', err);
    res.status(500).json({ error: err.message || 'Failed to request worker restart' });
  }
});

// PUT /encoding — update encoding config (any subset of fields)
router.put('/encoding', async (req, res) => {
  try {
    const cfg = await encodingConfig.saveEncodingConfig(req.body || {});
    const { audit } = require('../services/audit');
    await audit(req, 'settings.update', 'encoding', null, { fields: Object.keys(req.body || {}) });
    res.json({
      message: 'Encoding settings saved',
      config: {
        preset_tier: cfg.preset_tier,
        bitrate_2160p: cfg.bitrate_2160p,
        bitrate_1440p: cfg.bitrate_1440p,
        bitrate_1080p: cfg.bitrate_1080p,
        bitrate_720p: cfg.bitrate_720p,
        bitrate_480p: cfg.bitrate_480p,
        bitrate_360p: cfg.bitrate_360p,
        bitrate_240p: cfg.bitrate_240p,
        audio_bitrate: cfg.audio_bitrate,
        quality_concurrency: cfg.quality_concurrency,
        video_concurrency: cfg.video_concurrency,
        ffmpeg_preset: cfg.ffmpeg_preset,
        clone_top_quality: cfg.clone_top_quality,
        default_qualities: cfg.default_qualities,
        encrypt_new_videos: cfg.encrypt_new_videos,
        keyframe_seconds: cfg.keyframe_seconds,
        segment_extension: cfg.segment_extension,
        rate_control: cfg.rate_control,
        maxrate_ratio: cfg.maxrate_ratio,
        bufsize_ratio: cfg.bufsize_ratio,
        video_codec: cfg.video_codec,
        audio_mode: cfg.audio_mode,
        ac3_bitrate: cfg.ac3_bitrate,
        extra_ffmpeg_params: cfg.extra_ffmpeg_params,
      },
    });
  } catch (err) {
    console.error('Save encoding config error:', err);
    res.status(400).json({ error: err.message || 'Failed to save encoding settings' });
  }
});

const SMTP_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_from_name', 'smtp_secure', 'smtp_provider'];

// GET /email — get SMTP settings (password masked)
router.get('/email', async (req, res) => {
  try {
    const result = await db.query(
      "SELECT key, value FROM settings WHERE key LIKE 'smtp_%'"
    );
    const config = {};
    for (const row of result.rows) {
      if (row.key === 'smtp_pass' && row.value) {
        config[row.key] = '••••••••'; // mask password
      } else {
        config[row.key] = row.value;
      }
    }
    config.configured = !!(config.smtp_host && config.smtp_user);
    res.json(config);
  } catch (err) {
    console.error('Get SMTP settings error:', err);
    res.status(500).json({ error: 'Failed to get email settings' });
  }
});

// PUT /email — save SMTP settings
router.put('/email', async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_from_name, smtp_secure, smtp_provider } = req.body;

    const ALLOWED_PROVIDERS = ['ses', 'gmail', 'outlook', 'mailgun', 'sendgrid', 'postmark', 'custom'];
    const provider = ALLOWED_PROVIDERS.includes(smtp_provider) ? smtp_provider : 'custom';

    const updates = {
      smtp_host: smtp_host || '',
      smtp_port: String(smtp_port || 587),
      smtp_user: smtp_user || '',
      smtp_from: smtp_from || '',
      smtp_from_name: smtp_from_name || 'The Archive',
      smtp_secure: smtp_secure ? 'true' : 'false',
      smtp_provider: provider,
    };

    // Only update password if not masked
    if (smtp_pass && smtp_pass !== '••••••••') {
      updates.smtp_pass = smtp_pass;
    }

    for (const [key, value] of Object.entries(updates)) {
      await db.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, value]
      );
    }

    const { audit } = require('../services/audit');
    await audit(req, 'settings.update', 'email', null, { fields: Object.keys(updates) });

    res.json({ message: 'Email settings saved', configured: !!(updates.smtp_host && updates.smtp_user) });
  } catch (err) {
    console.error('Save SMTP settings error:', err);
    res.status(500).json({ error: 'Failed to save email settings' });
  }
});

// POST /email/test — send a test email
router.post('/email/test', async (req, res) => {
  try {
    const { sendEmailDetailed } = require('../services/email');

    // Get recipient from body or fall back to current admin
    const toEmail = (req.body.to || req.admin.email || '').trim();
    if (!toEmail || !toEmail.includes('@')) {
      return res.status(400).json({ error: 'No valid email address to send test to. Enter an email in the test field.', success: false });
    }

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f7f9fb;border-radius:16px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="display:inline-block;width:44px;height:44px;border-radius:12px;background:#5b5a8b;line-height:44px;text-align:center;font-size:20px;color:#fff">&#9658;</div>
          <h2 style="margin:12px 0 4px;font-size:20px;color:#2c3437">Test Email</h2>
          <p style="color:#596064;font-size:13px;margin:0">From The Archive</p>
        </div>
        <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e3e9ed;text-align:center">
          <span style="font-size:48px">&#9989;</span>
          <p style="margin:12px 0 0;font-size:14px;color:#2c3437">Your email configuration is working correctly!</p>
          <p style="margin:8px 0 0;font-size:12px;color:#596064">Sent at ${new Date().toISOString()}</p>
        </div>
      </div>
    `;

    const result = await sendEmailDetailed(toEmail, 'The Archive — Test Email', html);

    // Save last test timestamp regardless of outcome
    await db.query(
      `INSERT INTO settings (key, value) VALUES ('smtp_last_test', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new Date().toISOString()]
    );

    if (result.success) {
      res.json({ message: 'Test email sent to ' + toEmail, success: true });
    } else {
      res.status(400).json({ error: result.error || 'Failed to send test email. Check your SMTP settings.', success: false, code: result.code });
    }
  } catch (err) {
    console.error('Test email error:', err);
    res.status(500).json({ error: 'Failed to send test email: ' + err.message, success: false });
  }
});

module.exports = router;
