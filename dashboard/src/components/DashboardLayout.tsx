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
  "/audit": "Audit Log",
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

          {/* Title + Breadcrumb — matches old HTML topbar styling */}
          <div className="flex flex-col justify-center">
            <h2 className="text-[18px] font-extrabold leading-tight tracking-[-0.4px] text-on-surface">{title}</h2>
            <div className="flex items-center gap-[5px] mt-0.5">
              <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Home</span>
              <span className="material-symbols-outlined text-[12px] text-on-surface-var">chevron_right</span>
              <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-primary">
                {title === "Dashboard" ? "Overview" : title}
              </span>
            </div>
          </div>

          <div className="flex-1" />

          {/* Right-side actions — search pill + ⌘K hint + theme toggle + bell + gear */}
          <div className="hidden items-center gap-1.5 sm:flex">
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-var/55 text-[16px]">search</span>
              <input
                type="text"
                placeholder="Search archive..."
                className="search-pill pr-12 placeholder-on-surface-var/55"
              />
              <span className="kbd-hint pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">⌘K</span>
            </div>
            <button className="icon-btn" aria-label="Toggle theme" title="Toggle theme">
              <span className="material-symbols-outlined text-[18px]">dark_mode</span>
            </button>
            <button className="icon-btn" aria-label="Notifications" title="Notifications">
              <span className="material-symbols-outlined text-[18px]">notifications</span>
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
