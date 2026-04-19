require('dotenv').config();

const Queue = require('bull');
const crypto = require('crypto');
const db = require('./db');
const storage = require('./services/storage');

const migrationQueue = new Queue('storage-migration', process.env.REDIS_URL);

// MIME types for content-type detection
const MIME_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.jpeg': 'video/MP2T',
  '.jpg': 'image/jpeg',
  '.vtt': 'text/vtt',
  '.srt': 'application/x-subrip',
};

function getContentType(filename) {
  const ext = filename.substring(filename.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

migrationQueue.process(1, async (job) => {
  const { direction, videoIds, deleteSource, skipMigrated } = job.data;
  // direction: 'local-to-r2' or 'r2-to-local'
  const sourceMode = direction === 'local-to-r2' ? 'local' : 'r2';
  const targetMode = direction === 'local-to-r2' ? 'r2' : 'local';

  const results = {
    total: videoIds.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    currentVideo: null,
  };

  for (let i = 0; i < videoIds.length; i++) {
    const videoId = videoIds[i];

    // Check if job was cancelled
    const currentJob = await migrationQueue.getJob(job.id);
    if (!currentJob) break;

    try {
      // Fetch video
      const videoResult = await db.query(
        'SELECT id, title, storage_type, status FROM videos WHERE id = $1',
        [videoId]
      );

      if (videoResult.rows.length === 0) {
        results.skipped++;
        continue;
      }

      const video = videoResult.rows[0];
      results.currentVideo = video.title;

      // Skip if already on target storage
      if (skipMigrated && video.storage_type === targetMode) {
        results.skipped++;
        job.progress({
          ...results,
          percent: Math.round(((i + 1) / videoIds.length) * 100),
        });
        continue;
      }

      // Skip videos that aren't ready
      if (video.status !== 'ready') {
        results.skipped++;
        continue;
      }

      // List all files for this video from source
      const prefix = `videos/${videoId}/`;
      const fileKeys = await storage.listFiles(prefix, sourceMode);

      if (fileKeys.length === 0) {
        results.skipped++;
        continue;
      }

      // Copy each file from source to target
      let allFilesOk = true;
      const copiedKeys = [];

      for (const key of fileKeys) {
        try {
          // Read from source
          const buffer = await storage.readFile(key, sourceMode);
          const sourceChecksum = md5(buffer);

          // Write to target
          const contentType = getContentType(key);
          await storage.uploadFileTo(key, buffer, contentType, targetMode);

          // Verify: read back from target and compare checksum
          const verifyBuffer = await storage.readFile(key, targetMode);
          const targetChecksum = md5(verifyBuffer);

          if (sourceChecksum !== targetChecksum) {
            throw new Error(`Checksum mismatch for ${key}`);
          }

          copiedKeys.push(key);
        } catch (fileErr) {
          allFilesOk = false;
          results.errors.push({
            videoId,
            videoTitle: video.title,
            file: key,
            error: fileErr.message,
          });
          break;
        }
      }

      if (!allFilesOk) {
        // Rollback: delete any files we copied to target
        for (const key of copiedKeys) {
          try {
            await storage.deleteFileFrom(key, targetMode);
          } catch {
            // Best effort cleanup
          }
        }
        results.failed++;
        job.progress({
          ...results,
          percent: Math.round(((i + 1) / videoIds.length) * 100),
        });
        continue;
      }

      // Update DB: set storage_type to target
      await db.query(
        'UPDATE videos SET storage_type = $1 WHERE id = $2',
        [targetMode, videoId]
      );

      // Delete source files if requested
      if (deleteSource) {
        for (const key of fileKeys) {
          try {
            await storage.deleteFileFrom(key, sourceMode);
          } catch {
            // Best effort - don't fail migration for cleanup issues
          }
        }
      }

      results.migrated++;
    } catch (err) {
      results.failed++;
      results.errors.push({
        videoId,
        error: err.message,
      });
    }

    // Report progress
    job.progress({
      ...results,
      percent: Math.round(((i + 1) / videoIds.length) * 100),
    });
  }

  results.currentVideo = null;
  return results;
});

migrationQueue.on('failed', (job, err) => {
  console.error(`Migration job ${job.id} failed:`, err.message);
});

migrationQueue.on('completed', (job, result) => {
  console.log(
    `Migration job ${job.id} completed: ${result.migrated} migrated, ${result.skipped} skipped, ${result.failed} failed`
  );
});

console.log('Storage migration worker started');

module.exports = migrationQueue;
