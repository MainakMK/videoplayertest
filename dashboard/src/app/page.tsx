"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Filler,
  Tooltip,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OverviewStats {
  totalViews: number;
  uniqueViewers: number;
  avgWatchTime: string;
  avgWatchSeconds: number;
  topCountry: string;
  viewsOverTime: { date: string; views: number }[];
  topVideos: { id: string; title: string; views: number; avgWatchTime: string }[];
  devices: { desktop: number; mobile: number; tablet: number };
  countries: { country: string; code: string; views: number; percentage: number }[];
  previousViews: number | null;
  viewsDeltaPct: number | null;
  previousAvgWatchSeconds: number | null;
  avgWatchDeltaPct: number | null;
  completionRate: number | null;
  previousCompletionRate: number | null;
  completionDeltaPct: number | null;
  previousUniqueViewers: number | null;
  uniqueViewersDeltaPct: number | null;
  activeEmbeds: number;
  previousActiveEmbeds: number | null;
  activeEmbedsDeltaPct: number | null;
}

interface Video {
  id: string;
  title: string;
  status: string;
  views_count: number;
  duration: number;
  created_at: string;
  thumbnail_url?: string | null;
}

interface BandwidthData {
  bandwidth: {
    today: { bytes: number; formatted: string };
    week: { bytes: number; formatted: string };
    month: { bytes: number; formatted: string };
    prev_month?: { bytes: number; formatted: string };
    all_time: { bytes: number; formatted: string };
  };
  monthDeltaPct: number | null;
}

interface StorageUsage {
  usage: {
    local: { count: number; totalSize: number };
    r2: { count: number; totalSize: number };
  };
  r2_configured: boolean;
  createdLast7d: number;
}

interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  pending: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSizeWithUnit(bytes: number): { value: string; unit: string } {
  if (bytes === 0) return { value: "0", unit: "B" };
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return { value: parseFloat((bytes / Math.pow(k, i)).toFixed(1)).toString(), unit: sizes[i] };
}

function formatDuration(seconds: number): string {
  if (!seconds) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? "s" : ""} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
}

function formatViewsShort(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return n.toString();
}

function DeltaBadge({ pct, pill = false }: { pct: number | null | undefined; pill?: boolean }) {
  if (pct === null || pct === undefined || pct === 0) return null;
  const up = pct > 0;
  const arrow = up ? "\u2191" : "\u2193";
  const abs = Math.abs(pct).toFixed(1);
  const color = up ? "#2e7d32" : "#c62828";
  const bg = up ? "#e8f5e9" : "#fce4ec";
  if (pill) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full px-2.5 py-0.5 text-[9.5px] font-bold" style={{ color, background: bg }}>
        {arrow} {abs}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[12px] font-bold" style={{ color }}>
      {arrow} {abs}%
    </span>
  );
}

const statusDotColors: Record<string, string> = {
  ready: "bg-[#4caf50]",
  processing: "bg-[#ff9800]",
  error: "bg-error",
  uploading: "bg-[#2196f3]",
  draft: "bg-[#9e9e9e]",
};

const statusLabels: Record<string, string> = {
  ready: "Live",
  processing: "Processing",
  error: "Error",
  uploading: "Uploading",
  draft: "Draft",
};

const thumbnailGradients = [
  "linear-gradient(135deg, #5b5a8b, #755478)",
  "linear-gradient(135deg, #607d8b, #455a64)",
  "linear-gradient(135deg, #755478, #513254)",
  "linear-gradient(135deg, #2196f3, #1565c0)",
  "linear-gradient(135deg, #e91e63, #880e4f)",
];

const countryFlags: Record<string, string> = {
  US: "\u{1F1FA}\u{1F1F8}", GB: "\u{1F1EC}\u{1F1E7}", IN: "\u{1F1EE}\u{1F1F3}",
  DE: "\u{1F1E9}\u{1F1EA}", FR: "\u{1F1EB}\u{1F1F7}", CA: "\u{1F1E8}\u{1F1E6}",
  AU: "\u{1F1E6}\u{1F1FA}", BR: "\u{1F1E7}\u{1F1F7}", JP: "\u{1F1EF}\u{1F1F5}",
};

const donutColors = ["#5b5a8b", "#755478", "#bbb9f1", "#c5b5f0", "#eec4ef"];

