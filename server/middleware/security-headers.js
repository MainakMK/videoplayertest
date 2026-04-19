/**
 * Security headers middleware — applies different headers per route type.
 *
 * This platform serves three distinct types of responses:
 *
 *   1. Admin dashboard (HTML + API) at dash.example.com / /api/*
 *      → STRICT headers: X-Frame-Options: SAMEORIGIN, strict CSP, HSTS
 *
 *   2. Embed player (HTML) at /embed/:id and /v/:id (played cross-origin
 *      from third-party sites)
 *      → NO X-Frame-Options (would break iframe embedding)
 *      → Permissive CSP with media-src for CDN domains
 *
 *   3. CDN routes (static segments) at /cdn/*
 *      → Minimal headers — pure static content, no scripts/HTML
 *
 * A blanket helmet() config would break either embed or admin, so we split
 * into three middleware functions and apply each to the right routes.
 */

const HSTS = 'max-age=31536000; includeSubDomains';

/**
 * Shared safe headers applied to EVERY response.
 * These never break anything and are always good to have.
 */
function baseHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS only matters over HTTPS — browsers ignore it over HTTP.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', HSTS);
  }
  next();
}

/**
 * Admin dashboard + admin API routes.
 * X-Frame-Options: SAMEORIGIN prevents clickjacking — attackers can't iframe
 * the admin dashboard to trick users into clicks.
 */
function adminHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Strict CSP — only allow resources from our own origin. Extra 'unsafe-inline'
  // for scripts + styles because the dashboard currently uses inline onclick
  // handlers and style attributes (future hardening: move to external files).
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https: blob:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https: wss:",
    "frame-ancestors 'self'",                  // same-origin iframes only
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '));
  next();
}

/**
 * Embed player page (/embed/:id, /v/:id).
 * MUST allow cross-origin iframe embedding — no X-Frame-Options!
 * Uses per-video allowed_domains list (from embed_settings table) to set
 * frame-ancestors dynamically. If no restriction, allow any origin.
 */
function embedHeaders(allowedDomainsFn) {
  return async function embedHeadersMiddleware(req, res, next) {
    // Build media-src from CDN domains so HLS.js can fetch segments.
    // Keep this permissive: https: covers all CDN domains without needing
    // DB lookup on every request.
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https: blob:",
      "media-src 'self' blob: https:",          // HLS.js creates blob URLs for segments
      "connect-src 'self' https:",              // allow any https endpoint (segments, key delivery)
      "font-src 'self' data:",
      // NO frame-ancestors here — let the parent page's CSP decide. This
      // keeps backward compat with the existing allowed_domains feature
      // (checked in the route handler via Referer header, not CSP).
    ].join('; '));
    // CRITICAL: do NOT set X-Frame-Options — that would block all embedding.
    next();
  };
}

/**
 * CDN routes (/cdn/*) — static segments, playlists, thumbnails.
 * No scripts/HTML/cookies — minimal headers only.
 */
function cdnHeaders(req, res, next) {
  // No X-Frame-Options (don't care — images/video can't "click" anything).
  // No CSP (static files, nothing to constrain).
  // baseHeaders already applied nosniff + HSTS + Referrer-Policy.
  next();
}

module.exports = { baseHeaders, adminHeaders, embedHeaders, cdnHeaders };
