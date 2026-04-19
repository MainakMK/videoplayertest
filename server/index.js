require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Security middleware (applied in order)
// ─────────────────────────────────────────────────────────────────────────────
//  1. baseHeaders: safe headers on every response (nosniff, Referrer-Policy, HSTS)
//  2. Per-route security headers (admin vs embed vs cdn) — different policies
//  3. Per-route CORS (adminCors with credentials vs publicCors without)
//  4. csrfGuard on admin routes (Origin validation on state-changing requests)
// ─────────────────────────────────────────────────────────────────────────────
const { baseHeaders, adminHeaders, embedHeaders, cdnHeaders } = require('./middleware/security-headers');
const { adminCors, publicCors } = require('./middleware/cors-policies');
const { csrfGuard } = require('./middleware/csrf');

app.use(baseHeaders);
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Rate limiting
const { apiLimiter, authLimiter, playerLimiter, cdnLimiter, aesKeyLimiter } = require('./middleware/rate-limit');

// IP blocking
const { ipBlockMiddleware } = require('./middleware/ip-block');
app.use(ipBlockMiddleware);

// Health checks (no auth, no rate limit, no CSRF — used for k8s/load balancer probes)
//
// /api/health       — liveness (fast, always 200 if process is alive)
// /api/health/ready — readiness (deep: probes DB, Redis, storage; 503 if degraded)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const { checkHealth } = require('./services/health');
app.get('/api/health/ready', async (req, res) => {
  try {
    const result = await checkHealth();
    res.status(result.status === 'ok' ? 200 : 503).json(result);
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      error: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN API routes — strict CORS (cookie auth) + CSRF origin check
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/auth',      adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/auth'));
app.use('/api/2fa',       adminCors, adminHeaders, csrfGuard, require('./routes/2fa'));
app.use('/api/audit',     adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/audit'));
app.use('/api/videos',    adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/videos'));
app.use('/api/folders',   adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/folders'));
app.use('/api/settings',  adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/settings'));
app.use('/api/analytics', adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/analytics'));
app.use('/api/migration', adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/migration'));
app.use('/api/ssl',       adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/ssl'));
app.use('/api/api-keys',  adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/api-keys'));
app.use('/api/webhooks',  adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/webhooks'));
app.use('/api/torrents',  adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/torrents'));
app.use('/api/team',      adminCors, adminHeaders, apiLimiter, csrfGuard, require('./routes/team'));

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC PLAYER API — permissive CORS (no cookies, tokens only), no CSRF
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/player',     publicCors, playerLimiter, require('./routes/player'));
app.use('/api/video-keys', publicCors, aesKeyLimiter, require('./routes/video-keys'));

// CDN delivery routes (HLS segments, thumbnails, subtitles)
app.use('/cdn', publicCors, cdnHeaders, cdnLimiter, require('./routes/cdn'));

// Start analytics aggregator (hourly rollups)
const { startAggregator } = require('./services/analytics-aggregator');
startAggregator();

// Serve static player files — player JS/CSS accessible everywhere (embed-friendly)
app.use('/player', embedHeaders(), express.static(path.join(__dirname, '..', 'player')));

// Serve player HTML for /v/:id and /embed/:id routes
// IMPORTANT: no X-Frame-Options here — embed MUST work in iframes on any site.
// Per-video domain whitelisting is enforced separately in routes/player.js via
// the embed_settings.allowed_domains column (referer-based check).
const playerHtmlPath = path.join(__dirname, '..', 'player', 'index.html');
app.get('/v/:id', embedHeaders(), (req, res) => {
  res.sendFile(playerHtmlPath);
});
app.get('/embed/:id', embedHeaders(), (req, res) => {
  res.sendFile(playerHtmlPath);
});


// Error handler middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  // Seed encoding defaults on first boot (idempotent — won't overwrite existing rows)
  try {
    const { seedDefaults } = require('./services/encoding-config');
    seedDefaults().catch(err => console.warn('[encoding-config] seedDefaults error:', err.message));
  } catch (e) {
    console.error('[encoding-config] Failed to seed:', e.message);
  }
  // Start the auto-cleanup scheduler (no-op while auto_cleanup is disabled in settings)
  try {
    const { startCleanupScheduler } = require('./services/cleanup');
    startCleanupScheduler();
  } catch (e) {
    console.error('[cleanup] Failed to start scheduler:', e.message);
  }
});