// ---------------------------------------------------------------------------
// Chart gradient helper
// ---------------------------------------------------------------------------
function createLineGradient(ctx: CanvasRenderingContext2D, height: number) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, "rgba(91,90,139,.18)");
  g.addColorStop(1, "rgba(91,90,139,0)");
  return g;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardHome() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [bandwidth, setBandwidth] = useState<BandwidthData | null>(null);
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [queue, setQueue] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartRange, setChartRange] = useState<"7d" | "30d" | "90d" | "6m" | "1y">("30d");
  const lineChartRef = useRef<ChartJS<"line"> | null>(null);
  const router = useRouter();

  const rangeToApi: Record<string, string> = { "7d": "7d", "30d": "30d", "90d": "30d", "6m": "30d", "1y": "all" };

  const loadData = useCallback(async () => {
    try {
      const [overview, videosRes, bw, st, q] = await Promise.all([
        api.get<OverviewStats>(`/analytics/overview?range=${rangeToApi[chartRange] ?? "30d"}`),
        api.get<{ videos: Video[]; total: number }>("/videos?limit=5"),
        api.get<BandwidthData>("/analytics/bandwidth").catch(() => null),
        api.get<StorageUsage>("/settings/storage/usage").catch(() => null),
        api.get<QueueStats>("/videos/queue/stats").catch(() => null),
      ]);
      setStats(overview);
      setVideos(videosRes.videos ?? []);
      setBandwidth(bw);
      setStorage(st);
      setQueue(q);
    } catch {
      // data will remain null/empty
    } finally {
      setLoading(false);
    }
  }, [chartRange]);

  useEffect(() => { loadData(); }, [loadData]);

  // Computed data
  const viewsData = stats?.viewsOverTime ?? [];
  const totalVideoCount = storage ? storage.usage.local.count + storage.usage.r2.count : 0;
  const totalStorageBytes = storage ? storage.usage.local.totalSize + storage.usage.r2.totalSize : 0;
  const storageFmt = formatSizeWithUnit(totalStorageBytes);
  const bwFmt = formatSizeWithUnit(bandwidth?.bandwidth?.month?.bytes ?? 0);
  const r2Fmt = formatSizeWithUnit(storage?.usage.r2.totalSize ?? 0);
  const storageCapGB = 50;
  const storagePct = totalStorageBytes > 0 ? Math.min(((totalStorageBytes / (storageCapGB * 1024 * 1024 * 1024)) * 100), 100).toFixed(1) : "0";

  const topVids = stats?.topVideos?.slice(0, 5) ?? [];
  const countries = stats?.countries?.slice(0, 5) ?? [];

  // Views chart labels
  const viewsLabels = viewsData.map((p) =>
    new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })
  );

  return (
    <DashboardLayout>
      {/* ── Page Header ── */}
      <div className="mb-6">
        <h1 className="text-[22px] font-extrabold text-on-surface">Dashboard</h1>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">
          <span>Home</span>
          <span className="text-on-surface-var/40">&gt;</span>
          <span className="text-primary">Overview</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface-var/20 border-t-primary" />
        </div>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <div className="rounded-card bg-white p-5 shadow-card" style={{ marginBottom: 20 }}>
            <div className="grid grid-cols-2 gap-px lg:grid-cols-3 xl:grid-cols-5">
              {/* Total Videos */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Total Videos</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#ededfa]">
                    <span className="material-symbols-outlined text-[17px] text-primary">video_library</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">{totalVideoCount}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">Videos in archive</span>
                  {(storage?.createdLast7d ?? 0) > 0 ? (
                    <span className="inline-flex items-center rounded-full bg-[#e8f5e9] px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[.04em] text-[#2e7d32]">+{storage?.createdLast7d} this week</span>
                  ) : null}
                </div>
              </div>

              {/* Total Views */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Total Views</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#f3eafd]">
                    <span className="material-symbols-outlined text-[17px] text-[#7c4dff]">visibility</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">{formatViewsShort(stats?.totalViews ?? 0)}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">Across all content</span>
                  <DeltaBadge pct={stats?.viewsDeltaPct ?? null} />
                </div>
              </div>

              {/* Storage Used */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Storage Used</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#eceff1]">
                    <span className="material-symbols-outlined text-[17px] text-[#607d8b]">database</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">
                  {storageFmt.value}<span className="ml-0.5 text-[16px] font-semibold text-on-surface-var">{storageFmt.unit}</span>
                </div>
                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[12px] text-on-surface-var">of {storageCapGB} GB</span>
                    <span className="text-[12px] font-bold text-on-surface-var">{storagePct}%</span>
                  </div>
                  <div className="h-[5px] overflow-hidden rounded-full bg-[#ede7f6]">
                    <div className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-[cubic-bezier(.4,0,.2,1)]" style={{ width: `${storagePct}%` }} />
                  </div>
                </div>
              </div>

              {/* Bandwidth */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Bandwidth</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#e3f2fd]">
                    <span className="material-symbols-outlined text-[17px] text-[#2196f3]">wifi</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">
                  {bwFmt.value}<span className="ml-0.5 text-[16px] font-semibold text-on-surface-var">{bwFmt.unit}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">This month</span>
                  <DeltaBadge pct={bandwidth?.monthDeltaPct ?? null} pill />
                </div>
              </div>

              {/* Cloudflare R2 */}
              <div className="flex flex-col justify-between px-6 py-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Cloudflare R2</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#fff4ec]">
                    <span className="material-symbols-outlined text-[17px] text-[#f38020]">cloud</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">
                  {r2Fmt.value}<span className="ml-0.5 text-[16px] font-semibold text-on-surface-var">{r2Fmt.unit}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">{storage?.usage.r2.count ?? 0} video{(storage?.usage.r2.count ?? 0) !== 1 ? "s" : ""} &middot; R2</span>
                  {!storage?.r2_configured && (
                    <span className="inline-flex items-center rounded-full border border-on-surface/12 bg-[#f5f5f5] px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[.04em] text-on-surface-var">Not configured</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Engagement KPIs ── */}
          <div className="rounded-card bg-white p-5 shadow-card" style={{ marginBottom: 20 }}>
            <div className="grid grid-cols-2 gap-px lg:grid-cols-3 xl:grid-cols-6">
              {/* Avg Watch Time */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Avg Watch Time</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#f3eafd]">
                    <span className="material-symbols-outlined text-[17px] text-[#7c4dff]">schedule</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">{stats?.avgWatchTime ?? "0s"}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">Per view</span>
                  <DeltaBadge pct={stats?.avgWatchDeltaPct ?? null} />
                </div>
              </div>

              {/* Completion Rate */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Completion Rate</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#e8f5e9]">
                    <span className="material-symbols-outlined text-[17px] text-[#2e7d32]">check_circle</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">
                  {stats?.completionRate !== null && stats?.completionRate !== undefined
                    ? <>{stats.completionRate}<span className="ml-0.5 text-[16px] font-semibold text-on-surface-var">%</span></>
                    : <span className="text-[22px] font-semibold text-on-surface-var">{"\u2014"}</span>}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">{"Watched \u2265 90%"}</span>
                  <DeltaBadge pct={stats?.completionDeltaPct ?? null} />
                </div>
              </div>

              {/* Unique Viewers */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Unique Viewers</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#e3f2fd]">
                    <span className="material-symbols-outlined text-[17px] text-[#2196f3]">group</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">{formatViewsShort(stats?.uniqueViewers ?? 0)}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">Distinct visitors</span>
                  <DeltaBadge pct={stats?.uniqueViewersDeltaPct ?? null} />
                </div>
              </div>

              {/* Active Embeds */}
              <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Active Embeds</span>
                  <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#fff8e1]">
                    <span className="material-symbols-outlined text-[17px] text-[#f57c00]">public</span>
                  </div>
                </div>
                <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">{stats?.activeEmbeds ?? 0}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-on-surface-var">Host domains</span>
                  <DeltaBadge pct={stats?.activeEmbedsDeltaPct ?? null} />
                </div>
              </div>

              {/* Top Device */}
              {(() => {
                const d = stats?.devices ?? { desktop: 0, mobile: 0, tablet: 0 };
                const entries = Object.entries(d) as [string, number][];
                const [topKey, topPct] = entries.reduce((m, e) => e[1] > m[1] ? e : m, ["desktop", 0]);
                const icon = topKey === "mobile" ? "smartphone" : topKey === "tablet" ? "tablet" : "desktop_windows";
                const label = topKey.charAt(0).toUpperCase() + topKey.slice(1);
                const hasData = entries.some(([, v]) => v > 0);
                return (
                  <div className="flex flex-col justify-between px-6 py-4 xl:border-r xl:border-on-surface/8">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Top Device</span>
                      <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#eceff1]">
                        <span className="material-symbols-outlined text-[17px] text-[#455a64]">{icon}</span>
                      </div>
                    </div>
                    <div className="text-[32px] font-extrabold leading-none tracking-[-1px] text-on-surface">
                      {hasData ? label : <span className="text-[22px] font-semibold text-on-surface-var">{"\u2014"}</span>}
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-on-surface-var">{hasData ? `${topPct}% of views` : "No device data"}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Processing Queue */}
              {(() => {
                const pending = queue?.pending ?? 0;
                const failed = queue?.failed ?? 0;
                const idle = pending === 0 && failed === 0;
                const iconBg = failed > 0 ? "#fce4ec" : pending > 0 ? "#fff4e5" : "#e8f5e9";
                const iconColor = failed > 0 ? "#c62828" : pending > 0 ? "#ef6c00" : "#2e7d32";
                const iconName = failed > 0 ? "error" : pending > 0 ? "sync" : "check_circle";
                return (
                  <div className="flex flex-col justify-between px-6 py-4">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Processing Queue</span>
                      <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px]" style={{ background: iconBg }}>
                        <span className="material-symbols-outlined text-[17px]" style={{ color: iconColor }}>{iconName}</span>
                      </div>
                    </div>
                    <div className="text-[38px] font-extrabold leading-none tracking-[-2px] text-on-surface">{pending}</div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-on-surface-var">
                        {idle ? "Idle" : `${queue?.active ?? 0} active \u00b7 ${queue?.waiting ?? 0} waiting`}
                      </span>
                      {failed > 0 && (
                        <span className="inline-flex items-center rounded-full bg-[#fce4ec] px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[.04em] text-[#c62828]">{failed} failed</span>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Charts Row ── */}
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1fr_1fr_320px]" style={{ marginBottom: 20, alignItems: "start" }}>
            {/* Views Over Time */}
            <div className="rounded-card bg-surface-card p-[22px] shadow-card animate-[fadeUp_.35s_ease_both] [animation-delay:.1s]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[13.5px] font-bold text-on-surface">Views Over Time</div>
                  <div className="mt-0.5 text-[10.5px] text-on-surface-var">Last {chartRange === "7d" ? "7 days" : chartRange === "30d" ? "30 days" : chartRange === "90d" ? "90 days" : chartRange === "6m" ? "6 months" : "year"}</div>
                </div>
                <div className="flex gap-0.5 rounded-btn p-[3px]" style={{ background: "rgb(240,244,247)" }}>
                  {(["7d", "30d", "90d", "6m", "1y"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setChartRange(r)}
                      className={`rounded-[7px] border-none px-3.5 py-[5px] text-[11px] font-semibold transition-all ${
                        chartRange === r
                          ? "text-primary"
                          : "text-on-surface-var"
                      }`}
                      style={chartRange === r ? { background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,.06)" } : { background: "transparent" }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ height: 180 }}>
                {viewsData.length > 0 ? (
                  <Line
                    ref={lineChartRef}
                    data={{
                      labels: viewsLabels,
                      datasets: [{
                        label: "Views",
                        data: viewsData.map((p) => p.views),
                        borderColor: "#5b5a8b",
                        borderWidth: 2.5,
                        pointRadius: 3,
                        pointHoverRadius: 5,
                        pointBackgroundColor: "#5b5a8b",
                        pointBorderColor: "#fff",
                        pointBorderWidth: 2,
                        fill: true,
                        backgroundColor: (context: { chart: ChartJS }) => {
                          const { ctx, chartArea } = context.chart;
                          if (!chartArea) return "rgba(91,90,139,.18)";
                          return createLineGradient(ctx, chartArea.bottom);
                        },
                        tension: 0.4,
                      }],
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: "#2c3437",
                          titleColor: "#fff",
                          bodyColor: "#acb3b7",
                          padding: 9,
                          cornerRadius: 7,
                          callbacks: { label: (c) => "  " + (c.parsed.y ?? 0).toLocaleString() + " views" },
                        },
                      },
                      scales: {
                        x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 6 } },
                        y: {
                          grid: { color: "rgba(44,52,55,.06)" },
                          border: { display: false, dash: [3, 3] },
                          ticks: { callback: (v) => (typeof v === "number" && v >= 1000 ? (v / 1000).toFixed(0) + "k" : v) },
                        },
                      },
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-on-surface-var/50">No data available</div>
                )}
              </div>
            </div>

            {/* Top Videos */}
            <div className="rounded-card bg-surface-card p-[22px] shadow-card animate-[fadeUp_.35s_ease_both] [animation-delay:.15s]">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[13.5px] font-bold text-on-surface">Top Videos</div>
                  <div className="mt-0.5 text-[10.5px] text-on-surface-var">By play count</div>
                </div>
                <button className="rounded-md bg-surface-low px-2.5 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-surface-high">View All</button>
              </div>
              <div style={{ height: 180 }}>
                {topVids.length > 0 ? (
                  <Bar
                    data={{
                      labels: topVids.map((v) => v.title.length > 16 ? v.title.slice(0, 16) + "…" : v.title),
                      datasets: [{
                        label: "Views",
                        data: topVids.map((v) => v.views),
                        backgroundColor: topVids.map((_, i) =>
                          i === 0 ? "#5b5a8b" : `rgba(91,90,139,${0.7 - i * 0.15})`
                        ),
                        borderRadius: 5,
                        borderSkipped: false,
                      }],
                    }}
                    options={{
                      indexAxis: "y",
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          backgroundColor: "#2c3437",
                          titleColor: "#fff",
                          bodyColor: "#acb3b7",
                          padding: 9,
                          cornerRadius: 7,
                          callbacks: { label: (c) => "  " + (c.parsed.x ?? 0).toLocaleString() + " plays" },
                        },
                      },
                      scales: {
                        x: {
                          grid: { color: "rgba(44,52,55,.06)" },
                          border: { display: false },
                          ticks: { callback: (v) => (typeof v === "number" && v >= 1000 ? (v / 1000).toFixed(1) + "k" : v) },
                        },
                        y: { grid: { display: false }, border: { display: false } },
                      },
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-on-surface-var/50">No data</div>
                )}
              </div>
            </div>

            {/* Traffic Sources */}
            <div className="rounded-card bg-surface-card p-[22px] shadow-card animate-[fadeUp_.35s_ease_both] [animation-delay:.2s]">
              <div className="mb-1 text-[13.5px] font-bold text-on-surface">Traffic Sources</div>
              <div className="mb-3.5 text-[10.5px] text-on-surface-var">Share of total views</div>
              <div className="flex items-center gap-3.5 mb-3">
                {/* Donut */}
                <div className="relative shrink-0" style={{ width: 110, height: 110 }}>
                  {countries.length > 0 ? (
                    <Doughnut
                      data={{
                        labels: countries.map((c) => c.country),
                        datasets: [{
                          data: countries.map((c) => c.percentage),
                          backgroundColor: donutColors.slice(0, countries.length),
                          borderWidth: 0,
                          hoverOffset: 4,
                        }],
                      }}
                      options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: "74%",
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            backgroundColor: "#2c3437",
                            titleColor: "#fff",
                            bodyColor: "#acb3b7",
                            padding: 9,
                            cornerRadius: 7,
                            callbacks: { label: (c) => "  " + c.parsed + "%" },
                          },
                        },
                      }}
                    />
                  ) : (
                    <svg width="110" height="110" viewBox="0 0 110 110">
                      <circle cx="55" cy="55" r="42" fill="none" stroke="#f0f4f7" strokeWidth="14" />
                    </svg>
                  )}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-lg font-extrabold text-on-surface">{formatViewsShort(stats?.totalViews ?? 0)}</span>
                    <span className="text-[8.5px] font-semibold uppercase tracking-[.06em] text-on-surface-var">Total</span>
                  </div>
                </div>
                {/* Country legend */}
                <div className="flex flex-1 flex-col gap-[7px]">
                  {countries.length > 0 ? countries.map((c, i) => (
                    <div key={c.country} className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm leading-none">{countryFlags[c.code] ?? "\u{1F30D}"}</span>
                        <span className="text-[11.5px] text-on-surface">{c.country}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1 w-12 overflow-hidden rounded-full bg-surface-high">
                          <div className="h-full rounded-full" style={{ width: `${c.percentage}%`, background: donutColors[i % donutColors.length] }} />
                        </div>
                        <span className="w-[26px] text-right font-mono text-[11px] font-semibold text-on-surface">{c.percentage}%</span>
                      </div>
                    </div>
                  )) : (
                    <p className="py-2 text-center text-[11px] text-on-surface-var/50">No data</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── Bottom Row: Recent Videos + Sidebar ── */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_290px]" style={{ alignItems: "start" }}>
            {/* Recent Videos */}
            <div className="rounded-card bg-surface-card shadow-card animate-[fadeUp_.35s_ease_both] [animation-delay:.15s]">
              <div className="flex items-center justify-between px-[22px] py-4" style={{ marginBottom: 0 }}>
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-bold text-on-surface">Recent Videos</span>
                  <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[.05em] text-[#515064]">{totalVideoCount} total</span>
                </div>
                <button onClick={() => router.push("/videos")} className="flex items-center gap-1 rounded-btn px-3.5 py-[7px] text-[11.5px] font-bold text-white shadow-[0_4px_12px_rgba(91,90,139,.25)] transition-all hover:shadow-[0_6px_18px_rgba(91,90,139,.35)] hover:-translate-y-px" style={{ background: "linear-gradient(135deg, #5b5a8b 0%, #4f4e7e 100%)" }}>
                  <span className="material-symbols-outlined text-sm">add</span>Upload
                </button>
              </div>

              {videos.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-on-surface-var/50">
                  No videos found. Upload your first video!
                </div>
              ) : (
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr>
                      <th className="px-3 pb-2.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Title</th>
                      <th className="hidden px-3 pb-2.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var md:table-cell">Duration</th>
                      <th className="hidden px-3 pb-2.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var sm:table-cell">Views</th>
                      <th className="hidden px-3 pb-2.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var sm:table-cell">Status</th>
                      <th className="hidden px-3 pb-2.5 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var lg:table-cell">Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map((video, idx) => (
                      <tr key={video.id} className="transition-colors hover:bg-surface-low/40">
                        <td className="border-t border-surface-low px-3 py-[11px]">
                          <div className="flex items-center gap-2.5">
                            <div
                              className="relative flex h-7 w-[44px] shrink-0 items-center justify-center overflow-hidden rounded-[5px]"
                              style={video.thumbnail_url ? undefined : { background: thumbnailGradients[idx % thumbnailGradients.length] }}
                            >
                              {video.thumbnail_url ? (
                                <img
                                  src={video.thumbnail_url}
                                  alt=""
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                />
                              ) : (
                                <span className="material-symbols-outlined text-[13px] text-white" style={{ fontVariationSettings: "'FILL' 1" }}>play_circle</span>
                              )}
                            </div>
                            <span className="text-[12.5px] font-semibold text-on-surface">{video.title}</span>
                          </div>
                        </td>
                        <td className="hidden border-t border-surface-low px-3 py-[11px] font-mono text-[12.5px] text-on-surface-var md:table-cell">
                          {formatDuration(video.duration)}
                        </td>
                        <td className="hidden border-t border-surface-low px-3 py-[11px] font-mono text-[12.5px] text-on-surface sm:table-cell">
                          {(video.views_count ?? 0).toLocaleString()}
                        </td>
                        <td className="hidden border-t border-surface-low px-3 py-[11px] sm:table-cell">
                          <div className="flex items-center gap-[5px]">
                            <span className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${statusDotColors[video.status] ?? "bg-[#9e9e9e]"}`} />
                            <span className="text-[11.5px] text-on-surface-var">{statusLabels[video.status] ?? video.status}</span>
                          </div>
                        </td>
                        <td className="hidden border-t border-surface-low px-3 py-[11px] text-[11.5px] text-on-surface-var lg:table-cell">
                          {timeAgo(video.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Right Sidebar */}
            <div className="flex flex-col gap-3.5">
              {/* Active Integrations */}
              <div className="rounded-card bg-surface-card p-[22px] shadow-card animate-[fadeUp_.35s_ease_both] [animation-delay:.2s]">
                <div className="mb-3 text-[9.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Active Integrations</div>
                <div className="flex flex-col gap-0.5">
                  {[
                    { name: "Main API Key", icon: "api", bg: "bg-[#111827]" },
                    { name: "Auto-Sync", icon: "webhook", bg: "bg-[#1565c0]" },
                    { name: "CDN Delivery", icon: "cloud", bg: "bg-[#e65100]" },
                  ].map((item) => (
                    <div key={item.name} className="flex items-center gap-3 rounded-btn bg-surface-low p-3.5 transition-colors hover:bg-surface-high">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#4caf50]" />
                      <div className={`flex h-7 w-7 items-center justify-center rounded-[7px] ${item.bg}`}>
                        <span className="material-symbols-outlined text-sm text-white">{item.icon}</span>
                      </div>
                      <span className="flex-1 text-[12.5px] font-medium text-on-surface">{item.name}</span>
                      <span className="material-symbols-outlined text-[17px] text-[#4caf50]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => router.push("/webhooks")} className="mt-2.5 w-full rounded-btn bg-surface-low py-2.5 text-[11.5px] font-bold text-primary transition-colors hover:bg-surface-high">
                  Configure Webhooks
                </button>
              </div>

            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
