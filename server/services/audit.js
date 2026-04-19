const db = require('../db/index');

/**
 * Log an admin action to the audit_log table.
 * Call this from any route that mutates data.
 *
 * Usage:
 *   audit(req, 'video.upload', 'video', videoId, { title, size });
 *   audit(req, 'settings.update', 'settings', null, { keys_changed });
 */
async function audit(req, action, resourceType = null, resourceId = null, details = {}) {
  try {
    const adminId = req.admin?.id || null;
    const ip = req.headers['cf-connecting-ip']
      || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.ip
      || null;
    const ua = req.headers['user-agent'] || null;

    await db.query(
      `INSERT INTO audit_log (admin_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [adminId, action, resourceType, resourceId ? String(resourceId) : null, JSON.stringify(details), ip, ua]
    );
  } catch (err) {
    // Never let audit failure break the main request
    console.error('Audit log error:', err.message);
  }
}

module.exports = { audit };
