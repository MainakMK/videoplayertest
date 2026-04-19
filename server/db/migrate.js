require('dotenv').config();
const { pool } = require('./index');

const migration = `
-- Admins table
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Folders table
CREATE TABLE IF NOT EXISTS folders (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Videos table
CREATE TABLE IF NOT EXISTS videos (
  id VARCHAR(12) PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
  original_filename VARCHAR(500),
  file_size BIGINT DEFAULT 0,
  duration FLOAT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'ready', 'error')),
  storage_type VARCHAR(10) DEFAULT 'local' CHECK (storage_type IN ('local', 'r2')),
  storage_path TEXT,
  visibility VARCHAR(20) DEFAULT 'public' CHECK (visibility IN ('public', 'private', 'unlisted')),
  thumbnail_url TEXT,
  sprite_url TEXT,
  qualities JSONB DEFAULT '[]',
  hls_ready BOOLEAN DEFAULT FALSE,
  tags JSONB DEFAULT '[]',
  views_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Subtitles table
CREATE TABLE IF NOT EXISTS subtitles (
  id SERIAL PRIMARY KEY,
  video_id VARCHAR(12) REFERENCES videos(id) ON DELETE CASCADE,
  language VARCHAR(10) NOT NULL,
  label VARCHAR(100) NOT NULL,
  file_url TEXT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(video_id, language)
);

-- Ensure subtitles unique constraint exists (may be missing if table was created before constraint was added)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subtitles_video_id_language_key') THEN
    ALTER TABLE subtitles ADD CONSTRAINT subtitles_video_id_language_key UNIQUE (video_id, language);
  END IF;
END $$;

-- Cloudflare domains table
CREATE TABLE IF NOT EXISTS cloudflare_domains (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  service_type VARCHAR(20) NOT NULL,
  cf_api_token TEXT,
  cf_zone_id VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- SSL certificates table
CREATE TABLE IF NOT EXISTS ssl_certificates (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  method VARCHAR(10) DEFAULT 'http01' CHECK (method IN ('dns01', 'http01')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'error')),
  issued_at TIMESTAMP,
  expires_at TIMESTAMP,
  last_renewal_at TIMESTAMP
);

-- Domain settings table
CREATE TABLE IF NOT EXISTS domain_settings (
  id SERIAL PRIMARY KEY,
  service_type VARCHAR(20) NOT NULL CHECK (service_type IN ('embed', 'cdn', 'admin')),
  domain VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Analytics events table
CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  video_id VARCHAR(12) REFERENCES videos(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  country VARCHAR(5),
  device VARCHAR(20),
  referrer TEXT,
  watch_duration FLOAT DEFAULT 0,
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Embed settings table
CREATE TABLE IF NOT EXISTS embed_settings (
  id SERIAL PRIMARY KEY,
  video_id VARCHAR(12) REFERENCES videos(id) ON DELETE CASCADE,
  player_color VARCHAR(7) DEFAULT '#00aaff',
  logo_url TEXT,
  autoplay BOOLEAN DEFAULT FALSE,
  controls BOOLEAN DEFAULT TRUE,
  loop BOOLEAN DEFAULT FALSE,
  allowed_domains JSONB DEFAULT '[]',
  watermark_position VARCHAR(20) DEFAULT 'bottom-right'
);

-- Create global default embed settings (only if none exists)
INSERT INTO embed_settings (video_id, player_color, controls)
SELECT NULL, '#00aaff', TRUE
WHERE NOT EXISTS (SELECT 1 FROM embed_settings WHERE video_id IS NULL);

-- API keys table
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  permissions JSONB DEFAULT '["read"]',
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  last_used_at TIMESTAMP
);

-- Settings table (ALL platform config — managed from dashboard)
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  is_encrypted BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Default settings
INSERT INTO settings (key, value, is_encrypted) VALUES
  ('storage_mode', 'local', FALSE),
  ('storage_local_path', '/var/www/videos', FALSE),
  ('r2_account_id', '', TRUE),
  ('r2_access_key_id', '', TRUE),
  ('r2_secret_access_key', '', TRUE),
  ('r2_bucket_name', '', FALSE),
  ('r2_public_url', '', FALSE),
  ('cloudflare_api_token', '', TRUE),
  ('cloudflare_zone_id', '', FALSE),
  ('domain_dashboard', '', FALSE),
  ('domain_player', '', FALSE),
  ('domain_cdn', '', FALSE)
ON CONFLICT (key) DO NOTHING;

-- Pre-aggregated daily analytics (rolled up from analytics_events)
CREATE TABLE IF NOT EXISTS analytics_daily (
  id SERIAL PRIMARY KEY,
  video_id VARCHAR(12) REFERENCES videos(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  views INTEGER DEFAULT 0,
  unique_viewers INTEGER DEFAULT 0,
  total_watch_duration FLOAT DEFAULT 0,
  avg_watch_duration FLOAT DEFAULT 0,
  country_data JSONB DEFAULT '{}',
  device_data JSONB DEFAULT '{}',
  referrer_data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(video_id, date)
);

-- Global daily stats (no video_id, aggregated across all videos)
CREATE TABLE IF NOT EXISTS analytics_daily_global (
  id SERIAL PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  total_views INTEGER DEFAULT 0,
  unique_viewers INTEGER DEFAULT 0,
  total_watch_duration FLOAT DEFAULT 0,
  avg_watch_duration FLOAT DEFAULT 0,
  country_data JSONB DEFAULT '{}',
  device_data JSONB DEFAULT '{}',
  top_videos JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_videos_folder ON videos(folder_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_video ON analytics_events(video_id);
CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_video ON analytics_daily(video_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_global_date ON analytics_daily_global(date DESC);
CREATE INDEX IF NOT EXISTS idx_subtitles_video ON subtitles(video_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitles_video_lang ON subtitles(video_id, language);

-- Add Cloudflare API token column to ssl_certificates
ALTER TABLE ssl_certificates ADD COLUMN IF NOT EXISTS cf_api_token TEXT;

-- Ad configurations table (singleton for global ad settings)
CREATE TABLE IF NOT EXISTS ad_configurations (
  id SERIAL PRIMARY KEY,
  vast_enabled BOOLEAN DEFAULT FALSE,
  ad_type VARCHAR(50) DEFAULT 'vast',
  ad_title VARCHAR(255) DEFAULT '',
  popup_enabled BOOLEAN DEFAULT FALSE,
  popup_limit INTEGER DEFAULT 0,
  popup_url TEXT DEFAULT '',
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO ad_configurations (vast_enabled, popup_enabled)
SELECT FALSE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM ad_configurations);

-- Ad entries table (VAST ad list rows)
CREATE TABLE IF NOT EXISTS ad_entries (
  id SERIAL PRIMARY KEY,
  ad_config_id INTEGER REFERENCES ad_configurations(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  offset_type VARCHAR(20) NOT NULL DEFAULT 'preroll' CHECK (offset_type IN ('preroll', 'midroll', 'postroll')),
  time_offset VARCHAR(20) DEFAULT '0',
  skip_offset INTEGER DEFAULT 0,
  vast_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ad_entries_config ON ad_entries(ad_config_id, sort_order);

-- Ad analytics daily rollup table
CREATE TABLE IF NOT EXISTS analytics_ad_daily (
  id SERIAL PRIMARY KEY,
  date DATE UNIQUE NOT NULL,
  popup_clicks INTEGER DEFAULT 0,
  vast_impressions INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_ad_daily_date ON analytics_ad_daily(date DESC);

-- SSL: Add Zone ID, email, and auth type columns for Global API Key support
ALTER TABLE ssl_certificates ADD COLUMN IF NOT EXISTS cf_zone_id VARCHAR(100);
ALTER TABLE ssl_certificates ADD COLUMN IF NOT EXISTS cf_email TEXT;
ALTER TABLE ssl_certificates ADD COLUMN IF NOT EXISTS cf_auth_type VARCHAR(20) DEFAULT 'token';

-- CDN Domains: Add email and auth type columns for Global API Key support
ALTER TABLE cloudflare_domains ADD COLUMN IF NOT EXISTS cf_email TEXT;
ALTER TABLE cloudflare_domains ADD COLUMN IF NOT EXISTS cf_auth_type VARCHAR(20) DEFAULT 'token';

-- Multi-CDN: add sort_order to cloudflare_domains for domain ordering
ALTER TABLE cloudflare_domains ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_domains_domain ON cloudflare_domains(domain);
CREATE INDEX IF NOT EXISTS idx_cf_domains_active_cdn ON cloudflare_domains(service_type, is_active) WHERE service_type = 'cdn';

-- ─────────────────────────────────────────
-- VIEWER PROGRESS (resume watching)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS viewer_progress (
  id           SERIAL PRIMARY KEY,
  video_id     VARCHAR(12) REFERENCES videos(id) ON DELETE CASCADE,
  viewer_id    VARCHAR(64) NOT NULL,
  position     FLOAT  NOT NULL DEFAULT 0,
  duration     FLOAT  DEFAULT 0,
  completed    BOOLEAN DEFAULT FALSE,
  last_updated TIMESTAMP DEFAULT NOW(),
  UNIQUE(video_id, viewer_id)
);
CREATE INDEX IF NOT EXISTS idx_viewer_progress_video ON viewer_progress(video_id);
CREATE INDEX IF NOT EXISTS idx_viewer_progress_viewer ON viewer_progress(viewer_id);

-- ─────────────────────────────────────────
-- SPRITE URL (seekbar preview)
-- ─────────────────────────────────────────
ALTER TABLE videos ADD COLUMN IF NOT EXISTS sprite_url TEXT;

-- ─────────────────────────────────────────
-- AUDIT LOG
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(100),
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at DESC);

-- ─────────────────────────────────────────
-- 2FA (TOTP)
-- ─────────────────────────────────────────
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB DEFAULT '[]';

-- ─────────────────────────────────────────
-- PLAYER BRANDING (logo, title, opacity, size, link)
-- ─────────────────────────────────────────
ALTER TABLE embed_settings ADD COLUMN IF NOT EXISTS player_title TEXT DEFAULT '';
ALTER TABLE embed_settings ADD COLUMN IF NOT EXISTS logo_opacity FLOAT DEFAULT 0.75;
ALTER TABLE embed_settings ADD COLUMN IF NOT EXISTS logo_size VARCHAR(10) DEFAULT 'medium';
ALTER TABLE embed_settings ADD COLUMN IF NOT EXISTS logo_link TEXT DEFAULT '';

-- ─────────────────────────────────────────
-- TORRENT DOWNLOADS (aria2)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS torrent_downloads (
  id SERIAL PRIMARY KEY,
  gid VARCHAR(16) UNIQUE,
  magnet_uri TEXT NOT NULL,
  name VARCHAR(500),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','paused','complete','error','processing','seeding')),
  total_size BIGINT DEFAULT 0,
  downloaded BIGINT DEFAULT 0,
  download_speed BIGINT DEFAULT 0,
  upload_speed BIGINT DEFAULT 0,
  num_seeders INTEGER DEFAULT 0,
  num_peers INTEGER DEFAULT 0,
  progress FLOAT DEFAULT 0,
  file_path TEXT,
  video_id VARCHAR(12) REFERENCES videos(id) ON DELETE SET NULL,
  storage_type VARCHAR(10) DEFAULT 'local',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_torrent_status ON torrent_downloads(status);
CREATE INDEX IF NOT EXISTS idx_torrent_created ON torrent_downloads(created_at DESC);
ALTER TABLE torrent_downloads ADD COLUMN IF NOT EXISTS source_type VARCHAR(10) DEFAULT 'magnet' CHECK (source_type IN ('magnet','url'));

-- ─────────────────────────────────────────
-- TEAM MEMBERS (roles)
-- ─────────────────────────────────────────
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'owner';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS invited_by INTEGER;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Per-video quality selection: array of preset names (e.g., ["720p","1080p"])
-- NULL/empty = use the encoding settings' default_qualities list
ALTER TABLE videos ADD COLUMN IF NOT EXISTS encoded_qualities JSONB DEFAULT NULL;

-- Per-video AES-128 HLS encryption flag.
-- When TRUE, the worker writes encryption.key + #EXT-X-KEY into the manifest
-- and stores the key bytes in the video_encryption_keys table.
-- Existing videos default to FALSE so behavior is unchanged unless explicitly enabled.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS encryption_enabled BOOLEAN DEFAULT FALSE;

-- Per-video chapters (JSONB array of {time, title}).
-- Admin-editable via dashboard. Format:
--   [{"time":"0:00","title":"Intro"},{"time":"2:30","title":"Demo"}]
-- The player renders markers on the seekbar + a chapter menu from this array.
-- Max 50 chapters per video (enforced at API level). Stored as JSONB so we
-- can read/write the whole array atomically in one UPDATE.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS chapters JSONB DEFAULT '[]';

-- Per-video HLS segment extension (e.g., '.jpeg', '.webp', '.html').
-- Admin picks the current extension in Settings → Encoding. All NEW uploads
-- use that extension; existing videos keep whatever extension they were
-- originally encoded with (immutable once set — the playlist references
-- exact filenames, so renaming would break playback).
-- NULL for pre-feature videos → worker falls back to '.jpeg' (old behavior).
ALTER TABLE videos ADD COLUMN IF NOT EXISTS segment_extension VARCHAR(8) DEFAULT NULL;

-- ─────────────────────────────────────────
-- CUSTOM THUMBNAILS + SCRUB PREVIEW
-- ─────────────────────────────────────────
-- Each video gets 3 auto-generated candidate frames at 15/50/85% of duration.
-- The creator can upload a custom image or pick a candidate; custom uploads
-- set custom_thumbnail_set=true so re-encode won't overwrite them.
-- sprite_vtt_url points at the WebVTT index the player uses for progress-bar
-- hover previews (format: sprite.jpg#xywh=x,y,w,h per cue).
ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_candidates JSONB DEFAULT '[]';
ALTER TABLE videos ADD COLUMN IF NOT EXISTS custom_thumbnail_set BOOLEAN DEFAULT FALSE;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS sprite_vtt_url TEXT;

-- Per-API-key rate limit override (requests/minute). NULL = fall back to global rate_limit_api.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_minute INTEGER DEFAULT NULL;

-- Scheduled publishing. When set to a future timestamp, the video is treated as
-- private (player rejects viewers) until the time is reached. NULL = publish immediately
-- on upload (existing behavior).
ALTER TABLE videos ADD COLUMN IF NOT EXISTS published_at TIMESTAMP DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at) WHERE published_at IS NOT NULL;

-- Geo-restriction. NULL = no restriction. Otherwise shape:
--   { "mode": "allow" | "block", "countries": ["US", "GB", ...] }
-- ISO 3166-1 alpha-2 country codes. Uppercase, 2 chars each.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS geo_restriction JSONB DEFAULT NULL;

-- ─────────────────────────────────────────
-- AES-128 HLS ENCRYPTION KEYS
-- ─────────────────────────────────────────
-- Stores the per-video AES-128 key + IV used to encrypt HLS segments.
-- key_bytes is encrypted-at-rest using ENCRYPTION_KEY from .env (defense-in-depth:
-- a leaked DB backup alone won't expose the keys).
--
-- Keys are NEVER written to the storage folder or R2 — they only live here
-- and are delivered via the authenticated GET /api/video-keys/:id endpoint.
CREATE TABLE IF NOT EXISTS video_encryption_keys (
  video_id    VARCHAR(12) PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  key_bytes   TEXT NOT NULL,            -- encrypted (AES-256-GCM via services/encryption.js)
  iv_hex      VARCHAR(32) NOT NULL,     -- 16-byte IV as hex (used by FFmpeg + player)
  algorithm   VARCHAR(32) DEFAULT 'AES-128',
  created_at  TIMESTAMP DEFAULT NOW()
);
-- The PK already provides the index needed for the playback lookup.

-- ─────────────────────────────────────────
-- CLEANUP RUN HISTORY (auto + manual)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cleanup_runs (
  id SERIAL PRIMARY KEY,
  trigger_type VARCHAR(16) NOT NULL CHECK (trigger_type IN ('auto','manual')),
  triggered_by INTEGER,
  videos_deleted INTEGER DEFAULT 0,
  orphans_deleted INTEGER DEFAULT 0,
  bytes_reclaimed BIGINT DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  threshold_days INTEGER,
  details JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cleanup_runs_created ON cleanup_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cleanup_runs_nonzero ON cleanup_runs(created_at DESC)
  WHERE (videos_deleted > 0 OR orphans_deleted > 0);

-- ─────────────────────────────────────────
-- ACTIVE SESSIONS (for session management UI)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_id VARCHAR(36) NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address VARCHAR(64),
  device_info VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(token_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);
`;

async function migrate() {
  try {
    await pool.query(migration);
    console.log('Database migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();

// This file is appended — new migrations below are safe (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
