const express = require('express');
const db = require('../db/index.js');
const auth = require('../middleware/auth');

const router = express.Router();

/**
 * Merge JSONB country/device maps: { "US": 10, "UK": 5 } + { "US": 3 } => { "US": 13, "UK": 5 }
 */
function mergeJsonbMaps(rows, field) {
  const merged = {};
  for (const row of rows) {
    const data = typeof row[field] === 'string' ? JSON.parse(row[field]) : (row[field] || {});
    for (const [key, val] of Object.entries(data)) {
      merged[key] = (merged[key] || 0) + (Number(val) || 0);
    }
  }
  return merged;
}

/**
 * Get real-time stats for today from raw events (small scan — only today's data).
 */
async function getTodayRealtime() {
  const viewsRes = await db.query(`
    SELECT COUNT(*) AS total_views
    FROM analytics_events WHERE event_type = 'view' AND timestamp >= CURRENT_DATE
  `);
  const uniqueRes = await db.query(`
    SELECT COUNT(DISTINCT COALESCE(referrer, '') || '|' || COALESCE(country, '') || '|' || COALESCE(device, '')) AS uv
    FROM analytics_events WHERE event_type = 'view' AND timestamp >= CURRENT_DATE
  `);
  const avgRes = await db.query(`
    SELECT COALESCE(AVG(watch_duration), 0) AS avg_dur, COALESCE(SUM(watch_duration), 0) AS total_dur
    FROM analytics_events WHERE watch_duration > 0 AND timestamp >= CURRENT_DATE
  `);
  const countryRes = await db.query(`
    SELECT country, COUNT(*) AS cnt FROM analytics_events
    WHERE event_type = 'view' AND timestamp >= CURRENT_DATE
      AND country IS NOT NULL AND country != 'unknown'
    GROUP BY country ORDER BY cnt DESC LIMIT 20
  `);
  const deviceRes = await db.query(`
    SELECT device, COUNT(*) AS cnt FROM analytics_events
    WHERE event_type = 'view' AND timestamp >= CURRENT_DATE AND device IS NOT NULL
    GROUP BY device
  `);
  const hourlyRes = await db.query(`
    SELECT EXTRACT(HOUR FROM timestamp)::int AS hour, COUNT(*) AS views
    FROM analytics_events
    WHERE event_type = 'view' AND timestamp >= CURRENT_DATE
    GROUP BY hour ORDER BY hour
  `);
  const topRes = await db.query(`
    SELECT ae.video_id, v.title, v.thumbnail_url, COUNT(*) AS views,
      COALESCE(AVG(CASE WHEN ae.watch_duration > 0 THEN ae.watch_duration END), 0) AS avg_watch
    FROM analytics_events ae
    JOIN videos v ON v.id = ae.video_id
    WHERE ae.event_type = 'view' AND ae.timestamp >= CURRENT_DATE
    GROUP BY ae.video_id, v.title, v.thumbnail_url
    ORDER BY views DESC LIMIT 10
  `);

  const countryData = {};
  for (const r of countryRes.rows) countryData[r.country] = parseInt(r.cnt);
  const deviceData = {};
  for (const r of deviceRes.rows) deviceData[r.device] = parseInt(r.cnt);

  return {
    totalViews: parseInt(viewsRes.rows[0].total_views),
    uniqueViewers: parseInt(uniqueRes.rows[0].uv),
    avgWatchDuration: parseFloat(avgRes.rows[0].avg_dur),
    totalWatchDuration: parseFloat(avgRes.rows[0].total_dur),
    countryData,
    deviceData,
    viewsOverTime: hourlyRes.rows.map(r => ({ date: `${r.hour}:00`, views: parseInt(r.views) })),
    topVideos: topRes.rows.map(r => ({
      id: r.video_id, title: r.title, thumbnail: r.thumbnail_url,
      views: parseInt(r.views), avgWatchTime: formatDuration(parseFloat(r.avg_watch)),
    })),
  };
}

