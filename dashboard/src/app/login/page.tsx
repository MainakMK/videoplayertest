"use client";

import { useState, FormEvent, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

type Step = "credentials" | "totp";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 2FA step
  const [tempToken, setTempToken] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const totpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "totp") setTimeout(() => totpRef.current?.focus(), 50);
  }, [step]);

  const handleCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const r = await api.post<{ requires2fa?: boolean; tempToken?: string }>("/auth/login", { username, password });
      if (r.requires2fa && r.tempToken) {
        setTempToken(r.tempToken);
        setStep("totp");
        setLoading(false);
        return;
      }
      router.push("/");
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Login failed. Please try again.");
      setLoading(false);
    }
  };

  const handleTotp = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: Record<string, string> = { tempToken };
      const code = totpCode.replace(/\s/g, "");
      if (useBackupCode) body.backupCode = code;
      else body.totpCode = code;
      await api.post("/2fa/challenge", body);
      router.push("/");
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || (useBackupCode ? "Invalid backup code" : "Invalid authenticator code"));
      setLoading(false);
    }
  };

  const cancelTotp = () => {
    setStep("credentials");
    setError("");
    setTotpCode("");
    setTempToken("");
    setUseBackupCode(false);
  };

  const inputBase =
    "w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 outline-none focus:ring-2 focus:ring-primary/30";
  const primaryBtn =
    "w-full rounded-btn bg-gradient-to-r from-primary to-primary-dim px-4 py-2.5 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] transition-all hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <span className="material-symbols-outlined text-primary text-[40px]">movie</span>
          <h1 className="mt-2 text-2xl font-bold text-on-surface">The Archive</h1>
          <p className="mt-1 text-sm text-on-surface-var">
            {step === "credentials" ? "Sign in to your dashboard" : "Two-factor authentication"}
          </p>
        </div>

        {step === "credentials" ? (
          <form onSubmit={handleCredentials} className="rounded-card bg-surface-card p-6 shadow-lg">
            {error && (
              <div className="mb-4 rounded-btn bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-on-surface">
                  Email or Username
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  placeholder="you@example.com"
                  className={inputBase}
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-on-surface">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={inputBase}
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className={`mt-6 ${primaryBtn}`}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleTotp} className="rounded-card bg-surface-card p-6 shadow-lg">
            {error && (
              <div className="mb-4 rounded-btn bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
            )}

            <div className="mb-4 flex items-start gap-3 rounded-btn bg-surface-low px-4 py-3">
              <span className="material-symbols-outlined text-[20px] text-primary">lock</span>
              <p className="text-[12.5px] leading-snug text-on-surface-var">
                {useBackupCode
                  ? "Enter one of your saved backup codes. Each code can be used only once."
                  : "Open your authenticator app and enter the 6-digit code for The Archive."}
              </p>
            </div>

            <div>
              <label htmlFor="totp" className="mb-1.5 block text-sm font-medium text-on-surface">
                {useBackupCode ? "Backup code" : "Authenticator code"}
              </label>
              <input
                ref={totpRef}
                id="totp"
                type="text"
                inputMode={useBackupCode ? "text" : "numeric"}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
                autoComplete="one-time-code"
                placeholder={useBackupCode ? "xxxx-xxxx-xxxx" : "123 456"}
                maxLength={useBackupCode ? 24 : 10}
                className={`${inputBase} text-center tracking-[0.25em] font-mono text-base`}
              />
            </div>

            <button type="submit" disabled={loading || !totpCode.trim()} className={`mt-6 ${primaryBtn}`}>
              {loading ? "Verifying..." : "Verify and sign in"}
            </button>

            <div className="mt-4 flex items-center justify-between text-[12px]">
              <button
                type="button"
                onClick={() => { setUseBackupCode(v => !v); setTotpCode(""); setError(""); }}
                className="font-medium text-primary hover:text-primary-dim"
              >
                {useBackupCode ? "Use authenticator code instead" : "Use a backup code"}
              </button>
              <button
                type="button"
                onClick={cancelTotp}
                className="font-medium text-on-surface-var hover:text-on-surface"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
