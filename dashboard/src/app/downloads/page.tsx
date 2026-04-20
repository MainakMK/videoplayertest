"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";

interface Download {
  id: number;
  gid: string | null;
  name: string | null;
  magnet_uri: string | null;
  status: string;
  source_type?: string;
  storage_type?: string;
  total_size?: number;
  downloaded?: number;
  download_speed?: number;
  upload_speed?: number;
  num_seeders?: number;
  num_peers?: number;
  progress?: number;
  file_path?: string | null;
  error_message?: string | null;
  video_id?: string | null;
  created_at: string;
}

interface ListResponse {
  downloads: Download[];
  stats: { download_speed: number; upload_speed: number; active_count: number };
  aria2_connected: boolean;
}

const ACTIVE_STATUSES = new Set(["active", "waiting"]);

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatSpeed(bps?: number) {
  if (!bps || bps <= 0) return "—";
  return `${formatBytes(bps)}/s`;
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    active:     { bg: "#e3f2fd", fg: "#1976d2", label: "Downloading" },
    waiting:    { bg: "#fff3e0", fg: "#ef6c00", label: "Waiting" },
    paused:     { bg: "#f5f5f5", fg: "#596064", label: "Paused" },
    seeding:    { bg: "#e8f5e9", fg: "#2e7d32", label: "Seeding" },
    complete:   { bg: "#e8f5e9", fg: "#2e7d32", label: "Complete" },
    processing: { bg: "#e3f2fd", fg: "#1976d2", label: "Processing" },
    error:      { bg: "#fce4ec", fg: "#a8364b", label: "Error" },
    removed:    { bg: "#f5f5f5", fg: "#596064", label: "Removed" },
  };
  const s = map[status] || { bg: "#f5f5f5", fg: "#596064", label: status };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

