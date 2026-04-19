"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VideoResponse {
  id: string;
  title: string;
  description?: string;
  status: string;
  duration?: number;
  views_count: number;
  file_size?: number;
  visibility?: string;
  tags?: any;
  folder_id?: string;
  created_at: string;
  updated_at: string;
  thumbnail_url?: string | null;
  thumbnail_candidates?: Array<{ index: number; url: string }>;
  custom_thumbnail_set?: boolean;
}

interface ThumbnailCandidate { index: number; url: string; }

interface AnalyticsResponse {
  video: { id: string; title: string; total_views: number };
  views_by_day: Array<{ date: string; views: number }>;
  top_countries: Array<{ country: string; count: number }>;
  top_devices: Array<{ device: string; count: number }>;
  avg_watch_duration: number;
}

interface Subtitle {
  id: number;
  language: string;
  label: string;
  file_url: string;
  is_default: boolean;
}

interface SubtitleRow {
  id: string; // client-side unique key
  title: string; // language code like EN, JA, KO
  file: File | null;
  existingUrl?: string; // populated for already-saved subtitles
  existingLang?: string; // original language for existing subtitles
}

interface VideoDetailProps {
  videoId: string;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ready: "bg-success/10 text-success",
    processing: "bg-[#e8a817]/10 text-[#e8a817]",
    error: "bg-error/10 text-error",
    uploading: "bg-primary/10 text-primary",
  };
  const cls = styles[status] ?? "bg-surface-low text-on-surface-var";
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Thumbnail picker — 3 auto-generated candidates + custom upload, with the
// currently-active one highlighted. Selecting a candidate or uploading an
// image hits the server and calls onChange with the new thumbnail_url.
// ---------------------------------------------------------------------------

