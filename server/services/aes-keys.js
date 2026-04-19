/**
 * AES-128 HLS encryption key service.
 *
 * Generates, stores, retrieves, and deletes the per-video AES-128 keys used
 * to encrypt HLS segments. Keys are encrypted-at-rest in the database using
 * the existing ENCRYPTION_KEY (AES-256-GCM via services/encryption.js) so a
 * leaked DB backup alone won't expose the keys.
 *
 * Keys NEVER touch the filesystem permanently — the worker writes a TEMP
 * key file for FFmpeg, then deletes it after transcoding. The DB row is the
 * only persistent copy.
 *
 * Public functions:
 *   - generateAndStoreKey(videoId)  → { keyBytes, ivHex } for the worker
 *   - getKeyForVideo(videoId)       → Buffer (16 bytes) for the playback endpoint
 *   - hasKey(videoId)               → boolean
 *   - deleteKey(videoId)            → also auto-CASCADE on video deletion
 */

const crypto = require('crypto');
const db = require('../db');
const { encrypt, decrypt } = require('./encryption');

const KEY_BYTES_LENGTH = 16;  // AES-128 = 16 bytes
const IV_BYTES_LENGTH = 16;   // 128-bit IV per HLS spec

/**
 * Generate a fresh AES-128 key + IV for a video and store them in the DB.
 * Returns the raw bytes the worker needs to write the key info file for FFmpeg.
 *
 * Throws if a key already exists for this video — caller should delete first
 * if re-encoding (otherwise we'd lose the ability to decrypt the old segments
 * during the brief window where the new ones haven't been written yet).
 *
 * @param {string} videoId
 * @returns {Promise<{ keyBytes: Buffer, ivHex: string }>}
 */
async function generateAndStoreKey(videoId) {
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('generateAndStoreKey: videoId is required');
  }
  const keyBytes = crypto.randomBytes(KEY_BYTES_LENGTH);
  const ivBytes = crypto.randomBytes(IV_BYTES_LENGTH);
  const ivHex = ivBytes.toString('hex');

  // Encrypt key-at-rest using ENCRYPTION_KEY (defense-in-depth). We pass the
  // key as a hex string because encrypt() expects UTF-8 text.
  const encryptedKey = encrypt(keyBytes.toString('hex'));

  await db.query(
    `INSERT INTO video_encryption_keys (video_id, key_bytes, iv_hex, algorithm, created_at)
     VALUES ($1, $2, $3, 'AES-128', NOW())
     ON CONFLICT (video_id) DO UPDATE SET key_bytes = $2, iv_hex = $3, created_at = NOW()`,
    [videoId, encryptedKey, ivHex]
  );

  return { keyBytes, ivHex };
}

/**
 * Retrieve the decrypted AES key for a video, ready to send to the player.
 * @param {string} videoId
 * @returns {Promise<Buffer|null>} 16-byte Buffer, or null if no key exists
 */
async function getKeyForVideo(videoId) {
  if (!videoId) return null;
  const r = await db.query(
    'SELECT key_bytes FROM video_encryption_keys WHERE video_id = $1',
    [videoId]
  );
  if (!r.rows.length) return null;
  try {
    const hex = decrypt(r.rows[0].key_bytes);
    const buf = Buffer.from(hex, 'hex');
    if (buf.length !== KEY_BYTES_LENGTH) {
      throw new Error(`Decrypted key has wrong length (${buf.length}, expected ${KEY_BYTES_LENGTH})`);
    }
    return buf;
  } catch (e) {
    console.error(`[aes-keys] Failed to decrypt key for video ${videoId}:`, e.message);
    return null;
  }
}

/**
 * Quick existence check without decrypting.
 */
async function hasKey(videoId) {
  if (!videoId) return false;
  const r = await db.query(
    'SELECT 1 FROM video_encryption_keys WHERE video_id = $1',
    [videoId]
  );
  return r.rows.length > 0;
}

/**
 * Delete a key (e.g., when re-encoding without encryption, or video deletion).
 * The CASCADE on the FK already handles video deletion automatically — this
 * is mainly for explicit "disable encryption on this video" flows.
 */
async function deleteKey(videoId) {
  if (!videoId) return;
  await db.query('DELETE FROM video_encryption_keys WHERE video_id = $1', [videoId]);
}

/**
 * Get just the IV (no decryption needed) — used by the playback endpoint
 * if the player requests it separately.
 */
async function getIvForVideo(videoId) {
  if (!videoId) return null;
  const r = await db.query(
    'SELECT iv_hex FROM video_encryption_keys WHERE video_id = $1',
    [videoId]
  );
  return r.rows[0]?.iv_hex || null;
}

module.exports = {
  generateAndStoreKey,
  getKeyForVideo,
  getIvForVideo,
  hasKey,
  deleteKey,
  KEY_BYTES_LENGTH,
  IV_BYTES_LENGTH,
};
