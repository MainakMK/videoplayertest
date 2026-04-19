const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const Bull    = require('bull');
const router  = express.Router();
const db      = require('../db/index');
const auth    = require('../middleware/auth');
const { requireMinRole } = require('../middleware/roles');
const aria2    = require('../services/aria2');
const storage  = require('../services/storage');
const { audit } = require('../services/audit');

const videoQueue = new Bull('video-processing', process.env.REDIS_URL);
const DOWNLOAD_DIR = process.env.TORRENT_DOWNLOAD_DIR || path.join(process.cwd(), 'downloads', 'torrents');

// Ensure download directory exists
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

router.use(auth, requireMinRole('admin'));

// ── GET / — List all torrent downloads with live status ──
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM torrent_downloads ORDER BY created_at DESC LIMIT 50'
    );

    // Enrich downloads with live aria2 data
    const enriched = await Promise.all(rows.map(async (row) => {
      // Query aria2 for any non-final status (active, paused, or DB says active but aria2 finished)
      const needsAria2 = row.gid && (row.status === 'active' || row.status === 'paused' || row.status === 'seeding');
      if (needsAria2) {
        try {
          const s = await aria2.tellStatus(row.gid);

          // Calculate real total from file list (accurate even for torrents)
          const fileTotalSize = (s.files || []).reduce((sum, f) => sum + parseInt(f.length || '0', 10), 0);
          const reportedTotal = parseInt(s.totalLength || '0', 10);

          row.total_size = fileTotalSize > reportedTotal ? fileTotalSize : reportedTotal;
          row.downloaded = parseInt(s.completedLength || '0', 10);
          row.download_speed = parseInt(s.downloadSpeed || '0', 10);
          row.upload_speed = parseInt(s.uploadSpeed || '0', 10);
          row.num_seeders = parseInt(s.numSeeders || '0', 10);
          row.num_peers = parseInt(s.connections || '0', 10);
          row.progress = row.total_size > 0 ? (row.downloaded / row.total_size) * 100 : 0;

          // Extract name from bittorrent info if not set
          if (!row.name && s.bittorrent?.info?.name) {
            row.name = s.bittorrent.info.name;
            await db.query('UPDATE torrent_downloads SET name = $1 WHERE id = $2', [row.name, row.id]);
          }

          const newStatus = aria2.normalizeStatus(s.status);

          // Detect completion
          if (s.status === 'complete' && row.status !== 'complete' && row.status !== 'processing') {
            row.status = 'complete';
            const videoFile = aria2.findLargestVideoFile(s.files);
            row.file_path = videoFile?.path || null;
            row.downloaded = row.total_size; // complete = downloaded everything
            await db.query(
              `UPDATE torrent_downloads SET status='complete', downloaded=$1, total_size=$2,
               progress=100, file_path=$3, completed_at=NOW() WHERE id=$4`,
              [row.total_size, row.total_size, row.file_path, row.id]
            );
          } else if (newStatus !== row.status && row.status !== 'processing') {
            await db.query('UPDATE torrent_downloads SET status=$1, downloaded=$2, total_size=$3, progress=$4 WHERE id=$5',
              [newStatus, row.downloaded, row.total_size, row.progress, row.id]);
            row.status = newStatus;
          }
        } catch (e) {
          // GID not found in aria2 — check if it completed while we weren't looking
          if (e.message?.includes('not found') || e.code === 1) {
            // Try stopped list
            try {
              const s = await aria2.tellStatus(row.gid).catch(() => null);
              if (!s) {
                // Truly gone — check disk for downloaded files
                const dlDir = path.join(DOWNLOAD_DIR, row.name || '');
                if (fs.existsSync(dlDir)) {
                  const files = fs.readdirSync(dlDir).map(f => ({ path: path.join(dlDir, f), length: String(fs.statSync(path.join(dlDir, f)).size) }));
                  const videoFile = aria2.findLargestVideoFile(files);
                  if (videoFile) {
                    row.status = 'complete';
                    row.file_path = videoFile.path;
                    row.total_size = videoFile.size;
                    row.downloaded = videoFile.size;
                    row.progress = 100;
                    await db.query(
                      `UPDATE torrent_downloads SET status='complete', downloaded=$1, total_size=$2,
                       progress=100, file_path=$3, completed_at=NOW() WHERE id=$4`,
                      [row.total_size, row.total_size, row.file_path, row.id]
                    );
                  } else if (row.status === 'active') {
                    await db.query("UPDATE torrent_downloads SET status='error', error_message='Download lost from aria2' WHERE id=$1", [row.id]);
                    row.status = 'error';
                    row.error_message = 'Download lost from aria2';
                  }
                } else if (row.status === 'active') {
                  await db.query("UPDATE torrent_downloads SET status='error', error_message='Download lost from aria2' WHERE id=$1", [row.id]);
                  row.status = 'error';
                  row.error_message = 'Download lost from aria2';
                }
              }
            } catch {}
          }
        }
      }

      // Safety net: for any completed download, verify file size from disk
      if ((row.status === 'complete' || row.status === 'processing') && row.file_path) {
        try {
          const stat = fs.statSync(row.file_path);
          if (stat.size > row.total_size) {
            row.total_size = stat.size;
            row.downloaded = stat.size;
            await db.query('UPDATE torrent_downloads SET total_size=$1, downloaded=$2 WHERE id=$3', [stat.size, stat.size, row.id]);
          }
        } catch {}
      }

      return row;
    }));

    // Get global stats
    let globalStats = { downloadSpeed: '0', uploadSpeed: '0', numActive: '0' };
    try { globalStats = await aria2.getGlobalStat(); } catch {}

    res.json({
      downloads: enriched,
      stats: {
        download_speed: parseInt(globalStats.downloadSpeed || '0', 10),
        upload_speed: parseInt(globalStats.uploadSpeed || '0', 10),
        active_count: parseInt(globalStats.numActive || '0', 10),
      },
      aria2_connected: await aria2.isConnected(),
    });
  } catch (err) {
    console.error('Error listing torrents:', err);
    res.status(500).json({ error: 'Failed to list torrent downloads' });
  }
});

