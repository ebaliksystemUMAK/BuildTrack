// Pure rules for the System Control page (no network, no React, so `pnpm test:system-control` runs them in Node): tab names, how sizes and system actions are
// written for people, and the role-access overview built from the rules the app really uses. The database decides every action; nothing here grants anything.

export const SYSTEM_TABS = ["health", "maintenance", "logout", "banner", "email", "registration", "roles"] as const
export type SystemTab = (typeof SYSTEM_TABS)[number]
export const isSystemTab = (value: unknown): value is SystemTab => typeof value === "string" && (SYSTEM_TABS as readonly string[]).includes(value)

export const tabLabels: Record<SystemTab, string> = {
  health: "Health",
  maintenance: "Maintenance & isolation",
  logout: "Forced logout",
  banner: "Announcement banner",
  email: "Email",
  registration: "Registration",
  roles: "Role access",
}

// The old addresses keep working: they open the matching tab.
export const legacyTab: Record<string, SystemTab> = { "system-health": "health", "site-controls": "maintenance" }

export function formatBytes(value: unknown): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ["KB", "MB", "GB", "TB"]
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit++
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

// ---------------------------------------------------------------- the system activity log
export type ActivityRow = { id: number; created_at: string; action: string; actor: string | null; details: Record<string, unknown> | null }

const names: Record<string, string> = {
  "user.create": "Account created",
  "user.update": "Account edited",
  "user.approve": "Registration approved",
  "user.reject": "Registration rejected",
  "user.reopen": "Registration reopened",
  "user.disable": "Account suspended",
  "user.enable": "Account re-enabled",
  "user.impersonate": "Signed in as another user",
  "profile.role_changed": "Role changed",
  "profile.status_changed": "Account status changed",
  "oauth.enroll": "Google registration started",
  "oauth.blocked": "Google sign-in blocked",
  "registration.submitted": "Registration sent",
  "identity.submit": "ID submitted",
  "account.email_verified": "Email confirmed",
  "account.password_reset": "Password reset with a code",
  "whitelist.add": "Email pre-approved",
  "whitelist.remove": "Email removed from the whitelist",
  "photos.account_rule": "Photo rule changed",
  "record.removed": "Record removed",
  "record.restored": "Record restored",
  "project.removed": "Project moved to the recycle bin",
  "project.recovered": "Project restored",
  "maintenance.on": "Maintenance switched on",
  "maintenance.update": "Maintenance message changed",
  "maintenance.off": "Maintenance switched off",
  "maintenance.schedule": "Maintenance window scheduled",
  "maintenance.schedule_cancel": "Maintenance window cancelled",
  "maintenance.scheduled_on": "Scheduled maintenance started",
  "maintenance.scheduled_off": "Scheduled maintenance ended",
  "feature.lock": "Feature paused",
  "feature.update": "Feature pause changed",
  "feature.unlock": "Feature resumed",
  "user.force_logout": "Forced logout",
  "announcement.publish": "Banner published",
  "announcement.update": "Banner updated",
  "announcement.disable": "Banner switched off",
  "announcement.message": "Message sent",
  "announcement.email": "Email message sent",
  "system.switch": "System switch changed",
  "system.emergency_off": "Emergency switch-off",
  "settings.update": "System setting changed",
  "email.test": "Test email sent",
  "user.set_permissions": "Admin permissions changed",
  "account.closed": "Account closed (records kept)",
  "account.delete_requested": "Account deletion started",
  "account.deleted": "Account deleted",
  "project.purged": "Project deleted forever",
  "project.purge_files": "Project files removed",
  "digest.admin": "Admin digest sent",
}
const switchNames: Record<string, string> = { registration_closed: "Registration", email_paused: "Email" }

