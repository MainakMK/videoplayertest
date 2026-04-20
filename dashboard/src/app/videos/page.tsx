"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, apiFetch, getPlayerBase } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import VideoDetail from "@/components/VideoDetail";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Video {
  id: string;
  title: string;
  description?: string;
  status: string;
  storage_type?: "local" | "r2";
  duration?: number;
  views_count: number;
  file_size?: number;
  visibility?: string;
  tags?: string[];
  folder_id?: string;
  created_at: string;
}

interface Folder {
  id: string;
  name: string;
}

interface VideosResponse {
  videos: Video[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const statusColors: Record<string, string> = {
  ready: "bg-success/10 text-success",
  processing: "bg-[#e8a817]/10 text-[#e8a817]",
  error: "bg-error/10 text-error",
  uploading: "bg-primary/10 text-primary",
};

const ITEMS_PER_PAGE = 10;

/* Storage type icons */
function StorageIcon({ type }: { type?: "local" | "r2" }) {
  if (type === "r2") {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span className="material-symbols-outlined text-[14px] text-primary">cloud</span>
        <span className="text-primary font-medium">R2</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="material-symbols-outlined text-[14px] text-on-surface-var">dns</span>
      <span className="text-on-surface-var font-medium">Local</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(seconds?: number): string {
  if (seconds == null || seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatSize(bytes?: number): string {
  if (bytes == null) return "--";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function VideosPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
          </div>
        </DashboardLayout>
      }
    >
      <VideosPageContent />
    </Suspense>
  );
}

function VideosPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderFilter = searchParams.get("folder_id") ?? "";
  const detailId = searchParams.get("id") ?? "";

  /* Data state — all hooks must be declared before any conditional return */
  const [videos, setVideos] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  /* Filter / search / sort / pagination */
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);

  /* Selection */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* Modals — open upload automatically when landing from the dashboard's
     '+ Upload' button (/videos?upload=1). Strip the query once handled so
     refreshing doesn't keep reopening the dialog. */
  const [uploadOpen, setUploadOpen] = useState(() => searchParams.get("upload") === "1");
  useEffect(() => {
    if (searchParams.get("upload") === "1") {
      // Remove the query param from the URL without a navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("upload");
      window.history.replaceState({}, "", url.pathname + (url.search || ""));
    }
  }, [searchParams]);
  const [editVideo, setEditVideo] = useState<Video | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);

  /* Migration polling */
  const [migrating, setMigrating] = useState(false);

  /* Processing progress */
  const [processingProgress, setProcessingProgress] = useState<Record<string, number>>({});

  /* Toast */
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  /* ---- Fetch videos ---- */
  const fetchVideos = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(ITEMS_PER_PAGE));
    if (search) params.set("search", search);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (sort) params.set("sort", sort);
    if (folderFilter) params.set("folder_id", folderFilter);

