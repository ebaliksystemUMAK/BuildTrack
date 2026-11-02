import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import ErrorBoundary from "../../components/ErrorBoundary"
import { AdminButton, PageIntro, Panel } from "./AdminShell"
import PermissionMatrix from "./PermissionMatrix"
import ReviewQueue from "./ReviewQueue"
import DataRequestsPanel from "./DataRequestsPanel"
import DeleteAccountModal from "./DeleteAccountModal"
import type { AdminPageProps } from "./types"
import Modal from "../../components/Modal"
import DataConfirmModal from "../../components/PrivacyNotice"
import { Skeleton, SkeletonRows } from "../../components/ui/Skeleton"
import { formatDate, formatTime, roleLabel } from "../../lib/admin"
import { requestStatusChip, requestStatusLabel, type AccessRequest, type ApprovalRole, type RequestedRole } from "../../lib/access"
import RegistrationApproval from "./RegistrationApproval"
import { useAuth, type AdminPermission, type AppRole, type Discipline, type Profile, type UserStatus } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { invokeFunction } from "../../lib/functions"
import { supabase } from "../../lib/supabase"
import type { PrivacyScope, SummaryRow } from "../../lib/privacy"
import { useToast } from "../../lib/toast"

const disciplineLabels: Record<Discipline, string> = { civil_structural: "Civil & Structural", architectural: "Architectural", mep: "MEP" }
const permissionLabels: Record<AdminPermission, string> = {
  "users.view": "View users",
  "users.create": "Create users",
  "users.edit": "Edit users",
  "users.approve": "Review access requests",
  "users.disable": "Enable / disable users",
  "users.impersonate": "Log in as user",
  "biometrics.manage": "Biometric registration",
  "projects.manage": "Project management",
  "blueprints.manage": "Blueprint management",
  "photos.manage": "Site photo rules",
}
const statusLabel: Record<UserStatus, string> = { active: "Active", pending: "Pending", rejected: "Rejected", disabled: "Disabled" }
const statusChip: Record<UserStatus, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  disabled: "bg-gray-200 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200",
}
type WhitelistRow = { id: string; email: string; assigned_role: AppRole; discipline: Discipline | null; note: string | null; created_at: string; used_at: string | null }
const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-sm hover:border-brand/50 hover:text-brand-text disabled:opacity-60"
const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9e1f93] to-[#b4329f] px-4 py-2 text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(158,31,147,0.85)] hover:from-[#8a1a80] hover:to-[#a52a92] disabled:opacity-60"

type RequestRow = AccessRequest & { profiles: Pick<Profile, "full_name" | "email" | "phone" | "company" | "position" | "avatar_url" | "role" | "status"> | null }

const initialsOf = (user: Pick<Profile, "full_name" | "email">) =>
  (user.full_name || user.email).split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")

function Avatar({ user, size = 36 }: { user: Pick<Profile, "full_name" | "email" | "avatar_url">; size?: number }) {
  return user.avatar_url ? (
    <img src={user.avatar_url} alt="" referrerPolicy="no-referrer" className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex flex-none items-center justify-center rounded-full bg-brand text-xs font-bold text-white" style={{ width: size, height: size }}>{initialsOf(user)}</span>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-fg">{children || "—"}</dd>
    </div>
  )
}

export default function UserManagement({ onNavigate }: AdminPageProps) {
  const { profile: me, can, startImpersonation } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const isSuper = me?.role === "super_admin"
  type Tab = "users" | "queue" | "requests" | "whitelist" | "permissions"
  const [tab, setTab] = useState<Tab>(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab")
    return wanted === "queue" || wanted === "requests" || wanted === "whitelist" || wanted === "permissions" ? wanted : "users"
  })
  const [waitingIds, setWaitingIds] = useState(0)
  // "Check this information" step with the data privacy notice before personal data is sent (resolves true when confirmed).
  const [dataAsk, setDataAsk] = useState<{ title: string; description?: string; scope: PrivacyScope; rows: SummaryRow[]; confirmLabel: string; resolve: (ok: boolean) => void } | null>(null)
  const askData = (title: string, scope: PrivacyScope, rows: SummaryRow[], confirmLabel: string, description?: string) =>
    new Promise<boolean>((resolve) => setDataAsk({ title, description, scope, rows, confirmLabel, resolve }))
  const answerData = (ok: boolean) => {
    dataAsk?.resolve(ok)
    setDataAsk(null)
  }
  const [users, setUsers] = useState<Profile[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [details, setDetails] = useState<Profile | null>(null)
  const [review, setReview] = useState<RequestRow | null>(null)
  const [edit, setEdit] = useState<Profile | null>(null)
  const [create, setCreate] = useState(false)
  const [permsFor, setPermsFor] = useState<Profile | null>(null)
  const [suspendFor, setSuspendFor] = useState<Profile | null>(null)
  const [deleteFor, setDeleteFor] = useState<Profile | null>(null)
  const [whitelist, setWhitelist] = useState<WhitelistRow[]>([])
  const [addWhitelist, setAddWhitelist] = useState(false)

  const assignable: AppRole[] = isSuper ? ["user", "engineer", "foreman", "client", "project_manager", "admin", "super_admin"] : ["user", "engineer", "foreman", "client", "project_manager"]

  // A viewer may inspect the people and past requests, but the review queue is an action surface.
  // Do not advertise it to an Admin who lacks users.approve; the Edge Function still checks this
  // independently for every request.
  useEffect(() => {
    if (!can("users.approve") && tab === "queue") setTab("users")
  }, [can, tab])

  const load = useCallback(async () => {
    const [people, asks, listed, ids] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("access_requests").select("*, profiles(full_name, email, phone, company, position, avatar_url, role, status)").order("created_at", { ascending: false }),
      supabase.from("whitelisted_emails").select("*").order("created_at", { ascending: false }),
      supabase.from("identity_verifications").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    ])
    setWaitingIds(ids.count ?? 0)
    setWhitelist((listed.data as WhitelistRow[] | null) ?? [])
    if (people.error || asks.error) setLoadError("Could not load users. Check your connection and try again.")
    else setLoadError("")
    setUsers((people.data as Profile[] | null) ?? [])
    setRequests((asks.data as unknown as RequestRow[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pendingRequests = requests.filter((request) => request.status === "pending")
  const pendingUsers = users.filter((user) => user.status === "pending")
  const canManage = (user: Profile) => user.id !== me?.id && (isSuper || (user.role !== "admin" && user.role !== "super_admin"))

  const visible = useMemo(
    () =>
      users.filter((user) => {
        const text = `${user.full_name ?? ""} ${user.email} ${user.company ?? ""} ${user.phone ?? ""} ${user.position ?? ""}`.toLowerCase()
        return text.includes(query.toLowerCase()) && (roleFilter === "all" || user.role === roleFilter) && (statusFilter === "all" || user.status === statusFilter)
      }),
    [users, query, roleFilter, statusFilter],
  )

  // One place for every admin-users call: toast the outcome, reload on success.
  const call = async (body: Record<string, unknown>, success: string): Promise<boolean> => {
    const { error } = await invokeFunction("admin-users", body)
    if (error) {
      toast.error("That did not work", error)
      return false
    }
    toast.success(success)
    await load()
    return true
  }

  // Approve or reject a registration (used by the details dialog and the review queue).
  const decideRegistration = async (user: Profile, action: "approve" | "reject", role: ApprovalRole, note = ""): Promise<void> => {
    const who = user.full_name || user.email
    if (action === "reject" && note.trim().length < 5) {
      toast.error("A reason is required", "Give the person a helpful reason of at least 5 characters.")
      return
    }
    const ok = action === "approve"
      ? await confirm({ title: `Approve ${who} as ${roleLabel[role]}?`, message: "They get access to this role right away and are notified.", confirmLabel: "Approve" })
      : await confirm({ title: `Reject ${who}?`, message: "They will not be able to sign in or use the system. You can reconsider later.", confirmLabel: "Reject", tone: "danger" })
    if (!ok) return
    if (await call({ action, id: user.id, role, note: note.trim() }, action === "approve" ? "User approved" : "User rejected")) setDetails(null)
  }

  // Enabling asks for a confirmation; suspending first asks for a written reason (kept in the audit log and sent to the person), then confirms.
  const toggleEnabled = async (user: Profile) => {
    if (user.status !== "disabled") {
      setDetails(null)
      setSuspendFor(user)
      return
    }
    if (!(await confirm({ title: `Enable ${user.full_name || user.email}?`, message: `They can sign in again as ${user.role ? roleLabel[user.role] : "a basic user"} with the access they had, and a notice is saved for them.`, confirmLabel: "Enable account" }))) return
    if (await call({ action: "set_enabled", id: user.id, enabled: true }, "Account enabled")) setDetails(null)
  }

  const suspend = async (user: Profile, reason: string) => {
    if (!(await confirm({ title: `Suspend ${user.full_name || user.email}?`, message: "They cannot sign in or use any data until an administrator enables the account again. Your reason is recorded in the audit log and saved as a notice for them.", confirmLabel: "Suspend", tone: "danger" }))) return
    if (await call({ action: "set_enabled", id: user.id, enabled: false, reason }, "Account suspended")) setSuspendFor(null)
  }

  const removeWhitelist = async (entry: WhitelistRow) => {
    if (!(await confirm({ title: `Remove ${entry.email}?`, message: `They will no longer get the ${roleLabel[entry.assigned_role]} role automatically. They can still sign up as a basic user.`, confirmLabel: "Remove", tone: "danger" }))) return
    await call({ action: "whitelist_remove", id: entry.id }, "Removed from the whitelist")
  }

  const loginAs = async (user: Profile) => {
    if (!(await confirm({ title: `Sign in as ${user.full_name || user.email}?`, message: "Everything you do is recorded under both names, and a banner lets you return to your own account.", confirmLabel: "Sign in as them" }))) return
    const error = await startImpersonation(user.id)
    if (error) toast.error("Could not sign in as that user", error)
  }

  return (
    <div className="admin-page">
      <PageIntro
        eyebrow="Access control • Admin only"
        title="Users & Access Requests"
        description="Admins with Review access decide Engineer, Foreman, or Client requests. Admin promotion and permissions are Super Admin only."
        action={
          <div className="flex gap-2">
            {can("users.create") ? <AdminButton icon="plus" onClick={() => setCreate(true)}>Create user</AdminButton> : null}
            {can("biometrics.manage") ? <AdminButton variant="outline" icon="users" onClick={() => onNavigate("biometrics")}>Register biometrics</AdminButton> : null}
          </div>
        }
      />

      {loadError ? (
        <div className="mb-3 flex items-center gap-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{loadError}<button className="font-bold underline" onClick={() => void load()}>Retry</button></div>
      ) : null}

      <div className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
        <p className="font-bold">{isSuper ? "Super Admin controls" : "Admin approval scope"}</p>
        <p className="mt-1 text-fg-muted">
          {isSuper
            ? "You can review regular access requests and manage Admin accounts and permissions. You cannot change your own account or permissions here."
            : can("users.approve")
              ? "Admin approval required: you may approve or reject Engineer, Foreman, and Client access only. Admin and Super Admin accounts are restricted."
              : "You can view the people allowed by your permissions. A Super Admin can grant additional access."}
        </p>
      </div>

      <div className="mb-4 flex gap-1 rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="User management sections">
        {(isSuper ? (["users", "queue", "requests", "whitelist", "permissions"] as const) : (["users", "queue", "requests", "whitelist"] as const)).filter((key) => key !== "queue" || can("users.approve")).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted"}`}
          >
            {key === "users" ? `All users (${users.length})` : key === "queue" ? "Review queue" : key === "permissions" ? "Permissions" : key === "requests" ? "Access requests" : `Whitelist (${whitelist.filter((w) => !w.used_at).length})`}
            {key === "queue" && pendingUsers.length + waitingIds ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-black">{pendingUsers.length + waitingIds}</span> : null}
            {key === "requests" && pendingRequests.length ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-black">{pendingRequests.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === "users" && can("users.approve") && pendingUsers.length ? (
        <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent bg-surface px-4 py-3 text-sm">
          <span><strong>{pendingUsers.length} registration{pendingUsers.length === 1 ? "" : "s"} waiting for your decision.</strong> <span className="text-fg-muted">{pendingUsers.filter((user) => !user.registration_completed_at).length ? `${pendingUsers.filter((user) => !user.registration_completed_at).length} have not sent their details yet.` : "Each one shows the access they asked for."}</span></span>
          {statusFilter === "pending" ? <button type="button" className={secondary + " !py-1.5"} onClick={() => setStatusFilter("all")}>Show everyone</button> : <button type="button" className={primary + " !py-1.5"} onClick={() => { setStatusFilter("pending"); setRoleFilter("all"); setQuery("") }}>Review now</button>}
        </div>
      ) : null}

      {tab === "permissions" && isSuper ? <ErrorBoundary compact label="The permission list"><PermissionMatrix admins={users.filter((user) => user.role === "admin")} onSaved={load} /></ErrorBoundary> : null}
      {tab === "queue" ? <ErrorBoundary compact label="Data deletion requests"><DataRequestsPanel users={users} onChanged={load} /></ErrorBoundary> : null}
      {tab === "queue" ? <ErrorBoundary compact label="The review queue"><ReviewQueue users={users} onChanged={load} onDecideRegistration={decideRegistration} /></ErrorBoundary> : null}

      {tab === "users" ? (
        <>
          <Panel className="admin-toolbar-panel">
            <label className="admin-search">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, company, phone or job title..." aria-label="Search users" />
            </label>
            <select className={field + " mt-0 w-auto"} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
              <option value="all">All roles</option>
              {(Object.keys(roleLabel) as AppRole[]).map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}
            </select>
            <select className={field + " mt-0 w-auto"} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              {(Object.keys(statusLabel) as UserStatus[]).map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
            </select>
          </Panel>
          <Panel title="Registered users" action={<span className="admin-panel-note">{loading ? "…" : `${visible.length} shown`}</span>}>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--users">
                <thead>
                  <tr><th>User</th><th>Role</th><th>Registered</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows rows={6} cols={5} />
                  ) : visible.length === 0 ? (
                    <tr><td colSpan={5}>No users match.</td></tr>
                  ) : (
                    visible.map((user) => (
                      <tr key={user.id} className="cursor-pointer hover:bg-surface-muted/60" onClick={() => setDetails(user)}>
                        <td>
                          <div className="user-cell">
                            <Avatar user={user} />
                            <div>
                              <strong>{user.full_name || "(no name)"}</strong>
                              <div className="is-muted">{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>{user.status === "pending" && user.requested_role ? <span>Asked for {roleLabel[user.requested_role]}</span> : user.status === "pending" ? <span className="is-muted">Details not sent yet</span> : user.role ? roleLabel[user.role] : "Unassigned"}</td>
                        <td className="is-muted">{formatDate(user.created_at)}</td>
                        <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusChip[user.status]}`}>{statusLabel[user.status]}</span></td>
                        <td className="text-right">
                          <button type="button" className="rounded-lg border border-line px-3 py-1 text-xs font-semibold hover:bg-surface-muted" onClick={(event) => { event.stopPropagation(); setDetails(user) }}>
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : tab === "whitelist" ? (
        <Panel
          title="Email whitelist"
          action={can("users.approve") ? <button type="button" className={primary + " !py-1.5"} onClick={() => setAddWhitelist(true)}>Add emails</button> : undefined}
        >
          <p className="mb-3 text-sm text-fg-muted">Trusted people on this list get their role automatically as soon as they confirm their email (code or Google). No request and no review. Each entry works once.</p>
          {loading ? (
            <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : whitelist.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">No emails yet. Add the people you already trust and choose their role.</p>
          ) : (
            <ul className="divide-y divide-line">
              {whitelist.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{entry.email}</p>
                    <p className="truncate text-xs text-fg-muted">
                      {roleLabel[entry.assigned_role]}{entry.discipline ? ` • ${disciplineLabels[entry.discipline]}` : ""}{entry.note ? ` • ${entry.note}` : ""} • added {formatDate(entry.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${entry.used_at ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"}`}>
                      {entry.used_at ? `Used ${formatDate(entry.used_at)}` : "Waiting for sign-up"}
                    </span>
                    {!entry.used_at && can("users.approve") && (isSuper || entry.assigned_role !== "admin") ? (
                      <button type="button" className={secondary + " !py-1 !text-danger-fg"} onClick={() => void removeWhitelist(entry)}>Remove</button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : tab === "requests" ? (
        <Panel title="Access requests" action={<span className="admin-panel-note">{pendingRequests.length} waiting</span>}>
          {loading ? (
            <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
          ) : requests.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">No requests yet. When a basic user asks for Engineer, Foreman or Client access, it appears here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {requests.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {request.profiles ? <Avatar user={request.profiles} /> : null}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{request.profiles?.full_name || request.profiles?.email || "Unknown user"}</p>
                      <p className="truncate text-xs text-fg-muted">
                        wants <strong className="text-fg">{roleLabel[request.requested_role]}</strong>
                        {request.discipline ? ` • ${disciplineLabels[request.discipline]}` : ""} • {formatDate(request.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${requestStatusChip[request.status]}`}>{requestStatusLabel[request.status]}</span>
                    {request.status === "pending" && can("users.approve") ? (
                      <button type="button" className={primary + " !py-1.5"} onClick={() => setReview(request)}>Review</button>
                    ) : (
                      <button type="button" className={secondary + " !py-1.5"} onClick={() => setReview(request)}>Details</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      {details ? (
        <UserDetailsModal
          user={users.find((u) => u.id === details.id) ?? details}
          requests={requests.filter((r) => r.user_id === details.id)}
          canEdit={can("users.edit") && canManage(details)}
          canDisable={can("users.disable") && canManage(details) && (details.status === "active" || details.status === "disabled")}
          canDelete={isSuper && canManage(details) && details.role !== "super_admin" && !details.email.endsWith("@erased.invalid")}
          onDelete={() => { const target = details; setDetails(null); setDeleteFor(target) }}
          canImpersonate={can("users.impersonate") && details.status === "active" && details.id !== me?.id && details.role !== "super_admin" && details.role !== "admin"}
          canApproveLegacy={can("users.approve") && canManage(details) && details.status === "pending"}
          canReopen={can("users.approve") && canManage(details) && details.status === "rejected"}
          onReopen={async () => {
            if (!(await confirm({ title: `Reconsider ${details.full_name || details.email}?`, message: "The registration goes back to the waiting list so you can decide again.", confirmLabel: "Reconsider" }))) return
            if (await call({ action: "reopen", id: details.id }, "Back on the waiting list")) setDetails(null)
          }}
          canPermissions={isSuper && details.role === "admin"}
          onClose={() => setDetails(null)}
          onEdit={() => setEdit(details)}
          onToggle={() => void toggleEnabled(details)}
          onLoginAs={() => void loginAs(details)}
          onPermissions={() => setPermsFor(details)}
          onLegacyDecision={(action, role, note) => decideRegistration(details, action, role, note)}
        />
      ) : null}

      {review ? (
        <ReviewRequestModal
          request={review}
          canDecide={can("users.approve") && review.status === "pending"}
          onClose={() => setReview(null)}
          onDecide={async (approve, role, discipline, note) => {
            const who = review.profiles?.full_name || review.profiles?.email || "this user"
            const sure = approve
              ? await confirm({ title: `Approve ${who} as ${roleLabel[role]}?`, message: "They get this role and its access immediately.", confirmLabel: "Approve" })
              : await confirm({ title: `Decline ${who}?`, message: "They stay a basic user and can send a new request later.", confirmLabel: "Decline", tone: "danger" })
            if (!sure) return
            const ok = await call(
              { action: approve ? "approve_request" : "reject_request", request_id: review.id, role, discipline, note },
              approve ? `Approved as ${roleLabel[role]}` : "Request declined",
            )
            if (ok) setReview(null)
          }}
        />
      ) : null}

      {edit ? <EditUserModal user={edit} assignable={assignable} onClose={() => setEdit(null)} onSave={async (body) => {
        if (!(await askData("Save these changes?", "admin_account", [{ label: "Name", value: String(body.full_name ?? "") }, { label: "Phone", value: String(body.phone ?? "") }, { label: "Company", value: String(body.company ?? "") }, { label: "Job title", value: String(body.position ?? "") }, { label: "Role", value: body.role ? roleLabel[body.role as AppRole] : "" }], "Save changes", `You are changing the details of ${edit.email}.`))) return
        if (body.role !== (edit.role ?? "user") && !(await confirm({ title: `Change ${edit.full_name || edit.email} to ${roleLabel[body.role as AppRole]}?`, message: `Their access changes immediately. They are currently ${edit.role ? roleLabel[edit.role] : "unassigned"}.`, confirmLabel: "Change role", tone: "danger" }))) return
        if (await call({ action: "update", id: edit.id, ...body }, "User updated")) { setEdit(null); setDetails(null) }
      }} /> : null}
      {create ? <CreateUserModal assignable={assignable} onClose={() => setCreate(false)} onSave={async (body) => {
        if (!(await askData("Create this account?", "admin_account", [{ label: "Name", value: String(body.full_name ?? "") }, { label: "Email", value: String(body.email ?? "") }, { label: "Phone", value: String(body.phone ?? "") }, { label: "Company", value: String(body.company ?? "") }, { label: "Job title", value: String(body.position ?? "") }, { label: "Role", value: body.role ? roleLabel[body.role as AppRole] : "" }], "Create account", "You are registering another person's details. Make sure they know and agree."))) return
        if ((body.role === "admin" || body.role === "super_admin") && !(await confirm({ title: `Create an ${roleLabel[body.role as AppRole]} account?`, message: "Administrators can manage users and projects. Only continue for someone you fully trust.", confirmLabel: "Create account", tone: "danger" }))) return
        if (await call({ action: "create", ...body }, "User created")) setCreate(false)
      }} /> : null}
      {dataAsk ? <DataConfirmModal title={dataAsk.title} description={dataAsk.description} scope={dataAsk.scope} rows={dataAsk.rows} confirmLabel={dataAsk.confirmLabel} onConfirm={() => answerData(true)} onClose={() => answerData(false)} /> : null}
      {suspendFor ? <SuspendModal user={suspendFor} onClose={() => setSuspendFor(null)} onSuspend={(reason) => suspend(suspendFor, reason)} /> : null}
      {deleteFor ? <DeleteAccountModal user={deleteFor} onClose={() => setDeleteFor(null)} onDone={() => { setDeleteFor(null); void load() }} /> : null}
      {permsFor ? <PermissionsModal user={permsFor} onClose={() => setPermsFor(null)} onSave={async (permissions) => {
        if (!(await confirm({ title: `Save permissions for ${permsFor.full_name || permsFor.email}?`, message: `${permissions.length} permission${permissions.length === 1 ? "" : "s"} will apply immediately.`, confirmLabel: "Save permissions", tone: "danger" }))) return
        if (await call({ action: "set_permissions", id: permsFor.id, permissions }, "Permissions saved")) setPermsFor(null)
      }} /> : null}
      {addWhitelist ? (
        <WhitelistModal
          isSuper={isSuper}
          onClose={() => setAddWhitelist(false)}
          onSave={async (body) => {
            const count = (body.emails as string[]).length
            const listed = body.emails as string[]
            if (!(await askData(`Pre-approve ${count} email${count === 1 ? "" : "s"} as ${roleLabel[body.role as AppRole]}?`, "whitelist", [{ label: "Role", value: roleLabel[body.role as AppRole] }, { label: "Emails", value: listed.slice(0, 6).join(", ") + (listed.length > 6 ? ` and ${listed.length - 6} more` : "") }], "Add to whitelist", "Each person gets this role automatically after confirming their email. Only add people you trust."))) return
            // The server accepts 50 emails per call, so a long list (for example from a CSV file) goes in batches.
            const all = body.emails as string[]
            let added = 0
            let already = 0
            let skipped = 0
            for (let start = 0; start < all.length; start += 50) {
              const { data, error } = await invokeFunction("admin-users", { action: "whitelist_add", ...body, emails: all.slice(start, start + 50) })
              if (error) {
                if (added) await load()
                return toast.error(added ? `Stopped after ${added} email${added === 1 ? "" : "s"}` : "That did not work", error)
              }
              const result = (data ?? {}) as { added?: number; already_listed?: string[]; skipped_admins?: string[] }
              added += result.added ?? 0
              already += result.already_listed?.length ?? 0
              skipped += result.skipped_admins?.length ?? 0
            }
            const extra = [already ? `${already} already listed` : "", skipped ? `${skipped} admin account${skipped === 1 ? "" : "s"} skipped` : ""].filter(Boolean).join(", ")
            toast.success(`Added ${added} email${added === 1 ? "" : "s"}`, extra || undefined)
            await load()
            setAddWhitelist(false)
          }}
        />
      ) : null}
    </div>
  )
}

function SuspendModal({ user, onClose, onSuspend }: { user: Profile; onClose: () => void; onSuspend: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const clean = reason.replace(/\s+/g, " ").trim()
  const ready = clean.length >= 5
  const who = user.full_name || user.email
  return (
    <Modal
      title={`Suspend ${who}`}
      description={user.email}
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={secondary + " !border-danger-fg !text-danger-fg"} disabled={!ready || busy} onClick={async () => { setBusy(true); await onSuspend(clean); setBusy(false) }}>Suspend account</button>
        </>
      }
    >
      <p className="text-sm text-fg-muted">A suspended person cannot sign in or see any data. Their records stay in the system and you can enable the account again at any time.</p>
      <label className="mt-4 block text-sm font-bold" htmlFor="suspend-reason">Reason (required)</label>
      <textarea id="suspend-reason" className={field + " min-h-24"} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="For example: left the company, shared login, request of the project owner" aria-describedby="suspend-reason-help" />
      <p id="suspend-reason-help" className={`mt-1 text-xs ${ready || !reason ? "text-fg-muted" : "text-danger-fg"}`}>{ready || !reason ? `${clean.length}/500. Saved in the audit log and in the notice sent to ${who}.` : "Write at least 5 characters."}</p>
    </Modal>
  )
}

function UserDetailsModal({
  user, requests, canEdit, canDisable, canDelete, canImpersonate, canApproveLegacy, canReopen, canPermissions, onClose, onEdit, onToggle, onDelete, onLoginAs, onPermissions, onLegacyDecision, onReopen,
}: {
  user: Profile
  requests: RequestRow[]
  canEdit: boolean
  canDisable: boolean
  canDelete: boolean
  onDelete: () => void
  canImpersonate: boolean
  canApproveLegacy: boolean
  canReopen: boolean
  canPermissions: boolean
  onClose: () => void
  onEdit: () => void
  onToggle: () => void
  onLoginAs: () => void
  onPermissions: () => void
  onLegacyDecision: (action: "approve" | "reject", role: ApprovalRole, note?: string) => Promise<void>
  onReopen: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [rejectionReason, setRejectionReason] = useState("")
  return (
    <Modal
      title={user.full_name || user.email}
      description={user.email}
      size="lg"
      onClose={onClose}
      footer={
        <>
          {canPermissions ? <button type="button" className={secondary} onClick={onPermissions}>Permissions</button> : null}
          {canImpersonate ? <button type="button" className={secondary} onClick={onLoginAs}>Log in as</button> : null}
          {canReopen ? <button type="button" className={secondary} onClick={() => void onReopen()}>Reconsider</button> : null}
          {canDisable ? <button type="button" className={secondary + (user.status === "active" ? " !text-danger-fg" : "")} onClick={onToggle}>{user.status === "disabled" ? "Re-enable account" : "Suspend account"}</button> : null}
          {canDelete ? <button type="button" className={secondary + " !border-danger-fg !text-danger-fg"} onClick={onDelete}>Delete account</button> : null}
          {canEdit ? <button type="button" className={primary} onClick={onEdit}>Edit user</button> : <button type="button" className={secondary} onClick={onClose}>Close</button>}
        </>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar user={user} size={56} />
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand-text">{user.role ? roleLabel[user.role] : "No role"}</span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusChip[user.status]}`}>{statusLabel[user.status]}</span>
        </div>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <Detail label="Phone">{user.phone}</Detail>
        <Detail label="Company">{user.company}</Detail>
        <Detail label="Job title">{user.position}</Detail>
        <Detail label="Discipline">{user.discipline ? disciplineLabels[user.discipline] : null}</Detail>
        <Detail label="Registered">{`${formatDate(user.created_at)} ${formatTime(user.created_at)}`}</Detail>
        <Detail label="Signed up with">{user.signup_provider === "google" ? "Google" : user.signup_provider === "admin" ? "Created by an administrator" : "Email and password"}</Detail>
        {user.requested_role ? <Detail label="Asked for">{roleLabel[user.requested_role]}</Detail> : null}
      </dl>
      {user.role === "admin" || user.role === "super_admin" ? (
        <p className="mt-5 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-brand-text">
          <strong>Super Admin approval required.</strong> Administrative accounts and their permissions can only be managed by a Super Admin.
        </p>
      ) : null}
      {canApproveLegacy ? (
        <div className="mt-5 rounded-xl border border-line bg-surface-muted/60 p-4">
          <p className="text-sm font-bold">{user.registration_completed_at ? "This registration is waiting for your decision" : "This person has not sent their registration details yet"}</p>
          {user.registration_completed_at ? (
            <>
              <p className="mt-1 text-xs text-fg-muted">Admin approval required. {user.requested_role ? `They asked for ${roleLabel[user.requested_role]} access.` : "They did not say which access they need."} Approving gives that role at once and notifies them; rejecting ends their sessions.</p>
              <div className="mt-3">
                <RegistrationApproval userId={user.id} requested={user.requested_role ?? null} busy={busy} onApprove={async (role) => { setBusy(true); await onLegacyDecision("approve", role); setBusy(false) }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy || rejectionReason.trim().length < 5} className={secondary + " !text-danger-fg"} onClick={async () => { setBusy(true); await onLegacyDecision("reject", "client", rejectionReason); setBusy(false) }}>Reject</button>
              </div>
              <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-fg-muted">Reason required to reject<textarea className={field + " min-h-20"} maxLength={500} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Explain what needs to change or why this registration cannot be approved." /></label>
            </>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy || rejectionReason.trim().length < 5} className={secondary + " !text-danger-fg"} onClick={async () => { setBusy(true); await onLegacyDecision("reject", "client", rejectionReason); setBusy(false) }}>Reject</button>
            </div>
          )}
        </div>
      ) : null}
      {requests.length ? (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-fg-muted">Access requests</h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {requests.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><strong>{roleLabel[request.requested_role]}</strong> <span className="text-fg-muted">• {formatDate(request.created_at)}{request.decision_note ? ` • "${request.decision_note}"` : ""}</span></span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${requestStatusChip[request.status]}`}>{requestStatusLabel[request.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  )
}

function ReviewRequestModal({
  request, canDecide, onClose, onDecide,
}: {
  request: RequestRow
  canDecide: boolean
  onClose: () => void
  onDecide: (approve: boolean, role: RequestedRole, discipline: Discipline | "", note: string) => Promise<void>
}) {
  const [role, setRole] = useState<RequestedRole>(request.requested_role)
  const [discipline, setDiscipline] = useState<Discipline | "">(request.discipline ?? "")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [decisionError, setDecisionError] = useState("")
  const person = request.profiles
  const decide = async (approve: boolean) => {
    if (!approve && note.trim().length < 5) {
      setDecisionError("A reason of at least 5 characters is required when declining a request.")
      return
    }
    setDecisionError("")
    setBusy(true)
    await onDecide(approve, role, discipline, note)
    setBusy(false)
  }
  return (
    <Modal
      title={canDecide ? "Review access request" : "Access request"}
      description={person ? `${person.full_name || person.email} • ${person.email}` : undefined}
      size="lg"
      onClose={busy ? () => undefined : onClose}
      footer={
        canDecide ? (
          <>
            <button type="button" disabled={busy} className={secondary} onClick={onClose}>Close</button>
            <button type="button" disabled={busy} className={secondary + " !text-danger-fg"} onClick={() => void decide(false)}>Decline</button>
            <button type="button" disabled={busy} className={primary} onClick={() => void decide(true)}>{busy ? "Working..." : `Approve as ${roleLabel[role]}`}</button>
          </>
        ) : (
          <button type="button" className={secondary} onClick={onClose}>Close</button>
        )
      }
    >
      <dl className="grid gap-4 sm:grid-cols-2">
        <Detail label="Requested role">{roleLabel[request.requested_role]}</Detail>
        <Detail label="Status">{requestStatusLabel[request.status]}</Detail>
        <Detail label="Company">{person?.company}</Detail>
        <Detail label="Job title">{person?.position}</Detail>
        <Detail label="Phone">{person?.phone}</Detail>
        <Detail label="Sent">{`${formatDate(request.created_at)} ${formatTime(request.created_at)}`}</Detail>
      </dl>
      <div className="mt-4">
        <p className="text-xs font-bold uppercase tracking-wider text-fg-muted">Their message</p>
        <p className="mt-1 whitespace-pre-wrap rounded-xl bg-surface-muted/60 p-3 text-sm">{request.message || "No message."}</p>
      </div>
      {request.decision_note ? <p className="mt-3 text-sm text-fg-muted">Decision note: {request.decision_note}</p> : null}
      {canDecide ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Grant role
            <select className={field} value={role} onChange={(e) => setRole(e.target.value as RequestedRole)}>
              {(["engineer", "foreman", "client"] as RequestedRole[]).map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
            </select>
          </label>
          {role !== "client" ? (
            <label className="block text-sm font-semibold">
              Discipline
              <select className={field} value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline | "")}>
                <option value="">Not set</option>
                {(Object.keys(disciplineLabels) as Discipline[]).map((d) => <option key={d} value={d}>{disciplineLabels[d]}</option>)}
              </select>
            </label>
          ) : null}
          <label className="block text-sm font-semibold sm:col-span-2">
            Note to the user (required to decline)
            <input className={field} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown to them with your decision" />
          </label>
          {decisionError ? <p role="alert" className="sm:col-span-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{decisionError}</p> : null}
        </div>
      ) : null}
    </Modal>
  )
}

function EditUserModal({ user, assignable, onClose, onSave }: { user: Profile; assignable: AppRole[]; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ full_name: user.full_name ?? "", phone: user.phone ?? "", company: user.company ?? "", position: user.position ?? "", role: (user.role ?? "user") as AppRole, discipline: user.discipline ?? "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (form.full_name.trim().length < 2) return setError("Enter the user's full name.")
    setError("")
    setBusy(true)
    await onSave(form)
    setBusy(false)
  }
  return (
    <Modal title="Edit user" description={user.email} onClose={busy ? () => undefined : onClose} footer={<><button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="edit-user-form" className={primary} disabled={busy}>{busy ? "Saving..." : "Save changes"}</button></>}>
      <form id="edit-user-form" className="space-y-3" noValidate onSubmit={(event) => void submit(event)}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        {([["full_name", "Full name *"], ["phone", "Phone"], ["company", "Company"], ["position", "Job title"]] as const).map(([key, label]) => (
          <label key={key} className="block text-sm font-semibold">{label}<input className={field} maxLength={120} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Role
            <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>
              {assignable.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold">Discipline
            <select className={field} value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value as Discipline | "" })}>
              <option value="">None</option>
              {(Object.keys(disciplineLabels) as Discipline[]).map((d) => <option key={d} value={d}>{disciplineLabels[d]}</option>)}
            </select>
          </label>
        </div>
      </form>
    </Modal>
  )
}

function CreateUserModal({ assignable, onClose, onSave }: { assignable: AppRole[]; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ email: "", password: "", full_name: "", role: "user" as AppRole, discipline: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (form.full_name.trim().length < 2) return setError("Enter the full name.")
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setError("Enter a valid email address.")
    if (form.password.length < 10) return setError("The temporary password needs at least 10 characters.")
    setError("")
    setBusy(true)
    await onSave(form)
    setBusy(false)
  }
  return (
    <Modal title="Create user" description="The account is active immediately. Share the temporary password privately." onClose={busy ? () => undefined : onClose} footer={<><button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="create-user-form" className={primary} disabled={busy}>{busy ? "Creating..." : "Create user"}</button></>}>
      <form id="create-user-form" className="space-y-3" noValidate onSubmit={(event) => void submit(event)}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <label className="block text-sm font-semibold">Full name *<input className={field} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></label>
        <label className="block text-sm font-semibold">Email *<input className={field} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label className="block text-sm font-semibold">Temporary password * (10+ characters)<input className={field} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Role
            <select className={field} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>{assignable.map((role) => <option key={role} value={role}>{roleLabel[role]}</option>)}</select>
          </label>
          <label className="block text-sm font-semibold">Discipline
            <select className={field} value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value })}>
              <option value="">None</option>
              {(Object.keys(disciplineLabels) as Discipline[]).map((d) => <option key={d} value={d}>{disciplineLabels[d]}</option>)}
            </select>
          </label>
        </div>
      </form>
    </Modal>
  )
}

function WhitelistModal({ isSuper, onClose, onSave }: { isSuper: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [text, setText] = useState("")
  const [role, setRole] = useState<"engineer" | "foreman" | "client" | "project_manager" | "admin">("engineer")
  const [discipline, setDiscipline] = useState<Discipline | "">("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const emails = useMemo(() => [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))], [text])
  const importFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 512 * 1024) return setError("That file is too large. Use a list of up to 500 emails.")
    const content = await file.text()
    const found = content.match(/[^\s,;"'<>()]+@[^\s,;"'<>()]+\.[^\s,;"'<>()]+/g) ?? []
    if (!found.length) return setError("No email addresses were found in that file.")
    setError("")
    setText((current) => [current.trim(), ...found].filter(Boolean).join("\n"))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!emails.length) return setError("Enter at least one email.")
    const bad = emails.find((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    if (bad) return setError(`"${bad}" is not a valid email.`)
    if (emails.length > 500) return setError("Add at most 500 emails at a time.")
    setError("")
    setBusy(true)
    await onSave({ emails, role, discipline: discipline || undefined, note: note.trim() || undefined })
    setBusy(false)
  }
  return (
    <Modal title="Add to whitelist" description="They get this role as soon as they confirm their email." onClose={busy ? () => undefined : onClose} footer={<><button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="whitelist-form" className={primary} disabled={busy}>{busy ? "Adding..." : `Add ${emails.length || ""} email${emails.length === 1 ? "" : "s"}`}</button></>}>
      <form id="whitelist-form" className="space-y-3" noValidate onSubmit={(event) => void submit(event)}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <label className="block text-sm font-semibold">Emails * (separate with commas, spaces or new lines)
          <textarea className={field + " min-h-24"} value={text} onChange={(e) => setText(e.target.value)} placeholder="maria@company.com, jun@company.com" />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-2 text-sm">
          <span><strong>Import a file</strong> <span className="text-fg-muted">(.csv or .txt, up to 500 emails)</span></span>
          <input type="file" accept=".csv,.txt,text/csv,text/plain" className="max-w-[11rem] text-xs" aria-label="Import emails from a file" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = "" }} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Role
            <select className={field} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              {(["engineer", "foreman", "client", "project_manager"] as const).map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
              {isSuper ? <option value="admin">{roleLabel.admin}</option> : null}
            </select>
          </label>
          {role === "engineer" || role === "foreman" ? (
            <label className="block text-sm font-semibold">Discipline
              <select className={field} value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline | "")}>
                <option value="">Not set</option>
                {(Object.keys(disciplineLabels) as Discipline[]).map((d) => <option key={d} value={d}>{disciplineLabels[d]}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <label className="block text-sm font-semibold">Note (optional)<input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this person is trusted" /></label>
      </form>
    </Modal>
  )
}

function PermissionsModal({ user, onClose, onSave }: { user: Profile; onClose: () => void; onSave: (permissions: AdminPermission[]) => Promise<void> }) {
  const [granted, setGranted] = useState<AdminPermission[] | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from("admin_permissions").select("permission").eq("user_id", user.id).then(({ data }) => setGranted((data ?? []).map((row) => row.permission as AdminPermission)))
  }, [user.id])
  return (
    <Modal title={`Permissions: ${user.full_name || user.email}`} description="Only what you tick is allowed for this admin." onClose={busy ? () => undefined : onClose} footer={<><button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button><button type="button" className={primary} disabled={busy || !granted} onClick={async () => { setBusy(true); await onSave(granted!); setBusy(false) }}>{busy ? "Saving..." : "Save permissions"}</button></>}>
      {granted === null ? (
        <div className="space-y-2"><Skeleton className="h-5 w-48" /><Skeleton className="h-5 w-56" /><Skeleton className="h-5 w-40" /></div>
      ) : (
        <div className="space-y-2">
          {(Object.keys(permissionLabels) as AdminPermission[]).map((permission) => (
            <label key={permission} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={granted.includes(permission)} onChange={(e) => setGranted(e.target.checked ? [...granted, permission] : granted.filter((p) => p !== permission))} />
              {permissionLabels[permission]}
            </label>
          ))}
        </div>
      )}
    </Modal>
  )
}