// GET /realtime - Lightweight today stats for auto-refresh
router.get('/realtime', auth, async (req, res) => {
  try {
    const viewsRes = await db.query(`
      SELECT COUNT(*) AS total_views
      FROM analytics_events WHERE event_type = 'view' AND timestamp >= CURRENT_DATE
    `);
    const uniqueRes = await db.query(`
      SELECT COUNT(DISTINCT COALESCE(referrer, '') || '|' || COALESCE(country, '') || '|' || COALESCE(device, '')) AS uv
      FROM analytics_events WHERE event_type = 'view' AND timestamp >= CURRENT_DATE
    `);
    const avgRes = await db.query(`
      SELECT COALESCE(AVG(watch_duration), 0) AS avg_dur
      FROM analytics_events WHERE watch_duration > 0 AND timestamp >= CURRENT_DATE
    `);
    const hourlyRes = await db.query(`
      SELECT EXTRACT(HOUR FROM timestamp)::int AS hour, COUNT(*) AS views
      FROM analytics_events
      WHERE event_type = 'view' AND timestamp >= CURRENT_DATE
      GROUP BY hour ORDER BY hour
    `);

    // Build full 24-hour array
    const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: i, views: 0 }));
    for (const r of hourlyRes.rows) {
      hourly[parseInt(r.hour)].views = parseInt(r.views);
    }

    res.json({
      totalViews: parseInt(viewsRes.rows[0].total_views),
      uniqueViewers: parseInt(uniqueRes.rows[0].uv),
      avgWatchTime: formatDuration(parseFloat(avgRes.rows[0].avg_dur)),
      hourly,
    });
  } catch (err) {
    console.error('Realtime analytics error:', err);
    res.status(500).json({ error: 'Failed to retrieve realtime analytics' });
  }
});

