const express = require('express');
const crypto = require('crypto');
const Bull = require('bull');
const router = express.Router();
const db = require('../db/index');
const auth = require('../middleware/auth');
const { requireMinRole } = require('../middleware/roles');
const { uploadVideo, uploadSubtitle, uploadThumbnail } = require('../middleware/upload');
const storage = require('../services/storage');
const { triggerWebhooks } = require('../services/webhooks');
const { audit } = require('../services/audit');

const videoQueue = new Bull('video-processing', process.env.REDIS_URL);

// Editors and above can manage videos. Owner-only operations (e.g., deleting all)
// can be added per-route with requireRole('owner').
router.use(auth, requireMinRole('editor'));

// GET /processing/progress - Get processing progress for active videos
router.get('/processing/progress', async (req, res) => {
  try {
    const activeJobs = await videoQueue.getActive();
    const waitingJobs = await videoQueue.getWaiting();
    const progress = {};
    for (const job of activeJobs) {
      progress[job.data.videoId] = job.progress() || 0;
    }
    for (const job of waitingJobs) {
      progress[job.data.videoId] = 0;
    }
    res.json({ progress });
  } catch (err) {
    console.error('Error getting processing progress:', err);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// GET /queue/stats - Queue depth counters for the dashboard KPI
router.get('/queue/stats', async (req, res) => {
  try {
    const [waiting, active, delayed, failed] = await Promise.all([
      videoQueue.getWaitingCount(),
      videoQueue.getActiveCount(),
      videoQueue.getDelayedCount(),
      videoQueue.getFailedCount(),
    ]);
    res.json({
      waiting,
      active,
      delayed,
      failed,
      pending: waiting + active + delayed,
    });
  } catch (err) {
    console.error('Error getting queue stats:', err);
    res.status(500).json({ error: 'Failed to get queue stats' });
  }
});

// GET / - List videos with pagination
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const folderId = req.query.folder_id || null;
    const status = req.query.status || null;
    const sort = req.query.sort || 'created_at';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

    const allowedSorts = ['created_at', 'title', 'duration', 'views_count', 'updated_at'];
    const sortColumn = allowedSorts.includes(sort) ? sort : 'created_at';

    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(title ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (folderId) {
      conditions.push(`folder_id = $${paramIndex}`);
      params.push(folderId);
      paramIndex++;
    }

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await db.query(
      `SELECT COUNT(*) FROM videos ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await db.query(
      `SELECT * FROM videos ${whereClause} ORDER BY ${sortColumn} ${order} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({
      videos: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Error listing videos:', err);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// GET /:id - Get single video
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error getting video:', err);
    res.status(500).json({ error: 'Failed to get video' });
  }
});

// POST /upload - Upload video
router.post('/upload', uploadVideo, async (req, res) => {
  try {
    const id = crypto.randomBytes(8).toString('base64url').slice(0, 12);
    const file = req.file;
    const storageType = req.body.storage_type === 'r2' ? 'r2' : 'local';

    // Per-video quality override (optional). Sent as JSON string by the upload modal.
    // Validates strictly — malformed JSON or unknown qualities → 400 so the user knows
    // their picks weren't honored (instead of silently falling back to defaults).
    let encodedQualities = null;
    if (req.body.encoded_qualities !== undefined && req.body.encoded_qualities !== '') {
      let parsed;
      try {
        parsed = typeof req.body.encoded_qualities === 'string'
          ? JSON.parse(req.body.encoded_qualities)
          : req.body.encoded_qualities;
      } catch (e) {
        return res.status(400).json({ error: 'encoded_qualities must be a valid JSON array of quality names' });
      }
      if (!Array.isArray(parsed)) {
        return res.status(400).json({ error: 'encoded_qualities must be an array (e.g., ["720p","1080p"])' });
      }
      // Import the canonical list from encoding-config so additions stay in sync
      const { ALL_QUALITIES } = require('../services/encoding-config');
      const filtered = parsed.filter(q => ALL_QUALITIES.includes(q));
      if (parsed.length > 0 && filtered.length === 0) {
        return res.status(400).json({
          error: `encoded_qualities contained no valid qualities. Allowed: ${ALL_QUALITIES.join(', ')}`,
        });
      }
      encodedQualities = filtered.length > 0 ? filtered : null;
    }

    // AES-128 HLS encryption: per-upload override wins over the global default.
    // Accepted values: boolean true/false, string 'true'/'false'. Any other
    // value → fall back to the global setting so a typo doesn't silently ship
    // an unencrypted video when the admin expected encryption.
    const { loadEncodingConfig } = require('../services/encoding-config');
    const enCfg = await loadEncodingConfig();
    let encryptionEnabled = enCfg.encrypt_new_videos;
    if (req.body.encrypt === true || req.body.encrypt === 'true') {
      encryptionEnabled = true;
    } else if (req.body.encrypt === false || req.body.encrypt === 'false') {
      encryptionEnabled = false;
    }

    const result = await db.query(
      `INSERT INTO videos (id, title, original_filename, file_size, status, storage_type, encoded_qualities, encryption_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'uploading', $5, $6, $7, NOW(), NOW())
       RETURNING *`,
      [
        id,
        req.body.title || file.originalname,
        file.originalname,
        file.size,
        storageType,
        encodedQualities ? JSON.stringify(encodedQualities) : null,
        encryptionEnabled,
      ]
    );

    const video = result.rows[0];

    await videoQueue.add({
      videoId: id,
      filePath: file.path || file.key || file.location,
      originalFilename: file.originalname,
      storageType: storageType,
    });

    triggerWebhooks('video.uploaded', { id: video.id, title: video.title });
    await audit(req, 'video.upload', 'video', id, {
      title: video.title, size: file.size, storage: storageType,
      qualities: encodedQualities || 'defaults',
      encrypted: encryptionEnabled,
    });

    res.status(201).json(video);
  } catch (err) {
    console.error('Error uploading video:', err);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// POST /bulk-upload — accept multiple files, queue each one
router.post('/bulk-upload', (req, res, next) => {
  const multer = require('multer');
  const path   = require('path');
  const fs     = require('fs');
  const allowedExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv'];
  const upload = multer({
    storage: multer.diskStorage({
      destination: (r, f, cb) => cb(null, path.join(__dirname, '../uploads')),
      filename:    (r, f, cb) => {
        // Sanitize filename — same protection as single-upload route
        const safe = path.basename(String(f.originalname || 'video')).replace(/\0/g, '').replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200) || 'video';
        f.originalname = safe;
        cb(null, `${Date.now()}-${safe}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024 * 1024 },
    fileFilter: (r, f, cb) => {
      const ext = path.extname(f.originalname).toLowerCase();
      cb(allowedExts.includes(ext) ? null : new Error('Invalid file type'), allowedExts.includes(ext));
    },
  }).array('videos', 20); // up to 20 files at once

  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files provided' });

    const storageType = req.body.storage_type === 'r2' ? 'r2' : 'local';

    // Per-batch quality override (optional). All files in this bulk-upload share
    // the same encoded_qualities (the upload modal collects one selection for all).
    let encodedQualities = null;
    if (req.body.encoded_qualities !== undefined && req.body.encoded_qualities !== '') {
      let parsed;
      try {
        parsed = typeof req.body.encoded_qualities === 'string'
          ? JSON.parse(req.body.encoded_qualities)
          : req.body.encoded_qualities;
      } catch (e) {
        return res.status(400).json({ error: 'encoded_qualities must be a valid JSON array of quality names' });
      }
      if (!Array.isArray(parsed)) {
        return res.status(400).json({ error: 'encoded_qualities must be an array (e.g., ["720p","1080p"])' });
      }
      const { ALL_QUALITIES } = require('../services/encoding-config');
      const filtered = parsed.filter(q => ALL_QUALITIES.includes(q));
      if (parsed.length > 0 && filtered.length === 0) {
        return res.status(400).json({ error: `encoded_qualities contained no valid qualities. Allowed: ${ALL_QUALITIES.join(', ')}` });
      }
      encodedQualities = filtered.length > 0 ? filtered : null;
    }

    // AES encryption: per-batch override, falls back to global default.
    const { loadEncodingConfig } = require('../services/encoding-config');
    const enCfg = await loadEncodingConfig();
    let encryptionEnabled = enCfg.encrypt_new_videos;
    if (req.body.encrypt === true || req.body.encrypt === 'true') {
      encryptionEnabled = true;
    } else if (req.body.encrypt === false || req.body.encrypt === 'false') {
      encryptionEnabled = false;
    }

    const results = [];

    for (const file of req.files) {
      try {
        const id = crypto.randomBytes(8).toString('base64url').slice(0, 12);
        const title = req.body[`title_${file.originalname}`] || file.originalname.replace(/\.[^.]+$/, '');

        const result = await db.query(
          `INSERT INTO videos (id, title, original_filename, file_size, status, storage_type, encoded_qualities, encryption_enabled, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'uploading', $5, $6, $7, NOW(), NOW()) RETURNING *`,
          [id, title, file.originalname, file.size, storageType, encodedQualities ? JSON.stringify(encodedQualities) : null, encryptionEnabled]
        );
        const video = result.rows[0];

        await videoQueue.add({
          videoId: id,
          filePath: file.path,
          originalFilename: file.originalname,
          storageType,
        });

        triggerWebhooks('video.uploaded', { id, title });
        results.push({ id, title, status: 'queued' });
      } catch (e) {
        results.push({ originalname: file.originalname, error: e.message });
      }
    }

    await audit(req, 'video.upload', 'video', null, {
      count: req.files.length,
      storage: storageType,
      qualities: encodedQualities || 'defaults',
      encrypted: encryptionEnabled,
    });
    res.status(201).json({ queued: results });
  });
});

// PUT /:id - Update video
router.put('/:id', async (req, res) => {
  try {
    const { title, description, visibility, tags, folder_id } = req.body;

    const existing = await db.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const result = await db.query(
      `UPDATE videos
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           visibility = COALESCE($3, visibility),
           tags = COALESCE($4, tags),
           folder_id = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [title, description, visibility, tags ? JSON.stringify(tags) : null, folder_id, req.params.id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating video:', err);
    res.status(500).json({ error: 'Failed to update video' });
  }
});

/**
 * POST /:id/reencode — Re-queue a video for encoding (e.g., toggle AES on/off).
 *
 * Body: { encrypt: boolean }   // whether the re-encode should produce AES output
 *
 * Requirements:
 *   - Video must exist and be in status='ready' or status='error'. Processing
 *     videos can't be re-queued (we'd double-process).
 *   - The ORIGINAL upload file is gone by now (worker unlinks it after
 *     successful encoding), so we can't re-encode from the original source.
 *     Instead we re-encode from the highest-quality variant we stored — which
 *     is acceptable for a re-key since no quality drop is expected (stream-copy
 *     possible if the variant is H.264). This is a known limitation.
 *
 * For Phase 2 we defer the "re-encode from storage" complication and simply
 * flip the encryption flag + return a clear message saying the admin needs
 * to re-upload to apply. This keeps the endpoint safe (no partial re-encodes)
 * while still letting the UI toggle the flag for NEW uploads of this ID.
 */
router.post('/:id/reencode', async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT id, status, encryption_enabled FROM videos WHERE id = $1',
      [req.params.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const current = existing.rows[0];
    if (current.status === 'processing' || current.status === 'uploading') {
      return res.status(409).json({ error: 'Video is already being processed' });
    }

    const desired = req.body.encrypt === true || req.body.encrypt === 'true';
    if (!!current.encryption_enabled === desired) {
      return res.status(400).json({ error: `Video is already ${desired ? 'encrypted' : 'unencrypted'}` });
    }

    // Flip the flag. Because the original upload has been deleted, the only
    // way to actually re-encode is for the admin to re-upload. We return a
    // 202 with a clear message rather than silently succeeding — this keeps
    // the behavior honest and avoids inconsistent state where the DB says
    // "encrypted" but the segments on storage are still plaintext.
    await db.query(
      'UPDATE videos SET encryption_enabled = $1, updated_at = NOW() WHERE id = $2',
      [desired, req.params.id]
    );
    await audit(req, 'video.encryption_toggle', 'video', req.params.id, {
      from: !!current.encryption_enabled, to: desired,
    });
    return res.status(202).json({
      message: `Encryption flag updated to ${desired}. Re-upload the source to apply to segments. Existing HLS segments are still ${!current.encryption_enabled ? 'unencrypted' : 'encrypted'} until a fresh encode runs.`,
      encryption_enabled: desired,
      requires_reupload: true,
    });
  } catch (err) {
    console.error('Reencode toggle error:', err);
    res.status(500).json({ error: 'Failed to toggle encryption' });
  }
});

/**
 * POST /:id/rotate-key — Replace the AES key for an encrypted video.
 *
 * This is an EMERGENCY action — the existing HLS segments were encrypted
 * with the old key, so rotating the DB key will make the video UNPLAYABLE
 * until the admin re-uploads it (the worker writes a fresh key on every
 * encode via `ON CONFLICT DO UPDATE`).
 *
 * Use case: the AES key (or a JWT token for it) has been leaked and the
 * admin wants to immediately revoke the ability of an attacker who has
 * scraped the segments from also decrypting them. Rotating the DB key
 * + asking the admin to re-upload is the only clean mitigation.
 *
 * Owner/admin only — editors can't rotate keys.
 */
router.post('/:id/rotate-key', requireMinRole('admin'), async (req, res) => {
  try {
    const { generateAndStoreKey } = require('../services/aes-keys');
    const existing = await db.query(
      'SELECT id, status, encryption_enabled FROM videos WHERE id = $1',
      [req.params.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const v = existing.rows[0];
    if (!v.encryption_enabled) {
      return res.status(400).json({ error: 'Video is not encrypted; nothing to rotate.' });
    }

    // Generate + store a fresh key, overwriting the old row (the service
    // already uses ON CONFLICT DO UPDATE so no explicit delete needed).
    const { ivHex } = await generateAndStoreKey(req.params.id);

    await audit(req, 'video.key_rotated', 'video', req.params.id, {
      iv_prefix: ivHex.slice(0, 8), // just enough to correlate, not the full IV
    });

    return res.status(202).json({
      message: 'Key rotated. Existing HLS segments were encrypted with the previous key and will no longer play. Re-upload the source to apply the new key to segments.',
      rotated: true,
      requires_reupload: true,
    });
  } catch (err) {
    console.error('Key rotation error:', err);
    res.status(500).json({ error: 'Failed to rotate key' });
  }
});

// DELETE /:id - Delete video
router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    await storage.deleteFolder(`videos/${req.params.id}`);
    await db.query('DELETE FROM videos WHERE id = $1', [req.params.id]);
    triggerWebhooks('video.deleted', { id: req.params.id, title: existing.rows[0].title });
    await audit(req, 'video.delete', 'video', req.params.id, { title: existing.rows[0].title });
    res.json({ message: 'Video deleted' });
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// POST /bulk-delete - Delete multiple videos
router.post('/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }

    const existing = await db.query(
      'SELECT id FROM videos WHERE id = ANY($1)',
      [ids]
    );

    const validIds = existing.rows.map((r) => r.id);

    await Promise.all(
      validIds.map((id) => storage.deleteFolder(`videos/${id}`))
    );

    await db.query('DELETE FROM videos WHERE id = ANY($1)', [validIds]);
    await audit(req, 'video.bulk_delete', 'video', null, { count: validIds.length, ids: validIds });
    res.json({ deleted: validIds.length, ids: validIds });
  } catch (err) {
    console.error('Error bulk deleting videos:', err);
    res.status(500).json({ error: 'Failed to delete videos' });
  }
});

// GET /:id/embed - Return embed code
router.get('/:id/embed', async (req, res) => {
  try {
    const videoResult = await db.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const settingResult = await db.query(
      "SELECT value FROM settings WHERE key = 'domain_player'"
    );

    const domain = settingResult.rows.length > 0 && settingResult.rows[0].value
      ? settingResult.rows[0].value
      : req.protocol + '://' + req.get('host');

    const videoId = req.params.id;

    const iframe = `<iframe src="${domain}/embed/${videoId}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

    const js = `<div id="video-player-${videoId}"></div>
<script src="${domain}/player.js"></script>
<script>
  VideoPlayer.create({
    target: '#video-player-${videoId}',
    videoId: '${videoId}'
  });
</script>`;

    res.json({
      video: videoResult.rows[0],
      embed: { iframe, js },
    });
  } catch (err) {
    console.error('Error getting embed code:', err);
    res.status(500).json({ error: 'Failed to get embed code' });
  }
});

// POST /:id/thumbnail - Upload a custom thumbnail image for a video
router.post('/:id/thumbnail', (req, res, next) => {
  uploadThumbnail(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const cleanupTmp = async () => {
    if (req.file && req.file.path) await fs.promises.unlink(req.file.path).catch(() => {});
  };

  try {
    const videoResult = await db.query(
      'SELECT id, thumbnail_url FROM videos WHERE id = $1',
      [req.params.id]
    );
    if (videoResult.rows.length === 0) {
      await cleanupTmp();
      return res.status(404).json({ error: 'Video not found' });
    }
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const buffer = await fs.promises.readFile(file.path);
    // Derive content-type from the extension (NOT the client-supplied mimetype,
    // which can be spoofed). Extension was already whitelisted by thumbnailFilter.
    const rawExt = path.extname(file.originalname).toLowerCase() || '.jpg';
    const extMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
    const contentType = extMap[rawExt] || 'image/jpeg';
    const normalizedExt = rawExt === '.jpeg' ? '.jpg' : rawExt;
    const storageKey = `videos/${req.params.id}/hls/thumbnail${normalizedExt}`;

    await storage.uploadFile(storageKey, buffer, contentType);
    await cleanupTmp();

    const thumbnailUrl = `/cdn/${storageKey}`;
    // Lock against re-encode overwrite — custom_thumbnail_set tells the
    // worker to keep this file instead of regenerating on the next job.
    await db.query(
      'UPDATE videos SET thumbnail_url = $1, custom_thumbnail_set = TRUE WHERE id = $2',
      [thumbnailUrl, req.params.id]
    );

    await audit(req, 'video.thumbnail_updated', 'video', req.params.id, {
      size: file.size,
      mime: contentType,
      source: 'upload'
    });

    res.json({ thumbnail_url: thumbnailUrl, custom: true });
  } catch (err) {
    console.error('Error uploading thumbnail:', err);
    await cleanupTmp();
    res.status(500).json({ error: 'Failed to upload thumbnail' });
  }
});

// POST /:id/thumbnail/candidate - Pick one of the 3 auto-generated candidates.
// Body: { candidate: 1 | 2 | 3 }. Copies candidate-N.jpg → thumbnail.jpg in
// storage and points thumbnail_url at the new file. Does NOT set
// custom_thumbnail_set — picking a candidate still allows re-encode to
// refresh candidates (user can re-pick). An explicit upload locks.
router.post('/:id/thumbnail/candidate', async (req, res) => {
  // Collapsed into a single 404 to avoid ID/state enumeration through
  // distinct error messages. Logs stay detailed server-side.
  const GENERIC_404 = { error: 'Not found' };
  try {
    const idx = Number(req.body && req.body.candidate);
    if (![1, 2, 3].includes(idx)) {
      return res.status(400).json({ error: 'candidate must be 1, 2, or 3' });
    }

    const videoResult = await db.query(
      'SELECT id, thumbnail_candidates FROM videos WHERE id = $1',
      [req.params.id]
    );
    if (videoResult.rows.length === 0) {
      return res.status(404).json(GENERIC_404);
    }

    const candidates = videoResult.rows[0].thumbnail_candidates || [];
    const picked = Array.isArray(candidates) && candidates.find(c => c.index === idx);
    if (!picked) {
      return res.status(404).json(GENERIC_404);
    }

    // Copy candidate-N.jpg → thumbnail.jpg in storage
    const srcKey = `videos/${req.params.id}/hls/candidate-${idx}.jpg`;
    const dstKey = `videos/${req.params.id}/hls/thumbnail.jpg`;
    let buffer;
    try {
      buffer = await storage.readFile(srcKey);
    } catch (e) {
      console.warn(`[videos] candidate source missing for ${req.params.id} idx=${idx}:`, e.message);
      return res.status(404).json(GENERIC_404);
    }
    await storage.uploadFile(dstKey, buffer, 'image/jpeg');

    const thumbnailUrl = `/cdn/${dstKey}`;
    await db.query(
      'UPDATE videos SET thumbnail_url = $1, custom_thumbnail_set = FALSE WHERE id = $2',
      [thumbnailUrl, req.params.id]
    );

    await audit(req, 'video.thumbnail_updated', 'video', req.params.id, {
      source: 'candidate',
      candidate: idx
    });

    res.json({ thumbnail_url: thumbnailUrl, custom: false });
  } catch (err) {
    console.error('Error selecting thumbnail candidate:', err);
    res.status(500).json({ error: 'Failed to select candidate' });
  }
});

// POST /:id/subtitles - Upload subtitle
router.post('/:id/subtitles', (req, res, next) => {
  uploadSubtitle(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const videoResult = await db.query(
      'SELECT * FROM videos WHERE id = $1',
      [req.params.id]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No subtitle file provided. Only .vtt and .srt files are allowed.' });
    }

    const lang = req.body.lang || 'en';
    const label = req.body.label || lang;

    const storagePath = `videos/${req.params.id}/subtitles/${lang}${getSubtitleExtension(file.originalname)}`;

    // Store file in configured storage backend
    const fs = require('fs');
    const fileBuffer = await fs.promises.readFile(file.path);
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    const contentType = ext === '.srt' ? 'application/x-subrip' : 'text/vtt';
    await storage.uploadFile(storagePath, fileBuffer, contentType);

    // Clean up multer temp file
    await fs.promises.unlink(file.path).catch(() => {});

    // Delete existing subtitle for this language (if any) then insert
    await db.query(
      'DELETE FROM subtitles WHERE video_id = $1 AND language = $2',
      [req.params.id, lang]
    );
    const result = await db.query(
      `INSERT INTO subtitles (video_id, language, label, file_url, is_default, created_at)
       VALUES ($1, $2, $3, $4, FALSE, NOW())
       RETURNING *`,
      [req.params.id, lang, label, storagePath]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error uploading subtitle:', err);
    res.status(500).json({ error: 'Failed to upload subtitle: ' + (err.message || String(err)) });
  }
});

// GET /:id/subtitles - List subtitles for video
router.get('/:id/subtitles', async (req, res) => {
  try {
    const videoResult = await db.query(
      'SELECT id FROM videos WHERE id = $1',
      [req.params.id]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const result = await db.query(
      'SELECT * FROM subtitles WHERE video_id = $1 ORDER BY language',
      [req.params.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error listing subtitles:', err);
    res.status(500).json({ error: 'Failed to list subtitles: ' + (err.message || String(err)) });
  }
});

// DELETE /:id/subtitles/:lang - Delete subtitle
router.delete('/:id/subtitles/:lang', async (req, res) => {
  try {
    const videoResult = await db.query(
      'SELECT id FROM videos WHERE id = $1',
      [req.params.id]
    );

    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const subtitleResult = await db.query(
      'SELECT * FROM subtitles WHERE video_id = $1 AND language = $2',
      [req.params.id, req.params.lang]
    );

    if (subtitleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Subtitle not found' });
    }

    const subtitle = subtitleResult.rows[0];

    await storage.deleteFolder(subtitle.file_url);

    await db.query(
      'DELETE FROM subtitles WHERE video_id = $1 AND language = $2',
      [req.params.id, req.params.lang]
    );

    res.json({ message: 'Subtitle deleted' });
  } catch (err) {
    console.error('Error deleting subtitle:', err);
    res.status(500).json({ error: 'Failed to delete subtitle' });
  }
});

function getSubtitleExtension(filename) {
  const ext = filename.slice(filename.lastIndexOf('.'));
  return ext || '.vtt';
}

// ─────────────────────────────────────────────────────────────────────────
// VIDEO CHAPTERS
// Stored as JSONB array on videos.chapters — atomic, no file uploads.
// Format: [{ time: "mm:ss" | "hh:mm:ss", title: "..." }, ...]
// ─────────────────────────────────────────────────────────────────────────

// Allowed time formats: "m:ss", "mm:ss", "h:mm:ss", "hh:mm:ss"
const TIME_REGEX = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
const MAX_CHAPTERS = 50;
const MAX_TITLE_LEN = 200;

/**
 * Sanitize chapter title — strip HTML tags + control chars.
 * Defense-in-depth against XSS even though the dashboard already escapes
 * on render (via esc()) and the DB stores it as a plain string.
 */
function sanitizeChapterTitle(raw) {
  return String(raw || '')
    .replace(/<[^>]*>/g, '')      // strip HTML tags
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')  // strip control chars
    .trim()
    .slice(0, MAX_TITLE_LEN);
}

/**
 * Validate a chapters array. Returns { valid, error, cleaned }.
 * cleaned is the array with titles sanitized and sorted by timestamp.
 */
function validateChapters(input) {
  if (!Array.isArray(input)) {
    return { valid: false, error: 'chapters must be an array' };
  }
  if (input.length > MAX_CHAPTERS) {
    return { valid: false, error: `Max ${MAX_CHAPTERS} chapters per video` };
  }
  const cleaned = [];
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!c || typeof c !== 'object') {
      return { valid: false, error: `Chapter #${i + 1}: must be an object` };
    }
    const time = String(c.time || '').trim();
    if (!TIME_REGEX.test(time)) {
      return { valid: false, error: `Chapter #${i + 1}: invalid time format '${time}' (expected mm:ss or hh:mm:ss)` };
    }
    const title = sanitizeChapterTitle(c.title);
    if (!title) {
      return { valid: false, error: `Chapter #${i + 1}: title required (1-${MAX_TITLE_LEN} chars)` };
    }
    cleaned.push({ time, title });
  }
  // Sort by timestamp so the array is always ordered on read.
  cleaned.sort((a, b) => timeToSeconds(a.time) - timeToSeconds(b.time));
  return { valid: true, cleaned };
}

function timeToSeconds(t) {
  const parts = t.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// GET /:id/chapters — return the chapters array for a video
router.get('/:id/chapters', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT chapters FROM videos WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const chapters = result.rows[0].chapters || [];
    res.json({ chapters });
  } catch (err) {
    console.error('Get chapters error:', err);
    res.status(500).json({ error: 'Failed to load chapters' });
  }
});

// PUT /:id/chapters — replace the chapters array for a video
router.put('/:id/chapters', async (req, res) => {
  try {
    const videoResult = await db.query(
      'SELECT id FROM videos WHERE id = $1',
      [req.params.id]
    );
    if (!videoResult.rows.length) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const input = req.body?.chapters;
    const { valid, error, cleaned } = validateChapters(input || []);
    if (!valid) {
      return res.status(400).json({ error });
    }

    await db.query(
      'UPDATE videos SET chapters = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(cleaned), req.params.id]
    );

    await audit(req, 'video.chapters_updated', 'video', req.params.id, {
      count: cleaned.length,
    });

    res.json({ chapters: cleaned });
  } catch (err) {
    console.error('Save chapters error:', err);
    res.status(500).json({ error: 'Failed to save chapters' });
  }
});

module.exports = router;
