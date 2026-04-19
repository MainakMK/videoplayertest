/**
 * Analytics Aggregator
 *
 * Rolls up raw analytics_events into pre-aggregated daily tables.
 * Runs on a schedule (default: every hour) via setInterval.
 *
 * Two rollup tables:
 *   analytics_daily        — per-video per-day stats
 *   analytics_daily_global — global per-day stats (for dashboard overview)
 *
 * Strategy:
 *   - Always re-aggregate "today" and "yesterday" (to catch late events)
 *   - On first run or manual trigger, backfill all historical days
 *   - Raw events older than 90 days are pruned to save space
 */

const db = require('../db/index');

const AGGREGATE_INTERVAL = 60 * 60_000; // 1 hour
const RAW_RETENTION_DAYS = 90;

/**
 * Aggregate a single date's raw events into the rollup tables.
 */
async function aggregateDateSimple(date) {
  const dateStr = date.toISOString().slice(0, 10);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // --- Per-video daily rollup ---

    // Delete existing rollup for this date (upsert via delete+insert is cleaner for JSONB)
    await client.query('DELETE FROM analytics_daily WHERE date = $1::date', [dateStr]);

    // Get per-video view counts and watch stats
    const videoStats = await client.query(`
      SELECT
        video_id,
        COUNT(*) FILTER (WHERE event_type = 'view') AS views,
        COUNT(DISTINCT COALESCE(referrer, '') || '|' || COALESCE(country, '') || '|' || COALESCE(device, ''))
          FILTER (WHERE event_type = 'view') AS unique_viewers,
        COALESCE(SUM(watch_duration) FILTER (WHERE watch_duration > 0), 0) AS total_watch_duration,
        COALESCE(AVG(watch_duration) FILTER (WHERE watch_duration > 0), 0) AS avg_watch_duration
      FROM analytics_events
      WHERE DATE(timestamp) = $1::date AND video_id IS NOT NULL
      GROUP BY video_id
    `, [dateStr]);

    for (const row of videoStats.rows) {
      // Country breakdown for this video+date
      const countryRes = await client.query(`
        SELECT country, COUNT(*) AS cnt
        FROM analytics_events
        WHERE video_id = $1 AND event_type = 'view' AND DATE(timestamp) = $2::date
          AND country IS NOT NULL AND country != 'unknown'
        GROUP BY country ORDER BY cnt DESC LIMIT 20
      `, [row.video_id, dateStr]);

      const countryData = {};
      for (const c of countryRes.rows) countryData[c.country] = parseInt(c.cnt);

      // Device breakdown for this video+date
      const deviceRes = await client.query(`
        SELECT device, COUNT(*) AS cnt
        FROM analytics_events
        WHERE video_id = $1 AND event_type = 'view' AND DATE(timestamp) = $2::date
          AND device IS NOT NULL
        GROUP BY device
      `, [row.video_id, dateStr]);

      const deviceData = {};
      for (const d of deviceRes.rows) deviceData[d.device] = parseInt(d.cnt);

      await client.query(`
        INSERT INTO analytics_daily (video_id, date, views, unique_viewers, total_watch_duration, avg_watch_duration, country_data, device_data)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
      `, [
        row.video_id, dateStr,
        parseInt(row.views), parseInt(row.unique_viewers),
        parseFloat(row.total_watch_duration), parseFloat(row.avg_watch_duration),
        JSON.stringify(countryData), JSON.stringify(deviceData),
      ]);
    }

    // --- Global daily rollup ---

    await client.query('DELETE FROM analytics_daily_global WHERE date = $1::date', [dateStr]);

    const globalStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'view') AS total_views,
        COUNT(DISTINCT COALESCE(referrer, '') || '|' || COALESCE(country, '') || '|' || COALESCE(device, ''))
          FILTER (WHERE event_type = 'view') AS unique_viewers,
        COALESCE(SUM(watch_duration) FILTER (WHERE watch_duration > 0), 0) AS total_watch_duration,
        COALESCE(AVG(watch_duration) FILTER (WHERE watch_duration > 0), 0) AS avg_watch_duration
      FROM analytics_events
      WHERE DATE(timestamp) = $1::date
    `, [dateStr]);

    const g = globalStats.rows[0];

    // Global country breakdown
    const globalCountry = await client.query(`
      SELECT country, COUNT(*) AS cnt
      FROM analytics_events
      WHERE event_type = 'view' AND DATE(timestamp) = $1::date
        AND country IS NOT NULL AND country != 'unknown'
      GROUP BY country ORDER BY cnt DESC LIMIT 20
    `, [dateStr]);

    const globalCountryData = {};
    for (const c of globalCountry.rows) globalCountryData[c.country] = parseInt(c.cnt);

    // Global device breakdown
    const globalDevice = await client.query(`
      SELECT device, COUNT(*) AS cnt
      FROM analytics_events
      WHERE event_type = 'view' AND DATE(timestamp) = $1::date AND device IS NOT NULL
      GROUP BY device
    `, [dateStr]);

    const globalDeviceData = {};
    for (const d of globalDevice.rows) globalDeviceData[d.device] = parseInt(d.cnt);

    // Top videos for the day
    const topVideos = await client.query(`
      SELECT ae.video_id, v.title, v.thumbnail_url, COUNT(*) AS views,
        COALESCE(AVG(CASE WHEN ae.watch_duration > 0 THEN ae.watch_duration END), 0) AS avg_watch
      FROM analytics_events ae
      JOIN videos v ON v.id = ae.video_id
      WHERE ae.event_type = 'view' AND DATE(ae.timestamp) = $1::date
      GROUP BY ae.video_id, v.title, v.thumbnail_url
      ORDER BY views DESC LIMIT 20
    `, [dateStr]);

    const topVideosJson = topVideos.rows.map(r => ({
      id: r.video_id,
      title: r.title,
      thumbnail: r.thumbnail_url,
      views: parseInt(r.views),
      avgWatch: parseFloat(r.avg_watch),
    }));

    await client.query(`
      INSERT INTO analytics_daily_global (date, total_views, unique_viewers, total_watch_duration, avg_watch_duration, country_data, device_data, top_videos)
      VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
    `, [
      dateStr,
      parseInt(g.total_views), parseInt(g.unique_viewers),
      parseFloat(g.total_watch_duration), parseFloat(g.avg_watch_duration),
      JSON.stringify(globalCountryData), JSON.stringify(globalDeviceData),
      JSON.stringify(topVideosJson),
    ]);

    // --- Ad analytics daily rollup ---
    const adStats = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'popup_ad') AS popup_clicks,
        COUNT(*) FILTER (WHERE event_type = 'vast_ad_impression') AS vast_impressions
      FROM analytics_events
      WHERE DATE(timestamp) = $1::date
    `, [dateStr]);

    const ad = adStats.rows[0];
    await client.query(`
      INSERT INTO analytics_ad_daily (date, popup_clicks, vast_impressions)
      VALUES ($1::date, $2, $3)
      ON CONFLICT (date) DO UPDATE SET
        popup_clicks = EXCLUDED.popup_clicks,
        vast_impressions = EXCLUDED.vast_impressions
    `, [dateStr, parseInt(ad.popup_clicks) || 0, parseInt(ad.vast_impressions) || 0]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run aggregation for recent days (today + yesterday).
 */
async function aggregateRecent() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  await aggregateDateSimple(yesterday);
  await aggregateDateSimple(today);
}

