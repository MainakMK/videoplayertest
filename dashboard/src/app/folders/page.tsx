"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import DashboardLayout from "@/components/DashboardLayout";
import { useRouter } from "next/navigation";

interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
  video_count: number;
  total_size?: number;
  created_at: string;
}

const FOLDER_COLORS = [
  { icon: "#5b5a8b", bar: "#5b5a8b", bg: "#eeedf5" },
  { icon: "#c2185b", bar: "#e991b6", bg: "#fce4ec" },
  { icon: "#1976d2", bar: "#64b5f6", bg: "#e3f2fd" },
  { icon: "#ef6c00", bar: "#ffb74d", bg: "#fff3e0" },
  { icon: "#2e7d32", bar: "#81c784", bg: "#e8f5e9" },
  { icon: "#6a1b9a", bar: "#ba68c8", bg: "#f3e5f5" },
];

function getFolderColor(index: number) {
  return FOLDER_COLORS[index % FOLDER_COLORS.length];
}

function formatBytes(bytes: number | undefined) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function FoldersPage() {
  const router = useRouter();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  // Create folder modal
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  // Rename modal
  const [showRename, setShowRename] = useState(false);
  const [renameFolder, setRenameFolder] = useState<Folder | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete confirmation
  const [showDelete, setShowDelete] = useState(false);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<Folder | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ folder: Folder; x: number; y: number } | null>(null);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchFolders = useCallback(async () => {
    try {
      const data = await api.get<Folder[]>("/folders");
      setFolders(data);
    } catch {
      showToast("Failed to load folders", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    try {
      await api.post("/folders", {
        name: newFolderName.trim(),
        parent_id: newFolderParent,
      });
      showToast("Folder created");
      setShowCreate(false);
      setNewFolderName("");
      setNewFolderParent(null);
      fetchFolders();
    } catch {
      showToast("Failed to create folder", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleRenameFolder = async () => {
    if (!renameName.trim() || !renameFolder) return;
    setRenaming(true);
    try {
      await api.put(`/folders/${renameFolder.id}`, { name: renameName.trim() });
      showToast("Folder renamed");
      setShowRename(false);
      setRenameFolder(null);
      setRenameName("");
      fetchFolders();
    } catch {
      showToast("Failed to rename folder", "error");
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/folders/${deleteFolderTarget.id}`);
      showToast("Folder deleted");
      setShowDelete(false);
      setDeleteFolderTarget(null);
      fetchFolders();
    } catch {
      showToast("Failed to delete folder", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 rounded-btn px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "success"
              ? "bg-success text-white"
              : "bg-error text-white"
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Page header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-on-surface">Folders</h1>
          <p className="mt-1 text-sm text-on-surface-var">Organize your content into collections</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-btn px-4 py-2 text-sm font-medium text-white transition-all"
          style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 2px 8px rgba(91,90,139,0.3)" }}
        >
          <span className="material-symbols-outlined text-[18px]">create_new_folder</span>
          New Folder
        </button>
      </div>

      {/* Folder grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface/15 border-t-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {folders.map((folder, idx) => {
            const color = getFolderColor(idx);
            return (
              <div
                key={folder.id}
                className="group relative cursor-pointer rounded-card bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:shadow-card"
                onClick={() => router.push(`/videos?folder_id=${folder.id}`)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ folder, x: e.clientX, y: e.clientY });
                }}
              >
                {/* Folder icon */}
                <div
                  className="mb-5 flex h-10 w-10 items-center justify-center rounded-[10px]"
                  style={{ backgroundColor: color.bg }}
                >
                  <span
                    className="material-symbols-outlined text-[22px]"
                    style={{ color: color.icon, fontVariationSettings: "'FILL' 1" }}
                  >
                    folder
                  </span>
                </div>

                {/* Folder info */}
                <h3 className="text-[15px] font-bold text-on-surface">{folder.name}</h3>
                <p className="mt-1 text-[12.5px] text-on-surface-var">
                  {folder.video_count} video{folder.video_count !== 1 ? "s" : ""}
                  {folder.total_size ? ` \u00B7 ${formatBytes(folder.total_size)}` : ""}
                </p>

                {/* Color bar */}
                <div className="mt-4 h-[3px] w-full rounded-full bg-on-surface/6">
                  <div
                    className="h-full rounded-full"
                    style={{
                      backgroundColor: color.bar,
                      width: `${Math.min(100, Math.max(15, folder.video_count * 20))}%`,
                    }}
                  />
                </div>

                {/* Hover actions */}
                <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenameFolder(folder);
                      setRenameName(folder.name);
                      setShowRename(true);
                    }}
                    className="rounded-md p-1.5 text-on-surface-var transition hover:bg-on-surface/5 hover:text-on-surface"
                    title="Rename"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteFolderTarget(folder);
                      setShowDelete(true);
                    }}
                    className="rounded-md p-1.5 text-on-surface-var transition hover:bg-error/10 hover:text-error"
                    title="Delete"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            );
          })}

          {/* New Folder card */}
          <button
            onClick={() => setShowCreate(true)}
            className="flex cursor-pointer flex-col items-center justify-center rounded-card border-[2.5px] border-dashed border-on-surface/15 bg-transparent px-5 py-10 text-center transition-all hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="mb-2 text-[24px] leading-none text-on-surface-var/50">+</span>
            <span className="text-[13px] font-medium text-on-surface-var">New Folder</span>
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-[10px] bg-white py-1.5 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-on-surface transition hover:bg-surface-low"
            onClick={() => {
              router.push(`/videos?folder_id=${contextMenu.folder.id}`);
              setContextMenu(null);
            }}
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            Open
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-on-surface transition hover:bg-surface-low"
            onClick={() => {
              setRenameFolder(contextMenu.folder);
              setRenameName(contextMenu.folder.name);
              setShowRename(true);
              setContextMenu(null);
            }}
          >
            <span className="material-symbols-outlined text-[16px]">edit</span>
            Rename
          </button>
          <button
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-error transition hover:bg-error/5"
            onClick={() => {
              setDeleteFolderTarget(contextMenu.folder);
              setShowDelete(true);
              setContextMenu(null);
            }}
          >
            <span className="material-symbols-outlined text-[16px]">delete</span>
            Delete
          </button>
        </div>
      )}

      {/* Create Folder Modal */}
      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <h3 className="text-[17px] font-extrabold text-on-surface">Create New Folder</h3>
          <p className="mt-1 mb-6 text-[13px] text-on-surface-var">Add a folder to organize your videos</p>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-on-surface">
                Folder Name
              </label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="My Folder"
                className="w-full rounded-[10px] border-0 bg-surface px-4 py-3 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12px] font-bold text-on-surface">
                Parent Folder (optional)
              </label>
              <select
                value={newFolderParent ?? ""}
                onChange={(e) =>
                  setNewFolderParent(
                    e.target.value ? parseInt(e.target.value) : null
                  )
                }
                className="w-full rounded-[10px] border-0 bg-surface px-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">None (root level)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-btn px-5 py-2.5 text-[13px] font-bold text-on-surface-var transition hover:bg-surface-low"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || creating}
                className="rounded-btn px-6 py-2.5 text-[13px] font-bold text-white transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 4px 14px rgba(91,90,139,0.3)" }}
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rename Folder Modal */}
      {showRename && renameFolder && (
        <Modal onClose={() => setShowRename(false)}>
          <h3 className="text-[17px] font-extrabold text-on-surface">Rename Folder</h3>
          <p className="mt-1 mb-6 text-[13px] text-on-surface-var">Change the folder name</p>
          <div className="space-y-4">
            <input
              type="text"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              className="w-full rounded-[10px] border-0 bg-surface px-4 py-3 text-sm text-on-surface placeholder-on-surface-var/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleRenameFolder()}
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowRename(false)}
                className="rounded-btn px-5 py-2.5 text-[13px] font-bold text-on-surface-var transition hover:bg-surface-low"
              >
                Cancel
              </button>
              <button
                onClick={handleRenameFolder}
                disabled={!renameName.trim() || renaming}
                className="rounded-btn px-6 py-2.5 text-[13px] font-bold text-white transition-all disabled:opacity-40"
                style={{ background: "linear-gradient(to right, rgb(91,90,139), rgb(79,78,126))", boxShadow: "0 4px 14px rgba(91,90,139,0.3)" }}
              >
                {renaming ? "Renaming..." : "Rename"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {showDelete && deleteFolderTarget && (
        <Modal onClose={() => setShowDelete(false)}>
          <h3 className="text-[17px] font-extrabold text-on-surface">Delete Folder</h3>
          <p className="mt-2 mb-6 text-[13px] text-on-surface-var leading-relaxed">
            Are you sure you want to delete &ldquo;{deleteFolderTarget.name}&rdquo;?
            Videos in this folder will not be deleted, they will be moved to the
            root level.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setShowDelete(false)}
              className="rounded-btn px-5 py-2.5 text-[13px] font-bold text-on-surface-var transition hover:bg-surface-low"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteFolder}
              disabled={deleting}
              className="rounded-btn border border-error/30 bg-error/10 px-5 py-2.5 text-[13px] font-bold text-error transition-colors hover:bg-error/20 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </DashboardLayout>
  );
}

// -----------------------------------------------------------------------
// Modal overlay
// -----------------------------------------------------------------------

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(120,120,140,0.35)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-[440px] rounded-[16px] bg-white p-7 shadow-[0_24px_80px_rgba(0,0,0,0.18),0_0_1px_rgba(0,0,0,0.08)]">
        {children}
      </div>
    </div>
  );
}
