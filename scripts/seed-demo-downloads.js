/**
 * Seed demo torrent_downloads rows so the Downloads page renders populated
 * lists without requiring aria2 to actually be running.
 *
 * Demo rows have a synthetic gid prefixed with 'demo-' so the route can
 * recognize and skip aria2 lookups for them — aria2 has no record of these.
 *
 * Run:
 *   node scripts/seed-demo-downloads.js
 *
 * Remove with:
 *   node scripts/unseed-demo-downloads.js
 */

const db = require('../server/db');

const DEMO_PREFIX = 'demo-';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const rows = [
  // Active — magnet, mid-download, healthy swarm
  {
    gid: DEMO_PREFIX + 'mag1',
    magnet_uri: 'magnet:?xt=urn:btih:demo1&dn=Big.Buck.Bunny.2008.1080p.BluRay.x264',
    name: 'Big.Buck.Bunny.2008.1080p.BluRay.x264',
    status: 'active',
    source_type: 'magnet',
    total_size: 4.2 * GB,
    downloaded: 1.6 * GB,
    download_speed: 8.4 * MB,
    upload_speed: 420 * 1024,
    num_seeders: 142,
    num_peers: 38,
    progress: 38,
  },
  // Active — direct URL, near complete
  {
    gid: DEMO_PREFIX + 'url1',
    magnet_uri: 'https://example.com/releases/SampleVideo_1280x720_30mb.mp4',
    name: 'SampleVideo_1280x720_30mb.mp4',
    status: 'active',
    source_type: 'url',
    total_size: 1.9 * GB,
    downloaded: 1.7 * GB,
    download_speed: 22 * MB,
    upload_speed: 0,
    num_seeders: 0,
    num_peers: 0,
    progress: 89,
  },
  // Active — .torrent file upload, just started
  {
    gid: DEMO_PREFIX + 'file1',
    magnet_uri: 'demo://file/Sintel.2010.1080p.torrent',
    name: 'Sintel.2010.1080p',
    status: 'active',
    source_type: 'torrent_file',
    total_size: 6.8 * GB,
    downloaded: 312 * MB,
    download_speed: 4.1 * MB,
    upload_speed: 180 * 1024,
    num_seeders: 47,
    num_peers: 12,
    progress: 4,
  },
  // Paused — user paused mid-way
  {
    gid: DEMO_PREFIX + 'mag2',
    magnet_uri: 'magnet:?xt=urn:btih:demo4&dn=Tears.of.Steel.2160p.HDR',
    name: 'Tears.of.Steel.2160p.HDR',
    status: 'paused',
    source_type: 'magnet',
    total_size: 12 * GB,
    downloaded: 5.5 * GB,
    download_speed: 0,
    upload_speed: 0,
    num_seeders: 0,
    num_peers: 0,
    progress: 45,
  },
  // Error — failed download
  {
    gid: DEMO_PREFIX + 'mag3',
    magnet_uri: 'magnet:?xt=urn:btih:demo5&dn=Caminandes.Llamigos.2016',
    name: 'Caminandes.Llamigos.2016',
    status: 'error',
    source_type: 'magnet',
    total_size: 0,
    downloaded: 0,
    download_speed: 0,
    upload_speed: 0,
    num_seeders: 0,
    num_peers: 0,
    progress: 0,
    error_message: 'No peers found after 60s — torrent may be dead',
  },
  // Complete — ready to process to library
  {
    gid: DEMO_PREFIX + 'mag4',
    magnet_uri: 'magnet:?xt=urn:btih:demo6&dn=Cosmos.Laundromat.2015.4K',
    name: 'Cosmos.Laundromat.2015.4K',
    status: 'complete',
    source_type: 'magnet',
    total_size: 8.4 * GB,
    downloaded: 8.4 * GB,
    download_speed: 0,
    upload_speed: 0,
    num_seeders: 0,
    num_peers: 0,
    progress: 100,
    file_path: '/downloads/torrents/demo/cosmos.mkv',
    completed_at: new Date(),
  },
  // Seeding — finished, sharing back
  {
    gid: DEMO_PREFIX + 'mag5',
    magnet_uri: 'magnet:?xt=urn:btih:demo7&dn=Spring.2019.2K.WEB-DL',
    name: 'Spring.2019.2K.WEB-DL',
    status: 'seeding',
    source_type: 'magnet',
    total_size: 2.1 * GB,
    downloaded: 2.1 * GB,
    download_speed: 0,
    upload_speed: 380 * 1024,
    num_seeders: 0,
    num_peers: 8,
    progress: 100,
    file_path: '/downloads/torrents/demo/spring.mp4',
    completed_at: new Date(),
  },
];

async function main() {
  console.log('[seed-downloads] inserting', rows.length, 'demo torrent_downloads...');

  for (const r of rows) {
    await db.query(
      `INSERT INTO torrent_downloads
       (gid, magnet_uri, name, status, source_type, total_size, downloaded,
        download_speed, upload_speed, num_seeders, num_peers, progress,
        file_path, error_message, completed_at, storage_type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'local', NOW())
       ON CONFLICT (gid) DO UPDATE SET
         status=EXCLUDED.status, downloaded=EXCLUDED.downloaded, total_size=EXCLUDED.total_size,
         download_speed=EXCLUDED.download_speed, upload_speed=EXCLUDED.upload_speed,
         num_seeders=EXCLUDED.num_seeders, num_peers=EXCLUDED.num_peers, progress=EXCLUDED.progress,
         file_path=EXCLUDED.file_path, error_message=EXCLUDED.error_message,
         completed_at=EXCLUDED.completed_at, name=EXCLUDED.name`,
      [r.gid, r.magnet_uri, r.name, r.status, r.source_type,
       Math.round(r.total_size), Math.round(r.downloaded),
       Math.round(r.download_speed), Math.round(r.upload_speed),
       r.num_seeders, r.num_peers, r.progress,
       r.file_path || null, r.error_message || null, r.completed_at || null]
    );
  }

  console.log('[seed-downloads] done — refresh /downloads to see them.');
  process.exit(0);
}

main().catch(err => { console.error('[seed-downloads] fatal:', err); process.exit(1); });