// GET /overview - Dashboard stats (hybrid: rollup tables + today real-time)
router.get('/overview', auth, async (req, res) => {
  try {
    const range = req.query.range || '30d';

    // For "today" — query raw events directly (small dataset)
    if (range === 'today') {
      const today = await getTodayRealtime();
      const topCountry = Object.entries(today.countryData).sort((a, b) => b[1] - a[1])[0];
      const deviceTotal = Object.values(today.deviceData).reduce((s, v) => s + v, 0) || 1;
      const deviceMap = { desktop: 0, mobile: 0, tablet: 0 };
      for (const [k, v] of Object.entries(today.deviceData)) {
        const key = k.toLowerCase();
        if (key in deviceMap) deviceMap[key] = Math.round((v / deviceTotal) * 100);
      }

      return res.json({
        totalViews: today.totalViews,
        uniqueViewers: today.uniqueViewers,
        avgWatchTime: formatDuration(today.avgWatchDuration),
        topCountry: topCountry ? topCountry[0] : '',
        viewsOverTime: today.viewsOverTime,
        topVideos: today.topVideos,
        devices: deviceMap,
        countries: Object.entries(today.countryData)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([country, views]) => {
            const total = Object.values(today.countryData).reduce((s, v) => s + v, 0) || 1;
            return { country, code: country, views, percentage: Math.round((views / total) * 100) };
          }),
      });
    }

    // For other ranges — read from rollup tables + add today's real-time
    let days;
    switch (range) {
      case '7d': days = 7; break;
      case '30d': days = 30; break;
      default: days = null; // 'all'
    }

    // Query rollup table for past days (excludes today)
    const dateFilter = days
      ? `AND date >= CURRENT_DATE - INTERVAL '${days} days' AND date < CURRENT_DATE`
      : 'AND date < CURRENT_DATE';

    const rollupRes = await db.query(`
      SELECT date, total_views, unique_viewers, total_watch_duration, avg_watch_duration,
             country_data, device_data, top_videos
      FROM analytics_daily_global
      WHERE 1=1 ${dateFilter}
      ORDER BY date ASC
    `);

    // Get today's real-time data
    const today = await getTodayRealtime();

    // Aggregate rollup rows
    let totalViews = today.totalViews;
    let uniqueViewers = today.uniqueViewers;
    let totalWatchDuration = today.totalWatchDuration;
    let watchDurationCount = today.totalViews; // approximate

    const viewsOverTime = [];
    const allCountryData = [{ country_data: today.countryData }];
    const allDeviceData = [{ device_data: today.deviceData }];
    const allTopVideos = {};

    // Add today's top videos
    for (const v of today.topVideos) {
      allTopVideos[v.id] = { ...v, views: v.views };
    }

    for (const row of rollupRes.rows) {
      totalViews += row.total_views;
      uniqueViewers += row.unique_viewers;
      totalWatchDuration += row.total_watch_duration;
      watchDurationCount += row.total_views;

      const dateLabel = new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      viewsOverTime.push({ date: dateLabel, views: row.total_views });

      allCountryData.push(row);
      allDeviceData.push(row);

      // Merge top videos
      const dayTopVideos = typeof row.top_videos === 'string' ? JSON.parse(row.top_videos) : (row.top_videos || []);
      for (const v of dayTopVideos) {
        if (allTopVideos[v.id]) {
          allTopVideos[v.id].views += v.views;
        } else {
          allTopVideos[v.id] = { ...v, avgWatchTime: formatDuration(v.avgWatch || 0) };
        }
      }
    }

    // Add today to the chart
    const todayLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    viewsOverTime.push({ date: todayLabel, views: today.totalViews });

    // Merge country data
    const mergedCountries = mergeJsonbMaps(allCountryData, 'country_data');
    const countryTotal = Object.values(mergedCountries).reduce((s, v) => s + v, 0) || 1;
    const countries = Object.entries(mergedCountries)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, views]) => ({
        country, code: country, views,
        percentage: Math.round((views / countryTotal) * 100),
      }));

    const topCountry = countries.length > 0 ? countries[0].country : '';

    // Merge device data
    const mergedDevices = mergeJsonbMaps(allDeviceData, 'device_data');
    const deviceTotal = Object.values(mergedDevices).reduce((s, v) => s + v, 0) || 1;
    const deviceMap = { desktop: 0, mobile: 0, tablet: 0 };
    for (const [k, v] of Object.entries(mergedDevices)) {
      const key = k.toLowerCase();
      if (key in deviceMap) deviceMap[key] = Math.round((v / deviceTotal) * 100);
    }

    // Top 10 videos across all days
    const topVideos = Object.values(allTopVideos)
      .sort((a, b) => b.views - a.views)
      .slice(0, 10)
      .map(v => ({
        id: v.id, title: v.title, thumbnail: v.thumbnail,
        views: v.views, avgWatchTime: v.avgWatchTime || '0s',
      }));

    const avgWatchSeconds = watchDurationCount > 0
      ? totalWatchDuration / watchDurationCount
      : 0;
    const avgWatchTime = formatDuration(avgWatchSeconds);

    // Completion rate: % of views that watched >= 90% of the video.
    // Computed from raw events joined with video duration (over the selected range).
    const completionWindow = days
      ? `AND ae.timestamp >= CURRENT_DATE - INTERVAL '${days} days'`
      : '';
    const completionRes = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE v.duration > 0 AND LEAST(ae.watch_duration, v.duration) >= v.duration * 0.9) AS completed,
        COUNT(*) FILTER (WHERE v.duration > 0) AS eligible
      FROM analytics_events ae
      JOIN videos v ON v.id = ae.video_id
      WHERE ae.event_type = 'view' ${completionWindow}
    `);
    const completedCount = parseInt(completionRes.rows[0].completed);
    const eligibleCount = parseInt(completionRes.rows[0].eligible);
    const completionRate = eligibleCount > 0
      ? Math.round((completedCount / eligibleCount) * 1000) / 10
      : null;

    // Unique viewers across the entire range (dedupes same-viewer-on-multiple-days,
    // which naive sum-of-daily-rollups would double-count).
    if (days) {
      const uniqueRes = await db.query(`
        SELECT COUNT(DISTINCT COALESCE(referrer, '') || '|' || COALESCE(country, '') || '|' || COALESCE(device, '')) AS uv
        FROM analytics_events
        WHERE event_type = 'view'
          AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'
      `);
      uniqueViewers = parseInt(uniqueRes.rows[0].uv);
    }

    // Active embeds: distinct domains that hosted views in the range.
    const embedWindow = days
      ? `AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'`
      : '';
    const embedRes = await db.query(`
      SELECT COUNT(DISTINCT regexp_replace(referrer, '^https?://([^/]+).*', '\\1')) AS domains
      FROM analytics_events
      WHERE event_type = 'view'
        AND referrer ~* '^https?://[^/]+'
        ${embedWindow}
    `);
    const activeEmbeds = parseInt(embedRes.rows[0].domains);

    // Previous period comparison (for delta badges). Only computed when range is bounded.
    let previousViews = null;
    let viewsDeltaPct = null;
    let previousAvgWatchSeconds = null;
    let avgWatchDeltaPct = null;
    let previousCompletionRate = null;
    let completionDeltaPct = null;
    let previousUniqueViewers = null;
    let uniqueViewersDeltaPct = null;
    let previousActiveEmbeds = null;
    let activeEmbedsDeltaPct = null;
    if (days) {
      const prevRes = await db.query(`
        SELECT
          COALESCE(SUM(total_views), 0) AS views,
          COALESCE(SUM(total_watch_duration), 0) AS total_watch,
          COALESCE(SUM(total_views), 0) AS view_count_for_avg
        FROM analytics_daily_global
        WHERE date >= CURRENT_DATE - INTERVAL '${days * 2} days'
          AND date <  CURRENT_DATE - INTERVAL '${days} days'
      `);
      previousViews = parseInt(prevRes.rows[0].views);
      const prevWatch = parseFloat(prevRes.rows[0].total_watch);
      const prevViewCount = parseInt(prevRes.rows[0].view_count_for_avg);
      previousAvgWatchSeconds = prevViewCount > 0 ? prevWatch / prevViewCount : 0;

      if (previousViews > 0) {
        viewsDeltaPct = Math.round(((totalViews - previousViews) / previousViews) * 1000) / 10;
      } else if (totalViews > 0) {
        viewsDeltaPct = null;
      } else {
        viewsDeltaPct = 0;
      }

      if (previousAvgWatchSeconds > 0) {
        avgWatchDeltaPct = Math.round(((avgWatchSeconds - previousAvgWatchSeconds) / previousAvgWatchSeconds) * 1000) / 10;
      } else if (avgWatchSeconds > 0) {
        avgWatchDeltaPct = null;
      } else {
        avgWatchDeltaPct = 0;
      }

      const prevCompRes = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE v.duration > 0 AND LEAST(ae.watch_duration, v.duration) >= v.duration * 0.9) AS completed,
          COUNT(*) FILTER (WHERE v.duration > 0) AS eligible
        FROM analytics_events ae
        JOIN videos v ON v.id = ae.video_id
        WHERE ae.event_type = 'view'
          AND ae.timestamp >= CURRENT_DATE - INTERVAL '${days * 2} days'
          AND ae.timestamp <  CURRENT_DATE - INTERVAL '${days} days'
      `);
      const prevCompleted = parseInt(prevCompRes.rows[0].completed);
      const prevEligible = parseInt(prevCompRes.rows[0].eligible);
      previousCompletionRate = prevEligible > 0
        ? Math.round((prevCompleted / prevEligible) * 1000) / 10
        : null;

      if (previousCompletionRate !== null && previousCompletionRate > 0) {
        completionDeltaPct = Math.round(((completionRate - previousCompletionRate) / previousCompletionRate) * 1000) / 10;
      } else if (completionRate !== null && completionRate > 0) {
        completionDeltaPct = null;
      } else {
        completionDeltaPct = 0;
      }

      const prevUvRes = await db.query(`
        SELECT COUNT(DISTINCT COALESCE(referrer, '') || '|' || COALESCE(country, '') || '|' || COALESCE(device, '')) AS uv
        FROM analytics_events
        WHERE event_type = 'view'
          AND timestamp >= CURRENT_DATE - INTERVAL '${days * 2} days'
          AND timestamp <  CURRENT_DATE - INTERVAL '${days} days'
      `);
      previousUniqueViewers = parseInt(prevUvRes.rows[0].uv);
      if (previousUniqueViewers > 0) {
        uniqueViewersDeltaPct = Math.round(((uniqueViewers - previousUniqueViewers) / previousUniqueViewers) * 1000) / 10;
      } else if (uniqueViewers > 0) {
        uniqueViewersDeltaPct = null;
      } else {
        uniqueViewersDeltaPct = 0;
      }

      const prevEmbedRes = await db.query(`
        SELECT COUNT(DISTINCT regexp_replace(referrer, '^https?://([^/]+).*', '\\1')) AS domains
        FROM analytics_events
        WHERE event_type = 'view'
          AND referrer ~* '^https?://[^/]+'
          AND timestamp >= CURRENT_DATE - INTERVAL '${days * 2} days'
          AND timestamp <  CURRENT_DATE - INTERVAL '${days} days'
      `);
      previousActiveEmbeds = parseInt(prevEmbedRes.rows[0].domains);
      if (previousActiveEmbeds > 0) {
        activeEmbedsDeltaPct = Math.round(((activeEmbeds - previousActiveEmbeds) / previousActiveEmbeds) * 1000) / 10;
      } else if (activeEmbeds > 0) {
        activeEmbedsDeltaPct = null;
      } else {
        activeEmbedsDeltaPct = 0;
      }
    }

    res.json({
      totalViews,
      uniqueViewers,
      avgWatchTime,
      avgWatchSeconds: Math.round(avgWatchSeconds * 10) / 10,
      topCountry,
      viewsOverTime,
      topVideos,
      devices: deviceMap,
      countries,
      previousViews,
      viewsDeltaPct,
      previousAvgWatchSeconds: previousAvgWatchSeconds !== null ? Math.round(previousAvgWatchSeconds * 10) / 10 : null,
      avgWatchDeltaPct,
      completionRate,
      previousCompletionRate,
      completionDeltaPct,
      previousUniqueViewers,
      uniqueViewersDeltaPct,
      activeEmbeds,
      previousActiveEmbeds,
      activeEmbedsDeltaPct,
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ error: 'Failed to retrieve analytics overview' });
  }
});

// GET /videos/:id - Per-video analytics (reads from rollup table)
router.get('/videos/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const videoResult = await db.query('SELECT id, title, views_count FROM videos WHERE id = $1', [id]);
    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const video = videoResult.rows[0];

    // Last 30 days from rollup table
    const rollupRes = await db.query(`
      SELECT date, views, country_data, device_data, avg_watch_duration
      FROM analytics_daily
      WHERE video_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days' AND date < CURRENT_DATE
      ORDER BY date ASC
    `, [id]);

    // Today's data from raw events
    const todayViews = await db.query(`
      SELECT COUNT(*) AS views FROM analytics_events
      WHERE video_id = $1 AND event_type = 'view' AND timestamp >= CURRENT_DATE
    `, [id]);

    const todayCountry = await db.query(`
      SELECT country, COUNT(*) AS count FROM analytics_events
      WHERE video_id = $1 AND event_type = 'view' AND timestamp >= CURRENT_DATE
        AND country IS NOT NULL AND country != 'unknown'
      GROUP BY country ORDER BY count DESC LIMIT 10
    `, [id]);

    const todayDevice = await db.query(`
      SELECT device, COUNT(*) AS count FROM analytics_events
      WHERE video_id = $1 AND event_type = 'view' AND timestamp >= CURRENT_DATE AND device IS NOT NULL
      GROUP BY device ORDER BY count DESC
    `, [id]);

    const todayDuration = await db.query(`
      SELECT COALESCE(AVG(watch_duration), 0) AS avg_duration FROM analytics_events
      WHERE video_id = $1 AND watch_duration > 0 AND timestamp >= CURRENT_DATE
    `, [id]);

    // Build views by day
    const viewsByDay = rollupRes.rows.map(r => ({
      date: r.date,
      views: r.views,
    }));
    viewsByDay.push({
      date: new Date().toISOString().slice(0, 10),
      views: parseInt(todayViews.rows[0].views),
    });

    // Merge countries from rollup + today
    const mergedCountries = {};
    for (const row of rollupRes.rows) {
      const data = typeof row.country_data === 'string' ? JSON.parse(row.country_data) : (row.country_data || {});
      for (const [k, v] of Object.entries(data)) {
        mergedCountries[k] = (mergedCountries[k] || 0) + Number(v);
      }
    }
    for (const row of todayCountry.rows) {
      mergedCountries[row.country] = (mergedCountries[row.country] || 0) + parseInt(row.count);
    }
    const topCountries = Object.entries(mergedCountries)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, count]) => ({ country, count }));

    // Merge devices from rollup + today
    const mergedDevices = {};
    for (const row of rollupRes.rows) {
      const data = typeof row.device_data === 'string' ? JSON.parse(row.device_data) : (row.device_data || {});
      for (const [k, v] of Object.entries(data)) {
        mergedDevices[k] = (mergedDevices[k] || 0) + Number(v);
      }
    }
    for (const row of todayDevice.rows) {
      mergedDevices[row.device] = (mergedDevices[row.device] || 0) + parseInt(row.count);
    }
    const topDevices = Object.entries(mergedDevices)
      .sort((a, b) => b[1] - a[1])
      .map(([device, count]) => ({ device, count }));

    // Average watch duration (weighted from rollup + today)
    let totalDuration = parseFloat(todayDuration.rows[0].avg_duration) * parseInt(todayViews.rows[0].views);
    let totalCount = parseInt(todayViews.rows[0].views);
    for (const row of rollupRes.rows) {
      totalDuration += row.avg_watch_duration * row.views;
      totalCount += row.views;
    }

    res.json({
      video: {
        id: video.id,
        title: video.title,
        total_views: video.views_count,
      },
      views_by_day: viewsByDay,
      top_countries: topCountries,
      top_devices: topDevices,
      avg_watch_duration: totalCount > 0 ? totalDuration / totalCount : 0,
    });
  } catch (err) {
    console.error('Video analytics error:', err);
    res.status(500).json({ error: 'Failed to retrieve video analytics' });
  }
});

// GET /ads - Ad analytics (popup clicks + VAST impressions)
router.get('/ads', auth, async (req, res) => {
  try {
    const range = req.query.range || '30d';

    // Today's live ad stats from raw events
    const todayRes = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'popup_ad') AS popup_clicks,
        COUNT(*) FILTER (WHERE event_type = 'vast_ad_impression') AS vast_impressions
      FROM analytics_events
      WHERE timestamp >= CURRENT_DATE
    `);

    const todayPopup = parseInt(todayRes.rows[0].popup_clicks) || 0;
    const todayVast = parseInt(todayRes.rows[0].vast_impressions) || 0;

    if (range === 'today') {
      return res.json({
        popupClicks: todayPopup,
        vastImpressions: todayVast,
        dailyData: [{
          date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          popup: todayPopup,
          vast: todayVast,
        }],
      });
    }

    // For other ranges, read from rollup + add today
    let dateFilter;
    switch (range) {
      case '7d': dateFilter = "AND date >= CURRENT_DATE - INTERVAL '7 days' AND date < CURRENT_DATE"; break;
      case '30d': dateFilter = "AND date >= CURRENT_DATE - INTERVAL '30 days' AND date < CURRENT_DATE"; break;
      default: dateFilter = 'AND date < CURRENT_DATE'; // all
    }

    const rollupRes = await db.query(`
      SELECT date, popup_clicks, vast_impressions
      FROM analytics_ad_daily
      WHERE 1=1 ${dateFilter}
      ORDER BY date ASC
    `);

    let totalPopup = todayPopup;
    let totalVast = todayVast;
    const dailyData = [];

    for (const row of rollupRes.rows) {
      totalPopup += row.popup_clicks;
      totalVast += row.vast_impressions;
      const dateLabel = new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dailyData.push({ date: dateLabel, popup: row.popup_clicks, vast: row.vast_impressions });
    }

    // Add today
    const todayLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    dailyData.push({ date: todayLabel, popup: todayPopup, vast: todayVast });

    res.json({
      popupClicks: totalPopup,
      vastImpressions: totalVast,
      dailyData,
    });
  } catch (err) {
    console.error('Ad analytics error:', err);
    res.status(500).json({ error: 'Failed to retrieve ad analytics' });
  }
});

