"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
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
  { label: "Audit Log", href: "/audit", icon: "manage_history" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

interface MeResponse {
  admin?: {
    id: number;
    email: string;
    display_name?: string | null;
    role?: string;
    avatar_url?: string | null;
  };
}

// ────────────────────────────────────────────────────────
// Design tokens (matches legacy dashboard/index.html exactly)
//   --surface-low  #f0f4f7   sidebar background
//   --surface-card #ffffff   active nav item + user card
//   --primary      #5b5a8b   active nav text + left stripe
//   --surface-high #e3e9ed   hover bg
//   --on-surface-var #596064 muted text
// ────────────────────────────────────────────────────────

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse["admin"] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fetch the signed-in admin for the user card
  useEffect(() => {
    api.get<MeResponse>("/auth/me")
      .then((data) => setMe(data.admin ?? null))
      .catch(() => setMe(null));
  }, []);

  // Close the user dropdown on outside-click
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // proceed even if logout request fails
    }
    setMenuOpen(false);
    router.push("/login");
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  // Initials for avatar fallback — first letters of first two words of display name,
  // or first 2 chars of email if no name.
  const initials = (() => {
    if (me?.display_name) {
      const parts = me.display_name.trim().split(/\s+/);
      return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
    }
    if (me?.email) return me.email.slice(0, 2).toUpperCase();
    return "AR";
  })();

  const displayName = me?.display_name || me?.email || "Loading...";
  const displayRole = me
    ? me.role
      ? me.role.charAt(0).toUpperCase() + me.role.slice(1)
      : "Admin"
    : "";

  const renderNavItem = (item: { label: string; href: string; icon: string }) => {
    const active = isActive(item.href);
    // Inline styles guarantee the colors apply even if a Tailwind utility is
    // missing from the JIT scan. Matches the legacy CSS exactly.
    const itemStyle: React.CSSProperties = active
      ? {
          background: "#ffffff",
          color: "#5b5a8b",
          fontWeight: 700,
          boxShadow: "0 2px 8px rgba(91, 90, 139, 0.08)",
        }
      : {
          background: "transparent",
          color: "#596064",
          fontWeight: 500,
        };

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        className="relative flex items-center gap-[11px] rounded-[9px] px-3 py-[9px] text-[13px] transition-all duration-150 hover:text-[#2c3437]"
        style={itemStyle}
        onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "#e3e9ed"; }}
        onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        {active && (
          <span
            className="absolute left-0 w-[3px]"
            style={{ top: "22%", bottom: "22%", borderRadius: "0 2px 2px 0", background: "#5b5a8b" }}
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
        className={`fixed top-0 left-0 z-40 flex h-full w-sidebar flex-col overflow-y-auto px-3.5 pt-6 pb-3.5 transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0 shadow-[4px_0_32px_rgba(0,0,0,.12)]" : "-translate-x-full"
        }`}
        style={{ background: "#f0f4f7" }}
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
            <div className="text-[14.5px] font-extrabold tracking-tight leading-tight" style={{ color: "#2c3437" }}>
              The Archive
            </div>
            <div className="text-[9px] font-bold uppercase tracking-[.1em] mt-px" style={{ color: "#596064" }}>
              Video Management
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1">
          <div className="text-[9.5px] font-bold uppercase tracking-[.12em] px-2 pt-4 pb-1.5" style={{ color: "rgba(89,96,100,.6)" }}>
            Main
          </div>
          <div className="space-y-0.5">
            {mainNavItems.map(renderNavItem)}
          </div>

          <div className="text-[9.5px] font-bold uppercase tracking-[.12em] px-2 pt-4 pb-1.5" style={{ color: "rgba(89,96,100,.6)" }}>
            System
          </div>
          <div className="space-y-0.5">
            {systemNavItems.map(renderNavItem)}
          </div>
        </nav>

        {/* User card with dropdown menu */}
        <div className="mt-auto relative" ref={menuRef}>
          <div
            className="flex w-full items-center gap-[9px] rounded-[11px] p-3"
            style={{ background: "#ffffff", boxShadow: "0 1px 4px rgba(0,0,0,.04)" }}
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white overflow-hidden"
              style={{ background: "linear-gradient(135deg, #5b5a8b, #755478)" }}
            >
              {me?.avatar_url ? (
                <img src={me.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <div className="text-[12px] font-bold truncate" style={{ color: "#2c3437" }}>{displayName}</div>
              <div className="text-[10px]" style={{ color: "#596064" }}>{displayRole}</div>
            </div>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="shrink-0 flex items-center justify-center w-[26px] h-[26px] rounded transition-colors"
              style={{ color: "rgba(89,96,100,.7)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#e3e9ed"; (e.currentTarget as HTMLElement).style.color = "#2c3437"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "rgba(89,96,100,.7)"; }}
              title="User menu"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="material-symbols-outlined text-sm">more_vert</span>
            </button>
          </div>

          {menuOpen && (
            <div
              role="menu"
              className="absolute bottom-full left-0 right-0 mb-2 rounded-[11px] overflow-hidden z-50"
              style={{ background: "#ffffff", boxShadow: "0 8px 24px rgba(0,0,0,.12)" }}
            >
              <Link
                href="/settings"
                onClick={() => { setMenuOpen(false); onClose(); }}
                role="menuitem"
                className="flex items-center gap-[10px] px-[14px] py-[10px] text-[12.5px] transition-colors"
                style={{ color: "#2c3437" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f4f7"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span className="material-symbols-outlined text-[16px]">account_circle</span>
                Account settings
              </Link>
              <Link
                href="/settings"
                onClick={() => { setMenuOpen(false); onClose(); }}
                role="menuitem"
                className="flex items-center gap-[10px] px-[14px] py-[10px] text-[12.5px] transition-colors"
                style={{ color: "#2c3437" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f0f4f7"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span className="material-symbols-outlined text-[16px]">key</span>
                Change password
              </Link>
              <div className="h-px" style={{ background: "#e3e9ed" }} />
              <button
                onClick={handleLogout}
                role="menuitem"
                className="flex w-full items-center gap-[10px] px-[14px] py-[10px] text-[12.5px] font-bold transition-colors text-left"
                style={{ color: "#a8364b" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fce4ec"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span className="material-symbols-outlined text-[16px]">logout</span>
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
