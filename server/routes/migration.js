const express = require('express');
const Queue = require('bull');
const db = require('../db/index.js');
const auth = require('../middleware/auth');
const storage = require('../services/storage');

const router = express.Router();

const migrationQueue = new Queue('storage-migration', process.env.REDIS_URL);

// POST /start - Start a storage migration
router.post('/start', auth, async (req, res) => {
  try {
    const {
      direction,      // 'local-to-r2' or 'r2-to-local'
      scope,          // 'all', 'folder', or 'selected'
      folder_id,      // required if scope === 'folder'
      video_ids,      // required if scope === 'selected'
      delete_source,  // boolean
      skip_migrated,  // boolean
    } = req.body;

    // Validate direction
    if (!['local-to-r2', 'r2-to-local'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction. Use "local-to-r2" or "r2-to-local"' });
    }

    // Check if a migration is already running
    const activeJobs = await migrationQueue.getActive();
    const waitingJobs = await migrationQueue.getWaiting();
    if (activeJobs.length > 0 || waitingJobs.length > 0) {
      return res.status(409).json({ error: 'A migration is already in progress' });
    }

    // Get video IDs based on scope
    let videoIds = [];
    const sourceType = direction === 'local-to-r2' ? 'local' : 'r2';

    if (scope === 'selected' && Array.isArray(video_ids) && video_ids.length > 0) {
      videoIds = video_ids;
    } else if (scope === 'folder' && folder_id) {
      const result = await db.query(
        'SELECT id FROM videos WHERE folder_id = $1 AND status = $2 ORDER BY created_at',
        [folder_id, 'ready']
      );
      videoIds = result.rows.map((r) => r.id);
    } else {
      // Default: all videos
      const result = await db.query(
        'SELECT id FROM videos WHERE status = $1 ORDER BY created_at',
        ['ready']
      );
      videoIds = result.rows.map((r) => r.id);
    }

    if (videoIds.length === 0) {
      return res.status(400).json({ error: 'No eligible videos found for migration' });
    }

    // Queue the migration job
    const job = await migrationQueue.add(
      {
        direction,
        videoIds,
        deleteSource: delete_source !== false,
        skipMigrated: skip_migrated !== false,
      },
      {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    res.json({
      message: 'Migration started',
      jobId: job.id,
      totalVideos: videoIds.length,
      direction,
    });
  } catch (err) {
    console.error('Start migration error:', err);
    res.status(500).json({ error: 'Failed to start migration' });
  }
});

// GET /status - Get migration status
router.get('/status', auth, async (req, res) => {
  try {
    // Check active jobs
    const activeJobs = await migrationQueue.getActive();
    if (activeJobs.length > 0) {
      const job = activeJobs[0];
      const progress = job.progress() || {};
      return res.json({
        status: 'running',
        jobId: job.id,
        direction: job.data.direction,
        totalVideos: job.data.videoIds.length,
        progress,
      });
    }

    // Check waiting jobs
    const waitingJobs = await migrationQueue.getWaiting();
    if (waitingJobs.length > 0) {
      const job = waitingJobs[0];
      return res.json({
        status: 'queued',
        jobId: job.id,
        direction: job.data.direction,
        totalVideos: job.data.videoIds.length,
      });
    }

    // Check most recent completed/failed job
    const completedJobs = await migrationQueue.getCompleted(0, 0);
    const failedJobs = await migrationQueue.getFailed(0, 0);

    const allRecent = [...completedJobs, ...failedJobs].sort(
      (a, b) => (b.finishedOn || 0) - (a.finishedOn || 0)
    );

    if (allRecent.length > 0) {
      const job = allRecent[0];
      const isFailed = job.failedReason !== undefined && job.failedReason !== null;
      return res.json({
        status: isFailed ? 'failed' : 'completed',
        jobId: job.id,
        direction: job.data.direction,
        totalVideos: job.data.videoIds.length,
        result: job.returnvalue || null,
        error: job.failedReason || null,
        finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      });
    }

    res.json({ status: 'idle' });
  } catch (err) {
    console.error('Migration status error:', err);
    res.status(500).json({ error: 'Failed to get migration status' });
  }
});

// POST /cancel - Cancel a running migration
router.post('/cancel', auth, async (req, res) => {
  try {
    const activeJobs = await migrationQueue.getActive();
    const waitingJobs = await migrationQueue.getWaiting();

    let cancelled = 0;

    for (const job of waitingJobs) {
      await job.remove();
      cancelled++;
    }

    for (const job of activeJobs) {
      await job.discard();
      await job.moveToFailed({ message: 'Cancelled by user' });
      cancelled++;
    }

    if (cancelled === 0) {
      return res.json({ message: 'No migration to cancel' });
    }

    res.json({ message: `Cancelled ${cancelled} migration job(s)` });
  } catch (err) {
    console.error('Cancel migration error:', err);
    res.status(500).json({ error: 'Failed to cancel migration' });
  }
});

// POST /clear - Clear migration history
router.post('/clear', auth, async (req, res) => {
  try {
    await migrationQueue.clean(0, 'completed');
    await migrationQueue.clean(0, 'failed');
    res.json({ message: 'Migration history cleared' });
  } catch (err) {
    console.error('Clear migration history error:', err);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

// GET /summary - Get video counts by storage type
router.get('/summary', auth, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT storage_type, COUNT(*)::int as count,
              COALESCE(SUM(file_size), 0)::bigint as total_size
       FROM videos WHERE status = 'ready'
       GROUP BY storage_type`
    );

    const summary = { local: { count: 0, totalSize: 0 }, r2: { count: 0, totalSize: 0 } };
    for (const row of result.rows) {
      if (row.storage_type === 'local' || row.storage_type === 'r2') {
        summary[row.storage_type] = {
          count: row.count,
          totalSize: Number(row.total_size),
        };
      }
    }

    // Get current storage mode
    const currentMode = await storage.getStorageMode();

    // Get folder list for scope selection
    const folders = await db.query(
      `SELECT f.id, f.name, COUNT(v.id)::int as video_count
       FROM folders f
       LEFT JOIN videos v ON v.folder_id = f.id AND v.status = 'ready'
       GROUP BY f.id, f.name
       ORDER BY f.name`
    );

    res.json({
      currentMode,
      summary,
      folders: folders.rows,
    });
  } catch (err) {
    console.error('Migration summary error:', err);
    res.status(500).json({ error: 'Failed to get migration summary' });
  }
});

module.exports = router;