// GET /bandwidth - Bandwidth stats (uses rollup + today real-time)
router.get('/bandwidth', auth, async (req, res) => {
  try {
    // Today's bandwidth from raw events (small scan)
    const todayRes = await db.query(`
      SELECT COALESCE(SUM(v.file_size), 0) AS bytes
      FROM analytics_events ae
      JOIN videos v ON v.id = ae.video_id
      WHERE ae.event_type = 'view' AND ae.timestamp >= CURRENT_DATE
    `);

    // Week from rollup
    const weekRes = await db.query(`
      SELECT COALESCE(SUM(ad.views * v.file_size), 0) AS bytes
      FROM analytics_daily ad
      JOIN videos v ON v.id = ad.video_id
      WHERE ad.date >= DATE_TRUNC('week', CURRENT_DATE)
    `);

    // Month from rollup
    const monthRes = await db.query(`
      SELECT COALESCE(SUM(ad.views * v.file_size), 0) AS bytes
      FROM analytics_daily ad
      JOIN videos v ON v.id = ad.video_id
      WHERE ad.date >= DATE_TRUNC('month', CURRENT_DATE)
    `);

    // Previous month from rollup (for delta badge)
    const prevMonthRes = await db.query(`
      SELECT COALESCE(SUM(ad.views * v.file_size), 0) AS bytes
      FROM analytics_daily ad
      JOIN videos v ON v.id = ad.video_id
      WHERE ad.date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
        AND ad.date <  DATE_TRUNC('month', CURRENT_DATE)
    `);

    // All time from rollup
    const allRes = await db.query(`
      SELECT COALESCE(SUM(ad.views * v.file_size), 0) AS bytes
      FROM analytics_daily ad
      JOIN videos v ON v.id = ad.video_id
    `);

    const todayBytes = parseInt(todayRes.rows[0].bytes);
    const weekBytes = parseInt(weekRes.rows[0].bytes) + todayBytes;
    const monthBytes = parseInt(monthRes.rows[0].bytes) + todayBytes;
    const prevMonthBytes = parseInt(prevMonthRes.rows[0].bytes);
    const allBytes = parseInt(allRes.rows[0].bytes) + todayBytes;

    let monthDeltaPct = null;
    if (prevMonthBytes > 0) {
      monthDeltaPct = Math.round(((monthBytes - prevMonthBytes) / prevMonthBytes) * 1000) / 10;
    } else if (monthBytes === 0) {
      monthDeltaPct = 0;
    }

    res.json({
      bandwidth: {
        today: { bytes: todayBytes, formatted: formatBytes(todayBytes) },
        week: { bytes: weekBytes, formatted: formatBytes(weekBytes) },
        month: { bytes: monthBytes, formatted: formatBytes(monthBytes) },
        prev_month: { bytes: prevMonthBytes, formatted: formatBytes(prevMonthBytes) },
        all_time: { bytes: allBytes, formatted: formatBytes(allBytes) },
      },
      monthDeltaPct,
    });
  } catch (err) {
    console.error('Bandwidth analytics error:', err);
    res.status(500).json({ error: 'Failed to retrieve bandwidth analytics' });
  }
});

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * GET /videos/:id/retention — Audience retention curve for a single video.
 *
 * Returns an array of { sec, viewers, percent } points. Each point represents:
 *   sec     — timestamp in the video (bucket start, seconds)
 *   viewers — distinct viewers who reached at least this position
 *   percent — viewers / total_viewers * 100  (0-100, monotonically non-increasing)
 *
 * Source data: viewer_progress table (each row = latest saved position per viewer).
 * Because every viewer must pass through second T to reach any position > T,
 * counting `position >= T` gives the audience at time T — the standard YouTube/
 * Mux retention pattern.
 *
 * Query params:
 *   buckets — number of sample points (default 100, min 10, max 500)
 *
 * Why 100 buckets by default? A 100-point curve renders nicely at any video
 * length (short clip or 2-hour movie), makes the chart scale-independent, and
 * keeps the payload small (~3KB JSON).
 */
