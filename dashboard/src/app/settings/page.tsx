"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StorageSettings {
  mode: "local" | "r2";
  localPath: string;
  diskUsage: string;
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
  r2PublicUrl: string;
}

interface CloudflareSettings {
  apiToken: string;
  zoneId: string;
}

interface DomainSettings {
  dashboardDomain: string;
  playerDomain: string;
  cdnDomain: string;
}

interface AccountInfo {
  email: string;
  username: string;
}

interface CdnDomainEntry {
  id?: number;
  domain: string;
  cf_api_token: string;
  cf_zone_id: string;
  cf_email?: string;
  cf_auth_type?: string;
  is_active: boolean;
}

interface AdEntry {
  id?: number;
  offset_type: "preroll" | "midroll" | "postroll";
  time_offset: string;
  skip_offset: number;
  vast_url: string;
}

interface AdsSettings {
  vast: {
    enabled: boolean;
    ad_type: string;
    ad_title: string;
    entries: AdEntry[];
  };
  popup: {
    enabled: boolean;
    popup_limit: number;
    popup_url: string;
  };
}

interface AllSettings {
  storage: StorageSettings;
  cloudflare: CloudflareSettings;
  domains: DomainSettings;
  account: AccountInfo;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

let toastId = 0;

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur ${
            t.type === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          <span>{t.type === "success" ? "\u2713" : "\u2717"}</span>
          <span className="flex-1">{t.message}</span>
          <button onClick={() => onDismiss(t.id)} className="text-xs opacity-60 hover:opacity-100">
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password field
// ---------------------------------------------------------------------------

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 pr-20 text-[13px] text-[#1e1e2f] placeholder-[#9ca3af] focus:ring-2 focus:ring-primary/15 focus:border-primary/30 focus:outline-none transition"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-[#6b7280] hover:text-[#1e1e2f] transition"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Text field
// ---------------------------------------------------------------------------

function TextField({
  label,
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      {label && <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">{label}</span>}
      <input
        type="text"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] placeholder-[#9ca3af] focus:ring-2 focus:ring-primary/15 focus:border-primary/30 focus:outline-none transition ${
          readOnly ? "cursor-not-allowed opacity-60" : ""
        }`}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

const TABS = ["Storage", "Player", "Encoding", "Domains", "Security", "Ads", "Account"] as const;
type Tab = (typeof TABS)[number];

interface EncodingConfig {
  preset_tier: string;
  bitrate_2160p: number;
  bitrate_1440p: number;
  bitrate_1080p: number;
  bitrate_720p: number;
  bitrate_480p: number;
  bitrate_360p: number;
  bitrate_240p: number;
  audio_bitrate: number;
  quality_concurrency: number;
  video_concurrency: number;
  ffmpeg_preset: string;
  clone_top_quality: boolean;
  default_qualities: string[];
  encrypt_new_videos: boolean;
  keyframe_seconds: number;
  segment_extension: string;
  rate_control: string;
  maxrate_ratio: number;
  bufsize_ratio: number;
  video_codec: string;
  audio_mode: string;
  ac3_bitrate: number;
  extra_ffmpeg_params: string;
}

interface EncodingValidValues {
  tiers: string[];
  audio: number[];
  videoConcurrency: number[];
  qualityConcurrency: number[];
  ffmpegPresets: string[];
  keyframeSeconds: number[];
  segmentExtensions: string[];
  rateControls: string[];
  videoCodecs: string[];
  audioModes: string[];
  ac3Bitrates: number[];
  allQualities: string[];
}

interface WorkerStatus {
  activeJobs: number;
  waitingJobs: number;
  delayedJobs: number;
  totalPending: number;
  workerStartedAt: string | null;
  restartRequestedAt: string | null;
  restartPending: boolean;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("Storage");
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Storage
  const [localPath, setLocalPath] = useState("");
  const [r2AccountId, setR2AccountId] = useState("");
  const [r2AccessKeyId, setR2AccessKeyId] = useState("");
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState("");
  const [r2BucketName, setR2BucketName] = useState("");
  const [r2PublicUrl, setR2PublicUrl] = useState("");
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageTesting, setStorageTesting] = useState(false);
  const [storageUsage, setStorageUsage] = useState<{ local: { count: number; totalSize: number }; r2: { count: number; totalSize: number } }>({ local: { count: 0, totalSize: 0 }, r2: { count: 0, totalSize: 0 } });

  // Domains
  const [dashboardDomain, setDashboardDomain] = useState("");
  const [playerDomain, setPlayerDomain] = useState("");
  const [cdnDomain, setCdnDomain] = useState("");
  const [domainsSaving, setDomainsSaving] = useState(false);

  // CDN Domains (multi-CDN)
  const [cdnDomains, setCdnDomains] = useState<CdnDomainEntry[]>([]);
  const [cdnDomainsLoading, setCdnDomainsLoading] = useState(false);

  // Account
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);

  // Security
  const [signedUrlsEnabled, setSignedUrlsEnabled] = useState(false);
  const [hotlinkProtectionEnabled, setHotlinkProtectionEnabled] = useState(false);
  const [hotlinkAllowedDomains, setHotlinkAllowedDomains] = useState("");
  const [ipBlockingEnabled, setIpBlockingEnabled] = useState(false);
  const [blockedIps, setBlockedIps] = useState("");
  const [securitySaving, setSecuritySaving] = useState(false);

  // Rate Limiting
  const [rateLimitEnabled, setRateLimitEnabled] = useState(true);
  const [rateLimitApi, setRateLimitApi] = useState(100);
  const [rateLimitAuth, setRateLimitAuth] = useState(10);
  const [rateLimitAuthWindow, setRateLimitAuthWindow] = useState(15);
  const [rateLimitPlayer, setRateLimitPlayer] = useState(60);
  const [rateLimitCdn, setRateLimitCdn] = useState(500);
  const [rateLimitUpload, setRateLimitUpload] = useState(5);

  // Ads - VAST
  const [vastEnabled, setVastEnabled] = useState(false);
  const [adType, setAdType] = useState("vast");
  const [adTitle, setAdTitle] = useState("");
  const [adEntries, setAdEntries] = useState<AdEntry[]>([]);

  // Ads - Popup
  const [popupEnabled, setPopupEnabled] = useState(false);
  const [popupLimit, setPopupLimit] = useState(0);
  const [popupUrl, setPopupUrl] = useState("");
  const [adsSaving, setAdsSaving] = useState(false);
  const [adsSubTab, setAdsSubTab] = useState<"vast" | "popup">("vast");

  // CDN Domain add form
  const [newCdnDomain, setNewCdnDomain] = useState("");
  const [newCdnToken, setNewCdnToken] = useState("");
  const [newCdnZoneId, setNewCdnZoneId] = useState("");
  const [newCdnEmail, setNewCdnEmail] = useState("");
  const [newCdnAuthType, setNewCdnAuthType] = useState<"token" | "global_key">("token");
  const [showCdnAddForm, setShowCdnAddForm] = useState(false);

  // Player / Embed
  const [playerColor, setPlayerColor] = useState("#00aaff");
  const [playerColorInput, setPlayerColorInput] = useState("#00aaff");
  const [embedAutoplay, setEmbedAutoplay] = useState(false);
  const [embedControls, setEmbedControls] = useState(true);
  const [embedLoop, setEmbedLoop] = useState(false);
  const [embedSaving, setEmbedSaving] = useState(false);

  // Encoding
  const [encodingConfig, setEncodingConfig] = useState<EncodingConfig | null>(null);
  const [encodingValid, setEncodingValid] = useState<EncodingValidValues | null>(null);
  const [encodingSaving, setEncodingSaving] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [workerRestarting, setWorkerRestarting] = useState(false);

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  const toast = useCallback((message: string, type: "success" | "error") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // -----------------------------------------------------------------------
  // Load settings
  // -----------------------------------------------------------------------

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await api.get<{ settings: Record<string, { value: string; is_encrypted: boolean }> }>("/settings");
        const s = data.settings;
        const val = (key: string) => s[key]?.value ?? "";

        // Storage
        setLocalPath(val("storage_local_path"));
        setR2AccountId(val("r2_account_id"));
        setR2AccessKeyId(val("r2_access_key_id"));
        setR2SecretAccessKey(val("r2_secret_access_key"));
        setR2BucketName(val("r2_bucket_name"));
        setR2PublicUrl(val("r2_public_url"));

        // Storage usage
        try {
          const usageData = await api.get<{ usage: { local: { count: number; totalSize: number }; r2: { count: number; totalSize: number } } }>("/settings/storage/usage");
          setStorageUsage(usageData.usage);
        } catch {
          // Storage usage not available yet
        }
        // Domains
        setDashboardDomain(val("domain_dashboard"));
        setPlayerDomain(val("domain_player"));
        setCdnDomain(val("domain_cdn"));
        // Security
        setSignedUrlsEnabled(val("signed_urls_enabled") === "true");
        setHotlinkProtectionEnabled(val("hotlink_protection_enabled") === "true");
        setHotlinkAllowedDomains(val("hotlink_allowed_domains"));
        setIpBlockingEnabled(val("ip_blocking_enabled") === "true");
        setBlockedIps(val("blocked_ips"));
        // Rate Limiting
        setRateLimitEnabled(val("rate_limit_enabled") !== "false");
        if (val("rate_limit_api")) setRateLimitApi(Number(val("rate_limit_api")) || 100);
        if (val("rate_limit_auth")) setRateLimitAuth(Number(val("rate_limit_auth")) || 10);
        if (val("rate_limit_auth_window")) setRateLimitAuthWindow(Number(val("rate_limit_auth_window")) || 15);
        if (val("rate_limit_player")) setRateLimitPlayer(Number(val("rate_limit_player")) || 60);
        if (val("rate_limit_cdn")) setRateLimitCdn(Number(val("rate_limit_cdn")) || 500);
        if (val("rate_limit_upload")) setRateLimitUpload(Number(val("rate_limit_upload")) || 5);

        // CDN Domains
        try {
          const cdnData = await api.get<{ cdn_domains: CdnDomainEntry[] }>("/settings/cdn-domains");
          setCdnDomains(cdnData.cdn_domains);
        } catch {
          // CDN domains not configured yet
        }

        // Ads
        try {
          const adsData = await api.get<AdsSettings>("/settings/ads");
          setVastEnabled(adsData.vast.enabled);
          setAdType(adsData.vast.ad_type);
          setAdTitle(adsData.vast.ad_title);
          setAdEntries(adsData.vast.entries);
          setPopupEnabled(adsData.popup.enabled);
          setPopupLimit(adsData.popup.popup_limit);
          setPopupUrl(adsData.popup.popup_url);
        } catch {
          // Ads not configured yet
        }

        // Embed / Player settings
        try {
          const embedData = await api.get<{ embed_settings: { player_color?: string; autoplay?: boolean; controls?: boolean; loop?: boolean } }>("/settings/embed");
          const es = embedData.embed_settings;
          if (es.player_color) { setPlayerColor(es.player_color); setPlayerColorInput(es.player_color); }
          if (es.autoplay !== undefined) setEmbedAutoplay(es.autoplay);
          if (es.controls !== undefined) setEmbedControls(es.controls);
          if (es.loop !== undefined) setEmbedLoop(es.loop);
        } catch {
          // Embed settings not configured yet
        }

        // Encoding
        try {
          const enc = await api.get<{ config: EncodingConfig; validValues: EncodingValidValues }>("/settings/encoding");
          setEncodingConfig(enc.config);
          setEncodingValid(enc.validValues);
        } catch {
          // Encoding config not yet available
        }

        // Worker status
        try {
          const ws = await api.get<WorkerStatus>("/settings/encoding/worker-status");
          setWorkerStatus(ws);
        } catch {
          // Worker may not be running
        }

        // Account
        const adminRes = await api.get<{ admin: { id: number; email: string } }>("/auth/me");
        setEmail(adminRes.admin?.email ?? "");
        setUsername(adminRes.admin?.email ?? "");

      } catch {
        toast("Failed to load settings", "error");
      } finally {
        setLoading(false);
      }
    };
    loadSettings();
  }, [toast]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const saveStorage = async () => {
    setStorageSaving(true);
    try {
      await api.put("/settings/storage", {
        r2_account_id: r2AccountId,
        r2_access_key_id: r2AccessKeyId,
        r2_secret_access_key: r2SecretAccessKey,
        r2_bucket_name: r2BucketName,
        r2_public_url: r2PublicUrl,
      });
      toast("Storage settings saved", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to save storage settings", "error");
    } finally {
      setStorageSaving(false);
    }
  };

  const saveEncoding = async () => {
    if (!encodingConfig) return;
    setEncodingSaving(true);
    try {
      await api.put("/settings/encoding", encodingConfig);
      toast("Encoding settings saved", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to save encoding settings", "error");
    } finally {
      setEncodingSaving(false);
    }
  };

  const refreshWorkerStatus = async () => {
    try {
      const ws = await api.get<WorkerStatus>("/settings/encoding/worker-status");
      setWorkerStatus(ws);
    } catch {
      // leave previous state on failure
    }
  };

  const restartWorker = async (force = false) => {
    setWorkerRestarting(true);
    try {
      await api.post("/settings/encoding/restart-worker", { force });
      toast("Worker restart requested", "success");
      await refreshWorkerStatus();
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      if (err.status === 409) {
        toast("Worker has active jobs. Click again to force drain.", "error");
      } else {
        toast(err.message ?? "Failed to restart worker", "error");
      }
    } finally {
      setWorkerRestarting(false);
    }
  };

  const updateEncoding = <K extends keyof EncodingConfig>(key: K, value: EncodingConfig[K]) => {
    setEncodingConfig((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const testStorageConnection = async () => {
    setStorageTesting(true);
    try {
      await api.post("/settings/storage/test", {
        r2_account_id: r2AccountId,
        r2_access_key_id: r2AccessKeyId,
        r2_secret_access_key: r2SecretAccessKey,
        r2_bucket_name: r2BucketName,
      });
      toast("R2 connection successful", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "R2 connection failed", "error");
    } finally {
      setStorageTesting(false);
    }
  };

  const saveDomains = async () => {
    setDomainsSaving(true);
    try {
      await api.put("/settings/domains", { domain_dashboard: dashboardDomain, domain_player: playerDomain, domain_cdn: cdnDomain });
      toast("Domain settings saved", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to save domain settings", "error");
    } finally {
      setDomainsSaving(false);
    }
  };

  const loadCdnDomains = async () => {
    try {
      const data = await api.get<{ cdn_domains: CdnDomainEntry[] }>("/settings/cdn-domains");
      setCdnDomains(data.cdn_domains);
    } catch {
      // ignore
    }
  };

  const addCdnDomain = async (entry: { domain: string; cf_api_token: string; cf_zone_id: string; cf_email?: string; cf_auth_type?: string }) => {
    setCdnDomainsLoading(true);
    try {
      await api.post("/settings/cdn-domains", entry);
      toast("CDN domain added", "success");
      await loadCdnDomains();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to add CDN domain", "error");
    } finally {
      setCdnDomainsLoading(false);
    }
  };

  const updateCdnDomain = async (id: number, updates: Partial<CdnDomainEntry>) => {
    setCdnDomainsLoading(true);
    try {
      await api.put(`/settings/cdn-domains/${id}`, updates);
      toast("CDN domain updated", "success");
      await loadCdnDomains();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to update CDN domain", "error");
    } finally {
      setCdnDomainsLoading(false);
    }
  };

  const removeCdnDomain = async (id: number) => {
    setCdnDomainsLoading(true);
    try {
      await api.delete(`/settings/cdn-domains/${id}`);
      toast("CDN domain removed", "success");
      await loadCdnDomains();
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to remove CDN domain", "error");
    } finally {
      setCdnDomainsLoading(false);
    }
  };

  const saveSecurity = async () => {
    setSecuritySaving(true);
    try {
      await api.put("/settings/security", {
        signed_urls_enabled: signedUrlsEnabled,
        hotlink_protection_enabled: hotlinkProtectionEnabled,
        hotlink_allowed_domains: hotlinkAllowedDomains,
        ip_blocking_enabled: ipBlockingEnabled,
        blocked_ips: blockedIps,
        rate_limit_enabled: rateLimitEnabled,
        rate_limit_api: rateLimitApi,
        rate_limit_auth: rateLimitAuth,
        rate_limit_auth_window: rateLimitAuthWindow,
        rate_limit_player: rateLimitPlayer,
        rate_limit_cdn: rateLimitCdn,
        rate_limit_upload: rateLimitUpload,
      });
      toast("Security settings saved", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to save security settings", "error");
    } finally {
      setSecuritySaving(false);
    }
  };

  const saveAds = async () => {
    setAdsSaving(true);
    try {
      await api.put("/settings/ads", {
        vast_enabled: vastEnabled,
        ad_type: adType,
        ad_title: adTitle,
        entries: adEntries,
        popup_enabled: popupEnabled,
        popup_limit: popupLimit,
        popup_url: popupUrl,
      });
      toast("Ad settings saved", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to save ad settings", "error");
    } finally {
      setAdsSaving(false);
    }
  };

  const resetAds = async () => {
    try {
      const adsData = await api.get<AdsSettings>("/settings/ads");
      setVastEnabled(adsData.vast.enabled);
      setAdType(adsData.vast.ad_type);
      setAdTitle(adsData.vast.ad_title);
      setAdEntries(adsData.vast.entries);
      setPopupEnabled(adsData.popup.enabled);
      setPopupLimit(adsData.popup.popup_limit);
      setPopupUrl(adsData.popup.popup_url);
      toast("Ad settings reset", "success");
    } catch {
      toast("Failed to reset ad settings", "error");
    }
  };

  const saveEmbed = async () => {
    if (!/^#[0-9a-fA-F]{6}$/.test(playerColor)) {
      toast("Invalid color format. Use hex like #00aaff", "error");
      return;
    }
    setEmbedSaving(true);
    try {
      await api.put("/settings/embed", {
        player_color: playerColor,
        autoplay: embedAutoplay,
        controls: embedControls,
        loop: embedLoop,
      });
      toast("Player settings saved", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to save player settings", "error");
    } finally {
      setEmbedSaving(false);
    }
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast("Passwords do not match", "error");
      return;
    }
    if (!currentPassword || !newPassword) {
      toast("Please fill in all password fields", "error");
      return;
    }
    setAccountSaving(true);
    try {
      await api.put("/auth/password", { current_password: currentPassword, new_password: newPassword });
      toast("Password changed successfully", "success");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to change password", "error");
    } finally {
      setAccountSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const btnPrimary =
    "inline-flex items-center justify-center rounded-btn bg-gradient-to-r from-primary to-primary-dim px-5 py-2.5 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50 disabled:cursor-not-allowed transition-all";
  const btnSecondary =
    "inline-flex items-center justify-center rounded-btn border border-on-surface/15 bg-surface-low px-5 py-2.5 text-sm font-medium text-on-surface-var hover:bg-on-surface/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  const sectionCard = "rounded-card bg-surface-card p-6 shadow-card";

  // -----------------------------------------------------------------------
  // Tab content
  // -----------------------------------------------------------------------

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  function renderStorage() {
    const localFmt = formatBytes(storageUsage.local.totalSize);
    const localParts = localFmt.split(" ");
    const r2SizeFmt = formatBytes(storageUsage.r2.totalSize);
    const r2Parts = r2SizeFmt.split(" ");

    return (
      <>
        {/* Storage Usage */}
        <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-8">
          <h3 className="mb-5 text-[15px] font-bold text-on-surface">Storage Usage</h3>

          <div className="grid grid-cols-2 gap-4 mb-7">
            {/* Local Server */}
            <div className="rounded-[14px] bg-[#eef1f8] px-6 py-5">
              <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Local Server</span>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[28px] font-extrabold leading-none tracking-[-1px] text-[#1e1e2f]">{localParts[0]}</span>
                <span className="text-[13px] font-semibold text-[#9ca3af]">{localParts[1] || "B"}</span>
              </div>
              <div className="mt-2 text-[13px] text-[#6b7280]">{storageUsage.local.count} video{storageUsage.local.count !== 1 ? "s" : ""}</div>
            </div>

            {/* Cloudflare R2 */}
            <div className="rounded-[14px] bg-[#fff5eb] px-6 py-5">
              <div className="flex items-center gap-2">
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-[#f38020]">
                  <span className="text-[10px] text-white font-bold">R</span>
                </div>
                <span className="text-[10px] font-extrabold uppercase tracking-[.12em] text-[#f38020]">Cloudflare R2</span>
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-[28px] font-extrabold leading-none tracking-[-1px] text-[#1e1e2f]">{r2Parts[0]}</span>
                <span className="text-[13px] font-semibold text-[#9ca3af]">{r2Parts[1] || "B"}</span>
              </div>
              <div className="mt-2 text-[13px] text-[#6b7280]">{storageUsage.r2.count} video{storageUsage.r2.count !== 1 ? "s" : ""}</div>
            </div>
          </div>

          {/* Local Storage Path */}
          <div>
            <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Local Storage Path</span>
            <div className="rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f]">{localPath || "/var/www/videos"}</div>
          </div>
        </div>

        {/* Cloudflare R2 Configuration */}
        <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] bg-[#f38020]">
              <span className="text-[12px] text-white font-bold">R</span>
            </div>
            <h3 className="text-[15px] font-bold text-[#1e1e2f]">Cloudflare R2 Configuration</h3>
          </div>

          <div className="flex flex-col gap-6">
            <TextField label="R2 Account ID" value={r2AccountId} onChange={setR2AccountId} placeholder="Account ID" />
            <PasswordField label="R2 Access Key ID" value={r2AccessKeyId} onChange={setR2AccessKeyId} placeholder="Access Key ID" />
            <PasswordField label="R2 Secret Access Key" value={r2SecretAccessKey} onChange={setR2SecretAccessKey} placeholder="Secret Access Key" />
            <TextField label="R2 Bucket Name" value={r2BucketName} onChange={setR2BucketName} placeholder="my-bucket" />
            <TextField label="R2 Public URL" value={r2PublicUrl} onChange={setR2PublicUrl} placeholder="https://pub.your.dev" />
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button onClick={testStorageConnection} disabled={storageTesting} className="rounded-[10px] border border-primary/25 bg-white px-5 py-2.5 text-[13px] font-semibold text-primary transition hover:bg-primary/5 disabled:opacity-50">
              {storageTesting ? "Testing..." : "Test Connection"}
            </button>
            <button onClick={saveStorage} disabled={storageSaving} className={btnPrimary}>
              {storageSaving ? "Saving..." : "Save Storage Settings"}
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderDomains() {
    const handleAdd = async () => {
      if (!newCdnDomain || !newCdnToken || !newCdnZoneId) {
        toast("Domain, Zone ID, and API key/token are required", "error");
        return;
      }
      if (newCdnAuthType === "global_key" && !newCdnEmail) {
        toast("Cloudflare email is required for Global API Key", "error");
        return;
      }
      await addCdnDomain({
        domain: newCdnDomain,
        cf_api_token: newCdnToken,
        cf_zone_id: newCdnZoneId,
        cf_email: newCdnAuthType === "global_key" ? newCdnEmail : undefined,
        cf_auth_type: newCdnAuthType,
      });
      setNewCdnDomain("");
      setNewCdnToken("");
      setNewCdnZoneId("");
      setNewCdnEmail("");
      setNewCdnAuthType("token");
      setShowCdnAddForm(false);
    };

    return (
      <>
        {/* Domain Settings */}
        <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-8">
          <h3 className="mb-6 text-[15px] font-bold text-[#1e1e2f]">Domain Settings</h3>
          <div className="flex flex-col gap-5">
            <TextField label="Dashboard Domain" value={dashboardDomain} onChange={setDashboardDomain} placeholder="dash.example.com" />
            <TextField label="Player Domain" value={playerDomain} onChange={setPlayerDomain} placeholder="play.example.com" />
          </div>
          <div className="mt-6 flex justify-end">
            <button onClick={saveDomains} disabled={domainsSaving} className={btnPrimary}>
              {domainsSaving ? "Saving..." : "Save Domain Settings"}
            </button>
          </div>
        </div>

        {/* CDN Domains */}
        <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-bold text-[#1e1e2f]">CDN Domains</h3>
              <p className="mt-1 text-[13px] text-[#9ca3af]">
                Add up to 5 CDN domains for load balanced video delivery. Each play request randomly picks one active domain.
              </p>
            </div>
            <span className="rounded-full border border-[#e5e7eb] bg-white px-3 py-1 text-[11px] font-extrabold uppercase tracking-[.08em] text-[#6b7280]">
              {cdnDomains.filter(d => d.is_active).length} active
            </span>
          </div>

          {/* Existing CDN domains list */}
          {cdnDomains.length > 0 && (
            <div className="mb-5 flex flex-col gap-3">
              {cdnDomains.map((entry) => (
                <div key={entry.id} className={`flex items-center justify-between rounded-[12px] border p-4 ${entry.is_active ? "border-success/20 bg-success/5" : "border-[#e5e7eb] bg-[#f9fafb]"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-semibold text-[#1e1e2f]">{entry.domain}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${entry.is_active ? "bg-success/15 text-success" : "bg-[#f0f0f5] text-[#9ca3af]"}`}>
                        {entry.is_active ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-4 text-[11px] text-[#9ca3af]">
                      <span>Zone: {entry.cf_zone_id}</span>
                      {entry.cf_auth_type === "global_key" && <span>Email: {entry.cf_email || "****"}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Toggle enabled={entry.is_active} onChange={() => entry.id && updateCdnDomain(entry.id, { is_active: !entry.is_active })} />
                    <button onClick={() => entry.id && removeCdnDomain(entry.id)} disabled={cdnDomainsLoading} className="text-[12px] font-semibold text-error hover:text-error/70 transition">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {cdnDomains.length === 0 && !showCdnAddForm && (
            <div className="mb-5 rounded-[12px] border border-dashed border-[#d1d5db] p-8 text-center text-[13px] text-[#9ca3af]">
              No CDN domains configured. Add one to enable multi-CDN load balancing.
            </div>
          )}

          {/* Add CDN Domain form */}
          {showCdnAddForm && (
            <div className="mb-5 rounded-[14px] border border-[#e5e7eb] bg-[#f9fafb] p-6">
              <h4 className="mb-5 text-[14px] font-bold text-[#1e1e2f]">Add CDN Domain</h4>
              <div className="flex flex-col gap-5">
                <TextField label="Domain" value={newCdnDomain} onChange={setNewCdnDomain} placeholder="cdn1.example.com" />
                <TextField label="Cloudflare Zone ID" value={newCdnZoneId} onChange={setNewCdnZoneId} placeholder="Zone ID from Cloudflare" />
                <div>
                  <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Auth Type</span>
                  <select
                    value={newCdnAuthType}
                    onChange={(e) => setNewCdnAuthType(e.target.value as "token" | "global_key")}
                    className="w-full rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-3 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none appearance-none"
                  >
                    <option value="token">API Token (Recommended)</option>
                    <option value="global_key">Global API Key</option>
                  </select>
                </div>
                {newCdnAuthType === "global_key" && (
                  <TextField label="Cloudflare Email" value={newCdnEmail} onChange={setNewCdnEmail} placeholder="your@email.com" />
                )}
                <PasswordField
                  label={newCdnAuthType === "global_key" ? "Global API Key" : "Cloudflare API Token"}
                  value={newCdnToken}
                  onChange={setNewCdnToken}
                  placeholder={newCdnAuthType === "global_key" ? "Enter your Global API Key" : "CF API token for this domain"}
                />
                <div className="flex justify-end gap-4">
                  <button onClick={() => { setShowCdnAddForm(false); setNewCdnDomain(""); setNewCdnToken(""); setNewCdnZoneId(""); setNewCdnEmail(""); setNewCdnAuthType("token"); }} className="text-[13px] font-semibold text-[#6b7280] hover:text-[#1e1e2f] transition">
                    Cancel
                  </button>
                  <button onClick={handleAdd} disabled={cdnDomainsLoading} className={btnPrimary}>
                    {cdnDomainsLoading ? "Adding..." : "Add Domain"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {!showCdnAddForm && cdnDomains.length < 5 && (
            <button
              onClick={() => setShowCdnAddForm(true)}
              className="w-full rounded-[10px] border-2 border-dashed border-[#d1d5db] py-3 text-[13px] font-medium text-[#9ca3af] hover:border-primary hover:text-primary transition-colors"
            >
              Add CDN Domain +
            </button>
          )}

          {cdnDomains.length >= 5 && !showCdnAddForm && (
            <div className="text-[12px] text-[#9ca3af] text-center">Maximum 5 CDN domains reached.</div>
          )}
        </div>

        {/* Legacy fallback */}
        <div className="mb-6">
          <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">
            Legacy CDN Domain (fallback) — used only when no CDN domains are configured above
          </span>
          <TextField label="" value={cdnDomain} onChange={setCdnDomain} placeholder="cdn.example.com" />
          <div className="mt-4 flex justify-end">
            <button onClick={saveDomains} disabled={domainsSaving} className="rounded-[10px] border border-[#e5e7eb] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#6b7280] hover:text-[#1e1e2f] hover:border-[#d1d5db] transition">
              {domainsSaving ? "Saving..." : "Save Fallback"}
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderSecurity() {
    const securityItems = [
      { label: "Signed URLs", desc: "Require JWT tokens to access video files. Tokens are generated when the player loads and expire after 8 hours.", enabled: signedUrlsEnabled, toggle: () => setSignedUrlsEnabled(!signedUrlsEnabled) },
      { label: "Hotlink Protection", desc: "Block video requests from unauthorized domains by checking the Referer header.", enabled: hotlinkProtectionEnabled, toggle: () => setHotlinkProtectionEnabled(!hotlinkProtectionEnabled) },
      { label: "IP Blocking", desc: "Block specific IP addresses from accessing any part of your platform.", enabled: ipBlockingEnabled, toggle: () => setIpBlockingEnabled(!ipBlockingEnabled) },
    ];

    const rateLimitFields = [
      { label: "API (req/min)", value: rateLimitApi, set: setRateLimitApi },
      { label: "Auth (req/window)", value: rateLimitAuth, set: setRateLimitAuth },
      { label: "Auth Window (minutes)", value: rateLimitAuthWindow, set: setRateLimitAuthWindow },
      { label: "Player (req/min)", value: rateLimitPlayer, set: setRateLimitPlayer },
      { label: "CDN/HLS (req/min)", value: rateLimitCdn, set: setRateLimitCdn },
      { label: "Upload (req/min)", value: rateLimitUpload, set: setRateLimitUpload },
    ];

    return (
      <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="mb-2 text-[15px] font-bold text-[#1e1e2f]">Security Settings</h3>

        <div className="flex flex-col">
          {securityItems.map((item) => (
            <div key={item.label} className="flex items-center justify-between py-5 border-b border-[#f0f0f5]">
              <div className="pr-8">
                <span className="text-[14px] font-semibold text-[#1e1e2f]">{item.label}</span>
                <p className="mt-1 text-[13px] text-[#9ca3af]">{item.desc}</p>
              </div>
              <Toggle enabled={item.enabled} onChange={item.toggle} />
            </div>
          ))}

          {/* Rate Limiting */}
          <div className="py-5">
            <div className="flex items-center justify-between">
              <div className="pr-8">
                <span className="text-[14px] font-semibold text-[#1e1e2f]">Rate Limiting</span>
                <p className="mt-1 text-[13px] text-[#9ca3af]">Limit requests per IP to protect against abuse. Disable to allow unlimited requests.</p>
              </div>
              <Toggle enabled={rateLimitEnabled} onChange={() => setRateLimitEnabled(!rateLimitEnabled)} />
            </div>

            {rateLimitEnabled && (
              <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5">
                {rateLimitFields.map((f) => (
                  <label key={f.label} className="block">
                    <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">{f.label}</span>
                    <input
                      type="number"
                      min={1}
                      value={f.value}
                      onChange={(e) => f.set(Number(e.target.value) || 1)}
                      className="w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <button onClick={saveSecurity} disabled={securitySaving} className={btnPrimary}>
            {securitySaving ? "Saving..." : "Save Security Settings"}
          </button>
        </div>
      </div>
    );
  }

  function renderAccount() {
    return (
      <>
        {/* Account Settings */}
        <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-8">
          <h3 className="mb-6 text-[15px] font-bold text-[#1e1e2f]">Account Settings</h3>
          <div className="flex flex-col gap-5">
            <TextField label="Email" value={email} readOnly />
            <TextField label="Username" value={username} readOnly />
          </div>
        </div>

        {/* Change Password */}
        <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h3 className="mb-6 text-[15px] font-bold text-[#1e1e2f]">Change Password</h3>
          <div className="flex flex-col gap-5">
            <PasswordField label="Current Password" value={currentPassword} onChange={setCurrentPassword} placeholder="Enter current password" />
            <PasswordField label="New Password" value={newPassword} onChange={setNewPassword} placeholder="Enter new password" />
            <PasswordField label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Confirm new password" />
          </div>

          <div className="mt-8 flex justify-end">
            <button onClick={changePassword} disabled={accountSaving} className={btnPrimary}>
              {accountSaving ? "Saving..." : "Save Account Settings"}
            </button>
          </div>
        </div>
      </>
    );
  }

  // Responsive embed state
  const [responsiveEmbed, setResponsiveEmbed] = useState(true);

  function renderPlayer() {
    const playerItems = [
      { label: "Autoplay", desc: "Auto-start video on page load", enabled: embedAutoplay, toggle: () => setEmbedAutoplay(!embedAutoplay) },
      { label: "Loop", desc: "Repeat video when finished", enabled: embedLoop, toggle: () => setEmbedLoop(!embedLoop) },
      { label: "Show Controls", desc: "Display player control bar", enabled: embedControls, toggle: () => setEmbedControls(!embedControls) },
      { label: "Responsive Embed", desc: "Auto-resize to container width", enabled: responsiveEmbed, toggle: () => setResponsiveEmbed(!responsiveEmbed) },
    ];

    const presetColors = ["#00aaff", "#ff5733", "#28a745", "#6f42c1", "#fd7e14", "#e83e8c", "#20c997", "#343a40"];

    return (
      <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h3 className="mb-2 text-[15px] font-bold text-[#1e1e2f]">Player Configuration</h3>

        <div className="flex flex-col">
          {playerItems.map((item, i) => (
            <div key={item.label} className={`flex items-center justify-between py-5 ${i < playerItems.length - 1 ? "border-b border-[#f0f0f5]" : ""}`}>
              <div>
                <span className="text-[14px] font-semibold text-[#1e1e2f]">{item.label}</span>
                <p className="mt-1 text-[12px] text-[#9ca3af]">{item.desc}</p>
              </div>
              <Toggle enabled={item.enabled} onChange={item.toggle} />
            </div>
          ))}
        </div>

        {/* Player Color */}
        <div className="mt-6 border-t border-[#f0f0f5] pt-6">
          <h4 className="mb-1 text-[14px] font-semibold text-[#1e1e2f]">Player Accent Color</h4>
          <p className="mb-4 text-[12px] text-[#9ca3af]">Choose the accent color for the video player controls</p>

          <div className="flex items-center gap-4">
            {/* Color preview + input */}
            <div className="flex items-center gap-3">
              <div
                className="h-[38px] w-[38px] rounded-[10px] border border-[#e5e7eb] shadow-sm cursor-pointer"
                style={{ backgroundColor: playerColor }}
                onClick={() => {
                  const input = document.getElementById("player-color-picker");
                  if (input) input.click();
                }}
              />
              <input
                id="player-color-picker"
                type="color"
                value={playerColor}
                onChange={(e) => { setPlayerColor(e.target.value); setPlayerColorInput(e.target.value); }}
                className="sr-only"
              />
              <input
                type="text"
                value={playerColorInput}
                onChange={(e) => {
                  setPlayerColorInput(e.target.value);
                  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setPlayerColor(e.target.value);
                }}
                placeholder="#00aaff"
                className="w-[100px] rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-2 text-[13px] font-mono text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none"
              />
            </div>

            {/* Preset swatches */}
            <div className="flex items-center gap-2">
              {presetColors.map((c) => (
                <button
                  key={c}
                  onClick={() => { setPlayerColor(c); setPlayerColorInput(c); }}
                  className={`h-[24px] w-[24px] rounded-full border-2 transition-all ${
                    playerColor === c ? "border-[#1e1e2f] scale-110" : "border-transparent hover:scale-110"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <button onClick={saveEmbed} disabled={embedSaving} className={btnPrimary}>
            {embedSaving ? "Saving..." : "Save Player Settings"}
          </button>
        </div>
      </div>
    );
  }

  function renderEncoding() {
    if (!encodingConfig || !encodingValid) {
      return (
        <div className={`${sectionCard} text-center text-[13px] text-on-surface-var py-10`}>
          Loading encoding configuration...
        </div>
      );
    }

    const cfg = encodingConfig;
    const vv = encodingValid;

    const labelClass = "mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]";
    const selectClass = "w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:border-primary/30 focus:outline-none transition";
    const numberClass = selectClass;

    const qualityKeys: (keyof EncodingConfig)[] = [
      "bitrate_2160p", "bitrate_1440p", "bitrate_1080p", "bitrate_720p", "bitrate_480p", "bitrate_360p", "bitrate_240p",
    ];

    const toggleDefaultQuality = (q: string) => {
      const current = new Set(cfg.default_qualities || []);
      if (current.has(q)) current.delete(q); else current.add(q);
      updateEncoding("default_qualities", Array.from(current));
    };

    const statusColor = workerStatus?.restartPending ? "#ef6c00" : workerStatus?.activeJobs ? "#2196f3" : "#2e7d32";
    const statusLabel = workerStatus?.restartPending
      ? "Restart pending"
      : workerStatus?.activeJobs
      ? "Processing"
      : "Idle";

    return (
      <>
        {/* Worker Status */}
        <div className={`${sectionCard} mb-8`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[15px] font-bold text-on-surface">Encoding Worker</h3>
              <p className="mt-1 text-[12px] text-on-surface-var">
                Status:{" "}
                <span className="font-bold" style={{ color: statusColor }}>{statusLabel}</span>
                {" \u00b7 "}
                {workerStatus ? `${workerStatus.activeJobs} active \u00b7 ${workerStatus.waitingJobs} waiting \u00b7 ${workerStatus.delayedJobs} delayed` : "status unavailable"}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={refreshWorkerStatus} className={btnSecondary}>Refresh</button>
              <button onClick={() => restartWorker(false)} disabled={workerRestarting} className={btnPrimary}>
                {workerRestarting ? "Restarting..." : "Restart Worker"}
              </button>
            </div>
          </div>
          {workerStatus?.activeJobs ? (
            <div className="mt-4 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[12px] text-[#92400e]">
              {workerStatus.activeJobs} job(s) active. Click Restart to drain gracefully, or{" "}
              <button onClick={() => restartWorker(true)} className="font-bold underline">force restart</button>{" "}
              to cancel them.
            </div>
          ) : null}
        </div>

        {/* Preset Tier */}
        <div className={`${sectionCard} mb-8`}>
          <h3 className="mb-5 text-[15px] font-bold text-on-surface">Preset Tier</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {vv.tiers.map((tier) => (
              <button
                key={tier}
                onClick={() => updateEncoding("preset_tier", tier)}
                className={`rounded-[12px] border px-4 py-4 text-left transition-all ${
                  cfg.preset_tier === tier
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-[#e5e7eb] bg-white hover:border-primary/40"
                }`}
              >
                <div className="text-[13px] font-bold capitalize text-on-surface">{tier}</div>
                <div className="mt-1 text-[11px] text-on-surface-var">
                  {tier === "optimized" ? "Smaller files, lower bitrate" : tier === "balanced" ? "Recommended default" : tier === "premium" ? "Higher quality, larger files" : "Custom per-quality bitrates"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Per-Quality Bitrates */}
        <div className={`${sectionCard} mb-8`}>
          <h3 className="mb-1 text-[15px] font-bold text-on-surface">Bitrates (kbps)</h3>
          <p className="mb-5 text-[12px] text-on-surface-var">Target video bitrate for each output quality.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {qualityKeys.map((k) => {
              const label = String(k).replace("bitrate_", "").toUpperCase();
              return (
                <label key={k} className="block">
                  <span className={labelClass}>{label}</span>
                  <input
                    type="number"
                    value={cfg[k] as number}
                    onChange={(e) => updateEncoding(k, Number(e.target.value) as never)}
                    className={numberClass}
                  />
                </label>
              );
            })}
            <label className="block">
              <span className={labelClass}>Audio bitrate</span>
              <select value={cfg.audio_bitrate} onChange={(e) => updateEncoding("audio_bitrate", Number(e.target.value))} className={selectClass}>
                {vv.audio.map((b) => <option key={b} value={b}>{b} kbps</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Default Qualities */}
        <div className={`${sectionCard} mb-8`}>
          <h3 className="mb-1 text-[15px] font-bold text-on-surface">Default Output Qualities</h3>
          <p className="mb-5 text-[12px] text-on-surface-var">Which quality renditions to produce for new videos.</p>
          <div className="flex flex-wrap gap-2">
            {vv.allQualities.map((q) => {
              const active = (cfg.default_qualities || []).includes(q);
              return (
                <button
                  key={q}
                  onClick={() => toggleDefaultQuality(q)}
                  className={`rounded-full border px-4 py-2 text-[12px] font-semibold transition ${
                    active ? "border-primary bg-primary text-white" : "border-[#e5e7eb] bg-white text-on-surface-var hover:border-primary/40"
                  }`}
                >
                  {q}
                </button>
              );
            })}
          </div>
        </div>

        {/* Encoder Settings */}
        <div className={`${sectionCard} mb-8`}>
          <h3 className="mb-5 text-[15px] font-bold text-on-surface">Encoder</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <label className="block">
              <span className={labelClass}>Video codec</span>
              <select value={cfg.video_codec} onChange={(e) => updateEncoding("video_codec", e.target.value)} className={selectClass}>
                {vv.videoCodecs.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>FFmpeg preset</span>
              <select value={cfg.ffmpeg_preset} onChange={(e) => updateEncoding("ffmpeg_preset", e.target.value)} className={selectClass}>
                {vv.ffmpegPresets.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Rate control</span>
              <select value={cfg.rate_control} onChange={(e) => updateEncoding("rate_control", e.target.value)} className={selectClass}>
                {vv.rateControls.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Keyframe interval (sec)</span>
              <select value={cfg.keyframe_seconds} onChange={(e) => updateEncoding("keyframe_seconds", Number(e.target.value))} className={selectClass}>
                {vv.keyframeSeconds.map((k) => <option key={k} value={k}>{k}s</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Segment extension</span>
              <select value={cfg.segment_extension} onChange={(e) => updateEncoding("segment_extension", e.target.value)} className={selectClass}>
                {vv.segmentExtensions.map((s) => <option key={s} value={s}>.{s}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Audio mode</span>
              <select value={cfg.audio_mode} onChange={(e) => updateEncoding("audio_mode", e.target.value)} className={selectClass}>
                {vv.audioModes.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>AC3 bitrate</span>
              <select value={cfg.ac3_bitrate} onChange={(e) => updateEncoding("ac3_bitrate", Number(e.target.value))} className={selectClass}>
                {vv.ac3Bitrates.map((b) => <option key={b} value={b}>{b} kbps</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Maxrate ratio</span>
              <input type="number" step="0.1" value={cfg.maxrate_ratio} onChange={(e) => updateEncoding("maxrate_ratio", Number(e.target.value))} className={numberClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Bufsize ratio</span>
              <input type="number" step="0.1" value={cfg.bufsize_ratio} onChange={(e) => updateEncoding("bufsize_ratio", Number(e.target.value))} className={numberClass} />
            </label>
          </div>
        </div>

        {/* Concurrency */}
        <div className={`${sectionCard} mb-8`}>
          <h3 className="mb-5 text-[15px] font-bold text-on-surface">Concurrency</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <label className="block">
              <span className={labelClass}>Video concurrency</span>
              <select value={cfg.video_concurrency} onChange={(e) => updateEncoding("video_concurrency", Number(e.target.value))} className={selectClass}>
                {vv.videoConcurrency.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Quality concurrency</span>
              <select value={cfg.quality_concurrency} onChange={(e) => updateEncoding("quality_concurrency", Number(e.target.value))} className={selectClass}>
                {vv.qualityConcurrency.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Advanced toggles */}
        <div className={`${sectionCard} mb-8`}>
          <h3 className="mb-5 text-[15px] font-bold text-on-surface">Advanced</h3>
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold text-on-surface">Clone top quality</div>
                <div className="text-[12px] text-on-surface-var">If source is below top target, copy it as-is instead of upscaling.</div>
              </div>
              <Toggle enabled={cfg.clone_top_quality} onChange={() => updateEncoding("clone_top_quality", !cfg.clone_top_quality)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold text-on-surface">Encrypt new videos</div>
                <div className="text-[12px] text-on-surface-var">Apply AES-128 HLS encryption to new uploads.</div>
              </div>
              <Toggle enabled={cfg.encrypt_new_videos} onChange={() => updateEncoding("encrypt_new_videos", !cfg.encrypt_new_videos)} />
            </div>
            <label className="block">
              <span className={labelClass}>Extra FFmpeg params</span>
              <input
                type="text"
                value={cfg.extra_ffmpeg_params || ""}
                onChange={(e) => updateEncoding("extra_ffmpeg_params", e.target.value)}
                placeholder="-movflags +faststart"
                className={numberClass}
              />
              <span className="mt-1.5 block text-[11px] text-on-surface-var">Appended to every ffmpeg command. Leave blank unless you know what you&apos;re doing.</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={saveEncoding} disabled={encodingSaving} className={btnPrimary}>
            {encodingSaving ? "Saving..." : "Save Encoding Settings"}
          </button>
        </div>
      </>
    );
  }

  function renderAds() {
    const addAdEntry = () => {
      setAdEntries((prev) => [...prev, { offset_type: "midroll", time_offset: "0", skip_offset: 0, vast_url: "" }]);
    };

    const removeAdEntry = (index: number) => {
      setAdEntries((prev) => prev.filter((_, i) => i !== index));
    };

    const updateAdEntry = (index: number, field: keyof AdEntry, value: string | number) => {
      setAdEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
    };

    return (
      <>
        {/* Sub-tabs */}
        <div className="mb-6 flex gap-2">
          {([
            { key: "vast" as const, label: "VAST / VPAID" },
            { key: "popup" as const, label: "Pop-Up\nAdvertisement" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setAdsSubTab(tab.key)}
              className={`rounded-[10px] px-5 py-2.5 text-[13px] font-medium transition-all whitespace-pre-line text-center leading-tight ${
                adsSubTab === tab.key
                  ? "bg-white text-[#1e1e2f] font-semibold border border-[#e5e7eb] shadow-[0_1px_3px_rgba(0,0,0,0.06)]"
                  : "text-[#9ca3af] hover:text-[#6b7280]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="rounded-[16px] bg-white p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          {/* VAST / VPAID */}
          {adsSubTab === "vast" && (
            <div>
              <div className="flex items-center justify-between py-5">
                <div>
                  <span className="text-[14px] font-semibold text-[#1e1e2f]">Enable Ads</span>
                  <p className="mt-1 text-[13px] text-[#9ca3af]">Enable VAST/VPAID video advertisements on your player.</p>
                </div>
                <Toggle enabled={vastEnabled} onChange={() => setVastEnabled(!vastEnabled)} />
              </div>

              {vastEnabled && (
                <div className="mt-4 flex flex-col gap-6">
                  <div>
                    <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Ad Type</span>
                    <select value={adType} onChange={(e) => setAdType(e.target.value)} className="w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none appearance-none">
                      <option value="vast">VAST 1</option>
                      <option value="vast2">VAST 2</option>
                      <option value="vast3">VAST 3</option>
                      <option value="vpaid">VPAID</option>
                    </select>
                  </div>

                  <TextField label="Ad Title" value={adTitle} onChange={setAdTitle} placeholder="AD" />

                  {/* Ad List */}
                  <div>
                    <h4 className="mb-4 text-[14px] font-semibold text-[#1e1e2f]">Ad List</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-[#e5e7eb]">
                            <th className="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280] w-12">#</th>
                            <th className="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Offset</th>
                            <th className="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Time</th>
                            <th className="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Skip Offset</th>
                            <th className="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">URL</th>
                            <th className="px-4 py-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Operation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adEntries.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-8 text-center text-[13px] text-[#9ca3af]">No ads configured yet.</td></tr>
                          )}
                          {adEntries.map((entry, idx) => (
                            <tr key={idx} className="border-t border-[#f0f0f5]">
                              <td className="px-4 py-3 text-[12px] text-[#9ca3af]">{idx + 1}</td>
                              <td className="px-4 py-3">
                                <select value={entry.offset_type} onChange={(e) => updateAdEntry(idx, "offset_type", e.target.value)} className="rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] text-[#1e1e2f] focus:outline-none">
                                  <option value="preroll">preroll</option>
                                  <option value="midroll">midroll</option>
                                  <option value="postroll">postroll</option>
                                </select>
                              </td>
                              <td className="px-4 py-3">
                                <input type="text" value={entry.time_offset} onChange={(e) => updateAdEntry(idx, "time_offset", e.target.value)} placeholder="00:00:00.000" disabled={entry.offset_type !== "midroll"} className="w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] text-[#1e1e2f] focus:outline-none disabled:bg-[#f5f5f8] disabled:text-[#9ca3af]" />
                              </td>
                              <td className="px-4 py-3">
                                <input type="number" min={0} value={entry.skip_offset} onChange={(e) => updateAdEntry(idx, "skip_offset", Number(e.target.value) || 0)} className="w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] text-[#1e1e2f] focus:outline-none" />
                              </td>
                              <td className="px-4 py-3">
                                <input type="text" value={entry.vast_url} onChange={(e) => updateAdEntry(idx, "vast_url", e.target.value)} placeholder="https://example.com/vast.xml" className="w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-1.5 text-[12px] text-[#1e1e2f] focus:outline-none" />
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => removeAdEntry(idx)} className="text-[12px] font-semibold text-error hover:text-error/70 transition">Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-3 text-[12px] text-[#9ca3af]">Only XML format is supported.</p>

                    <button onClick={addAdEntry} className="mt-3 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2 text-[13px] font-medium text-[#1e1e2f] hover:border-[#d1d5db] transition">
                      + New
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-8 flex justify-end gap-3">
                <button onClick={resetAds} className="rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-2.5 text-[13px] font-semibold text-[#6b7280] transition hover:bg-[#f9fafb]">Reset</button>
                <button onClick={saveAds} disabled={adsSaving} className={btnPrimary}>{adsSaving ? "Saving..." : "Save"}</button>
              </div>
            </div>
          )}

          {/* Pop-Up */}
          {adsSubTab === "popup" && (
            <div>
              <div className="flex items-center justify-between py-5">
                <div>
                  <span className="text-[14px] font-semibold text-[#1e1e2f]">Enable Pop-Up</span>
                  <p className="mt-1 text-[13px] text-[#9ca3af]">Enable pop-up advertisements on video play.</p>
                </div>
                <Toggle enabled={popupEnabled} onChange={() => setPopupEnabled(!popupEnabled)} />
              </div>

              {popupEnabled && (
                <div className="mt-4 flex flex-col gap-6">
                  <label className="block">
                    <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Pop-Up Limit</span>
                    <input type="number" min={0} value={popupLimit} onChange={(e) => setPopupLimit(Number(e.target.value) || 0)} className="w-[140px] rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none" />
                    <span className="mt-2 block text-[12px] text-[#9ca3af]">
                      0 is always on, if it is 1 or higher, it becomes the daily limit.
                    </span>
                  </label>
                  <TextField label="Popup URL" value={popupUrl} onChange={setPopupUrl} placeholder="//example.com/api/v1/dhtml/..." />
                </div>
              )}

              <div className="mt-8 flex justify-end gap-3">
                <button onClick={resetAds} className="rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-2.5 text-[13px] font-semibold text-[#6b7280] transition hover:bg-[#f9fafb]">Reset</button>
                <button onClick={saveAds} disabled={adsSaving} className={btnPrimary}>{adsSaving ? "Saving..." : "Save"}</button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  }

  // -----------------------------------------------------------------------
  // Toggle component
  // -----------------------------------------------------------------------
  function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
    return (
      <button
        onClick={onChange}
        className={`relative inline-flex h-[26px] w-[48px] shrink-0 cursor-pointer rounded-full border transition-colors duration-200 ${
          enabled ? "bg-primary border-primary" : "bg-[#d1d5db] border-[#d1d5db]"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-all duration-200 ${
            enabled ? "left-[24px]" : "left-[3px]"
          }`}
        />
      </button>
    );
  }

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  return (
    <DashboardLayout>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Page breadcrumb header */}
      <div className="mb-2">
        <h1 className="text-[22px] font-extrabold text-on-surface">Settings</h1>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">
          <span>Home</span>
          <span className="text-on-surface-var/40">&gt;</span>
          <span className="text-primary">Configuration</span>
        </div>
      </div>

      <div className="border-b border-primary/20 mb-6" />

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : (
        <>
          {/* Settings sub-header */}
          <div className="mb-4">
            <h2 className="text-[16px] font-bold text-on-surface">Settings</h2>
            <p className="mt-0.5 text-[13px] text-on-surface-var">Manage your archive configuration</p>
          </div>

          {/* Tabs */}
          <div className="mb-8 flex rounded-[10px] border border-on-surface/10 bg-white overflow-hidden">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-3 text-center text-[13px] font-medium transition-all ${
                  activeTab === tab
                    ? "bg-white text-on-surface font-bold border border-on-surface/15 rounded-[10px] -m-px shadow-sm z-10"
                    : "text-on-surface-var hover:text-on-surface"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === "Storage" && renderStorage()}
          {activeTab === "Player" && renderPlayer()}
          {activeTab === "Encoding" && renderEncoding()}
          {activeTab === "Domains" && renderDomains()}
          {activeTab === "Security" && renderSecurity()}
          {activeTab === "Ads" && renderAds()}
          {activeTab === "Account" && renderAccount()}
        </>
      )}
    </DashboardLayout>
  );
}
