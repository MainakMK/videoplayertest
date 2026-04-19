"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";

const mainNavItems = [
  { label: "Dashboard", href: "/", icon: "dashboard" },
  { label: "Videos", href: "/videos", icon: "movie" },
  { label: "Folders", href: "/folders", icon: "folder" },
  { label: "Analytics", href: "/analytics", icon: "insights" },
];

const systemNavItems = [
  { label: "SSL", href: "/ssl", icon: "verified_user" },
  { label: "API Keys", href: "/api-keys", icon: "vpn_key" },
  { label: "Webhooks", href: "/webhooks", icon: "webhook" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // proceed even if logout request fails
    }
    router.push("/login");
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const renderNavItem = (item: { label: string; href: string; icon: string }) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={`relative flex items-center gap-[11px] rounded-btn px-3 py-[9px] text-[13px] font-medium transition-all duration-150 ${
          active
            ? "bg-surface-card text-primary font-bold shadow-card"
            : "text-on-surface-var hover:bg-surface-high hover:text-on-surface"
        }`}
      >
        {active && (
          <span
            className="absolute left-0 w-[3px] rounded-r-sm bg-primary"
            style={{ top: "22%", bottom: "22%" }}
          />
        )}
        <span
          className="material-symbols-outlined text-[17px] shrink-0"
          style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          {item.icon}
        </span>
        {item.label}
      </Link>
    );
  };

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-40 flex h-full w-sidebar flex-col overflow-y-auto bg-surface-low px-3.5 pt-6 pb-3.5 transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0 shadow-[4px_0_32px_rgba(0,0,0,.12)]" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-[11px] px-1.5 mb-8">
          <div
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white"
            style={{ background: "#5b5a8b", boxShadow: "0 4px 12px rgba(91,90,139,.3)" }}
          >
            <span
              className="material-symbols-outlined text-[17px]"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              archive
            </span>
          </div>
          <div>
            <div className="text-[14.5px] font-extrabold tracking-tight leading-tight text-on-surface">
              The Archive
            </div>
            <div className="text-[9px] font-bold uppercase tracking-[.1em] text-on-surface-var mt-px">
              Video Management
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1">
          <div className="text-[9.5px] font-bold uppercase tracking-[.12em] text-on-surface-var/60 px-2 pt-4 pb-1.5">
            Main
          </div>
          <div className="space-y-0.5">
            {mainNavItems.map(renderNavItem)}
          </div>

          <div className="text-[9.5px] font-bold uppercase tracking-[.12em] text-on-surface-var/60 px-2 pt-4 pb-1.5">
            System
          </div>
          <div className="space-y-0.5">
            {systemNavItems.map(renderNavItem)}
          </div>
        </nav>

        {/* User card */}
        <div className="mt-auto">
          <div
            className="flex w-full items-center gap-[9px] rounded-[11px] bg-surface-card p-3"
            style={{ boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
              style={{ background: "linear-gradient(135deg, #5b5a8b, #755478)" }}
            >
              AR
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="text-[12px] font-bold text-on-surface truncate">Alex Rivera</div>
              <div className="text-[10px] text-on-surface-var">Pro Plan Admin</div>
            </div>
            <button
              onClick={handleLogout}
              className="shrink-0 flex items-center justify-center w-[26px] h-[26px] rounded text-on-surface-var/50 transition-colors hover:bg-surface-high hover:text-on-surface"
              title="Logout"
            >
              <span className="material-symbols-outlined text-sm">more_vert</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