// ---------------------------------------------------------------- maintenance windows (times are Manila time, like the rest of the app)
const MANILA = "Asia/Manila"
export function windowTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("en-PH", { timeZone: MANILA, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
// What a date-time box gives (2026-11-05T22:00, no zone) is Manila time; this turns it into the exact moment, or null when it is not a date.
export function manilaToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const date = new Date(`${local}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
export type WindowRow = { id: string; starts_at: string; ends_at: string; message: string; status: "scheduled" | "active" | "done" | "cancelled" | "skipped"; created_by: string | null; activated_at: string | null; ended_at: string | null; end_note: string | null }
export const windowStatusLabel: Record<WindowRow["status"], string> = { scheduled: "Scheduled", active: "On now", done: "Finished", cancelled: "Cancelled", skipped: "Not applied" }
// The same limits as the database function, so the form says no before anything is sent.
export function windowProblem(input: { start: string; end: string; message: string }, now = Date.now()): string | null {
  const start = manilaToIso(input.start)
  const end = manilaToIso(input.end)
  if (!start || !end) return "Choose when the window starts and ends."
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (s < now + 60_000) return "The start must be in the future."
  if (s > now + 30 * 86_400_000) return "The start can be at most 30 days ahead."
  if (e <= s) return "The end must be after the start."
  if (e - s > 24 * 3_600_000) return "A window can last at most 24 hours."
  if (e - s < 5 * 60_000) return "A window must last at least 5 minutes."
  const message = input.message.replace(/\s+/g, " ").trim()
  if (message.length < 5 || message.length > 500) return "Write the message people will see (5 to 500 characters)."
  return null
}

// ---------------------------------------------------------------- lockout watch
export type LockoutWatch = {
  codes_requested_24h: number
  wrong_tries_24h: number
  locked_codes: Array<{ email: string; purpose: string; attempts: number; created_at: string; expires_at: string; still_locked: boolean }>
  invite_attempts: Array<{ person: string | null; failed: number; locked: boolean; last_at: string }>
  blocked_signins_7d: number
  blocked_signins: Array<{ created_at: string; email: string; reason: string }>
}
export function lockoutVerdict(w: Pick<LockoutWatch, "locked_codes" | "invite_attempts" | "blocked_signins_7d" | "wrong_tries_24h">): { tone: "ok" | "warn"; text: string } {
  const locked = w.locked_codes.filter((row) => row.still_locked).length
  const invites = w.invite_attempts.filter((row) => row.locked).length
  if (!locked && !invites && Number(w.wrong_tries_24h) < 10 && Number(w.blocked_signins_7d) === 0) return { tone: "ok", text: "Nothing unusual: no locked codes, no invitation lockouts, no blocked sign-ins." }
  const parts = [locked ? `${locked} code${locked === 1 ? "" : "s"} locked now` : "", invites ? `${invites} account${invites === 1 ? "" : "s"} locked out of invitation codes` : "", Number(w.blocked_signins_7d) ? `${w.blocked_signins_7d} blocked Google sign-in${Number(w.blocked_signins_7d) === 1 ? "" : "s"} this week` : "", Number(w.wrong_tries_24h) >= 10 ? `${w.wrong_tries_24h} wrong code tries in 24 hours` : ""].filter(Boolean)
  return { tone: "warn", text: parts.join(", ") + "." }
}

export const activityName = (action: string): string => names[action] ?? action

export function activitySummary(row: Pick<ActivityRow, "action" | "details">): string {
  const d = (row.details ?? {}) as Record<string, unknown>
  const text = (value: unknown, max = 120) => (typeof value === "string" ? value.slice(0, max) : "")
  switch (row.action) {
    case "maintenance.on":
    case "maintenance.update":
      return text(d.message)
    case "maintenance.schedule":
    case "maintenance.scheduled_on":
    case "maintenance.scheduled_off":
    case "maintenance.schedule_cancel":
      return [typeof d.starts_at === "string" ? `${windowTime(d.starts_at)}${typeof d.ends_at === "string" ? ` to ${windowTime(d.ends_at)}` : ""}` : typeof d.ends_at === "string" ? `until ${windowTime(d.ends_at)}` : "", text(d.message, 80), text(d.result, 60)].filter(Boolean).join(" · ")
    case "feature.lock":
    case "feature.update":
    case "feature.unlock":
      return [text(d.label || d.feature, 60), Array.isArray(d.audiences) ? `for ${(d.audiences as unknown[]).map(String).join(", ")}` : ""].filter(Boolean).join(" ")
    case "user.force_logout":
      return [typeof d.accounts === "number" ? `${d.accounts} account${d.accounts === 1 ? "" : "s"}` : "", text(d.reason)].filter(Boolean).join(": ")
    case "system.switch":
      return `${switchNames[String(d.switch)] ?? text(d.switch, 40)} ${d.enabled ? "turned on (closed / paused)" : "turned off (back to normal)"}`
    case "system.emergency_off": {
      const parts = [d.maintenance_was_on ? "maintenance" : "", Array.isArray(d.features_unlocked) && d.features_unlocked.length ? `${d.features_unlocked.length} feature pause(s)` : "", Array.isArray(d.switches_off) && d.switches_off.length ? `${d.switches_off.length} switch(es)` : ""].filter(Boolean)
      return parts.length ? `Switched off: ${parts.join(", ")}` : "Nothing was on"
    }
    case "announcement.publish":
    case "announcement.update":
      return text(d.title)
    case "account.closed":
    case "account.delete_requested":
    case "account.deleted":
      return text(d.reason)
    default: {
      const move = typeof d.from === "string" && typeof d.to === "string" ? `${text(d.from, 30)} to ${text(d.to, 30)}` : typeof d.before === "string" && typeof d.after === "string" ? `${text(d.before, 30)} to ${text(d.after, 30)}` : ""
      const who = text(d.email, 80)
      const role = text(d.role, 30) || text(d.requested_role, 30)
      const perms = Array.isArray(d.permissions) ? `${d.permissions.length} permission(s)` : ""
      return [move, role && !move ? role : "", who, text(d.reason) || text(d.decision_note) || text(d.title) || text(d.code, 40), perms].filter(Boolean).join(" · ")
    }
  }
}

// ---------------------------------------------------------------- email delivery
export type EmailRow = { created_at: string; status: string; detail: string; kind: string | null; person: string | null }
export type EmailDelivery = { sent_24h: number; failed_24h: number; skipped_24h: number; waiting: number; last_sent_at: string | null; last_failed_at: string | null; recent: EmailRow[] }

// One plain sentence about whether email is working, from the numbers only.
export function emailVerdict(d: Pick<EmailDelivery, "sent_24h" | "failed_24h" | "last_sent_at" | "last_failed_at">, paused: boolean): { tone: "ok" | "warn" | "bad" | "idle"; text: string } {
  if (paused) return { tone: "warn", text: "Email is paused. Notifications wait in the queue (and are dropped once they are 2 days old)." }
  if (d.failed_24h > 0 && d.sent_24h === 0) return { tone: "bad", text: "Emails are failing and none went out in the last 24 hours. Check the mail key (System health) and the reasons below." }
  if (d.failed_24h > 0) return { tone: "warn", text: `${d.sent_24h} sent and ${d.failed_24h} failed in the last 24 hours.` }
  if (d.sent_24h > 0) return { tone: "ok", text: `${d.sent_24h} email${d.sent_24h === 1 ? "" : "s"} sent in the last 24 hours, none failed.` }
  return { tone: "idle", text: d.last_sent_at ? "Nothing was sent in the last 24 hours." : "No notification email has ever been sent." }
}

// ---------------------------------------------------------------- the role access overview
export const ROLE_ORDER = ["super_admin", "admin", "project_manager", "engineer", "foreman", "client", "user"] as const
export type RoleKey = (typeof ROLE_ORDER)[number]
export const roleNames: Record<RoleKey, string> = { super_admin: "Super Admin", admin: "Admin", project_manager: "Project Manager", engineer: "Engineer", foreman: "Foreman", client: "Client", user: "Basic user" }
export const areaNames: Record<string, string> = {
  admin: "Admin (Control center)",
  pm: "Project Manager workspace",
  engineer: "Engineer workspace",
  foreman: "Foreman workspace",
  client: "Client portal",
  user: "My account (basic user)",
  attendance: "Attendance page",
  "pin-link": "Pin links (QR)",
}

// rolesForArea is the table the route guard really uses, passed in so this stays pure and always in step with it.
export function areaMatrix(rolesForArea: Record<string, readonly string[]>): Array<{ key: string; label: string; roles: Record<RoleKey, boolean> }> {
  return Object.keys(areaNames).filter((key) => key in rolesForArea).map((key) => ({
    key,
    label: areaNames[key],
    roles: Object.fromEntries(ROLE_ORDER.map((role) => [role, rolesForArea[key].includes(role)])) as Record<RoleKey, boolean>,
  }))
}

// The Admin menu pages and what each needs, from adminPagePermission (passed in) plus the pages that are Super Admin only.
export const SUPER_ONLY_PAGES = ["system-control", "system-health", "site-controls", "records"] as const
export function adminPageMatrix(pages: Array<{ key: string; label: string }>, permissionOf: Record<string, string | undefined>): Array<{ key: string; label: string; need: string }> {
  return pages.map((page) => ({
    key: page.key,
    label: page.label,
    need: (SUPER_ONLY_PAGES as readonly string[]).includes(page.key) ? "Super Admin only" : permissionOf[page.key] ? `Admin permission: ${permissionOf[page.key]}` : "Any Admin",
  }))
}

// What each role is for, in the words the project rules use. Enforced by the database (row security and functions), not by this page.
export const ROLE_RULES: Array<{ role: RoleKey; summary: string }> = [
  { role: "super_admin", summary: "Every Admin permission, plus system and recovery authority. Must pass the authenticator. Cannot be impersonated or deleted from the app." },
  { role: "admin", summary: "Only the permissions a Super Admin ticked: accounts, approvals, biometrics, projects, plan uploads, photo rules. Must pass the authenticator." },
  { role: "project_manager", summary: "Runs the team, plan access, leads and work assignments of the open projects they are appointed to. Makes no QA decisions." },
  { role: "engineer", summary: "Builds checklists, inspects and makes the technical QA decisions on the plan types they are assigned." },
  { role: "foreman", summary: "Works only on assigned work, with photo evidence, and reports progress. Cannot verify or close quality records." },
  { role: "client", summary: "Read-only view of the project they belong to; sends reports and questions. Never sees internal QA or evidence." },
  { role: "user", summary: "A new account with no project data. Confirms the email, verifies identity, then requests access or joins with an invitation code." },
]

// ---------------------------------------------------------------- System Logs (administrator and system transactions)
export const SYSTEM_LOG_TABS = ["transactions", "email", "lockouts"] as const
export type SystemLogTab = (typeof SYSTEM_LOG_TABS)[number]
export const isSystemLogTab = (value: unknown): value is SystemLogTab => typeof value === "string" && (SYSTEM_LOG_TABS as readonly string[]).includes(value)
export const logTabLabels: Record<SystemLogTab, string> = { transactions: "Transactions", email: "Email delivery", lockouts: "Lockouts" }
export const LOG_CATEGORIES = ["", "accounts", "system", "data", "other"] as const
export type LogCategory = (typeof LOG_CATEGORIES)[number]
export const logCategoryLabels: Record<LogCategory, string> = { "": "All", accounts: "Accounts & access", system: "System controls", data: "Projects & records", other: "Other" }
export type LogRow = { id: number; created_at: string; action: string; category: Exclude<LogCategory, "">; actor_name: string | null; actor_email: string | null; target_name: string | null; details: Record<string, unknown> | null }
// A reference people can quote ("log 1042"), the same number everywhere the entry is shown.
export const logReference = (id: number) => `LOG-${String(id).padStart(5, "0")}`

// ---------------------------------------------------------------- tabbed Admin pages: which tabs a person may open
export type TabRule = { key: string; label: string; need: "users.view" | "users.approve" | "users.edit" | "super" | null }
export const accessMessageTabs: TabRule[] = [
  { key: "invitations", label: "Invitations", need: "users.approve" },
  { key: "access", label: "Global access review", need: "users.view" },
  { key: "messages", label: "Announcements & messages", need: "users.edit" },
]
export const recordsAuditTabs: TabRule[] = [
  { key: "audit", label: "Company audit log", need: "users.view" },
  { key: "records", label: "Records", need: "super" },
]
export function allowedTabs(rules: TabRule[], can: (permission: string) => boolean, isSuper: boolean): TabRule[] {
  return rules.filter((rule) => isSuper || rule.need === null || (rule.need !== "super" && can(rule.need)))
}
// The old page addresses open the matching tab of the page that now holds them.
export const movedPages: Record<string, { page: "access-messages" | "records-audit" | "settings"; tab: string }> = {
  invites: { page: "access-messages", tab: "invitations" },
  "access-review": { page: "access-messages", tab: "access" },
  communications: { page: "access-messages", tab: "messages" },
  "audit-log": { page: "records-audit", tab: "audit" },
  records: { page: "records-audit", tab: "records" },
  "qa-checklists": { page: "settings", tab: "qc" },
}