router.get('/videos/:id/retention', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const rawBuckets = parseInt(req.query.buckets, 10);
    const buckets = Math.max(10, Math.min(500, Number.isFinite(rawBuckets) ? rawBuckets : 100));

    // Fetch video duration (needed to build bucket boundaries)
    const vr = await db.query('SELECT id, title, duration FROM videos WHERE id = $1', [id]);
    if (vr.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    const video = vr.rows[0];
    const videoDuration = Math.max(0, parseFloat(video.duration) || 0);
    if (videoDuration <= 0) {
      return res.json({ video_id: id, title: video.title, duration: 0, buckets, total_viewers: 0, curve: [] });
    }

    // Total unique viewers who reached any progress point.
    const totalRes = await db.query(
      `SELECT COUNT(DISTINCT viewer_id)::int AS total
       FROM viewer_progress WHERE video_id = $1 AND duration > 0`,
      [id]
    );
    const totalViewers = totalRes.rows[0].total;

    if (totalViewers === 0) {
      const emptyCurve = Array.from({ length: buckets }, (_, i) => ({
        sec: Math.round((i / (buckets - 1)) * videoDuration * 10) / 10,
        viewers: 0,
        percent: 0,
      }));
      return res.json({
        video_id: id,
        title: video.title,
        duration: videoDuration,
        buckets,
        total_viewers: 0,
        curve: emptyCurve,
      });
    }

    // For each bucket, count viewers whose position >= bucket_sec.
    // Single query using generate_series + LATERAL join — avoids N round-trips.
    const bucketSize = videoDuration / (buckets - 1);
    const result = await db.query(
      `WITH b AS (
         SELECT generate_series(0, $2::int - 1) AS n
       ),
       positions AS (
         SELECT position FROM viewer_progress
         WHERE video_id = $1 AND duration > 0
       )
       SELECT
         ROUND((b.n * $3::numeric)::numeric, 1) AS sec,
         (SELECT COUNT(*) FROM positions p WHERE p.position >= b.n * $3)::int AS viewers
       FROM b
       ORDER BY b.n`,
      [id, buckets, bucketSize]
    );

    const curve = result.rows.map(row => ({
      sec: parseFloat(row.sec),
      viewers: row.viewers,
      percent: Math.round((row.viewers / totalViewers) * 1000) / 10, // 1 decimal place
    }));

    res.json({
      video_id: id,
      title: video.title,
      duration: videoDuration,
      buckets,
      total_viewers: totalViewers,
      curve,
    });
  } catch (err) {
    console.error('Retention curve error:', err);
    res.status(500).json({ error: 'Failed to compute retention' });
  }
});

module.exports = router;
