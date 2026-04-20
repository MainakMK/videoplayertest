"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";

type Phase = "idle-off" | "idle-on" | "setup" | "verify" | "backup-codes" | "disable" | "regen-codes";

export default function TwoFactorCard({ onToast }: { onToast: (msg: string, tone?: "success" | "error") => void }) {
  const [phase, setPhase] = useState<Phase>("idle-off");
  const [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await api.get<{ enabled: boolean }>("/2fa/status");
      setPhase(r.enabled ? "idle-on" : "idle-off");
    } catch {
      setPhase("idle-off");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const startSetup = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ secret: string; uri: string }>("/2fa/setup", {});
      setSecret(r.secret);
      const dataUrl = await QRCode.toDataURL(r.uri, { width: 220, margin: 1, color: { dark: "#1e1e2f", light: "#ffffff" } });
      setQrDataUrl(dataUrl);
      setToken("");
      setPhase("verify");
    } catch (e: unknown) {
      const err = e as { message?: string };
      onToast(err.message ?? "Failed to start 2FA setup", "error");
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    const code = token.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      onToast("Enter the 6-digit code from your authenticator app", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ enabled: boolean; backupCodes: string[] }>("/2fa/verify", { token: code });
      setBackupCodes(r.backupCodes ?? []);
      setPhase("backup-codes");
      setSecret("");
      setQrDataUrl("");
      onToast("Two-factor authentication enabled", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      onToast(err.message ?? "Invalid code", "error");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!password) {
      onToast("Enter your password to disable 2FA", "error");
      return;
    }
    setBusy(true);
    try {
      await api.post("/2fa/disable", { password });
      onToast("Two-factor authentication disabled", "success");
      setPassword("");
      setPhase("idle-off");
    } catch (e: unknown) {
      const err = e as { message?: string };
      onToast(err.message ?? "Failed to disable 2FA", "error");
    } finally {
      setBusy(false);
    }
  };

  const regenBackup = async () => {
    if (!password) {
      onToast("Enter your password to regenerate backup codes", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ backupCodes: string[] }>("/2fa/backup", { password });
      setBackupCodes(r.backupCodes ?? []);
      setPassword("");
      setPhase("backup-codes");
      onToast("New backup codes generated — old codes are invalid", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      onToast(err.message ?? "Failed to regenerate codes", "error");
    } finally {
      setBusy(false);
    }
  };

  const copyBackup = async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      onToast("Backup codes copied to clipboard", "success");
    } catch {
      onToast("Copy failed — write them down manually", "error");
    }
  };

  const downloadBackup = () => {
    const blob = new Blob([backupCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `the-archive-2fa-backup-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── RENDER ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="h-5 w-40 animate-pulse rounded bg-[#f0f4f7]" />
      </div>
    );
  }

  return (
    <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-on-surface">Two-Factor Authentication</h3>
          <p className="mt-0.5 text-[12px] text-on-surface-var">
            Adds an extra layer of security to your account. You&apos;ll be asked for a one-time code every time you sign in.
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[.05em]"
          style={
            phase === "idle-on" || phase === "regen-codes"
              ? { background: "rgba(46,125,50,0.12)", color: "#2e7d32" }
              : { background: "rgba(158,158,158,0.15)", color: "#596064" }
          }
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: phase === "idle-on" || phase === "regen-codes" ? "#2e7d32" : "#9e9e9e" }} />
          {phase === "idle-on" || phase === "regen-codes" ? "Enabled" : "Disabled"}
        </span>
      </div>

      {phase === "idle-off" && (
        <button
          onClick={startSetup}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[15px]">lock</span>
          {busy ? "Generating…" : "Enable 2FA"}
        </button>
      )}

      {phase === "verify" && qrDataUrl && (
        <div className="grid gap-5 md:grid-cols-[220px_1fr] items-start">
          <div className="rounded-[12px] border border-[#e5e7eb] bg-white p-2">
            {/* QR code data URL rendered via qrcode lib — safe to inline */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="2FA QR code" width={220} height={220} className="rounded-[8px]" />
          </div>
          <div>
            <div className="mb-2 text-[13px] font-semibold text-on-surface">Scan with your authenticator app</div>
            <p className="text-[12px] text-on-surface-var">Use Google Authenticator, 1Password, Authy, or any TOTP-compatible app.</p>

            <div className="mt-3">
              <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Or enter this secret manually</span>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-[8px] bg-[#f0f4f7] px-3 py-2 font-mono text-[12px] tracking-wider text-on-surface">{secret}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(secret); onToast("Secret copied"); }}
                  className="rounded-[8px] bg-[#f0f4f7] px-3 py-2 text-[12px] font-semibold text-primary hover:bg-[#e3e9ed]"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="mt-4">
              <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">6-digit code</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={token}
                  onChange={(e) => setToken(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-[140px] rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-2.5 text-center font-mono text-[16px] tracking-[.3em] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={verifyCode}
                  disabled={busy}
                  className="rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
                >
                  {busy ? "Verifying…" : "Verify & Enable"}
                </button>
                <button
                  onClick={() => { setPhase("idle-off"); setSecret(""); setQrDataUrl(""); setToken(""); }}
                  disabled={busy}
                  className="rounded-[10px] bg-[#f0f4f7] px-4 py-2.5 text-[13px] font-semibold text-on-surface-var hover:bg-[#e3e9ed] disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "backup-codes" && (
        <div>
          <div className="mb-3 rounded-[10px] px-4 py-3 text-[12.5px]" style={{ background: "rgba(245,124,0,0.10)", color: "#ef6c00" }}>
            <strong>Save these backup codes.</strong> Each one can be used once if you lose access to your authenticator. They won&apos;t be shown again.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[13px]">
            {backupCodes.map((c) => (
              <div key={c} className="rounded-[8px] bg-[#f0f4f7] px-3 py-2 text-center tracking-wider text-on-surface">{c}</div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={copyBackup} className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#f0f4f7] px-3 py-2 text-[12px] font-semibold text-primary hover:bg-[#e3e9ed]">
              <span className="material-symbols-outlined text-[14px]">content_copy</span>
              Copy All
            </button>
            <button onClick={downloadBackup} className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#f0f4f7] px-3 py-2 text-[12px] font-semibold text-primary hover:bg-[#e3e9ed]">
              <span className="material-symbols-outlined text-[14px]">download</span>
              Download
            </button>
            <button
              onClick={() => { setBackupCodes([]); setPhase("idle-on"); }}
              className="ml-auto rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)]"
            >
              I&apos;ve saved them
            </button>
          </div>
        </div>
      )}

      {phase === "idle-on" && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPhase("regen-codes")}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#f0f4f7] px-4 py-2 text-[13px] font-semibold text-primary hover:bg-[#e3e9ed]"
          >
            <span className="material-symbols-outlined text-[15px]">refresh</span>
            Regenerate Backup Codes
          </button>
          <button
            onClick={() => setPhase("disable")}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#fce4ec] px-4 py-2 text-[13px] font-semibold text-error hover:bg-[#f8bbd0]"
          >
            <span className="material-symbols-outlined text-[15px]">lock_open</span>
            Disable 2FA
          </button>
        </div>
      )}

      {(phase === "disable" || phase === "regen-codes") && (
        <div>
          <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Confirm with your password</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your account password"
              className="w-[260px] rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-2.5 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none"
              autoFocus
            />
            {phase === "disable" ? (
              <button
                onClick={disable}
                disabled={busy}
                className="rounded-[10px] bg-[#fce4ec] px-4 py-2.5 text-[13px] font-semibold text-error hover:bg-[#f8bbd0] disabled:opacity-50"
              >
                {busy ? "Disabling…" : "Disable 2FA"}
              </button>
            ) : (
              <button
                onClick={regenBackup}
                disabled={busy}
                className="rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50"
              >
                {busy ? "Generating…" : "Regenerate"}
              </button>
            )}
            <button
              onClick={() => { setPhase("idle-on"); setPassword(""); }}
              disabled={busy}
              className="rounded-[10px] bg-[#f0f4f7] px-4 py-2.5 text-[13px] font-semibold text-on-surface-var hover:bg-[#e3e9ed] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
