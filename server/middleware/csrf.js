/**
 * CSRF (Cross-Site Request Forgery) protection for admin API routes.
 *
 * Threat: an attacker-controlled website tricks a logged-in admin's browser
 * into making state-changing requests using the admin's cookie.
 *
 * Mitigation: require the Origin header on state-changing methods
 * (POST/PUT/PATCH/DELETE) to match one of our allowed admin origins.
 * Browsers ALWAYS send Origin on cross-origin POSTs (attacker can't forge it
 * from JavaScript — it's set by the browser itself, not by JS).
 *
 * Why not CSRF tokens? Origin-based protection works with the existing
 * httpOnly cookie setup, doesn't require template changes, and is the
 * pattern most modern SPA frameworks recommend.
 *
 * Routes NOT protected:
 *   - GET/HEAD/OPTIONS (by definition safe — no state change)
 *   - Public player/CDN routes (no cookies → no CSRF risk)
 *   - API-key authenticated routes (Bearer tokens are per-request, not cookies)
 */

const { getAdminOrigins } = require('./cors-policies');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

async function csrfGuard(req, res, next) {
  // Safe methods don't need CSRF protection (read-only).
  if (SAFE_METHODS.has(req.method)) return next();

  // API key auth bypasses cookie → no CSRF risk.
  // If the route used api-key-auth before this middleware, req.apiKey is set.
  if (req.apiKey) return next();

  // Server-to-server or same-origin request → no Origin header.
  // Allow these (curl, direct navigation) — they can't originate from
  // an attacker's browser.
  const origin = req.headers.origin;
  if (!origin) return next();

  try {
    const allowed = await getAdminOrigins();
    if (allowed.includes(origin)) return next();

    // Cross-origin request from a non-allowed origin → CSRF attempt.
    console.warn(`[csrf] Blocked ${req.method} ${req.path} from origin: ${origin}`);
    return res.status(403).json({
      error: 'CSRF protection: request origin not allowed',
    });
  } catch (err) {
    // If origin check fails (DB issue), fail closed — reject.
    console.error('[csrf] Origin lookup failed:', err.message);
    return res.status(503).json({ error: 'CSRF check failed' });
  }
}

module.exports = { csrfGuard };
