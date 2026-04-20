/**
 * aria2 JSON-RPC 2.0 Client
 * Communicates with aria2c daemon over HTTP for torrent/magnet downloads.
 *
 * Start aria2 with:
 *   aria2c --enable-rpc --rpc-listen-port=6800 --rpc-allow-origin-all \
 *          --dir=./downloads/torrents --seed-time=0 --max-concurrent-downloads=3
 */

const RPC_URL = process.env.ARIA2_RPC_URL || 'http://localhost:6800/jsonrpc';
const RPC_SECRET = process.env.ARIA2_RPC_SECRET || '';

let _requestId = 0;

async function rpcCall(method, params = []) {
  const id = String(++_requestId);
  const tokenParams = RPC_SECRET ? [`token:${RPC_SECRET}`, ...params] : params;

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: `aria2.${method}`,
    params: tokenParams,
  });

  try {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json();
    if (data.error) {
      const err = new Error(data.error.message || 'aria2 RPC error');
      err.code = data.error.code;
      throw err;
    }
    return data.result;
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      throw new Error('aria2 daemon is not running. Start it with: aria2c --enable-rpc --rpc-listen-port=6800');
    }
    throw err;
  }
}

// ── Public API ──────────────────────────────────────────

/**
 * Add a magnet URI or HTTP URL for download
 * @param {string[]} uris - Array of URIs (magnet links or HTTP URLs)
 * @param {object} options - aria2 download options (dir, out, etc.)
 * @returns {string} GID (download identifier)
 */
async function addUri(uris, options = {}) {
  return rpcCall('addUri', [uris, options]);
}

/**
 * Add a .torrent file (raw bytes) for download
 * @param {Buffer} torrentBuffer - .torrent file contents
 * @param {object} options - aria2 download options
 * @returns {string} GID
 */
async function addTorrent(torrentBuffer, options = {}) {
  const b64 = Buffer.from(torrentBuffer).toString('base64');
  return rpcCall('addTorrent', [b64, [], options]);
}

/**
 * Get download status
 * @param {string} gid - Download GID
 * @returns {object} Status object with totalLength, completedLength, downloadSpeed, etc.
 */
async function tellStatus(gid) {
  return rpcCall('tellStatus', [gid]);
}

/**
 * Pause a download
 */
async function pause(gid) {
  return rpcCall('pause', [gid]);
}

/**
 * Force pause (doesn't wait for pieces to complete)
 */
async function forcePause(gid) {
  return rpcCall('forcePause', [gid]);
}

/**
 * Resume a paused download
 */
async function unpause(gid) {
  return rpcCall('unpause', [gid]);
}

/**
 * Remove a download (must be paused or complete)
 */
async function remove(gid) {
  try {
    return await rpcCall('remove', [gid]);
  } catch (e) {
    // If already removed or not found, force remove
    return rpcCall('forceRemove', [gid]).catch(() => null);
  }
}

/**
 * Force remove a download (even if active)
 */
async function forceRemove(gid) {
  return rpcCall('forceRemove', [gid]);
}

/**
 * Remove download result (completed/error/removed entries from memory)
 */
async function removeDownloadResult(gid) {
  return rpcCall('removeDownloadResult', [gid]).catch(() => null);
}

/**
 * Get all active downloads
 */
async function tellActive() {
  return rpcCall('tellActive', []);
}

/**
 * Get waiting downloads
 */
async function tellWaiting(offset = 0, num = 100) {
  return rpcCall('tellWaiting', [offset, num]);
}

/**
 * Get stopped (complete/error) downloads
 */
async function tellStopped(offset = 0, num = 100) {
  return rpcCall('tellStopped', [offset, num]);
}

/**
 * Get global download/upload speed stats
 */
async function getGlobalStat() {
  return rpcCall('getGlobalStat', []);
}

/**
 * Get aria2 version (useful for health check)
 */
async function getVersion() {
  return rpcCall('getVersion', []);
}

/**
 * Check if aria2 daemon is reachable
 */
async function isConnected() {
  try {
    await getVersion();
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse magnet URI to extract display name
 */
function parseMagnetName(magnetUri) {
  try {
    const match = magnetUri.match(/[?&]dn=([^&]+)/);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, ' '));
  } catch {}
  return null;
}

/**
 * Normalize aria2 status to our status values
 */
function normalizeStatus(aria2Status) {
  switch (aria2Status) {
    case 'active': return 'active';
    case 'waiting': return 'active';
    case 'paused': return 'paused';
    case 'complete': return 'complete';
    case 'error': return 'error';
    case 'removed': return 'error';
    default: return 'active';
  }
}

/**
 * Extract the largest video file path from aria2 file list
 */
function findLargestVideoFile(files) {
  const videoExts = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.mpg', '.mpeg'];
  let largest = null;
  let maxSize = 0;

  for (const f of files || []) {
    const path = f.path || '';
    const size = parseInt(f.length || '0', 10);
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    if (videoExts.includes(ext) && size > maxSize) {
      maxSize = size;
      largest = { path, size };
    }
  }
  return largest;
}

module.exports = {
  addUri,
  addTorrent,
  tellStatus,
  pause,
  forcePause,
  unpause,
  remove,
  forceRemove,
  removeDownloadResult,
  tellActive,
  tellWaiting,
  tellStopped,
  getGlobalStat,
  getVersion,
  isConnected,
  parseMagnetName,
  normalizeStatus,
  findLargestVideoFile,
};
