"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import TeamPanel from "@/components/TeamPanel";
import TwoFactorCard from "@/components/TwoFactorCard";

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

const TABS = ["Storage", "Encoding", "Player", "Domains", "Ads", "Email", "Security", "Team", "Account"] as const;
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

interface BitrateRange { min: number; max: number; default: number }
interface RatioRange { min: number; max: number; default: number }
interface TierPreset {
  bitrate_2160p: number; bitrate_1440p: number; bitrate_1080p: number;
  bitrate_720p: number;  bitrate_480p: number;  bitrate_360p: number;  bitrate_240p: number;
  audio_bitrate: number;
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
  maxrateRatioRange?: RatioRange;
  bufsizeRatioRange?: RatioRange;
}

interface EncodingConfigResponse {
  config: EncodingConfig;
  validValues: EncodingValidValues;
  ranges?: Record<string, BitrateRange>;          // keyed by "2160p" / "1440p" / ...
  tierPresets?: Record<string, TierPreset>;       // keyed by "premium" / "balanced" / "optimized"
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
  const searchParams = useSearchParams();
  const initialTab = (() => {
    const raw = searchParams?.get("tab");
    if (raw && (TABS as readonly string[]).includes(raw)) return raw as Tab;
    return "Storage" as Tab;
  })();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [settingsQuery, setSettingsQuery] = useState("");

  // Keyword map — lets the search box filter the tab strip by content, not just label.
  const TAB_KEYWORDS: Record<Tab, string> = {
    Storage: "storage local path r2 cloudflare bucket disk usage",
    Encoding: "encoding ffmpeg codec bitrate quality preset 1080p 720p keyframe gop aes encrypt hls audio stereo surround",
    Player: "player autoplay loop controls embed accent color responsive",
    Domains: "domains dashboard player cdn dns zone fallback",
    Ads: "ads vast vpaid preroll midroll postroll popup advertisement",
    Email: "email smtp aws gmail outlook sendgrid postmark mailgun password",
    Security: "security signed urls hotlink ip rate limit auth tokens rps",
    Team: "team member user role owner editor admin invite",
    Account: "account email username password 2fa two factor authentication",
  };
  const filteredTabs = (() => {
    const q = settingsQuery.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter((t) => t.toLowerCase().includes(q) || TAB_KEYWORDS[t].includes(q));
  })();

