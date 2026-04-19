/**
 * Removes everything inserted by scripts/seed-demo-data.js.
 * Finds videos with title prefix "[DEMO] " and cascades deletes
 * the attached analytics_events + viewer_progress + analytics_daily.
 * Re-runs the aggregator so analytics_daily_global stays consistent.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const db = require('../server/db');

async function main() {
  console.log('[unseed] finding demo videos...');
  const r = await db.query("SELECT id FROM videos WHERE title LIKE '[DEMO] %'");
  const ids = r.rows.map((x) => x.id);
  if (ids.length === 0) {
    console.log('[unseed] no demo videos found — nothing to do');
    process.exit(0);
  }
  console.log(`[unseed] removing ${ids.length} demo videos (cascades to events, progress, daily rollups)...`);
  await db.query('DELETE FROM videos WHERE id = ANY($1::varchar[])', [ids]);

  console.log('[unseed] re-running aggregator to rebuild global rollups without demo rows...');
  try {
    const { backfillAll } = require('../server/services/analytics-aggregator');
    await backfillAll(31);
  } catch (err) {
    console.warn('[unseed] aggregator rerun failed (will catch up on next hourly cron):', err.message);
  }
  console.log('[unseed] done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[unseed] fatal:', err);
  process.exit(1);
});
