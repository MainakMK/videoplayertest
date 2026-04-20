"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface TopbarProps {
  title: string;
  onMenuClick: () => void;
  notifications?: { id: string; title: string; tone: "info" | "warn" | "error" | "success"; time?: string }[];
}

const toneColor: Record<string, string> = {
  info: "#2196f3",
  warn: "#f57c00",
  error: "#c62828",
  success: "#2e7d32",
};

export default function Topbar({ title, onMenuClick, notifications = [] }: TopbarProps) {
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Load theme on mount
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("theme") : null;
    const prefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved ? saved === "dark" : prefersDark;
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  }, []);

  // ⌘K / Ctrl+K shortcut + Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus input when modal opens
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 40);
  }, [searchOpen]);

  // Close notifications on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    if (notifOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [notifOpen]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  const submitSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearchOpen(false);
    setQuery("");
    router.push(`/videos?q=${encodeURIComponent(trimmed)}`);
  };

  const quickLinks = [
    { label: "Videos", path: "/videos", icon: "video_library" },
    { label: "Folders", path: "/folders", icon: "folder" },
    { label: "Analytics", path: "/analytics", icon: "analytics" },
    { label: "Settings", path: "/settings", icon: "settings" },
    { label: "API Keys", path: "/api-keys", icon: "key" },
    { label: "Webhooks", path: "/webhooks", icon: "webhook" },
  ];
  const filteredLinks = query
    ? quickLinks.filter((l) => l.label.toLowerCase().includes(query.toLowerCase()))
    : quickLinks;

  return (
    <>
      <header
        className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 px-4 sm:gap-4 sm:px-9 shadow-[0_1px_0_rgba(44,52,55,0.06)] backdrop-blur-[20px]"
        style={{ background: "rgb(var(--surface-rgb) / .88)" }}
      >
        <button onClick={onMenuClick} className="text-on-surface-var hover:text-on-surface lg:hidden">
          <span className="material-symbols-outlined text-[24px]">menu</span>
        </button>

        <div className="flex flex-col justify-center min-w-0">
          <h2 className="text-[16px] sm:text-[18px] font-extrabold leading-tight tracking-[-0.4px] text-on-surface truncate">{title}</h2>
          <div className="hidden sm:flex items-center gap-[5px] mt-0.5">
            <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Home</span>
            <span className="material-symbols-outlined text-[12px] text-on-surface-var">chevron_right</span>
            <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-primary">
              {title === "Dashboard" ? "Overview" : title}
            </span>
          </div>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button
            onClick={() => setSearchOpen(true)}
            className="topbar-search-btn"
            aria-label="Search"
            title="Search (⌘K)"
          >
            <span className="material-symbols-outlined text-[18px]">search</span>
            <span className="kbd-hint !hidden sm:!inline-flex">⌘K</span>
          </button>
          <button onClick={toggleTheme} className="icon-btn" aria-label="Toggle theme" title="Toggle theme">
            <span className="material-symbols-outlined text-[18px]">{isDark ? "light_mode" : "dark_mode"}</span>
          </button>
          <div className="relative" ref={notifRef}>
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="icon-btn"
              aria-label="Notifications"
              title="Notifications"
            >
              <span className="material-symbols-outlined text-[18px]">notifications</span>
              {notifications.length > 0 && (
                <span
                  className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full"
                  style={{ background: "#c62828" }}
                />
              )}
            </button>
            {notifOpen && (
              <div className="notif-popover">
                <div className="notif-header">
                  <span>Notifications</span>
                  <span className="text-[10.5px] font-medium text-on-surface-var">{notifications.length} new</span>
                </div>
                {notifications.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[12px] text-on-surface-var">
                    You&apos;re all caught up.
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div key={n.id} className="notif-item">
                      <span className="notif-dot" style={{ background: toneColor[n.tone] }} />
                      <div className="flex-1">
                        <div>{n.title}</div>
                        {n.time && <div className="mt-0.5 text-[10.5px] text-on-surface-var">{n.time}</div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {searchOpen && (
        <div className="cmdk-overlay" onClick={() => setSearchOpen(false)}>
          <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cmdk-input-row">
              <span className="material-symbols-outlined text-[18px] text-on-surface-var">search</span>
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSearch(query);
                }}
                className="cmdk-input"
                placeholder="Search videos, folders, settings..."
              />
              <button onClick={() => setSearchOpen(false)} className="cmdk-esc">Esc</button>
            </div>
            <div className="cmdk-results">
              {!query ? (
                <div className="py-6 text-center">Start typing to search...</div>
              ) : (
                <>
                  <div
                    className="cmdk-result-row"
                    onClick={() => submitSearch(query)}
                  >
                    <span className="material-symbols-outlined text-[16px]">search</span>
                    <span>Search videos for &ldquo;{query}&rdquo;</span>
                  </div>
                  {filteredLinks.map((l) => (
                    <div
                      key={l.path}
                      className="cmdk-result-row"
                      onClick={() => { setSearchOpen(false); setQuery(""); router.push(l.path); }}
                    >
                      <span className="material-symbols-outlined text-[16px]">{l.icon}</span>
                      <span>{l.label}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
