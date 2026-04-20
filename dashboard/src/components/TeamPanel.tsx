"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Reusable Team management panel — renders the member list, invite/edit/reset/remove
 * modals, and the toast. Used both by the standalone /team route and by the Team
 * tab inside Settings. Has no knowledge of DashboardLayout; embed it as-is.
 */

interface Member {
  id: number;
  email: string;
  display_name: string | null;
  role: "owner" | "admin" | "editor";
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  invited_by: number | null;
  totp_enabled?: boolean;
}

interface MeResponse {
  admin?: { id: number; role: "owner" | "admin" | "editor" };
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function roleBadgeStyle(role: string): React.CSSProperties {
  if (role === "owner") return { background: "rgba(91,90,139,0.12)", color: "rgb(var(--primary-rgb))" };
  if (role === "admin") return { background: "rgba(16,185,129,0.14)", color: "#047857" };
  return { background: "rgba(59,130,246,0.12)", color: "#1d4ed8" };
}

function avatarColor(role: string): { bg: string; fg: string } {
  if (role === "owner") return { bg: "#ede9fe", fg: "#6d28d9" };
  if (role === "admin") return { bg: "#d1fae5", fg: "#065f46" };
  return { bg: "#dbeafe", fg: "#1e40af" };
}

function initials(name: string | null, email: string): string {
  const source = (name || email || "?").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function absoluteTime(iso: string | null): string {
  if (!iso) return "Never";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function TeamPanel() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<"owner" | "admin" | "editor">("editor");
  const [myId, setMyId] = useState<number>(0);

  const [teamQuery, setTeamQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editMember, setEditMember] = useState<Member | null>(null);
  const [resetMember, setResetMember] = useState<Member | null>(null);
  const [deleteMember, setDeleteMember] = useState<Member | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [team, me] = await Promise.all([
        api.get<{ members: Member[] }>("/team"),
        api.get<MeResponse>("/auth/me"),
      ]);
      setMembers(team.members ?? []);
      if (me.admin) {
        setMyRole(me.admin.role);
        setMyId(me.admin.id);
      }
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      if (err.status !== 401) {
        showToast(err.message ?? "Failed to load team", "error");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canInvite = myRole === "owner" || myRole === "admin";
  const canEditMember = (m: Member) => {
    if (m.id === myId) return true;
    if (myRole === "owner") return true;
    if (myRole === "admin" && m.role === "editor") return true;
    return false;
  };
  const canDelete = (m: Member) => myRole === "owner" && m.id !== myId && m.role !== "owner";
  const canResetPassword = (m: Member) => myRole === "owner" && m.id !== myId;

  return (
    <>
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-[10px] px-4 py-3 text-[13px] font-medium shadow-lg"
          style={toast.tone === "success" ? { background: "rgba(46,125,50,0.95)", color: "#fff" } : { background: "#a8364b", color: "#fff" }}
        >
          {toast.message}
        </div>
      )}

      {/* Header row — title/count on the left, search + invite on the right */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-on-surface">Team Members</h3>
          <p className="mt-0.5 text-[12px] text-on-surface-var">
            {members.length} member{members.length !== 1 ? "s" : ""}
            {!canInvite && " · Read-only (your role can't manage team)"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface-var/55 text-[15px]">search</span>
            <input
              type="text"
              value={teamQuery}
              onChange={(e) => setTeamQuery(e.target.value)}
              placeholder="Search members…"
              className="w-52 rounded-[10px] border border-on-surface/10 bg-white py-2 pl-8 pr-3 text-[12.5px] text-on-surface placeholder-on-surface-var/55 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
            />
          </div>
          {canInvite && (
            <button
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)]"
            >
              <span className="material-symbols-outlined text-[15px]">person_add</span>
              Invite Member
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-on-surface-var/20 border-t-primary" />
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-[10px] bg-[#f9fafb] py-10 text-center text-[13px] text-on-surface-var">No team members yet.</div>
      ) : (() => {
        const q = teamQuery.trim().toLowerCase();
        const visibleMembers = q
          ? members.filter((m) => (m.display_name || "").toLowerCase().includes(q) || m.email.toLowerCase().includes(q) || m.role.includes(q))
          : members;
        if (visibleMembers.length === 0) {
          return <div className="rounded-[10px] bg-[#f9fafb] py-10 text-center text-[13px] text-on-surface-var">No members match “{teamQuery}”.</div>;
        }
        return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th className="pb-2 pr-3 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Member</th>
                <th className="pb-2 pr-3 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Role</th>
                <th className="pb-2 pr-3 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Status</th>
                <th className="pb-2 pr-3 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var">Last Login</th>
                <th className="pb-2 text-[9.5px] font-bold uppercase tracking-[.08em] text-on-surface-var text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((m) => {
                const av = avatarColor(m.role);
                return (
                <tr key={m.id} className="border-t" style={{ borderColor: "rgb(var(--surface-low-rgb))" }}>
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold tabular-nums"
                        style={{ backgroundColor: av.bg, color: av.fg }}
                        aria-hidden
                      >
                        {initials(m.display_name, m.email)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-on-surface">{m.display_name || m.email.split("@")[0]}</span>
                          {m.id === myId && <span className="text-[9.5px] font-bold uppercase tracking-[.05em] text-on-surface-var">(you)</span>}
                        </div>
                        <div className="truncate font-mono text-[11.5px] text-on-surface-var">{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.05em]"
                      style={roleBadgeStyle(m.role)}
                    >
                      {m.role}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <span className="inline-flex items-center gap-1.5 text-[12px]">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.is_active ? "#2e7d32" : "#9e9e9e" }} />
                      <span style={{ color: m.is_active ? "#2e7d32" : "#596064" }}>{m.is_active ? "Active" : "Disabled"}</span>
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-[12px] text-on-surface-var" title={absoluteTime(m.last_login_at)}>{timeAgo(m.last_login_at)}</td>
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-1.5">
                      {canEditMember(m) && (
                        <button onClick={() => setEditMember(m)} className="rounded-[6px] bg-[#f0f4f7] px-2 py-1 text-[11px] font-semibold text-primary hover:bg-[#e3e9ed]">Edit</button>
                      )}
                      {canResetPassword(m) && (
                        <button onClick={() => setResetMember(m)} className="rounded-[6px] bg-[#f0f4f7] px-2 py-1 text-[11px] font-semibold text-primary hover:bg-[#e3e9ed]">Reset Password</button>
                      )}
                      {canDelete(m) && (
                        <button onClick={() => setDeleteMember(m)} className="rounded-[6px] bg-[#fce4ec] px-2 py-1 text-[11px] font-semibold text-error hover:bg-[#f8bbd0]">Remove</button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        );
      })()}

      {inviteOpen && (
        <InviteModal
          myRole={myRole}
          onClose={() => setInviteOpen(false)}
          onDone={(msg) => { setInviteOpen(false); showToast(msg); load(); }}
          onError={(m) => showToast(m, "error")}
        />
      )}
      {editMember && (
        <EditModal
          member={editMember}
          myRole={myRole}
          myId={myId}
          onClose={() => setEditMember(null)}
          onDone={(msg) => { setEditMember(null); showToast(msg); load(); }}
          onError={(m) => showToast(m, "error")}
        />
      )}
      {resetMember && (
        <ResetPasswordModal
          member={resetMember}
          onClose={() => setResetMember(null)}
          onDone={(msg) => { setResetMember(null); showToast(msg); }}
          onError={(m) => showToast(m, "error")}
        />
      )}
      {deleteMember && (
        <DeleteModal
          member={deleteMember}
          onClose={() => setDeleteMember(null)}
          onDone={(msg) => { setDeleteMember(null); showToast(msg); load(); }}
          onError={(m) => showToast(m, "error")}
        />
      )}
    </>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] px-4">
      <div className="w-full max-w-[460px] rounded-[16px] bg-white p-6 shadow-[0_24px_80px_rgba(0,0,0,.2)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-extrabold text-on-surface">{title}</h3>
          <button onClick={onClose} className="text-on-surface-var hover:text-on-surface">
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        <div className="mt-6 flex justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[.12em] text-[#6b7280]">{label}</span>
      {children}
    </label>
  );
}

const inputClass = "w-full rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-2.5 text-[13px] text-[#1e1e2f] focus:ring-2 focus:ring-primary/15 focus:outline-none";

function InviteModal({ myRole, onClose, onDone, onError }: { myRole: string; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [email, setEmail] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "editor">("editor");
  const [sendEmail, setSendEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!email || !password) { onError("Username and password are required"); return; }
    if (password.length < 8) { onError("Password must be at least 8 characters"); return; }
    setSaving(true);
    try {
      const r = await api.post<{ member: Member; email_sent: boolean }>("/team", {
        email, password, user_email: userEmail || email, display_name: displayName || email, role, send_email: sendEmail,
      });
      onDone(r.email_sent ? `Invited ${r.member.email} — welcome email sent` : `Invited ${r.member.email}`);
    } catch (e: unknown) {
      const err = e as { message?: string };
      onError(err.message ?? "Invite failed");
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title="Invite Team Member"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-[10px] bg-[#f0f4f7] px-4 py-2 text-[12.5px] font-semibold text-on-surface-var hover:bg-[#e3e9ed]">Cancel</button>
          <button onClick={submit} disabled={saving} className="rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50">
            {saving ? "Inviting..." : "Send Invite"}
          </button>
        </>
      }
    >
      <Field label="Login Username / Email"><input type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className={inputClass} autoFocus /></Field>
      <Field label="Display Name"><input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane Doe" className={inputClass} /></Field>
      <Field label="Initial Password"><input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={inputClass} /></Field>
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "editor")} className={inputClass} disabled={myRole !== "owner"}>
          <option value="editor">Editor — manage videos, folders, analytics</option>
          {myRole === "owner" && <option value="admin">Admin — all of editor + team + settings</option>}
        </select>
        {myRole !== "owner" && <p className="mt-1 text-[11px] text-on-surface-var">Only the owner can create admins.</p>}
      </Field>
      <Field label="Send welcome email (optional)"><input type="email" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} placeholder="user@example.com (leave blank to skip)" className={inputClass} /></Field>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4 accent-primary" />
        <span className="text-[12px] text-on-surface">Send welcome email with login credentials (requires SMTP configured)</span>
      </label>
    </ModalShell>
  );
}