/**
 * Backfill all historical days that haven't been aggregated yet.
 */
async function backfillAll() {
  // Find the earliest event date
  const earliest = await db.query(
    'SELECT MIN(DATE(timestamp)) AS min_date FROM analytics_events'
  );

  if (!earliest.rows[0].min_date) return; // no events at all

  const startDate = new Date(earliest.rows[0].min_date);
  const today = new Date();

  // Find which dates already exist in the global rollup
  const existing = await db.query('SELECT date FROM analytics_daily_global ORDER BY date');
  const existingSet = new Set(existing.rows.map(r => r.date.toISOString().slice(0, 10)));

  let date = new Date(startDate);
  let count = 0;
  while (date <= today) {
    const dateStr = date.toISOString().slice(0, 10);
    if (!existingSet.has(dateStr)) {
      await aggregateDateSimple(date);
      count++;
    }
    date.setDate(date.getDate() + 1);
  }

  if (count > 0) {
    console.log(`[analytics] Backfilled ${count} days`);
  }
}

/**
 * Prune raw analytics_events older than retention period.
 */
async function pruneOldEvents() {
  const result = await db.query(
    'DELETE FROM analytics_events WHERE timestamp < CURRENT_DATE - $1::interval',
    [`${RAW_RETENTION_DAYS} days`]
  );

  if (result.rowCount > 0) {
    console.log(`[analytics] Pruned ${result.rowCount} old raw events`);
  }
}

/**
 * Start the aggregation scheduler.
 */
function startAggregator() {
  console.log('[analytics] Aggregator started (interval: 1h)');

  // Initial run: backfill + aggregate recent
  setTimeout(async () => {
    try {
      await backfillAll();
      await aggregateRecent();
      await pruneOldEvents();
      console.log('[analytics] Initial aggregation complete');
    } catch (err) {
      console.error('[analytics] Initial aggregation error:', err.message);
    }
  }, 5000); // 5s delay to let DB initialize

  // Hourly runs
  setInterval(async () => {
    try {
      await aggregateRecent();
      await pruneOldEvents();
    } catch (err) {
      console.error('[analytics] Aggregation error:', err.message);
    }
  }, AGGREGATE_INTERVAL);
}

module.exports = {
  startAggregator,
  aggregateRecent,
  backfillAll,
  aggregateDateSimple,
  pruneOldEvents,
};
