"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";

interface Webhook {
  id: number;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  created_at: string;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

let toastId = 0;

const ALL_EVENTS = [
  "video.uploaded",
  "video.processed",
  "video.deleted",
  "video.viewed",
  "storage.limit_reached",
  "api.key_revoked",
];

// Simulated recent deliveries
const RECENT_DELIVERIES = [
  { event: "video.uploaded", endpoint: "Auto-Sync", status: 200, statusText: "200 OK", time: "2m ago" },
  { event: "video.processed", endpoint: "Analytics Push", status: 200, statusText: "200 OK", time: "14m ago" },
  { event: "video.viewed", endpoint: "Slack Notifier", status: 500, statusText: "500 ERR", time: "1h ago" },
  { event: "video.uploaded", endpoint: "Auto-Sync", status: 200, statusText: "200 OK", time: "3h ago" },
];

// Simulated endpoint names/icons
const ENDPOINT_COLORS = ["#5b5a8b", "#2e7d32", "#e8a817", "#1976d2", "#c2185b"];

function getEndpointName(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0].replace(/^www$/, host);
  } catch {
    return url;
  }
}

export default function WebhooksPage() {
  const [loading, setLoading] = useState(true);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // Menu
  const [menuIdx, setMenuIdx] = useState<number | null>(null);

  const toast = useCallback((message: string, type: "success" | "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const loadWebhooks = useCallback(async () => {
    try {
      const data = await api.get<{ webhooks: Webhook[] }>("/webhooks");
      setWebhooks(data.webhooks);
    } catch {
      toast("Failed to load webhooks", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadWebhooks();
  }, [loadWebhooks]);

  useEffect(() => {
    const close = () => setMenuIdx(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const addWebhook = async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    try {
      const data = await api.post<{ secret: string }>("/webhooks", {
        url: newUrl.trim(),
        events: newEvents.length > 0 ? newEvents : undefined,
      });
      setNewSecret(data.secret);
      setNewUrl("");
      setNewEvents([]);
      setShowAdd(false);
      toast("Webhook added", "success");
      await loadWebhooks();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to add webhook", "error");
    } finally {
      setAdding(false);
    }
  };

  const toggleActive = async (index: number, active: boolean) => {
    try {
      await api.put(`/webhooks/${index}`, { active });
      toast(active ? "Webhook enabled" : "Webhook disabled", "success");
      await loadWebhooks();
    } catch {
      toast("Failed to update webhook", "error");
    }
  };

  const deleteWebhook = async (index: number) => {
    try {
      await api.delete(`/webhooks/${index}`);
      toast("Webhook deleted", "success");
      await loadWebhooks();
    } catch {
      toast("Failed to delete webhook", "error");
    }
  };

  const testWebhook = async (url: string) => {
    try {
      const result = await api.post<{ success: boolean; message: string }>("/webhooks/test", { url });
      toast(result.message, result.success ? "success" : "error");
    } catch {
      toast("Test failed", "error");
    }
  };

  // Subscribe events state (display only)
  const [subscribedEvents, setSubscribedEvents] = useState<Record<string, boolean>>({
    "video.uploaded": true,
    "video.processed": true,
    "video.deleted": false,
    "video.viewed": true,
    "storage.limit_reached": true,
    "api.key_revoked": false,
  });

  return (
    <DashboardLayout>
      {/* Toast */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-btn border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              t.type === "success" ? "border-success/30 bg-success/10 text-success" : "border-error/30 bg-error/10 text-error"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.type === "success" ? "check_circle" : "error"}</span>
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>

      {/* Page header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-on-surface">Webhooks</h1>
          <p className="mt-1 text-sm text-on-surface-var">Configure event-driven integrations</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setNewSecret(null); }}
          className="inline-flex items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium text-white transition-all"
          style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 2px 8px rgba(91,90,139,0.3)" }}
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          New Webhook
        </button>
      </div>

      {/* New secret banner */}
      {newSecret && (
        <div className="mb-6 rounded-card border border-success/30 bg-success/10 p-5">
          <div className="mb-2 text-[13px] font-bold text-success">
            Webhook Signing Secret — Save it now!
          </div>
          <code className="block rounded-[8px] border border-on-surface/10 bg-white px-4 py-2.5 text-[13px] font-mono text-on-surface">
            {newSecret}
          </code>
          <p className="mt-2 text-[11px] text-on-surface-var">
            Use this secret to verify webhook signatures via the X-Webhook-Signature header (HMAC-SHA256).
          </p>
          <button onClick={() => setNewSecret(null)} className="mt-2 text-xs text-on-surface-var hover:text-on-surface transition">
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Left column */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Configured Endpoints */}
            <div className="rounded-card bg-white p-6 shadow-card">
              <h2 className="mb-5 text-[15px] font-bold text-on-surface">Configured Endpoints</h2>

              {webhooks.length === 0 ? (
                <div className="py-12 text-center text-sm text-on-surface-var">
                  No webhooks configured yet. Add one to receive event notifications.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {webhooks.map((wh, idx) => {
                    const name = getEndpointName(wh.url);
                    const color = ENDPOINT_COLORS[idx % ENDPOINT_COLORS.length];
                    const isFailing = !wh.active;

                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-4 rounded-[12px] border border-on-surface/8 px-5 py-4 transition-all hover:shadow-sm"
                      >
                        {/* Icon */}
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                          style={{ backgroundColor: color + "18" }}
                        >
                          <span
                            className="material-symbols-outlined text-[20px]"
                            style={{ color }}
                          >
                            webhook
                          </span>
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-bold text-on-surface">{wh.url.includes("://") ? name.charAt(0).toUpperCase() + name.slice(1) + " Endpoint" : wh.url}</p>
                          <p className="mt-0.5 truncate text-[12px] font-mono text-on-surface-var">{wh.url}</p>
                        </div>

                        {/* Status badge */}
                        {isFailing ? (
                          <span className="text-[11px] font-bold uppercase tracking-wider text-error">Failing</span>
                        ) : (
                          <span className="rounded-full bg-success/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-success">Active</span>
                        )}

                        {/* Menu button */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuIdx(menuIdx === idx ? null : idx);
                            }}
                            className="rounded-md p-1.5 text-on-surface-var transition hover:bg-on-surface/5"
                          >
                            <span className="material-symbols-outlined text-[18px]">more_horiz</span>
                          </button>

                          {menuIdx === idx && (
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-[10px] bg-white py-1.5 shadow-xl border border-on-surface/8">
                              <button
                                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-on-surface transition hover:bg-surface-low"
                                onClick={() => { testWebhook(wh.url); setMenuIdx(null); }}
                              >
                                <span className="material-symbols-outlined text-[16px]">send</span>
                                Test
                              </button>
                              <button
                                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-on-surface transition hover:bg-surface-low"
                                onClick={() => { toggleActive(idx, !wh.active); setMenuIdx(null); }}
                              >
                                <span className="material-symbols-outlined text-[16px]">{wh.active ? "pause" : "play_arrow"}</span>
                                {wh.active ? "Disable" : "Enable"}
                              </button>
                              <button
                                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-error transition hover:bg-error/5"
                                onClick={() => { deleteWebhook(idx); setMenuIdx(null); }}
                              >
                                <span className="material-symbols-outlined text-[16px]">delete</span>
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recent Deliveries */}
            <div className="rounded-card bg-white p-6 shadow-card">
              <h2 className="mb-5 text-[15px] font-bold text-on-surface">Recent Deliveries</h2>
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-on-surface/8">
                    <th className="py-3 pr-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">Event</th>
                    <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">Endpoint</th>
                    <th className="py-3 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">Status</th>
                    <th className="py-3 pl-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {RECENT_DELIVERIES.map((d, i) => (
                    <tr key={i} className={i < RECENT_DELIVERIES.length - 1 ? "border-b border-on-surface/6" : ""}>
                      <td className="py-3.5 pr-4 text-[13px] font-mono text-on-surface">{d.event}</td>
                      <td className="py-3.5 px-4 text-[13px] text-on-surface-var">{d.endpoint}</td>
                      <td className="py-3.5 px-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
                          d.status === 200
                            ? "bg-success/10 text-success"
                            : "bg-error/10 text-error"
                        }`}>
                          {d.statusText}
                        </span>
                      </td>
                      <td className="py-3.5 pl-4 text-[13px] text-on-surface-var">{d.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="hidden w-[280px] shrink-0 flex-col gap-6 lg:flex">
            {/* Subscribe to Events */}
            <div>
              <h2 className="mb-4 text-[15px] font-bold text-on-surface">Subscribe to Events</h2>
              <div className="flex flex-col gap-4">
                {ALL_EVENTS.map((ev) => (
                  <div key={ev} className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-on-surface">{ev}</span>
                    <button
                      onClick={() => setSubscribedEvents((prev) => ({ ...prev, [ev]: !prev[ev] }))}
                      className={`relative h-[22px] w-[42px] shrink-0 cursor-pointer rounded-full transition-colors ${
                        subscribedEvents[ev] ? "bg-primary" : "bg-on-surface/15"
                      }`}
                    >
                      <div
                        className={`absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform ${
                          subscribedEvents[ev] ? "left-[23px]" : "left-[3px]"
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Delivery Stats */}
            <div>
              <h2 className="mb-4 text-[15px] font-bold text-on-surface">Delivery Stats</h2>
              <div className="flex gap-3">
                <div className="flex-1 rounded-[12px] border border-on-surface/8 px-4 py-4 text-center">
                  <span className="block text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Success Rate</span>
                  <span className="mt-1 block text-[22px] font-extrabold text-success">96.4%</span>
                </div>
                <div className="flex-1 rounded-[12px] border border-on-surface/8 px-4 py-4 text-center">
                  <span className="block text-[10px] font-bold uppercase tracking-[.1em] text-on-surface-var">Avg Latency</span>
                  <span className="mt-1 block text-[22px] font-extrabold text-on-surface">142ms</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Webhook Modal */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(120,120,140,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
          onClick={() => !adding && setShowAdd(false)}
        >
          <div
            className="w-full max-w-[480px] rounded-[16px] bg-white p-7 shadow-[0_24px_80px_rgba(0,0,0,0.18),0_0_1px_rgba(0,0,0,0.08)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-extrabold text-on-surface">New Webhook</h3>
            <p className="mt-1 mb-6 text-[13px] text-on-surface-var">Add an endpoint to receive event notifications</p>

            <div className="flex flex-col gap-5">
              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Endpoint URL</label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://example.com/webhook"
                  className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface placeholder-on-surface-var/40 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Events (leave empty for all)</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_EVENTS.map((ev) => (
                    <button
                      key={ev}
                      type="button"
                      onClick={() => toggleEvent(ev)}
                      className={`rounded-[8px] border px-3.5 py-2 text-[12px] font-medium transition ${
                        newEvents.includes(ev)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-on-surface/12 text-on-surface-var hover:border-on-surface/25"
                      }`}
                    >
                      {ev}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-3">
              <button
                onClick={() => setShowAdd(false)}
                disabled={adding}
                className="rounded-btn px-5 py-2.5 text-[13px] font-bold text-on-surface-var transition hover:bg-surface-low"
              >
                Cancel
              </button>
              <button
                onClick={addWebhook}
                disabled={adding || !newUrl.trim()}
                className="rounded-btn px-6 py-2.5 text-[13px] font-bold text-white transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 4px 14px rgba(91,90,139,0.3)" }}
              >
                {adding ? "Adding..." : "Add Webhook"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
