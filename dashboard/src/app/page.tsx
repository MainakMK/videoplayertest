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

function DeltaBadge({ pct }: { pct: number | null | undefined; pill?: boolean }) {
  if (pct === null || pct === undefined || pct === 0) return null;
  const up = pct > 0;
  const arrow = up ? "\u2191" : "\u2193";
  const abs = Math.abs(pct).toFixed(1);
  // Use the shared .badge-pill.badge-up/.badge-down tokens so delta styling stays
  // consistent with the other badges across the app (Active Integrations, status, etc.).
  return (
    <span className={`badge-pill ${up ? "badge-up" : "badge-down"}`}>
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
      {/* Page title + breadcrumb are rendered by DashboardLayout's topbar; no duplicate heading here */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface-var/20 border-t-primary" />
        </div>
      ) : (
        <>
          {/* ── KPI Cards — independent cards w/ colored left accent stripes.
               Mobile grid: 2 cols at narrow widths (Storage + Bandwidth side-by-side,
               Cloudflare R2 then spans BOTH columns so its "NOT CONFIGURED" badge
               doesn't get squished like it did in the earlier cramped layout). ── */}
          <div className="grid grid-cols-2 gap-[12px] sm:gap-[14px] mb-5 xl:grid-cols-5">
            {/* Total Videos */}
            <div className="card-base fade-up delay-1">
              <div className="card-accent" style={{ background: "#5b5a8b" }} />
              <div className="mb-[14px] flex items-center justify-between">
                <span className="section-label">Total Videos</span>
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px]" style={{ background: "#ededfa" }}>
                  <span className="material-symbols-outlined text-[15px] text-primary">video_library</span>
                </div>
              </div>
              <div className="stat-num">{totalVideoCount}</div>
              <div className="mt-[10px] flex items-center justify-between">
                <span className="text-[11px] text-on-surface-var">Videos in archive</span>
                {(storage?.createdLast7d ?? 0) > 0 ? (
                  <span className="badge-pill badge-up">+{storage?.createdLast7d} this week</span>
                ) : null}
              </div>
            </div>

            {/* Total Views */}
            <div className="card-base fade-up delay-2">
              <div className="card-accent" style={{ background: "#755478" }} />
              <div className="mb-[14px] flex items-center justify-between">
                <span className="section-label">Total Views</span>
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px]" style={{ background: "#fdeafd" }}>
                  <span className="material-symbols-outlined text-[15px]" style={{ color: "#755478" }}>visibility</span>
                </div>
              </div>
              <div className="stat-num">{formatViewsShort(stats?.totalViews ?? 0)}</div>
              <div className="mt-[10px] flex items-center justify-between">
                <span className="text-[11px] text-on-surface-var">Across all content</span>
                <DeltaBadge pct={stats?.viewsDeltaPct ?? null} />
              </div>
            </div>

            {/* Storage Used */}
            <div className="card-base fade-up delay-3">
              <div className="card-accent" style={{ background: "#607d8b" }} />
              <div className="mb-[14px] flex items-center justify-between">
                <span className="section-label">Storage Used</span>
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px]" style={{ background: "#eceff1" }}>
                  <span className="material-symbols-outlined text-[15px]" style={{ color: "#607d8b" }}>database</span>
                </div>
              </div>
              <div className="stat-num">
                {storageFmt.value}<span className="ml-0.5 text-[16px] font-medium text-on-surface-var">{storageFmt.unit}</span>
              </div>
              <div className="mt-[10px]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] text-on-surface-var">of {storageCapGB} GB</span>
                  <span className="text-[11px] font-bold text-primary">{storagePct}%</span>
                </div>
                <div className="storage-track">
                  <div className="storage-fill" style={{ width: `${storagePct}%` }} />
                </div>
              </div>
            </div>

            {/* Bandwidth */}
            <div className="card-base fade-up delay-4">
              <div className="card-accent" style={{ background: "#2196f3" }} />
              <div className="mb-[14px] flex items-center justify-between">
                <span className="section-label">Bandwidth</span>
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px]" style={{ background: "#e3f2fd" }}>
                  <span className="material-symbols-outlined text-[15px]" style={{ color: "#2196f3" }}>network_check</span>
                </div>
              </div>
              <div className="stat-num">
                {bwFmt.value}<span className="ml-0.5 text-[16px] font-medium text-on-surface-var">{bwFmt.unit}</span>
              </div>
              <div className="mt-[10px] flex items-center justify-between">
                <span className="text-[11px] text-on-surface-var">This month</span>
                <DeltaBadge pct={bandwidth?.monthDeltaPct ?? null} pill />
              </div>
            </div>

            {/* Cloudflare R2 — uses the legacy HTML's custom stacked-disks SVG
                (not material cloud icon) for instantly recognisable R2 branding.
                On mobile (≤xl) it spans both columns so the "NOT CONFIGURED" badge
                doesn't get cramped into a half-width card. */}
            <div className="card-base fade-up delay-5 col-span-2 xl:col-span-1">
              <div className="card-accent" style={{ background: "#f38020" }} />
              <div className="mb-[14px] flex items-center justify-between">
                <span className="section-label">Cloudflare R2</span>
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px]" style={{ background: "#fff4ec" }}>
                  <svg width="18" height="18" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Cloudflare R2">
                    <ellipse cx="32" cy="12" rx="22" ry="8" fill="#F6821F"/>
                    <path d="M10 12v14c0 4.4 9.8 8 22 8s22-3.6 22-8V12c0 4.4-9.8 8-22 8s-22-3.6-22-8z" fill="#F6821F"/>
                    <path d="M10 26v14c0 4.4 9.8 8 22 8s22-3.6 22-8V26c0 4.4-9.8 8-22 8s-22-3.6-22-8z" fill="#F6821F"/>
                    <path d="M10 40v12c0 4.4 9.8 8 22 8s22-3.6 22-8V40c0 4.4-9.8 8-22 8s-22-3.6-22-8z" fill="#F6821F"/>
                    <circle cx="38" cy="14" r="2" fill="white" opacity="0.7"/>
                    <circle cx="38" cy="28" r="2" fill="white" opacity="0.7"/>
                    <circle cx="38" cy="42" r="2" fill="white" opacity="0.7"/>
                  </svg>
                </div>
              </div>
              <div className="stat-num">
                {r2Fmt.value}<span className="ml-0.5 text-[16px] font-medium text-on-surface-var">{r2Fmt.unit}</span>
              </div>
              <div className="mt-[10px] flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-on-surface-var">{storage?.usage.r2.count ?? 0} video{(storage?.usage.r2.count ?? 0) !== 1 ? "s" : ""} &middot; R2</span>
                {!storage?.r2_configured && (
                  <span className="badge-pill badge-neutral">Not configured</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Engagement KPIs — only the 2 live-operations ones:
               Active Embeds + Processing Queue. Earlier Avg Watch Time,
               Completion Rate, Unique Viewers, Top Device cards were
               removed per user request — they live in the Analytics page
               and don't need dashboard real-estate. ── */}
          <div className="grid grid-cols-1 gap-[14px] mb-5 sm:grid-cols-2">
            {/* Active Embeds */}
            <div className="card-base fade-up delay-1">
              <div className="card-accent" style={{ background: "#f57c00" }} />
              <div className="mb-[14px] flex items-center justify-between">
                <span className="section-label">Active Embeds</span>
                <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px]" style={{ background: "#fff8e1" }}>
                  <span className="material-symbols-outlined text-[15px]" style={{ color: "#f57c00" }}>public</span>
                </div>
              </div>
              <div className="stat-num">{stats?.activeEmbeds ?? 0}</div>
              <div className="mt-[10px] flex items-center justify-between">
                <span className="text-[11px] text-on-surface-var">Host domains</span>
                <DeltaBadge pct={stats?.activeEmbedsDeltaPct ?? null} />
              </div>
            </div>

            {/* Processing Queue */}
            {(() => {
              const pending = queue?.pending ?? 0;
              const failed = queue?.failed ?? 0;
              const idle = pending === 0 && failed === 0;
              const accent = failed > 0 ? "#c62828" : pending > 0 ? "#ef6c00" : "#2e7d32";
              const iconBg = failed > 0 ? "#fce4ec" : pending > 0 ? "#fff4e5" : "#e8f5e9";
              const iconName = failed > 0 ? "error" : pending > 0 ? "sync" : "check_circle";
              return (
                <div className="card-base fade-up delay-2">
                  <div className="card-accent" style={{ background: accent }} />
                  <div className="mb-[14px] flex items-center justify-between">
                    <span className="section-label">Processing Queue</span>
                    <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px]" style={{ background: iconBg }}>
                      <span className="material-symbols-outlined text-[15px]" style={{ color: accent }}>{iconName}</span>
                    </div>
                  </div>
                  <div className="stat-num">{pending}</div>
                  <div className="mt-[10px] flex items-center justify-between">
                    <span className="text-[11px] text-on-surface-var">
                      {idle ? "Idle" : `${queue?.active ?? 0} active \u00b7 ${queue?.waiting ?? 0} waiting`}
                    </span>
                    {failed > 0 && (
                      <span className="badge-pill badge-down">{failed} failed</span>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* ── Charts Row ── */}
          <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-[1fr_1fr_320px]" style={{ marginBottom: 20, alignItems: "start" }}>
            {/* Views Over Time */}
            <div className="card-base fade-up delay-2">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[13.5px] font-bold text-on-surface">Views Over Time</div>
                  <div className="mt-[2px] text-[10.5px] text-on-surface-var">Last {chartRange === "7d" ? "7 days" : chartRange === "30d" ? "30 days" : chartRange === "90d" ? "90 days" : chartRange === "6m" ? "6 months" : "year"}</div>
                </div>
                <div className="tab-bar">
                  {(["7d", "30d", "90d", "6m", "1y"] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setChartRange(r)}
                      data-active={chartRange === r}
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
            <div className="card-base fade-up delay-3">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[13.5px] font-bold text-on-surface">Top Videos</div>
                  <div className="mt-[2px] text-[10.5px] text-on-surface-var">By play count</div>
                </div>
                <button
                  onClick={() => router.push("/videos")}
                  className="rounded-[6px] bg-surface-low px-2.5 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-surface-high"
                >
                  View All
                </button>
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
            <div className="card-base fade-up delay-4">
              <div className="mb-[2px] text-[13.5px] font-bold text-on-surface">Traffic Sources</div>
              <div className="mb-[14px] text-[10.5px] text-on-surface-var">Share of total views</div>
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
            <div className="card-base fade-up delay-3 !p-0 overflow-hidden">
              <div className="flex items-center justify-between px-[22px] py-[18px]">
                <div className="flex items-center gap-2.5">
                  <span className="text-[15px] font-bold" style={{ color: "#2c3437" }}>Recent Videos</span>
                  <span className="badge-pill badge-neutral">{totalVideoCount} TOTAL</span>
                </div>
                <button
                  onClick={() => router.push("/videos?upload=1")}
                  className="btn-primary-gradient"
                  title="Upload a new video"
                >
                  <span className="material-symbols-outlined text-[15px]">add</span>
                  Upload
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
                      <th className="px-[22px] pb-[10px] text-[9.5px] font-bold uppercase tracking-[.08em]" style={{ color: "#596064" }}>Title</th>
                      <th className="hidden px-3 pb-[10px] text-[9.5px] font-bold uppercase tracking-[.08em] md:table-cell" style={{ color: "#596064" }}>Duration</th>
                      <th className="hidden px-3 pb-[10px] text-[9.5px] font-bold uppercase tracking-[.08em] sm:table-cell" style={{ color: "#596064" }}>Views</th>
                      <th className="hidden px-3 pb-[10px] text-[9.5px] font-bold uppercase tracking-[.08em] sm:table-cell" style={{ color: "#596064" }}>Status</th>
                      <th className="hidden px-3 pb-[10px] text-[9.5px] font-bold uppercase tracking-[.08em] lg:table-cell" style={{ color: "#596064" }}>Uploaded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {videos.map((video, idx) => (
                      <tr
                        key={video.id}
                        className="cursor-pointer transition-colors"
                        onClick={() => router.push(`/videos?id=${video.id}`)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f4f7"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                        title={`Open ${video.title}`}
                      >
                        <td className="border-t px-[22px] py-[11px]" style={{ borderColor: "#f0f4f7" }}>
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
                            <span className="text-[12.5px] font-semibold" style={{ color: "#2c3437" }}>{video.title}</span>
                          </div>
                        </td>
                        <td className="hidden border-t px-3 py-[11px] font-mono text-[12.5px] md:table-cell" style={{ borderColor: "#f0f4f7", color: "#596064" }}>
                          {formatDuration(video.duration)}
                        </td>
                        <td className="hidden border-t px-3 py-[11px] font-mono text-[12.5px] sm:table-cell" style={{ borderColor: "#f0f4f7", color: "#2c3437" }}>
                          {(video.views_count ?? 0).toLocaleString()}
                        </td>
                        <td className="hidden border-t px-3 py-[11px] sm:table-cell" style={{ borderColor: "#f0f4f7" }}>
                          <div className="flex items-center gap-[5px]">
                            <span className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${statusDotColors[video.status] ?? "bg-[#9e9e9e]"}`} />
                            <span className="text-[11.5px]" style={{ color: "#596064" }}>{statusLabels[video.status] ?? video.status}</span>
                          </div>
                        </td>
                        <td className="hidden border-t px-3 py-[11px] text-[11.5px] lg:table-cell" style={{ borderColor: "#f0f4f7", color: "#596064" }}>
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
              <div className="card-base fade-up delay-4">
                <div className="section-label mb-3">Active Integrations</div>
                <div className="flex flex-col gap-1.5">
                  {[
                    { name: "Main API Key", icon: "api", bg: "#111827" },
                    { name: "Auto-Sync", icon: "webhook", bg: "#1565c0" },
                    { name: "CDN Delivery", icon: "cloud", bg: "#e65100" },
                  ].map((item) => (
                    <div key={item.name} className="flex items-center gap-3 rounded-[9px] bg-surface-low px-[14px] py-3 transition-colors hover:bg-surface-high">
                      <span className="status-dot status-dot-green" />
                      <div className="flex h-7 w-7 items-center justify-center rounded-[7px]" style={{ background: item.bg }}>
                        <span className="material-symbols-outlined text-[14px] text-white">{item.icon}</span>
                      </div>
                      <span className="flex-1 text-[12.5px] font-medium text-on-surface">{item.name}</span>
                      <span className="material-symbols-outlined text-[17px] text-[#4caf50]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => router.push("/webhooks")}
                  className="btn-secondary-soft mt-3 w-full justify-center"
                >
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