export default function DownloadsPage() {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [stats, setStats] = useState({ download_speed: 0, upload_speed: 0, active_count: 0 });
  const [aria2Connected, setAria2Connected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [uri, setUri] = useState("");
  const [sourceTab, setSourceTab] = useState<"torrent" | "url" | "file">("torrent");
  const [processStorage, setProcessStorage] = useState<"local" | "r2">("local");
  const [processTargets, setProcessTargets] = useState<Download[] | null>(null);
  const [processBusy, setProcessBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Download | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "completed">("queue");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "error">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const pollRef = useRef<number | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchDownloads = useCallback(async () => {
    try {
      const data = await api.get<ListResponse>("/torrents");
      setDownloads(data.downloads || []);
      setStats(data.stats || { download_speed: 0, upload_speed: 0, active_count: 0 });
      setAria2Connected(!!data.aria2_connected);
    } catch {
      setAria2Connected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Adaptive polling: 1s while any active download is in flight, 3s when idle.
  const hasActive = downloads.some(d => d.status === "active" || d.status === "waiting");
  useEffect(() => {
    fetchDownloads();
    const interval = hasActive ? 1000 : 3000;
    pollRef.current = window.setInterval(fetchDownloads, interval);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [fetchDownloads, hasActive]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();

    if (sourceTab === "file") {
      if (!files.length) return;
      setSubmitting(true);
      try {
        const fd = new FormData();
        files.forEach(f => fd.append("torrents", f));
        fd.append("storage_type", "local");
        const r = await fetch("/api/torrents/add-file", {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Upload failed");
        const ok = j.created?.length || 0;
        const bad = j.failed?.length || 0;
        if (ok > 0 && bad === 0) { showToast(`${ok} torrent${ok > 1 ? "s" : ""} added`); setAddOpen(false); }
        else if (ok > 0 && bad > 0) showToast(`${ok} added, ${bad} failed`, "error");
        else showToast(j.failed?.[0]?.error || "All uploads failed", "error");
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        fetchDownloads();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : (err as { message?: string })?.message;
        showToast(msg || "Failed to upload torrents", "error");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const lines = uri.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    setSubmitting(true);
    try {
      const results = await Promise.allSettled(lines.map(line =>
        api.post("/torrents/add", { magnet_uri: line, storage_type: "local" })
      ));
      const ok = results.filter(r => r.status === "fulfilled").length;
      const bad = results.length - ok;
      if (ok > 0 && bad === 0) {
        showToast(`${ok} download${ok > 1 ? "s" : ""} added`);
        setUri("");
        setAddOpen(false);
      } else if (ok > 0 && bad > 0) {
        showToast(`${ok} added, ${bad} failed`, "error");
      } else {
        const first = results.find(r => r.status === "rejected") as PromiseRejectedResult | undefined;
        const msg = (first?.reason as { message?: string })?.message;
        showToast(msg || "All adds failed", "error");
      }
      fetchDownloads();
    } finally {
      setSubmitting(false);
    }
  };

  const onFilesPicked = (picked: FileList | File[]) => {
    const arr = Array.from(picked).filter(f => f.name.toLowerCase().endsWith(".torrent"));
    if (arr.length !== picked.length) {
      showToast("Only .torrent files accepted", "error");
    }
    if (arr.length) setFiles(prev => [...prev, ...arr]);
  };

  const handlePause = async (id: number) => {
    try { await api.post(`/torrents/${id}/pause`); fetchDownloads(); }
    catch { showToast("Failed to pause", "error"); }
  };

  const handleResume = async (id: number) => {
    try { await api.post(`/torrents/${id}/resume`); fetchDownloads(); }
    catch { showToast("Failed to resume", "error"); }
  };

  const handleProcess = (d: Download) => {
    setProcessStorage("local");
    setProcessTargets([d]);
  };

  const confirmProcess = async () => {
    if (!processTargets?.length) return;
    setProcessBusy(true);
    try {
      if (processTargets.length === 1) {
        await api.post(`/torrents/${processTargets[0].id}/process`, { storage_type: processStorage });
        showToast(`Processing started → ${processStorage === "r2" ? "R2" : "Local"} storage`);
      } else {
        const r = await api.post<{ ok: number[]; failed: { id: number; error: string }[] }>("/torrents/bulk", {
          action: "process",
          ids: processTargets.map(d => d.id),
          storage_type: processStorage,
        });
        const okN = r.ok?.length || 0;
        const badN = r.failed?.length || 0;
        if (okN && !badN) showToast(`${okN} download${okN > 1 ? "s" : ""} → ${processStorage === "r2" ? "R2" : "Local"}`);
        else if (okN && badN) showToast(`${okN} queued, ${badN} failed`, "error");
        else showToast(r.failed?.[0]?.error || "All process actions failed", "error");
        clearSelection();
      }
      setProcessTargets(null);
      fetchDownloads();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message;
      showToast(msg || "Failed to process", "error");
    } finally {
      setProcessBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/torrents/${deleteTarget.id}`);
      showToast("Download removed");
      setDeleteTarget(null);
      fetchDownloads();
    } catch {
      showToast("Failed to remove", "error");
    }
  };

  const queueAll = downloads.filter(d => ACTIVE_STATUSES.has(d.status) || d.status === "paused" || d.status === "error");
  const completed = downloads.filter(d => d.status === "complete" || d.status === "processing" || d.status === "seeding");

  const matchesStatusFilter = (d: Download) => {
    if (statusFilter === "all") return true;
    if (statusFilter === "active") return ACTIVE_STATUSES.has(d.status);
    if (statusFilter === "paused") return d.status === "paused";
    if (statusFilter === "error") return d.status === "error";
    return true;
  };
  const matchesSearch = (d: Download) => {
    if (!search.trim()) return true;
    return (d.name || "").toLowerCase().includes(search.toLowerCase());
  };
  const queueRows = queueAll.filter(d => matchesStatusFilter(d) && matchesSearch(d));
  const completedRows = completed.filter(matchesSearch);
  const visibleRows = activeTab === "queue" ? queueRows : completedRows;
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(d => selected.has(d.id));
  const selectedRows = visibleRows.filter(d => selected.has(d.id));

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (allVisibleSelected) setSelected(new Set());
    else setSelected(new Set(visibleRows.map(d => d.id)));
  };
  const clearSelection = () => setSelected(new Set());

  const runBulk = async (action: "pause" | "resume" | "remove" | "process") => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const r = await api.post<{ ok: number[]; failed: { id: number; error: string }[] }>("/torrents/bulk", {
        action,
        ids: [...selected],
      });
      const okN = r.ok?.length || 0;
      const badN = r.failed?.length || 0;
      if (okN && !badN) showToast(`${okN} download${okN > 1 ? "s" : ""} updated`);
      else if (okN && badN) showToast(`${okN} ok, ${badN} failed`, "error");
      else showToast(r.failed?.[0]?.error || "Bulk action failed", "error");
      clearSelection();
      fetchDownloads();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message;
      showToast(msg || "Bulk action failed", "error");
    } finally {
      setBulkBusy(false);
      setBulkRemoveOpen(false);
    }
  };

  // Reset selection when switching tabs / changing filters
  useEffect(() => { clearSelection(); }, [activeTab, statusFilter, search]);

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-tight" style={{ color: "rgb(var(--on-surface-rgb))" }}>
              Downloads
            </h1>
            <p className="text-[13px] mt-1" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
              Torrents and direct URLs queued for ingest into the video library.
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-4 mr-2">
              <Stat label="↓ Speed" value={formatSpeed(stats.download_speed)} />
              <Stat label="↑ Speed" value={formatSpeed(stats.upload_speed)} />
              <Stat label="Active" value={String(stats.active_count)} />
            </div>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] transition-all"
              style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))" }}
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              Add Download
            </button>
          </div>
        </div>

        {/* aria2 connection banner */}
        {aria2Connected === false && (
          <div
            className="mb-5 rounded-[10px] px-4 py-3 text-[13px] flex items-center gap-2"
            style={{ background: "#fce4ec", color: "#a8364b" }}
          >
            <span className="material-symbols-outlined text-[18px]">error</span>
            aria2 daemon is not running. Start it with: <code className="font-mono text-[12px]">aria2c --enable-rpc</code>
          </div>
        )}

        {/* Add Download modal */}
        {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]"
          style={{ background: "rgba(0,0,0,.45)" }}
          onClick={() => setAddOpen(false)}
        >
        <form
          onSubmit={handleAdd}
          onClick={(e) => e.stopPropagation()}
          className="rounded-[16px] w-full max-w-[640px] overflow-hidden"
          style={{ background: "rgb(var(--surface-card-rgb))", boxShadow: "0 24px 60px rgba(0,0,0,.25)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "rgb(var(--surface-high-rgb))" }}>
            <div>
              <h3 className="text-[17px] font-extrabold" style={{ color: "rgb(var(--on-surface-rgb))" }}>Add download</h3>
              <p className="text-[12px] mt-0.5" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                Magnet link, direct URL, or .torrent file — bulk paste supported.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              aria-label="Close"
              className="flex items-center justify-center w-[32px] h-[32px] rounded-[8px] shrink-0"
              style={{ color: "rgb(var(--on-surface-var-rgb))" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(var(--surface-high-rgb))"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {/* Source type segmented control */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>Source</label>
              <div className="flex gap-1 p-1 rounded-[10px] w-fit" style={{ background: "rgb(var(--surface-low-rgb))" }}>
                {[
                  { id: "torrent", icon: "bolt", label: "Magnet" },
                  { id: "url", icon: "link", label: "Direct URL" },
                  { id: "file", icon: "upload_file", label: ".torrent file" },
                ].map(t => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSourceTab(t.id as typeof sourceTab)}
                    className="flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold transition-all"
                    style={{
                      background: sourceTab === t.id ? "rgb(var(--surface-card-rgb))" : "transparent",
                      color: sourceTab === t.id ? "#5b5a8b" : "rgb(var(--on-surface-var-rgb))",
                      boxShadow: sourceTab === t.id ? "0 1px 3px rgba(0,0,0,.08)" : undefined,
                    }}
                  >
                    <span className="material-symbols-outlined text-[16px] font-normal">{t.icon}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                {sourceTab === "file" ? "Files" : sourceTab === "torrent" ? "Magnet links" : "URLs"}
              </label>
              {sourceTab === "file" ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); onFilesPicked(e.dataTransfer.files); }}
                  className="rounded-[10px] px-4 py-6 text-[13px] text-center cursor-pointer border-2 border-dashed transition-colors"
                  style={{
                    borderColor: dragOver ? "#5b5a8b" : "rgb(var(--surface-high-rgb))",
                    background: dragOver ? "rgba(91,90,139,.05)" : "rgb(var(--surface-low-rgb))",
                    color: "rgb(var(--on-surface-var-rgb))",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".torrent"
                    className="hidden"
                    onChange={(e) => { if (e.target.files) onFilesPicked(e.target.files); }}
                  />
                  {files.length === 0 ? (
                    <div className="flex flex-col items-center gap-1.5">
                      <span className="material-symbols-outlined text-[28px] font-normal opacity-60">upload_file</span>
                      <span className="font-medium" style={{ color: "rgb(var(--on-surface-rgb))" }}>Click to choose or drag-drop .torrent files</span>
                      <span className="text-[11px]">Up to 20 files, 10 MB each</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 justify-center">
                      {files.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1.5 py-1 text-[12px]" style={{ background: "rgb(var(--surface-card-rgb))", color: "rgb(var(--on-surface-rgb))", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
                          <span className="material-symbols-outlined text-[14px] font-normal" style={{ color: "#5b5a8b" }}>description</span>
                          {f.name}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setFiles(prev => prev.filter((_, j) => j !== i)); }}
                            className="flex items-center justify-center w-[18px] h-[18px] rounded-full"
                            style={{ background: "rgb(var(--surface-high-rgb))", color: "rgb(var(--on-surface-var-rgb))" }}
                          >
                            <span className="material-symbols-outlined text-[12px]">close</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder={sourceTab === "torrent"
                    ? "magnet:?xt=urn:btih:abc123…\nPaste one magnet link per line for bulk add"
                    : "https://example.com/video.mkv\nPaste one URL per line for bulk add"}
                  rows={4}
                  className="w-full rounded-[10px] px-3.5 py-2.5 text-[13px] outline-none border focus:border-[#5b5a8b] font-mono resize-y"
                  style={{
                    borderColor: "rgb(var(--surface-high-rgb))",
                    color: "rgb(var(--on-surface-rgb))",
                    background: "rgb(var(--surface-low-rgb))",
                    minHeight: "100px",
                    lineHeight: "20px",
                  }}
                />
              )}
              <p className="text-[11.5px] mt-2" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                {sourceTab === "torrent"
                  ? "Torrents are downloaded via aria2 then optionally processed into the video library."
                  : sourceTab === "url"
                  ? "Supports HTTP, HTTPS, and FTP. Files fetched with 16 parallel connections."
                  : "Each .torrent file is added to aria2 as a separate download."}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "rgb(var(--surface-high-rgb))", background: "rgb(var(--surface-low-rgb))" }}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-[8px] px-4 h-[34px] text-[12.5px] font-semibold"
                style={{ background: "transparent", color: "rgb(var(--on-surface-var-rgb))" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || (sourceTab === "file" ? files.length === 0 : !uri.trim())}
                className="rounded-[8px] px-4 h-[34px] text-[12.5px] font-bold text-white transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 2px 6px rgba(91,90,139,.3)" }}
              >
                <span className="material-symbols-outlined text-[16px] font-normal">download</span>
                {submitting ? "Adding…" :
                  sourceTab === "file" ? (files.length > 1 ? `Upload ${files.length}` : "Upload") :
                  "Add download"}
              </button>
            </div>
          </div>
        </form>
        </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-[13px]" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>Loading…</div>
        ) : (
          <>
            {/* Tabs */}
            <div className="flex items-center gap-1 mb-4 border-b" style={{ borderColor: "rgb(var(--surface-high-rgb))" }}>
              {[
                { id: "queue" as const, label: "In progress", count: queueAll.length },
                { id: "completed" as const, label: "Completed", count: completed.length },
              ].map(t => {
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className="relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-colors"
                    style={{ color: active ? "#5b5a8b" : "rgb(var(--on-surface-var-rgb))" }}
                  >
                    {t.label}
                    <span
                      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10.5px] font-bold tabular-nums"
                      style={{
                        background: active ? "#5b5a8b" : "rgb(var(--surface-high-rgb))",
                        color: active ? "white" : "rgb(var(--on-surface-var-rgb))",
                      }}
                    >
                      {t.count}
                    </span>
                    {active && <span className="absolute left-0 right-0 -bottom-px h-[2px]" style={{ background: "#5b5a8b" }} />}
                  </button>
                );
              })}
            </div>

            {/* Filter bar */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-[320px]">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px]" style={{ color: "rgb(var(--on-surface-var-rgb) / 0.6)" }}>search</span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search downloads…"
                  className="w-full rounded-[8px] pl-9 pr-3 h-[34px] text-[13px] outline-none border focus:border-[#5b5a8b]"
                  style={{ borderColor: "rgb(var(--surface-high-rgb))", color: "rgb(var(--on-surface-rgb))", background: "rgb(var(--surface-card-rgb))" }}
                />
              </div>
              {activeTab === "queue" && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  className="rounded-[8px] px-2.5 h-[34px] text-[12.5px] font-medium outline-none border"
                  style={{ borderColor: "rgb(var(--surface-high-rgb))", color: "rgb(var(--on-surface-rgb))", background: "rgb(var(--surface-card-rgb))" }}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Downloading</option>
                  <option value="paused">Paused</option>
                  <option value="error">Errored</option>
                </select>
              )}
              <span className="text-[12px] ml-auto" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                {visibleRows.length} {visibleRows.length === 1 ? "item" : "items"}
              </span>
            </div>

            {/* Bulk action bar (only when something selected) */}
            {selected.size > 0 && (
              <div
                className="flex items-center gap-3 rounded-[10px] px-3 py-2 mb-3"
                style={{ background: "rgba(91,90,139,.08)", border: "1px solid rgba(91,90,139,.18)" }}
              >
                <span className="text-[12.5px] font-bold" style={{ color: "#5b5a8b" }}>
                  {selected.size} selected
                </span>
                <button
                  onClick={clearSelection}
                  className="text-[11.5px] font-medium underline"
                  style={{ color: "#5b5a8b" }}
                >
                  Clear
                </button>
                <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                  {activeTab === "queue" && (
                    <>
                      <BulkBtn
                        icon="play_arrow"
                        label="Resume"
                        disabled={bulkBusy || !selectedRows.some(r => r.status === "paused")}
                        onClick={() => runBulk("resume")}
                      />
                      <BulkBtn
                        icon="pause"
                        label="Pause"
                        disabled={bulkBusy || !selectedRows.some(r => ACTIVE_STATUSES.has(r.status))}
                        onClick={() => runBulk("pause")}
                      />
                    </>
                  )}
                  {activeTab === "completed" && (
                    <BulkBtn
                      icon="movie"
                      label="Process to library"
                      primary
                      disabled={bulkBusy || !selectedRows.some(r => r.status === "complete")}
                      onClick={() => {
                        const eligible = selectedRows.filter(r => r.status === "complete");
                        if (!eligible.length) return;
                        setProcessStorage("local");
                        setProcessTargets(eligible);
                      }}
                    />
                  )}
                  <BulkBtn
                    icon="delete"
                    label="Remove"
                    danger
                    disabled={bulkBusy}
                    onClick={() => setBulkRemoveOpen(true)}
                  />
                </div>
              </div>
            )}

            {/* Header row with select-all */}
            {visibleRows.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 cursor-pointer accent-[#5b5a8b]"
                  aria-label="Select all"
                />
                <span>Select all visible</span>
              </div>
            )}

            {/* List */}
            <div className="space-y-2">
              {visibleRows.length === 0 ? (
                activeTab === "queue" ? (
                  search || statusFilter !== "all" ? (
                    <Empty icon="search_off" text="No downloads match the current filter." />
                  ) : (
                    <Empty icon="downloading" text="No active downloads. Click + Add Download to start." />
                  )
                ) : (
                  search ? (
                    <Empty icon="search_off" text="No completed downloads match this search." />
                  ) : (
                    <Empty icon="check_circle" text="No completed downloads yet." />
                  )
                )
              ) : (
                visibleRows.map((d) => (
                  <DownloadRow key={d.id}
                    d={d}
                    selected={selected.has(d.id)}
                    onToggleSelect={() => toggleSelect(d.id)}
                    onPause={() => handlePause(d.id)}
                    onResume={() => handleResume(d.id)}
                    onProcess={() => handleProcess(d)}
                    onDelete={() => setDeleteTarget(d)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 rounded-[10px] px-4 py-3 text-[13px] font-medium z-50"
          style={{
            background: toast.type === "success" ? "#2e7d32" : "#a8364b",
            color: "white",
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Process to library modal */}
      {processTargets && processTargets.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]"
          style={{ background: "rgba(0,0,0,.45)" }}
          onClick={() => !processBusy && setProcessTargets(null)}
        >
          <div
            className="rounded-[16px] w-full max-w-[560px] overflow-hidden"
            style={{ background: "rgb(var(--surface-card-rgb))", boxShadow: "0 24px 60px rgba(0,0,0,.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "rgb(var(--surface-high-rgb))" }}>
              <div>
                <h3 className="text-[17px] font-extrabold" style={{ color: "rgb(var(--on-surface-rgb))" }}>
                  Process to library
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                  {processTargets.length === 1
                    ? `Encode "${processTargets[0].name || "this download"}" and add it to Videos.`
                    : `Encode ${processTargets.length} downloads and add them to Videos.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !processBusy && setProcessTargets(null)}
                aria-label="Close"
                disabled={processBusy}
                className="flex items-center justify-center w-[32px] h-[32px] rounded-[8px] shrink-0 disabled:opacity-50"
                style={{ color: "rgb(var(--on-surface-var-rgb))" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(var(--surface-high-rgb))"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              <label className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                Storage destination
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: "local", icon: "dns", title: "Local disk", desc: "Stored on this server. Best for small libraries.", price: "Free" },
                  { id: "r2", icon: "cloud", title: "Cloudflare R2", desc: "Stored in your R2 bucket. Free egress for unlimited views.", price: "Storage cost" },
                ].map(opt => {
                  const active = processStorage === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setProcessStorage(opt.id as "local" | "r2")}
                      className="text-left rounded-[12px] p-4 border-2 transition-all"
                      style={{
                        borderColor: active ? "#5b5a8b" : "rgb(var(--surface-high-rgb))",
                        background: active ? "rgba(91,90,139,.06)" : "rgb(var(--surface-card-rgb))",
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div
                          className="flex items-center justify-center w-[34px] h-[34px] rounded-[9px]"
                          style={{ background: active ? "#5b5a8b" : "rgb(var(--surface-low-rgb))", color: active ? "white" : "rgb(var(--on-surface-rgb))" }}
                        >
                          <span className="material-symbols-outlined text-[18px] font-normal">{opt.icon}</span>
                        </div>
                        {active && (
                          <span className="material-symbols-outlined text-[20px] font-normal" style={{ color: "#5b5a8b" }}>check_circle</span>
                        )}
                      </div>
                      <div className="text-[13.5px] font-bold mb-0.5" style={{ color: "rgb(var(--on-surface-rgb))" }}>{opt.title}</div>
                      <div className="text-[11.5px] leading-snug" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>{opt.desc}</div>
                      <div className="text-[10.5px] font-bold uppercase tracking-wider mt-2" style={{ color: active ? "#5b5a8b" : "rgb(var(--on-surface-var-rgb) / 0.7)" }}>
                        {opt.price}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-[10px] px-3 py-2.5 text-[11.5px] flex items-start gap-2" style={{ background: "rgb(var(--surface-low-rgb))", color: "rgb(var(--on-surface-var-rgb))" }}>
                <span className="material-symbols-outlined text-[15px] font-normal mt-px shrink-0" style={{ color: "#5b5a8b" }}>info</span>
                <div>
                  Encoding always runs on this server. The choice above only sets where the final HLS output is stored.
                  Originals are deleted from <code className="font-mono">/downloads/torrents</code> after encoding succeeds.
                </div>
              </div>

              {processTargets.length > 1 && (
                <div className="rounded-[10px] border max-h-[140px] overflow-y-auto" style={{ borderColor: "rgb(var(--surface-high-rgb))" }}>
                  {processTargets.map((d, i) => (
                    <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]" style={{ borderTop: i === 0 ? undefined : "1px solid rgb(var(--surface-high-rgb))" }}>
                      <span className="material-symbols-outlined text-[14px] font-normal shrink-0" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
                        {d.source_type === "magnet" || d.source_type === "torrent_file" ? "bolt" : "link"}
                      </span>
                      <span className="truncate" style={{ color: "rgb(var(--on-surface-rgb))" }}>{d.name || "Unknown"}</span>
                      <span className="ml-auto text-[10.5px] tabular-nums shrink-0" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>{formatBytes(d.total_size)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "rgb(var(--surface-high-rgb))", background: "rgb(var(--surface-low-rgb))" }}>
              <button
                type="button"
                onClick={() => setProcessTargets(null)}
                disabled={processBusy}
                className="rounded-[8px] px-4 h-[34px] text-[12.5px] font-semibold disabled:opacity-50"
                style={{ background: "transparent", color: "rgb(var(--on-surface-var-rgb))" }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmProcess}
                disabled={processBusy}
                className="rounded-[8px] px-4 h-[34px] text-[12.5px] font-bold text-white transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 2px 6px rgba(91,90,139,.3)" }}
              >
                <span className="material-symbols-outlined text-[16px] font-normal">movie</span>
                {processBusy ? "Queueing…" :
                  processTargets.length === 1 ? "Process & encode" : `Process ${processTargets.length} & encode`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk remove modal */}
      {bulkRemoveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,.4)" }}
          onClick={() => setBulkRemoveOpen(false)}
        >
          <div
            className="rounded-[14px] p-5 max-w-md w-full"
            style={{ background: "rgb(var(--surface-card-rgb))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold mb-2" style={{ color: "rgb(var(--on-surface-rgb))" }}>
              Remove {selected.size} download{selected.size > 1 ? "s" : ""}?
            </h3>
            <p className="text-[13px] mb-4" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
              This cancels the transfers and deletes any downloaded files. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBulkRemoveOpen(false)}
                className="rounded-[8px] px-4 py-2 text-[13px] font-medium"
                style={{ background: "rgb(var(--surface-high-rgb))", color: "rgb(var(--on-surface-rgb))" }}
              >
                Cancel
              </button>
              <button
                onClick={() => runBulk("remove")}
                disabled={bulkBusy}
                className="rounded-[8px] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
                style={{ background: "#a8364b" }}
              >
                {bulkBusy ? "Removing…" : `Remove ${selected.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,.4)" }}
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="rounded-[14px] p-5 max-w-md w-full"
            style={{ background: "rgb(var(--surface-card-rgb))" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold mb-2" style={{ color: "rgb(var(--on-surface-rgb))" }}>Remove download?</h3>
            <p className="text-[13px] mb-4" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
              This will cancel the transfer and delete any downloaded files for <span className="font-semibold">{deleteTarget.name || "this download"}</span>.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-[8px] px-4 py-2 text-[13px] font-medium"
                style={{ background: "rgb(var(--surface-high-rgb))", color: "rgb(var(--on-surface-rgb))" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-[8px] px-4 py-2 text-[13px] font-bold text-white"
                style={{ background: "#a8364b" }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>{label}</div>
      <div className="text-[14px] font-bold tabular-nums" style={{ color: "rgb(var(--on-surface-rgb))" }}>{value}</div>
    </div>
  );
}

function BulkBtn({
  icon, label, onClick, disabled, primary, danger,
}: {
  icon: string; label: string; onClick: () => void;
  disabled?: boolean; primary?: boolean; danger?: boolean;
}) {
  const bg = primary ? "#5b5a8b" : danger ? "transparent" : "rgb(var(--surface-card-rgb))";
  const fg = primary ? "white" : danger ? "#a8364b" : "rgb(var(--on-surface-rgb))";
  const border = primary ? undefined : danger ? "1px solid rgba(168,54,75,.25)" : "1px solid rgb(var(--surface-high-rgb))";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-[7px] px-2.5 h-[30px] text-[12px] font-bold transition-opacity disabled:opacity-40"
      style={{ background: bg, color: fg, border }}
    >
      <span className="material-symbols-outlined text-[15px] font-normal">{icon}</span>
      {label}
    </button>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div
      className="rounded-[10px] py-8 px-4 text-center text-[13px] flex flex-col items-center gap-2"
      style={{ background: "rgb(var(--surface-card-rgb))", color: "rgb(var(--on-surface-var-rgb))" }}
    >
      <span className="material-symbols-outlined text-[28px] opacity-60">{icon}</span>
      {text}
    </div>
  );
}

function DownloadRow({
  d, selected, onToggleSelect, onPause, onResume, onProcess, onDelete,
}: {
  d: Download;
  selected: boolean;
  onToggleSelect: () => void;
  onPause: () => void;
  onResume: () => void;
  onProcess: () => void;
  onDelete: () => void;
}) {
  const progress = Math.max(0, Math.min(100, d.progress || 0));
  const isActive = d.status === "active" || d.status === "waiting";
  const isPaused = d.status === "paused";
  const isComplete = d.status === "complete";
  const isError = d.status === "error";

  return (
    <div
      className="rounded-[12px] p-4 transition-colors"
      style={{
        background: selected ? "rgba(91,90,139,.06)" : "rgb(var(--surface-card-rgb))",
        boxShadow: "0 1px 4px rgba(0,0,0,.04)",
        outline: selected ? "1px solid rgba(91,90,139,.35)" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="mt-1 w-4 h-4 cursor-pointer accent-[#5b5a8b] shrink-0"
            aria-label={`Select ${d.name || "download"}`}
          />
          <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-[16px]" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
              {d.source_type === "magnet" || d.source_type === "torrent_file" ? "bolt" : "link"}
            </span>
            <span className="font-semibold text-[13.5px] truncate" style={{ color: "rgb(var(--on-surface-rgb))" }}>
              {d.name || "Unknown"}
            </span>
            {statusBadge(d.status)}
          </div>
          {isError && d.error_message && (
            <div className="text-[12px] mb-2" style={{ color: "#a8364b" }}>{d.error_message}</div>
          )}
          <div className="flex items-center gap-4 text-[11.5px] tabular-nums" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
            <span>{formatBytes(d.downloaded)} / {formatBytes(d.total_size)}</span>
            {isActive && <span>↓ {formatSpeed(d.download_speed)}</span>}
            {isActive && (d.upload_speed ?? 0) > 0 && <span>↑ {formatSpeed(d.upload_speed)}</span>}
            {(d.num_seeders ?? 0) > 0 && <span>{d.num_seeders} seeders</span>}
            {(d.num_peers ?? 0) > 0 && <span>{d.num_peers} peers</span>}
          </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isActive && (
            <IconBtn icon="pause" title="Pause" onClick={onPause} />
          )}
          {isPaused && (
            <IconBtn icon="play_arrow" title="Resume" onClick={onResume} />
          )}
          {isComplete && (
            <button
              onClick={onProcess}
              className="rounded-[7px] px-3 py-1.5 text-[12px] font-bold text-white"
              style={{ background: "#5b5a8b" }}
            >
              Process to library
            </button>
          )}
          <IconBtn icon="delete" title="Remove" danger onClick={onDelete} />
        </div>
      </div>

      {/* progress bar */}
      {!isComplete && (
        <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgb(var(--surface-high-rgb))" }}>
          <div
            className="h-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: isError ? "#a8364b" : isPaused ? "#9aa0a6" : "#5b5a8b",
            }}
          />
        </div>
      )}
    </div>
  );
}

function IconBtn({ icon, title, onClick, danger }: { icon: string; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex items-center justify-center w-[30px] h-[30px] rounded-[7px] transition-colors"
      style={{ color: danger ? "#a8364b" : "rgb(var(--on-surface-var-rgb))" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = danger ? "#fce4ec" : "rgb(var(--surface-high-rgb))"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
    </button>
  );
}
