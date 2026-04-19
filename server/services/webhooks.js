const crypto = require('crypto');
const db = require('../db/index');

/**
 * Trigger webhooks for a given event.
 * @param {string} event - Event name (e.g. 'video.ready', 'video.uploaded', 'video.deleted').
 * @param {object} payload - Event data to send.
 */
async function triggerWebhooks(event, payload) {
  try {
    const result = await db.query(
      "SELECT value FROM settings WHERE key = 'webhooks'"
    );

    if (result.rows.length === 0 || !result.rows[0].value) return;

    let webhooks;
    try {
      webhooks = JSON.parse(result.rows[0].value);
    } catch {
      return;
    }

    if (!Array.isArray(webhooks) || webhooks.length === 0) return;

    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data: payload,
    });

    for (const webhook of webhooks) {
      if (!webhook.url || !webhook.active) continue;

      // Check event filter
      if (webhook.events && webhook.events.length > 0) {
        if (!webhook.events.includes(event)) continue;
      }

      // Generate signature
      const secret = webhook.secret || '';
      const signature = secret
        ? crypto.createHmac('sha256', secret).update(body).digest('hex')
        : '';

      // Fire and forget — don't block the caller
      fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-Signature': signature ? `sha256=${signature}` : '',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      }).catch((err) => {
        console.error(`Webhook delivery failed for ${webhook.url}:`, err.message);
      });
    }
  } catch (err) {
    console.error('Trigger webhooks error:', err.message);
  }
}

module.exports = { triggerWebhooks };