function ThumbnailPicker({
  videoId,
  currentThumbnailUrl,
  candidates,
  customSet,
  onChange,
}: {
  videoId: string;
  currentThumbnailUrl: string;
  candidates: ThumbnailCandidate[];
  customSet: boolean;
  onChange: (newUrl: string, custom: boolean) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function pickCandidate(idx: number) {
    setBusy(`cand-${idx}`);
    setError(null);
    try {
      const r = await fetch(`/api/videos/${videoId}/thumbnail/candidate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidate: idx }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed');
      const j = await r.json();
      onChange(j.thumbnail_url + '?t=' + Date.now(), !!j.custom);
    } catch (e: any) {
      setError(e.message || 'Failed to pick candidate');
    } finally {
      setBusy(null);
    }
  }

  async function uploadCustom(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }
    // Match the server's multer limit so users get instant feedback instead of
    // a 10 MB round-trip. Keep in sync with middleware/upload.js.
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setError('Image must be under 10 MB');
      return;
    }
    setBusy('upload');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('thumbnail', file);
      const r = await fetch(`/api/videos/${videoId}/thumbnail`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Upload failed');
      const j = await r.json();
      onChange(j.thumbnail_url + '?t=' + Date.now(), !!j.custom);
    } catch (e: any) {
      setError(e.message || 'Upload failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-card bg-surface-card p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-on-surface">Thumbnail</h2>
        {customSet && (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            Custom
          </span>
        )}
      </div>

      {/* Candidate grid */}
      {candidates.length > 0 && (
        <>
          <p className="mb-2 text-[11.5px] text-on-surface-var">Pick an auto-generated frame</p>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {[1, 2, 3].map((idx) => {
              const cand = candidates.find(c => c.index === idx);
              const active = !customSet && cand && currentThumbnailUrl.split('?')[0] === cand.url.split('?')[0];
              return (
                <button
                  key={idx}
                  onClick={() => cand && pickCandidate(idx)}
                  disabled={!cand || !!busy}
                  className={`relative aspect-video overflow-hidden rounded-md border-2 transition ${
                    active ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-on-surface/20'
                  } ${!cand ? 'cursor-not-allowed bg-surface-low/50' : ''}`}
                >
                  {cand ? (
                    <img src={cand.url} alt={`Candidate ${idx}`} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-on-surface-var">—</div>
                  )}
                  {busy === `cand-${idx}` && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <span className="material-symbols-outlined animate-spin text-white text-[18px]">progress_activity</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Upload custom */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCustom(f); e.target.value = ''; }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!!busy}
          className="flex-1 rounded-btn border border-on-surface/15 bg-surface-card px-3 py-2 text-[12.5px] font-medium text-on-surface-var transition hover:bg-surface-low disabled:opacity-50"
        >
          {busy === 'upload' ? 'Uploading...' : customSet ? 'Replace custom image' : 'Upload custom image'}
        </button>
      </div>

      {error && <p className="mt-2 text-[11.5px] text-error">{error}</p>}
      {!candidates.length && !customSet && (
        <p className="mt-2 text-[11.5px] text-on-surface-var">
          Candidates will appear after encoding completes.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VideoDetail({ videoId, onBack }: VideoDetailProps) {
  // Video state
  const [video, setVideo] = useState<VideoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Analytics state
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // Hover state for chart
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  // Clipboard
  const [copied, setCopied] = useState(false);

  // Subtitle state
  const [subtitleRows, setSubtitleRows] = useState<SubtitleRow[]>([]);
  const [savingSubs, setSavingSubs] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // ------ Fetch video details ------
  const fetchVideo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get<VideoResponse>(`/videos/${videoId}`);
      setVideo(data);
      setTitle(data.title);
      setDescription(data.description ?? "");
      setVisibility(data.visibility ?? "public");
      const tags = data.tags;
      if (Array.isArray(tags)) {
        setTagsInput(tags.join(", "));
      } else if (typeof tags === "string") {
        setTagsInput(tags);
      } else {
        setTagsInput("");
      }
    } catch (err: any) {
      setError(String(err?.message ?? "Failed to load video"));
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  // ------ Fetch analytics ------
  const fetchAnalytics = useCallback(async () => {
    try {
      setAnalyticsLoading(true);
      const data = await api.get<AnalyticsResponse>(`/analytics/videos/${videoId}`);
      setAnalytics(data);
    } catch {
      // analytics failure is non-fatal
    } finally {
      setAnalyticsLoading(false);
    }
  }, [videoId]);

  // ------ Fetch subtitles ------
  const fetchSubtitles = useCallback(async () => {
    try {
      const data = await api.get<Subtitle[]>(`/videos/${videoId}/subtitles`);
      const rows: SubtitleRow[] = data.map((sub) => ({
        id: `existing-${sub.language}`,
        title: sub.language.toUpperCase(),
        file: null,
        existingUrl: sub.file_url,
        existingLang: sub.language,
      }));
      setSubtitleRows(rows);
    } catch (err) {
      console.error("Failed to fetch subtitles:", err);
    }
  }, [videoId]);

  useEffect(() => {
    fetchVideo();
    fetchAnalytics();
    fetchSubtitles();
  }, [fetchVideo, fetchAnalytics, fetchSubtitles]);

  // ------ Save ------
  const handleSave = async () => {
    setSaving(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.put(`/videos/${videoId}`, { title, description, visibility, tags });
      setToast("Changes saved successfully");
      setTimeout(() => setToast(null), 3000);
      fetchVideo();
    } catch (err: any) {
      setToast(String(err?.message ?? "Failed to save changes"));
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  // ------ Subtitle row helpers ------
  const addSubtitleRow = () => {
    setSubtitleRows((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, title: "", file: null },
    ]);
  };

  const updateSubtitleRow = (id: string, updates: Partial<SubtitleRow>) => {
    setSubtitleRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates } : r))
    );
  };

  const removeSubtitleRow = (id: string) => {
    setSubtitleRows((prev) => prev.filter((r) => r.id !== id));
  };

  // ------ Drag reorder ------
  const handleDragStart = (idx: number) => {
    setDragIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    setSubtitleRows((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  };

  // ------ Save all subtitles (bulk) ------
  const handleSaveSubtitles = async () => {
    setSavingSubs(true);
    try {
      // 1. Delete existing subtitles that were removed from the list
      const existingData = await api.get<Subtitle[]>(`/videos/${videoId}/subtitles`);
      const currentLangs = new Set(
        subtitleRows.map((r) => (r.existingLang || r.title.trim().toLowerCase()).toLowerCase())
      );
      for (const sub of existingData) {
        if (!currentLangs.has(sub.language.toLowerCase())) {
          await api.delete(`/videos/${videoId}/subtitles/${sub.language}`);
        }
      }

      // 2. Upload all rows that have a file (new or replacement)
      let uploaded = 0;
      let failed = 0;
      for (const row of subtitleRows) {
        if (row.file && row.title.trim()) {
          const formData = new FormData();
          formData.append("subtitle", row.file);
          formData.append("lang", row.title.trim().toLowerCase());
          formData.append("label", row.title.trim().toUpperCase());
          const res = await fetch(`/api/videos/${videoId}/subtitles`, {
            method: "POST",
            credentials: "include",
            body: formData,
          });
          if (res.ok) {
            uploaded++;
          } else {
            failed++;
            console.error("Subtitle upload failed:", row.title, await res.text());
          }
        }
      }

      if (failed > 0) {
        setToast(`${uploaded} uploaded, ${failed} failed`);
      } else {
        setToast(`Subtitles saved${uploaded > 0 ? ` (${uploaded} uploaded)` : ""}`);
      }
      setTimeout(() => setToast(null), 3000);
      await fetchSubtitles();
    } catch (err) {
      console.error("Save subtitles error:", err);
      setToast("Failed to save subtitles");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSavingSubs(false);
    }
  };

  // ------ Copy embed code ------
  const embedCode = `<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/embed/${videoId}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  const copyEmbed = async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  // ------ Analytics helpers ------
  const maxViews = analytics
    ? Math.max(...analytics.views_by_day.map((d) => d.views), 1)
    : 1;

  const totalCountries = analytics
    ? analytics.top_countries.reduce((s, c) => s + c.count, 0)
    : 1;

  const totalDevices = analytics
    ? analytics.top_devices.reduce((s, d) => s + d.count, 0)
    : 1;

  // ------ Loading / Error states ------
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-on-surface-var/20 border-t-primary" />
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <p className="text-on-surface-var">{error ?? "Video not found"}</p>
        <button onClick={onBack} className="text-primary hover:text-primary-dim text-sm font-medium">
          &larr; Back to Videos
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-btn bg-on-surface px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="border-b border-on-surface/5 bg-surface-card px-6 py-4">
        <button
          onClick={onBack}
          className="mb-2 flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-dim"
        >
          &larr; Back to Videos
        </button>
        <h1 className="text-xl font-bold text-on-surface">{video.title}</h1>
      </div>

      {/* Two-column layout */}
      <div className="mx-auto max-w-7xl p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ================================================================ */}
          {/* LEFT COLUMN - Video Details & Edit                               */}
          {/* ================================================================ */}
          <div className="space-y-6 lg:col-span-1">
            {/* Thumbnail placeholder */}
            <div className="aspect-video overflow-hidden rounded-card bg-black">
              <iframe
                src={`/v/${videoId}`}
                className="h-full w-full"
                allowFullScreen
                allow="autoplay"
                frameBorder="0"
              />
            </div>

            {/* Thumbnail picker (custom + 3 candidates) */}
            <ThumbnailPicker
              videoId={videoId}
              currentThumbnailUrl={video.thumbnail_url || ''}
              candidates={video.thumbnail_candidates || []}
              customSet={!!video.custom_thumbnail_set}
              onChange={(newUrl, custom) => {
                setVideo({ ...video, thumbnail_url: newUrl, custom_thumbnail_set: custom });
              }}
            />

            {/* Status + file info */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-on-surface">Status</span>
                <StatusBadge status={video.status} />
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-on-surface-var">File size</span>
                  <span className="text-on-surface">{formatSize(video.file_size)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-var">Duration</span>
                  <span className="text-on-surface">{formatDuration(video.duration)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-var">Upload date</span>
                  <span className="text-on-surface">
                    {new Date(video.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Edit form */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-4 text-base font-semibold text-on-surface">Edit Details</h2>
              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Video title"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="Add a description..."
                  />
                </div>

                {/* Visibility */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">
                    Visibility
                  </label>
                  <select
                    value={visibility}
                    onChange={(e) => setVisibility(e.target.value)}
                    className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="public">Public</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="private">Private</option>
                  </select>
                </div>

                {/* Tags */}
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Tags</label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="tag1, tag2, tag3"
                  />
                  <p className="mt-1 text-xs text-on-surface-var">Separate tags with commas</p>
                </div>

                {/* Save */}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full rounded-btn bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] transition-all hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>

            {/* Subtitles */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-4 text-base font-semibold text-on-surface">Subtitles</h2>

              {/* Header row */}
              {subtitleRows.length > 0 && (
                <div className="mb-2 grid grid-cols-[24px_80px_1fr_1fr_60px] items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-on-surface-var">
                  <span>#</span>
                  <span>Title</span>
                  <span>File</span>
                  <span>Status</span>
                  <span>Control</span>
                </div>
              )}

              {/* Subtitle rows */}
              <div className="space-y-1">
                {subtitleRows.map((row, idx) => (
                  <div
                    key={row.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    className={`grid grid-cols-[24px_80px_1fr_1fr_60px] items-center gap-2 rounded-btn border px-2 py-2 transition-colors ${
                      dragOverIdx === idx
                        ? "border-primary bg-primary/10"
                        : "border-on-surface/5 bg-surface-low"
                    } ${dragIdx === idx ? "opacity-50" : ""}`}
                  >
                    {/* Drag handle */}
                    <span className="flex cursor-grab items-center justify-center text-on-surface-var hover:text-on-surface">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <circle cx="4" cy="2" r="1" />
                        <circle cx="8" cy="2" r="1" />
                        <circle cx="4" cy="6" r="1" />
                        <circle cx="8" cy="6" r="1" />
                        <circle cx="4" cy="10" r="1" />
                        <circle cx="8" cy="10" r="1" />
                      </svg>
                    </span>

                    {/* Title input */}
                    <input
                      type="text"
                      value={row.title}
                      onChange={(e) =>
                        updateSubtitleRow(row.id, { title: e.target.value.toUpperCase() })
                      }
                      className="rounded border-0 bg-surface-card px-2 py-1 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="EN"
                    />

                    {/* File picker */}
                    <input
                      type="file"
                      accept=".vtt,.srt"
                      onChange={(e) =>
                        updateSubtitleRow(row.id, { file: e.target.files?.[0] ?? null })
                      }
                      className="text-xs text-on-surface-var file:mr-1 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/20"
                    />

                    {/* Status / existing URL */}
                    <span className="truncate text-xs text-on-surface-var">
                      {row.file
                        ? row.file.name
                        : row.existingUrl
                        ? row.existingUrl.split("/").pop()
                        : "No file"}
                    </span>

                    {/* Remove button */}
                    <button
                      onClick={() => removeSubtitleRow(row.id)}
                      className="rounded-btn bg-error/10 px-2 py-1 text-xs font-medium text-error hover:bg-error/20"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              {/* Supported formats note */}
              <p className="mt-3 text-xs text-on-surface-var">
                Only vtt, srt, ass, sub file types are supported.
              </p>

              {/* Add new subtitle button */}
              <button
                onClick={addSubtitleRow}
                className="mt-3 w-full rounded-btn border-2 border-dashed border-on-surface/15 px-4 py-2 text-sm font-medium text-on-surface-var hover:border-primary hover:text-primary"
              >
                New Subtitle +
              </button>

              {/* Save / Reset buttons */}
              {subtitleRows.length > 0 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    onClick={handleSaveSubtitles}
                    disabled={savingSubs}
                    className="rounded-btn bg-success px-4 py-2 text-sm font-medium text-white hover:bg-success/80 disabled:opacity-50"
                  >
                    {savingSubs ? "Saving..." : "Update"}
                  </button>
                  <button
                    onClick={fetchSubtitles}
                    className="rounded-btn bg-surface-low px-4 py-2 text-sm font-medium text-on-surface hover:bg-on-surface/10"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>

            {/* Embed code */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-3 text-base font-semibold text-on-surface">Embed Code</h2>
              <div className="relative">
                <pre className="overflow-x-auto rounded-btn bg-surface-low p-3 text-xs text-on-surface">
                  {embedCode}
                </pre>
                <button
                  onClick={copyEmbed}
                  className="mt-2 rounded-btn bg-gradient-to-r from-primary to-primary-dim px-3 py-1.5 text-xs font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)]"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>

          {/* ================================================================ */}
          {/* RIGHT COLUMN - Analytics                                         */}
          {/* ================================================================ */}
          <div className="space-y-6 lg:col-span-2">
            {analyticsLoading ? (
              <div className="flex min-h-[300px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-on-surface-var/20 border-t-primary" />
              </div>
            ) : analytics ? (
              <>
                {/* Stat cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-card bg-surface-card p-4 shadow-card">
                    <p className="text-sm text-on-surface-var">Total Views</p>
                    <p className="mt-1 text-2xl font-bold text-primary">
                      {analytics.video.total_views.toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-card bg-surface-card p-4 shadow-card">
                    <p className="text-sm text-on-surface-var">Avg Watch Time</p>
                    <p className="mt-1 text-2xl font-bold text-primary">
                      {formatDuration(analytics.avg_watch_duration)}
                    </p>
                  </div>
                  <div className="rounded-card bg-surface-card p-4 shadow-card">
                    <p className="text-sm text-on-surface-var">Top Country</p>
                    <p className="mt-1 text-2xl font-bold text-primary">
                      {analytics.top_countries[0]?.country ?? "N/A"}
                    </p>
                  </div>
                  <div className="rounded-card bg-surface-card p-4 shadow-card">
                    <p className="text-sm text-on-surface-var">Top Device</p>
                    <p className="mt-1 text-2xl font-bold text-primary">
                      {analytics.top_devices[0]?.device ?? "N/A"}
                    </p>
                  </div>
                </div>

                {/* Views chart (last 30 days) */}
                <div className="rounded-card bg-surface-card p-6 shadow-card">
                  <h2 className="mb-4 text-base font-semibold text-on-surface">
                    Views &mdash; Last 30 Days
                  </h2>
                  <div className="flex h-48 items-end gap-[2px]">
                    {analytics.views_by_day.slice(-30).map((day, i) => {
                      const pct = (day.views / maxViews) * 100;
                      return (
                        <div
                          key={day.date}
                          className="relative flex flex-1 justify-center"
                          onMouseEnter={() => setHoveredBar(i)}
                          onMouseLeave={() => setHoveredBar(null)}
                        >
                          {/* Tooltip */}
                          {hoveredBar === i && (
                            <div className="absolute -top-10 z-10 whitespace-nowrap rounded bg-on-surface px-2 py-1 text-xs text-white shadow">
                              {day.date}: {day.views.toLocaleString()} views
                            </div>
                          )}
                          <div
                            className="w-full rounded-t bg-primary transition-opacity hover:opacity-80"
                            style={{ height: `${Math.max(pct, 2)}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Top Countries */}
                <div className="rounded-card bg-surface-card p-6 shadow-card">
                  <h2 className="mb-4 text-base font-semibold text-on-surface">Top Countries</h2>
                  <div className="space-y-3">
                    {analytics.top_countries.map((c) => {
                      const pct = totalCountries > 0 ? (c.count / totalCountries) * 100 : 0;
                      return (
                        <div key={c.country}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="text-on-surface">{c.country}</span>
                            <span className="text-on-surface-var">
                              {c.count.toLocaleString()} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-surface-low">
                            <div
                              className="h-2 rounded-full bg-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Device Breakdown */}
                <div className="rounded-card bg-surface-card p-6 shadow-card">
                  <h2 className="mb-4 text-base font-semibold text-on-surface">Device Breakdown</h2>
                  <div className="space-y-3">
                    {analytics.top_devices.map((d) => {
                      const pct = totalDevices > 0 ? (d.count / totalDevices) * 100 : 0;
                      return (
                        <div key={d.device}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="text-on-surface">{d.device}</span>
                            <span className="text-on-surface-var">
                              {d.count.toLocaleString()} ({pct.toFixed(1)}%)
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-surface-low">
                            <div
                              className="h-2 rounded-full bg-tertiary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[300px] items-center justify-center rounded-card bg-surface-card shadow-card">
                <p className="text-on-surface-var">Analytics data unavailable</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