function EditModal({ member, myRole, myId, onClose, onDone, onError }: { member: Member; myRole: string; myId: number; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [displayName, setDisplayName] = useState(member.display_name || "");
  const [role, setRole] = useState(member.role);
  const [isActive, setIsActive] = useState(member.is_active);
  const [saving, setSaving] = useState(false);

  const ownerEditing = myRole === "owner";
  const isSelf = member.id === myId;

  const submit = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { display_name: displayName };
      if (ownerEditing && role !== "owner") body.role = role;
      if (ownerEditing && !isSelf) body.is_active = isActive;
      await api.put(`/team/${member.id}`, body);
      onDone("Member updated");
    } catch (e: unknown) {
      const err = e as { message?: string };
      onError(err.message ?? "Update failed");
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title={`Edit ${member.display_name || member.email}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-[10px] bg-[#f0f4f7] px-4 py-2 text-[12.5px] font-semibold text-on-surface-var hover:bg-[#e3e9ed]">Cancel</button>
          <button onClick={submit} disabled={saving} className="rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </>
      }
    >
      <Field label="Display Name"><input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputClass} autoFocus /></Field>
      <Field label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value as Member["role"])} disabled={!ownerEditing || member.role === "owner"} className={inputClass}>
          {member.role === "owner" && <option value="owner">Owner (read-only)</option>}
          <option value="admin">Admin</option>
          <option value="editor">Editor</option>
        </select>
        {!ownerEditing && <p className="mt-1 text-[11px] text-on-surface-var">Only the owner can change roles.</p>}
      </Field>
      {ownerEditing && !isSelf && member.role !== "owner" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 accent-primary" />
          <span className="text-[12px] text-on-surface">Account active (uncheck to disable login)</span>
        </label>
      )}
    </ModalShell>
  );
}

function ResetPasswordModal({ member, onClose, onDone, onError }: { member: Member; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (pw.length < 8) { onError("Password must be at least 8 characters"); return; }
    setSaving(true);
    try {
      await api.post(`/team/${member.id}/reset-password`, { new_password: pw });
      onDone(`Password reset for ${member.email}`);
    } catch (e: unknown) {
      const err = e as { message?: string };
      onError(err.message ?? "Reset failed");
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title={`Reset Password — ${member.email}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-[10px] bg-[#f0f4f7] px-4 py-2 text-[12.5px] font-semibold text-on-surface-var hover:bg-[#e3e9ed]">Cancel</button>
          <button onClick={submit} disabled={saving} className="rounded-[10px] bg-gradient-to-r from-primary to-primary-dim px-4 py-2 text-[12.5px] font-semibold text-white shadow-[0_2px_8px_rgba(91,90,139,0.3)] hover:shadow-[0_4px_12px_rgba(91,90,139,0.4)] disabled:opacity-50">
            {saving ? "Resetting..." : "Set Password"}
          </button>
        </>
      }
    >
      <Field label="New Password"><input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 8 characters" className={inputClass} autoFocus /></Field>
      <p className="text-[12px] text-on-surface-var">Share the new password with the member through a secure channel. They should change it on first login.</p>
    </ModalShell>
  );
}

function DeleteModal({ member, onClose, onDone, onError }: { member: Member; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await api.delete(`/team/${member.id}`);
      onDone(`Removed ${member.email}`);
    } catch (e: unknown) {
      const err = e as { message?: string };
      onError(err.message ?? "Delete failed");
    } finally { setSaving(false); }
  };

  return (
    <ModalShell
      title={`Remove ${member.display_name || member.email}?`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-[10px] bg-[#f0f4f7] px-4 py-2 text-[12.5px] font-semibold text-on-surface-var hover:bg-[#e3e9ed]">Cancel</button>
          <button onClick={submit} disabled={saving} className="rounded-[10px] bg-[#fce4ec] px-4 py-2 text-[12.5px] font-semibold text-error hover:bg-[#f8bbd0] disabled:opacity-50">
            {saving ? "Removing..." : "Remove"}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-on-surface">
        This will revoke <span className="font-mono font-semibold">{member.email}</span>&apos;s access to the dashboard. Their audit-log history is preserved.
      </p>
    </ModalShell>
  );
}
