"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api } from "@/lib/api";

interface Summary {
  local: { count: number; totalSize: number };
  r2: { count: number; totalSize: number };
}

interface Folder {
  id: string;
  name: string;
}

interface MigrationProgress {
  current?: number;
  total?: number;
  currentVideo?: string;
  succeeded?: number;
  failed?: number;
  skipped?: number;
}

interface StatusIdle { status: "idle" }
interface StatusRunning { status: "running" | "queued"; jobId: string | number; direction: string; totalVideos: number; progress?: MigrationProgress }
interface StatusDone { status: "completed" | "failed"; jobId: string | number; direction: string; totalVideos: number; result?: { succeeded?: number; failed?: number; skipped?: number } | null; error?: string | null; finishedAt?: string | null }
type MigrationStatus = StatusIdle | StatusRunning | StatusDone;

function fmtBytes(b: number): string {
  if (!b || b < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / Math.pow(1024, i)).toFixed(b < 1024 ? 0 : 1)} ${u[i]}`;
}

export default function MigrationPage() {
  const [summary, setSummary] = useState<Summary>({ local: { count: 0, totalSize: 0 }, r2: { count: 0, totalSize: 0 } });
  const [folders, setFolders] = useState<Folder[]>([]);
  const [status, setStatus] = useState<MigrationStatus>({ status: "idle" });

  const [direction, setDirection] = useState<"local-to-r2" | "r2-to-local">("local-to-r2");
  const [scope, setScope] = useState<"all" | "folder">("all");
  const [folderId, setFolderId] = useState("");
  const [deleteSource, setDeleteSource] = useState(true);
  const [skipMigrated, setSkipMigrated] = useState(true);

  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3500);
  };

  const loadSummary = useCallback(async () => {
    try {
      const s = await api.get<{ summary: Summary }>("/migration/summary");
      setSummary(s.summary);
    } catch {
      // non-fatal
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.get<MigrationStatus>("/migration/status");
      setStatus(s);
    } catch {
      // non-fatal
    }
  }, []);

  const loadFolders = useCallback(async () => {
    try {
      const r = await api.get<{ folders: Folder[] }>("/folders");
      setFolders(r.folders ?? []);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    loadSummary();
    loadStatus();
    loadFolders();
  }, [loadSummary, loadStatus, loadFolders]);

  // Poll while running/queued
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const running = status.status === "running" || status.status === "queued";
    if (running && !pollRef.current) {
      pollRef.current = setInterval(() => {
        loadStatus();
        loadSummary();
      }, 2000);
    } else if (!running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
      // Final refresh after completion
      loadSummary();
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status.status, loadStatus, loadSummary]);

  const startMigration = async () => {
    const label = direction === "local-to-r2" ? "Local → R2" : "R2 → Local";
    const scopeLabel = scope === "folder" ? `folder ${folders.find((f) => f.id === folderId)?.name ?? ""}` : "ALL ready videos";
    if (!confirm(`Start ${label} migration for ${scopeLabel}?${deleteSource ? "\n\nSource files WILL be deleted after successful transfer." : ""}`)) return;
    setStarting(true);
    try {
      const r = await api.post<{ message: string; jobId: string; totalVideos: number }>("/migration/start", {
        direction,
        scope,
        folder_id: scope === "folder" ? folderId : undefined,
        delete_source: deleteSource,
        skip_migrated: skipMigrated,
      });
      showToast(`Migration queued — ${r.totalVideos} video(s)`);
      loadStatus();
    } catch (e: unknown) {
      const err = e as { message?: string };
      showToast(err.message ?? "Failed to start migration", "error");
    } finally {
      setStarting(false);
    }
  };

  const cancelMigration = async () => {
    if (!confirm("Cancel the current migration? Videos already transferred will not be reverted.")) return;
    setCancelling(true);
    try {
      const r = await api.post<{ message: string }>("/migration/cancel", {});
      showToast(r.message || "Cancelled");
      loadStatus();
    } catch (e: unknown) {
      const err = e as { message?: string };
      showToast(err.message ?? "Failed to cancel", "error");
    } finally {
      setCancelling(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm("Clear migration history?")) return;
    setClearing(true);
    try {
      await api.post("/migration/clear", {});
      setStatus({ status: "idle" });
      showToast("History cleared");
    } catch (e: unknown) {
      const err = e as { message?: string };
      showToast(err.message ?? "Failed to clear history", "error");
    } finally {
      setClearing(false);
    }
  };

  const isRunning = status.status === "running" || status.status === "queued";
  const prog = status.status === "running" ? (status.progress ?? {}) : {};
  const progPct = prog.total && prog.total > 0 ? Math.round(((prog.current ?? 0) / prog.total) * 100) : 0;

  return (
    <DashboardLayout>
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-[10px] px-4 py-3 text-[13px] font-medium shadow-lg"
          style={
            toast.tone === "success"
              ? { background: "rgba(46,125,50,0.95)", color: "#fff" }
              : { background: "#a8364b", color: "#fff" }
          }
        >
          {toast.message}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-[14px] bg-[#eef1f8] px-6 py-5">
          <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Local Server</span>
          <div className="mt-3 text-[28px] font-extrabold leading-none tracking-[-1px] text-[#1e1e2f]">{summary.local.count}</div>
          <div className="mt-2 text-[13px] text-[#6b7280]">{fmtBytes(summary.local.totalSize)} across {summary.local.count} video{summary.local.count !== 1 ? "s" : ""}</div>
        </div>
        <div className="rounded-[14px] bg-[#fff5eb] px-6 py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-[#f38020]"><span className="text-[10px] text-white font-bold">R</span></div>
            <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#f38020]">Cloudflare R2</span>
          </div>
          <div className="mt-3 text-[28px] font-extrabold leading-none tracking-[-1px] text-[#1e1e2f]">{summary.r2.count}</div>
          <div className="mt-2 text-[13px] text-[#6b7280]">{fmtBytes(summary.r2.totalSize)} across {summary.r2.count} video{summary.r2.count !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* Active migration */}
      {isRunning && (
        <div className="mb-6 rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: "#f57c00", boxShadow: "0 0 0 4px rgba(245,124,0,.18)" }} />
              <h3 className="text-[15px] font-bold text-on-surface">
                {status.status === "queued" ? "Queued" : "Migrating"} — {(status as StatusRunning).direction === "local-to-r2" ? "Local → R2" : "R2 → Local"}
              </h3>
            </div>
            <button onClick={cancelMigration} disabled={cancelling} className="rounded-[10px] bg-[#fce4ec] px-3 py-2 text-[12px] font-semibold text-error hover:bg-[#f8bbd0] disabled:opacity-50">
              {cancelling ? "Cancelling..." : "Cancel Migration"}
            </button>
          </div>
          <div className="mb-2 flex items-end justify-between text-[12px] text-on-surface-var">
            <span>{prog.current ?? 0} / {prog.total ?? (status as StatusRunning).totalVideos} videos</span>
            <span className="font-mono font-bold text-primary">{progPct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-low">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-primary-dim transition-all" style={{ width: `${progPct}%` }} />
          </div>
          {prog.currentVideo && (
            <div className="mt-3 text-[12px] text-on-surface-var truncate">
              <span className="font-semibold">Current:</span> {prog.currentVideo}
            </div>
          )}
          {(prog.succeeded !== undefined || prog.failed !== undefined || prog.skipped !== undefined) && (
            <div className="mt-3 flex flex-wrap gap-4 text-[12px]">
              <span className="text-on-surface-var">Succeeded: <span className="font-bold text-[#2e7d32]">{prog.succeeded ?? 0}</span></span>
              <span className="text-on-surface-var">Failed: <span className="font-bold text-error">{prog.failed ?? 0}</span></span>
              <span className="text-on-surface-var">Skipped: <span className="font-bold text-on-surface">{prog.skipped ?? 0}</span></span>
            </div>
          )}
        </div>
      )}

      {/* Last run */}
      {(status.status === "completed" || status.status === "failed") && (
        <div className="mb-6 rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[.05em]"
                style={
                  status.status === "completed"
                    ? { background: "rgba(46,125,50,0.12)", color: "#2e7d32" }
                    : { background: "#fce4ec", color: "#a8364b" }
                }
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.status === "completed" ? "#2e7d32" : "#a8364b" }} />
                {status.status === "completed" ? "Completed" : "Failed"}
              </span>
              <span className="text-[13px] font-semibold text-on-surface">
                {(status as StatusDone).direction === "local-to-r2" ? "Local → R2" : "R2 → Local"}
              </span>
              {(status as StatusDone).finishedAt && (
                <span className="text-[12px] text-on-surface-var">· {new Date((status as StatusDone).finishedAt!).toLocaleString()}</span>
              )}
            </div>
            <button onClick={clearHistory} disabled={clearing} className="rounded-[10px] bg-[#f0f4f7] px-3 py-2 text-[12px] font-semibold text-primary hover:bg-[#e3e9ed] disabled:opacity-50">
              {clearing ? "Clearing..." : "Clear History"}
            </button>
          </div>
          {(status as StatusDone).result && (
            <div className="flex flex-wrap gap-4 text-[12.5px]">
              <span className="text-on-surface-var">Succeeded: <span className="font-bold text-[#2e7d32]">{(status as StatusDone).result?.succeeded ?? 0}</span></span>
              <span className="text-on-surface-var">Failed: <span className="font-bold text-error">{(status as StatusDone).result?.failed ?? 0}</span></span>
              <span className="text-on-surface-var">Skipped: <span className="font-bold text-on-surface">{(status as StatusDone).result?.skipped ?? 0}</span></span>
              <span className="text-on-surface-var">Total: <span className="font-bold text-on-surface">{(status as StatusDone).totalVideos}</span></span>
            </div>
          )}
          {(status as StatusDone).error && (
            <div className="mt-3 rounded-[10px] px-4 py-3 text-[12.5px]" style={{ background: "#fce4ec", color: "#a8364b" }}>
              {(status as StatusDone).error}
            </div>
          )}
        </div>
      )}

      {/* Start migration */}
      <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="mb-1 text-[15px] font-bold text-on-surface">Start Migration</h3>
        <p className="mb-5 text-[12px] text-on-surface-var">Move video files between local storage and Cloudflare R2 in the background.</p>

        <div className="grid gap-5 md:grid-cols-2">
          {/* Direction */}
          <div>
            <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Direction</span>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "local-to-r2" as const, label: "Local → R2",  desc: "Move local files to Cloudflare R2" },
                { v: "r2-to-local" as const, label: "R2 → Local", desc: "Pull R2 files back to local disk" },
              ]).map((opt) => {
                const active = direction === opt.v;
                return (
                  <button
                    key={opt.v}
                    disabled={isRunning}
                    onClick={() => setDirection(opt.v)}
                    className="rounded-[10px] px-4 py-3 text-left transition"
                    style={
                      active
                        ? { background: "rgba(91,90,139,0.1)", border: "1px solid rgb(var(--primary-rgb) / 0.3)" }
                        : { background: "#f9fafb", border: "1px solid #e5e7eb" }
                    }
                  >
                    <div className="text-[13px] font-bold" style={{ color: active ? "rgb(var(--primary-rgb))" : "#1e1e2f" }}>{opt.label}</div>
                    <div className="mt-0.5 text-[11px] text-on-surface-var">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scope */}
          <div>
            <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Scope</span>
            <select
              value={scope}
              disabled={isRunning}
              onChange={(e) => setScope(e.target.value as "all" | "folder")}
              className="w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none"
            >
              <option value="all">All ready videos</option>
              <option value="folder">Specific folder</option>
            </select>
            {scope === "folder" && (
              <select
                value={folderId}
                disabled={isRunning}
                onChange={(e) => setFolderId(e.target.value)}
                className="mt-2 w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none"
              >
                <option value="">Select a folder…</option>
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
          </div>

          {/* Options */}
          <div className="md:col-span-2 space-y-2">
            <label className="flex items-start gap-3 rounded-[10px] bg-[#f9fafb] px-4 py-3 cursor-pointer">
              <input type="checkbox" checked={deleteSource} disabled={isRunning} onChange={(e) => setDeleteSource(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <div>
                <div className="text-[13px] font-semibold text-on-surface">Delete source after successful transfer</div>
                <div className="text-[11.5px] text-on-surface-var">Reclaims space. Off = migration is a copy (both sides keep a copy).</div>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-[10px] bg-[#f9fafb] px-4 py-3 cursor-pointer">
              <input type="checkbox" checked={skipMigrated} disabled={isRunning} onChange={(e) => setSkipMigrated(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
              <div>
                <div className="text-[13px] font-semibold text-on-surface">Skip videos already on the destination</div>
                <div className="text-[11.5px] text-on-surface-var">Safe to keep on — videos already on the target side won&apos;t be re-uploaded.</div>
              </div>
            </label>
          </div>
        </div>

        <div className="mt-7 flex justify-end">
          <button
            onClick={startMigration}
            disabled={isRunning || starting || (scope === "folder" && !folderId)}
            className="inline-flex items-center gap-2 rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] transition-all hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            {starting ? "Starting..." : isRunning ? "Migration in progress" : "Start Migration"}
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
}
