const Redis = require('ioredis');
const db = require('../db/index');
const storage = require('./storage');

const PROBE_TIMEOUT_MS = 1500;

let redisProbeClient = null;
function getRedisProbeClient() {
  if (redisProbeClient) return redisProbeClient;
  if (!process.env.REDIS_URL) return null;
  redisProbeClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: PROBE_TIMEOUT_MS,
  });
  redisProbeClient.on('error', () => { /* swallow — probes handle errors */ });
  return redisProbeClient;
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} probe timeout after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS)
    ),
  ]);
}

async function probeDatabase() {
  const start = Date.now();
  try {
    await withTimeout(db.query('SELECT 1'), 'database');
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, error: err.message };
  }
}

async function probeRedis() {
  const start = Date.now();
  const client = getRedisProbeClient();
  if (!client) {
    return { ok: true, latency_ms: 0, note: 'REDIS_URL not configured' };
  }
  try {
    if (client.status !== 'ready') {
      await withTimeout(client.connect().catch(() => {}), 'redis-connect');
    }
    const pong = await withTimeout(client.ping(), 'redis');
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`);
    return { ok: true, latency_ms: Date.now() - start };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, error: err.message };
  }
}

async function probeStorage() {
  const start = Date.now();
  try {
    const mode = await withTimeout(storage.getStorageMode(), 'storage-mode');
    if (mode === 'r2') {
      const settings = await withTimeout(storage.getSettings(), 'storage-settings');
      const config = {
        accountId: settings.r2_account_id,
        accessKeyId: settings.r2_access_key_id,
        secretAccessKey: settings.r2_secret_access_key,
        bucket: settings.r2_bucket_name,
      };
      if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucket) {
        return { ok: false, latency_ms: Date.now() - start, mode, error: 'R2 configured but credentials missing' };
      }
      const result = await withTimeout(storage.testR2Connection(config), 'storage-r2');
      if (!result.success) {
        return { ok: false, latency_ms: Date.now() - start, mode, error: result.message };
      }
    }
    return { ok: true, latency_ms: Date.now() - start, mode };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, error: err.message };
  }
}

async function checkHealth() {
  const [database, redis, storageProbe] = await Promise.all([
    probeDatabase(),
    probeRedis(),
    probeStorage(),
  ]);
  const ok = database.ok && redis.ok && storageProbe.ok;
  return {
    status: ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime_s: Math.floor(process.uptime()),
    checks: { database, redis, storage: storageProbe },
  };
}

module.exports = { checkHealth };
