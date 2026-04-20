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
  const [dropActive, setDropActive] = useState(false);
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

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDropActive(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDropActive(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDropActive(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!file) {
      setError("Drop a PNG, JPG, WEBP, or GIF image");
      return;
    }
    uploadCustom(file);
  };

  return (
    <div
      className={`relative rounded-card bg-surface-card p-6 shadow-card transition-all ${
        dropActive ? "ring-2 ring-primary ring-offset-2" : ""
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-card bg-primary/10 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-[10px] bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-lg">
            <span className="material-symbols-outlined text-[16px]">file_download</span>
            Drop image to upload
          </div>
        </div>
      )}
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
          accept="image/png,image/jpeg,image/webp,image/gif"
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

      <p className="mt-2 text-[11.5px] text-on-surface-var">
        PNG, JPG, WEBP or GIF · up to 10 MB · drag &amp; drop supported
      </p>

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

  // Chapter state
  const [chapters, setChapters] = useState<{ time: string; title: string }[]>([]);
  const [savingChapters, setSavingChapters] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"overview" | "analytics" | "settings" | "embed">("overview");

  // Per-video settings state
  const [publishedAt, setPublishedAt] = useState("");
  const [geoMode, setGeoMode] = useState<"off" | "allowlist" | "blocklist">("off");
  const [geoCountries, setGeoCountries] = useState("");
  const [allowedDomains, setAllowedDomains] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [rotatingKey, setRotatingKey] = useState(false);

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
      // Per-video settings (fields live on the video record but aren't in VideoResponse type)
      const v: Record<string, unknown> = data as unknown as Record<string, unknown>;
      const pubAt = v.published_at;
      setPublishedAt(typeof pubAt === "string" ? new Date(pubAt).toISOString().slice(0, 16) : "");
      const g = v.geo_restriction as { mode?: string; countries?: string[] } | null | undefined;
      if (g && (g.mode === "allowlist" || g.mode === "blocklist")) {
        setGeoMode(g.mode);
        setGeoCountries((g.countries ?? []).join(", "));
      } else {
        setGeoMode("off");
        setGeoCountries("");
      }
      const d = v.allowed_domains;
      setAllowedDomains(Array.isArray(d) ? d.join(", ") : (typeof d === "string" ? d : ""));
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

  // ------ Fetch chapters ------
  const fetchChapters = useCallback(async () => {
    try {
      const data = await api.get<{ chapters: { time: string; title: string }[] }>(`/videos/${videoId}/chapters`);
      setChapters(data.chapters ?? []);
    } catch (err) {
      console.error("Failed to fetch chapters:", err);
    }
  }, [videoId]);

  useEffect(() => {
    fetchVideo();
    fetchAnalytics();
    fetchSubtitles();
    fetchChapters();
  }, [fetchVideo, fetchAnalytics, fetchSubtitles, fetchChapters]);

  // ------ Chapter helpers ------
  const addChapter = () => {
    setChapters((prev) => [...prev, { time: "00:00", title: "" }]);
  };
  const updateChapter = (idx: number, patch: Partial<{ time: string; title: string }>) => {
    setChapters((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  };
  const removeChapter = (idx: number) => {
    setChapters((prev) => prev.filter((_, i) => i !== idx));
  };
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const countries = geoCountries
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
        geo_restriction: geoMode === "off" ? null : { mode: geoMode, countries },
        allowed_domains: allowedDomains
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean),
      };
      await api.put(`/videos/${videoId}`, body);
      setToast("Settings saved");
      setTimeout(() => setToast(null), 2500);
      fetchVideo();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setToast(err.message ?? "Failed to save settings");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRotateKey = async () => {
    if (!confirm("Rotate the encryption key for this video? Viewers currently watching may need to reload.")) return;
    setRotatingKey(true);
    try {
      await api.post(`/videos/${videoId}/rotate-key`);
      setToast("Encryption key rotated");
      setTimeout(() => setToast(null), 2500);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setToast(err.message ?? "Failed to rotate key");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setRotatingKey(false);
    }
  };

  const handleSaveChapters = async () => {
    setSavingChapters(true);
    try {
      await api.put(`/videos/${videoId}/chapters`, { chapters });
      setToast("Chapters saved");
      setTimeout(() => setToast(null), 2500);
      fetchChapters();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setToast(err.message ?? "Failed to save chapters");
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSavingChapters(false);
    }
  };

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

  // Auto-detect ISO language code from filenames like "movie.en.srt" or "subs-es.vtt"
  const languageFromFilename = (name: string): string => {
    const base = name.toLowerCase().replace(/\.(srt|vtt|ass|sub)$/i, "");
    const m = base.match(/[.\-_]([a-z]{2,3})$/);
    return m ? m[1].toUpperCase() : "";
  };

  const SUB_EXT_RE = /\.(srt|vtt|ass|sub)$/i;
  const MAX_SUB_BYTES = 2 * 1024 * 1024; // 2 MB

  const validateAndAddSubtitleFiles = (files: File[]) => {
    const accepted: File[] = [];
    let rejected = 0;
    for (const f of files) {
      if (!SUB_EXT_RE.test(f.name)) { rejected++; continue; }
      if (f.size > MAX_SUB_BYTES) { rejected++; continue; }
      accepted.push(f);
    }
    if (accepted.length === 0) {
      setToast(rejected > 0 ? "Unsupported file — use .srt .vtt .ass .sub (max 2 MB)" : "No files dropped");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setSubtitleRows((prev) => [
      ...prev,
      ...accepted.map((f) => ({
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: languageFromFilename(f.name),
        file: f,
      })),
    ]);
    if (rejected > 0) {
      setToast(`Added ${accepted.length} · skipped ${rejected} unsupported`);
      setTimeout(() => setToast(null), 3000);
    }
  };

  // Per-row OS-file drop (replaces just that row's file). Distinguished from
  // internal reorder drag by checking dataTransfer.types for "Files".
  const handleRowFileDrop = (e: React.DragEvent, rowId: string) => {
    if (!e.dataTransfer.types.includes("Files")) return; // internal reorder — let handleDrop run
    e.preventDefault();
    e.stopPropagation();
    const file = Array.from(e.dataTransfer.files).find((f) => SUB_EXT_RE.test(f.name) && f.size <= MAX_SUB_BYTES);
    if (!file) {
      setToast("Unsupported file — use .srt .vtt .ass .sub (max 2 MB)");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    updateSubtitleRow(rowId, { file });
    setDragOverIdx(null);
  };

  // "New Subtitle +" zone OS-file drop
  const [subDropActive, setSubDropActive] = useState(false);
  const handleNewSubtitleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSubDropActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) validateAndAddSubtitleFiles(files);
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <button
              onClick={onBack}
              className="mb-2 flex items-center gap-1 text-sm font-medium text-primary hover:text-primary-dim"
            >
              &larr; Back to Videos
            </button>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-on-surface">{video.title}</h1>
              <StatusBadge status={video.status} />
            </div>
          </div>
          <button
            onClick={() => {
              const link = `${window.location.origin}/embed/${videoId}`;
              navigator.clipboard.writeText(link).then(() => {
                setToast("Share link copied");
                setTimeout(() => setToast(null), 2000);
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-btn bg-surface-low px-3 py-2 text-[12.5px] font-semibold text-primary hover:bg-surface-high"
          >
            <span className="material-symbols-outlined text-[15px]">share</span>
            Share
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 rounded-[10px] bg-surface-low p-1 w-fit">
          {([
            { key: "overview",  label: "Overview",  icon: "visibility" },
            { key: "analytics", label: "Analytics", icon: "analytics" },
            { key: "settings",  label: "Settings",  icon: "tune" },
            { key: "embed",     label: "Embed",     icon: "code" },
          ] as const).map((t) => {
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] transition-all"
                style={
                  active
                    ? { background: "rgb(var(--surface-card-rgb))", color: "rgb(var(--on-surface-rgb))", fontWeight: 700, boxShadow: "0 1px 3px rgba(0,0,0,.08)" }
                    : { background: "transparent", color: "rgb(var(--on-surface-var-rgb))", fontWeight: 500 }
                }
              >
                <span className="material-symbols-outlined text-[14px]">{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="mx-auto max-w-7xl p-6">
        {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* ================================================================ */}
          {/* LEFT COLUMN — player + file info + Chapters + Subtitles         */}
          {/* ================================================================ */}
          <div className="space-y-6 lg:col-span-2">
            {/* Video player */}
            <div className="aspect-video overflow-hidden rounded-card bg-black">
              <iframe
                src={`/v/${videoId}`}
                className="h-full w-full"
                allowFullScreen
                allow="autoplay"
                frameBorder="0"
              />
            </div>

            {/* File info strip — horizontal 3-col (File size · Duration · Uploaded) */}
            <div className="rounded-card bg-surface-card shadow-card grid grid-cols-3 divide-x divide-on-surface/5">
              <div className="flex flex-col items-center justify-center py-4 px-3">
                <span className="text-[9.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">File Size</span>
                <span className="mt-1 text-[15px] font-bold text-on-surface">{formatSize(video.file_size)}</span>
              </div>
              <div className="flex flex-col items-center justify-center py-4 px-3">
                <span className="text-[9.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Duration</span>
                <span className="mt-1 text-[15px] font-bold text-on-surface">{formatDuration(video.duration)}</span>
              </div>
              <div className="flex flex-col items-center justify-center py-4 px-3">
                <span className="text-[9.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Uploaded</span>
                <span className="mt-1 text-[15px] font-bold text-on-surface">
                  {new Date(video.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Chapters */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-on-surface">Chapters</h2>
                <div className="flex items-center gap-2">
                  {chapters.length > 0 && (
                    <button
                      onClick={handleSaveChapters}
                      disabled={savingChapters}
                      className="inline-flex items-center gap-1 rounded-btn bg-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[15px] font-normal">save</span>
                      {savingChapters ? "Saving…" : "Save"}
                    </button>
                  )}
                  <button
                    onClick={addChapter}
                    className="inline-flex items-center gap-1 rounded-btn bg-surface-low px-3 py-1.5 text-[12px] font-semibold text-on-surface hover:bg-surface-high"
                  >
                    <span className="material-symbols-outlined text-[15px] font-normal">add</span>
                    Add chapter
                  </button>
                </div>
              </div>

              {chapters.length === 0 ? (
                <div className="rounded-btn bg-surface-low/60 py-8 text-center text-[13px] text-on-surface-var">
                  <span className="material-symbols-outlined text-[24px] font-normal opacity-50 block mb-1">format_list_numbered</span>
                  No chapters yet — add one to mark sections in the player.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {chapters.map((c, idx) => (
                    <div key={idx} className="grid grid-cols-[90px_1fr_auto] items-center gap-2 rounded-btn bg-surface-low px-2 py-2">
                      <input
                        type="text"
                        value={c.time}
                        onChange={(e) => updateChapter(idx, { time: e.target.value })}
                        placeholder="00:00"
                        className="rounded border-0 bg-surface-card px-2 py-1 font-mono text-[12.5px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <input
                        type="text"
                        value={c.title}
                        onChange={(e) => updateChapter(idx, { title: e.target.value })}
                        placeholder="Chapter title"
                        className="rounded border-0 bg-surface-card px-2 py-1 text-[13px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        onClick={() => removeChapter(idx)}
                        title="Remove chapter"
                        aria-label="Remove chapter"
                        className="flex items-center justify-center w-[28px] h-[28px] rounded-btn text-error hover:bg-error/10"
                      >
                        <span className="material-symbols-outlined text-[16px] font-normal">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Subtitles */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-2 text-base font-semibold text-on-surface">Subtitles</h2>
              <p className="mb-3 text-xs text-on-surface-var">Only vtt, srt, ass, sub and zip/rar/7z file types are supported.</p>

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
                    onDrop={(e) => {
                      if (e.dataTransfer.types.includes("Files")) {
                        handleRowFileDrop(e, row.id);
                      } else {
                        handleDrop(idx);
                      }
                    }}
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

              {/* Add new subtitle — dashed drop zone (click OR drop files) */}
              <div
                role="button"
                tabIndex={0}
                onClick={addSubtitleRow}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); addSubtitleRow(); } }}
                onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setSubDropActive(true); } }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setSubDropActive(true); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSubDropActive(false); }}
                onDrop={handleNewSubtitleDrop}
                className={`mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-[12px] border-2 border-dashed px-4 py-5 text-sm font-medium transition-colors ${
                  subDropActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-on-surface/15 text-on-surface-var hover:border-primary hover:bg-surface-low hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{subDropActive ? "file_download" : "add"}</span>
                {subDropActive ? "Drop subtitle files here" : "New Subtitle + or drop files here"}
              </div>

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

          </div>

          {/* ================================================================ */}
          {/* RIGHT COLUMN — Edit Details + Custom Thumbnail + Embed Code     */}
          {/* ================================================================ */}
          <div className="space-y-6 lg:col-span-1">
            {/* Edit Details */}
            {(() => {
              const dirty = !!video && (title !== (video.title ?? "") || description !== (video.description ?? ""));
              return (
                <div className="rounded-card bg-surface-card p-6 shadow-card">
                  <h2 className="mb-4 text-base font-semibold text-on-surface">Edit Details</h2>
                  <div className="space-y-4">
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
                    <div>
                      <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Description</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                        className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                        placeholder="Add a description..."
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      {dirty ? (
                        <span className="unsaved-indicator">Unsaved changes</span>
                      ) : (
                        <span />
                      )}
                      <button
                        onClick={handleSave}
                        disabled={saving || !dirty}
                        className="rounded-btn bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] transition-all hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Custom Thumbnail */}
            <ThumbnailPicker
              videoId={videoId}
              currentThumbnailUrl={video.thumbnail_url || ''}
              candidates={video.thumbnail_candidates || []}
              customSet={!!video.custom_thumbnail_set}
              onChange={(newUrl, custom) => {
                setVideo({ ...video, thumbnail_url: newUrl, custom_thumbnail_set: custom });
              }}
            />

            {/* Embed Code */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-on-surface">Embed Code</h2>
                <button
                  onClick={() => setActiveTab("embed")}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary hover:text-primary-dim"
                >
                  <span className="material-symbols-outlined text-[14px]">tune</span>
                  Customize
                </button>
              </div>
              <pre className="overflow-x-auto rounded-btn bg-surface-low p-3 font-mono text-[11.5px] leading-relaxed text-on-surface">
                {embedCode}
              </pre>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={copyEmbed}
                  className="inline-flex items-center justify-center gap-1.5 rounded-btn bg-surface-low px-3 py-2 text-[12.5px] font-semibold text-primary hover:bg-surface-high"
                >
                  <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  {copied ? "Copied!" : "Copy iFrame"}
                </button>
                <button
                  onClick={() => {
                    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/embed/${videoId}`;
                    navigator.clipboard.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-btn bg-surface-low px-3 py-2 text-[12.5px] font-semibold text-primary hover:bg-surface-high"
                >
                  <span className="material-symbols-outlined text-[14px]">link</span>
                  Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
        )}

        {activeTab === "analytics" && (
          <div className="space-y-6">
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
        )}

        {activeTab === "settings" && (
          <div className="space-y-6 max-w-3xl">
            {/* Visibility + Tags */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-4 text-base font-semibold text-on-surface">Visibility &amp; Tags</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Visibility</label>
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
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-btn bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] transition-all hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>

            {/* Scheduled Publishing */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-1 text-base font-semibold text-on-surface">Scheduled Publishing</h2>
              <p className="mb-4 text-xs text-on-surface-var">Video will go live at this time. Leave blank to publish immediately.</p>
              <input
                type="datetime-local"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
                className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Geo-restriction */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-1 text-base font-semibold text-on-surface">Geo-restriction</h2>
              <p className="mb-4 text-xs text-on-surface-var">Restrict playback by viewer country (ISO 3166-1 alpha-2 codes, e.g. US, GB, DE).</p>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Mode</label>
                  <select
                    value={geoMode}
                    onChange={(e) => setGeoMode(e.target.value as "off" | "allowlist" | "blocklist")}
                    className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="off">Off (no restriction)</option>
                    <option value="allowlist">Allowlist (only these countries)</option>
                    <option value="blocklist">Blocklist (block these countries)</option>
                  </select>
                </div>
                {geoMode !== "off" && (
                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Country Codes</label>
                    <input
                      type="text"
                      value={geoCountries}
                      onChange={(e) => setGeoCountries(e.target.value)}
                      placeholder="US, GB, DE"
                      className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm font-mono text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Allowed Domains (hotlink) */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-1 text-base font-semibold text-on-surface">Allowed Domains</h2>
              <p className="mb-4 text-xs text-on-surface-var">Restrict embeds to specific domains. Leave blank to allow all.</p>
              <input
                type="text"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="example.com, docs.example.com"
                className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {/* Encryption */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-1 text-base font-semibold text-on-surface">Encryption</h2>
              <p className="mb-4 text-xs text-on-surface-var">Rotate the AES key used for HLS segment encryption. Clients currently playing may need to reload.</p>
              <button
                onClick={handleRotateKey}
                disabled={rotatingKey}
                className="inline-flex items-center gap-1.5 rounded-btn bg-surface-low px-4 py-2 text-sm font-semibold text-primary hover:bg-surface-high disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">key</span>
                {rotatingKey ? "Rotating..." : "Rotate Encryption Key"}
              </button>
            </div>

            {/* Save Settings */}
            <div className="flex justify-end">
              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="rounded-btn bg-gradient-to-r from-primary to-primary-dim px-5 py-2.5 text-sm font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] transition-all hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
              >
                {savingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "embed" && (
          <div className="space-y-6 max-w-3xl">
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-1 text-base font-semibold text-on-surface">Embed Code</h2>
              <p className="mb-4 text-xs text-on-surface-var">Copy and paste this snippet into any HTML page.</p>
              <pre className="overflow-x-auto rounded-btn bg-surface-low p-4 font-mono text-[12px] leading-relaxed text-on-surface">
                {embedCode}
              </pre>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  onClick={copyEmbed}
                  className="inline-flex items-center justify-center gap-1.5 rounded-btn bg-gradient-to-r from-primary to-primary-dim px-3 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)]"
                >
                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                  {copied ? "Copied!" : "Copy iFrame"}
                </button>
                <button
                  onClick={() => {
                    const link = `${window.location.origin}/embed/${videoId}`;
                    navigator.clipboard.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                  className="inline-flex items-center justify-center gap-1.5 rounded-btn bg-surface-low px-3 py-2.5 text-[13px] font-semibold text-primary hover:bg-surface-high"
                >
                  <span className="material-symbols-outlined text-[16px]">link</span>
                  Copy Direct Link
                </button>
              </div>
            </div>

            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h2 className="mb-1 text-base font-semibold text-on-surface">Direct URLs</h2>
              <p className="mb-4 text-xs text-on-surface-var">Share these URLs directly or integrate with your own player.</p>
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Player URL</label>
                  <input
                    type="text"
                    readOnly
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/embed/${videoId}`}
                    className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 font-mono text-[12px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-on-surface-var">Thumbnail URL</label>
                  <input
                    type="text"
                    readOnly
                    value={video.thumbnail_url || ""}
                    className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 font-mono text-[12px] text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
