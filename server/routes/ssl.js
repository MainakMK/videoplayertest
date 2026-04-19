const express = require('express');
const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const db = require('../db/index.js');
const auth = require('../middleware/auth');
const { encrypt, decrypt } = require('../services/encryption');

const { requireMinRole } = require('../middleware/roles');
const execFileAsync = promisify(execFile);
const router = express.Router();
router.use(auth, requireMinRole('admin'));

// GET / - List all SSL certificates
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, domain, method, status, issued_at, expires_at, last_renewal_at FROM ssl_certificates ORDER BY domain ASC'
    );
    res.json({ certificates: result.rows });
  } catch (err) {
    console.error('List SSL certificates error:', err);
    res.status(500).json({ error: 'Failed to list certificates' });
  }
});

// POST / - Add/register a domain for SSL
router.post('/', async (req, res) => {
  try {
    const { domain, method, cf_api_token, cf_zone_id, cf_email, cf_auth_type } = req.body;

    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }

    // Validate domain format
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
      return res.status(400).json({ error: 'Invalid domain format' });
    }

    const sslMethod = method === 'dns01' ? 'dns01' : 'http01';
    const authType = cf_auth_type === 'global_key' ? 'global_key' : 'token';

    if (sslMethod === 'dns01') {
      if (!cf_zone_id) {
        return res.status(400).json({ error: 'Cloudflare Zone ID is required for DNS-01 method' });
      }
      if (authType === 'token' && !cf_api_token) {
        return res.status(400).json({ error: 'Cloudflare API token is required for DNS-01 method' });
      }
      if (authType === 'global_key') {
        if (!cf_email) {
          return res.status(400).json({ error: 'Cloudflare email is required for Global API Key auth' });
        }
        if (!cf_api_token) {
          return res.status(400).json({ error: 'Cloudflare Global API Key is required' });
        }
      }
    }

    // Check if already exists
    const existing = await db.query(
      'SELECT id FROM ssl_certificates WHERE domain = $1',
      [domain]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Domain already registered' });
    }

    const encryptedToken = cf_api_token ? encrypt(cf_api_token) : null;
    const encryptedEmail = cf_email ? encrypt(cf_email) : null;

    const result = await db.query(
      `INSERT INTO ssl_certificates (domain, method, status, cf_api_token, cf_zone_id, cf_email, cf_auth_type)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6)
       RETURNING id, domain, method, status, issued_at, expires_at, last_renewal_at`,
      [domain, sslMethod, encryptedToken, sslMethod === 'dns01' ? cf_zone_id : null, encryptedEmail, sslMethod === 'dns01' ? authType : null]
    );

    res.json({ certificate: result.rows[0], message: 'Domain registered for SSL' });
  } catch (err) {
    console.error('Add SSL certificate error:', err);
    res.status(500).json({ error: 'Failed to add certificate' });
  }
});

