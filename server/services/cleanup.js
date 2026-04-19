/**
 * Auto-cleanup service.
 *
 * Removes failed, errored, and stuck-uploading videos older than a configurable
 * threshold. Reads `auto_cleanup` and `auto_cleanup_days` from the settings table.
 *
 * Cleanup handles ALL three storage stages per video:
 *   STAGE 1 — multer temp:          server/uploads/{timestamp}-{originalFilename}
 *   STAGE 2 — FFmpeg output dir:    server/uploads/processing/{videoId}/
 *   STAGE 3 — final storage:        storage/local/videos/{videoId}/  OR  R2 videos/{videoId}/*
 *
 * The cleanup also performs an orphan scan — files in server/uploads/ that don't
 * correspond to any video row (e.g. user disconnected mid-multer-upload) are removed
 * after `orphanMaxAgeHours` (default 24h) to avoid accidentally deleting a legit
 * upload that's still in progress.
 *
 * Exposes:
 *   - runStorageCleanup({ olderThanDays?, requestedBy?, scanOrphans? })
 *   - startCleanupScheduler() — hourly tick, no-op when auto_cleanup is disabled.
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const storage = require('./storage');

let _schedulerStarted = false;
let _isRunning = false;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const ORPHAN_MAX_AGE_HOURS = 24; // Keep orphan files for at least 24 h before sweeping

// Paths used by the upload pipeline
const UPLOADS_DIR = path.resolve(path.join(__dirname, '..', 'uploads'));
const PROCESSING_DIR = path.resolve(path.join(__dirname, '..', 'uploads', 'processing'));

// ─────────────────────────────────────────────────────────────────────────────
// Settings helpers
// ─────────────────────────────────────────────────────────────────────────────

async function _getSetting(key, defaultValue = null) {
  try {
    const r = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
    return r.rows.length ? r.rows[0].value : defaultValue;
  } catch {
    return defaultValue;
  }
}

async function _setSetting(key, value) {
  try {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, value]
    );
  } catch (e) {
    console.error('[cleanup] Failed to write setting', key, e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-stage purge helpers
// Each helper is best-effort — a failure on one stage never aborts the others.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STAGE 3: Delete final storage assets for a video.
 * Uses the VIDEO'S OWN storage_type, not the current global mode.
 *
 * For local: storage/local/videos/{id}/ (or wherever storage_local_path points)
 * For R2:    ListObjects(Prefix=videos/{id}/) → DeleteObject each
 */
async function _purgeFinalStorage(video) {
  // Accept any legacy null by defaulting to 'local' (historical rows may have null)
  const mode = video.storage_type === 'r2' ? 'r2' : 'local';
  const prefix = `videos/${video.id}`;
  try {
    const removed = await storage.deleteFolderFrom(prefix, mode);
    return { ok: true, stage: 'final', mode, removed };
  } catch (e) {
    console.warn(`[cleanup] STAGE 3 failed for ${video.id} (${mode}): ${e.message}`);
    return { ok: false, stage: 'final', mode, error: e.message };
  }
}

/**
 * STAGE 2: Delete the FFmpeg temp output directory (server/uploads/processing/{id}/).
 */
function _purgeProcessingDir(videoId) {
  const dir = path.join(PROCESSING_DIR, String(videoId));
  try {
    if (fs.existsSync(dir) && _isInside(dir, PROCESSING_DIR)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return { ok: true, stage: 'processing', path: dir };
    }
    return { ok: true, stage: 'processing', skipped: true };
  } catch (e) {
    console.warn(`[cleanup] STAGE 2 failed for ${videoId}: ${e.message}`);
    return { ok: false, stage: 'processing', error: e.message };
  }
}

/**
 * STAGE 1: Delete the original multer temp file (server/uploads/{timestamp}-{filename}).
 *
 * The uploader names the file as `${Date.now()}-${originalFilename}`. We don't
 * know the timestamp portion, so we glob-match any file whose name ends with
 * `-{originalFilename}` or equals the original filename.
 */
function _purgeOriginalUpload(video) {
  if (!video.original_filename) return { ok: true, stage: 'original', skipped: true };
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return { ok: true, stage: 'original', skipped: true };

    const entries = fs.readdirSync(UPLOADS_DIR);
    const wanted = String(video.original_filename);
    let removed = 0;

    for (const entry of entries) {
      const full = path.join(UPLOADS_DIR, entry);
      // Only delete files that sit directly in UPLOADS_DIR; never descend into subfolders.
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isFile()) continue;

      // Match "{timestamp}-{originalFilename}" OR exact originalFilename
      const matchesTimestampForm = /^\d{10,}-/.test(entry) && entry.endsWith(`-${wanted}`);
      const matchesExact = entry === wanted;
      if (matchesTimestampForm || matchesExact) {
        try {
          fs.unlinkSync(full);
          removed++;
        } catch (e) {
          console.warn(`[cleanup] Failed to remove ${full}: ${e.message}`);
        }
      }
    }

    return { ok: true, stage: 'original', removed };
  } catch (e) {
    console.warn(`[cleanup] STAGE 1 failed for ${video.id}: ${e.message}`);
    return { ok: false, stage: 'original', error: e.message };
  }
}

