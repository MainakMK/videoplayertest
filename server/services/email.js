const nodemailer = require('nodemailer');
const db = require('../db');

/**
 * Get SMTP settings from the database settings table.
 * Keys: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure
 */
async function getSmtpConfig() {
  try {
    const result = await db.query(
      "SELECT key, value FROM settings WHERE key LIKE 'smtp_%'"
    );
    const config = {};
    for (const row of result.rows) {
      config[row.key] = row.value;
    }
    return config;
  } catch (err) {
    return {};
  }
}

/**
 * Send an email. Returns true on success, false on failure.
 * SMTP settings are read from the DB settings table.
 * Silent version — for fire-and-forget use (welcome emails, notifications).
 */
async function sendEmail(to, subject, html) {
  const result = await sendEmailDetailed(to, subject, html);
  return result.success;
}

/**
 * Send an email and return { success, error } for callers that need the error message
 * (e.g., the Send Test Email button).
 *
 * `overrideConfig` lets the caller test SMTP creds BEFORE saving them. When provided,
 * its fields (smtp_host/port/user/pass/secure/from/from_name) take precedence over
 * whatever is in the DB. Missing fields fall back to the saved values so callers only
 * need to supply the parts they've edited.
 */
async function sendEmailDetailed(to, subject, html, overrideConfig = null) {
  try {
    const saved = await getSmtpConfig();
    const config = overrideConfig ? { ...saved, ...overrideConfig } : saved;

    if (!config.smtp_host || !config.smtp_user) {
      console.log('[Email] SMTP not configured — skipping email to', to);
      return { success: false, error: 'SMTP host/user is missing. Fill them in and try again.' };
    }

    if (!config.smtp_pass) {
      return { success: false, error: 'SMTP password is empty. Fill it in and try again.' };
    }

    const fromAddr = config.smtp_from || config.smtp_user;
    const fromName = config.smtp_from_name || 'The Archive';

    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port: parseInt(config.smtp_port) || 587,
      secure: config.smtp_secure === 'true',
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
      // Reasonable timeouts so a bad host fails quickly
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    await transporter.sendMail({
      from: fromName ? `"${fromName}" <${fromAddr}>` : fromAddr,
      to,
      subject,
      html,
    });

    console.log('[Email] Sent to', to, '—', subject);
    return { success: true };
  } catch (err) {
    const msg = friendlySmtpError(err);
    console.error('[Email] Failed to send:', err.code || '', err.message);
    return { success: false, error: msg, code: err.code };
  }
}

/**
 * Turn a raw nodemailer/SMTP error into a helpful, human-readable message.
 */
function friendlySmtpError(err) {
  const raw = err.message || String(err);
  const code = err.code || '';

  if (code === 'ECONNREFUSED' || raw.includes('ECONNREFUSED')) {
    return 'Connection refused — SMTP host/port is wrong or the server is unreachable.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || raw.includes('timed out') || raw.includes('ETIMEDOUT')) {
    return 'Connection timed out — check the SMTP host and port, and that your server can reach it.';
  }
  if (code === 'ENOTFOUND' || raw.includes('ENOTFOUND') || raw.includes('getaddrinfo')) {
    return 'SMTP host not found — double-check the hostname (e.g. "email-smtp.us-east-1.amazonaws.com").';
  }
  if (code === 'EAUTH' || raw.toLowerCase().includes('authentication') || raw.toLowerCase().includes('auth failed') || raw.toLowerCase().includes('535')) {
    return 'Authentication failed — username or password is incorrect.';
  }
  if (raw.includes('Email address is not verified') || raw.includes('MessageRejected')) {
    return 'From address is not verified in SES. Verify your "From" address in AWS SES first.';
  }
  if (raw.includes('Free accounts are for test purposes only') || raw.includes('authorized recipients') || raw.includes('Sandbox subdomain')) {
    return 'Mailgun sandbox/free account can only send to authorized recipients. Add the recipient in Mailgun, or upgrade and verify your domain.';
  }
  if (raw.toLowerCase().includes('sender not authorized')) {
    return 'Sender address is not authorized. Verify the "From" address belongs to a domain configured in your email provider.';
  }
  if (raw.includes('self signed certificate') || raw.includes('self-signed') || raw.includes('certificate')) {
    return 'TLS certificate error — try toggling SSL/TLS off or using a different port.';
  }
  if (raw.includes('wrong version number') || raw.includes('SSL')) {
    return 'SSL/TLS mismatch — try toggling the SSL/TLS checkbox. Port 587 uses STARTTLS (off), port 465 uses SSL (on).';
  }
  return raw;
}

/**
 * Send a welcome email to a new team member with their login credentials.
 */
async function sendWelcomeEmail(email, displayName, loginUsername, password, role, dashboardUrl) {
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
  const subject = `You've been added to The Archive`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f7f9fb;border-radius:16px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="display:inline-block;width:44px;height:44px;border-radius:12px;background:#5b5a8b;line-height:44px;text-align:center;font-size:20px;color:#fff">&#9658;</div>
        <h2 style="margin:12px 0 4px;font-size:20px;color:#2c3437">Welcome to The Archive</h2>
        <p style="color:#596064;font-size:13px;margin:0">Video Management Platform</p>
      </div>
      <div style="background:#fff;border-radius:12px;padding:24px;border:1px solid #e3e9ed">
        <p style="margin:0 0 16px;font-size:14px;color:#2c3437">Hi <strong>${displayName}</strong>,</p>
        <p style="margin:0 0 16px;font-size:13px;color:#596064">You've been added as <strong style="color:#5b5a8b">${roleLabel}</strong> on The Archive. Here are your login details:</p>
        <div style="background:#f7f9fb;border-radius:8px;padding:16px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:12px;color:#596064;font-weight:600">Email / Username</span>
            <span style="font-size:13px;font-weight:600;color:#2c3437">${loginUsername}</span>
          </div>
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:12px;color:#596064;font-weight:600">Password</span>
            <span style="font-size:13px;font-weight:600;color:#2c3437">${password}</span>
          </div>
        </div>
        <a href="${dashboardUrl}" style="display:block;text-align:center;background:#5b5a8b;color:#fff;padding:12px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Sign In to Dashboard</a>
        <p style="margin:16px 0 0;font-size:11px;color:#acb3b7;text-align:center">Please change your password after your first login.</p>
      </div>
    </div>
  `;

  return sendEmail(email, subject, html);
}

module.exports = { sendEmail, sendEmailDetailed, sendWelcomeEmail, getSmtpConfig };