// ── POST /add — Add magnet URI or direct URL ──
router.post('/add', async (req, res) => {
  try {
    const { magnet_uri, url, storage_type, name: customName } = req.body;
    const uri = magnet_uri || url || '';

    const isMagnet = uri.startsWith('magnet:');
    const isHttp = uri.startsWith('http://') || uri.startsWith('https://');
    const isFtp = uri.startsWith('ftp://');

    if (!uri || (!isMagnet && !isHttp && !isFtp)) {
      return res.status(400).json({ error: 'Invalid URI. Must be a magnet link, HTTP/HTTPS URL, or FTP URL.' });
    }

    // Check aria2 is running
    const connected = await aria2.isConnected();
    if (!connected) {
      return res.status(503).json({ error: 'aria2 daemon is not running. Start it with: aria2c --enable-rpc' });
    }

    // Determine source type and name
    const sourceType = isMagnet ? 'magnet' : 'url';
    let name;
    if (customName) {
      name = customName;
    } else if (isMagnet) {
      name = aria2.parseMagnetName(uri) || 'Unknown Torrent';
    } else {
      try {
        const urlPath = new URL(uri).pathname;
        const decoded = decodeURIComponent(urlPath.split('/').pop() || '');
        name = decoded || 'Direct Download';
      } catch { name = 'Direct Download'; }
    }

    // Build aria2 options
    const options = { dir: DOWNLOAD_DIR };
    if (isMagnet) {
      options['seed-time'] = '0';
      options['max-upload-limit'] = '100K';
      options['bt-stop-timeout'] = '60';
    } else {
      // HTTP: use 16 connections for faster download
      options['max-connection-per-server'] = '16';
      options['split'] = '16';
      options['min-split-size'] = '1M';
    }

    // Start download via aria2
    const gid = await aria2.addUri([uri], options);

    // Insert into DB
    const { rows } = await db.query(
      `INSERT INTO torrent_downloads (gid, magnet_uri, name, status, storage_type, source_type, created_at)
       VALUES ($1, $2, $3, 'active', $4, $5, NOW()) RETURNING *`,
      [gid, uri, name, storage_type || 'local', sourceType]
    );

    audit(req, 'download.add', 'download', rows[0].id, { name, gid, source_type: sourceType });

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error adding torrent:', err);
    res.status(500).json({ error: err.message || 'Failed to add torrent' });
  }
});

// ── GET /:id/status — Get single torrent status ──
router.get('/:id/status', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM torrent_downloads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Torrent not found' });

    const row = rows[0];
    if (row.gid && (row.status === 'active' || row.status === 'paused')) {
      try {
        const s = await aria2.tellStatus(row.gid);
        row.downloaded = parseInt(s.completedLength || '0', 10);
        row.total_size = parseInt(s.totalLength || '0', 10);
        row.download_speed = parseInt(s.downloadSpeed || '0', 10);
        row.upload_speed = parseInt(s.uploadSpeed || '0', 10);
        row.num_seeders = parseInt(s.numSeeders || '0', 10);
        row.num_peers = parseInt(s.connections || '0', 10);
        row.progress = row.total_size > 0 ? (row.downloaded / row.total_size) * 100 : 0;
      } catch {}
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get torrent status' });
  }
});

// ── POST /:id/pause — Pause download ──
router.post('/:id/pause', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM torrent_downloads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Torrent not found' });

    await aria2.pause(rows[0].gid);
    await db.query("UPDATE torrent_downloads SET status='paused' WHERE id=$1", [req.params.id]);
    audit(req, 'torrent.pause', 'torrent', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to pause' });
  }
});

