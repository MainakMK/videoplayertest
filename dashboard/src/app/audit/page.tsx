"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { api } from "@/lib/api";

interface AuditEntry {
  id: number;
  admin_id: number | null;
  admin_email: string | null;
  admin_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  label: string;
  icon: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Rough color hint per action family — matches the old dashboard's icon chips
const ACTION_CATEGORY: Record<string, { bg: string; color: string }> = {
  video:    { bg: "#ededfa", color: "#5b5a8b" },   // primary
  settings: { bg: "#eceff1", color: "#607d8b" },   // slate
  auth:     { bg: "#e3f2fd", color: "#1565c0" },   // blue
  api_key:  { bg: "#e8f5e9", color: "#2e7d32" },   // green
  webhook:  { bg: "#fff4ec", color: "#e65100" },   // orange
  ssl:      { bg: "#fdeafd", color: "#755478" },   // tertiary
  folder:   { bg: "#fff8e1", color: "#f57c00" },   // amber
  team:     { bg: "#e3e0f9", color: "#515064" },   // secondary
};

function categoryFor(action: string) {
  const head = action.split(".")[0];
  return ACTION_CATEGORY[head] || { bg: "#eceff1", color: "#607d8b" };
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [actions, setActions] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "50" });
      if (actionFilter) qs.set("action", actionFilter);
      const [list, filters] = await Promise.all([
        api.get<{ entries: AuditEntry[]; pagination: Pagination }>(`/audit?${qs.toString()}`),
        actions.length === 0 ? api.get<{ actions: string[] }>(`/audit/actions`) : Promise.resolve({ actions }),
      ]);
      setEntries(list.entries);
      setPagination(list.pagination);
      if (filters.actions.length) setActions(filters.actions);
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      setError(err.message ?? "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter, actions]);

  useEffect(() => { load(); }, [load]);

  return (
    <DashboardLayout>
      {/* Filter bar */}
      <div className="card-base fade-up delay-1 mb-[14px] !p-[14px]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="section-label">Filter</span>
          <select
            value={actionFilter}
            onChange={(e) => { setPage(1); setActionFilter(e.target.value); }}
            className="rounded-[9px] bg-surface-low px-3 py-2 text-[12.5px] text-on-surface border-0 outline-none focus:bg-surface-high"
          >
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <div className="flex-1" />
          {pagination && (
            <span className="text-[11px] text-on-surface-var">
              {pagination.total.toLocaleString()} total entries
            </span>
          )}
          <button onClick={load} className="btn-secondary-soft">
            <span className="material-symbols-outlined text-[15px]">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Entries */}
      <div className="card-base fade-up delay-2 !p-0 overflow-hidden">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-[12px] text-on-surface-var">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-on-surface-var/20 border-t-primary" />
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center text-[13px] text-error">{error}</div>
        ) : entries.length === 0 ? (
          <div className="px-6 py-12 text-center text-[13px] text-on-surface-var">
            No audit entries yet. Admin actions (uploads, settings changes, logins, etc.) are logged here.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="px-[16px] pb-2.5 pt-3.5 text-left text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Action</th>
                <th className="hidden px-[16px] pb-2.5 pt-3.5 text-left text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var md:table-cell">Admin</th>
                <th className="hidden px-[16px] pb-2.5 pt-3.5 text-left text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var lg:table-cell">Resource</th>
                <th className="hidden px-[16px] pb-2.5 pt-3.5 text-left text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var lg:table-cell">IP</th>
                <th className="px-[16px] pb-2.5 pt-3.5 text-right text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const cat = categoryFor(e.action);
                return (
                  <tr key={e.id} className="transition-colors hover:bg-surface-low/50">
                    <td className="border-t border-surface-low px-[16px] py-[11px]">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[7px]" style={{ background: cat.bg }}>
                          <span className="material-symbols-outlined text-[14px]" style={{ color: cat.color }}>{e.icon}</span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-semibold text-on-surface">{e.label}</div>
                          <div className="mt-0.5 font-mono text-[10.5px] text-on-surface-var">{e.action}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden border-t border-surface-low px-[16px] py-[11px] text-[12px] md:table-cell">
                      {e.admin_email ? (
                        <div>
                          <div className="text-on-surface">{e.admin_name || e.admin_email}</div>
                          {e.admin_name && <div className="text-[10.5px] text-on-surface-var">{e.admin_email}</div>}
                        </div>
                      ) : (
                        <span className="text-on-surface-var italic">system</span>
                      )}
                    </td>
                    <td className="hidden border-t border-surface-low px-[16px] py-[11px] text-[12px] lg:table-cell">
                      {e.resource_type ? (
                        <div>
                          <div className="text-on-surface">{e.resource_type}</div>
                          {e.resource_id && <div className="font-mono text-[10.5px] text-on-surface-var">{e.resource_id}</div>}
                        </div>
                      ) : (
                        <span className="text-on-surface-var">—</span>
                      )}
                    </td>
                    <td className="hidden border-t border-surface-low px-[16px] py-[11px] font-mono text-[11px] text-on-surface-var lg:table-cell">
                      {e.ip_address || "—"}
                    </td>
                    <td className="border-t border-surface-low px-[16px] py-[11px] text-right text-[11.5px] text-on-surface-var">
                      <span title={new Date(e.created_at).toLocaleString()}>{timeAgo(e.created_at)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] text-on-surface-var">
            Page {pagination.page} of {pagination.pages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="btn-secondary-soft disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[15px]">chevron_left</span>
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
              disabled={page >= pagination.pages}
              className="btn-secondary-soft disabled:opacity-40"
            >
              Next
              <span className="material-symbols-outlined text-[15px]">chevron_right</span>
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
