"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateRange = "today" | "7d" | "30d" | "all";

interface ViewPoint {
  date: string;
  views: number;
}

interface TopVideo {
  id: string;
  title: string;
  thumbnail: string | null;
  views: number;
  avgWatchTime: string;
}

interface DeviceBreakdown {
  desktop: number;
  mobile: number;
  tablet: number;
}

interface CountryEntry {
  country: string;
  code: string;
  views: number;
  percentage: number;
}

interface AnalyticsData {
  totalViews: number;
  uniqueViewers: number;
  avgWatchTime: string;
  topCountry: string;
  viewsOverTime: ViewPoint[];
  topVideos: TopVideo[];
  devices: DeviceBreakdown;
  countries: CountryEntry[];
}

interface RealtimeData {
  totalViews: number;
  uniqueViewers: number;
  avgWatchTime: string;
  hourly: Array<{ hour: number; views: number }>;
}

interface AdAnalyticsData {
  popupClicks: number;
  vastImpressions: number;
  dailyData: Array<{ date: string; popup: number; vast: number }>;
}

// ---------------------------------------------------------------------------
// Date range options
// ---------------------------------------------------------------------------

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>("30d");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [realtime, setRealtime] = useState<RealtimeData | null>(null);
  const [adData, setAdData] = useState<AdAnalyticsData | null>(null);

  const fetchData = useCallback(
    (r: DateRange) => {
      setLoading(true);
      Promise.all([
        api.get<AnalyticsData>(`/analytics/overview?range=${r}`).catch(() => null),
        api.get<AdAnalyticsData>(`/analytics/ads?range=${r}`).catch(() => null),
      ]).then(([overview, ads]) => {
        setData(overview);
        setAdData(ads);
      }).finally(() => setLoading(false));
    },
    []
  );

  // Fetch realtime data and auto-refresh every 30s
  const fetchRealtime = useCallback(() => {
    api
      .get<RealtimeData>("/analytics/realtime")
      .then(setRealtime)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchRealtime();
    const interval = setInterval(fetchRealtime, 30000);
    return () => clearInterval(interval);
  }, [fetchRealtime]);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  const handleRange = (r: DateRange) => {
    setRange(r);
  };

  // -----------------------------------------------------------------------
  // Stat cards
  // -----------------------------------------------------------------------

  const statCards = data
    ? [
        { label: "Total Views", value: data.totalViews.toLocaleString(), icon: "visibility", iconBg: "bg-primary/10 text-primary" },
        { label: "Unique Viewers", value: data.uniqueViewers.toLocaleString(), icon: "group", iconBg: "bg-success/10 text-success" },
        { label: "Avg Watch Time", value: data.avgWatchTime, icon: "schedule", iconBg: "bg-tertiary/10 text-tertiary" },
        { label: "Top Country", value: data.topCountry || "N/A", icon: "public", iconBg: "bg-primary-container/30 text-primary" },
      ]
    : [];

  // -----------------------------------------------------------------------
  // Chart helpers
  // -----------------------------------------------------------------------

  const maxViews = data?.viewsOverTime?.length
    ? Math.max(...data.viewsOverTime.map((p) => p.views), 1)
    : 1;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <DashboardLayout>
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-on-surface">Analytics</h1>
        <p className="mt-1 text-sm text-on-surface-var">Track your video performance</p>
      </div>

      {/* Date range selector */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {DATE_RANGES.map((dr) => (
          <button
            key={dr.value}
            onClick={() => handleRange(dr.value)}
            className={`rounded-btn px-4 py-2 text-sm font-medium transition-colors ${
              range === dr.value
                ? "bg-gradient-to-r from-primary to-primary-dim text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)]"
                : "border border-on-surface/15 bg-surface-card text-on-surface-var hover:bg-surface-low"
            }`}
          >
            {dr.label}
          </button>
        ))}
      </div>

      {/* Today's Activity — Realtime */}
      {realtime && (
        <div className="mb-8 rounded-card bg-surface-card p-6 shadow-card">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-on-surface">Today&apos;s Activity</h3>
            <span className="flex items-center gap-1.5 text-xs text-success">
              <span className="inline-block h-2 w-2 rounded-full bg-success animate-pulse" />
              Live — updates every 30s
            </span>
          </div>

          {/* Realtime stat cards */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-btn border border-on-surface/10 bg-surface px-4 py-3">
              <p className="text-xs text-on-surface-var">Views Today</p>
              <p className="mt-0.5 text-xl font-bold text-on-surface">{realtime.totalViews.toLocaleString()}</p>
            </div>
            <div className="rounded-btn border border-on-surface/10 bg-surface px-4 py-3">
              <p className="text-xs text-on-surface-var">Unique Viewers</p>
              <p className="mt-0.5 text-xl font-bold text-on-surface">{realtime.uniqueViewers.toLocaleString()}</p>
            </div>
            <div className="rounded-btn border border-on-surface/10 bg-surface px-4 py-3">
              <p className="text-xs text-on-surface-var">Avg Watch Time</p>
              <p className="mt-0.5 text-xl font-bold text-on-surface">{realtime.avgWatchTime}</p>
            </div>
          </div>

          {/* Hourly chart */}
          <div>
            <p className="mb-2 text-xs font-medium text-on-surface-var">Views by Hour</p>
            <div className="flex items-end gap-[3px]" style={{ height: 100 }}>
              {(() => {
                const maxH = Math.max(...realtime.hourly.map((h) => h.views), 1);
                const currentHour = new Date().getHours();
                return realtime.hourly.map((h) => {
                  const heightPct = (h.views / maxH) * 100;
                  const isCurrent = h.hour === currentHour;
                  return (
                    <div
                      key={h.hour}
                      className="group relative flex flex-1 flex-col items-center justify-end"
                      style={{ height: "100%" }}
                    >
                      {/* Tooltip */}
                      <div className="absolute -top-7 hidden rounded bg-on-surface px-2 py-1 text-xs text-white whitespace-nowrap group-hover:block z-10">
                        {h.hour}:00 — {h.views} views
                      </div>
                      <div
                        className={`w-full rounded-sm transition-all ${
                          isCurrent
                            ? "bg-primary"
                            : h.hour <= currentHour
                              ? "bg-primary-container group-hover:bg-primary-dim"
                              : "bg-surface-low"
                        }`}
                        style={{
                          height: h.hour <= currentHour ? `${Math.max(heightPct, 3)}%` : "3%",
                          minHeight: 2,
                        }}
                      />
                    </div>
                  );
                });
              })()}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-on-surface-var">
              <span>12am</span>
              <span>6am</span>
              <span>12pm</span>
              <span>6pm</span>
              <span>11pm</span>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : !data ? (
        <p className="text-sm text-on-surface-var">Failed to load analytics data.</p>
      ) : (
        <>
          {/* Stat cards */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {statCards.map((card) => (
              <div key={card.label} className="rounded-card bg-surface-card p-5 shadow-card">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-btn ${card.iconBg}`}>
                    <span className="material-symbols-outlined text-[20px]">{card.icon}</span>
                  </div>
                  <div>
                    <p className="text-sm text-on-surface-var">{card.label}</p>
                    <p className="text-2xl font-bold text-on-surface">{card.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Views over time chart */}
          <div className="mb-8 rounded-card bg-surface-card p-6 shadow-card">
            <h3 className="mb-4 text-base font-semibold text-on-surface">Views Over Time</h3>
            {data.viewsOverTime.length === 0 ? (
              <p className="text-sm text-on-surface-var">No view data available.</p>
            ) : (
              <div className="flex items-end gap-1 overflow-x-auto pb-2" style={{ minHeight: 180 }}>
                {data.viewsOverTime.map((point, i) => {
                  const heightPct = (point.views / maxViews) * 100;
                  return (
                    <div key={i} className="group flex flex-1 flex-col items-center" style={{ minWidth: 24 }}>
                      {/* Tooltip */}
                      <div className="mb-1 hidden rounded bg-on-surface px-2 py-1 text-xs text-white group-hover:block">
                        {point.views.toLocaleString()}
                      </div>
                      {/* Bar */}
                      <div
                        className="w-full max-w-[32px] rounded-t bg-primary transition-all group-hover:bg-primary-container"
                        style={{ height: `${Math.max(heightPct, 2)}%`, minHeight: 2 }}
                      />
                      {/* Label */}
                      <span className="mt-1 text-[10px] text-on-surface-var truncate max-w-[40px]">
                        {point.date}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Top Videos */}
          <div className="mb-8 rounded-card bg-surface-card shadow-card">
            <div className="border-b border-on-surface/10 px-6 py-4">
              <h3 className="text-base font-semibold text-on-surface">Top Videos</h3>
            </div>
            {data.topVideos.length === 0 ? (
              <p className="px-6 py-6 text-sm text-on-surface-var">No video data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-on-surface/10 text-on-surface-var">
                      <th className="px-6 py-3 font-medium w-12">#</th>
                      <th className="px-6 py-3 font-medium">Video</th>
                      <th className="hidden px-6 py-3 font-medium sm:table-cell">Views</th>
                      <th className="hidden px-6 py-3 font-medium md:table-cell">Avg Watch Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-on-surface/10">
                    {data.topVideos.map((video, i) => (
                      <tr key={video.id} className="transition-colors hover:bg-surface-low/60">
                        <td className="px-6 py-3 text-on-surface-var">{i + 1}</td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-3">
                            {video.thumbnail ? (
                              <img
                                src={video.thumbnail}
                                alt={video.title}
                                className="h-10 w-16 shrink-0 rounded bg-surface-low object-cover"
                              />
                            ) : (
                              <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-surface-low text-xs text-on-surface-var">
                                &#9654;
                              </div>
                            )}
                            <span className="font-medium text-on-surface truncate max-w-xs">{video.title}</span>
                          </div>
                        </td>
                        <td className="hidden px-6 py-3 text-on-surface-var sm:table-cell">
                          {video.views.toLocaleString()}
                        </td>
                        <td className="hidden px-6 py-3 text-on-surface-var md:table-cell">
                          {video.avgWatchTime}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Device breakdown + Country breakdown */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Device breakdown */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h3 className="mb-4 text-base font-semibold text-on-surface">Device Breakdown</h3>
              <div className="space-y-4">
                {(
                  [
                    { label: "Desktop", value: data.devices.desktop, color: "bg-primary" },
                    { label: "Mobile", value: data.devices.mobile, color: "bg-success" },
                    { label: "Tablet", value: data.devices.tablet, color: "bg-[#e8a817]" },
                  ] as const
                ).map((device) => (
                  <div key={device.label}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-on-surface">{device.label}</span>
                      <span className="text-on-surface-var">{device.value}%</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-surface-low">
                      <div
                        className={`h-2.5 rounded-full ${device.color} transition-all`}
                        style={{ width: `${device.value}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Country breakdown */}
            <div className="rounded-card bg-surface-card p-6 shadow-card">
              <h3 className="mb-4 text-base font-semibold text-on-surface">Top Countries</h3>
              {data.countries.length === 0 ? (
                <p className="text-sm text-on-surface-var">No country data available.</p>
              ) : (
                <div className="space-y-3">
                  {data.countries.slice(0, 10).map((entry) => (
                    <div key={entry.code}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-on-surface">{entry.country}</span>
                        <span className="text-on-surface-var">
                          {entry.views.toLocaleString()} ({entry.percentage}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-surface-low">
                        <div
                          className="h-2 rounded-full bg-tertiary transition-all"
                          style={{ width: `${entry.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Ad Analytics */}
          {adData && (adData.popupClicks > 0 || adData.vastImpressions > 0 || adData.dailyData.length > 0) && (
            <div className="mt-8 rounded-card bg-surface-card p-6 shadow-card">
              <h3 className="mb-4 text-base font-semibold text-on-surface">Ad Analytics</h3>

              {/* Ad stat cards */}
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-btn border-l-4 border-tertiary bg-tertiary/10 px-4 py-3">
                  <p className="text-xs text-on-surface-var">Popup Ad Clicks</p>
                  <p className="mt-0.5 text-2xl font-bold text-tertiary">{adData.popupClicks.toLocaleString()}</p>
                </div>
                <div className="rounded-btn border-l-4 border-primary bg-primary/10 px-4 py-3">
                  <p className="text-xs text-on-surface-var">VAST Ad Impressions</p>
                  <p className="mt-0.5 text-2xl font-bold text-primary">{adData.vastImpressions.toLocaleString()}</p>
                </div>
              </div>

              {/* Ad daily chart */}
              {adData.dailyData.length > 0 && (() => {
                const maxAd = Math.max(
                  ...adData.dailyData.map((d) => Math.max(d.popup, d.vast)),
                  1
                );
                return (
                  <div>
                    <p className="mb-2 text-xs font-medium text-on-surface-var">Daily Ad Events</p>
                    <div className="flex items-end gap-1 overflow-x-auto pb-2" style={{ minHeight: 140 }}>
                      {adData.dailyData.map((point, i) => {
                        const popupPct = (point.popup / maxAd) * 100;
                        const vastPct = (point.vast / maxAd) * 100;
                        return (
                          <div key={i} className="group flex flex-1 flex-col items-center" style={{ minWidth: 28 }}>
                            {/* Tooltip */}
                            <div className="mb-1 hidden rounded bg-on-surface px-2 py-1 text-xs text-white whitespace-nowrap group-hover:block z-10">
                              Popup: {point.popup} | VAST: {point.vast}
                            </div>
                            {/* Stacked bars */}
                            <div className="flex w-full max-w-[32px] flex-col items-stretch gap-[1px]">
                              <div
                                className="w-full rounded-t bg-primary-container transition-all group-hover:bg-primary"
                                style={{ height: `${Math.max(vastPct, 2)}%`, minHeight: point.vast > 0 ? 3 : 0 }}
                              />
                              <div
                                className="w-full rounded-b bg-tertiary transition-all group-hover:bg-tertiary/80"
                                style={{ height: `${Math.max(popupPct, 2)}%`, minHeight: point.popup > 0 ? 3 : 0 }}
                              />
                            </div>
                            {/* Label */}
                            <span className="mt-1 text-[10px] text-on-surface-var truncate max-w-[40px]">
                              {point.date}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-on-surface-var">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-tertiary" /> Popup Clicks
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-primary-container" /> VAST Impressions
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  );
}
