/**
 * Pure Node.js TOTP implementation (RFC 6238)
 * No external dependencies — uses only built-in crypto module.
 */
const crypto = require('crypto');

// ─── Base32 encode/decode ────────────────────────────────────────────────────
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_CHARS[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_CHARS[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  str = str.toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of str) {
    const idx = B32_CHARS.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 char: ' + ch);
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ─── HOTP (counter-based) ────────────────────────────────────────────────────
function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = mac[19] & 0xf;
  const code = ((mac[offset] & 0x7f) << 24)
    | ((mac[offset+1] & 0xff) << 16)
    | ((mac[offset+2] & 0xff) <<  8)
    | (mac[offset+3]  & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

// ─── TOTP (time-based) ───────────────────────────────────────────────────────
const STEP = 30; // seconds

function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / STEP);
  return hotp(secret, counter);
}

/**
 * Verify a TOTP token with ±1 window tolerance (covers clock skew).
 */
function totpVerify(secret, token) {
  const t = Math.floor(Date.now() / 1000 / STEP);
  for (let i = -1; i <= 1; i++) {
    if (hotp(secret, t + i) === token) return true;
  }
  return false;
}

/**
 * Generate a new random TOTP secret (20 bytes → 32 base32 chars).
 */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Build a otpauth:// URI for QR code scanners (Google Authenticator, Authy, etc.)
 */
function totpUri(secret, account, issuer = 'The Archive') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Generate N single-use backup codes.
 */
function generateBackupCodes(n = 8) {
  return Array.from({ length: n }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{4}/g).join('-')
  );
}

module.exports = { generateSecret, totpNow, totpVerify, totpUri, generateBackupCodes };
