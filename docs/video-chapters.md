# Video Chapters Guide

> **Status**: Implemented. This document explains how video chapters work —
> how they're stored, edited, delivered to the player, and rendered.

## What are chapters?

Chapters let viewers jump to specific points in a long video via a menu
in the player, and see thin tick marks on the seekbar indicating where
each chapter starts. The admin enters them on the video detail page in
the dashboard.

Examples of good chapter use:
- Tutorials: "Introduction", "Setup", "First Example", "Advanced"
- Podcasts: "Ep 1 Intro", "Guest Interview", "Q&A", "Outro"
- Movies/long content: "Act 1", "Act 2", "Act 3"

## Data format

Chapters are stored as a JSONB array on `videos.chapters`:

```json
[
  {"time": "0:00", "title": "Introduction"},
  {"time": "1:30", "title": "Getting Started"},
  {"time": "5:15", "title": "Advanced Topics"},
  {"time": "12:45", "title": "Q&A"}
]
```

**Time formats accepted** (regex: `^(\d{1,2}:)?\d{1,2}:\d{2}$`):
- `mm:ss` — e.g., `5:30` (5 minutes, 30 seconds)
- `hh:mm:ss` — e.g., `1:05:30` (1 hour, 5 minutes, 30 seconds)

## API

### GET `/api/videos/:id/chapters`

Returns the current chapter list:
```json
{ "chapters": [{"time": "0:00", "title": "Intro"}] }
```

Returns `404` if the video doesn't exist.

### PUT `/api/videos/:id/chapters`

Replaces the entire chapter array. Body: `{ "chapters": [...] }`.

**Validation:**
| Rule | Details |
|------|---------|
| Max count | 50 chapters per video |
| Title length | 1-200 chars (HTML tags stripped) |
| Time format | `mm:ss` or `hh:mm:ss` |
| Sorting | Auto-sorted by time ascending on save |
| Empty array | Allowed (clears all chapters) |

**Returns** (on success): `{ "chapters": [...] }` with the sanitized + sorted list.

**Rejects** (400) on: non-array, >50 chapters, invalid time format, empty title.

## Dashboard UI

On the video detail page:

1. **Chapters card** with an "+ Add Chapter" button and list view
2. **Add Chapter modal**: timestamp input (`mm:ss` placeholder) + title input
3. Chapters display in a list with `✕` delete button per row
4. **"Save Chapters"** button sends the full array to the API

Behavior:
- Entering a duplicate timestamp is allowed (both entries persist, sorted by time)
- Deleting all chapters + saving clears them server-side
- Validation errors (e.g., bad time format) surface as toast messages
- Sanitized titles come back from the server — the UI uses the server's version as source of truth

## Player integration

The player pulls chapters via `/api/player/:id` (no separate fetch needed):

```json
{
  "video": {...},
  "chapters": [{"time": "0:00", "title": "Intro"}, ...],
  "subtitles": [...],
  ...
}
```

### Seekbar markers

Thin white vertical ticks appear at each chapter's timestamp along the
seekbar. Hover shows the chapter title. Clicking a marker is a normal
seekbar click (seeks to that spot).

### Chapter menu

A "Chapters" button appears in the control row (next to quality +
audio). Clicking it opens a wide menu listing all chapters with
timestamps. Click a chapter → player seeks to that time.

### Edge cases handled

| Case | Behavior |
|------|----------|
| No chapters | Menu button hidden entirely |
| Video duration < 10s | Markers skipped (too cramped) |
| Chapter time > duration | Marker not rendered |
| Chapter time = 0 or negative | Marker not rendered |
| Duration not yet known | Markers rebuilt when `loadedmetadata` fires |

## Security

- **Server-side title sanitization**: HTML tags stripped, control chars removed
- **Client-side escaping**: dashboard uses `esc()` on all title displays
- **Admin-only edit**: `/api/videos/:id/chapters` sits behind admin auth
- **Public read**: chapters included in the public `/api/player/:id` response
  (same as video title/description — they're metadata, not secrets)
- **Audit log**: every `PUT /chapters` logs `video.chapters_updated` with count

## Limitations

- **Chapters are per-video, not per-language**: the same titles show for all viewers
- **No auto-generation**: no transcription-based auto-chapter detection (future enhancement)
- **No chapter thumbnails**: markers don't show preview images (could integrate with sprite sheet later)
- **No drag-reorder in UI**: chapters auto-sort by timestamp on save

## Learn more

- [WebVTT Chapter Navigation (W3C)](https://www.w3.org/TR/webvtt1/) — the native browser standard for chapters in `<track kind="chapters">` (we use JSON instead for simpler admin editing)
- [Chapter Markers Best Practices (Radiant Media Player)](https://www.radiantmediaplayer.com/docs/latest/chapters.html) — reference implementation using WebVTT
- [Videojs Chapters Demo (Nuevo Plugin)](https://www.nuevodevel.com/nuevo/showcase/chapters) — another approach with seekbar markers
- [Mux: Subtitles, Captions, WebVTT, HLS](https://www.mux.com/blog/subtitles-captions-webvtt-hls-and-those-magic-flags) — how WebVTT integrates with HLS (we skip this for simplicity)
