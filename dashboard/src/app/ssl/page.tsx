"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";

interface Certificate {
  id: number;
  domain: string;
  method: "dns01" | "http01";
  status: "pending" | "active" | "expired" | "error";
  issued_at: string | null;
  expires_at: string | null;
  last_renewal_at: string | null;
}

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

let toastId = 0;

function formatDate(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function daysUntil(date: string | null) {
  if (!date) return null;
  const diff = new Date(date).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Simulated propagation data
const PROPAGATION_REGIONS = [
  { name: "N. AMERICA", pct: 100 },
  { name: "EUROPE", pct: 100 },
  { name: "ASIA PACIFIC", pct: 84 },
  { name: "S. AMERICA", pct: 92 },
];

export default function SSLPage() {
  const [loading, setLoading] = useState(true);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newMethod, setNewMethod] = useState<"http01" | "dns01">("http01");
  const [cfApiToken, setCfApiToken] = useState("");
  const [cfZoneId, setCfZoneId] = useState("");
  const [cfEmail, setCfEmail] = useState("");
  const [cfAuthType, setCfAuthType] = useState<"token" | "global_key">("token");
  const [showToken, setShowToken] = useState(false);
  const [adding, setAdding] = useState(false);

  // Action states
  const [issuingId, setIssuingId] = useState<number | null>(null);

  const toast = useCallback((message: string, type: "success" | "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const loadCertificates = useCallback(async () => {
    try {
      const data = await api.get<{ certificates: Certificate[] }>("/ssl");
      setCertificates(data.certificates);
    } catch {
      toast("Failed to load certificates", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadCertificates();
  }, [loadCertificates]);

  const openModal = () => {
    setNewDomain("");
    setNewMethod("http01");
    setCfApiToken("");
    setCfZoneId("");
    setCfEmail("");
    setCfAuthType("token");
    setShowToken(false);
    setShowModal(true);
  };

  const closeModal = () => {
    if (!adding) setShowModal(false);
  };

  const dns01Valid = () => {
    if (!cfZoneId.trim()) return false;
    if (cfAuthType === "token" && !cfApiToken.trim()) return false;
    if (cfAuthType === "global_key" && (!cfEmail.trim() || !cfApiToken.trim())) return false;
    return true;
  };

  const addCertificate = async () => {
    if (!newDomain.trim()) return;
    if (newMethod === "dns01" && !dns01Valid()) return;
    setAdding(true);
    try {
      const body: Record<string, string> = {
        domain: newDomain.trim(),
        method: newMethod,
      };
      if (newMethod === "dns01") {
        body.cf_api_token = cfApiToken.trim();
        body.cf_zone_id = cfZoneId.trim();
        body.cf_auth_type = cfAuthType;
        if (cfAuthType === "global_key") body.cf_email = cfEmail.trim();
      }
      await api.post("/ssl", body);
      toast("Domain added", "success");
      setShowModal(false);
      await loadCertificates();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to add domain", "error");
    } finally {
      setAdding(false);
    }
  };

  const issueCertificate = async (id: number) => {
    setIssuingId(id);
    try {
      await api.post(`/ssl/${id}/issue`);
      toast("SSL certificate issued", "success");
      await loadCertificates();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to issue certificate", "error");
    } finally {
      setIssuingId(null);
    }
  };

  const deleteCertificate = async (id: number) => {
    try {
      await api.delete(`/ssl/${id}`);
      toast("Certificate removed", "success");
      await loadCertificates();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to delete certificate", "error");
    }
  };

  const activeCerts = certificates.filter((c) => c.status === "active");
  const totalSlots = 10;

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
          <h1 className="text-lg font-bold text-on-surface">SSL Certificates</h1>
          <p className="mt-1 text-sm text-on-surface-var">Manage TLS certificates for your custom domains</p>
        </div>
        <button
          onClick={openModal}
          className="inline-flex items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium text-white transition-all"
          style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 2px 8px rgba(91,90,139,0.3)" }}
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add Domain
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : (
        <>
          {/* Main two-column layout */}
          <div className="flex gap-6">
            {/* Left: Active Certificates */}
            <div className="flex-1 min-w-0">
              <div className="rounded-card bg-white p-6 shadow-card">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-[15px] font-bold text-on-surface">Active Certificates</h2>
                  <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-success">
                    {activeCerts.length} / {certificates.length} Active
                  </span>
                </div>

                {certificates.length === 0 ? (
                  <div className="py-12 text-center text-sm text-on-surface-var">
                    No SSL certificates registered yet. Add a domain to get started.
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {certificates.map((cert) => {
                      const days = daysUntil(cert.expires_at);
                      const expiringSoon = days !== null && days > 0 && days <= 30;
                      const isValid = cert.status === "active" && !expiringSoon;
                      const isExpiring = cert.status === "active" && expiringSoon;

                      return (
                        <div
                          key={cert.id}
                          className="group flex items-center gap-4 rounded-[12px] border border-on-surface/8 px-5 py-4 transition-all hover:shadow-sm"
                        >
                          {/* Status icon */}
                          <div className="shrink-0">
                            {isExpiring ? (
                              <span className="material-symbols-outlined text-[24px] text-[#e8a817]">warning</span>
                            ) : isValid ? (
                              <span className="material-symbols-outlined text-[24px] text-success" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                            ) : cert.status === "pending" ? (
                              <span className="material-symbols-outlined text-[24px] text-[#e8a817]">schedule</span>
                            ) : (
                              <span className="material-symbols-outlined text-[24px] text-error">cancel</span>
                            )}
                          </div>

                          {/* Domain info */}
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold text-on-surface">{cert.domain}</p>
                            <p className="mt-0.5 text-[12px] text-on-surface-var font-mono">
                              Expires {formatDate(cert.expires_at)} &middot; TLS 1.3
                            </p>
                          </div>

                          {/* Status badge */}
                          {isExpiring ? (
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#e8a817]">Expiring Soon</span>
                          ) : isValid ? (
                            <span className="rounded-full bg-success/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-success">Valid</span>
                          ) : cert.status === "pending" ? (
                            <span className="rounded-full bg-[#e8a817]/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#e8a817]">Pending</span>
                          ) : (
                            <span className="rounded-full bg-error/10 px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider text-error">
                              {cert.status === "expired" ? "Expired" : "Error"}
                            </span>
                          )}

                          {/* Hover actions */}
                          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => issueCertificate(cert.id)}
                              disabled={issuingId === cert.id}
                              className="rounded-md p-1.5 text-on-surface-var transition hover:bg-on-surface/5 hover:text-on-surface"
                              title={cert.status === "active" ? "Renew" : "Issue"}
                            >
                              <span className="material-symbols-outlined text-[16px]">autorenew</span>
                            </button>
                            <button
                              onClick={() => deleteCertificate(cert.id)}
                              className="rounded-md p-1.5 text-on-surface-var transition hover:bg-error/10 hover:text-error"
                              title="Remove"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Certificate Details sidebar */}
            <div className="hidden w-[280px] shrink-0 flex-col gap-5 lg:flex">
              <div>
                <h2 className="mb-4 text-[15px] font-bold text-on-surface">Certificate Details</h2>

                {/* Issuer */}
                <div className="rounded-[12px] border border-on-surface/8 px-5 py-4">
                  <span className="text-[10px] font-bold uppercase tracking-[.12em] text-on-surface-var">Issuer</span>
                  <p className="mt-1 text-[14px] font-semibold text-on-surface">Let&apos;s Encrypt Authority X3</p>
                </div>

                {/* Protocol */}
                <div className="mt-3 rounded-[12px] border border-on-surface/8 px-5 py-4">
                  <span className="text-[10px] font-bold uppercase tracking-[.12em] text-on-surface-var">Protocol</span>
                  <p className="mt-1 text-[24px] font-extrabold text-on-surface leading-tight">TLS 1.3</p>
                </div>

                {/* Certificate Slots */}
                <div className="mt-3 rounded-[12px] border border-on-surface/8 px-5 py-4">
                  <span className="text-[10px] font-bold uppercase tracking-[.12em] text-on-surface-var">Certificate Slots</span>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[13px] text-on-surface-var">Used</span>
                    <span className="text-[14px] font-bold text-on-surface">{certificates.length} / {totalSlots}</span>
                  </div>
                  <div className="mt-2 h-[4px] w-full rounded-full bg-on-surface/8">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(certificates.length / totalSlots) * 100}%`,
                        background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))",
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Add New Certificate button */}
              <button
                onClick={openModal}
                className="flex w-full items-center justify-center gap-2 rounded-btn py-3 text-[13px] font-bold text-white transition-all"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 4px 14px rgba(91,90,139,0.3)" }}
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add New Certificate
              </button>
            </div>
          </div>

          {/* Global Propagation */}
          <div className="mt-8">
            <h2 className="mb-4 text-[15px] font-bold text-on-surface">Global Propagation</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {PROPAGATION_REGIONS.map((region) => (
                <div
                  key={region.name}
                  className="flex flex-col items-center gap-1.5 rounded-[12px] bg-surface-low px-4 py-4 text-center"
                >
                  <span className="text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">{region.name}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${region.pct >= 95 ? "bg-success" : "bg-[#e8a817]"}`} />
                    <span className="text-[15px] font-bold text-on-surface">{region.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add Domain Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(120,120,140,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
          onClick={closeModal}
        >
          <div
            className="w-full max-w-[500px] rounded-[16px] bg-white p-8 shadow-[0_24px_80px_rgba(0,0,0,0.18),0_0_1px_rgba(0,0,0,0.08)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-6 text-[20px] font-extrabold text-on-surface">Add Domain</h3>

            <div className="flex flex-col gap-5">
              {/* Domain */}
              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Domain</label>
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="cdn.example.com"
                  className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface placeholder-on-surface-var/40 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition"
                  autoFocus
                />
              </div>

              {/* Challenge Method */}
              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Challenge Method</label>
                <select
                  value={newMethod}
                  onChange={(e) => setNewMethod(e.target.value as "http01" | "dns01")}
                  className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition appearance-none"
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23596064' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center" }}
                >
                  <option value="http01">HTTP-01 (Nginx)</option>
                  <option value="dns01">DNS-01 (Cloudflare)</option>
                </select>
              </div>

              {/* Cloudflare Zone ID */}
              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Cloudflare Zone ID</label>
                <input
                  type="text"
                  value={cfZoneId}
                  onChange={(e) => setCfZoneId(e.target.value)}
                  placeholder="e.g. abc123def456..."
                  disabled={newMethod !== "dns01"}
                  className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface placeholder-on-surface-var/40 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition disabled:bg-surface disabled:text-on-surface-var/30 disabled:cursor-not-allowed"
                />
              </div>

              {/* Auth Type */}
              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Auth Type</label>
                <select
                  value={cfAuthType}
                  onChange={(e) => setCfAuthType(e.target.value as "token" | "global_key")}
                  disabled={newMethod !== "dns01"}
                  className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition appearance-none disabled:bg-surface disabled:text-on-surface-var/30 disabled:cursor-not-allowed"
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23596064' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center" }}
                >
                  <option value="token">API Token (Recommended)</option>
                  <option value="global_key">Global API Key</option>
                </select>
              </div>

              {/* Cloudflare Email (only for global_key) */}
              {cfAuthType === "global_key" && newMethod === "dns01" && (
                <div>
                  <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">Cloudflare Email</label>
                  <input
                    type="email"
                    value={cfEmail}
                    onChange={(e) => setCfEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 text-[14px] text-on-surface placeholder-on-surface-var/40 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition"
                  />
                </div>
              )}

              {/* Cloudflare API Token */}
              <div>
                <label className="mb-2 block text-[10.5px] font-bold uppercase tracking-[.1em] text-on-surface-var">
                  {cfAuthType === "global_key" && newMethod === "dns01" ? "Global API Key" : "Cloudflare API Token"}
                </label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    value={cfApiToken}
                    onChange={(e) => setCfApiToken(e.target.value)}
                    placeholder={cfAuthType === "global_key" ? "Enter your Global API Key" : "Enter your Cloudflare API token"}
                    disabled={newMethod !== "dns01"}
                    className="w-full rounded-[8px] border border-on-surface/12 bg-white px-4 py-2.5 pr-16 text-[14px] text-on-surface placeholder-on-surface-var/40 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 transition disabled:bg-surface disabled:text-on-surface-var/30 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-[12px] font-medium text-on-surface-var hover:text-on-surface transition"
                  >
                    {showToken ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-3">
              <button
                onClick={closeModal}
                disabled={adding}
                className="rounded-btn px-5 py-2.5 text-[13px] font-bold text-on-surface-var transition hover:bg-surface-low"
              >
                Cancel
              </button>
              <button
                onClick={addCertificate}
                disabled={adding || !newDomain.trim() || (newMethod === "dns01" && !dns01Valid())}
                className="rounded-btn px-6 py-2.5 text-[13px] font-bold text-white transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 4px 14px rgba(91,90,139,0.3)" }}
              >
                {adding ? "Adding..." : "Add Domain"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
