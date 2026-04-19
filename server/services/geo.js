/**
 * Geo-restriction helpers for per-video country access control.
 *
 * Shape of the geo_restriction JSONB column:
 *   null                                                — no restriction
 *   { mode: "allow", countries: ["US", "GB"] }          — only these allowed
 *   { mode: "block", countries: ["RU", "CN"] }          — these blocked
 *
 * Country codes are ISO 3166-1 alpha-2, uppercase, 2 chars each.
 */

const ISO_CODE_RE = /^[A-Z]{2}$/;

/**
 * Validate + normalize geo_restriction input. Returns the sanitized object,
 * `null` to mean "no restriction", or throws Error with a user-friendly message.
 *
 * Accepts: null, undefined, "", {}, {mode, countries}. Anything else throws.
 */
function sanitizeGeoRestriction(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('geo_restriction must be null or an object');
  }

  // Empty object = treat as cleared
  if (!raw.mode && !raw.countries) return null;

  const mode = String(raw.mode || '').toLowerCase();
  if (mode !== 'allow' && mode !== 'block') {
    throw new Error('geo_restriction.mode must be "allow" or "block"');
  }

  const rawCountries = Array.isArray(raw.countries) ? raw.countries : [];
  // Uppercase + dedupe + validate
  const seen = new Set();
  const countries = [];
  for (const c of rawCountries) {
    if (typeof c !== 'string') continue;
    const code = c.trim().toUpperCase();
    if (!ISO_CODE_RE.test(code)) {
      throw new Error(`Invalid country code: ${JSON.stringify(c)} (must be 2-letter ISO 3166-1 alpha-2)`);
    }
    if (!seen.has(code)) {
      seen.add(code);
      countries.push(code);
    }
  }

  if (countries.length === 0) return null; // empty list = no restriction
  if (countries.length > 250) {
    throw new Error('geo_restriction.countries cannot exceed 250 entries');
  }

  return { mode, countries };
}

/**
 * Check whether a viewer's country is allowed to watch a video.
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkGeoAccess(geoRestriction, viewerCountry) {
  if (!geoRestriction || typeof geoRestriction !== 'object') return { allowed: true };
  const { mode, countries } = geoRestriction;
  if (!Array.isArray(countries) || countries.length === 0) return { allowed: true };

  const vc = String(viewerCountry || '').toUpperCase();
  // Unknown / unresolved country: fail closed on allowlist (can't prove they're allowed),
  // fail open on blocklist (can't prove they're blocked).
  if (!ISO_CODE_RE.test(vc)) {
    if (mode === 'allow') {
      return { allowed: false, reason: 'country_unknown' };
    }
    return { allowed: true };
  }

  const listed = countries.includes(vc);
  if (mode === 'allow') {
    return listed ? { allowed: true } : { allowed: false, reason: 'country_not_allowed' };
  }
  // mode === 'block'
  return listed ? { allowed: false, reason: 'country_blocked' } : { allowed: true };
}

module.exports = { sanitizeGeoRestriction, checkGeoAccess };
