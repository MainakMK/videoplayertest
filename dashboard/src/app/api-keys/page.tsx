"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";

interface ApiKey {
  id: number;
  name: string;
  key_preview: string;
  permissions: string[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

let toastId = 0;

const PERMISSION_ITEMS = [
  { key: "read", label: "Read Videos", desc: "List and fetch video data" },
  { key: "upload", label: "Upload Videos", desc: "Ingest new video content" },
  { key: "delete", label: "Delete Videos", desc: "Permanently remove content" },
  { key: "admin", label: "Manage Webhooks", desc: "Create and delete webhooks" },
];

export default function ApiKeysPage() {
  const [loading, setLoading] = useState(true);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPermissions, setNewPermissions] = useState<string[]>(["read"]);
  const [newExpiryDays, setNewExpiryDays] = useState<string>("0");
  const [creating, setCreating] = useState(false);

  // Newly created key (shown once)
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toast = useCallback((message: string, type: "success" | "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const data = await api.get<{ api_keys: ApiKey[] }>("/api-keys");
      setApiKeys(data.api_keys);
    } catch {
      toast("Failed to load API keys", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const togglePermission = (perm: string) => {
    setNewPermissions((prev) =>
      prev.includes(perm)
        ? prev.filter((p) => p !== perm)
        : [...prev, perm]
    );
  };

  const createKey = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const data = await api.post<{ key: string; api_key: ApiKey }>("/api-keys", {
        name: newName.trim(),
        permissions: newPermissions,
        expires_in_days: Number(newExpiryDays) || null,
      });
      setCreatedKey(data.key);
      setCopied(false);
      setNewName("");
      setNewPermissions(["read"]);
      setNewExpiryDays("0");
      setShowCreate(false);
      toast("API key created", "success");
      await loadKeys();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to create API key", "error");
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: number, name: string) => {
    try {
      await api.delete(`/api-keys/${id}`);
      toast(`"${name}" revoked`, "success");
      await loadKeys();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to revoke key", "error");
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Failed to copy", "error");
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatRelative = (date: string | null) => {
    if (!date) return "Never";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  };

  // Determine key type for styling
  const getKeyType = (key: ApiKey): "active" | "test" | "revoked" => {
    if (key.key_preview.startsWith("ark_test_")) return "test";
    if (key.expires_at && new Date(key.expires_at) < new Date()) return "revoked";
    return "active";
  };

  const typeStyles = {
    active: { dot: "bg-success", badge: "bg-success/10 text-success", label: "ACTIVE" },
    test: { dot: "bg-[#1976d2]", badge: "bg-[#1976d2]/10 text-[#1976d2]", label: "TEST" },
    revoked: { dot: "bg-on-surface-var/40", badge: "bg-on-surface/5 text-on-surface-var", label: "REVOKED" },
  };

  return (
    <DashboardLayout>
      {/* Toast */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-btn border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              t.type === "success"
                ? "border-success/30 bg-success/10 text-success"
                : "border-error/30 bg-error/10 text-error"
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
          <h1 className="text-lg font-bold text-on-surface">API Keys</h1>
          <p className="mt-1 text-sm text-on-surface-var">Manage authentication keys for the Archive API</p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setCreatedKey(null); }}
          className="inline-flex items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium text-white transition-all"
          style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 2px 8px rgba(91,90,139,0.3)" }}
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Generate Key
        </button>
      </div>

      {/* Newly created key banner */}
      {createdKey && (
        <div className="mb-6 rounded-card border border-success/30 bg-success/10 p-5">
          <div className="mb-2 text-[13px] font-bold text-success">
            API Key Created — Copy it now, it won&apos;t be shown again!
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 rounded-[8px] border border-on-surface/10 bg-white px-4 py-2.5 text-[13px] font-mono text-on-surface">
              {createdKey}
            </code>
            <button
              onClick={() => copyToClipboard(createdKey)}
              className="rounded-btn border border-on-surface/15 bg-white px-4 py-2 text-xs font-medium text-on-surface-var hover:bg-surface-low transition"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={() => setCreatedKey(null)}
              className="text-xs text-on-surface-var hover:text-on-surface transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Left: Active Keys */}
          <div className="flex-1 min-w-0">
            <div className="rounded-card bg-white p-6 shadow-card">
              <h2 className="mb-5 text-[15px] font-bold text-on-surface">Active Keys</h2>

              {apiKeys.length === 0 ? (
                <div className="py-12 text-center text-sm text-on-surface-var">
                  No API keys created yet. Generate a key to get started.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {apiKeys.map((key) => {
                    const type = getKeyType(key);
                    const style = typeStyles[type];
                    const isRevoked = type === "revoked";

                    return (
                      <div
                        key={key.id}
                        className={`rounded-[12px] border border-on-surface/8 p-5 transition-all ${isRevoked ? "opacity-50" : ""}`}
                      >
                        {/* Header row */}
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                            <span className="text-[14px] font-bold text-on-surface">{key.name}</span>
                          </div>
                          <span className={`rounded-full px-3 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${style.badge}`}>
                            {style.label}
                          </span>
                        </div>

                        {/* Key preview */}
                        <div className="mb-3 flex items-center gap-2 rounded-[8px] border border-on-surface/8 bg-surface px-4 py-2.5">
                          <code className="flex-1 text-[13px] font-mono text-on-surface-var">{key.key_preview}</code>
                          <button
                            onClick={() => copyToClipboard(key.key_preview)}
                            className="shrink-0 rounded p-1 text-on-surface-var/50 transition hover:bg-on-surface/5 hover:text-on-surface-var"
                            title="Copy"
                          >
                            <span className="material-symbols-outlined text-[16px]">content_copy</span>
                          </button>
                        </div>

                        {/* Footer row */}
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-on-surface-var">
                            {isRevoked
                              ? `Revoked ${formatDate(key.expires_at)}`
                              : `Created ${formatDate(key.created_at)} \u00B7 Last used ${formatRelative(key.last_used_at)}`
                            }
                          </span>
                          {!isRevoked && (
                            <button
                              onClick={() => revokeKey(key.id, key.name)}
                              className="rounded-btn bg-error px-4 py-1.5 text-[11.5px] font-bold text-white transition hover:bg-error/90"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: Permissions & Rate Limits sidebar */}
          <div className="hidden w-[280px] shrink-0 flex-col gap-6 lg:flex">
            {/* Key Permissions */}
            <div>
              <h2 className="mb-4 text-[15px] font-bold text-on-surface">Key Permissions</h2>
              <div className="flex flex-col gap-4">
                {PERMISSION_ITEMS.map((perm) => {
                  const isEnabled = perm.key === "read" || perm.key === "upload" || perm.key === "admin";
                  return (
                    <div key={perm.key} className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-on-surface">{perm.label}</p>
                        <p className="text-[11px] text-on-surface-var">{perm.desc}</p>
                      </div>
                      <div
                        className={`relative h-[22px] w-[42px] shrink-0 cursor-pointer rounded-full transition-colors ${
                          isEnabled ? "bg-primary" : "bg-on-surface/15"
                        }`}
                      >
                        <div
                          className={`absolute top-[3px] h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform ${
                            isEnabled ? "left-[23px]" : "left-[3px]"
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rate Limits */}
            <div>
              <h2 className="mb-4 text-[15px] font-bold text-on-surface">Rate Limits</h2>
              <div className="flex flex-col gap-4">
                {/* Requests / hour */}
                <div className="rounded-[12px] border border-on-surface/8 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-on-surface-var">Requests / hour</span>
                    <span className="text-[14px] font-bold font-mono text-on-surface">1,000</span>
                  </div>
                  <div className="mt-2 h-[4px] w-full rounded-full bg-on-surface/8">
                    <div
                      className="h-full rounded-full"
                      style={{ width: "38.2%", background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))" }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-on-surface-var">382 used this hour</p>
                </div>

                {/* Daily bandwidth */}
                <div className="rounded-[12px] border border-on-surface/8 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-on-surface-var">Daily bandwidth</span>
                    <span className="text-[14px] font-bold font-mono text-on-surface">100 GB</span>
                  </div>
                  <div className="mt-2 h-[4px] w-full rounded-full bg-on-surface/8">
                    <div
                      className="h-full rounded-full"
                      style={{ width: "12.4%", background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))" }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-on-surface-var">12.4 GB used today</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Key Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(120,120,140,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="w-full max-w-[460px] rounded-[16px] bg-white p-7 shadow-[0_24px_80px_rgba(0,0,0,0.18),0_0_1px_rgba(0,0,0,0.08)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[17px] font-extrabold text-on-surface">Generate API Key</h3>
            <p className="mt-1 mb-6 text-[13px] text-on-surface-var">Create a new authentication key</p>

            <div className="flex flex-col gap-5">
              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Key Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="My Integration"
                  className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface placeholder-on-surface-var/40 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && createKey()}
                />
              </div>

              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Permissions</label>
                <div className="flex flex-wrap gap-2">
                  {["read", "write", "upload", "delete", "admin"].map((perm) => (
                    <button
                      key={perm}
                      type="button"
                      onClick={() => togglePermission(perm)}
                      className={`rounded-[8px] border px-3.5 py-2 text-[12px] font-medium transition ${
                        newPermissions.includes(perm)
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-on-surface/12 text-on-surface-var hover:border-on-surface/25"
                      }`}
                    >
                      {perm}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Expiry</label>
                <select
                  value={newExpiryDays}
                  onChange={(e) => setNewExpiryDays(e.target.value)}
                  className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition appearance-none"
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23596064' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center" }}
                >
                  <option value="0">Never expires</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="rounded-btn px-5 py-2.5 text-[13px] font-bold text-on-surface-var transition hover:bg-surface-low"
              >
                Cancel
              </button>
              <button
                onClick={createKey}
                disabled={creating || !newName.trim()}
                className="rounded-btn px-6 py-2.5 text-[13px] font-bold text-white transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 4px 14px rgba(91,90,139,0.3)" }}
              >
                {creating ? "Creating..." : "Generate Key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