/**
 * Purge all three stages for one video. Each stage runs independently.
 */
async function _purgeVideoAssets(video) {
  const results = [];
  results.push(await _purgeFinalStorage(video));  // STAGE 3
  results.push(_purgeProcessingDir(video.id));    // STAGE 2
  results.push(_purgeOriginalUpload(video));      // STAGE 1
  return results;
}

/**
 * Safety helper: verify `target` is inside `root` (prevents symlink traversal).
 */
function _isInside(target, root) {
  const t = path.resolve(target);
  const r = path.resolve(root);
  return t === r || t.startsWith(r + path.sep);
}

// ─────────────────────────────────────────────────────────────────────────────
// ORPHAN SCAN — Bug 4
// Finds files in server/uploads/ that don't correspond to any DB row,
// haven't been touched in >24h, and removes them.
// ─────────────────────────────────────────────────────────────────────────────

async function _orphanScan() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return { scanned: 0, removed: 0, skipped: 'dir-missing' };

    // Pull every known original_filename + path hint from the videos table
    const rows = await db.query(
      `SELECT id, original_filename FROM videos WHERE status IN ('uploading', 'processing', 'ready', 'error')`
    );
    const knownOriginals = new Set();
    const knownIds = new Set();
    for (const r of rows.rows) {
      if (r.original_filename) knownOriginals.add(String(r.original_filename));
      if (r.id) knownIds.add(String(r.id));
    }

    const cutoffMs = Date.now() - ORPHAN_MAX_AGE_HOURS * 60 * 60 * 1000;
    const entries = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true });
    let scanned = 0;
    let removed = 0;
    const removedDetails = [];

    for (const entry of entries) {
      if (entry.name === 'processing') continue; // handled separately below

      const full = path.join(UPLOADS_DIR, entry.name);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }

      if (!stat.isFile()) continue;
      scanned++;

      if (stat.mtimeMs >= cutoffMs) continue; // too young, might still be in progress

      // Try to extract the original filename from "{timestamp}-{originalFilename}"
      const m = entry.name.match(/^\d{10,}-(.+)$/);
      const original = m ? m[1] : entry.name;

      if (knownOriginals.has(original)) continue; // a DB row claims this file
      if (knownOriginals.has(entry.name)) continue;

      try {
        fs.unlinkSync(full);
        removed++;
        removedDetails.push({ file: entry.name, sizeBytes: stat.size, ageHours: Math.round((Date.now() - stat.mtimeMs) / 3600000) });
      } catch (e) {
        console.warn(`[cleanup] Failed to remove orphan ${full}: ${e.message}`);
      }
    }

    // Also scan processing dir for folders that don't match a known video id
    if (fs.existsSync(PROCESSING_DIR)) {
      const procEntries = fs.readdirSync(PROCESSING_DIR, { withFileTypes: true });
      for (const entry of procEntries) {
        if (!entry.isDirectory()) continue;
        if (knownIds.has(entry.name)) continue; // matches an active video

        const full = path.join(PROCESSING_DIR, entry.name);
        let stat;
        try { stat = fs.statSync(full); } catch { continue; }
        if (stat.mtimeMs >= cutoffMs) continue;

        try {
          fs.rmSync(full, { recursive: true, force: true });
          removed++;
          removedDetails.push({ folder: 'processing/' + entry.name, ageHours: Math.round((Date.now() - stat.mtimeMs) / 3600000) });
        } catch (e) {
          console.warn(`[cleanup] Failed to remove orphan processing dir ${full}: ${e.message}`);
        }
      }
    }

    return { scanned, removed, removedDetails };
  } catch (e) {
    console.error('[cleanup] Orphan scan failed:', e.message);
    return { scanned: 0, removed: 0, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main cleanup entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purge expired cleanup_runs rows so the history table stays small.
 * Retention rules:
 *   - Runs with deletions (videos_deleted > 0 OR orphans_deleted > 0): 90 days
 *   - No-op runs (Removed 0): 7 days
 */
async function _pruneHistory() {
  try {
    await db.query(`
      DELETE FROM cleanup_runs
      WHERE (
        (videos_deleted = 0 AND orphans_deleted = 0 AND created_at < NOW() - INTERVAL '7 days')
        OR created_at < NOW() - INTERVAL '90 days'
      )
    `);
  } catch (e) {
    console.warn('[cleanup] History prune failed:', e.message);
  }
}

/**
 * Run one cleanup pass.
 *
 * @param {object} opts
 * @param {number|null} opts.olderThanDays - Override the setting value. If null, reads from DB.
 * @param {number|null} opts.requestedBy - Admin id (for audit log + triggered_by).
 * @param {boolean} opts.scanOrphans - If true (default), also runs orphan scan.
 * @param {'auto'|'manual'} opts.triggerType - Origin of the run (default 'auto').
 */
async function runStorageCleanup(opts = {}) {
  const { olderThanDays = null, requestedBy = null, scanOrphans = true, triggerType = 'auto' } = opts;

  if (_isRunning) {
    return { deleted: 0, details: [], skipped: true, reason: 'already running' };
  }
  _isRunning = true;
  const startedAt = Date.now();

  try {
    // Resolve threshold
    let days = parseInt(olderThanDays, 10);
    if (!days || days <= 0) {
      const stored = await _getSetting('auto_cleanup_days', '7');
      days = parseInt(stored, 10) || 7;
    }
    if (days < 1) days = 1;
    if (days > 365) days = 365;

    // Find candidate videos (include file_size for bytes_reclaimed accounting)
    const candidates = await db.query(
      `SELECT id, title, status, storage_path, storage_type, original_filename,
              COALESCE(file_size, 0) AS file_size, created_at, updated_at
       FROM videos
       WHERE (
         status = 'error'
         OR (status = 'uploading'  AND created_at < NOW() - ($1 || ' days')::interval)
         OR (status = 'processing' AND updated_at < NOW() - ($1 || ' days')::interval)
       )
       ORDER BY created_at ASC
       LIMIT 200`,
      [String(days)]
    );

    const details = [];
    let deleted = 0;
    let assetsRemoved = 0;
    let bytesReclaimed = 0;

    for (const video of candidates.rows) {
      const fileSize = Number(video.file_size) || 0;

      const purge = await _purgeVideoAssets(video);
      const stageResults = purge.filter(p => p && p.ok);
      assetsRemoved += stageResults.reduce((s, r) => s + (typeof r.removed === 'number' ? r.removed : 0), 0);

      try {
        await db.query('DELETE FROM videos WHERE id = $1', [video.id]);
        deleted++;
        bytesReclaimed += fileSize;
        details.push({
          id: video.id,
          title: video.title,
          status: video.status,
          storage_type: video.storage_type,
          bytes: fileSize,
          stages: purge.map(p => ({ stage: p.stage, ok: p.ok, removed: p.removed, error: p.error })),
        });
      } catch (e) {
        console.error('[cleanup] Failed to DELETE row for video', video.id, '-', e.message);
        details.push({ id: video.id, title: video.title, error: e.message });
      }
    }

    // Orphan scan (Bug 4)
    let orphan = null;
    if (scanOrphans) {
      orphan = await _orphanScan();
      // Orphan bytes are best-effort — we kept sizes in removedDetails, sum what we can
      if (orphan?.removedDetails) {
        for (const d of orphan.removedDetails) {
          if (typeof d.sizeBytes === 'number') bytesReclaimed += d.sizeBytes;
        }
      }
    }

    const durationMs = Date.now() - startedAt;

    // Log this run to cleanup_runs (history)
    let runId = null;
    try {
      const res = await db.query(
        `INSERT INTO cleanup_runs
           (trigger_type, triggered_by, videos_deleted, orphans_deleted, bytes_reclaimed, duration_ms, threshold_days, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          triggerType,
          requestedBy,
          deleted,
          orphan?.removed || 0,
          bytesReclaimed,
          durationMs,
          days,
          JSON.stringify({ videos: details, orphans: orphan?.removedDetails || [] }),
        ]
      );
      runId = res.rows[0]?.id;
    } catch (e) {
      console.warn('[cleanup] Failed to log run to history:', e.message);
    }

    // Prune expired history rows
    await _pruneHistory();

    // Persist last-run info (quick-lookup for the UI's "Last run" line)
    await _setSetting('auto_cleanup_last_run', new Date().toISOString());
    await _setSetting('auto_cleanup_last_count', String(deleted));
    if (orphan) {
      await _setSetting('auto_cleanup_last_orphan_count', String(orphan.removed || 0));
    }

    // Audit log (best-effort)
    try {
      const { audit } = require('./audit');
      await audit(
        { admin: { id: requestedBy } },
        'storage.cleanup',
        'storage',
        runId,
        { deleted, assetsRemoved, days, orphansRemoved: orphan?.removed || 0, triggerType, bytesReclaimed }
      );
    } catch {}

    if (deleted > 0 || (orphan && orphan.removed > 0)) {
      console.log(`[cleanup] Removed ${deleted} videos + ${orphan?.removed || 0} orphans, ${bytesReclaimed} bytes reclaimed (threshold ${days} days, ${durationMs}ms)`);
    }

    return { runId, deleted, details, days, assetsRemoved, orphan, bytesReclaimed, durationMs, triggerType };
  } finally {
    _isRunning = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────────────────────

async function _scheduledTick() {
  try {
    const enabled = await _getSetting('auto_cleanup', 'false');
    if (enabled !== 'true') return;
    await runStorageCleanup({ requestedBy: null, triggerType: 'auto' });
  } catch (e) {
    console.error('[cleanup] Scheduler tick failed:', e.message);
  }
}

function startCleanupScheduler() {
  if (_schedulerStarted) return;
  _schedulerStarted = true;
  setTimeout(_scheduledTick, 90 * 1000);
  setInterval(_scheduledTick, CLEANUP_INTERVAL_MS).unref();
  console.log('[cleanup] Scheduler started (runs every hour, only when auto_cleanup is enabled)');
}

module.exports = { runStorageCleanup, startCleanupScheduler };