// ── POST /:id/resume — Resume download ──
router.post('/:id/resume', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM torrent_downloads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Torrent not found' });

    await aria2.unpause(rows[0].gid);
    await db.query("UPDATE torrent_downloads SET status='active' WHERE id=$1", [req.params.id]);
    audit(req, 'torrent.resume', 'torrent', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to resume' });
  }
});

// ── DELETE /:id — Cancel and remove download ──
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM torrent_downloads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Torrent not found' });

    const row = rows[0];
    if (row.gid) {
      try { await aria2.forceRemove(row.gid); } catch {}
      try { await aria2.removeDownloadResult(row.gid); } catch {}
    }

    // Clean up downloaded files
    if (row.file_path) {
      try { fs.unlinkSync(row.file_path); } catch {}
    }

    await db.query('DELETE FROM torrent_downloads WHERE id = $1', [req.params.id]);
    audit(req, 'torrent.delete', 'torrent', req.params.id, { name: row.name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove torrent' });
  }
});

// ── POST /:id/process — Trigger video processing for completed download ──
router.post('/:id/process', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM torrent_downloads WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Torrent not found' });

    const torrent = rows[0];
    if (torrent.status !== 'complete') {
      return res.status(400).json({ error: 'Torrent download not complete yet' });
    }
    if (!torrent.file_path) {
      return res.status(400).json({ error: 'No video file found in download' });
    }
    if (torrent.video_id) {
      return res.status(400).json({ error: 'Already processing', video_id: torrent.video_id });
    }

    // Generate video ID
    const videoId = crypto.randomBytes(8).toString('base64url').slice(0, 12);
    const title = torrent.name?.replace(/\.[^/.]+$/, '') || 'Torrent Video';
    const fileName = path.basename(torrent.file_path);
    const fileSize = fs.existsSync(torrent.file_path) ? fs.statSync(torrent.file_path).size : torrent.total_size;

    // Create video entry — embed link is available immediately
    const videoResult = await db.query(
      `INSERT INTO videos (id, title, original_filename, file_size, status, storage_type, visibility, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'uploading', $5, 'private', NOW(), NOW()) RETURNING *`,
      [videoId, title, fileName, fileSize, torrent.storage_type || 'local']
    );

    // Import subtitle files NOW (before encoding, so embed link already has subtitles)
    const torrentDir = path.dirname(torrent.file_path);
    try {
      const subtitleExts = ['.srt', '.vtt', '.ass', '.sub'];
      const allFiles = fs.existsSync(torrentDir) ? fs.readdirSync(torrentDir) : [];
      for (const file of allFiles) {
        const ext = path.extname(file).toLowerCase();
        if (!subtitleExts.includes(ext)) continue;
        const parts = file.replace(ext, '').split('.');
        const lang = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : 'en';
        const subPath = path.join(torrentDir, file);
        const storageDest = `videos/${videoId}/subtitles/${lang}${ext}`;
        // Ensure storage directory exists for local storage
        const destDir = path.dirname(path.join(process.cwd(), 'uploads', storageDest));
        fs.mkdirSync(destDir, { recursive: true });
        // Upload to storage (local or R2)
        const subBuffer = fs.readFileSync(subPath);
        await storage.uploadFile(storageDest, subBuffer, 'text/plain');
        await db.query(
          `INSERT INTO subtitles (video_id, language, label, file_url, is_default, created_at)
           VALUES ($1, $2, $3, $4, FALSE, NOW()) ON CONFLICT DO NOTHING`,
          [videoId, lang, lang, storageDest]
        );
        console.log(`Imported subtitle: ${file} → ${lang} for video ${videoId}`);
      }
    } catch (subErr) {
      console.error('Subtitle import warning:', subErr.message);
    }

    // Queue for FFmpeg processing
    await videoQueue.add({
      videoId,
      filePath: torrent.file_path,
      originalFilename: fileName,
      storageType: torrent.storage_type || 'local',
      torrentDir: path.dirname(torrent.file_path), // for cleanup after encoding
    }, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 30000 },
    });

    // Remove from downloads — video now lives in Videos section only
    await db.query('DELETE FROM torrent_downloads WHERE id = $1', [torrent.id]);

    audit(req, 'torrent.process', 'torrent', torrent.id, { video_id: videoId, title });

    res.json({ success: true, video_id: videoId, video: videoResult.rows[0] });
  } catch (err) {
    console.error('Error processing torrent:', err);
    res.status(500).json({ error: 'Failed to start video processing' });
  }
});

// ── GET /health — Check aria2 connection ──
router.get('/health', async (req, res) => {
  try {
    const version = await aria2.getVersion();
    res.json({ connected: true, version: version.version, features: version.enabledFeatures });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

module.exports = router;
