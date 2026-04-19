"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.post("/auth/login", { username, password });
      router.push("/");
    } catch (err) {
      const apiErr = err as ApiError;
      setError(apiErr.message || "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 text-center">
          <span className="material-symbols-outlined text-primary text-[40px]">movie</span>
          <h1 className="mt-2 text-2xl font-bold text-on-surface">
            The Archive
          </h1>
          <p className="mt-1 text-sm text-on-surface-var">
            Sign in to your dashboard
          </p>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-card bg-surface-card p-6 shadow-lg"
        >
          {error && (
            <div className="mb-4 rounded-btn bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="mb-1.5 block text-sm font-medium text-on-surface"
              >
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
                className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-on-surface"
              >
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
                className="w-full rounded-input border-0 bg-surface-low px-4 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-6 w-full rounded-btn bg-gradient-to-r from-primary to-primary-dim px-4 py-2.5 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] transition-all hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
