# Playback Debug Overlay

> **Status**: Implemented. Append `?debug=1` to any embed or `/v/` URL to see
> a live stats overlay in the player — similar to YouTube's "Stats for nerds".

## What it does

Shows a real-time, read-only overlay of playback metrics in the top-right
corner of the player. Intended for:

- **Debugging viewer complaints** — ask the user to load `?debug=1` and screenshot
- **Your own integration checks** — confirm the right quality is being served
- **Support workflows** — see buffer, bandwidth, dropped frames at a glance

## How to enable

Add `?debug=1` to the URL:

```
https://yoursite.com/embed/abc123            ← normal
https://yoursite.com/embed/abc123?debug=1    ← overlay visible
https://yoursite.com/v/abc123?debug=1        ← works on /v/ too
```

No dashboard toggle, no account flag — just a URL parameter. Anyone with the
link can enable it for themselves. The overlay is purely client-side.

## What's shown

| Row | Source | Notes |
|-----|--------|-------|
| Video | Video ID | Matches the URL slug |
| Status | `Playing` / `Paused` / `Buffering` / `Ended` | From `<video>` state |
| Quality | e.g., `1080p (auto)` | Current ABR level; `(auto)` if adaptive |
| Level bitrate | e.g., `3.63 Mbps` | Encoded bitrate of the current rendition |
| Frame rate | e.g., `30.00 fps` | From the master playlist |
| Codec | e.g., `avc1.640028 / mp4a.40.2` | Video codec / audio codec |
| Bandwidth | e.g., `28.4 Mbps` | hls.js estimate (bits/sec, not bytes/sec) |
| Resolution | e.g., `1920×1080` | Actual decoded frame size |
| Buffer | e.g., `12.4s ahead` | Seconds pre-loaded past current time |
| Dropped frames | e.g., `0 / 8421 (0.00%)` | From `video.getVideoPlaybackQuality()` |
| Stalls | integer | Count of `bufferStalledError` events |
| Segment | e.g., `1080p_042.jpeg` | Last HLS segment loaded |
| Network | e.g., `4g / 38.2 Mbps` | Browser's `navigator.connection` (Chromium only) |
| Engine | e.g., `hls.js 1.6.16` or `Safari native` | Playback engine |
| Time | e.g., `1:23 / 10:34` | Current / total |

Updated every 500 ms.

## Controls

- **× (close button)** — removes the overlay and stops polling for this session
- **`D` key** — collapses/expands the overlay (keeps the header visible)

Once closed, reload the page to show it again.

## Engine differences

| Browser | Engine | Fields available |
|---------|--------|------------------|
| Chrome / Firefox / Edge | hls.js | All fields |
| Safari (macOS/iOS) | Native HLS | All except `Level bitrate`, `Codec`, `Bandwidth`, `Stalls`, `Segment` |
| Chromium-less (rare) | Native HLS (if supported) | Same as Safari |

Safari uses the OS-level HLS implementation, which doesn't expose per-segment
metrics. The overlay still shows resolution, buffer, dropped frames, and time.

## Security / privacy

- **No auth leakage** — tokens, API keys, and storage paths are NOT shown
- **Segment filename only** — query strings (which may contain signed tokens) are stripped
- **Titles/captions HTML-escaped** — all values written via an `escHtml()` helper
- **Visible to anyone with `?debug=1`** — treat it as public information (it is)
- **No metrics sent to server** — purely client-side display

## Performance impact

- ~0.1 KB of JS added to each page load
- Polling at 500 ms is negligible (one `getVideoPlaybackQuality()` call + DOM write)
- Hls.js event subscriptions (`FRAG_LOADED`, `ERROR`) are always-on in hls.js anyway; we only read them
- Overlay DOM is not created when `?debug=1` is absent — zero cost for normal viewers

## Troubleshooting with the overlay

| Symptom viewer reports | Stat to check | What it means |
|------------------------|---------------|---------------|
| "Video keeps buffering" | Buffer near 0, Stalls climbing | Network too slow for chosen level |
| "Looks pixelated" | Quality locked to low (e.g. 360p) | ABR picked low due to bandwidth |
| "Choppy / laggy" | Dropped frames > 1% of total | CPU/GPU too slow — try lower resolution |
| "Won't load" | No segment shown, Engine field present | Segment fetch failing — check Network tab |
| "Ad plays then freezes" | Time stuck, Buffer > 10s | Possible decoder stall — seek to recover |

## Future ideas

- Copy-to-clipboard button for pasting stats into a bug report
- Historical sparkline graphs for bandwidth + buffer (last 60 s)
- Color coding (red when buffer < 2 s, etc.)

These aren't built — open `?debug=1` and screenshot is enough for most cases.

## Learn more

- [HLS.js API — bandwidthEstimate / currentLevel / levels](https://github.com/video-dev/hls.js/blob/master/docs/API.md) — official docs for the fields the overlay reads
- [HTMLVideoElement.getVideoPlaybackQuality() (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/getVideoPlaybackQuality) — the dropped-frames API
- [NetworkInformation.downlink (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/downlink) — the browser's own bandwidth estimate
- [YouTube "Stats for nerds"](https://support.google.com/youtube/answer/10446302) — the inspiration for this overlay
- [Mux Playback Quality Monitoring](https://docs.mux.com/guides/monitor-your-playback-quality) — how the pros instrument player stats at scale
