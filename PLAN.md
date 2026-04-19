# Video Player Platform — Complete Plan & Feature Map

## Full Platform Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VIDEO PLAYER PLATFORM                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │   DASHBOARD     │  │   EMBED PLAYER  │  │     CDN      │  │ STORAGE  │ │
│  │  dashboard.com  │  │   player.com    │  │cdnforvideo.com│ │Local / R2│ │
│  │  (Admin Panel)  │  │  (Video Player) │  │  (Delivery)  │  │(HLS files│ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘  └────┬─────┘ │
│           │                    │                   │               │        │
│           └────────────────────┴───────────────────┴───────────────┘        │
│                                    │                                        │
│                             ┌──────┴──────┐                                 │
│                             │    NGINX    │                                  │
│                             │  (Reverse   │                                  │
│                             │   Proxy)    │                                  │
│                             └──────┬──────┘                                  │
│                                    │                                         │
│                             ┌──────┴──────┐                                  │
│                             │  BACKEND    │                                  │
│                             │   API       │                                  │
│                             └──────┬──────┘                                  │
│                                    │                                         │
│                    ┌───────────────┼───────────────┐                         │
│                    │               │               │                         │
│              ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐                   │
│              │ PostgreSQL│  │   Redis    │  │Cloudflare │                    │
│              │    (DB)   │  │  (Cache)   │  │  R2 (S3)  │                    │
│              └───────────┘  └───────────┘  └───────────┘                    │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  INFRASTRUCTURE: Let's Encrypt SSL | Certbot | Cloudflare API       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Complete Feature List

### 1. ADMIN DASHBOARD (dashboard.com)

```
dashboard.com
├── Auth
│   ├── Admin login (email + password)
│   ├── Session management (JWT)
│   └── Password reset
│
├── Video Management
│   ├── Upload videos
│   │   ├── Drag & drop upload
│   │   ├── Upload progress bar
│   │   ├── Choose storage destination per upload (Local Server or Cloudflare R2)
│   │   ├── R2 option disabled if not configured (shows "Not configured")
│   │   └── Auto-generate thumbnail
│   ├── Video list (table view)
│   │   ├── Search & filter
│   │   ├── Sort by date, views, size
│   │   └── Pagination
│   ├── Edit video
│   │   ├── Title, description
│   │   ├── Custom thumbnail
│   │   ├── Tags / categories
│   │   ├── Visibility (public / private / unlisted)
│   │   └── Subtitles / captions  ✅
│   │       ├── Multi-row table UI (add unlimited rows at once)
│   │       ├── Each row: drag handle, title input (EN/JA/KO etc), file picker, remove
│   │       ├── Bulk upload — single "Update" button saves all at once
│   │       ├── Drag & drop reorder subtitle rows
│   │       ├── Supported formats: .vtt, .srt, .ass, .sub
│   │       ├── "New Subtitle +" to add rows, "Reset" to revert
│   │       └── Delete / replace subtitles on save
│   ├── Delete video
│   └── Bulk actions (delete, change visibility)
│
├── Folder / Organization
│   ├── Create folders
│   ├── Move videos to folders
│   └── Folder-based access
│
├── Embed Settings
│   ├── Generate embed code per video
│   │   ├── iframe embed code
│   │   └── JS embed code
│   ├── Player customization
│   │   ├── Player color / theme
│   │   ├── Logo / watermark
│   │   ├── Autoplay ON/OFF
│   │   ├── Controls ON/OFF
│   │   ├── Loop ON/OFF
│   │   └── Responsive sizing
│   └── Domain restrictions (allowed domains for embed)
│
├── Domain Settings
│   ├── Change embed domain
│   ├── Change CDN domain (legacy fallback)
│   ├── Multi-CDN Load Balancing (up to 5 CDN domains)
│   │   ├── Add/remove CDN domains (max 5)
│   │   ├── Each domain has its own CF API token + Zone ID
│   │   ├── Enable/disable individual domains (active toggle)
│   │   ├── Random domain selection per play request
│   │   ├── Fallback to legacy single domain_cdn if no CDN domains configured
│   │   └── 60-second in-memory cache for domain list (performance)
│   ├── Cloudflare account management
│   │   ├── Add/edit CF API tokens per domain
│   │   ├── Zone ID per domain
│   │   └── Connection status check
│   ├── SSL management
│   │   ├── Auto SSL on domain change
│   │   ├── SSL status (installed / pending / error)
│   │   ├── Certificate expiry date
│   │   └── Force renewal button
│   └── DNS verification flow
│       ├── With CF token → automatic
│       └── Without CF token → show A record → verify button
│
├── Analytics
│   ├── Total views (today, week, month, all time)
│   ├── Views per video
│   ├── Views by country / region
│   ├── Views by device (desktop / mobile / tablet)
│   ├── Bandwidth usage
│   ├── Storage usage (R2)
│   ├── Top videos
│   ├── Graphs / charts
│   └── Ad Analytics
│       ├── Popup Ad Clicks (today / 7d / 30d / all time)
│       ├── VAST Ad Impressions (today / 7d / 30d / all time)
│       ├── Daily ad events chart (stacked bars: popup + VAST)
│       └── Rollup table for scale (analytics_ad_daily)
│
├── Settings (ALL config managed from here — no SSH needed)
│   ├── Account settings (email, password)
│   ├── Storage settings
│   │   ├── Storage usage summary (side-by-side: Local + R2 video count & size)
│   │   ├── Local: storage path (read-only)
│   │   ├── R2: Account ID, Access Key, Secret Key, Bucket Name, Public URL (always shown)
│   │   ├── Test Connection button (verify R2 credentials work)
│   │   ├── No global mode toggle — storage chosen per upload in Upload Modal
│   │   └── Migrate Videos (Videos page — select & migrate via bulk actions)
│   ├── Player settings (NEW — Settings → Player tab)
│   │   ├── Accent color picker (native color input + hex input + preset swatches)
│   │   ├── Live preview (mini player controls tinted with selected color)
│   │   ├── Autoplay toggle (default OFF)
│   │   ├── Show Controls toggle (default ON)
│   │   └── Loop toggle (default OFF)
│   ├── Cloudflare settings
│   │   ├── Cloudflare API Token
│   │   ├── Zone ID
│   │   └── Test Connection button
│   ├── Domain settings
│   │   ├── Dashboard domain
│   │   ├── Player domain
│   │   ├── CDN domain (legacy fallback)
│   │   └── CDN Domains (multi-CDN, up to 5 domains with CF credentials)
│   ├── API keys (for external integrations)
│   ├── Webhook settings
│   └── General preferences
│
├── Ads & Monetization (Settings → Ads tab)
│   ├── VAST / VPAID sub-tab
│   │   ├── Enable Ads toggle
│   │   ├── Ad Type selector (VAST 1, VAST 2, VAST 3, VPAID)
│   │   ├── Ad Title
│   │   └── Ad List (dynamic table)
│   │       ├── Offset type (preroll / midroll / postroll)
│   │       ├── Time offset (for midroll, HH:MM:SS.mmm format)
│   │       ├── Skip offset (seconds before skip allowed)
│   │       ├── VAST XML URL
│   │       ├── Add / Remove rows
│   │       └── Only .XML format supported
│   └── Pop-Up Advertisement sub-tab
│       ├── Enable Pop-Up toggle
│       ├── Pop-Up Limit (0 = always, 1+ = daily limit)
│       └── Popup URL
│
└── Security
    ├── Hotlink protection
    ├── Signed URLs (token-based access)
    ├── IP blocking
    └── Rate limiting settings
```

### 2. EMBED PLAYER (player.com)

```
player.com
├── Video Player
│   ├── HLS streaming only (adaptive bitrate, .jpeg obfuscated segments)
│   ├── Quality selector (auto, 1080p, 720p, 480p, 360p)
│   ├── Playback speed (0.5x, 1x, 1.5x, 2x)
│   ├── Volume control
│   ├── Fullscreen
│   ├── Picture-in-Picture (PiP)
│   ├── Keyboard shortcuts (space, arrows, f, m)
│   ├── Mobile touch controls
│   ├── Subtitles / captions (if uploaded)
│   └── Thumbnail preview on seek bar
│
├── Player Appearance
│   ├── Custom colors (from dashboard settings)
│   ├── Logo / watermark overlay
│   ├── Custom poster / thumbnail
│   └── Responsive (fits any container)
│
├── Embed Methods
│   ├── iframe: <iframe src="player.com/v/VIDEO_ID">
│   ├── JS: <script src="player.com/embed.js" data-id="VIDEO_ID">
│   └── Direct link: player.com/v/VIDEO_ID
│
├── Advertisements
│   ├── VAST ad playback engine
│   │   ├── Preroll ads (before video starts)
│   │   ├── Midroll ads (at configured timestamps)
│   │   ├── Postroll ads (after video ends)
│   │   ├── VAST XML fetching & parsing (MediaFile, Impression, ClickThrough)
│   │   ├── Ad video overlay with "Ad" badge
│   │   ├── Skip button with countdown timer
│   │   ├── Click-through to advertiser URL
│   │   ├── Impression beacon tracking
│   │   └── Analytics event: 'vast_ad_impression' sent to backend
│   └── Pop-Up advertisements
│       ├── Triggered on first user-initiated play
│       ├── Daily limit enforcement via localStorage
│       ├── Popup blocker compatible (runs inside user gesture handler)
│       └── Analytics event: 'popup_ad' sent to backend
│
├── Security
│   ├── Domain restriction (only plays on allowed domains)
│   ├── Signed URL verification
│   ├── Referrer check
│   └── Token expiry
│
└── Analytics Tracking
    ├── Track play, pause, seek events
    ├── Watch duration / completion rate
    ├── Send analytics data to backend
    └── Country / device detection
```

### 3. CDN SERVICE (multi-CDN: cdn1.example.com, cdn2.example.com, etc.)

```
Multi-CDN Load Balancing (1–5 Cloudflare CDN domains)
├── Each CDN domain can be on a separate Cloudflare account
├── Player API randomly picks one active domain per play request
├── Distributes bandwidth across domains (avoids per-domain limits)
├── If one domain has issues, others continue serving
│
├── Video Delivery (per CDN domain)
│   ├── Serve video files from R2
│   ├── HLS manifest (.m3u8) delivery
│   ├── HLS segments (.jpeg disguised MPEG-TS) delivery
│   ├── MIME type override: .jpeg in video paths → video/mp2t
│   └── Range request support (seeking)
│
├── Static Assets
│   ├── Player JS bundle
│   ├── Player CSS
│   ├── Thumbnails
│   └── Subtitle files
│
├── Caching
│   ├── Cloudflare cache rules
│   ├── Cache headers (long TTL for videos)
│   ├── Cache purge API (when video updated/deleted)
│   └── Browser cache control
│
├── Performance
│   ├── Gzip / Brotli compression (for JS, CSS, manifests)
│   ├── HTTP/2 push
│   └── Edge caching via Cloudflare
│
└── Security
    ├── Hotlink protection
    ├── Signed URLs for video files
    ├── CORS headers (allow embed domain)
    └── Bandwidth throttling (abuse prevention)
```

### 4. STORAGE (Two Backends: Local Server + Cloudflare R2)

Storage destination is chosen **per upload** in the Upload Modal — there is
no global storage mode toggle. R2 credentials are configured once in Settings.
All storage credentials (R2 keys, bucket name, etc.) are stored in the
database via the Settings page — NOT in .env files. This means you never
need SSH access to configure or change storage settings.

```
┌─────────────────────────────────────────────────────────────────┐
│  Storage Settings (Dashboard → Settings)                        │
│                                                                 │
│  Storage Usage:                                                 │
│  ┌──────────────────────┐  ┌──────────────────────┐            │
│  │  LOCAL SERVER         │  │  CLOUDFLARE R2        │            │
│  │  12.5 GB              │  │  33.7 GB              │            │
│  │  15 videos            │  │  32 videos            │            │
│  └──────────────────────┘  └──────────────────────┘            │
│                                                                 │
│  Local Storage Path: [/var/www/videos]          (read-only)     │
│                                                                 │
│  Cloudflare R2 Configuration:                                   │
│  R2 Account ID:  [xxxxxxxxxxxxxxxx]                             │
│  R2 Access Key:  [••••••••••••]                                 │
│  R2 Secret Key:  [••••••••••••]                                 │
│  R2 Bucket:      [my-video-bucket]                              │
│  R2 Public URL:  [https://pub-xxx.r2.dev]                       │
│  [Test Connection]                    [Save Storage Settings]   │
└─────────────────────────────────────────────────────────────────┘

Upload Modal (Dashboard → Videos → Upload):
┌─────────────────────────────────────────────────────────────────┐
│  Upload Video                                                    │
│                                                                  │
│  [  Drag & drop a video file here, or click to browse  ]        │
│                                                                  │
│  Storage Destination:                                            │
│  ┌──────────────────┐  ┌──────────────────────────────────┐     │
│  │ ● Local Server   │  │ ○ Cloudflare R2                  │     │
│  └──────────────────┘  └──────────────────────────────────┘     │
│  (R2 disabled if not configured)                                 │
│                                                                  │
│                              [Cancel]  [Upload]                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Storage Structure (same for both modes, HLS only)

```
{storage_root}/
├── /videos/{video_id}/hls/
│   ├── master.m3u8
│   ├── 360p/   (playlist.m3u8 + .jpeg segments)
│   ├── 480p/   (playlist.m3u8 + .jpeg segments)
│   ├── 720p/   (playlist.m3u8 + .jpeg segments)
│   └── 1080p/  (playlist.m3u8 + .jpeg segments)
│
│   NOTE: .jpeg extension is OBFUSCATION — file content is still
│   MPEG-TS (video/mp2t). Disguised as .jpeg to:
│     - Prevent scrapers from identifying video segments
│     - Bypass firewalls/networks that block .ts files
│     - Same trick used by Bunny.net
│     - HLS.js reads binary content, doesn't care about extension
│
├── /thumbnails/{video_id}/
│   ├── default.jpg
│   ├── sprite.jpg (for seek preview)
│   └── custom.jpg
└── /subtitles/{video_id}/
    └── {language}.vtt

Where {storage_root} =
├── Local:  /var/www/videos  (or custom path from settings)
└── R2:     r2://my-video-bucket
```

#### Mode A: Local Server Storage (chosen at upload time)

```
Upload (storage_type = "local") → store original on server temporarily
    ↓
Worker reads storageType from job queue
    ↓
FFmpeg transcodes to HLS (.jpeg segments)
    ↓
uploadFileTo() → local storage path (/var/www/videos/{id}/hls/)
    ↓
DELETE original uploaded file (keep only HLS)
    ↓
CDN domain (Nginx) serves files directly from local disk
    ↓
DB status = "ready", storage_type = "local"
```

#### Mode B: Cloudflare R2 Storage (chosen at upload time)

```
Upload (storage_type = "r2") → store original on server temporarily
    ↓
Worker reads storageType from job queue
    ↓
FFmpeg transcodes to HLS (.jpeg segments)
    ↓
uploadFileTo() → R2 bucket (ContentType: "video/mp2t" for .jpeg)
    ↓
DELETE original + transcoded files from local server
    ↓
CDN domain serves files from R2
    ↓
DB status = "ready", storage_type = "r2"
```

#### How CDN Delivery Differs by Storage Mode

```
Request: https://cdnforvideo.com/videos/{id}/hls/master.m3u8

If storage_type = "local":
    Nginx → serves from /var/www/videos/{id}/hls/master.m3u8 (local disk)

If storage_type = "r2":
    Nginx → proxies to R2 bucket → r2://my-video-bucket/videos/{id}/hls/master.m3u8
    OR
    CDN domain CNAME → R2 public bucket URL (direct R2 serving)
```

#### R2 API (only when R2 mode is active)

```
├── S3-compatible API
├── Presigned upload URLs (direct browser upload)
└── Lifecycle rules (auto-delete temp files)
```

#### Storage Migration (Phase 10)

```
Dashboard → Settings → Storage → [Migrate Videos]

Migrate videos between storage backends (Local ↔ R2)

┌────────────────────────────────────────────────────────────────────┐
│  Storage Migration                                                 │
│                                                                    │
│  Direction:  ○ Local → R2    ○ R2 → Local                          │
│                                                                    │
│  Scope:                                                            │
│    ○ All videos (47 videos, ~12.3 GB)                              │
│    ○ Selected videos only    [Select Videos ▾]                     │
│    ○ By folder               [Select Folder ▾]                     │
│                                                                    │
│  Options:                                                          │
│    ☑ Delete source files after successful migration                │
│    ☐ Keep copy in both locations (sync mode)                       │
│    ☑ Skip already-migrated videos                                  │
│                                                                    │
│  [Start Migration]                                                 │
│                                                                    │
│  ┌─ Migration Progress ──────────────────────────────────────────┐ │
│  │  ████████████░░░░░░░░  24/47 videos  (51%)                   │ │
│  │  Currently: "Intro Video.mp4" → uploading to R2...            │ │
│  │  Speed: ~45 MB/s  |  ETA: ~3 min                             │ │
│  │  ✓ 23 migrated  |  ✗ 1 failed  |  ⏳ 23 remaining            │ │
│  └───────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘

Migration process per video:
    1. Read HLS files from source (local disk or R2)
    2. Write HLS files to destination (R2 or local disk)
    3. Verify all files transferred (checksum)
    4. Update DB: video.storage_type = new target
    5. If "delete source" enabled → remove files from old location
    6. If any step fails → rollback, keep original, mark as failed

Migration is:
├── Non-blocking: videos remain playable during migration
├── Resumable: if interrupted, picks up where it left off
├── Background job: runs via job queue, doesn't block the server
└── Logged: full migration history in dashboard
```

### 5. BACKEND API

```
Backend API
├── Auth API
│   ├── POST   /api/auth/login
│   ├── POST   /api/auth/logout
│   ├── POST   /api/auth/refresh-token
│   └── POST   /api/auth/reset-password
│
├── Video API
│   ├── GET    /api/videos              (list all)
│   ├── GET    /api/videos/:id          (get one)
│   ├── POST   /api/videos/upload       (upload — accepts storage_type: "local" or "r2")
│   ├── PUT    /api/videos/:id          (update)
│   ├── DELETE /api/videos/:id          (delete)
│   ├── POST   /api/videos/bulk-delete  (bulk delete)
│   ├── GET    /api/videos/:id/embed    (get embed code)
│   ├── POST   /api/videos/:id/subtitles     (upload subtitle file)
│   ├── GET    /api/videos/:id/subtitles     (list subtitles)
│   └── DELETE /api/videos/:id/subtitles/:lang (delete subtitle)
│
├── Folder API
│   ├── GET    /api/folders
│   ├── POST   /api/folders
│   ├── PUT    /api/folders/:id
│   ├── DELETE /api/folders/:id
│   └── PUT    /api/videos/:id/move     (move to folder)
│
├── Domain API
│   ├── GET    /api/domains             (list domains)
│   ├── PUT    /api/domains/:type       (update embed/cdn domain)
│   ├── POST   /api/domains/verify      (verify DNS)
│   └── POST   /api/domains/ssl         (trigger SSL install)
│
├── Cloudflare API
│   ├── GET    /api/cloudflare/accounts     (list CF accounts)
│   ├── POST   /api/cloudflare/accounts     (add CF token)
│   ├── PUT    /api/cloudflare/accounts/:id (update token)
│   ├── DELETE /api/cloudflare/accounts/:id (remove)
│   ├── POST   /api/cloudflare/test         (test connection)
│   └── POST   /api/cloudflare/purge-cache  (purge CDN cache)
│
├── Analytics API
│   ├── GET    /api/analytics/overview      (dashboard stats)
│   ├── GET    /api/analytics/videos/:id    (per video stats)
│   ├── GET    /api/analytics/bandwidth     (bandwidth usage)
│   └── POST   /api/analytics/track         (player sends events)
│
├── Settings API (all config stored in DB — no .env needed)
│   ├── GET    /api/settings                 (get all settings)
│   ├── PUT    /api/settings                 (update settings)
│   ├── PUT    /api/settings/storage         (update R2 credentials — no global mode)
│   ├── GET    /api/settings/storage/usage   (storage usage: local + R2 counts/sizes + r2_configured flag)
│   ├── POST   /api/settings/storage/test    (test R2 connection)
│   ├── PUT    /api/settings/cloudflare      (update CF API token)
│   ├── POST   /api/settings/cloudflare/test (test CF connection)
│   ├── PUT    /api/settings/domains         (update domain config)
│   ├── GET    /api/settings/cdn-domains     (list CDN domains for load balancing)
│   ├── POST   /api/settings/cdn-domains     (add CDN domain, max 5)
│   ├── PUT    /api/settings/cdn-domains/:id (update CDN domain / toggle active)
│   ├── DELETE /api/settings/cdn-domains/:id (remove CDN domain)
│   ├── GET    /api/settings/ads             (get ad configuration)
│   ├── PUT    /api/settings/ads             (update ad configuration + entries)
│   ├── GET    /api/settings/embed           (get global embed settings: player color, autoplay, etc.)
│   ├── PUT    /api/settings/embed           (update global embed settings)
│   └── POST   /api/settings/api-keys        (generate API key)
│
├── Analytics API
│   ├── GET    /api/analytics/overview      (dashboard stats)
│   ├── GET    /api/analytics/realtime      (today's live stats, auto-refresh)
│   ├── GET    /api/analytics/videos/:id    (per video stats)
│   ├── GET    /api/analytics/bandwidth     (bandwidth usage)
│   ├── GET    /api/analytics/ads           (ad analytics: popup clicks + VAST impressions)
│   └── POST   /api/analytics/track         (player sends events)
│
├── Player API (public, used by embed player)
│   ├── GET    /api/player/:video_id        (get video data for player)
│   └── POST   /api/player/event            (track play/pause/etc)
│
└── SSL Service (internal)
    ├── Issue cert (DNS-01 or HTTP-01)
    ├── Renew cert
    ├── Check cert status
    └── Generate/reload Nginx config
```

### 6. DATABASE SCHEMA

```
PostgreSQL
├── admins
│   ├── id, email, password_hash, created_at
│
├── videos
│   ├── id, title, description, folder_id
│   ├── original_filename, file_size, duration
│   ├── status (uploading, processing, ready, error)
│   ├── storage_type ("local" or "r2") — where HLS files live
│   ├── storage_path (local path or R2 key prefix)
│   ├── visibility (public, private, unlisted)
│   ├── thumbnail_url, sprite_url
│   ├── qualities (json: [360, 480, 720, 1080])
│   ├── hls_ready (boolean)
│   ├── tags, created_at, updated_at
│   └── views_count
│
├── folders
│   ├── id, name, parent_id, created_at
│
├── cloudflare_domains (used for multi-CDN load balancing)
│   ├── id, domain, service_type ('cdn')
│   ├── cf_api_token (encrypted), cf_zone_id
│   ├── is_active, sort_order
│   ├── created_at, updated_at
│   ├── Max 5 CDN domains enforced at API level
│   └── Unique index on domain, filtered index on active CDN entries
│
├── ssl_certificates
│   ├── id, domain, method (dns01/http01)
│   ├── status (pending, active, expired, error)
│   ├── issued_at, expires_at
│   └── last_renewal_at
│
├── domain_settings
│   ├── id, service_type (embed, cdn, admin)
│   ├── domain, is_active
│   └── created_at, updated_at
│
├── subtitles
│   ├── id, video_id, language, label
│   ├── file_url (local path or R2 path, depends on storage_type)
│   ├── is_default (boolean)
│   ├── created_at
│
├── analytics_events
│   ├── id, video_id, event_type
│   ├── country, device, referrer
│   ├── watch_duration, timestamp
│
├── embed_settings
│   ├── id, video_id (nullable, null = global default)
│   ├── player_color, logo_url
│   ├── autoplay, controls, loop
│   ├── allowed_domains (json array)
│   └── watermark_position
│
├── api_keys
│   ├── id, key_hash, name, permissions
│   ├── created_at, expires_at, last_used_at
│
├── ad_configurations (global ad settings — singleton row)
│   ├── id, vast_enabled, ad_type, ad_title
│   ├── popup_enabled, popup_limit, popup_url
│   └── updated_at
│
├── ad_entries (VAST ad list rows)
│   ├── id, ad_config_id (FK → ad_configurations)
│   ├── sort_order, offset_type (preroll/midroll/postroll)
│   ├── time_offset (HH:MM:SS.mmm), skip_offset (seconds)
│   ├── vast_url (VAST XML URL)
│   └── created_at
│
├── analytics_ad_daily (ad events rollup — 1 row per day)
│   ├── id, date (UNIQUE), popup_clicks, vast_impressions
│   └── created_at
│
└── settings (ALL platform config — managed from dashboard, not .env)
    ├── id, key, value (json), updated_at
    ├── Keys stored here:
    │   ├── storage_mode          → (legacy, no longer used — storage chosen per upload)
    │   ├── storage_local_path    → "/var/www/videos"
    │   ├── r2_account_id         → (encrypted)
    │   ├── r2_access_key_id      → (encrypted)
    │   ├── r2_secret_access_key  → (encrypted)
    │   ├── r2_bucket_name        → "my-video-bucket"
    │   ├── r2_public_url         → "https://pub-xxx.r2.dev"
    │   ├── cloudflare_api_token  → (encrypted)
    │   ├── cloudflare_zone_id    → "zone_abc123"
    │   ├── domain_dashboard      → "dashboard.yourdomain.com"
    │   ├── domain_player         → "player.yourdomain.com"
    │   ├── domain_cdn            → "cdn.yourdomain.com"
    │   └── ... any future config
    │
    │   NOTE: Sensitive values (API keys, secrets) are encrypted at rest
    │   using AES-256-GCM with a master key from .env (ENCRYPTION_KEY).
    │   This is the ONLY secret that must be in .env — everything else
    │   is configured from the dashboard UI.
```

---

## Domains & Cloudflare Setup

| Service    | Domain           | Cloudflare Account | API Token    |
|------------|------------------|--------------------|--------------|
| Admin      | dashboard.com    | Account 1          | cf_token_aaa |
| Embed      | player.com       | Account 2          | cf_token_bbb |
| CDN 1      | cdn1.video.com   | Account 3          | cf_token_ccc |
| CDN 2      | cdn2.video.com   | Account 4          | cf_token_ddd |
| CDN 3      | cdn3.video.com   | Account 5          | cf_token_eee |
| CDN 4      | cdn4.video.com   | Account 6          | cf_token_fff |
| CDN 5      | cdn5.video.com   | Account 7          | cf_token_ggg |
| R2 Storage | r2.video.com     | Account 3/4        | cf_token_hhh |

Each domain in a separate Cloudflare account with its own API token stored encrypted in DB.
Up to 5 CDN domains supported for load-balanced video delivery. Each play request randomly
selects one active CDN domain, distributing bandwidth across all configured domains.

---

## SSL / TLS Strategy

### Two Methods

| Method | When Used | Renewal |
|--------|-----------|---------|
| **DNS-01** | Domain has CF API token stored | Auto (certbot + CF API) |
| **HTTP-01** | Domain has no CF token | Auto (certbot + Nginx) |

### Selection Logic

```
Domain changed in dashboard
    ↓
Has CF API token?
    ├── YES → DNS-01 (automatic, works with CF proxy ON/OFF)
    └── NO  → HTTP-01 (user adds A record → verify → automatic)
```

### Both methods auto-renew. Certbot timer runs twice daily. Zero manual work.

---

## Nginx Configuration

```nginx
# Admin Dashboard → :3000
server {
    listen 443 ssl;
    server_name dashboard.com;
    ssl_certificate     /etc/letsencrypt/live/dashboard.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dashboard.com/privkey.pem;
    location / { proxy_pass http://localhost:3000; }
}

# Embed Player → :3001
server {
    listen 443 ssl;
    server_name player.com;
    ssl_certificate     /etc/letsencrypt/live/player.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/player.com/privkey.pem;
    location / { proxy_pass http://localhost:3001; }
}

# CDN → :3002
server {
    listen 443 ssl;
    server_name cdnforvideo.com;
    ssl_certificate     /etc/letsencrypt/live/cdnforvideo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cdnforvideo.com/privkey.pem;
    location / { proxy_pass http://localhost:3002; }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name dashboard.com player.com cdnforvideo.com;
    return 301 https://$host$request_uri;
}
```

---

## Video Upload & Processing Pipeline

```
Admin uploads video (.mp4, .mkv, etc.)
    ↓
Backend receives file → stores on LOCAL SERVER temporarily (/tmp/uploads/)
    ↓
DB status = "processing"
    ↓
FFmpeg transcoding job (always runs on local server)
    ├── HLS 1080p/ (playlist.m3u8 + .jpeg segments ← disguised MPEG-TS)
    ├── HLS 720p/  (playlist.m3u8 + .jpeg segments)
    ├── HLS 480p/  (playlist.m3u8 + .jpeg segments)
    ├── HLS 360p/  (playlist.m3u8 + .jpeg segments)
    ├── master.m3u8 (adaptive bitrate manifest)
    ├── Thumbnail (default.jpg)
    └── Seek preview sprite (sprite.jpg)
    ↓
Check storage mode setting:
    ├── LOCAL SERVER:
    │   ├── Move HLS output to /var/www/videos/{id}/hls/
    │   ├── DELETE original uploaded file only
    │   └── DB: storage_type = "local"
    │
    └── CLOUDFLARE R2:
        ├── Upload HLS to R2 (ContentType: "video/mp2t" for .jpeg)
        ├── DELETE original + all temp files from local server
        └── DB: storage_type = "r2"
    ↓
DB status = "ready"
    ↓
Video available for embed (HLS only, no original MP4/MKV kept)
```

### HLS Segment Obfuscation (.jpeg trick)

```
Actual file:   segment001.jpeg  (contains MPEG-TS video data, NOT a JPEG image)
MIME type:     video/mp2t       (must be set correctly)
HLS.js:        reads binary content → doesn't care about .jpeg extension → plays fine

Why?
├── Anti-scraping:  bots scanning for .ts files won't find them
├── Firewall bypass: some networks block .ts but allow .jpeg
└── Bunny.net style: same obfuscation trick used in production

FFmpeg command:
    ffmpeg -i input.mp4 \
      -hls_segment_filename "segment%03d.jpeg" \
      -hls_segment_type mpegts \
      playlist.m3u8

MIME type handling:
├── Local mode:  Nginx serves .jpeg with default_type video/mp2t
├── R2 mode:     S3 SDK → ContentType: "video/mp2t" for all .jpeg segments
└── Nginx rule:  location ~* /videos/.*\.jpeg$ { default_type video/mp2t; }
```

---

## Tech Stack

| Component        | Technology              |
|------------------|-------------------------|
| Admin Dashboard  | Next.js (React)         |
| Embed Player     | Vanilla JS (lightweight)|
| Backend API      | Node.js (Express/Fastify)|
| Database         | PostgreSQL              |
| Cache            | Redis                   |
| Object Storage   | Local Server OR Cloudflare R2 (configurable) |
| Video Transcoding| FFmpeg                  |
| Reverse Proxy    | Nginx                   |
| SSL              | Let's Encrypt (certbot) |
| Server           | VPS (Ubuntu)            |

---

## Implementation Phases

### Phase 1: Server & Infrastructure
- [ ] VPS setup (Ubuntu)
- [ ] Install Nginx, certbot, cloudflare DNS plugin
- [ ] Configure firewall (UFW)
- [ ] Setup systemd certbot timer
- [ ] Install Node.js, PostgreSQL, Redis, FFmpeg

### Phase 2: Backend API & Database
- [ ] Initialize Node.js project
- [ ] Setup PostgreSQL database + all tables
- [ ] Auth system (JWT login)
- [ ] Video CRUD API endpoints
- [ ] Folder API endpoints
- [ ] Settings API endpoints

### Phase 3: Domain & SSL Management
- [ ] Cloudflare domain management API
- [ ] SSL provisioning service (DNS-01 + HTTP-01)
- [ ] Nginx config auto-generation on domain change
- [ ] Domain verification endpoint
- [ ] SSL status monitoring

### Phase 4: Storage & Upload Pipeline
- [ ] Storage mode setting (local vs R2, configurable from dashboard)
- [ ] Local storage: serve HLS from disk via Nginx
- [ ] Cloudflare R2 integration (S3 SDK, only when R2 mode active)
- [ ] Video upload endpoint
- [ ] FFmpeg transcoding service (HLS .jpeg segments)
- [ ] Generate thumbnails & seek sprites
- [ ] Post-transcode cleanup (delete original, keep only HLS)
- [ ] Processing queue (background jobs)

### Phase 5: CDN Service
- [ ] CDN delivery endpoints
- [ ] Signed URL generation
- [ ] Cache headers & Cloudflare cache rules
- [ ] CORS configuration
- [ ] Hotlink protection

### Phase 6: Embed Player
- [ ] Video player (HTML5 + HLS.js)
- [ ] Quality selector
- [ ] Playback speed control
- [ ] Fullscreen, PiP, keyboard shortcuts
- [ ] Custom theming (colors, logo, watermark)
- [ ] iframe + JS embed methods
- [ ] Domain restriction enforcement
- [ ] Analytics event tracking

### Phase 7: Admin Dashboard
- [ ] Login page
- [ ] Dashboard home (stats overview)
- [ ] Video management page (list, upload, edit, delete)
- [ ] Folder management
- [ ] Embed settings page (per video customization)
- [ ] Domain settings page
- [ ] Cloudflare accounts page
- [ ] SSL management page
- [ ] Analytics page (charts, graphs)
- [ ] Settings page

### Phase 8: Analytics
- [ ] Event tracking endpoint
- [ ] Views, watch time, completion rate
- [ ] Country & device detection
- [ ] Bandwidth & storage usage tracking
- [ ] Dashboard charts & graphs

### Phase 9: Security & Hardening
- [ ] Signed URLs for video access
- [ ] Domain restriction on embeds
- [ ] Rate limiting
- [ ] API key authentication
- [ ] Input validation & sanitization
- [ ] CORS policies
- [ ] Hotlink protection

### Phase 10: Storage Migration
- [ ] Migration API endpoint (POST /api/admin/storage/migrate)
- [ ] Background job: copy HLS files between Local ↔ R2
- [ ] Checksum verification after transfer
- [ ] Update video.storage_type in DB after successful move
- [ ] Delete source files option (after verified migration)
- [ ] Bulk migrate: all videos, by folder, or selected videos
- [ ] Migration progress tracking (SSE or polling)
- [ ] Migration dashboard UI (progress bar, retry failed, history)
- [ ] Resumable migrations (track per-video status)
- [ ] Rollback on failure (keep original, mark as failed)

---

## Request Flow

```
User visits website with embedded video
    ↓
<iframe src="https://player.com/v/abc123">
    ↓
player.com (Nginx → :3001) serves player HTML + JS
    ↓
Player JS calls: GET /api/player/abc123
    ↓
Backend checks: domain allowed? token valid?
    ├── NO  → 403 Forbidden
    └── YES → picks random active CDN domain → returns video metadata + signed CDN URLs
    ↓
Player loads: https://{random-cdn-domain}/cdn/videos/abc123/hls/master.m3u8
    (e.g., cdn1.video.com, cdn2.video.com, cdn3.video.com — randomly selected)
    ↓
CDN domain resolves based on storage mode:
    ├── LOCAL:  Nginx serves from /var/www/videos/abc123/hls/master.m3u8
    └── R2:     Nginx proxies to R2 bucket (or R2 public URL)
    ↓
HLS manifest loaded → .jpeg segments stream (disguised MPEG-TS)
    ↓
Player sends analytics events → POST /api/player/event
    ↓
Admin sees views in dashboard.com analytics
```

---

## Full Server Installation Guide (Step-by-Step)

> This guide is written for a complete beginner. Follow every step exactly.
> Works on a fresh Ubuntu 22.04 / 24.04 VPS (DigitalOcean, Hetzner, Vultr, etc.)

### Step 0: Get a VPS Server

```
1. Go to any VPS provider (DigitalOcean, Hetzner, Vultr, Contabo, etc.)
2. Create a new server with:
   - OS: Ubuntu 22.04 or 24.04
   - RAM: minimum 2 GB (4 GB recommended for encoding)
   - Storage: 50 GB+ (depends on how many videos you'll host)
   - CPU: 2+ cores (more cores = faster video encoding)
3. You'll get an IP address and root password (or SSH key)
```

### Step 1: Connect to Your Server

```bash
# From your computer's terminal (Mac/Linux) or PuTTY (Windows)
ssh root@YOUR_SERVER_IP

# It will ask for password — paste the one from your VPS provider
# First time it asks "Are you sure?" — type: yes
```

### Step 2: Update the Server

```bash
# Update all system packages to latest versions
apt update && apt upgrade -y
```

### Step 3: Create a Non-Root User (Safer than using root)

```bash
# Create a new user (replace "deploy" with any name you want)
adduser deploy

# It will ask for a password — choose a strong one
# Press ENTER to skip the Full Name, Room Number, etc.

# Give this user admin (sudo) rights
usermod -aG sudo deploy

# Switch to the new user
su - deploy
```

### Step 4: Setup Firewall

```bash
# Allow SSH so you don't get locked out
sudo ufw allow OpenSSH

# Allow web traffic (HTTP + HTTPS)
sudo ufw allow 80
sudo ufw allow 443

# Turn on the firewall
sudo ufw enable

# Check it's working
sudo ufw status
# Should show: OpenSSH, 80, 443 = ALLOW
```

### Step 5: Install Node.js (v20)

```bash
# Download and install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify it's installed
node -v    # Should show: v20.x.x
npm -v     # Should show: 10.x.x
```

### Step 6: Install PostgreSQL (Database)

```bash
# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Start and enable it
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create a database and user for the app
sudo -u postgres psql

# Inside the PostgreSQL shell, run these commands:
# (replace 'yourpassword' with a strong password — REMEMBER THIS)
```

```sql
CREATE USER videoplayer WITH PASSWORD 'yourpassword';
CREATE DATABASE videoplayer OWNER videoplayer;
GRANT ALL PRIVILEGES ON DATABASE videoplayer TO videoplayer;
\q
```

```bash
# Test the connection works
psql -U videoplayer -d videoplayer -h localhost
# It asks for password — enter the one you just set
# Type \q to exit
```

### Step 7: Install Redis (Job Queue)

```bash
# Install Redis
sudo apt install -y redis-server

# Make Redis start on boot
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Test it works
redis-cli ping
# Should say: PONG
```

### Step 8: Install FFmpeg (Video Encoding)

```bash
# Install FFmpeg
sudo apt install -y ffmpeg

# Verify it's installed
ffmpeg -version
# Should show version info (5.x or 6.x)
```

### Step 9: Install Nginx (Web Server / Reverse Proxy)

```bash
# Install Nginx
sudo apt install -y nginx

# Start and enable it
sudo systemctl start nginx
sudo systemctl enable nginx

# Test it works — open your browser and go to:
# http://YOUR_SERVER_IP
# You should see "Welcome to nginx!" page
```

### Step 10: Install Certbot (Free SSL Certificates)

```bash
# Install Certbot with Cloudflare DNS plugin
sudo apt install -y certbot python3-certbot-nginx python3-certbot-dns-cloudflare

# Verify it's installed
certbot --version
```

### Step 11: Install Git

```bash
# Install Git
sudo apt install -y git

# Verify
git --version
```

### Step 12: Clone the Project

```bash
# Go to the home directory
cd /home/deploy

# Clone the project from GitHub
git clone https://github.com/YOUR_USERNAME/video-player.git
cd video-player
```

### Step 13: Setup Environment Variables

```bash
# Copy the example env file
cp .env.example .env

# Edit the .env file
nano .env
```

```env
# Fill in these values:

# Database (use the password from Step 6)
DATABASE_URL=postgresql://videoplayer:yourpassword@localhost:5432/videoplayer

# Redis
REDIS_URL=redis://localhost:6379

# App
PORT=3000
NODE_ENV=production

# Admin Login (choose your own username & password for the dashboard)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_dashboard_password

# JWT Secret (generate a random string — run this command to get one):
#   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=paste_the_random_string_here

# Encryption Key (encrypts R2/Cloudflare secrets in the database)
# Generate one:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=paste_another_random_string_here

# Default video storage path (used until you configure storage in dashboard)
VIDEO_STORAGE_PATH=/var/www/videos

# ─────────────────────────────────────────────────────────────
# NOTE: You do NOT need to set R2 or Cloudflare credentials here!
# All of these are configured from the Dashboard Settings page:
#   → Storage mode (Local / R2)
#   → R2 credentials (Account ID, Access Key, Secret Key, Bucket)
#   → Cloudflare API Token
#   → Domain settings
# Just finish this setup, then log into the dashboard to configure.
# ─────────────────────────────────────────────────────────────
```

```bash
# Save the file: press Ctrl+X, then Y, then Enter
```

### Step 14: Create Video Storage Directory

```bash
# Create the directory where videos will be stored
sudo mkdir -p /var/www/videos
sudo chown deploy:deploy /var/www/videos
```

### Step 15: Install Project Dependencies

```bash
# Inside the project folder
cd /home/deploy/video-player

# Install all packages
npm install

# Build the project (compiles Next.js dashboard)
npm run build

# Run database migrations (creates all the tables)
npm run db:migrate
```

### Step 16: Configure Nginx

```bash
# Create Nginx config for the app
sudo nano /etc/nginx/sites-available/video-player
```

```nginx
# Dashboard (admin panel)
server {
    listen 80;
    server_name dashboard.yourdomain.com;  # ← change this

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10G;  # Allow large video uploads
    }
}

# CDN (serves video files)
server {
    listen 80;
    server_name cdn.yourdomain.com;  # ← change this

    # Serve local video files
    location /videos/ {
        alias /var/www/videos/;
        add_header Cache-Control "public, max-age=31536000";
        add_header Access-Control-Allow-Origin *;
    }
}

# Player (embed player)
server {
    listen 80;
    server_name player.yourdomain.com;  # ← change this

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Save: Ctrl+X → Y → Enter

# Enable the config
sudo ln -s /etc/nginx/sites-available/video-player /etc/nginx/sites-enabled/

# Remove default nginx page
sudo rm /etc/nginx/sites-enabled/default

# Test the config is valid
sudo nginx -t
# Should say: syntax is ok / test is successful

# Reload Nginx
sudo systemctl reload nginx
```

### Step 17: Setup SSL (HTTPS) with Certbot

```bash
# Get SSL certificates for all your domains
sudo certbot --nginx -d dashboard.yourdomain.com -d cdn.yourdomain.com -d player.yourdomain.com

# It will ask for your email — enter it
# Agree to terms — type Y
# It will automatically configure HTTPS

# Test auto-renewal works
sudo certbot renew --dry-run
```

### Step 18: Setup PM2 (Keeps the App Running Forever)

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the backend API
pm2 start npm --name "video-api" -- run start

# Start the encoding worker
pm2 start npm --name "video-worker" -- run worker

# Save the process list (so it restarts on server reboot)
pm2 save

# Setup PM2 to start on boot
pm2 startup
# It will give you a command to copy — run that command
```

### Step 19: Setup Auto-SSL Renewal

```bash
# Certbot auto-renew is already set up, but verify:
sudo systemctl status certbot.timer
# Should show: active

# If not active:
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### Step 20: Point Your Domains to the Server

```
Go to Cloudflare Dashboard → DNS settings for your domain:

Add these DNS records:
┌──────────┬──────┬─────────────────┬──────────┐
│ Name     │ Type │ Content         │ Proxy     │
├──────────┼──────┼─────────────────┼──────────┤
│ dashboard│ A    │ YOUR_SERVER_IP  │ DNS only  │
│ cdn      │ A    │ YOUR_SERVER_IP  │ Proxied   │
│ player   │ A    │ YOUR_SERVER_IP  │ Proxied   │
└──────────┴──────┴─────────────────┴──────────┘

Wait 1-2 minutes for DNS to propagate.
```

### Step 21: Verify Everything Works

```bash
# Check all services are running:
pm2 status           # Should show video-api & video-worker: online
sudo systemctl status nginx       # Should show: active (running)
sudo systemctl status postgresql  # Should show: active (running)
sudo systemctl status redis       # Should show: active (running)

# Test in browser:
# https://dashboard.yourdomain.com → should show login page
# Login with the ADMIN_USERNAME and ADMIN_PASSWORD from Step 13
```

### Step 22: Configure Everything from the Dashboard (No More SSH!)

```
Once you're logged into the dashboard, go to Settings page.
From here you configure EVERYTHING — no need to touch the server again.

┌─────────────────────────────────────────────────────────────────┐
│  Dashboard → Settings                                           │
│                                                                 │
│  🔧 STORAGE                                                     │
│  ├── Storage Mode: ○ Local Server  ○ Cloudflare R2              │
│  │   (Start with Local — switch to R2 later when ready)         │
│  │                                                              │
│  │   If you choose Cloudflare R2, fill in:                      │
│  │   ├── R2 Account ID     [paste from Cloudflare]              │
│  │   ├── R2 Access Key     [paste from Cloudflare]              │
│  │   ├── R2 Secret Key     [paste from Cloudflare]              │
│  │   ├── R2 Bucket Name    [your-bucket-name]                   │
│  │   ├── R2 Public URL     [https://pub-xxx.r2.dev]             │
│  │   └── [Test Connection] button — click to verify it works    │
│  │                                                              │
│  🌐 CLOUDFLARE                                                   │
│  ├── API Token:  [paste from Cloudflare]                        │
│  ├── Zone ID:    [paste from Cloudflare DNS page]               │
│  └── [Test Connection] button                                   │
│                                                                 │
│  🔗 DOMAINS                                                      │
│  ├── Dashboard: dashboard.yourdomain.com                        │
│  ├── Player:    player.yourdomain.com                           │
│  └── CDN:       cdn.yourdomain.com                              │
│                                                                 │
│  [Save Settings]                                                │
└─────────────────────────────────────────────────────────────────┘

WHERE TO GET R2 CREDENTIALS:
  1. Go to: https://dash.cloudflare.com
  2. Click "R2 Object Storage" in sidebar
  3. Click "Create Bucket" → name it (e.g., "videos")
  4. Go to "Manage R2 API Tokens" → "Create API Token"
  5. Copy: Account ID, Access Key ID, Secret Access Key
  6. Enable public access on bucket → copy the public URL
  7. Paste everything into the dashboard Settings page

WHERE TO GET CLOUDFLARE API TOKEN:
  1. Go to: https://dash.cloudflare.com/profile/api-tokens
  2. Click "Create Token"
  3. Use "Edit zone DNS" template
  4. Copy the token → paste into dashboard Settings

That's it! You're done. Start uploading videos! 🎉
```

### Quick Reference: Useful Commands

```bash
# View app logs
pm2 logs video-api
pm2 logs video-worker

# Restart the app after code changes
cd /home/deploy/video-player
git pull
npm install
npm run build
pm2 restart all

# Check disk space (for video storage)
df -h

# Check how much space videos are using
du -sh /var/www/videos

# Restart services
sudo systemctl restart nginx
sudo systemctl restart postgresql
sudo systemctl restart redis
pm2 restart all
```

### Troubleshooting

```
Problem: Can't connect to server
→ Check firewall: sudo ufw status
→ Make sure ports 80 and 443 are allowed

Problem: "502 Bad Gateway" in browser
→ App is not running: pm2 status
→ Restart it: pm2 restart all

Problem: Videos not playing
→ Check video folder permissions: ls -la /var/www/videos
→ Fix: sudo chown -R deploy:deploy /var/www/videos

Problem: SSL certificate error
→ Re-run: sudo certbot --nginx -d yourdomain.com
→ Check renewal: sudo certbot renew

Problem: Database connection error
→ Check PostgreSQL is running: sudo systemctl status postgresql
→ Check your .env DATABASE_URL is correct

Problem: Upload fails (large file)
→ Check Nginx config has: client_max_body_size 10G;
→ Reload: sudo systemctl reload nginx

Problem: Encoding is slow
→ Normal — encoding depends on CPU. A 1-hour video can take 20-40 min.
→ Check progress: pm2 logs video-worker

Problem: Server runs out of disk space
→ Check: df -h
→ Delete old videos or upgrade your VPS storage
```