    api
      .get<VideosResponse>(`/videos?${params.toString()}`)
      .then((res) => {
        setVideos(res.videos ?? []);
        setTotal(res.pagination?.total ?? 0);
      })
      .catch(() => {
        setVideos([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page, search, statusFilter, sort, folderFilter]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  /* Fetch folders for edit modal dropdown */
  useEffect(() => {
    api
      .get<{ folders: Folder[] }>("/folders")
      .then((res) => setFolders(res.folders ?? []))
      .catch(() => {});
  }, []);

  /* Poll migration status when running */
  useEffect(() => {
    if (!migrating) return;
    const interval = setInterval(async () => {
      try {
        const status = await api.get<{ status: string }>("/migration/status");
        if (status.status === "completed") {
          showToast("Migration completed successfully");
          setMigrating(false);
          fetchVideos();
        } else if (status.status === "failed") {
          showToast("Migration failed");
          setMigrating(false);
          fetchVideos();
        } else if (status.status === "idle") {
          setMigrating(false);
          fetchVideos();
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [migrating, showToast, fetchVideos]);

  /* Poll processing progress when any video is processing */
  useEffect(() => {
    const hasProcessing = videos.some((v) => v.status === "processing");
    if (!hasProcessing) {
      setProcessingProgress({});
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api.get<{ progress: Record<string, number> }>("/videos/processing/progress");
        if (!cancelled) {
          setProcessingProgress(data.progress ?? {});
          // If any video hit 100%, refresh the list
          const done = videos.some(
            (v) => v.status === "processing" && (data.progress?.[v.id] ?? 0) >= 100
          );
          if (done) fetchVideos();
        }
      } catch {
        // ignore polling errors
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [videos, fetchVideos]);

  /* ---- Selection helpers ---- */
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === videos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(videos.map((v) => v.id)));
    }
  };

  /* ---- Delete ---- */
  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/videos/${id}`);
      setDeleteTarget(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      fetchVideos();
      showToast("Video deleted");
    } catch {
      showToast("Failed to delete video");
    }
  };

  const handleBulkDelete = async () => {
    try {
      await Promise.all([...selected].map((id) => api.delete(`/videos/${id}`)));
      setSelected(new Set());
      setBulkDeleteOpen(false);
      fetchVideos();
      showToast(`${selected.size} video(s) deleted`);
    } catch {
      showToast("Failed to delete some videos");
    }
  };

  /* ---- Migrate ---- */
  const handleMigrate = async (direction: string, deleteSource: boolean, skipMigrated: boolean) => {
    try {
      await api.post("/migration/start", {
        direction,
        scope: "selected",
        video_ids: [...selected],
        delete_source: deleteSource,
        skip_migrated: skipMigrated,
      });
      setMigrateOpen(false);
      setMigrating(true);
      showToast(`Migration started for ${selected.size} video(s)`);
      setSelected(new Set());
    } catch (e: unknown) {
      const err = e as { message?: string };
      showToast(err.message ?? "Failed to start migration");
    }
  };

  /* ---- Copy embed ---- */
  const copyEmbed = async (video: Video) => {
    const base = await getPlayerBase();
    const snippet = `<iframe src="${base}/embed/${video.id}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;
    navigator.clipboard.writeText(snippet).then(
      () => showToast("Embed code copied to clipboard"),
      () => showToast("Failed to copy embed code")
    );
  };

  /* ---- Pagination ---- */
  const totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));

  /* ---- Video detail view ---- */
  if (detailId) {
    return (
      <DashboardLayout>
        <VideoDetail
          videoId={detailId}
          onBack={() => router.push("/videos")}
        />
      </DashboardLayout>
    );
  }

  /* ---- Render ---- */
  return (
    <DashboardLayout>
      {/* Page header + top bar */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg font-bold text-on-surface">All Videos</h1>
          <p className="mt-1 text-sm text-on-surface-var">Manage and organize your video library</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="inline-flex items-center gap-1.5 rounded-btn border border-on-surface/15 bg-surface-card px-3.5 py-2 text-sm text-on-surface-var transition hover:bg-surface-low">
            <span className="material-symbols-outlined text-[16px]">filter_list</span>
            Filter
          </button>
          <button
            onClick={() => setUploadOpen(true)}
            className="inline-flex items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] transition-all"
            style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))" }}
          >
            <span className="material-symbols-outlined text-[18px]">upload</span>
            + Upload Video
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-56">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-var/50">search</span>
          <input
            type="text"
            placeholder="Search videos..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-btn border border-on-surface/15 bg-surface-card py-2 pl-9 pr-3 text-sm text-on-surface placeholder-on-surface-var/50 focus:ring-2 focus:ring-primary/30 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-btn border border-on-surface/15 bg-surface-card px-3 py-2 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="error">Error</option>
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
          className="rounded-btn border border-on-surface/15 bg-surface-card px-3 py-2 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 focus:outline-none"
        >
          <option value="newest">Newest First</option>
          <option value="oldest">Oldest First</option>
          <option value="title">Title A-Z</option>
          <option value="views">Most Views</option>
        </select>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center gap-4 rounded-btn border border-on-surface/15 bg-surface-card px-4 py-2">
          <span className="text-sm text-on-surface-var">
            {selected.size} selected
          </span>
          <button
            onClick={() => setMigrateOpen(true)}
            className="rounded-btn border border-tertiary/30 bg-tertiary/10 px-3 py-1 text-xs font-medium text-tertiary hover:bg-tertiary/20 transition-colors"
          >
            Migrate Storage
          </button>
          <button
            onClick={() => setBulkDeleteOpen(true)}
            className="rounded-btn border border-error/30 bg-error/10 px-3 py-1 text-xs font-medium text-error hover:bg-error/20 transition-colors"
          >
            Delete Selected
          </button>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : videos.length === 0 ? (
        <p className="py-20 text-center text-sm text-on-surface-var">
          No videos found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card bg-white shadow-card">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-on-surface/8">
                <th className="w-12 py-4 pl-5 pr-2">
                  <input
                    type="checkbox"
                    checked={
                      videos.length > 0 && selected.size === videos.length
                    }
                    onChange={toggleAll}
                    className="accent-primary h-[15px] w-[15px]"
                  />
                </th>
                <th className="py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">Video</th>
                <th className="hidden py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var sm:table-cell">Status</th>
                <th className="hidden py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var sm:table-cell">Storage</th>
                <th className="hidden py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var md:table-cell">Duration</th>
                <th className="hidden py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var md:table-cell">Views</th>
                <th className="hidden py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var lg:table-cell">Size</th>
                <th className="hidden py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var lg:table-cell">Date</th>
                <th className="py-4 px-4 text-[11px] font-bold uppercase tracking-[.1em] text-on-surface-var">Actions</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((video, idx) => (
                <tr
                  key={video.id}
                  className={`transition-colors hover:bg-surface/80 ${idx < videos.length - 1 ? "border-b border-on-surface/6" : ""}`}
                >
                  <td className="py-4 pl-5 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(video.id)}
                      onChange={() => toggleSelect(video.id)}
                      className="accent-primary h-[15px] w-[15px]"
                    />
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3.5">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-white"
                        style={{ background: video.status === "error" ? "#d32f2f" : "linear-gradient(135deg, #5b5a8b, #755478)" }}
                      >
                        <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>play_arrow</span>
                      </div>
                      <div>
                        <button
                          onClick={() => router.push(`/videos?id=${video.id}`)}
                          className="font-semibold text-on-surface hover:text-primary hover:underline text-left text-[13.5px] leading-tight"
                        >
                          {video.title}
                        </button>
                        <div className="text-[10.5px] text-on-surface-var/50 mt-0.5 font-mono">vid_{video.id.slice(0, 5)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden py-4 px-4 sm:table-cell">
                    {video.status === "processing" ? (
                      <span className="inline-flex items-center gap-2 text-[13px] font-medium text-[#e8a817]">
                        <span className="h-2 w-2 rounded-full bg-[#e8a817]" />
                        processing
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-2 text-[13px] font-medium ${
                        video.status === "ready" ? "text-[#2e7d32]" : video.status === "error" ? "text-error" : "text-on-surface-var"
                      }`}>
                        <span className={`h-2 w-2 rounded-full ${
                          video.status === "ready" ? "bg-[#2e7d32]" : video.status === "error" ? "bg-error" : "bg-on-surface-var"
                        }`} />
                        {video.status}
                      </span>
                    )}
                  </td>
                  <td className="hidden py-4 px-4 sm:table-cell">
                    <StorageIcon type={video.storage_type} />
                  </td>
                  <td className="hidden py-4 px-4 text-[13.5px] text-on-surface-var font-mono md:table-cell">
                    {formatDuration(video.duration)}
                  </td>
                  <td className="hidden py-4 px-4 text-[13.5px] text-on-surface-var font-mono md:table-cell">
                    {(video.views_count ?? 0).toLocaleString()}
                  </td>
                  <td className="hidden py-4 px-4 text-[13.5px] text-on-surface-var font-mono lg:table-cell">
                    {formatSize(video.file_size)}
                  </td>
                  <td className="hidden py-4 px-4 text-[13.5px] text-on-surface-var lg:table-cell">
                    {new Date(video.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" })}
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setEditVideo(video)}
                        className="text-[13px] font-medium text-primary transition hover:text-primary-dim hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(video)}
                        className="text-[13px] font-bold text-error transition hover:underline"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => copyEmbed(video)}
                        className="text-[13px] font-medium text-on-surface transition hover:text-primary hover:underline"
                      >
                        Embed
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-on-surface-var">
            Page {page} of {totalPages} ({total} videos)
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-btn border border-on-surface/15 bg-surface-card px-3 py-1.5 text-sm text-on-surface-var transition hover:bg-surface-low disabled:opacity-40"
            >
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(
                (p) =>
                  p === 1 ||
                  p === totalPages ||
                  (p >= page - 1 && p <= page + 1)
              )
              .reduce<(number | "...")[]>((acc, p, i, arr) => {
                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((p, idx) =>
                p === "..." ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-2 py-1.5 text-sm text-on-surface-var"
                  >
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                      page === p
                        ? "border-primary bg-gradient-to-r from-primary to-primary-dim text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)]"
                        : "border-on-surface/15 bg-surface-card text-on-surface-var hover:bg-surface-low"
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-btn border border-on-surface/15 bg-surface-card px-3 py-1.5 text-sm text-on-surface-var transition hover:bg-surface-low disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  UPLOAD MODAL                                                 */}
      {/* ============================================================ */}
      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            fetchVideos();
            showToast("Video uploaded successfully");
          }}
        />
      )}

      {/* ============================================================ */}
      {/*  EDIT MODAL                                                   */}
      {/* ============================================================ */}
      {editVideo && (
        <EditModal
          video={editVideo}
          folders={folders}
          onClose={() => setEditVideo(null)}
          onSaved={() => {
            setEditVideo(null);
            fetchVideos();
            showToast("Video updated");
          }}
        />
      )}

      {/* ============================================================ */}
      {/*  DELETE CONFIRM MODAL                                         */}
      {/* ============================================================ */}
      {deleteTarget && (
        <ConfirmModal
          title="Delete Video"
          message={`Are you sure you want to delete "${deleteTarget.title}"? This action cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => handleDelete(deleteTarget.id)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Migration modal */}
      {migrateOpen && (
        <MigrateModal
          count={selected.size}
          onConfirm={handleMigrate}
          onCancel={() => setMigrateOpen(false)}
        />
      )}

      {/* Migration running banner */}
      {migrating && (
        <div className="fixed bottom-16 right-6 z-[60] flex items-center gap-3 rounded-btn bg-tertiary px-4 py-3 text-sm text-white shadow-lg">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Migrating videos...
        </div>
      )}

      {bulkDeleteOpen && (
        <ConfirmModal
          title="Delete Selected Videos"
          message={`Are you sure you want to delete ${selected.size} video(s)? This action cannot be undone.`}
          confirmLabel="Delete All"
          onConfirm={handleBulkDelete}
          onCancel={() => setBulkDeleteOpen(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] animate-fade-in rounded-btn bg-surface-card px-4 py-3 text-sm text-on-surface shadow-lg border border-on-surface/10">
          {toast}
        </div>
      )}
    </DashboardLayout>
  );
}

/* ================================================================== */
/*  UPLOAD MODAL                                                       */
/* ================================================================== */

function UploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageType, setStorageType] = useState<"local" | "r2">("local");
  const [r2Configured, setR2Configured] = useState(false);

  useEffect(() => {
    api
      .get<{ r2_configured: boolean }>("/settings/storage/usage")
      .then((data) => setR2Configured(data.r2_configured))
      .catch(() => {});
  }, []);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFile(files[0]);
    setError(null);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setProgress(0);

    const formData = new FormData();
    formData.append("video", file);
    formData.append("storage_type", storageType);

    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/videos/upload");
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(xhr.statusText || "Upload failed"));
        };
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(formData);
      });

      onUploaded();
    } catch (err: any) {
      setError(err?.message ?? "Upload failed");
      setUploading(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-[480px] rounded-[16px] bg-white p-7 shadow-[0_24px_80px_rgba(0,0,0,0.18),0_0_1px_rgba(0,0,0,0.08)]">
        <h3 className="text-[17px] font-extrabold text-on-surface">Upload Video</h3>
        <p className="mt-1 mb-6 text-[13px] text-on-surface-var">Add a new video to your archive</p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          className={`mb-6 flex cursor-pointer flex-col items-center justify-center rounded-[12px] border-[2.5px] border-dashed px-6 py-12 text-center transition ${
            dragging
              ? "border-primary bg-primary/10"
              : "border-on-surface/15 bg-surface hover:border-primary/40 hover:bg-primary/5"
          }`}
        >
          <span className="mb-3 text-[40px] leading-none">📁</span>
          {file ? (
            <p className="text-[14px] font-semibold text-on-surface">{file.name}</p>
          ) : (
            <>
              <p className="text-[14px] font-semibold text-on-surface">
                Drag & drop a video file here, or click to browse
              </p>
              <p className="mt-1.5 text-[12px] text-on-surface-var">
                MP4, WebM, MOV, AVI supported
              </p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="video/*,.mp4,.webm,.mov,.avi,.mkv"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Storage Destination */}
        <div className="mb-6">
          <span className="mb-3 block text-[13px] font-bold text-on-surface">Storage Destination</span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStorageType("local")}
              className={`flex items-center gap-3 rounded-[10px] border-2 px-5 py-3.5 text-left transition-all ${
                storageType === "local"
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-on-surface/10 bg-transparent hover:border-on-surface/25"
              }`}
            >
              <div className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                storageType === "local" ? "border-primary bg-primary" : "border-on-surface/25"
              }`}>
                {storageType === "local" && <div className="h-[6px] w-[6px] rounded-full bg-white" />}
              </div>
              <span className="text-[13px] font-semibold text-on-surface">Local Server</span>
            </button>
            <button
              type="button"
              onClick={() => r2Configured && setStorageType("r2")}
              className={`flex items-center gap-3 rounded-[10px] border-2 px-5 py-3.5 text-left transition-all ${
                !r2Configured
                  ? "cursor-not-allowed border-on-surface/8 opacity-50"
                  : storageType === "r2"
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-on-surface/10 bg-transparent hover:border-on-surface/25"
              }`}
              title={!r2Configured ? "Configure R2 credentials in Settings first" : undefined}
            >
              <div className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                storageType === "r2" ? "border-primary bg-primary" : "border-on-surface/20"
              }`}>
                {storageType === "r2" && <div className="h-[6px] w-[6px] rounded-full bg-white" />}
              </div>
              <div>
                <span className="text-[13px] font-semibold text-on-surface">Cloudflare R2</span>
                {!r2Configured && (
                  <div className="text-[10.5px] text-on-surface-var">Not configured</div>
                )}
              </div>
            </button>
          </div>
        </div>

        {/* Progress */}
        {uploading && (
          <div className="mb-5">
            <div className="mb-1.5 flex items-center justify-between text-xs text-on-surface-var">
              <span>Uploading...</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-low">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="mb-3 text-sm text-error">{error}</p>}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={uploading}
            className="rounded-btn px-5 py-2.5 text-[13px] font-bold text-on-surface-var transition hover:bg-surface-low hover:text-on-surface disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={upload}
            disabled={!file || uploading}
            className="rounded-btn px-6 py-2.5 text-[13px] font-bold text-white transition-all disabled:opacity-40"
            style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 4px 14px rgba(91,90,139,0.3)" }}
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ================================================================== */
/*  EDIT MODAL                                                         */
/* ================================================================== */

function EditModal({
  video,
  folders,
  onClose,
  onSaved,
}: {
  video: Video;
  folders: Folder[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [visibility, setVisibility] = useState(video.visibility ?? "public");
  const [tagsInput, setTagsInput] = useState((video.tags ?? []).join(", "));
  const [folderId, setFolderId] = useState(video.folder_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/videos/${video.id}`, {
        title,
        description,
        visibility,
        tags: tagsInput
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        folder_id: folderId || null,
      });
      onSaved();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save");
      setSaving(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-lg rounded-card bg-surface-card p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-on-surface">Edit Video</h3>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-sm text-on-surface-var">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border-0 bg-surface-low px-3 py-2.5 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm text-on-surface-var">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border-0 bg-surface-low px-3 py-2.5 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 focus:outline-none"
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="mb-1 block text-sm text-on-surface-var">
              Visibility
            </label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              className="w-full rounded-lg border-0 bg-surface-low px-3 py-2.5 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 focus:outline-none"
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-sm text-on-surface-var">
              Tags (comma separated)
            </label>
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. tutorial, demo, product"
              className="w-full rounded-btn border-0 bg-surface-low px-3 py-2.5 text-sm text-on-surface placeholder-on-surface-var/50 focus:ring-2 focus:ring-primary/30 focus:outline-none"
            />
          </div>

          {/* Folder */}
          <div>
            <label className="mb-1 block text-sm text-on-surface-var">Folder</label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="w-full rounded-lg border-0 bg-surface-low px-3 py-2.5 text-sm text-on-surface focus:ring-2 focus:ring-primary/30 focus:outline-none"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-error">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-btn border border-on-surface/15 px-4 py-2 text-sm text-on-surface-var transition hover:bg-surface-low disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className="rounded-btn bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-sm font-medium text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] transition-all disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ================================================================== */
/*  CONFIRM MODAL                                                      */
/* ================================================================== */

function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm();
    setLoading(false);
  };

  return (
    <Overlay onClose={onCancel}>
      <div className="w-full max-w-sm rounded-card bg-surface-card p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-semibold text-on-surface">{title}</h3>
        <p className="mb-6 text-sm text-on-surface-var">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-btn border border-on-surface/15 px-4 py-2 text-sm text-on-surface-var transition hover:bg-surface-low disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="rounded-btn bg-error px-4 py-2 text-sm font-medium text-white transition hover:bg-error/80 disabled:opacity-40"
          >
            {loading ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ================================================================== */
/*  MIGRATE MODAL                                                      */
/* ================================================================== */

function MigrateModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: (direction: string, deleteSource: boolean, skipMigrated: boolean) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<"local-to-r2" | "r2-to-local">("local-to-r2");
  const [deleteSource, setDeleteSource] = useState(true);
  const [skipMigrated, setSkipMigrated] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    await onConfirm(direction, deleteSource, skipMigrated);
    setLoading(false);
  };

  return (
    <Overlay onClose={onCancel}>
      <div className="w-full max-w-md rounded-card bg-surface-card p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-semibold text-on-surface">Migrate Storage</h3>
        <p className="mb-5 text-sm text-on-surface-var">
          Migrate {count} selected video(s) between storage backends.
        </p>

        {/* Direction */}
        <div className="mb-4">
          <span className="mb-2 block text-sm font-medium text-on-surface-var">Direction</span>
          <div className="flex gap-3">
            {([
              { value: "local-to-r2" as const, label: "Local \u2192 R2" },
              { value: "r2-to-local" as const, label: "R2 \u2192 Local" },
            ]).map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors ${
                  direction === opt.value
                    ? "border-tertiary bg-tertiary/10 text-tertiary"
                    : "border-on-surface/15 bg-surface-low text-on-surface-var hover:border-on-surface/30"
                }`}
              >
                <input
                  type="radio"
                  name="migDirection"
                  value={opt.value}
                  checked={direction === opt.value}
                  onChange={() => setDirection(opt.value)}
                  className="accent-tertiary"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="mb-5 space-y-2">
          <label className="flex items-center gap-2 text-sm text-on-surface-var">
            <input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} className="accent-tertiary" />
            Delete source files after successful migration
          </label>
          <label className="flex items-center gap-2 text-sm text-on-surface-var">
            <input type="checkbox" checked={skipMigrated} onChange={(e) => setSkipMigrated(e.target.checked)} className="accent-tertiary" />
            Skip already-migrated videos
          </label>
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-btn border border-on-surface/15 px-4 py-2 text-sm text-on-surface-var transition hover:bg-surface-low disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className="rounded-btn bg-tertiary px-4 py-2 text-sm font-medium text-white transition hover:bg-tertiary/80 disabled:opacity-40"
          >
            {loading ? "Starting..." : "Start Migration"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/* ================================================================== */
/*  OVERLAY                                                            */
/* ================================================================== */

function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(120,120,140,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
      {/* backdrop click */}
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
