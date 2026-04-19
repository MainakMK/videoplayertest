const fs = require('fs');
const path = require('path');
const db = require('../db/index');
const { decrypt } = require('./encryption');

let s3Module;
function getS3Module() {
  if (!s3Module) {
    s3Module = require('@aws-sdk/client-s3');
  }
  return s3Module;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

async function getSettings() {
  const result = await db.query('SELECT key, value, is_encrypted FROM settings');
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = row.is_encrypted && row.value ? decrypt(row.value) : row.value;
  }
  return settings;
}

async function getSetting(key) {
  const result = await db.query(
    'SELECT value, is_encrypted FROM settings WHERE key = $1',
    [key]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return row.is_encrypted && row.value ? decrypt(row.value) : row.value;
}

// ---------------------------------------------------------------------------
// R2 / S3 client
// ---------------------------------------------------------------------------

async function buildS3Client(configOverride) {
  const { S3Client } = getS3Module();

  let config;
  if (configOverride) {
    config = configOverride;
  } else {
    const settings = await getSettings();
    config = {
      accountId: settings.r2_account_id,
      accessKeyId: settings.r2_access_key_id,
      secretAccessKey: settings.r2_secret_access_key,
      bucket: settings.r2_bucket_name,
      publicUrl: settings.r2_public_url,
    };
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return { client, bucket: config.bucket, publicUrl: config.publicUrl };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the current storage mode: 'local' or 'r2'.
 */
async function getStorageMode() {
  const mode = await getSetting('storage_mode');
  return mode === 'r2' ? 'r2' : 'local';
}

/**
 * Upload a file to the configured storage backend.
 * @param {string} key      - Object key / relative file path.
 * @param {Buffer} buffer   - File contents.
 * @param {string} contentType - MIME type.
 */
async function getLocalStoragePath() {
  try {
    const settings = await getSettings();
    if (settings.storage_local_path) return settings.storage_local_path;
  } catch (e) {
    // Settings query/decrypt failed, use default path
  }
  return path.join(process.cwd(), 'uploads');
}

async function uploadFile(key, buffer, contentType) {
  const mode = await getStorageMode();

  if (mode === 'r2') {
    const { PutObjectCommand } = getS3Module();
    const { client, bucket } = await buildS3Client();

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
  } else {
    const localPath = await getLocalStoragePath();
    const filePath = path.join(localPath, key);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
  }
}

/**
 * Delete a single file from storage.
 * @param {string} key - Object key / relative file path.
 */
async function deleteFile(key) {
  const mode = await getStorageMode();

  if (mode === 'r2') {
    const { DeleteObjectCommand } = getS3Module();
    const { client, bucket } = await buildS3Client();

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } else {
    const localPath = await getLocalStoragePath();
    const filePath = path.join(localPath, key);

    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Delete all files under a given prefix / folder.
 * @param {string} prefix - The key prefix (folder path).
 */
async function deleteFolder(prefix) {
  const mode = await getStorageMode();

  if (mode === 'r2') {
    const { ListObjectsV2Command, DeleteObjectCommand } = getS3Module();
    const { client, bucket } = await buildS3Client();

    let continuationToken;
    do {
      const listResponse = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      const objects = listResponse.Contents || [];
      for (const obj of objects) {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: obj.Key,
          })
        );
      }

      continuationToken = listResponse.IsTruncated
        ? listResponse.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } else {
    const localPath = await getLocalStoragePath();
    const folderPath = path.join(localPath, prefix);

    try {
      await fs.promises.rm(folderPath, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Get the public URL for a stored file.
 * @param {string} key - Object key / relative file path.
 * @returns {string} The public URL.
 */
async function getFileUrl(key) {
  const mode = await getStorageMode();

  if (mode === 'r2') {
    const settings = await getSettings();
    const publicUrl = (settings.r2_public_url || '').replace(/\/+$/, '');
    return `${publicUrl}/${key}`;
  } else {
    // For local mode return a relative URL that the web server can serve.
    return `/uploads/${key}`;
  }
}

/**
 * Read a file from the configured storage backend.
 * For local: returns a readable stream.
 * For R2: returns { redirect: publicUrl } so the caller can redirect.
 * @param {string} key - Object key / relative file path.
 * @returns {{ stream: ReadableStream, contentType: string } | { redirect: string }}
 */
async function getFile(key) {
  const mode = await getStorageMode();

  if (mode === 'r2') {
    const settings = await getSettings();
    const publicUrl = (settings.r2_public_url || '').replace(/\/+$/, '');
    return { redirect: `${publicUrl}/${key}` };
  } else {
    const localPath = await getLocalStoragePath();
    const filePath = path.join(localPath, key);

    // Prevent directory traversal
    const resolved = path.resolve(filePath);
    const base = path.resolve(localPath);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
      throw Object.assign(new Error('Invalid path'), { code: 'FORBIDDEN' });
    }

    // Check file exists
    await fs.promises.access(filePath, fs.constants.R_OK);

    const stream = fs.createReadStream(filePath);
    return { stream };
  }
}

/**
 * Test an R2 connection using the provided credentials.
 * @param {object} config - { accountId, accessKeyId, secretAccessKey, bucket }
 * @returns {{ success: boolean, message: string }}
 */
async function testR2Connection(config) {
  try {
    const { ListObjectsV2Command } = getS3Module();
    const { client, bucket } = await buildS3Client(config);

    await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1,
      })
    );

    return { success: true, message: 'Connection successful' };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Get disk usage statistics for local storage.
 * @returns {{ totalBytes: number, files: number }}
 */
async function getDiskUsage() {
  const settings = await getSettings();
  const localPath = settings.storage_local_path || path.join(process.cwd(), 'uploads');

  let totalBytes = 0;
  let files = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(fullPath);
        totalBytes += stat.size;
        files++;
      }
    }
  }

  await walk(localPath);
  return { totalBytes, files };
}

/**
 * List all file keys under a given prefix.
 * @param {string} prefix - Key prefix to list.
 * @param {'local'|'r2'} [modeOverride] - Force a specific storage mode.
 * @returns {Promise<string[]>} Array of keys.
 */
async function listFiles(prefix, modeOverride) {
  const mode = modeOverride || (await getStorageMode());
  const keys = [];

  if (mode === 'r2') {
    const { ListObjectsV2Command } = getS3Module();
    const { client, bucket } = await buildS3Client();

    let continuationToken;
    do {
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of response.Contents || []) {
        keys.push(obj.Key);
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
  } else {
    const settings = await getSettings();
    const localPath = settings.storage_local_path || path.join(process.cwd(), 'uploads');
    const folderPath = path.join(localPath, prefix);

    async function walk(dir, base) {
      let entries;
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const key = path.join(base, entry.name);
        if (entry.isDirectory()) {
          await walk(full, key);
        } else {
          keys.push(key);
        }
      }
    }

    await walk(folderPath, prefix);
  }

  return keys;
}

/**
 * Read a file as a Buffer from the configured storage backend.
 * @param {string} key - Object key / relative file path.
 * @param {'local'|'r2'} [modeOverride] - Force a specific storage mode.
 * @returns {Promise<Buffer>}
 */
async function readFile(key, modeOverride) {
  const mode = modeOverride || (await getStorageMode());

  if (mode === 'r2') {
    const { GetObjectCommand } = getS3Module();
    const { client, bucket } = await buildS3Client();

    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    // Convert readable stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } else {
    const settings = await getSettings();
    const localPath = settings.storage_local_path || path.join(process.cwd(), 'uploads');
    const filePath = path.join(localPath, key);
    return fs.promises.readFile(filePath);
  }
}

/**
 * Upload a file to a specific storage backend (ignoring current mode).
 * @param {string} key - Object key / relative file path.
 * @param {Buffer} buffer - File contents.
 * @param {string} contentType - MIME type.
 * @param {'local'|'r2'} mode - Target storage mode.
 */
async function uploadFileTo(key, buffer, contentType, mode) {
  if (mode === 'r2') {
    const { PutObjectCommand } = getS3Module();
    const { client, bucket } = await buildS3Client();

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
  } else {
    const settings = await getSettings();
    const localPath = settings.storage_local_path || path.join(process.cwd(), 'uploads');
    const filePath = path.join(localPath, key);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
  }
}

/**
 * Delete a file from a specific storage backend (ignoring current mode).
 * @param {string} key - Object key / relative file path.
 * @param {'local'|'r2'} mode - Source storage mode.
 */
async function deleteFileFrom(key, mode) {
  if (mode === 'r2') {
    const { DeleteObjectCommand } = getS3Module();
    const { client, bucket } = await buildS3Client();

    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key })
    );
  } else {
    const settings = await getSettings();
    const localPath = settings.storage_local_path || path.join(process.cwd(), 'uploads');
    const filePath = path.join(localPath, key);

    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

/**
 * Delete an entire folder from a specific storage backend (ignoring current mode).
 * Safe to call with a prefix that doesn't exist — errors are swallowed for local ENOENT
 * and empty R2 listings.
 *
 * @param {string} prefix - Folder path / R2 key prefix (MUST be non-empty, should end with no slash or with a slash).
 * @param {'local'|'r2'} mode - Source storage mode.
 * @returns {Promise<number>} Number of objects/files deleted (0 if folder was empty or missing).
 */
async function deleteFolderFrom(prefix, mode) {
  if (!prefix || typeof prefix !== 'string' || prefix.trim() === '' || prefix === '/' || prefix === '\\') {
    throw new Error('deleteFolderFrom refused: empty or root prefix');
  }
  // Extra safety: the prefix must be within an allowed root. We only ever clean up
  // under "videos/" — anything else is a programming bug, not a valid caller.
  const normalizedPrefix = prefix.replace(/^\/+/, ''); // strip leading slashes
  const ALLOWED_ROOTS = ['videos/', 'branding/', 'thumbnails/'];
  if (!ALLOWED_ROOTS.some(root => normalizedPrefix === root.replace(/\/$/, '') || normalizedPrefix.startsWith(root))) {
    throw new Error(`deleteFolderFrom refused: prefix "${prefix}" is not under an allowed root`);
  }

  let deleted = 0;

  if (mode === 'r2') {
    const { ListObjectsV2Command, DeleteObjectCommand } = getS3Module();
    const { client, bucket } = await buildS3Client();
    const r2Prefix = normalizedPrefix.endsWith('/') ? normalizedPrefix : normalizedPrefix + '/';

    let continuationToken;
    do {
      const listResponse = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: r2Prefix,
          ContinuationToken: continuationToken,
        })
      );

      const objects = listResponse.Contents || [];
      for (const obj of objects) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
          deleted++;
        } catch (e) {
          // Best-effort — log and keep going so one bad key doesn't abort the whole cleanup
          console.warn(`[storage] Failed to delete R2 key ${obj.Key}: ${e.message}`);
        }
      }

      continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
    } while (continuationToken);
  } else {
    const settings = await getSettings();
    const localPath = settings.storage_local_path || path.join(process.cwd(), 'uploads');
    const folderPath = path.join(localPath, normalizedPrefix);

    // Count files inside before removal (best-effort, for reporting)
    try {
      const stats = await fs.promises.stat(folderPath);
      if (stats.isDirectory()) {
        // Rough count via readdir — not recursive-exact, but good enough for reporting
        const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
        deleted = entries.length;
      }
    } catch (e) {
      if (e.code === 'ENOENT') return 0; // Nothing to delete
      // Any other stat error — fall through and try the rm anyway
    }

    try {
      await fs.promises.rm(folderPath, { recursive: true, force: true });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  return deleted;
}

/**
 * Get the public URL for a stored file using an explicit storage mode.
 * @param {string} key - Object key / relative file path.
 * @param {'local'|'r2'} mode - Storage mode to use.
 * @returns {string} The public URL.
 */
async function getFileUrlFor(key, mode) {
  if (mode === 'r2') {
    const settings = await getSettings();
    const publicUrl = (settings.r2_public_url || '').replace(/\/+$/, '');
    return `${publicUrl}/${key}`;
  } else {
    return `/uploads/${key}`;
  }
}

module.exports = {
  getStorageMode,
  getSettings,
  getSetting,
  uploadFile,
  deleteFile,
  deleteFolder,
  getFileUrl,
  getFileUrlFor,
  getFile,
  listFiles,
  readFile,
  uploadFileTo,
  deleteFileFrom,
  deleteFolderFrom,
  testR2Connection,
  getDiskUsage,
};