// POST /:id/issue - Issue/renew SSL certificate via certbot
router.post('/:id/issue', async (req, res) => {
  try {
    const { id } = req.params;

    const certResult = await db.query(
      'SELECT * FROM ssl_certificates WHERE id = $1',
      [id]
    );

    if (certResult.rows.length === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const cert = certResult.rows[0];

    // Update status to pending
    await db.query(
      "UPDATE ssl_certificates SET status = 'pending' WHERE id = $1",
      [id]
    );

    // Build certbot command
    let args;
    const tempCredsPath = `/tmp/cf-creds-${id}.ini`;
    if (cert.method === 'dns01') {
      // DNS-01 challenge via Cloudflare plugin
      const apiToken = decrypt(cert.cf_api_token);
      let credsContent;
      if (cert.cf_auth_type === 'global_key') {
        const email = decrypt(cert.cf_email);
        credsContent = `dns_cloudflare_email = ${email}\ndns_cloudflare_api_key = ${apiToken}`;
      } else {
        credsContent = `dns_cloudflare_api_token = ${apiToken}`;
      }
      await fs.promises.writeFile(tempCredsPath, credsContent);
      await fs.promises.chmod(tempCredsPath, 0o600);

      args = [
        'certonly',
        '--dns-cloudflare',
        '--dns-cloudflare-credentials', tempCredsPath,
        '-d', cert.domain,
        '--non-interactive',
        '--agree-tos',
        '--email', process.env.ADMIN_EMAIL || 'admin@localhost',
      ];
    } else {
      // HTTP-01 challenge via nginx plugin
      args = [
        '--nginx',
        '-d', cert.domain,
        '--non-interactive',
        '--agree-tos',
        '--email', process.env.ADMIN_EMAIL || 'admin@localhost',
      ];
    }

    try {
      await execFileAsync('certbot', args, { timeout: 120_000 });

      // Read certificate expiry
      let expiresAt = null;
      try {
        const certPath = `/etc/letsencrypt/live/${cert.domain}/fullchain.pem`;
        const { stdout } = await execFileAsync('openssl', [
          'x509', '-enddate', '-noout', '-in', certPath,
        ]);
        // Parse: notAfter=Mar 19 12:00:00 2026 GMT
        const match = stdout.match(/notAfter=(.+)/);
        if (match) {
          expiresAt = new Date(match[1].trim());
        }
      } catch {
        // If we can't read expiry, still mark as active
      }

      await db.query(
        `UPDATE ssl_certificates
         SET status = 'active', issued_at = NOW(), expires_at = $1, last_renewal_at = NOW()
         WHERE id = $2`,
        [expiresAt, id]
      );

      res.json({ message: 'SSL certificate issued successfully' });
    } catch (certErr) {
      await db.query(
        "UPDATE ssl_certificates SET status = 'error' WHERE id = $1",
        [id]
      );
      res.status(500).json({
        error: 'Certbot failed',
        details: certErr.stderr || certErr.message,
      });
    } finally {
      // Clean up temp credentials file
      try {
        await fs.promises.unlink(tempCredsPath);
      } catch {
        // Ignore if file doesn't exist
      }
    }
  } catch (err) {
    console.error('Issue SSL certificate error:', err);
    res.status(500).json({ error: 'Failed to issue certificate' });
  }
});

// POST /:id/check - Check certificate status on disk
router.post('/:id/check', async (req, res) => {
  try {
    const { id } = req.params;

    const certResult = await db.query(
      'SELECT * FROM ssl_certificates WHERE id = $1',
      [id]
    );

    if (certResult.rows.length === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    const cert = certResult.rows[0];
    const certPath = `/etc/letsencrypt/live/${cert.domain}/fullchain.pem`;

    // Check if cert file exists
    try {
      await fs.promises.access(certPath, fs.constants.R_OK);
    } catch {
      await db.query(
        "UPDATE ssl_certificates SET status = 'pending' WHERE id = $1",
        [id]
      );
      return res.json({ status: 'pending', message: 'Certificate not found on disk' });
    }

    // Read expiry date
    try {
      const { stdout } = await execFileAsync('openssl', [
        'x509', '-enddate', '-noout', '-in', certPath,
      ]);

      const match = stdout.match(/notAfter=(.+)/);
      if (match) {
        const expiresAt = new Date(match[1].trim());
        const now = new Date();
        const status = expiresAt > now ? 'active' : 'expired';

        await db.query(
          'UPDATE ssl_certificates SET status = $1, expires_at = $2 WHERE id = $3',
          [status, expiresAt, id]
        );

        return res.json({
          status,
          expires_at: expiresAt.toISOString(),
          days_remaining: Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24)),
        });
      }
    } catch {
      // openssl not available or cert can't be read
    }

    res.json({ status: cert.status, message: 'Could not verify certificate' });
  } catch (err) {
    console.error('Check SSL certificate error:', err);
    res.status(500).json({ error: 'Failed to check certificate' });
  }
});

// DELETE /:id - Remove certificate record
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM ssl_certificates WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    res.json({ message: 'Certificate record removed' });
  } catch (err) {
    console.error('Delete SSL certificate error:', err);
    res.status(500).json({ error: 'Failed to delete certificate' });
  }
});

module.exports = router;
