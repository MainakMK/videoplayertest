"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import Sidebar from "@/components/Sidebar";

const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/videos": "Videos",
  "/folders": "Folders",
  "/analytics": "Analytics",
  "/settings": "Settings",
  "/ssl": "SSL Certificates",
  "/api-keys": "API Keys",
  "/webhooks": "Webhooks",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    api
      .get("/auth/me")
      .then(() => setLoading(false))
      .catch(() => router.push("/login"));
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface-var/20 border-t-primary" />
      </div>
    );
  }

  const title =
    pageTitles[pathname] ??
    pathname
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/^\w/, (c) => c.toUpperCase()) ??
    "Dashboard";

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 px-9 shadow-[0_1px_0_rgba(44,52,55,0.06)] backdrop-blur-[20px]" style={{ background: "rgba(247,249,251,.88)" }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-on-surface-var hover:text-on-surface lg:hidden"
          >
            <span className="material-symbols-outlined text-[24px]">menu</span>
          </button>

          {/* Title + Breadcrumb */}
          <div className="flex flex-col justify-center">
            <h1 className="text-lg font-bold leading-tight text-on-surface">{title}</h1>
            <div className="flex items-center gap-[5px] mt-0.5">
              <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Home</span>
              <span className="material-symbols-outlined text-[11px] text-outline-var">chevron_right</span>
              <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-primary">Overview</span>
            </div>
          </div>

          <div className="flex-1" />

          {/* Right-side actions */}
          <div className="hidden items-center gap-2 sm:flex">
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-var/50 text-[18px]">search</span>
              <input
                type="text"
                placeholder="Search archive..."
                className="w-44 rounded-input border-0 bg-surface-low py-1.5 pl-9 pr-3 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button className="rounded-btn p-2 text-on-surface-var transition-colors hover:bg-on-surface/5 hover:text-on-surface">
              <span className="material-symbols-outlined text-[20px]">notifications</span>
            </button>
            <button className="rounded-btn p-2 text-on-surface-var transition-colors hover:bg-on-surface/5 hover:text-on-surface">
              <span className="material-symbols-outlined text-[20px]">settings</span>
            </button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto px-9 py-7">
          <div className="animate-fadeUp">{children}</div>
        </main>
      </div>
    </div>
  );
}
