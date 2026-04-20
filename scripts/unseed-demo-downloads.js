/**
 * Remove demo torrent_downloads rows seeded by seed-demo-downloads.js.
 * Identifies them by the 'demo-' gid prefix.
 *
 *   node scripts/unseed-demo-downloads.js
 */

const db = require('../server/db');

async function main() {
  const r = await db.query("DELETE FROM torrent_downloads WHERE gid LIKE 'demo-%'");
  console.log(`[unseed-downloads] removed ${r.rowCount} demo rows`);
  process.exit(0);
}

main().catch(err => { console.error('[unseed-downloads] fatal:', err); process.exit(1); });