  // Email (SMTP)
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailCfg, setEmailCfg] = useState({
    smtp_provider: "custom",
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    smtp_pass: "",
    smtp_from: "",
    smtp_from_name: "The Archive",
    smtp_secure: "false",
    configured: false,
  });
  const [emailDirty, setEmailDirty] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTestTo, setEmailTestTo] = useState("");
  const [emailTesting, setEmailTesting] = useState(false);

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
  const [encodingRanges, setEncodingRanges] = useState<Record<string, BitrateRange> | null>(null);
  const [encodingTierPresets, setEncodingTierPresets] = useState<Record<string, TierPreset> | null>(null);
  const [encodingDirty, setEncodingDirty] = useState(false);
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
          const enc = await api.get<EncodingConfigResponse>("/settings/encoding");
          setEncodingConfig(enc.config);
          setEncodingValid(enc.validValues);
          if (enc.ranges) setEncodingRanges(enc.ranges);
          if (enc.tierPresets) setEncodingTierPresets(enc.tierPresets);
          setEncodingDirty(false);
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

        // Load SMTP (best-effort — non-owners may get 403)
        try {
          const smtp = await api.get<typeof emailCfg>("/settings/email");
          setEmailCfg(prev => ({ ...prev, ...smtp }));
          setEmailLoaded(true);
          if (adminRes.admin?.email) setEmailTestTo(adminRes.admin.email);
        } catch {
          setEmailLoaded(true);
        }

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
      setEncodingDirty(false);
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
    setEncodingDirty(true);
  };

  // Merge multiple encoding field updates in one state change (used by tier presets
  // which bulk-set 8 bitrate fields at once).
  const updateEncodingBulk = (patch: Partial<EncodingConfig>) => {
    setEncodingConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    setEncodingDirty(true);
  };

  const resetEncodingDefaults = async () => {
    try {
      // Load balanced-tier defaults + reset secondary settings to the server's DEFAULTS.
      // This matches what "Reset to defaults" did in the old dashboard.
      const preset = encodingTierPresets?.balanced;
      if (!preset) return;
      const patch: Partial<EncodingConfig> = {
        preset_tier: "balanced",
        ...preset,
        rate_control: "constrained_vbr",
        maxrate_ratio: 1.5,
        bufsize_ratio: 2.0,
        ffmpeg_preset: "veryfast",
        keyframe_seconds: 2,
        video_codec: "h264",
        audio_mode: "stereo",
        ac3_bitrate: 384,
        clone_top_quality: true,
        encrypt_new_videos: false,
        extra_ffmpeg_params: "",
      };
      updateEncodingBulk(patch);
      toast("Reset to defaults — remember to Save.", "success");
    } catch {
      toast("Failed to reset defaults", "error");
    }
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
        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-8">
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
        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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
        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-8">
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
        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)] mb-8">
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
      <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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

  // -----------------------------------------------------------------------
  // Email (SMTP)
  // -----------------------------------------------------------------------
  const PROVIDER_DEFAULTS: Record<string, { host: string; port: string; secure: string; hint: string }> = {
    ses:       { host: "email-smtp.us-east-1.amazonaws.com", port: "587", secure: "false", hint: "Use IAM SMTP credentials from AWS SES. Ensure your domain + region are verified." },
    gmail:     { host: "smtp.gmail.com",                     port: "587", secure: "false", hint: "Use an App Password from your Google Account (2FA must be enabled)." },
    outlook:   { host: "smtp.office365.com",                 port: "587", secure: "false", hint: "Works with Microsoft 365 accounts. SMTP AUTH must be enabled." },
    mailgun:   { host: "smtp.mailgun.org",                   port: "587", secure: "false", hint: "Use your Mailgun SMTP credentials from the domain sending settings." },
    sendgrid:  { host: "smtp.sendgrid.net",                  port: "587", secure: "false", hint: "User is literally \"apikey\", password is your SG API key." },
    postmark:  { host: "smtp.postmarkapp.com",               port: "587", secure: "false", hint: "Use your Server API token as both username and password." },
    custom:    { host: "",                                   port: "587", secure: "false", hint: "Any SMTP server. Fill in the host/port/user/pass yourself." },
  };

  const updateEmail = (patch: Partial<typeof emailCfg>) => {
    setEmailCfg(prev => ({ ...prev, ...patch }));
    setEmailDirty(true);
  };

  const onProviderChange = (provider: string) => {
    const d = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.custom;
    setEmailCfg(prev => ({
      ...prev,
      smtp_provider: provider,
      smtp_host: provider === "custom" ? prev.smtp_host : d.host,
      smtp_port: d.port,
      smtp_secure: d.secure,
    }));
    setEmailDirty(true);
  };

  const saveEmail = async () => {
    setEmailSaving(true);
    try {
      const body = {
        ...emailCfg,
        smtp_secure: emailCfg.smtp_secure === "true" || emailCfg.smtp_secure === true as unknown as string,
        smtp_port: Number(emailCfg.smtp_port) || 587,
      };
      // Don't re-send masked password
      if (body.smtp_pass === "••••••••") delete (body as Record<string, unknown>).smtp_pass;
      const r = await api.put<{ configured?: boolean }>("/settings/email", body);
      setEmailCfg(prev => ({ ...prev, configured: !!r.configured }));
      setEmailDirty(false);
      toast("Email settings saved", "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Failed to save email settings", "error");
    } finally {
      setEmailSaving(false);
    }
  };

  const testEmail = async () => {
    const to = (emailTestTo || email).trim();
    if (!to.includes("@")) { toast("Enter a valid email address", "error"); return; }
    setEmailTesting(true);
    try {
      await api.post("/settings/email/test", { to });
      toast(`Test email sent to ${to}`, "success");
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast(err.message ?? "Test email failed — check your SMTP credentials", "error");
    } finally {
      setEmailTesting(false);
    }
  };

  function renderEmail() {
    const cfg = emailCfg;
    const d = PROVIDER_DEFAULTS[cfg.smtp_provider] ?? PROVIDER_DEFAULTS.custom;
    return (
      <div className="space-y-6">
        {/* Status banner */}
        <div
          className="flex items-start gap-3 rounded-[12px] px-4 py-3"
          style={cfg.configured
            ? { background: "rgba(46,125,50,0.08)", border: "1px solid rgba(46,125,50,0.2)" }
            : { background: "rgba(232,168,23,0.08)", border: "1px solid rgba(232,168,23,0.25)" }}
        >
          <span className="material-symbols-outlined text-[20px]" style={{ color: cfg.configured ? "#2e7d32" : "#b7791f" }}>
            {cfg.configured ? "check_circle" : "warning"}
          </span>
          <div className="flex-1">
            <div className="text-[13px] font-semibold" style={{ color: cfg.configured ? "#1b5e20" : "#92580d" }}>
              {cfg.configured ? "SMTP configured" : "SMTP not configured"}
            </div>
            <p className="text-[11.5px] mt-0.5" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
              {cfg.configured
                ? "Welcome emails, password resets, and test emails will use this configuration."
                : "Enter SMTP credentials below so the app can send welcome emails, password resets, and notifications."}
            </p>
          </div>
        </div>

        {/* Provider card */}
        <div className={sectionCard}>
          <h3 className="mb-1 text-[15px] font-bold text-on-surface">Email Provider</h3>
          <p className="mb-5 text-[12px] text-on-surface-var">Pick a preset to auto-fill the host and port — or choose Custom for any SMTP server.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {(["ses","gmail","outlook","mailgun","sendgrid","postmark","custom"] as const).map(p => {
              const active = cfg.smtp_provider === p;
              const labels: Record<string, string> = {
                ses: "AWS SES",
                gmail: "Gmail",
                outlook: "Outlook",
                mailgun: "Mailgun",
                sendgrid: "SendGrid",
                postmark: "Postmark",
                custom: "Custom",
              };
              return (
                <button
                  key={p}
                  onClick={() => onProviderChange(p)}
                  className="rounded-[10px] px-3 py-2 text-[12.5px] font-semibold border-2 transition-all"
                  style={{
                    borderColor: active ? "#5b5a8b" : "rgb(var(--surface-high-rgb))",
                    background: active ? "rgba(91,90,139,.06)" : "rgb(var(--surface-card-rgb))",
                    color: active ? "#5b5a8b" : "rgb(var(--on-surface-rgb))",
                  }}
                >
                  {labels[p]}
                </button>
              );
            })}
          </div>
          <p className="text-[11.5px] leading-relaxed" style={{ color: "rgb(var(--on-surface-var-rgb))" }}>
            <span className="material-symbols-outlined text-[13px] align-text-bottom mr-1" style={{ color: "#5b5a8b" }}>info</span>
            {d.hint}
          </p>
        </div>

        {/* Credentials card */}
        <div className={sectionCard}>
          <h3 className="mb-5 text-[15px] font-bold text-on-surface">SMTP Credentials</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <TextField label="Host" value={cfg.smtp_host} onChange={(v) => updateEmail({ smtp_host: v })} placeholder="smtp.example.com" />
            <TextField label="Port" value={cfg.smtp_port} onChange={(v) => updateEmail({ smtp_port: v.replace(/\D/g, "") })} placeholder="587" />
            <TextField label="Username" value={cfg.smtp_user} onChange={(v) => updateEmail({ smtp_user: v })} placeholder="user@example.com" />
            <label className="block">
              <span className="mb-2 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">Password</span>
              <input
                type="password"
                value={cfg.smtp_pass}
                onChange={(e) => updateEmail({ smtp_pass: e.target.value })}
                placeholder={cfg.configured ? "••••••••" : "Enter SMTP password / API key"}
                className="w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 text-[13px] text-[#1e1e2f] placeholder-[#9ca3af] focus:ring-2 focus:ring-primary/15 focus:border-primary/30 focus:outline-none transition"
              />
            </label>
            <TextField label='From Address' value={cfg.smtp_from} onChange={(v) => updateEmail({ smtp_from: v })} placeholder="noreply@yourdomain.com" />
            <TextField label='From Name' value={cfg.smtp_from_name} onChange={(v) => updateEmail({ smtp_from_name: v })} placeholder="The Archive" />
          </div>
          <label className="mt-4 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.smtp_secure === "true" || (cfg.smtp_secure as unknown as boolean) === true}
              onChange={(e) => updateEmail({ smtp_secure: e.target.checked ? "true" : "false" })}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-[12.5px] text-on-surface">Use TLS/SSL (usually on port 465). Most modern providers on port 587 use STARTTLS and leave this off.</span>
          </label>
          <div className="mt-6 flex justify-end gap-2 flex-wrap">
            <button onClick={saveEmail} disabled={emailSaving || !emailDirty} className={btnPrimary}>
              {emailSaving ? "Saving…" : "Save Email Settings"}
            </button>
          </div>
        </div>

        {/* Test email card */}
        <div className={sectionCard}>
          <h3 className="mb-1 text-[15px] font-bold text-on-surface">Send Test Email</h3>
          <p className="mb-4 text-[12px] text-on-surface-var">Send a test message to verify credentials work end-to-end.</p>
          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex-1 min-w-[240px]">
              <TextField
                label="Recipient"
                value={emailTestTo}
                onChange={(v) => setEmailTestTo(v)}
                placeholder="you@example.com"
              />
            </div>
            <button
              onClick={testEmail}
              disabled={emailTesting}
              className="inline-flex items-center gap-1.5 rounded-btn border border-on-surface/15 bg-surface-card px-4 py-3 text-[13px] font-semibold text-on-surface hover:bg-surface-low disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px] font-normal">send</span>
              {emailTesting ? "Sending…" : "Send Test"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderTeam() {
    return (
      <div className={sectionCard}>
        <TeamPanel />
      </div>
    );
  }

  function renderAccount() {
    return (
      <div className="space-y-6">
        {/* Account Settings */}
        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <h3 className="mb-6 text-[15px] font-bold text-[#1e1e2f]">Account Settings</h3>
          <div className="flex flex-col gap-5">
            <TextField label="Email" value={email} readOnly />
            <TextField label="Username" value={username} readOnly />
          </div>
        </div>

        {/* Two-factor authentication (per-admin, so it lives under the admin's Account) */}
        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="mb-4">
            <h3 className="text-[15px] font-bold text-[#1e1e2f]">Two-Factor Authentication</h3>
            <p className="mt-1 text-[12px] text-on-surface-var">Add a 6-digit code from your authenticator app to your sign-in — protects your own account.</p>
          </div>
          <TwoFactorCard onToast={(msg, tone) => toast(msg, tone ?? "success")} />
        </div>

        {/* Change Password */}
        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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
      </div>
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
      <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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

    type QK = "bitrate_2160p" | "bitrate_1440p" | "bitrate_1080p" | "bitrate_720p" | "bitrate_480p" | "bitrate_360p" | "bitrate_240p";
    const qualityRows: { key: QK; label: string; tag: string; rangeKey: string; note: string }[] = [
      { key: "bitrate_2160p", label: "2160p Video", tag: "4K UHD",             rangeKey: "2160p", note: "only encoded if source is 4K" },
      { key: "bitrate_1440p", label: "1440p Video", tag: "2K QHD",             rangeKey: "1440p", note: "only encoded if source is 1440p+" },
      { key: "bitrate_1080p", label: "1080p Video", tag: "Full HD",            rangeKey: "1080p", note: "" },
      { key: "bitrate_720p",  label: "720p Video",  tag: "",                   rangeKey: "720p",  note: "" },
      { key: "bitrate_480p",  label: "480p Video",  tag: "",                   rangeKey: "480p",  note: "" },
      { key: "bitrate_360p",  label: "360p Video",  tag: "Low SD",             rangeKey: "360p",  note: "" },
      { key: "bitrate_240p",  label: "240p Video",  tag: "Mobile / weak network", rangeKey: "240p", note: "perfect for 3G fallback" },
    ];

    // Rough "typical H.264 VBR output" estimate for a 10-min video. Coefficient
    // 0.045 was picked to match the old dashboard's per-slider size hints
    // (2160p @ 14000k -> ~621 MB, 1080p @ 3500k -> ~159 MB).
    const estimateMb = (kbps: number) => Math.round((kbps || 0) * 0.045);

    const toggleDefaultQuality = (q: string) => {
      const current = new Set(cfg.default_qualities || []);
      if (current.has(q)) current.delete(q); else current.add(q);
      updateEncoding("default_qualities", Array.from(current));
    };

    // Switching to a tier auto-fills all 8 bitrates. "custom" is a marker — leave
    // the existing values alone so the admin keeps their hand-tuned bitrates.
    const applyTier = (tier: string) => {
      if (tier === cfg.preset_tier) return;
      const preset = encodingTierPresets?.[tier];
      if (tier === "custom" || !preset) {
        updateEncoding("preset_tier", tier);
        return;
      }
      updateEncodingBulk({ preset_tier: tier, ...preset });
    };

    const tierMeta: Record<string, { icon: string; title: string; desc: string; est: string; tag: string; tagColor: string; bg: string; bubbleBg: string; bubbleColor: string }> = {
      premium:   { icon: "star",         title: "Premium",   desc: "Highest quality, best for premium content", est: "~825 MB / 10-min video", tag: "+50% file size", tagColor: "#b45309", bg: "#fef3c7", bubbleBg: "#fef3c7", bubbleColor: "#b45309" },
      balanced:  { icon: "check_circle", title: "Balanced",  desc: "Recommended for most platforms",            est: "~551 MB / 10-min video", tag: "Default",        tagColor: "#5b5a8b", bg: "#eceafd", bubbleBg: "#ede9fe", bubbleColor: "#5b5a8b" },
      optimized: { icon: "inventory_2",  title: "Optimized", desc: "Smaller files, save on storage costs",      est: "~395 MB / 10-min video", tag: "-28% file size", tagColor: "#047857", bg: "#d1fae5", bubbleBg: "#d1fae5", bubbleColor: "#047857" },
      custom:    { icon: "tune",         title: "Custom",    desc: "Set every bitrate manually below",          est: "Manual",                 tag: "Full control",   tagColor: "#475569", bg: "#e2e8f0", bubbleBg: "#f1f5f9", bubbleColor: "#475569" },
    };

    // Estimated Impact: sum per-quality sizes for the qualities the admin plans
    // to encode (default_qualities). Audio layer adds a small constant per variant.
    const activeQualities = (cfg.default_qualities || []);
    const impactRows = qualityRows
      .filter(r => {
        const qName = r.key.replace("bitrate_", "");
        return activeQualities.includes(qName);
      })
      .map(r => {
        const mb = estimateMb(cfg[r.key] as number);
        const qName = r.key.replace("bitrate_", "");
        return { q: qName, mb };
      });
    const totalMb = impactRows.reduce((a, r) => a + r.mb, 0);
    const r2CostPer100 = (totalMb / 1024) * 0.015 * 100; // $0.015/GB-mo, 100 videos

    // Maxrate/bufsize ranges — fall back to compile-time constants if server doesn't return them
    const maxR = vv.maxrateRatioRange || { min: 1.0, max: 3.0, default: 1.5 };
    const bufR = vv.bufsizeRatioRange || { min: 1.0, max: 4.0, default: 2.0 };

    // 1080p @ 3500k is the "typical" live-preview anchor shown in the old design.
    const sampleBitrate1080 = cfg.bitrate_1080p;

    // Worker status color + label
    const statusColor = workerStatus?.restartPending ? "#ef6c00" : workerStatus?.activeJobs ? "#2196f3" : "#2e7d32";
    const statusLabel = workerStatus?.restartPending
      ? "Restart pending"
      : workerStatus?.activeJobs
      ? "Processing"
      : "Idle";

    return (
      <>
        {/* ── Quality Preset ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-on-surface-var">tune</span>
            <h3 className="text-[15px] font-bold text-on-surface">Quality Preset</h3>
          </div>
          <p className="mb-5 text-[12px] text-on-surface-var">Pick a starting point — the bitrates below will fill in automatically</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(["premium", "balanced", "optimized", "custom"] as const).map((tier) => {
              const meta = tierMeta[tier];
              const active = cfg.preset_tier === tier;
              return (
                <button
                  key={tier}
                  onClick={() => applyTier(tier)}
                  className="rounded-[14px] border-2 px-5 py-5 text-left transition-all"
                  style={active
                    ? { borderColor: "#5b5a8b", background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)", boxShadow: "0 4px 12px rgba(91, 90, 139, 0.08)" }
                    : { borderColor: "#e5e7eb", background: "#fff" }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = "#c4b5fd"; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e7eb"; }}
                >
                  <div className="mb-3 flex items-center gap-2.5">
                    <span
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full"
                      style={{ background: meta.bubbleBg }}
                    >
                      <span className="material-symbols-outlined text-[17px]" style={{ color: meta.bubbleColor, fontVariationSettings: "'FILL' 1" }}>{meta.icon}</span>
                    </span>
                    <span className="text-[15px] font-extrabold text-on-surface">{meta.title}</span>
                  </div>
                  <p className="mb-4 text-[11.5px] text-on-surface-var leading-relaxed">{meta.desc}</p>
                  <div className="text-[13px] font-extrabold text-on-surface mb-2">{meta.est}</div>
                  <div className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: meta.bg, color: meta.tagColor }}>
                    {meta.tag}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Video Bitrates (sliders) ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-on-surface-var">video_settings</span>
            <h3 className="text-[15px] font-bold text-on-surface">Video Bitrates</h3>
          </div>
          <p className="mb-5 text-[12px] text-on-surface-var">Higher = better quality + larger files. Lower = smaller files + slight quality loss in dark/complex scenes.</p>
          <div className="flex flex-col gap-5">
            {qualityRows.map((r) => {
              const range = (encodingRanges && encodingRanges[r.rangeKey]) || { min: 100, max: 24000, default: 1000 };
              const value = cfg[r.key] as number;
              const mb = estimateMb(value);
              return (
                <div key={r.key}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-bold text-on-surface">{r.label}</span>
                      {r.tag && <span className="text-[11px] text-on-surface-var">({r.tag})</span>}
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[14px] font-bold text-primary">{value}</span>
                      <span className="text-[11px] font-semibold text-on-surface-var">kbps</span>
                    </div>
                  </div>
                  <input
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.min >= 1000 ? 100 : 10}
                    value={value}
                    onChange={(e) => updateEncoding(r.key, Number(e.target.value) as never)}
                    className="slider-purple has-fill w-full cursor-pointer"
                    style={{ ["--fill-pct" as never]: `${((value - range.min) / (range.max - range.min)) * 100}%` }}
                  />
                  <div className="mt-1 flex items-center justify-between text-[11px] text-on-surface-var">
                    <span>{range.min}k</span>
                    <span>{range.max}k</span>
                  </div>
                  <div className="mt-1 text-[11px] text-on-surface-var">
                    <span className="mr-1">↳</span>
                    ~{mb} MB per 10-min video{r.note ? ` · ${r.note}` : ""}
                  </div>
                </div>
              );
            })}
            {/* Audio bitrate row — dropdown, kept next to the video bitrates since it's the same family of knobs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2 border-t border-[#e5e7eb]">
              <label className="block">
                <span className={labelClass}>Audio bitrate</span>
                <select value={cfg.audio_bitrate} onChange={(e) => updateEncoding("audio_bitrate", Number(e.target.value))} className={selectClass}>
                  {vv.audio.map((b) => <option key={b} value={b}>{b} kbps</option>)}
                </select>
              </label>
            </div>
          </div>
        </div>

        {/* ── Default Output Qualities (pill chips) ── */}
        <div className={`${sectionCard} mb-6`}>
          <h3 className="mb-1 text-[15px] font-bold text-on-surface">Default Output Qualities to Encode</h3>
          <p className="mb-4 text-[12px] text-on-surface-var">Which quality renditions to produce for new videos. Source resolution caps this list — no upscaling.</p>
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

        {/* ── Audio Mode (pill toggle + AC3 bitrate) ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-on-surface-var">graphic_eq</span>
            <h3 className="text-[15px] font-bold text-on-surface">Audio Mode</h3>
          </div>
          <p className="mb-4 text-[12px] text-on-surface-var">Surround produces BOTH a 5.1 AC3 track and a stereo AAC fallback. The player auto-selects based on device capability. Only works when the source has 5.1+ audio — stereo sources skip the surround track automatically.</p>
          <div className="grid grid-cols-2 gap-3">
            {(["stereo", "surround"] as const).map((mode) => {
              const active = cfg.audio_mode === mode;
              const label = mode === "stereo" ? "Stereo AAC" : "5.1 Surround";
              const sub = mode === "stereo" ? "" : "AC3 + AAC";
              return (
                <button
                  key={mode}
                  onClick={() => updateEncoding("audio_mode", mode)}
                  className="rounded-[12px] border-2 px-6 py-3.5 text-[13.5px] font-bold transition-all"
                  style={active
                    ? { borderColor: "#5b5a8b", background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)", color: "#1e1e2f" }
                    : { borderColor: "#e5e7eb", background: "#fff", color: "#596064" }}
                >
                  {label}
                  {sub && <span className="ml-1.5 text-[11px] font-semibold text-on-surface-var">{sub}</span>}
                </button>
              );
            })}
          </div>
          {cfg.audio_mode === "surround" && (
            <div className="mt-5 pt-5 border-t border-[#e5e7eb]">
              <span className={labelClass}>AC3 Bitrate</span>
              <div className="flex flex-wrap gap-2">
                {vv.ac3Bitrates.map((b) => {
                  const active = cfg.ac3_bitrate === b;
                  const hint = b === 256 ? "economy" : b === 384 ? "standard" : b === 448 ? "broadcast" : b === 640 ? "reference" : "";
                  return (
                    <button
                      key={b}
                      onClick={() => updateEncoding("ac3_bitrate", b)}
                      className={`rounded-full border px-4 py-2 text-[12px] font-semibold transition ${
                        active ? "border-primary bg-primary text-white" : "border-[#e5e7eb] bg-white text-on-surface-var hover:border-primary/40"
                      }`}
                    >
                      {b}k{hint ? ` ${hint}` : ""}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Worker Performance ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-on-surface-var">speed</span>
            <h3 className="text-[15px] font-bold text-on-surface">Worker Performance</h3>
          </div>
          <p className="mb-4 text-[12px] text-on-surface-var">Controls how the FFmpeg worker uses your CPU. Pick higher values on bigger servers.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <label className="block">
              <span className={labelClass}>Quality Variants in Parallel</span>
              <select value={cfg.quality_concurrency} onChange={(e) => updateEncoding("quality_concurrency", Number(e.target.value))} className={selectClass}>
                {vv.qualityConcurrency.map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 2 ? "— balanced (recommended for 2-4 vCPU)" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11px] text-on-surface-var">How many quality levels (1080p, 720p…) FFmpeg encodes at the same time per video.</span>
            </label>
            <label className="block">
              <span className={labelClass}>Videos in Parallel</span>
              <select value={cfg.video_concurrency} onChange={(e) => updateEncoding("video_concurrency", Number(e.target.value))} className={selectClass}>
                {vv.videoConcurrency.map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "— first video finishes sooner" : ""}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#b45309]">⚠ Worker restart required to apply</span>
                <button
                  onClick={() => restartWorker(false)}
                  disabled={workerRestarting}
                  className="inline-flex items-center gap-1 rounded-[8px] border border-[#e5e7eb] bg-white px-3 py-1 text-[11px] font-semibold text-on-surface hover:bg-surface-high disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[13px]">restart_alt</span>
                  {workerRestarting ? "Restarting..." : "Restart Worker"}
                </button>
              </div>
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[11px] text-on-surface-var">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusColor }} />
            <span>Status: <span className="font-bold" style={{ color: statusColor }}>{statusLabel}</span></span>
            {workerStatus && <span>· {workerStatus.activeJobs} active · {workerStatus.waitingJobs} waiting · {workerStatus.delayedJobs} delayed</span>}
            <button onClick={refreshWorkerStatus} className="ml-auto text-[11px] text-primary hover:underline">Refresh</button>
          </div>
        </div>

        {/* ── Encoder settings (FFmpeg preset + Video codec + Keyframe interval) ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="flex flex-col gap-5">
            <label className="block">
              <span className={labelClass}><span className="material-symbols-outlined text-[14px] align-middle mr-1">settings</span>FFmpeg Preset</span>
              <select value={cfg.ffmpeg_preset} onChange={(e) => updateEncoding("ffmpeg_preset", e.target.value)} className={selectClass}>
                {vv.ffmpegPresets.map((p) => (
                  <option key={p} value={p}>
                    {p}{p === "veryfast" ? " — fast + clean (recommended)" : p === "medium" ? " — slower, slightly better quality" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11px] text-on-surface-var">Faster encoding = slightly bigger files. Doesn&apos;t change output file size much (uses target bitrate above).</span>
            </label>

            <label className="block">
              <span className={labelClass}><span className="material-symbols-outlined text-[14px] align-middle mr-1">videocam</span>Video Codec</span>
              <select value={cfg.video_codec} onChange={(e) => updateEncoding("video_codec", e.target.value)} className={selectClass}>
                {vv.videoCodecs.map((c) => (
                  <option key={c} value={c}>
                    {c === "h264" ? "H.264 — universal compatibility (recommended)"
                      : c === "h265" ? "H.265 (HEVC) — 30-50% smaller but Firefox can't play"
                      : c === "av1" ? "AV1 — smallest files, 5-20× slower encode"
                      : c}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11px] text-on-surface-var">H.264 works everywhere. H.265 saves 30-50% storage but doesn&apos;t play in Firefox. AV1 saves 40-60% but encodes 5-20× slower and requires recent browsers.</span>
            </label>

            <label className="block">
              <span className={labelClass}><span className="material-symbols-outlined text-[14px] align-middle mr-1">schedule</span>Keyframe Interval (GOP Size)</span>
              <select value={cfg.keyframe_seconds} onChange={(e) => updateEncoding("keyframe_seconds", Number(e.target.value))} className={selectClass}>
                {vv.keyframeSeconds.map((k) => (
                  <option key={k} value={k}>
                    {k} second{k !== 1 ? "s" : ""}{k === 2 ? " — balanced (recommended, Apple HLS spec)" : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11px] text-on-surface-var">How often the encoder inserts a full-image keyframe. Shorter interval = faster seeking + quicker quality switching, but larger files. Auto-derived from source fps.</span>
            </label>
          </div>
        </div>

        {/* ── Rate Control (ABR / Constrained VBR + 2 sliders) ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-on-surface-var">speed</span>
            <h3 className="text-[15px] font-bold text-on-surface">Rate Control</h3>
          </div>
          <p className="mb-4 text-[12px] text-on-surface-var">Controls how FFmpeg distributes bits across scenes. Constrained VBR gives better quality-per-bit for streaming.</p>

          <div className="mb-5 grid grid-cols-2 gap-3">
            {(["abr", "constrained_vbr"] as const).map((mode) => {
              const active = cfg.rate_control === mode;
              const label = mode === "abr" ? "ABR" : "Constrained VBR";
              const hint = mode === "abr" ? "simple" : "recommended";
              return (
                <button
                  key={mode}
                  onClick={() => updateEncoding("rate_control", mode)}
                  className="rounded-[12px] border-2 px-6 py-3.5 text-[13.5px] font-bold transition-all"
                  style={active
                    ? { borderColor: "#5b5a8b", background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)", color: "#1e1e2f" }
                    : { borderColor: "#e5e7eb", background: "#fff", color: "#596064" }}
                >
                  {label} <span className="text-[11px] font-semibold text-on-surface-var">{hint}</span>
                </button>
              );
            })}
          </div>

          {cfg.rate_control === "constrained_vbr" && (
            <div className="mb-4 flex flex-col gap-5">
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className={labelClass + " mb-0"}>Maxrate Ratio</span>
                  <span className="text-[14px] font-bold text-primary">{cfg.maxrate_ratio.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min={maxR.min} max={maxR.max} step={0.1}
                  value={cfg.maxrate_ratio}
                  onChange={(e) => updateEncoding("maxrate_ratio", Number(e.target.value))}
                  className="slider-purple has-fill w-full cursor-pointer"
                  style={{ ["--fill-pct" as never]: `${((cfg.maxrate_ratio - maxR.min) / (maxR.max - maxR.min)) * 100}%` }}
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-on-surface-var">
                  <span>{maxR.min.toFixed(1)}×</span>
                  <span>1080p @ {sampleBitrate1080}k → maxrate {Math.round(sampleBitrate1080 * cfg.maxrate_ratio)}k</span>
                  <span>{maxR.max.toFixed(1)}×</span>
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className={labelClass + " mb-0"}>Buffer Ratio</span>
                  <span className="text-[14px] font-bold text-primary">{cfg.bufsize_ratio.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min={bufR.min} max={bufR.max} step={0.1}
                  value={cfg.bufsize_ratio}
                  onChange={(e) => updateEncoding("bufsize_ratio", Number(e.target.value))}
                  className="slider-purple has-fill w-full cursor-pointer"
                  style={{ ["--fill-pct" as never]: `${((cfg.bufsize_ratio - bufR.min) / (bufR.max - bufR.min)) * 100}%` }}
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-on-surface-var">
                  <span>{bufR.min.toFixed(1)}×</span>
                  <span>1080p @ {sampleBitrate1080}k → bufsize {Math.round(sampleBitrate1080 * cfg.bufsize_ratio)}k</span>
                  <span>{bufR.max.toFixed(1)}×</span>
                </div>
              </div>
            </div>
          )}
          <p className="text-[11px] text-on-surface-var leading-relaxed">
            <span className="font-bold">ABR:</span> pure average bitrate — predictable file sizes, quality may drop on complex scenes.{" "}
            <span className="font-bold">Constrained VBR:</span> allows bitrate spikes up to maxrate on complex scenes while saving on simple ones — better quality per bit. Used by Netflix, YouTube, and all professional streaming platforms.
          </p>
        </div>

        {/* ── Clone top quality ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-bold text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-on-surface-var">content_copy</span>
                Clone top quality
              </div>
              <p className="mt-1 text-[12px] text-on-surface-var">When the source video is already H.264 AND its resolution matches a quality preset (e.g., 1080p source → 1080p variant), skip re-encoding for that variant and just copy the source. Saves up to 80% encoding time for matching uploads. Lower-quality variants (720p, 480p, etc.) are still re-encoded normally.</p>
            </div>
            <Toggle enabled={cfg.clone_top_quality} onChange={() => updateEncoding("clone_top_quality", !cfg.clone_top_quality)} />
          </div>
        </div>

        {/* ── AES-128 encryption ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-bold text-on-surface">
                <span className="material-symbols-outlined text-[18px] text-on-surface-var">lock</span>
                Encrypt new videos (AES-128)
              </div>
              <p className="mt-1 text-[12px] text-on-surface-var">New uploads are AES-128 encrypted at the HLS segment level. Segments are useless without the key, which the player fetches from an authenticated endpoint and which is <span className="font-bold">never</span> written to your CDN/storage.</p>
              <p className="mt-1 text-[11px] text-on-surface-var italic">Works in Chrome, Firefox, and Edge. Safari native HLS does not yet support authenticated key delivery — encrypted videos will not play in Safari.</p>
            </div>
            <Toggle enabled={cfg.encrypt_new_videos} onChange={() => updateEncoding("encrypt_new_videos", !cfg.encrypt_new_videos)} />
          </div>
        </div>

        {/* ── Extra FFmpeg parameters ── */}
        <div className={`${sectionCard} mb-6`}>
          <div className="mb-2 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-on-surface-var">terminal</span>
            <h3 className="text-[14px] font-bold text-on-surface">EXTRA FFMPEG PARAMETERS <span className="text-[11px] font-semibold text-on-surface-var">(ADVANCED)</span></h3>
          </div>
          <textarea
            value={cfg.extra_ffmpeg_params || ""}
            onChange={(e) => updateEncoding("extra_ffmpeg_params", e.target.value)}
            rows={4}
            placeholder="-tune film&#10;-profile:v high&#10;-level 4.1"
            className="w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3 font-mono text-[12px] text-[#1e1e2f] placeholder-[#9ca3af] focus:ring-2 focus:ring-primary/15 focus:border-primary/30 focus:outline-none transition"
          />
          <div className="mt-3 rounded-[8px] border-l-4 border-[#f59e0b] bg-[#fffbeb] px-4 py-2.5 text-[11.5px] text-[#92400e] leading-relaxed">
            Appended directly to every FFmpeg encode command. One flag per line (e.g., <code className="font-mono">-tune film</code>). Incorrect values will cause encoding to fail. Max 500 characters. The flags <code className="font-mono">-i</code>, <code className="font-mono">-y</code>, <code className="font-mono">-filter_script</code>, and <code className="font-mono">-dump</code> are blocked for security.
          </div>
        </div>

        {/* ── Estimated Impact (purple tinted) ── */}
        <div className="rounded-[14px] border border-[#c7d2fe]/60 bg-gradient-to-br from-[#ede9fe] to-[#e0e7ff] p-6 mb-6">
          <div className="mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-[#5b5a8b]">insights</span>
            <h3 className="text-[14px] font-bold text-[#1e1e2f]">Estimated Impact</h3>
          </div>
          <p className="mb-4 text-[11.5px] text-[#475569]">Based on your current settings + a typical 10-min source video</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <div className="mb-1 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">
                <span>📁</span> OUTPUT SIZE PER VIDEO
              </div>
              <div className="mb-3 text-[28px] font-extrabold leading-none text-[#1e1e2f]">~{totalMb} MB</div>
              <div className="text-[11.5px] text-[#475569] space-y-0.5 font-mono">
                {impactRows.length === 0
                  ? <span className="italic">Pick at least one quality above.</span>
                  : impactRows.map(r => (
                    <div key={r.q}>{r.q} HLS: ~{r.mb} MB</div>
                  ))}
              </div>
              <p className="mt-3 text-[11px] italic text-[#6b7280]">Only encoded up to source resolution allows — no upscaling.</p>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">
                <span>☁</span> CLOUDFLARE R2 COST
              </div>
              <div className="text-[11.5px] text-[#475569] space-y-1">
                <div>100 videos: <span className="font-bold">~${r2CostPer100.toFixed(2)}/mo</span> · ~{(totalMb * 100 / 1024).toFixed(1)} GB</div>
                <div>1,000 videos: <span className="font-bold">~${(r2CostPer100 * 10).toFixed(2)}/mo</span> · ~{(totalMb * 1000 / 1024).toFixed(1)} GB</div>
                <div>10,000 videos: <span className="font-bold">~${(r2CostPer100 * 100).toFixed(2)}/mo</span> · ~{(totalMb * 10000 / 1024 / 1024).toFixed(1)} TB</div>
              </div>
              <p className="mt-3 text-[11px] italic text-[#6b7280]">R2: $0.015/GB·mo · 10 GB free tier · zero egress fees</p>
            </div>
          </div>
        </div>

        {/* ── Bottom bar: Reset | Unsaved | Save ── */}
        <div className="flex items-center justify-between gap-3 mt-4">
          <button
            onClick={resetEncodingDefaults}
            className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#e5e7eb] bg-white px-4 py-2.5 text-[13px] font-semibold text-on-surface-var hover:bg-surface-high transition"
          >
            <span className="material-symbols-outlined text-[15px]">refresh</span>
            Reset to defaults
          </button>
          <div className="flex items-center gap-3">
            {encodingDirty && (
              <span className="text-[12px] font-bold text-primary">Unsaved changes</span>
            )}
            <button onClick={saveEncoding} disabled={encodingSaving || !encodingDirty} className={btnPrimary}>
              <span className="material-symbols-outlined text-[15px] mr-1 align-middle">save</span>
              {encodingSaving ? "Saving..." : "Save Settings"}
            </button>
          </div>
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

        <div className="rounded-[16px] bg-white p-4 sm:p-7 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
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

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : (
        <>
          {/* Settings header — single title, with subtitle + find-a-setting search */}
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-[20px] font-extrabold tracking-[-0.2px] text-on-surface">Settings</h1>
              <p className="mt-1 text-[13px] text-on-surface-var">Manage your archive configuration</p>
            </div>
            <div className="relative w-full sm:w-72">
              <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-var/55 text-[16px]">search</span>
              <input
                type="text"
                value={settingsQuery}
                onChange={(e) => setSettingsQuery(e.target.value)}
                placeholder="Find a setting…"
                className="w-full rounded-[10px] border border-on-surface/10 bg-white py-2.5 pl-9 pr-3 text-[13px] text-on-surface placeholder-on-surface-var/55 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition"
              />
            </div>
          </div>

          {/* Tabs — mobile dropdown + desktop horizontal strip */}
          <div className="mb-6 sm:hidden">
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as Tab)}
              className="w-full rounded-[10px] border border-on-surface/15 bg-white px-4 py-3 text-[14px] font-semibold text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              {filteredTabs.map((tab) => <option key={tab} value={tab}>{tab}</option>)}
            </select>
          </div>
          <div
            className="hidden sm:flex mb-8 gap-1 rounded-[10px] border border-on-surface/10 bg-white p-1 overflow-x-auto"
            style={{ scrollbarWidth: "thin" }}
          >
            {filteredTabs.map((tab) => {
              const active = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="shrink-0 px-4 py-2 text-[13px] font-semibold rounded-[8px] transition-all whitespace-nowrap"
                  style={
                    active
                      ? { background: "rgb(var(--surface-low-rgb))", color: "rgb(var(--on-surface-rgb))", boxShadow: "inset 0 0 0 1px rgba(91,90,139,0.25)" }
                      : { background: "transparent", color: "rgb(var(--on-surface-var-rgb))" }
                  }
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "rgb(var(--on-surface-rgb))"; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "rgb(var(--on-surface-var-rgb))"; }}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          {activeTab === "Storage" && renderStorage()}
          {activeTab === "Email" && renderEmail()}
          {activeTab === "Team" && renderTeam()}
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
