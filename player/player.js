/* ── SVG Icons (Lucide — stroke-based, rounded) ── */
// All icons share: viewBox 0 0 24 24, fill=none, stroke=currentColor, stroke-width=2,
// stroke-linecap=round, stroke-linejoin=round. This produces the clean, minimal
// look used by Vercel, Loom, Cal.com, etc. See https://lucide.dev for originals.
// stroke-width 2.25 gives sharper, more readable icons at player sizes without
// losing the Lucide minimal aesthetic. Going to 3 looks blocky; 2 is too thin.
var _lucideAttr = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                  'stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"';
function _svg(paths) { return '<svg ' + _lucideAttr + '>' + paths + '</svg>'; }
// Solid-fill variant for the large center play button (filled looks better large)
function _svgSolid(paths) {
  return '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">' + paths + '</svg>';
}
var Icons = {
  // Play/pause — outlined for controls, filled for the big center button
  play:         _svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  pause:        _svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'),
  playSolid:    _svgSolid('<path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l10.66-6.86a1 1 0 0 0 0-1.7L9.53 4.29A1 1 0 0 0 8 5.14z"/>'),

  // Volume (3 states)
  volumeHigh:   _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
  volumeLow:    _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'),
  volumeMute:   _svg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>'),

  // Fullscreen / pip
  fullscreen:     _svg('<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>'),
  fullscreenExit: _svg('<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>'),
  // PIP: outer screen + inset sub-window in the bottom-right corner — clearer
  // than the old "arrow-to-corner" variant which read as another "external link".
  pip:            _svg('<rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><rect x="12" y="12" width="8" height="6" rx="1" ry="1"/>'),

  // Settings / menus
  settings:   _svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  captions:   _svg('<rect x="3" y="5" width="18" height="14" rx="3" ry="3"/><path d="M7 15h4"/><path d="M13 15h4"/><path d="M7 11h4"/><path d="M13 11h2"/>'),
  subtitles:  _svg('<rect x="3" y="5" width="18" height="14" rx="3" ry="3"/><path d="M7 15h4"/><path d="M13 15h4"/><path d="M7 11h4"/><path d="M13 11h2"/>'),
  speed:      _svg('<path d="M12 22a10 10 0 1 0-10-10"/><path d="M12 12l4-4"/>'),

  // Skip back/forward 10s — curved arrow with "10" label baked in
  // Skip 10s — curl arrow + path-based "10" digits. Block shifted right by
  // 0.6 units vs pure viewBox-center so the "1" clears the arrow indicator
  // at top-left (M3 3v5h5 ends at ~x=8 with round caps). The "0" is also
  // slightly tightened (rx 1.6→1.4) so the total visual block stays near
  // the curl's geometric center while leaving breathing room from the arrow.
  back10:  '<svg ' + _lucideAttr + '>' +
              '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>' +
              '<path d="M3 3v5h5"/>' +
              // "1" — top flag + stem + bottom base, shifted right for arrow clearance
              '<path d="M9.5 9.4 L10.6 8.7 V15.1 M9.2 15.1 H12" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>' +
              // "0" — oval, tightened to keep block visually centered
              '<ellipse cx="14.3" cy="12" rx="1.4" ry="2.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>',
  fwd10:   '<svg ' + _lucideAttr + '>' +
              '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/>' +
              '<path d="M21 3v5h-5"/>' +
              '<path d="M9.5 9.4 L10.6 8.7 V15.1 M9.2 15.1 H12" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>' +
              '<ellipse cx="14.3" cy="12" rx="1.4" ry="2.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>',

  // Extras for the redesign
  // Settings-menu icons (row leaders + navigation)
  chevronRight: _svg('<polyline points="9 18 15 12 9 6"/>'),
  chevronLeft:  _svg('<polyline points="15 18 9 12 15 6"/>'),
  sliders:      _svg('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
  chapters:     _svg('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
  audio:        _svg('<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>')
};

/* ── Viewer ID — persistent anonymous ID for resume watching ── */
function getViewerId() {
  var key = 'vp_viewer_id';
  var id = null;
  try { id = localStorage.getItem(key); } catch (_) { /* Safari private / sandboxed iframe */ }
  if (!id) {
    // Generate a UUID-like ID
    id = 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(key, id); } catch (_) { /* fall through with session-only id */ }
  }
  return id;
}

/* ── Persistent Player Preferences (YouTube-style) ──
   Cross-video, cross-session localStorage. Each pref is read lazily and
   written immediately on user change. Storage keys are flat strings for easy
   debugging; all wrapped in try/catch because Safari private mode can throw. */
var PlayerPrefs = (function () {
  var KEYS = {
    volume:   'vp_pref_volume',   // 0..1 float
    muted:    'vp_pref_muted',    // '1' / '0'
    speed:    'vp_pref_speed',    // float
    quality:  'vp_pref_quality',  // 'auto' | '360p' | '720p' | '1080p' | '2K' | '4K'
    captions: 'vp_pref_captions'  // BCP-47 lang code, e.g. 'en' — or '' (off)
  };
  function _get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function _set(k, v) { try { localStorage.setItem(k, String(v)); } catch (_) {} }
  return {
    getVolume: function () {
      var v = parseFloat(_get(KEYS.volume));
      return (isFinite(v) && v >= 0 && v <= 1) ? v : null;
    },
    setVolume: function (v) { if (isFinite(v)) _set(KEYS.volume, v); },

    getMuted:  function () { return _get(KEYS.muted) === '1'; },
    setMuted:  function (m) { _set(KEYS.muted, m ? '1' : '0'); },

    getSpeed:  function () {
      var s = parseFloat(_get(KEYS.speed));
      return (isFinite(s) && s > 0 && s <= 4) ? s : null;
    },
    setSpeed:  function (s) { if (isFinite(s)) _set(KEYS.speed, s); },

    getQuality: function () { return _get(KEYS.quality) || null; },
    setQuality: function (q) { if (q) _set(KEYS.quality, q); },

    getCaptions: function () { return _get(KEYS.captions) || ''; },
    setCaptions: function (lang) { _set(KEYS.captions, lang || ''); }
  };
})();

/* ── Utility: Format Time ── */
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  var s = Math.floor(seconds);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var sec = s % 60;
  if (h > 0) {
    return h + ':' + (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

/* ── Utility: Create Element ── */
function el(tag, className, attrs) {
  var elem = document.createElement(tag);
  if (className) elem.className = className;
  if (attrs) {
    for (var k in attrs) {
      if (k === 'innerHTML') elem.innerHTML = attrs[k];
      else if (k === 'textContent') elem.textContent = attrs[k];
      else elem.setAttribute(k, attrs[k]);
    }
  }
  return elem;
}

/* ── Main Init ── */
function initPlayer(videoId) {
  var container = document.getElementById('player-container');
  var hls = null;
  var video = null;
  var controlsTimeout = null;
  var analyticsInterval = null;
  var hasPlayed = false;
  var watchDuration = 0;
  var lastTimeUpdate = 0;

  /* ── Resume watching state ── */
  var viewerId       = getViewerId();
  var savedPosition  = 0;          // position loaded from server
  var progressSaveTimer  = null;   // debounce timer (per-event saveProgress)
  var progressSaveInterval = null; // periodic 5s interval during playback
  var resumeBanner   = null;       // DOM element
  var resumeAutoHideTimer = null;

  /* ── Show Loading ── */
  var loadingOverlay = el('div', 'player-loading visible', { innerHTML: '<div class="spinner"></div>' });
  container.appendChild(loadingOverlay);

  /* ── Fetch Video Data ── */
  fetch('/api/player/' + videoId)
    .then(function (res) {
      if (!res.ok) throw new Error('Video not found');
      return res.json();
    })
    .then(function (data) {
      var videoStatus = (data.video || {}).status || '';
      if (videoStatus === 'ready') {
        setupPlayer(data);
      } else {
        // Video not ready — show processing screen
        loadingOverlay.classList.remove('visible');
        var statusLabel = videoStatus === 'processing' ? 'Encoding your video...' :
                          videoStatus === 'uploading' ? 'Uploading...' :
                          videoStatus === 'error' ? 'Processing failed' : 'Preparing video...';
        var statusIcon = videoStatus === 'error' ? '&#9888;' : '';
        var title = (data.video || {}).title || 'Video';
        container.innerHTML =
          '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;text-align:center;padding:24px;font-family:system-ui,-apple-system,sans-serif">' +
            (videoStatus !== 'error' ?
              '<div style="width:48px;height:48px;border:3px solid rgba(255,255,255,.15);border-top-color:#fff;border-radius:50%;animation:vpSpin 1s linear infinite;margin-bottom:20px"></div>' :
              '<div style="font-size:42px;margin-bottom:16px">' + statusIcon + '</div>') +
            '<div style="font-size:16px;font-weight:700;margin-bottom:6px">' + statusLabel + '</div>' +
            '<div style="font-size:13px;color:rgba(255,255,255,.6);margin-bottom:16px;max-width:320px;word-break:break-word">' + title + '</div>' +
            (videoStatus !== 'error' ?
              '<div style="font-size:11px;color:rgba(255,255,255,.4)">This page will auto-refresh when the video is ready</div>' :
              '<div style="font-size:11px;color:#ff6b6b">Please contact the admin or try again later</div>') +
          '</div>' +
          '<style>@keyframes vpSpin{to{transform:rotate(360deg)}}</style>';
        // Auto-poll for ready status every 8 seconds, capped at ~30 minutes
        // total (225 attempts). Protects against a silently-tabbed-open
        // page from hammering the API forever for videos that never
        // transition to ready (encoding failure that never updated status).
        if (videoStatus !== 'error') {
          var pollAttempts = 0;
          var pollMax = 225;
          var pollId = setInterval(function() {
            if (++pollAttempts > pollMax) { clearInterval(pollId); return; }
            fetch('/api/player/' + videoId)
              .then(function(r) { return r.json(); })
              .then(function(d) {
                if ((d.video || {}).status === 'ready') {
                  clearInterval(pollId);
                  container.innerHTML = '';
                  container.appendChild(el('div', 'player-loading visible', { innerHTML: '<div class="spinner"></div>' }));
                  setupPlayer(d);
                }
              })
              .catch(function() {});
          }, 8000);
        }
      }
    })
    .catch(function (err) {
      loadingOverlay.classList.remove('visible');
      container.innerHTML = '<div class="player-error"><div class="error-icon">&#9888;</div><div class="error-message">' +
        (err.message || 'Failed to load video') + '</div></div>';
    });

  function setupPlayer(data) {
    /* ── Flatten nested API response ── */
    var videoData = data.video || {};
    var embedData = data.embed_settings || {};
    data.hls_url     = videoData.hls_url;
    data.player_color = embedData.player_color;
    data.logo_url    = embedData.logo_url;
    data.autoplay    = embedData.autoplay;
    data.controls    = embedData.controls;
    data.loop        = embedData.loop;

    /* ── Apply Theme Color ── */
    var themeColor = data.player_color || '#ff4444';
    container.style.setProperty('--player-color', themeColor);

    /* ── Ad System ── */
    var adConfig = data.ads || {};
    var vastConfig = adConfig.vast || {};
    var popupConfig = adConfig.popup || {};
    var adEntries = vastConfig.entries || [];
    var adPlaying = false;
    var prerollsPlayed = false;
    var midrollsFired = {};
    var postrollsPlayed = false;
    var popupFiredThisSession = false;

    /* ── Create Video Element ── */
    var videoAttrs = { playsinline: '', 'webkit-playsinline': '' };
    // Poster image — shown instantly before playback starts. Keeps the player
    // from flashing black and gives the viewer a visual preview.
    var posterUrl = videoData.thumbnail_url || data.thumbnail_url;
    if (posterUrl) videoAttrs.poster = posterUrl;
    video = el('video', '', videoAttrs);
    container.insertBefore(video, loadingOverlay);

    // Demo poster fallback — if the real thumbnail is missing or broken (HTTP
    // error, wrong content-type), swap in a gradient placeholder generated
    // via canvas so the player never shows a black screen before playback.
    function makeDemoPoster(title) {
      try {
        var c = document.createElement('canvas');
        c.width = 1280; c.height = 720;
        var ctx = c.getContext('2d');
        var g = ctx.createLinearGradient(0, 0, c.width, c.height);
        g.addColorStop(0, '#1a1a2e'); g.addColorStop(0.5, '#16213e'); g.addColorStop(1, '#0f3460');
        ctx.fillStyle = g; ctx.fillRect(0, 0, c.width, c.height);
        // Play-triangle watermark
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        var cx = c.width/2, cy = c.height/2, s = 70;
        ctx.moveTo(cx - s*0.4, cy - s); ctx.lineTo(cx - s*0.4, cy + s); ctx.lineTo(cx + s, cy); ctx.closePath();
        ctx.fill();
        if (title) {
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.font = '600 28px system-ui, -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(title, cx, cy + s + 60);
        }
        return c.toDataURL('image/jpeg', 0.85);
      } catch (_) { return ''; }
    }
    (function applyPoster() {
      function useDemo() {
        var d = makeDemoPoster(videoData.title || '');
        if (d) video.setAttribute('poster', d);
      }
      if (!posterUrl) { useDemo(); return; }
      // Probe the real poster — swap to demo if it either fails to load or
      // decodes to a suspiciously tiny size (e.g. the CDN returns TS bytes
      // for a missing thumbnail.png, which decodes to a 1×1 phantom image).
      var probe = new Image();
      probe.onload = function () {
        if (probe.naturalWidth < 20 || probe.naturalHeight < 20) useDemo();
      };
      probe.onerror = useDemo;
      probe.src = posterUrl;
    })();

    /* ── Player Title Overlay ── */
    if (embedData.player_title) {
      var titleOverlay = el('div', 'player-title-overlay');
      titleOverlay.textContent = embedData.player_title;
      container.appendChild(titleOverlay);
    }

    /* ── Watermark / Logo ── */
    if (embedData.logo_url) {
      var watermark = el('div', 'player-watermark');

      // Position class
      var pos = (embedData.watermark_position || 'top-right').replace('-', ' ');
      watermark.setAttribute('data-pos', embedData.watermark_position || 'top-right');

      // Size class
      var sizeClass = 'watermark-' + (embedData.logo_size || 'medium');
      watermark.classList.add(sizeClass);

      // Opacity
      var opacity = (embedData.logo_opacity !== undefined && embedData.logo_opacity !== null)
        ? parseFloat(embedData.logo_opacity) : 0.75;
      watermark.style.opacity = opacity;

      var logoImg = el('img');
      logoImg.src  = embedData.logo_url;
      logoImg.alt  = '';
      logoImg.draggable = false;

      if (embedData.logo_link) {
        var logoAnchor = document.createElement('a');
        logoAnchor.href   = embedData.logo_link;
        logoAnchor.target = '_blank';
        logoAnchor.rel    = 'noopener noreferrer';
        logoAnchor.style.cssText = 'display:block;pointer-events:auto;line-height:0';
        logoAnchor.appendChild(logoImg);
        watermark.appendChild(logoAnchor);
        watermark.style.pointerEvents = 'auto';
      } else {
        watermark.appendChild(logoImg);
      }

      container.appendChild(watermark);
    }

    /* ── Subtitles Display ── */
    var subtitlesDiv = el('div', 'player-subtitles');
    container.appendChild(subtitlesDiv);
    var subtitlesEnabled = false;
    var subtitleTracks = [];

    /* ── Big Play Button (visible only when paused) ── */
    var bigPlay = el('div', 'player-big-play', { innerHTML: Icons.playSolid });
    container.appendChild(bigPlay);

    /* ── Build Controls ── */
    var controls = el('div', 'player-controls');

    // Progress bar
    var progress = el('div', 'player-progress');
    var progressBuffered = el('div', 'progress-buffered');
    var progressPlayed = el('div', 'progress-played');
    var progressHandle = el('div', 'progress-handle');
    // Chapter markers layer — thin vertical ticks at chapter timestamps.
    // Populated by buildChapterMarkers() once the video's duration is known.
    var chapterMarkers = el('div', 'progress-chapter-markers');
    // Scrub-preview tooltip — sprite image + time label, shown on hover
    var scrubPreview = el('div', 'player-scrub-preview');
    var scrubThumb = el('div', 'scrub-preview-thumb');
    var scrubTime = el('div', 'scrub-preview-time');
    scrubPreview.appendChild(scrubThumb);
    scrubPreview.appendChild(scrubTime);
    progress.appendChild(progressBuffered);
    progress.appendChild(progressPlayed);
    progress.appendChild(chapterMarkers);
    progress.appendChild(progressHandle);
    progress.appendChild(scrubPreview);
    controls.appendChild(progress);

    // Controls row — left cluster (playback) + right cluster (utility)
    var row = el('div', 'player-controls-row');
    var leftCluster = el('div', 'player-cluster player-cluster-left');
    var rightCluster = el('div', 'player-cluster player-cluster-right');
    row.appendChild(leftCluster);
    row.appendChild(rightCluster);

    // LEFT cluster: skip-back-10 · play · skip-fwd-10 · time
    var btnBack10 = el('button', 'player-btn player-btn-skip', { innerHTML: Icons.back10, title: 'Back 10s (J)' });
    leftCluster.appendChild(btnBack10);

    var btnPlay = el('button', 'player-btn player-btn-play', { innerHTML: Icons.play, title: 'Play (Space)' });
    leftCluster.appendChild(btnPlay);

    var btnFwd10 = el('button', 'player-btn player-btn-skip', { innerHTML: Icons.fwd10, title: 'Forward 10s (L)' });
    leftCluster.appendChild(btnFwd10);

    var timeDisplay = el('span', 'player-time', { textContent: '0:00 / 0:00' });
    leftCluster.appendChild(timeDisplay);

    // RIGHT cluster — start with volume
    var volumeWrap = el('div', 'player-volume');
    var btnVolume = el('button', 'player-btn player-btn-volume', { innerHTML: Icons.volumeHigh, title: 'Mute (M)' });
    var volumeSliderWrap = el('div', 'player-volume-slider');
    var volumeSlider = el('input', '', { type: 'range', min: '0', max: '1', step: '0.05', value: '1' });
    volumeSliderWrap.appendChild(volumeSlider);
    volumeWrap.appendChild(btnVolume);
    volumeWrap.appendChild(volumeSliderWrap);
    rightCluster.appendChild(volumeWrap);

    // Subtitles/Captions menu (conditionally added later)
    var captionsWrap = el('div', 'player-menu-wrapper');
    var btnSubtitles = el('button', 'player-btn player-btn-subtitles', { innerHTML: Icons.subtitles, title: 'Subtitles' });
    var captionsMenu = el('div', 'player-menu player-captions-menu');
    captionsWrap.appendChild(btnSubtitles);
    captionsWrap.appendChild(captionsMenu);
    rightCluster.appendChild(captionsWrap);

    // Settings menu — YouTube-style drill-down (main → speed / quality sub-view)
    var qualityWrap = el('div', 'player-menu-wrapper');
    var btnQuality = el('button', 'player-btn player-btn-quality', { innerHTML: Icons.settings, title: 'Settings' });
    var qualityMenu = el('div', 'player-menu player-settings-menu');

    // Main view: Quality first, then Speed
    var mainView = el('div', 'settings-view settings-view-main');
    var qualityRow = el('div', 'settings-row', { 'data-target': 'quality' });
    qualityRow.innerHTML =
      '<span class="settings-row-icon">' + Icons.sliders + '</span>' +
      '<span class="settings-row-label">Quality</span>' +
      '<span class="settings-row-value" data-value="quality">Auto</span>' +
      '<span class="settings-row-chevron">' + Icons.chevronRight + '</span>';
    var speedRow = el('div', 'settings-row', { 'data-target': 'speed' });
    speedRow.innerHTML =
      '<span class="settings-row-icon">' + Icons.speed + '</span>' +
      '<span class="settings-row-label">Speed</span>' +
      '<span class="settings-row-value" data-value="speed">Normal</span>' +
      '<span class="settings-row-chevron">' + Icons.chevronRight + '</span>';
    mainView.appendChild(qualityRow);
    mainView.appendChild(speedRow);
    qualityMenu.appendChild(mainView);

    // Sub-view: Quality (items rebuilt by buildQualityMenu) — placed first so
    // .settings-view-sub:nth-of-type(2) targets it and :nth-of-type(3) targets speed
    var qualityView = el('div', 'settings-view settings-view-sub');
    var qualityHeader = el('div', 'settings-sub-header');
    qualityHeader.innerHTML = '<span class="settings-back-icon">' + Icons.chevronLeft + '</span><span>Quality</span>';
    qualityView.appendChild(qualityHeader);
    qualityMenu.appendChild(qualityView);

    // Sub-view: Speed
    var speedView = el('div', 'settings-view settings-view-sub');
    var speedHeader = el('div', 'settings-sub-header');
    speedHeader.innerHTML = '<span class="settings-back-icon">' + Icons.chevronLeft + '</span><span>Speed</span>';
    speedView.appendChild(speedHeader);
    var speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    speeds.forEach(function (s) {
      var label = (s === 1) ? 'Normal' : (s + 'x');
      var item = el('div', 'player-menu-item settings-item' + (s === 1 ? ' active' : ''), { 'data-speed': String(s) });
      item.innerHTML =
        '<span class="settings-item-radio"></span>' +
        '<span class="settings-item-label">' + label + '</span>';
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        video.playbackRate = s;
        speedView.querySelectorAll('.player-menu-item').forEach(function (mi) { mi.classList.remove('active'); });
        item.classList.add('active');
        var valueEl = speedRow.querySelector('[data-value="speed"]');
        if (valueEl) valueEl.textContent = label;
        PlayerPrefs.setSpeed(s);
        showMainView();
        qualityMenu.classList.remove('open');
      });
      speedView.appendChild(item);
    });
    qualityMenu.appendChild(speedView);

    // Apply saved speed after the items are built. Update the menu UI now,
    // but defer setting `video.playbackRate` until the source is attached
    // (HLS.js resets it to 1.0 on source swap). `loadedmetadata` is the
    // first event after the source is ready and honors playbackRate.
    (function applySavedSpeed() {
      var savedSpeed = PlayerPrefs.getSpeed();
      if (savedSpeed === null || savedSpeed === 1) return;
      var match = speedView.querySelector('.player-menu-item[data-speed="' + savedSpeed + '"]');
      if (!match) return;
      speedView.querySelectorAll('.player-menu-item').forEach(function (mi) { mi.classList.remove('active'); });
      match.classList.add('active');
      var label = savedSpeed === 1 ? 'Normal' : (savedSpeed + 'x');
      var valueEl = speedRow.querySelector('[data-value="speed"]');
      if (valueEl) valueEl.textContent = label;
      // Set now (in case metadata already loaded) AND on loadedmetadata as
      // a safety net against HLS.js resetting the rate when it attaches.
      video.playbackRate = savedSpeed;
      video.addEventListener('loadedmetadata', function () {
        video.playbackRate = savedSpeed;
      }, { once: true });
    })();

    qualityWrap.appendChild(btnQuality);
    qualityWrap.appendChild(qualityMenu);
    rightCluster.appendChild(qualityWrap);

    // View switching within the settings menu
    function showMainView() {
      qualityMenu.classList.remove('show-speed', 'show-quality');
    }
    function showSubView(target) {
      qualityMenu.classList.remove('show-speed', 'show-quality');
      qualityMenu.classList.add('show-' + target);
      // Suppress sticky hover on the sub-view's back header: when the user
      // clicks a main-view row, the cursor lands exactly on the new header
      // and :hover fires immediately, making it look permanently selected.
      // Clear the flag the first time the cursor leaves (or on timeout).
      var header = (target === 'quality' ? qualityHeader : speedHeader);
      header.classList.add('_no-hover');
      var clear = function () {
        header.classList.remove('_no-hover');
        header.removeEventListener('mouseleave', clear);
        clearTimeout(t);
      };
      var t = setTimeout(clear, 1500);
      header.addEventListener('mouseleave', clear);
    }
    speedRow.addEventListener('click', function (e) { e.stopPropagation(); showSubView('speed'); });
    qualityRow.addEventListener('click', function (e) { e.stopPropagation(); showSubView('quality'); });
    speedHeader.addEventListener('click', function (e) { e.stopPropagation(); showMainView(); });
    qualityHeader.addEventListener('click', function (e) { e.stopPropagation(); showMainView(); });

    btnQuality.addEventListener('click', function (e) {
      e.stopPropagation();
      captionsMenu.classList.remove('open');
      audioMenu.classList.remove('open');
      if (typeof chaptersMenu !== 'undefined') chaptersMenu.classList.remove('open');
      // Always reopen to the main view
      showMainView();
      qualityMenu.classList.toggle('open');
    });

    // Audio track selector (populated by buildAudioMenu when HLS reports multiple tracks)
    var audioWrap = el('div', 'player-menu-wrapper');
    audioWrap.style.display = 'none'; // hidden until multiple tracks detected
    var btnAudio = el('button', 'player-btn', { innerHTML: Icons.audio, title: 'Audio Track' });
    var audioMenu = el('div', 'player-menu');
    var audioTitle = el('div', 'player-menu-title', { textContent: 'Audio' });
    audioMenu.appendChild(audioTitle);
    audioWrap.appendChild(btnAudio);
    audioWrap.appendChild(audioMenu);
    rightCluster.appendChild(audioWrap);

    btnAudio.addEventListener('click', function (e) {
      e.stopPropagation();
      captionsMenu.classList.remove('open');
      qualityMenu.classList.remove('open');
      if (typeof chaptersMenu !== 'undefined') chaptersMenu.classList.remove('open');
      audioMenu.classList.toggle('open');
    });

    // Chapters menu (populated by buildChapterMenu when chapters exist)
    var chaptersWrap = el('div', 'player-menu-wrapper');
    chaptersWrap.style.display = 'none';  // hidden until chapters loaded
    var btnChapters = el('button', 'player-btn', { innerHTML: Icons.chapters, title: 'Chapters' });
    var chaptersMenu = el('div', 'player-menu player-menu-wide');
    var chaptersTitle = el('div', 'player-menu-title', { textContent: 'Chapters' });
    chaptersMenu.appendChild(chaptersTitle);
    chaptersWrap.appendChild(btnChapters);
    chaptersWrap.appendChild(chaptersMenu);
    rightCluster.appendChild(chaptersWrap);

    btnChapters.addEventListener('click', function (e) {
      e.stopPropagation();
      captionsMenu.classList.remove('open');
      qualityMenu.classList.remove('open');
      audioMenu.classList.remove('open');
      chaptersMenu.classList.toggle('open');
    });

    // Sync button .active class with menu .open state — so the button shows
    // the selected (accent-filled) visual while its menu is displayed.
    function linkBtnToMenu(btn, menu) {
      new MutationObserver(function () {
        btn.classList.toggle('active', menu.classList.contains('open'));
      }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    }
    linkBtnToMenu(btnQuality, qualityMenu);
    linkBtnToMenu(btnAudio, audioMenu);
    linkBtnToMenu(btnChapters, chaptersMenu);

    // PiP
    var btnPip = el('button', 'player-btn player-btn-pip', { innerHTML: Icons.pip, title: 'Picture-in-Picture (P)' });
    rightCluster.appendChild(btnPip);

    // Fullscreen
    var btnFullscreen = el('button', 'player-btn player-btn-fullscreen', { innerHTML: Icons.fullscreen, title: 'Fullscreen (F)' });
    rightCluster.appendChild(btnFullscreen);

    // Click ripple — anchor a short-lived circle at the click point. Applies
    // to every control button via event delegation on the controls container.
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.player-btn');
      if (!btn) return;
      var rect = btn.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      var ripple = document.createElement('span');
      ripple.className = 'player-btn-ripple';
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = ((e.clientX || (rect.left + rect.width / 2)) - rect.left - size / 2) + 'px';
      ripple.style.top  = ((e.clientY || (rect.top + rect.height / 2)) - rect.top  - size / 2) + 'px';
      btn.appendChild(ripple);
      setTimeout(function () { if (ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 700);
    }, true);

    // Skip-back/forward handlers — J/L keyboard shortcuts wired in handlers section
    btnBack10.addEventListener('click', function (e) {
      e.stopPropagation();
      video.currentTime = Math.max(0, video.currentTime - 10);
    });
    btnFwd10.addEventListener('click', function (e) {
      e.stopPropagation();
      var dur = video.duration || 0;
      video.currentTime = dur ? Math.min(dur, video.currentTime + 10) : video.currentTime + 10;
    });

    controls.appendChild(row);
    container.appendChild(controls);

    /* ── VAST Ad Playback Engine ── */

    // Parse time string "HH:MM:SS.mmm" or number to seconds
    function parseTimeOffset(val) {
      if (!val || val === '0') return 0;
      if (typeof val === 'number') return val;
      var str = String(val);
      var parts = str.split(':');
      if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
      } else if (parts.length === 2) {
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
      }
      return parseFloat(str) || 0;
    }

    // Parse VAST XML to extract media file URL
    function parseVastXml(xmlText) {
      try {
        var parser = new DOMParser();
        var doc = parser.parseFromString(xmlText, 'text/xml');
        var mediaFiles = doc.querySelectorAll('MediaFile');
        var mediaUrl = null;
        for (var i = 0; i < mediaFiles.length; i++) {
          var mf = mediaFiles[i];
          var type = mf.getAttribute('type') || '';
          var url = mf.textContent.trim();
          if (type.indexOf('video/mp4') !== -1 || type.indexOf('video/webm') !== -1) {
            mediaUrl = url;
            break;
          }
          if (!mediaUrl && url) mediaUrl = url;
        }
        var impression = doc.querySelector('Impression');
        var clickThrough = doc.querySelector('ClickThrough');
        return {
          mediaUrl: mediaUrl,
          impressionUrl: impression ? impression.textContent.trim() : null,
          clickUrl: clickThrough ? clickThrough.textContent.trim() : null,
        };
      } catch (e) {
        return { mediaUrl: null, impressionUrl: null, clickUrl: null };
      }
    }

    // Fire impression beacon
    function fireBeacon(url) {
      if (!url) return;
      try {
        var img = new Image();
        img.src = url;
      } catch (e) {}
    }

    // Play a single VAST ad, returns a promise that resolves when done
    function playVastAd(entry) {
      return new Promise(function (resolve) {
        var vastUrl = entry.vast_url;
        var skipOffset = entry.skip_offset || 0;

        if (!vastUrl) { resolve(); return; }

        // Fetch VAST XML
        fetch(vastUrl)
          .then(function (res) { return res.text(); })
          .then(function (xmlText) {
            var parsed = parseVastXml(xmlText);
            if (!parsed.mediaUrl) { resolve(); return; }

            adPlaying = true;

            // Create ad overlay
            var adOverlay = el('div', 'ad-overlay');
            var adVideo = el('video', 'ad-video', { playsinline: '', 'webkit-playsinline': '' });
            adVideo.src = parsed.mediaUrl;

            var adBadge = el('div', 'ad-badge', { textContent: 'Ad' });
            var adSkipBtn = el('div', 'ad-skip-btn');
            var adSkipCountdown = skipOffset;

            if (skipOffset > 0) {
              adSkipBtn.textContent = 'Skip in ' + skipOffset + 's';
              adSkipBtn.className = 'ad-skip-btn disabled';
            } else {
              adSkipBtn.textContent = 'Skip Ad';
              adSkipBtn.className = 'ad-skip-btn';
            }

            // Click-through overlay
            if (parsed.clickUrl) {
              var clickOverlay = el('div', 'ad-click-overlay');
              clickOverlay.addEventListener('click', function () {
                window.open(parsed.clickUrl, '_blank');
              });
              adOverlay.appendChild(clickOverlay);
            }

            adOverlay.appendChild(adVideo);
            adOverlay.appendChild(adBadge);
            adOverlay.appendChild(adSkipBtn);
            container.appendChild(adOverlay);

            // Hide main controls and big play
            controls.style.display = 'none';
            bigPlay.style.display = 'none';

            // Fire impression
            fireBeacon(parsed.impressionUrl);
            sendEvent('vast_ad_impression');

            // Skip countdown timer
            var skipTimer = null;
            if (skipOffset > 0) {
              skipTimer = setInterval(function () {
                adSkipCountdown--;
                if (adSkipCountdown <= 0) {
                  clearInterval(skipTimer);
                  adSkipBtn.textContent = 'Skip Ad';
                  adSkipBtn.classList.remove('disabled');
                } else {
                  adSkipBtn.textContent = 'Skip in ' + adSkipCountdown + 's';
                }
              }, 1000);
            }

            function cleanupAd() {
              if (skipTimer) clearInterval(skipTimer);
              adPlaying = false;
              try { adVideo.pause(); } catch (e) {}
              if (adOverlay.parentNode) container.removeChild(adOverlay);
              controls.style.display = '';
              bigPlay.style.display = '';
              resolve();
            }

            adSkipBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              if (!adSkipBtn.classList.contains('disabled')) {
                cleanupAd();
              }
            });

            adVideo.addEventListener('ended', cleanupAd);
            adVideo.addEventListener('error', cleanupAd);

            adVideo.play().catch(function () {
              cleanupAd();
            });
          })
          .catch(function () {
            resolve();
          });
      });
    }

    // Play a sequence of ads
    function playAdSequence(entries) {
      if (!entries || entries.length === 0) return Promise.resolve();
      var chain = Promise.resolve();
      entries.forEach(function (entry) {
        chain = chain.then(function () { return playVastAd(entry); });
      });
      return chain;
    }

    // Get entries by offset type
    function getAdsByType(type) {
      return adEntries.filter(function (e) { return e.offset_type === type; });
    }

    /* ── Popup Ad Handler ── */
    function tryPopupAd() {
      if (!popupConfig.enabled || !popupConfig.popup_url || popupFiredThisSession) return;

      var limit = popupConfig.popup_limit || 0;
      if (limit > 0) {
        var today = new Date().toISOString().slice(0, 10);
        var storageKey = 'popup_count_' + today;
        var count = parseInt(localStorage.getItem(storageKey) || '0', 10);
        if (count >= limit) return;
        localStorage.setItem(storageKey, String(count + 1));
      }

      popupFiredThisSession = true;
      var url = popupConfig.popup_url;
      if (url.indexOf('//') === 0) url = window.location.protocol + url;
      window.open(url, '_blank');
      sendEvent('popup_ad');
    }

    /* ── Initialize HLS ── */
    var hlsUrl = data.hls_url;

    if (Hls.isSupported()) {
      // AES-128 HLS encryption — attach the key token as a Bearer header on
      // every request whose URL points at the key endpoint. xhrSetup fires
      // for ALL loader requests (manifests, segments, keys), so we match on
      // the URL path to avoid sending the token to the CDN.
      var encryptionMeta = data.encryption || {};
      var hlsConfig = {
        enableWorker: true,
        lowLatencyMode: false
      };
      if (encryptionMeta.enabled && encryptionMeta.key_token) {
        hlsConfig.xhrSetup = function (xhr, url) {
          if (url && url.indexOf('/api/video-keys/') !== -1) {
            xhr.setRequestHeader('Authorization', 'Bearer ' + encryptionMeta.key_token);
          }
        };
      }
      hls = new Hls(hlsConfig);
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, function () {
        loadingOverlay.classList.remove('visible');
        buildQualityMenu();
        // Load saved progress and show resume banner if applicable
        loadProgress(function (prog) {
          savedPosition = prog.position || 0;
          var dur = video.duration || 0;
          // Show resume banner if: position > 5s, not completed, not near end
          var nearEnd = dur > 0 && savedPosition >= dur - 10;
          if (savedPosition > 5 && !prog.completed && !nearEnd) {
            showResumeBanner(savedPosition);
          }
          if (data.autoplay) {
            video.muted = true;
            video.play().catch(function () {});
          }
        });
      });

      // Keep the Auto-label + settings-row value in sync as HLS switches
      // bitrates. Only runs while the user's choice is Auto (-1); manual
      // selections set their own label at click time.
      hls.on(Hls.Events.LEVEL_SWITCHED, function (_e, evt) {
        if (hls.autoLevelEnabled) refreshAutoLabel(evt.level);
      });

      function refreshAutoLabel(levelIdx) {
        var lvl = hls && hls.levels && hls.levels[levelIdx];
        if (!lvl || !lvl.height) return;
        var newLabel = 'Auto (' + qualityLabel(lvl.height) + ')';
        var autoItem = qualityView.querySelector('.settings-item[data-level="-1"]');
        if (autoItem) {
          var lbl = autoItem.querySelector('.settings-item-label');
          if (lbl) lbl.textContent = newLabel;
        }
        var rowValue = qualityRow.querySelector('[data-value="quality"]');
        if (rowValue && autoItem && autoItem.classList.contains('active')) {
          rowValue.textContent = newLabel;
        }
      }

      // Multi-codec audio: when the master playlist declares #EXT-X-MEDIA
      // audio renditions, HLS.js reports them via AUDIO_TRACKS_UPDATED.
      // We only show the audio selector if there are 2+ tracks (stereo + surround).
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function (event, eventData) {
        var tracks = eventData.audioTracks || [];
        if (tracks.length > 1) {
          buildAudioMenu(tracks);
        }
      });

      hls.on(Hls.Events.ERROR, function (event, errorData) {
        if (errorData.fatal) {
          switch (errorData.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              showError('An error occurred during playback.');
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari).
      //
      // Safari can't attach custom headers to key requests, so we pass the
      // AES key token as `?aes_token=<JWT>` on the manifest URL. The CDN
      // route rewrites `#EXT-X-KEY:...URI="..."` to embed the token as
      // `?token=<JWT>` on the key URI. Safari then fetches the key with
      // that query param, and the key endpoint validates it via its
      // existing `?token=` fallback.
      var safariUrl = hlsUrl;
      var encMeta = data.encryption || {};
      if (encMeta.enabled && encMeta.key_token) {
        var sep = safariUrl.indexOf('?') === -1 ? '?' : '&';
        safariUrl = safariUrl + sep + 'aes_token=' + encodeURIComponent(encMeta.key_token);
      }
      video.src = safariUrl;
      video.addEventListener('loadedmetadata', function () {
        loadingOverlay.classList.remove('visible');
        loadProgress(function (prog) {
          savedPosition = prog.position || 0;
          var dur = video.duration || 0;
          var nearEnd = dur > 0 && savedPosition >= dur - 10;
          if (savedPosition > 5 && !prog.completed && !nearEnd) {
            showResumeBanner(savedPosition);
          }
          if (data.autoplay) {
            video.muted = true;
            video.play().catch(function () {});
          }
        });
      });
    } else {
      showError('Your browser does not support HLS video playback.');
      return;
    }

    /* ── Debug Stats Overlay (?debug=1) ── */
    (function setupDebugOverlay() {
      var qs = window.location.search || '';
      var debugOn = /[?&]debug=1(?:&|$)/.test(qs);
      if (!debugOn) return;

      var overlay = el('div', 'vp-debug-overlay');
      overlay.innerHTML =
        '<div class="vp-debug-title">Playback Stats' +
          '<span class="vp-debug-close" aria-label="Close debug">&times;</span>' +
        '</div>' +
        '<div class="vp-debug-body"></div>';
      container.appendChild(overlay);
      var body = overlay.querySelector('.vp-debug-body');

      overlay.querySelector('.vp-debug-close').addEventListener('click', function (e) {
        e.stopPropagation();
        overlay.remove();
        if (updateTimer) clearInterval(updateTimer);
      });
      // Stop clicks/drags inside the overlay from toggling play/pause
      overlay.addEventListener('click', function (e) { e.stopPropagation(); });

      // Track last loaded segment (Hls.js only — Safari doesn't expose this)
      var lastSegment = '';
      var bufferStalls = 0;
      if (hls) {
        hls.on(Hls.Events.FRAG_LOADED, function (_e, eventData) {
          try {
            var url = eventData && eventData.frag && eventData.frag.url;
            if (url) {
              var name = url.split('/').pop().split('?')[0];
              lastSegment = name || '';
            }
          } catch (_) {}
        });
        hls.on(Hls.Events.ERROR, function (_e, errData) {
          if (errData && errData.details === 'bufferStalledError') bufferStalls++;
        });
      }

      function escHtml(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;')
          .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }
      function row(k, v) {
        var safeK = escHtml(k);
        var safeV = escHtml(v);
        return '<div class="vp-debug-row"><span class="vp-debug-key">' + safeK +
               '</span><span class="vp-debug-val" title="' + safeV + '">' + safeV + '</span></div>';
      }
      // Hls.js reports bandwidthEstimate and level.bitrate in BITS per second.
      function fmtBitrate(bps) {
        if (!bps || !isFinite(bps)) return '—';
        return bps >= 1000000 ? (bps / 1000000).toFixed(2) + ' Mbps' :
                                Math.round(bps / 1000) + ' kbps';
      }
      function bufferAhead() {
        try {
          if (!video.buffered || video.buffered.length === 0) return 0;
          var t = video.currentTime;
          for (var i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= t && video.buffered.end(i) >= t) {
              return Math.max(0, video.buffered.end(i) - t);
            }
          }
          return 0;
        } catch (_) { return 0; }
      }
      function playbackQuality() {
        if (typeof video.getVideoPlaybackQuality === 'function') {
          var q = video.getVideoPlaybackQuality();
          return { dropped: q.droppedVideoFrames || 0, total: q.totalVideoFrames || 0 };
        }
        return {
          dropped: video.webkitDroppedFrameCount || 0,
          total: video.webkitDecodedFrameCount || 0
        };
      }

      function render() {
        var parts = [];
        parts.push(row('Video', videoId || '—'));

        // Status
        var status = video.paused ? 'Paused' :
                     video.ended  ? 'Ended'  :
                     video.readyState < 3 ? 'Buffering' : 'Playing';
        parts.push(row('Status', status));

        // Current level / bitrate
        if (hls && hls.levels && hls.levels.length) {
          var levelIdx = hls.currentLevel;
          var auto = (levelIdx === -1);
          var effective = auto ? hls.loadLevel : levelIdx;
          var lvl = hls.levels[effective];
          if (lvl) {
            var q = (lvl.height ? lvl.height + 'p' : Math.round(lvl.bitrate / 1000) + 'k')
                    + (auto ? ' (auto)' : '');
            parts.push(row('Quality', q));
            parts.push(row('Level bitrate', fmtBitrate(lvl.bitrate)));
            if (lvl.frameRate) parts.push(row('Frame rate', (+lvl.frameRate).toFixed(2) + ' fps'));
            if (lvl.videoCodec || lvl.audioCodec) {
              parts.push(row('Codec', (lvl.videoCodec || '—') + ' / ' + (lvl.audioCodec || '—')));
            }
          }
          if (hls.bandwidthEstimate) parts.push(row('Bandwidth', fmtBitrate(hls.bandwidthEstimate)));
        } else {
          parts.push(row('Quality', 'Native HLS'));
        }

        // Resolution from <video>
        if (video.videoWidth && video.videoHeight) {
          parts.push(row('Resolution', video.videoWidth + '×' + video.videoHeight));
        }

        parts.push(row('Buffer', bufferAhead().toFixed(1) + 's ahead'));

        var pq = playbackQuality();
        if (pq.total > 0) {
          var pct = pq.total > 0 ? (100 * pq.dropped / pq.total).toFixed(2) : '0.00';
          parts.push(row('Dropped frames', pq.dropped + ' / ' + pq.total + ' (' + pct + '%)'));
        }

        if (hls) {
          parts.push(row('Stalls', String(bufferStalls)));
          if (lastSegment) parts.push(row('Segment', lastSegment));
        }

        // Connection info (where available)
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn && (conn.effectiveType || conn.downlink)) {
          var line = (conn.effectiveType || '?');
          if (conn.downlink) line += ' / ' + conn.downlink + ' Mbps';
          parts.push(row('Network', line));
        }

        parts.push(row('Engine', hls ? ('hls.js ' + (window.Hls && Hls.version ? Hls.version : '')) : 'Safari native'));
        parts.push(row('Time', formatTime(video.currentTime) + ' / ' + formatTime(video.duration || 0)));

        body.innerHTML = parts.join('');
      }

      render();
      var updateTimer = setInterval(render, 500);

      // Keyboard shortcut: 'D' toggles collapse/expand
      window.addEventListener('keydown', function (e) {
        if (e.key !== 'd' && e.key !== 'D') return;
        if (!document.body.contains(overlay)) return;
        var tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        overlay.classList.toggle('collapsed');
      });
    })();

    /* ── Build Quality Menu ── */
    // Label conventions: 1440p → "2K", 2160p → "4K". HD applies to 720p+,
    // SD to 480p. 2K gets an HD badge, 4K gets a 4K badge (highest tier).
    function qualityLabel(height) {
      if (!height) return '';
      if (height >= 2160) return '4K';
      if (height >= 1440) return '2K';
      return height + 'p';
    }
    function qualityBadge(height) {
      if (!height) return '';
      if (height >= 2160) return '<span class="settings-item-badge badge-4k">4K</span>';
      if (height >= 1440) return '<span class="settings-item-badge badge-hd">HD</span>';
      if (height >= 720)  return '<span class="settings-item-badge badge-hd">HD</span>';
      if (height >= 480)  return '<span class="settings-item-badge badge-sd">SD</span>';
      return '';
    }

    function buildQualityMenu() {
      // Clear items AFTER the header (first child) — keep the "‹ Quality" header
      while (qualityView.children.length > 1) {
        qualityView.removeChild(qualityView.lastChild);
      }

      var valueEl = qualityRow.querySelector('[data-value="quality"]');

      // Collect real HLS levels, then inject synthetic 2K / 4K entries for
      // visual demonstration when the source ladder doesn't include them.
      var entries = [];
      if (hls && hls.levels) {
        hls.levels.forEach(function (level, idx) {
          entries.push({ level: level, idx: idx, demo: false });
        });
      }
      var heights = entries.map(function (e) { return e.level.height || 0; });
      if (heights.indexOf(1440) === -1) entries.push({ level: { height: 1440 }, idx: -2, demo: true });
      if (heights.indexOf(2160) === -1) entries.push({ level: { height: 2160 }, idx: -3, demo: true });

      // Sort highest → lowest (YouTube ordering: top resolution first, Auto last)
      entries.sort(function (a, b) {
        return (b.level.height || 0) - (a.level.height || 0);
      });

      var autoLabel = 'Auto';
      if (hls && hls.levels && hls.currentLevel >= 0 && hls.levels[hls.currentLevel]) {
        var lvl = hls.levels[hls.currentLevel];
        if (lvl.height) autoLabel = 'Auto (' + qualityLabel(lvl.height) + ')';
      }

      entries.forEach(function (entry) {
        var level = entry.level, idx = entry.idx;
        var label = qualityLabel(level.height) || Math.round(level.bitrate / 1000) + 'kbps';
        var badge = qualityBadge(level.height);
        var item = el('div', 'player-menu-item settings-item' + (entry.demo ? ' demo' : ''), { 'data-level': String(idx) });
        item.innerHTML =
          '<span class="settings-item-radio"></span>' +
          '<span class="settings-item-label">' + label + '</span>' +
          badge;
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          if (!entry.demo && hls) hls.currentLevel = idx;
          qualityView.querySelectorAll('.player-menu-item').forEach(function (mi) { mi.classList.remove('active'); });
          item.classList.add('active');
          if (valueEl) valueEl.textContent = label;
          PlayerPrefs.setQuality(label);
          showMainView();
          qualityMenu.classList.remove('open');
        });
        qualityView.appendChild(item);
      });

      // Auto sits at the BOTTOM, matching YouTube's ordering
      var autoItem = el('div', 'player-menu-item settings-item active', { 'data-level': '-1' });
      autoItem.innerHTML =
        '<span class="settings-item-radio"></span>' +
        '<span class="settings-item-label">' + autoLabel + '</span>';
      autoItem.addEventListener('click', function (e) {
        e.stopPropagation();
        if (hls) hls.currentLevel = -1;
        qualityView.querySelectorAll('.player-menu-item').forEach(function (mi) { mi.classList.remove('active'); });
        autoItem.classList.add('active');
        if (valueEl) valueEl.textContent = autoLabel;
        PlayerPrefs.setQuality('auto');
        showMainView();
        qualityMenu.classList.remove('open');
      });
      qualityView.appendChild(autoItem);

      if (valueEl) valueEl.textContent = autoLabel;

      // Apply the saved quality preference — match by label ('720p', '1080p',
      // '2K', '4K') so the preference survives different encode ladders.
      // 'auto' (or unset) leaves HLS in ABR mode.
      var savedQ = PlayerPrefs.getQuality();
      if (savedQ && savedQ !== 'auto' && hls && hls.levels) {
        var matchEntry = entries.find(function (en) {
          return !en.demo && qualityLabel(en.level.height) === savedQ;
        });
        if (matchEntry) {
          hls.currentLevel = matchEntry.idx;
          var matchItem = qualityView.querySelector('.player-menu-item[data-level="' + matchEntry.idx + '"]');
          if (matchItem) {
            qualityView.querySelectorAll('.player-menu-item').forEach(function (mi) { mi.classList.remove('active'); });
            matchItem.classList.add('active');
            if (valueEl) valueEl.textContent = savedQ;
          }
        }
      }
    }

    /* ── Build Audio Track Menu ── */
    function buildAudioMenu(tracks) {
      // Clear existing items except title
      while (audioMenu.children.length > 1) {
        audioMenu.removeChild(audioMenu.lastChild);
      }

      if (!tracks || tracks.length <= 1) {
        audioWrap.style.display = 'none';
        return;
      }

      audioWrap.style.display = '';
      tracks.forEach(function (track, idx) {
        var label = track.name || ('Track ' + (idx + 1));
        var item = el('div', 'player-menu-item' + (idx === hls.audioTrack ? ' active' : ''), { textContent: label });
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          hls.audioTrack = idx;
          audioMenu.querySelectorAll('.player-menu-item').forEach(function (mi) { mi.classList.remove('active'); });
          item.classList.add('active');
          audioMenu.classList.remove('open');
        });
        audioMenu.appendChild(item);
      });
    }

    /* ── Chapters ── */
    // Parse "mm:ss" or "hh:mm:ss" into seconds. Safe against bad input
    // (returns 0 if malformed — marker just doesn't appear).
    function chapterTimeToSec(t) {
      if (typeof t !== 'string') return 0;
      var parts = t.trim().split(':').map(function (n) { return parseInt(n, 10) || 0; });
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      return 0;
    }

    function buildChapterMarkers(chapters, duration) {
      chapterMarkers.innerHTML = '';
      // Skip markers when duration is unknown or too short to be useful.
      if (!duration || duration < 10 || !chapters || chapters.length === 0) return;
      chapters.forEach(function (c) {
        var sec = chapterTimeToSec(c.time);
        if (sec <= 0 || sec >= duration) return;   // out of range → skip
        var marker = el('div', 'progress-chapter-marker');
        marker.style.left = (sec / duration * 100) + '%';
        marker.title = c.title;
        chapterMarkers.appendChild(marker);
      });
    }

    function buildChapterMenu(chapters) {
      // Clear existing items except the title
      while (chaptersMenu.children.length > 1) {
        chaptersMenu.removeChild(chaptersMenu.lastChild);
      }
      if (!chapters || chapters.length === 0) {
        chaptersWrap.style.display = 'none';
        return;
      }
      chaptersWrap.style.display = '';
      chapters.forEach(function (c) {
        var item = el('div', 'player-menu-item');
        var timeSpan = el('span', 'player-menu-time', { textContent: c.time });
        var titleSpan = el('span', 'player-menu-label', { textContent: c.title });
        item.appendChild(timeSpan);
        item.appendChild(titleSpan);
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          var sec = chapterTimeToSec(c.time);
          if (sec > 0 && video.duration && sec < video.duration) {
            video.currentTime = sec;
          }
          chaptersMenu.classList.remove('open');
        });
        chaptersMenu.appendChild(item);
      });
    }

    // Build chapter UI once we have both chapters data AND a duration.
    // Duration may not be known at load time (HLS metadata arrives async).
    var _pendingChapters = Array.isArray(data.chapters) ? data.chapters : [];
    if (_pendingChapters.length) {
      buildChapterMenu(_pendingChapters);
    }
    video.addEventListener('loadedmetadata', function () {
      if (_pendingChapters.length) buildChapterMarkers(_pendingChapters, video.duration);
    });
    // Also rebuild if duration is already known (covers cache/fast-load cases)
    if (video.readyState >= 1 && video.duration && _pendingChapters.length) {
      buildChapterMarkers(_pendingChapters, video.duration);
    }

    /* ── Subtitles / Captions Menu ── */
    var activeSubtitleIndex = -1;
    // Hoisted reference so keyboard shortcut (C key) can call selectCaption
    // even though the function is defined inside a conditional block below.
    var selectCaption = null;

    // Demo subtitles — injected when the video has no real captions, so the
    // CC button and menu are visible for UI demonstration. Uses in-memory
    // Blob URLs so no server file is needed.
    if (!data.subtitles || data.subtitles.length === 0) {
      var _makeDemoVtt = function (lines) {
        var parts = ['WEBVTT', ''];
        lines.forEach(function (text, i) {
          var startS = i * 4, endS = startS + 3.5;
          var fmt = function (s) {
            var m = Math.floor(s / 60), sec = (s - m * 60);
            return (m < 10 ? '0' + m : m) + ':' + (sec < 10 ? '0' : '') + sec.toFixed(3);
          };
          parts.push('00:' + fmt(startS) + ' --> 00:' + fmt(endS));
          parts.push(text);
          parts.push('');
        });
        return URL.createObjectURL(new Blob([parts.join('\n')], { type: 'text/vtt' }));
      };
      data.subtitles = [
        { url: _makeDemoVtt([
            'Welcome to the demo video.',
            'This caption is for UI preview only.',
            'Try switching between languages.',
            'Press C to toggle captions.',
            'Adjust speed and quality from the gear icon.'
          ]), language: 'en', label: 'English' },
        { url: _makeDemoVtt([
            'Bienvenido al video de demostración.',
            'Este subtítulo es solo para vista previa.',
            'Prueba cambiar de idioma.',
            'Presiona C para activar subtítulos.',
            'Ajusta velocidad y calidad desde el engranaje.'
          ]), language: 'es', label: 'Español' },
        { url: _makeDemoVtt([
            'डेमो वीडियो में आपका स्वागत है।',
            'यह कैप्शन केवल UI पूर्वावलोकन के लिए है।',
            'भाषाओं के बीच स्विच करके देखें।',
            'कैप्शन टॉगल करने के लिए C दबाएँ।',
            'गियर आइकन से गुणवत्ता और गति बदलें।'
          ]), language: 'hi', label: 'हिन्दी' },
        { url: _makeDemoVtt([
            'Bienvenue dans la vidéo de démonstration.',
            'Ce sous-titre est uniquement pour aperçu.',
            'Essayez de changer de langue.',
            'Appuyez sur C pour activer les sous-titres.',
            'Ajustez la vitesse et la qualité via le rouage.'
          ]), language: 'fr', label: 'Français' }
      ];
    }

    if (data.subtitles && data.subtitles.length > 0) {
      // captionsWrap is already appended to rightCluster earlier; nothing to move.

      // Add track elements to video
      data.subtitles.forEach(function (sub, idx) {
        var track = el('track', '', {
          kind: 'subtitles',
          src: sub.url,
          srclang: sub.language || 'en',
          label: sub.label || 'Subtitles'
        });
        video.appendChild(track);
        subtitleTracks.push(video.textTracks[idx]);
      });

      // Disable all tracks initially
      for (var i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
      }

      // Persistent cuechange handler — use textContent to avoid XSS via cue
      // payloads (VTT allows tags like <i>, <b>, but an untrusted .vtt could
      // inject <script> / <img onerror>). Safer to render plain text.
      function onCueChange() {
        if (activeSubtitleIndex < 0) { subtitlesDiv.textContent = ''; return; }
        var track = video.textTracks[activeSubtitleIndex];
        if (track && track.activeCues && track.activeCues.length > 0) {
          var span = document.createElement('span');
          span.textContent = track.activeCues[0].text;
          subtitlesDiv.textContent = '';
          subtitlesDiv.appendChild(span);
        } else {
          subtitlesDiv.textContent = '';
        }
      }

      // Build captions menu
      function buildCaptionsMenu() {
        captionsMenu.innerHTML = '';

        // Header
        var header = el('div', 'player-captions-header');
        header.innerHTML = '<span class="captions-back-arrow">&#8249;</span> Captions';
        header.addEventListener('click', function (e) {
          e.stopPropagation();
          captionsMenu.classList.remove('open');
        });
        captionsMenu.appendChild(header);

        // "Disabled" option
        var disabledItem = el('div', 'player-captions-item active', { 'data-index': '-1' });
        disabledItem.innerHTML = '<span class="captions-radio"></span><span class="captions-label">Disabled</span>';
        disabledItem.addEventListener('click', function (e) {
          e.stopPropagation();
          selectCaption(-1);
        });
        captionsMenu.appendChild(disabledItem);

        // Language items
        data.subtitles.forEach(function (sub, idx) {
          var item = el('div', 'player-captions-item', { 'data-index': String(idx) });
          var langCode = (sub.language || 'en').toUpperCase();
          var label = sub.label || 'Subtitles';
          item.innerHTML = '<span class="captions-radio"></span>' +
            '<span class="captions-label">' + label + '</span>' +
            '<span class="captions-lang-badge">' + langCode + '</span>';
          item.addEventListener('click', function (e) {
            e.stopPropagation();
            selectCaption(idx);
          });
          captionsMenu.appendChild(item);
        });
      }

      // Select a caption track — assigned to the outer `selectCaption` var
      // so the C-key shortcut can invoke it.
      selectCaption = function selectCaption(index) {
        activeSubtitleIndex = index;
        subtitlesEnabled = index >= 0;
        btnSubtitles.classList.toggle('active', subtitlesEnabled);

        // Disable all tracks and remove listeners
        for (var j = 0; j < video.textTracks.length; j++) {
          video.textTracks[j].removeEventListener('cuechange', onCueChange);
          video.textTracks[j].mode = 'disabled';
        }
        subtitlesDiv.textContent = '';

        // Enable selected track
        if (index >= 0 && video.textTracks[index]) {
          video.textTracks[index].mode = 'hidden';
          video.textTracks[index].addEventListener('cuechange', onCueChange);
        }

        // Update active state in menu
        captionsMenu.querySelectorAll('.player-captions-item').forEach(function (mi) {
          mi.classList.remove('active');
        });
        var activeItem = captionsMenu.querySelector('[data-index="' + index + '"]');
        if (activeItem) activeItem.classList.add('active');

        // Persist preference as a language code (empty = off) — survives
        // across videos: if the new video has the same language it auto-enables.
        var langCode = '';
        if (index >= 0 && data.subtitles[index]) {
          langCode = (data.subtitles[index].language || '').toLowerCase();
        }
        PlayerPrefs.setCaptions(langCode);

        // Close menu
        captionsMenu.classList.remove('open');
      };

      buildCaptionsMenu();

      // Auto-enable captions on load. Priority:
      //   1. URL query param ?captions=XX — authoritative override so a share
      //      link can force a specific language regardless of viewer's saved
      //      preference. ?captions=off|0|false explicitly disables.
      //   2. localStorage saved preference — carries across videos for the
      //      same viewer.
      //   3. Nothing — Disabled (default).
      (function applyCaptionsOnLoad() {
        // Normalize common aliases (users often type JP instead of ja, etc.)
        function normalizeLang(code) {
          var c = (code || '').trim().toLowerCase();
          var aliases = { jp: 'ja', kr: 'ko', cn: 'zh', chs: 'zh', cht: 'zh', ua: 'uk', br: 'pt', gr: 'el' };
          return aliases[c] || c;
        }

        var params;
        try { params = new URLSearchParams(window.location.search); } catch (_) { params = null; }
        var urlCap = params ? (params.get('captions') || params.get('subtitles') || '') : '';
        var urlCapN = normalizeLang(urlCap);

        // Explicit "off" via URL — force disabled, ignore saved preference.
        if (urlCapN === 'off' || urlCapN === '0' || urlCapN === 'false' || urlCapN === 'disabled') {
          selectCaption(-1);
          return;
        }

        // Match against: (a) the track's exact language code (case-insensitive),
        // (b) the normalized ISO 639-1 form of the language (so 'JP' → 'ja'
        // matches tracks stored as 'ja'), and (c) the display label. Admins
        // can type anything in the dashboard (the "JP" / "EN" / "KO" inputs
        // become both the language code AND label), so matching the label
        // gives the friendliest mental model: ?captions=JP always works when
        // the dashboard shows "JP".
        function matchTrack(query) {
          if (!query) return -1;
          var queryRaw = query; // already lowercased by caller
          return data.subtitles.findIndex(function (sub) {
            var rawLang = (sub.language || '').toLowerCase();
            var normLang = normalizeLang(sub.language);
            var label = (sub.label || '').toLowerCase();
            return rawLang === queryRaw
                || normLang === queryRaw
                || label === queryRaw;
          });
        }

        // 1. URL param wins if it resolves to a track
        if (urlCapN) {
          var urlIdx = matchTrack(urlCapN);
          if (urlIdx >= 0) { selectCaption(urlIdx); return; }
          // URL requested a language this video doesn't have → fall through
          // to localStorage rather than silently doing nothing.
        }

        // 2. Fall back to saved preference
        var savedLang = normalizeLang(PlayerPrefs.getCaptions());
        if (!savedLang) return;
        var savedIdx = matchTrack(savedLang);
        if (savedIdx >= 0) selectCaption(savedIdx);
      })();

      // Toggle captions menu on CC button click. When opening, suppress
      // :hover on items + the back header until the cursor either moves
      // inside the menu or leaves each element — otherwise the row under
      // the cursor looks permanently "selected" on open.
      btnSubtitles.addEventListener('click', function (e) {
        e.stopPropagation();
          qualityMenu.classList.remove('open');
        audioMenu.classList.remove('open');
        chaptersMenu.classList.remove('open');
        captionsMenu.classList.toggle('open');
        if (captionsMenu.classList.contains('open')) {
          // Menu-wide suppression for items — cleared on first mousemove
          captionsMenu.classList.add('_no-hover');
          var clearMenuNoHover = function () {
            captionsMenu.classList.remove('_no-hover');
            captionsMenu.removeEventListener('mousemove', clearMenuNoHover);
            captionsMenu.removeEventListener('mouseleave', clearMenuNoHover);
            clearTimeout(ncTimer);
          };
          var ncTimer = setTimeout(clearMenuNoHover, 1500);
          captionsMenu.addEventListener('mousemove', clearMenuNoHover);
          captionsMenu.addEventListener('mouseleave', clearMenuNoHover);

          // Header-specific suppression — cleared on header mouseleave so
          // hover only kicks in AFTER the cursor leaves once and returns.
          var header = captionsMenu.querySelector('.player-captions-header');
          if (header) {
            header.classList.add('_no-hover');
            var clearHeaderNoHover = function () {
              header.classList.remove('_no-hover');
              header.removeEventListener('mouseleave', clearHeaderNoHover);
              clearTimeout(hTimer);
            };
            var hTimer = setTimeout(clearHeaderNoHover, 1500);
            header.addEventListener('mouseleave', clearHeaderNoHover);
          }
        }
      });
    }

    /* ── Play / Pause ── */
    function togglePlay() {
      if (adPlaying) return; // Don't toggle during ad playback
      if (video.paused) {
        // Check if prerolls need to play first
        if (!prerollsPlayed && vastConfig.enabled) {
          var prerolls = getAdsByType('preroll');
          if (prerolls.length > 0) {
            prerollsPlayed = true;
            playAdSequence(prerolls).then(function () {
              video.play().catch(function () {});
            });
            return;
          }
        }
        prerollsPlayed = true;
        video.play().catch(function () {});
      } else {
        video.pause();
      }
    }

    container.addEventListener('click', function (e) {
      // Skip toggle when clicking any UI overlay — the controls bar, the big
      // play button (has its own handler), ad overlay, resume banner, PiP
      // overlay, or the player-title overlay. Without this, clicking the
      // background of the resume banner would toggle play through it.
      if (
        e.target.closest('.player-controls') ||
        e.target.closest('.player-big-play') ||
        e.target.closest('.ad-overlay') ||
        e.target.closest('.resume-banner') ||
        e.target.closest('.player-pip-overlay')
      ) return;
      togglePlay();
    });

    bigPlay.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlay();
    });

    btnPlay.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlay();
    });

    video.addEventListener('play', function () {
      btnPlay.innerHTML = Icons.pause;
      btnPlay.title = 'Pause (Space)';
      bigPlay.classList.add('hidden');
      // Dismiss resume banner once they start playing
      dismissResumeBanner();
      if (!hasPlayed) {
        hasPlayed = true;
        sendEvent('play');
        startAnalyticsInterval();
        startProgressSaving();
        tryPopupAd();
      } else {
        startProgressSaving();
      }
    });

    video.addEventListener('pause', function () {
      if (adPlaying) return;
      btnPlay.innerHTML = Icons.play;
      btnPlay.title = 'Play (Space)';
      bigPlay.classList.remove('hidden');
      sendEvent('pause');
      stopProgressSaving();
      // Save position immediately on pause
      if (video.currentTime > 2) saveProgress(false);
    });

    video.addEventListener('ended', function () {
      // Mark video as completed and clear saved progress
      saveProgress(true);
      stopProgressSaving();
      // Check for postroll ads
      if (!postrollsPlayed && vastConfig.enabled) {
        var postrolls = getAdsByType('postroll');
        if (postrolls.length > 0) {
          postrollsPlayed = true;
          playAdSequence(postrolls).then(function () {
            btnPlay.innerHTML = Icons.play;
            btnPlay.title = 'Play (Space)';
            bigPlay.classList.remove('hidden');
            sendEvent('ended');
            stopAnalyticsInterval();
          });
          return;
        }
      }
      btnPlay.innerHTML = Icons.play;
      btnPlay.title = 'Play (Space)';
      bigPlay.classList.remove('hidden');
      sendEvent('ended');
      stopAnalyticsInterval();
    });

    /* ── Progress ── */
    video.addEventListener('timeupdate', function () {
      if (!video.duration) return;
      var pct = (video.currentTime / video.duration) * 100;
      progressPlayed.style.width = pct + '%';
      progressHandle.style.left = pct + '%';
      timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);

      // Track watch duration
      var now = Date.now();
      if (lastTimeUpdate && !video.paused) {
        var delta = (now - lastTimeUpdate) / 1000;
        if (delta < 2) watchDuration += delta;
      }
      lastTimeUpdate = now;

      // Midroll ad trigger
      if (vastConfig.enabled && !adPlaying) {
        var midrolls = getAdsByType('midroll');
        for (var m = 0; m < midrolls.length; m++) {
          var midEntry = midrolls[m];
          var midTime = parseTimeOffset(midEntry.time_offset);
          var midKey = m + '_' + midTime;
          if (midTime > 0 && !midrollsFired[midKey] && Math.abs(video.currentTime - midTime) < 1) {
            midrollsFired[midKey] = true;
            video.pause();
            playAdSequence([midEntry]).then(function () {
              video.play().catch(function () {});
            });
            break;
          }
        }
      }
    });

    video.addEventListener('progress', function () {
      if (video.buffered.length > 0 && video.duration) {
        var buffEnd = video.buffered.end(video.buffered.length - 1);
        progressBuffered.style.width = (buffEnd / video.duration) * 100 + '%';
      }
    });

    // Seek on click
    var seeking = false;

    function seekFromEvent(e) {
      var rect = progress.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      video.currentTime = pct * video.duration;
    }

    progress.addEventListener('mousedown', function (e) {
      e.stopPropagation();
      seeking = true;
      seekFromEvent(e);
    });

    document.addEventListener('mousemove', function (e) {
      if (seeking) seekFromEvent(e);
    });

    document.addEventListener('mouseup', function () {
      seeking = false;
    });

    // Touch seek
    progress.addEventListener('touchstart', function (e) {
      e.stopPropagation();
      var touch = e.touches[0];
      var rect = progress.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      video.currentTime = pct * video.duration;
    }, { passive: true });

    progress.addEventListener('touchmove', function (e) {
      var touch = e.touches[0];
      var rect = progress.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
      video.currentTime = pct * video.duration;
    }, { passive: true });

    /* ── Scrub preview (sprite + WebVTT xywh) ──
       One request for sprite.vtt on the first hover; parsed into [{start, end,
       imageUrl, x, y, w, h}] cues, then each mousemove maps pointer → time →
       cue and positions a tooltip above the progress bar. */
    var scrubCues = null;
    var scrubVttLoading = false;
    var scrubVttFailed = false; // set after an error so we don't retry indefinitely
    var spriteVttUrl = videoData.sprite_vtt_url;
    var spriteBaseUrl = videoData.sprite_url ? videoData.sprite_url.replace(/[^/]+$/, '') : '';

    // Accept only URLs we generated ourselves: absolute http(s) without any
    // characters that could break out of the background-image url("...")
    // context (quotes, parens, whitespace, control chars, backslash).
    function isSafeSpriteUrl(url) {
      if (typeof url !== 'string' || !url) return false;
      if (/["'()\s\\\u0000-\u001f]/.test(url)) return false;
      if (url.startsWith('/') && !url.startsWith('//')) return true;   // server-relative
      return /^https?:\/\//i.test(url);
    }

    function parseScrubVtt(text) {
      var lines = text.split(/\r?\n/);
      var cues = [];
      var i = 0;
      // Skip "WEBVTT" header
      if (lines[i] && /^WEBVTT/.test(lines[i])) i++;
      while (i < lines.length) {
        var line = (lines[i] || '').trim();
        var m = line.match(/^(\d\d:\d\d:\d\d\.\d+)\s+-->\s+(\d\d:\d\d:\d\d\.\d+)/);
        if (m) {
          var start = vttTimeToSeconds(m[1]);
          var end = vttTimeToSeconds(m[2]);
          var payload = (lines[i + 1] || '').trim();
          // payload: "sprite.jpg#xywh=X,Y,W,H"
          var xywh = payload.match(/#xywh=(\d+),(\d+),(\d+),(\d+)/);
          if (xywh) {
            var img = payload.split('#')[0];
            // Resolve: absolute http(s) → keep; /-rooted → keep; otherwise
            // prefix with sprite directory. Reject anything that fails the
            // safe-URL check (blocks CSS-injection via malformed VTT).
            var imageUrl;
            if (/^https?:\/\//i.test(img) || (img.startsWith('/') && !img.startsWith('//'))) {
              imageUrl = img;
            } else {
              imageUrl = spriteBaseUrl + img;
            }
            if (!isSafeSpriteUrl(imageUrl)) { i += 2; continue; }
            cues.push({
              start: start,
              end: end,
              image: imageUrl,
              x: +xywh[1], y: +xywh[2], w: +xywh[3], h: +xywh[4]
            });
          }
          i += 2;
        } else {
          i++;
        }
      }
      return cues;
    }

    function vttTimeToSeconds(str) {
      var p = str.split(':');
      return (+p[0]) * 3600 + (+p[1]) * 60 + parseFloat(p[2]);
    }

    // Build a demo sprite + cues using a canvas-generated image — used when
    // no real sprite.vtt is available (old videos encoded before the feature
    // landed). Creates a 10-column grid of gradient tiles with timecode
    // labels, so scrub-preview works visually even without server-generated
    // thumbnails. Runtime-only, no network fetch.
    function buildDemoScrubCues() {
      var dur = video.duration || 60;
      if (!isFinite(dur) || dur <= 0) dur = 60;
      var THUMB_W = 160, THUMB_H = 90;
      var COLS = 10;
      var interval = Math.max(2, Math.floor(dur / 40));  // up to ~40 frames
      var count = Math.max(2, Math.floor(dur / interval));
      var rows = Math.ceil(count / COLS);
      try {
        var c = document.createElement('canvas');
        c.width = COLS * THUMB_W;
        c.height = rows * THUMB_H;
        var ctx = c.getContext('2d');
        for (var i = 0; i < count; i++) {
          var col = (i % COLS) * THUMB_W;
          var row = Math.floor(i / COLS) * THUMB_H;
          var hue = Math.round((i / count) * 300);  // purple → red
          var g = ctx.createLinearGradient(col, row, col + THUMB_W, row + THUMB_H);
          g.addColorStop(0, 'hsl(' + hue + ', 60%, 28%)');
          g.addColorStop(1, 'hsl(' + ((hue + 30) % 360) + ', 60%, 16%)');
          ctx.fillStyle = g;
          ctx.fillRect(col, row, THUMB_W, THUMB_H);
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.font = '600 14px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(formatTime(i * interval), col + THUMB_W / 2, row + THUMB_H / 2 + 5);
          ctx.strokeStyle = 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 1;
          ctx.strokeRect(col + 0.5, row + 0.5, THUMB_W - 1, THUMB_H - 1);
        }
        var demoImageUrl = c.toDataURL('image/jpeg', 0.8);
        var cues = [];
        for (var j = 0; j < count; j++) {
          cues.push({
            start: j * interval,
            end: (j + 1) * interval,
            image: demoImageUrl,
            x: (j % COLS) * THUMB_W,
            y: Math.floor(j / COLS) * THUMB_H,
            w: THUMB_W, h: THUMB_H
          });
        }
        return cues;
      } catch (_) { return []; }
    }

    function applyDemoScrubCues() {
      if (scrubCues && scrubCues.length) return;
      scrubCues = buildDemoScrubCues();
      scrubVttFailed = false; // clear so mousemove can render
    }

    function ensureScrubVtt() {
      if (scrubCues || scrubVttLoading || scrubVttFailed) return;
      // No URL at all → straight to canvas demo so the feature still works
      if (!spriteVttUrl) { applyDemoScrubCues(); return; }
      scrubVttLoading = true;
      fetch(spriteVttUrl)
        .then(function (r) {
          if (!r.ok) { scrubVttFailed = true; applyDemoScrubCues(); return null; }
          return r.text();
        })
        .then(function (text) {
          if (!text) return;
          scrubCues = parseScrubVtt(text);
          if (scrubCues.length) {
            // Preload the sprite image so the first hover isn't empty
            var pre = new Image();
            pre.src = scrubCues[0].image;
          } else {
            // Empty parse result = fall back to canvas demo
            scrubVttFailed = true;
            applyDemoScrubCues();
          }
        })
        .catch(function () {
          scrubVttFailed = true;
          applyDemoScrubCues();
        })
        .finally(function () { scrubVttLoading = false; });
    }

    // Binary search — cues are sorted by start time, so O(log n) instead of
    // O(n). Meaningful on long videos (1hr+ has ~360 cues).
    function findScrubCue(time) {
      if (!scrubCues || !scrubCues.length) return null;
      var lo = 0, hi = scrubCues.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var c = scrubCues[mid];
        if (time < c.start) hi = mid - 1;
        else if (time >= c.end) lo = mid + 1;
        else return c;
      }
      // Past-end clamp — if we fell off the right edge, return last cue
      return scrubCues[scrubCues.length - 1];
    }

    // Preload the sprite proactively during CPU idle time so the first hover
    // feels instant. Waits ~2s after page load so it doesn't compete with
    // HLS startup. Falls back to setTimeout on browsers without RIC.
    function preloadSpriteWhenIdle() {
      if (!spriteVttUrl || scrubCues || scrubVttFailed) return;
      var ric = window.requestIdleCallback || function (cb) { return setTimeout(cb, 2000); };
      ric(function () { ensureScrubVtt(); });
    }
    // Kick off after a short delay so HLS has first-segment priority
    setTimeout(preloadSpriteWhenIdle, 2500);

    progress.addEventListener('mouseenter', function () {
      ensureScrubVtt();
    });

    // rAF-throttle: coalesce rapid mousemove bursts to one update per frame.
    // Pointer position + duration read synchronously (fresh), DOM writes
    // batched into the next animation frame.
    var scrubRafPending = false;
    var scrubLastX = 0;
    var scrubLastRect = null;

    function updateScrubPreview() {
      scrubRafPending = false;
      var dur = video.duration || 0;
      if (!dur || !scrubLastRect) return;
      var rect = scrubLastRect;
      var pct = Math.max(0, Math.min(1, (scrubLastX - rect.left) / rect.width));
      var t = pct * dur;

      // Time label (always shown)
      scrubTime.textContent = formatTime(t);

      // Sprite preview (only when cues are ready)
      var cue = findScrubCue(t);
      if (cue) {
        scrubThumb.style.backgroundImage = 'url("' + cue.image + '")';
        scrubThumb.style.backgroundPosition = '-' + cue.x + 'px -' + cue.y + 'px';
        scrubThumb.style.width = cue.w + 'px';
        scrubThumb.style.height = cue.h + 'px';
        scrubThumb.style.display = 'block';
      } else {
        scrubThumb.style.display = 'none';
      }

      // Position tooltip, clamped inside progress bar
      var TIP_W = (cue ? cue.w : 80);
      var x = scrubLastX - rect.left;
      var left = Math.max(TIP_W / 2, Math.min(rect.width - TIP_W / 2, x));
      scrubPreview.style.left = left + 'px';
      scrubPreview.style.display = 'flex';
    }

    progress.addEventListener('mousemove', function (e) {
      scrubLastX = e.clientX;
      scrubLastRect = progress.getBoundingClientRect();
      if (!scrubRafPending) {
        scrubRafPending = true;
        requestAnimationFrame(updateScrubPreview);
      }
    });

    progress.addEventListener('mouseleave', function () {
      scrubPreview.style.display = 'none';
    });

    /* ── Volume ── */
    var savedVolume = 1;

    btnVolume.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMute();
      // Pin the slider open so touch devices (no :hover) can still drag it.
      // The outside-click handler below removes the sticky class.
      volumeWrap.classList.add('active');
    });
    // Click outside the volume area → unpin the slider
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.player-volume')) {
        volumeWrap.classList.remove('active');
      }
    });
    // Moving the cursor off (desktop hover) also unpins once the pointer leaves
    volumeWrap.addEventListener('mouseleave', function () {
      volumeWrap.classList.remove('active');
    });

    function syncVolumeFill() {
      // Update the CSS var that colors the played portion of the track
      var pct = video.muted ? 0 : Math.round(video.volume * 100);
      volumeSlider.style.setProperty('--vol-pct', pct + '%');
    }

    function toggleMute() {
      if (video.muted || video.volume === 0) {
        video.muted = false;
        video.volume = savedVolume || 1;
        volumeSlider.value = video.volume;
      } else {
        savedVolume = video.volume;
        video.muted = true;
        volumeSlider.value = 0;
      }
      updateVolumeIcon();
      syncVolumeFill();
      PlayerPrefs.setMuted(video.muted);
      PlayerPrefs.setVolume(video.muted ? savedVolume : video.volume);
    }

    volumeSlider.addEventListener('input', function (e) {
      e.stopPropagation();
      video.volume = parseFloat(this.value);
      video.muted = video.volume === 0;
      if (video.volume > 0) savedVolume = video.volume;
      updateVolumeIcon();
      syncVolumeFill();
      PlayerPrefs.setVolume(video.volume);
      PlayerPrefs.setMuted(video.muted);
    });

    // Apply saved volume/mute on init — autoplay (which requires mute on most
    // browsers) takes precedence and isn't overridden.
    (function applySavedVolume() {
      var savedVol = PlayerPrefs.getVolume();
      if (savedVol !== null) {
        video.volume = savedVol;
        savedVolume = savedVol || 1;
        volumeSlider.value = savedVol;
      }
      if (PlayerPrefs.getMuted() && !data.autoplay) {
        video.muted = true;
      }
      updateVolumeIcon();
      syncVolumeFill();
    })();
    syncVolumeFill();

    volumeSlider.addEventListener('click', function (e) { e.stopPropagation(); });

    function updateVolumeIcon() {
      if (video.muted || video.volume === 0) {
        btnVolume.innerHTML = Icons.volumeMute;
      } else if (video.volume < 0.5) {
        btnVolume.innerHTML = Icons.volumeLow;
      } else {
        btnVolume.innerHTML = Icons.volumeHigh;
      }
    }

    /* ── Fullscreen ── */
    btnFullscreen.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleFullscreen();
    });

    function toggleFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (container.requestFullscreen) container.requestFullscreen();
        else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    }

    document.addEventListener('fullscreenchange', updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);

    function updateFullscreenIcon() {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        btnFullscreen.innerHTML = Icons.fullscreenExit;
      } else {
        btnFullscreen.innerHTML = Icons.fullscreen;
      }
    }

    /* ── PiP ── */
    btnPip.addEventListener('click', function (e) {
      e.stopPropagation();
      togglePip();
    });

    function togglePip() {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(function () {});
      } else if (video.requestPictureInPicture) {
        video.requestPictureInPicture().catch(function () {});
      }
    }

    // Hide PiP button if not supported
    if (!document.pictureInPictureEnabled) {
      btnPip.style.display = 'none';
    }

    // PiP overlay — shown inside the player area while the video is playing
    // in a PiP window. Clicking it returns from PiP.
    var pipOverlay = el('div', 'player-pip-overlay', { innerHTML:
      '<div class="pip-title">Playing in picture-in-picture</div>' +
      '<div class="pip-action">Click to return</div>'
    });
    container.appendChild(pipOverlay);
    pipOverlay.addEventListener('click', function (e) {
      e.stopPropagation();
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(function () {});
      }
    });
    video.addEventListener('enterpictureinpicture', function () {
      container.classList.add('pip-active');
    });
    video.addEventListener('leavepictureinpicture', function () {
      container.classList.remove('pip-active');
    });

    /* ── Keyboard helpers ── */
    // C key toggle: if captions are on, turn off; otherwise enable the saved
    // language (falls back to the first available track).
    function toggleCaptionsShortcut() {
      if (!selectCaption || !data.subtitles || !data.subtitles.length) return;
      if (activeSubtitleIndex >= 0) {
        selectCaption(-1);
      } else {
        var savedLang = (PlayerPrefs.getCaptions() || '').toLowerCase();
        var idx = savedLang
          ? data.subtitles.findIndex(function (s) { return (s.language || '').toLowerCase() === savedLang; })
          : -1;
        selectCaption(idx >= 0 ? idx : 0);
      }
    }
    // Update the speed menu UI + main-row value to match a programmatic speed change
    function applySpeedLabel(s) {
      var label = s === 1 ? 'Normal' : (s + 'x');
      var valueEl = speedRow.querySelector('[data-value="speed"]');
      if (valueEl) valueEl.textContent = label;
      speedView.querySelectorAll('.player-menu-item').forEach(function (mi) { mi.classList.remove('active'); });
      var match = speedView.querySelector('.player-menu-item[data-speed="' + s + '"]');
      if (match) match.classList.add('active');
    }

    /* ── Keyboard Shortcuts ── */
    document.addEventListener('keydown', function (e) {
      // Ignore if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Shift+. and Shift+, → speed up/down (YouTube parity). Keys are '>' / '<'.
      if (e.key === '>' || (e.shiftKey && e.key === '.')) {
        e.preventDefault();
        var speedsUp = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        var curU = video.playbackRate;
        var nextU = speedsUp.find(function (s) { return s > curU + 0.01; });
        if (nextU) { video.playbackRate = nextU; PlayerPrefs.setSpeed(nextU); applySpeedLabel(nextU); }
        showControls();
        return;
      }
      if (e.key === '<' || (e.shiftKey && e.key === ',')) {
        e.preventDefault();
        var speedsDn = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        var curD = video.playbackRate;
        var nextD = speedsDn.slice().reverse().find(function (s) { return s < curD - 0.01; });
        if (nextD) { video.playbackRate = nextD; PlayerPrefs.setSpeed(nextD); applySpeedLabel(nextD); }
        showControls();
        return;
      }

      // Numeric 0-9 → seek to that percent of duration (YouTube parity).
      if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        var dur = video.duration || 0;
        if (dur > 0) video.currentTime = dur * (parseInt(e.key, 10) / 10);
        showControls();
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          toggleCaptionsShortcut();
          break;
        case 'Home':
          e.preventDefault();
          video.currentTime = 0;
          break;
        case 'End':
          e.preventDefault();
          if (video.duration) video.currentTime = video.duration;
          break;
        // ±10s on ArrowLeft/Right and J/L — matches the visible 10s skip
        // buttons in the control bar so the keyboard + UI are consistent.
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          video.muted = false;
          volumeSlider.value = video.volume;
          updateVolumeIcon();
          syncVolumeFill();
          if (video.volume > 0) savedVolume = video.volume;
          PlayerPrefs.setVolume(video.volume);
          PlayerPrefs.setMuted(video.muted);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          if (video.volume === 0) video.muted = true;
          volumeSlider.value = video.volume;
          updateVolumeIcon();
          syncVolumeFill();
          if (video.volume > 0) savedVolume = video.volume;
          PlayerPrefs.setVolume(video.volume);
          PlayerPrefs.setMuted(video.muted);
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          togglePip();
          break;
      }

      showControls();
    });

    /* ── Controls Auto-Hide ── */
    function showControls() {
      container.classList.remove('controls-hidden');
      clearTimeout(controlsTimeout);
      if (!video.paused) {
        controlsTimeout = setTimeout(function () {
          container.classList.add('controls-hidden');
          // Close open menus
          qualityMenu.classList.remove('open');
              captionsMenu.classList.remove('open');
          audioMenu.classList.remove('open');
          chaptersMenu.classList.remove('open');
        }, 3000);
      }
    }

    container.addEventListener('mousemove', showControls);
    container.addEventListener('touchstart', function () {
      if (container.classList.contains('controls-hidden')) {
        showControls();
      } else if (!video.paused) {
        container.classList.add('controls-hidden');
      }
    }, { passive: true });

    /* ── Mobile double-tap seek (YouTube-style) ── */
    // Two taps within 350ms on the left third → -10s; right third → +10s.
    // Middle third is toggle-play via the normal container click handler.
    // Shows a brief animated ripple + timestamp over the tapped side.
    var lastTapTime = 0;
    var lastTapX = 0;
    var lastTapSide = null;
    var seekFeedbackLeft = el('div', 'player-seek-feedback side-left');
    seekFeedbackLeft.innerHTML = '<div class="seek-feedback-arrows">⏪</div><div class="seek-feedback-text">10 seconds</div>';
    var seekFeedbackRight = el('div', 'player-seek-feedback side-right');
    seekFeedbackRight.innerHTML = '<div class="seek-feedback-arrows">⏩</div><div class="seek-feedback-text">10 seconds</div>';
    container.appendChild(seekFeedbackLeft);
    container.appendChild(seekFeedbackRight);

    function showSeekFeedback(side) {
      var el = side === 'left' ? seekFeedbackLeft : seekFeedbackRight;
      el.classList.remove('flash');
      // Force reflow so the animation replays on rapid double-taps
      void el.offsetWidth;
      el.classList.add('flash');
    }

    container.addEventListener('touchend', function (e) {
      // Skip if the touch landed on any control UI — let the button handle it
      if (e.target.closest('.player-controls') ||
          e.target.closest('.player-big-play') ||
          e.target.closest('.resume-banner') ||
          e.target.closest('.player-pip-overlay') ||
          e.target.closest('.ad-overlay')) return;

      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      var rect = container.getBoundingClientRect();
      var x = t.clientX - rect.left;
      var side = x < rect.width * 0.33 ? 'left'
               : x > rect.width * 0.67 ? 'right'
               : 'center';
      var now = Date.now();
      var sinceLast = now - lastTapTime;

      // Double-tap only fires when both taps are on the SAME side (not center
      // for toggle) and within 350ms.
      if (sinceLast < 350 && side !== 'center' && side === lastTapSide) {
        e.preventDefault();
        if (side === 'left') {
          video.currentTime = Math.max(0, video.currentTime - 10);
        } else {
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
        }
        showSeekFeedback(side);
        lastTapTime = 0; // reset so a 3rd tap doesn't chain
        lastTapSide = null;
        return;
      }
      lastTapTime = now;
      lastTapX = x;
      lastTapSide = side;
    }, { passive: false });

    video.addEventListener('pause', function () {
      clearTimeout(controlsTimeout);
      container.classList.remove('controls-hidden');
    });

    // Close menus when clicking outside
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.player-menu-wrapper')) {
        qualityMenu.classList.remove('open');
          captionsMenu.classList.remove('open');
        audioMenu.classList.remove('open');
        chaptersMenu.classList.remove('open');
      }
    });

    /* ── Loading State ── */
    video.addEventListener('waiting', function () {
      loadingOverlay.classList.add('visible');
    });

    video.addEventListener('canplay', function () {
      loadingOverlay.classList.remove('visible');
    });

    video.addEventListener('playing', function () {
      loadingOverlay.classList.remove('visible');
    });

    /* ── Analytics ── */
    function sendEvent(type) {
      var payload = {
        video_id: videoId,
        event: type,
        current_time: video.currentTime || 0,
        duration: video.duration || 0,
        watch_duration: Math.round(watchDuration)
      };
      try {
        navigator.sendBeacon('/api/player/event', JSON.stringify(payload));
      } catch (e) {
        fetch('/api/player/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).catch(function () {});
      }
    }

    /* ── Resume Watching ── */

    // Save current position to server (fire-and-forget, debounced for cheap
    // periodic saves during playback).
    function saveProgress(completed) {
      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(function () { saveProgressNow(completed); }, completed ? 0 : 300);
    }

    // Immediate, non-debounced save — for page-unload where a setTimeout
    // wouldn't fire before the page goes away. Uses sendBeacon when
    // available (browsers queue it reliably past unload), falling back to
    // keepalive fetch.
    function saveProgressNow(completed) {
      var pos  = video.currentTime || 0;
      var dur  = video.duration   || 0;
      var done = completed === true || (dur > 0 && pos >= dur - 2);
      var payload = JSON.stringify({ viewer_id: viewerId, position: pos, duration: dur, completed: done });
      var url = '/api/player/' + videoId + '/progress';
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
          return;
        }
      } catch (_) { /* fall through */ }
      try {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true
        }).catch(function () {});
      } catch (_) {}
    }

    // Load saved position from server
    function loadProgress(callback) {
      fetch('/api/player/' + videoId + '/progress?viewer_id=' + encodeURIComponent(viewerId))
        .then(function (r) { return r.json(); })
        .then(function (data) { callback(data); })
        .catch(function ()   { callback({ position: 0, completed: false }); });
    }

    // Build the resume banner overlay
    function showResumeBanner(position) {
      if (resumeBanner) return; // already shown

      var timeStr = formatTime(position);

      resumeBanner = el('div', 'resume-banner');
      resumeBanner.innerHTML =
        '<div class="resume-banner-inner">' +
          '<div class="resume-banner-left">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" style="flex-shrink:0"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>' +
            '<div>' +
              '<div class="resume-banner-title">Continue watching</div>' +
              '<div class="resume-banner-time">from ' + timeStr + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="resume-banner-actions">' +
            '<button class="resume-btn-restart">Start over</button>' +
            '<button class="resume-btn-resume">Resume</button>' +
          '</div>' +
        '</div>';

      container.appendChild(resumeBanner);

      // Wire buttons
      resumeBanner.querySelector('.resume-btn-resume').addEventListener('click', function (e) {
        e.stopPropagation();
        video.currentTime = position;
        dismissResumeBanner();
        video.play().catch(function () {});
      });

      resumeBanner.querySelector('.resume-btn-restart').addEventListener('click', function (e) {
        e.stopPropagation();
        video.currentTime = 0;
        dismissResumeBanner();
        video.play().catch(function () {});
      });

      // Auto-dismiss after 8 seconds (starts video from beginning if no action)
      resumeAutoHideTimer = setTimeout(function () {
        dismissResumeBanner();
      }, 8000);

      // Animate in
      requestAnimationFrame(function () {
        resumeBanner.classList.add('visible');
      });
    }

    function dismissResumeBanner() {
      clearTimeout(resumeAutoHideTimer);
      if (!resumeBanner) return;
      resumeBanner.classList.remove('visible');
      var b = resumeBanner;
      resumeBanner = null;
      setTimeout(function () {
        if (b.parentNode) b.parentNode.removeChild(b);
      }, 300);
    }

    // Save progress every 5 seconds during playback (uses its own interval
    // var so saveProgress's debounce timer can't clobber it).
    function startProgressSaving() {
      stopProgressSaving();
      progressSaveInterval = setInterval(function () {
        if (!video.paused && !video.ended && video.currentTime > 2) {
          saveProgress(false);
        }
      }, 5000);
    }

    function stopProgressSaving() {
      if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
      }
    }

    function startAnalyticsInterval() {
      stopAnalyticsInterval();
      analyticsInterval = setInterval(function () {
        if (!video.paused) {
          sendEvent('watch_duration');
        }
      }, 30000);
    }

    function stopAnalyticsInterval() {
      if (analyticsInterval) {
        clearInterval(analyticsInterval);
        analyticsInterval = null;
      }
    }

    // Send final watch duration + progress on page unload. Use pagehide
    // (fires more reliably on mobile + iOS than beforeunload) and always
    // call saveProgressNow — the debounced saveProgress schedules via
    // setTimeout which never fires during unload.
    function onPageGone() {
      if (watchDuration > 0) sendEvent('watch_duration');
      if (video && video.currentTime > 2 && !video.ended) {
        saveProgressNow(false);
      }
    }
    window.addEventListener('beforeunload', onPageGone);
    window.addEventListener('pagehide', onPageGone);

    /* ── Error Display ── */
    function showError(message) {
      loadingOverlay.classList.remove('visible');
      var errDiv = el('div', 'player-error');
      errDiv.innerHTML = '<div class="error-icon">&#9888;</div><div class="error-message">' + message + '</div>';
      container.appendChild(errDiv);
    }

    /* ── Initial Controls Visibility ── */
    showControls();
  }
}
