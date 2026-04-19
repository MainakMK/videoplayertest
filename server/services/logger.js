/**
 * Centralized structured logger.
 *
 * - Dev (NODE_ENV !== 'production'): human-readable colored output to stdout
 * - Prod: JSON to stdout (for Docker/k8s log collection) + daily-rotated file
 *
 * Usage:
 *   const logger = require('../services/logger');
 *   logger.info('video upload started', { videoId, size });
 *   logger.error('ffmpeg failed', { videoId, error: err.message });
 *
 * The second arg is the "metadata" object — shows up as top-level JSON fields
 * in production, as a bracketed suffix in dev. Keep it small and searchable
 * (no giant payloads / file contents).
 */

const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const isProd = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// Strip passwords/tokens from logged metadata defensively. Safer than
// trusting every caller to remember.
const SENSITIVE_KEYS = new Set([
  'password', 'pass', 'token', 'authorization', 'cookie', 'jwt',
  'secret', 'apikey', 'api_key', 'key_hash', 'key_bytes', 'private_key',
  'r2_secret_access_key', 'smtp_pass', 'cf_api_token',
]);

function redact(obj, depth = 0) {
  if (depth > 4 || obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const out = {};
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redact(obj[k], depth + 1);
    }
  }
  return out;
}

const redactFormat = winston.format((info) => {
  // winston attaches the meta object under Symbol(splat); the spread props
  // (other than level/message/timestamp/stack) are redacted in-place.
  for (const k of Object.keys(info)) {
    if (k === 'level' || k === 'message' || k === 'timestamp' || k === 'stack' || k === 'label') continue;
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      info[k] = '[REDACTED]';
    } else if (info[k] && typeof info[k] === 'object') {
      info[k] = redact(info[k]);
    }
  }
  return info;
})();

const devFormat = winston.format.combine(
  redactFormat,
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  winston.format.colorize(),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...meta } = info;
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    const suffix = stack ? `\n${stack}` : '';
    return `${timestamp} ${level} ${message}${metaStr}${suffix}`;
  })
);

const prodFormat = winston.format.combine(
  redactFormat,
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const transports = [
  new winston.transports.Console({
    format: isProd ? prodFormat : devFormat,
    handleExceptions: true,
    handleRejections: true,
  }),
];

// Daily-rotated file transport in prod so logs survive restarts and
// we can ship them somewhere (grep / upload / ELK) later.
if (isProd) {
  const logDir = process.env.LOG_DIR || path.join(__dirname, '..', '..', 'logs');
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '50m',
      maxFiles: '30d',
      format: prodFormat,
    })
  );
}

const logger = winston.createLogger({
  level: logLevel,
  transports,
  // When a log comes in with an error object, preserve its stack instead of
  // collapsing to "[object Object]".
  exitOnError: false,
});

// Convenience: Express-style access log middleware. Drop-in alternative to
// morgan that routes through the structured logger so everything ends up in
// the same sink with the same format.
logger.httpAccessMiddleware = function httpAccess() {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - start;
      // Skip noisy health probes to keep the log useful.
      if (req.path === '/api/health' || req.path === '/api/health/ready') return;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger.log(level, 'http', {
        method: req.method,
        path: req.originalUrl || req.url,
        status: res.statusCode,
        duration_ms: durationMs,
        ip: req.headers['cf-connecting-ip']
          || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
          || req.ip,
      });
    });
    next();
  };
};

module.exports = logger;
