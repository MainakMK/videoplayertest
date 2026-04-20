/**
 * Demo data seeder — populates the dashboard so all widgets light up.
 *
 * Inserts ~10 videos with [DEMO] title prefix, ~30 days of synthetic
 * analytics_events across varied countries / devices / referrers,
 * viewer_progress rows for retention curves, and rolled-up
 * analytics_daily_global + analytics_daily for fast dashboard reads.
 *
 * Everything inserted by this script is marked with a [DEMO] title
 * prefix so it can be cleanly removed later with
 * `node scripts/unseed-demo-data.js`.
 *
 * Usage:
 *   cd /d/Videoplayer
 *   node scripts/seed-demo-data.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const crypto = require('crypto');
const db = require('../server/db');

const DEMO_PREFIX = '[DEMO] ';

const DEMO_VIDEOS = [
  { title: 'Product Launch 2024',        duration:  272, views: 2841, status: 'ready',       tone: 'purple' },
  { title: 'Onboarding Tutorial',        duration:  727, views: 1504, status: 'ready',       tone: 'slate'  },
  { title: 'API Deep Dive',              duration:  535, views:  987, status: 'processing',  tone: 'indigo' },
  { title: 'Feature Walkthrough',        duration:  378, views:  642, status: 'ready',       tone: 'teal'   },
  { title: 'Q4 Recap Reel',              duration:  164, views:  428, status: 'ready',       tone: 'pink'   },
  { title: 'Customer Success Story',     duration:  412, views:  310, status: 'ready',       tone: 'blue'   },
  { title: 'Engineering Q&A',            duration:  923, views:  245, status: 'ready',       tone: 'orange' },
  { title: 'Marketing Keynote',          duration:  632, views:  178, status: 'ready',       tone: 'green'  },
  { title: 'Design System Tour',         duration:  298, views:  102, status: 'ready',       tone: 'violet' },
  { title: 'Q3 All-Hands Draft',         duration:  540, views:    0, status: 'ready',       tone: 'grey'   },
];

const COUNTRIES = ['US', 'GB', 'IN', 'DE', 'CA', 'FR', 'JP', 'AU', 'BR', 'NL'];
const COUNTRY_WEIGHTS = [34, 18, 14, 11, 6, 5, 4, 3, 3, 2]; // sums to 100
const DEVICES = ['desktop', 'mobile', 'tablet'];
const DEVICE_WEIGHTS = [58, 35, 7];
const REFERRERS = [
  'https://blog.example.com/post/1',
  'https://blog.example.com/post/2',
  'https://news.example.com/feature',
  'https://medium.com/demo',
  'https://twitter.com/acme',
  null, null, null,  // some direct
];

// Deterministic RNG so re-runs produce identical data (idempotent-ish)
let _seed = 42;
function rand() {
  _seed = (_seed * 9301 + 49297) % 233280;
  return _seed / 233280;
}
function pickWeighted(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
function pick(items) { return items[Math.floor(rand() * items.length)]; }

function genVideoId() {
  // Matches app's crypto.randomBytes(8).toString('base64url').slice(0, 12) format
  return 'D_' + crypto.randomBytes(5).toString('base64url').slice(0, 10);
}

async function ensureDemoVideos() {
  const rows = [];
  for (const v of DEMO_VIDEOS) {
    // idempotent: if a demo video with this title already exists, reuse it
    const existing = await db.query(
      'SELECT id FROM videos WHERE title = $1 LIMIT 1',
      [DEMO_PREFIX + v.title]
    );
    if (existing.rows.length > 0) {
      rows.push({ id: existing.rows[0].id, ...v });
      continue;
    }
    const id = genVideoId();
    const daysAgo = Math.floor(rand() * 28) + 1;
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO videos (id, title, description, file_size, duration, status, storage_type, visibility, views_count, hls_ready, qualities, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'local', 'public', $7, FALSE, '[]'::jsonb, $8, $8)`,
      [
        id,
        DEMO_PREFIX + v.title,
        'Seeded demo video for dashboard analytics.',
        Math.floor(v.duration * 350 * 1024), // rough file size estimate
        v.duration,
        v.status,
        v.views,
        createdAt.toISOString(),
      ]
    );
    rows.push({ id, ...v });
  }
  return rows;
}

async function seedAnalyticsEvents(videos, days = 30) {
  // Generate ~3-6 events per video per day, weighted by video popularity.
  // Spread across 30 days ending today.
  const totalViewsTarget = videos.reduce((a, v) => a + v.views, 0);
  let inserted = 0;
  const batchSize = 500;
  let batch = [];

  for (let d = days; d >= 0; d--) {
    const date = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    // Make a loose upward-trend: later days have more events (just like screenshot 1)
    const dailyFactor = 0.4 + (1 - d / days) * 0.9;
    const dailyTarget = Math.floor((totalViewsTarget / days) * dailyFactor);

    // Distribute dailyTarget proportionally to video popularity
    for (const v of videos) {
      const share = v.views / Math.max(1, totalViewsTarget);
      const count = Math.max(0, Math.floor(dailyTarget * share * (0.7 + rand() * 0.6)));
      for (let i = 0; i < count; i++) {
        const hour = Math.floor(rand() * 24);
        const minute = Math.floor(rand() * 60);
        const timestamp = new Date(date);
        timestamp.setHours(hour, minute, 0, 0);
        const country = pickWeighted(COUNTRIES, COUNTRY_WEIGHTS);
        const device = pickWeighted(DEVICES, DEVICE_WEIGHTS);
        const referrer = pick(REFERRERS);
        const watchDuration = Math.floor(rand() * v.duration * 0.9 + v.duration * 0.1);

        batch.push([v.id, 'view', country, device, referrer, watchDuration, timestamp.toISOString()]);
        if (batch.length >= batchSize) {
          await flushBatch(batch);
          inserted += batch.length;
          batch = [];
        }
      }
    }
  }
  if (batch.length) {
    await flushBatch(batch);
    inserted += batch.length;
  }
  return inserted;
}

async function flushBatch(batch) {
  // Multi-row INSERT is much faster than per-row
  const values = [];
  const params = [];
  batch.forEach((row, i) => {
    const base = i * 7;
    values.push(`($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`);
    params.push(...row);
  });
  await db.query(
    `INSERT INTO analytics_events (video_id, event_type, country, device, referrer, watch_duration, timestamp)
     VALUES ${values.join(',')}`,
    params
  );
}

async function seedViewerProgress(videos) {
  // 20-50 unique viewers per popular video, with position samples reaching
  // varying depths so the retention curve has something to plot
  let inserted = 0;
  for (const v of videos) {
    if (v.views === 0) continue;
    const viewers = Math.min(50, Math.max(8, Math.floor(v.views / 30)));
    for (let i = 0; i < viewers; i++) {
      const viewerId = `demo-viewer-${v.id}-${i}`;
      // Bias toward higher positions for popular videos; drop-off curve
      const dropoff = rand();
      const position = Math.floor(v.duration * (1 - dropoff * dropoff * 0.85));
      await db.query(
        `INSERT INTO viewer_progress (video_id, viewer_id, position, duration, completed, last_updated)
         VALUES ($1, $2, $3, $4, $5, NOW() - ($6 || ' minutes')::interval)
         ON CONFLICT (video_id, viewer_id) DO UPDATE
         SET position = $3, duration = $4, completed = $5, last_updated = NOW() - ($6 || ' minutes')::interval`,
        [v.id, viewerId, position, v.duration, position >= v.duration * 0.9, Math.floor(rand() * 30 * 24 * 60)]
      );
      inserted++;
    }
  }
  return inserted;
}

async function runRollups() {
  // Trigger the existing aggregator to build analytics_daily +
  // analytics_daily_global for the 31-day window we just seeded.
  const { backfillAll } = require('../server/services/analytics-aggregator');
  if (typeof backfillAll === 'function') {
    await backfillAll(31);
    return 'aggregator backfilled 31 days';
  }
  return 'aggregator backfillAll not found — daily tables will populate on next hourly cron';
}

async function main() {
  console.log('[seed] starting — creating demo videos + analytics...');
  const videos = await ensureDemoVideos();
  console.log(`[seed] ${videos.length} demo videos ready`);

  console.log('[seed] seeding analytics_events (30 days)...');
  const eventCount = await seedAnalyticsEvents(videos, 30);
  console.log(`[seed] inserted ${eventCount} analytics_events`);

  console.log('[seed] seeding viewer_progress for retention curves...');
  const progressCount = await seedViewerProgress(videos);
  console.log(`[seed] inserted ${progressCount} viewer_progress rows`);

  console.log('[seed] running rollups to populate daily tables...');
  try {
    const rollupStatus = await runRollups();
    console.log(`[seed] ${rollupStatus}`);
  } catch (err) {
    console.warn('[seed] rollup run failed (events are still usable):', err.message);
  }

  console.log('[seed] done. Refresh the dashboard to see the data.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
