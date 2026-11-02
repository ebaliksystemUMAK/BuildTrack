// Pure rules for site controls (no network, no React): what the status looks like, who is affected, what to tell people, which page belongs to which
// feature, and the checks before a forced logout. The database enforces everything again; these functions only explain and prepare.

export const FEATURE_KEYS = ["quality", "daily_reports", "blueprint_editor", "client_reports", "site_issues", "site_visits", "attendance"] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]
export const featureLabels: Record<FeatureKey, string> = {
  quality: "Quality inspections and defect reports",
  daily_reports: "Daily reports",
  blueprint_editor: "Plan editor markups",
  client_reports: "Client problem reports and questions",
  site_issues: "Site issue reports",
  site_visits: "Client site visits",
  attendance: "Attendance requests and concerns",
}

// Never Admins: the database refuses a list that contains one.
export const AUDIENCE_ROLES = ["engineer", "foreman", "client", "project_manager", "user"] as const
export type AudienceRole = (typeof AUDIENCE_ROLES)[number]
export const audienceLabels: Record<AudienceRole, string> = { engineer: "Engineers", foreman: "Foremen", client: "Clients", project_manager: "Project Managers", user: "Basic users" }

export type SiteLock = { feature: string; label: string; message: string }
export type SiteStatus = { maintenance: { on: boolean; message: string; returns_at: string | null }; restricted: boolean; role: string | null; locks: SiteLock[] }

// Reads the answer of get_site_status. Anything malformed means "no information": the app then shows nothing and blocks nothing.
export function parseSiteStatus(raw: unknown): SiteStatus | null {
  if (raw === null || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const maintenance = value.maintenance && typeof value.maintenance === "object" ? (value.maintenance as Record<string, unknown>) : null
  if (!maintenance || typeof maintenance.on !== "boolean") return null
  const locks = Array.isArray(value.locks)
    ? value.locks.filter((lock): lock is Record<string, unknown> => Boolean(lock) && typeof lock === "object").map((lock) => ({ feature: String(lock.feature ?? ""), label: String(lock.label ?? ""), message: typeof lock.message === "string" ? lock.message : "" })).filter((lock) => lock.feature && lock.label)
    : []
  return {
    maintenance: { on: maintenance.on, message: typeof maintenance.message === "string" ? maintenance.message : "", returns_at: typeof maintenance.returns_at === "string" ? maintenance.returns_at : null },
    restricted: value.restricted === true,
    role: typeof value.role === "string" ? value.role : null,
    locks,
  }
}

const manilaStamp = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })

export type StripKind = "maintenance" | "lock"
export type Strip = { key: string; kind: StripKind; title: string; text: string }

// What each person is told. A restricted person: what is paused and until when. An Admin: that the pause exists and does not affect them. A visitor: sign-in still works.
export function stripsFor(status: SiteStatus | null, now: Date = new Date()): Strip[] {
  if (!status) return []
  const strips: Strip[] = []
  if (status.maintenance.on) {
    const returns = status.maintenance.returns_at
    const late = returns && new Date(returns).getTime() < now.getTime()
    const when = returns ? (late ? ` The expected return time (${manilaStamp(returns)}, Manila time) has passed; it is still on.` : ` Expected back around ${manilaStamp(returns)} (Manila time).`) : ""
    const message = status.maintenance.message.trim() || "BuildTrack is being updated."
    if (status.restricted) strips.push({ key: "maintenance", kind: "maintenance", title: "Maintenance", text: `${message} You can still look at everything; saving changes is paused. Anything you saved offline is kept and is sent afterwards.${when}` })
    else if (status.role === "admin" || status.role === "super_admin") strips.push({ key: "maintenance", kind: "maintenance", title: "Maintenance is on", text: `Everyone except Admins and Super Admins can only look, not save. You are not restricted. Message shown to them: ${message}${when}` })
    else strips.push({ key: "maintenance", kind: "maintenance", title: "Maintenance", text: `${message} Signing in works; saving changes is paused for now.${when}` })
  }
  for (const lock of status.locks) strips.push({ key: `lock:${lock.feature}`, kind: "lock", title: `${lock.label} is paused`, text: lock.message.trim() || "This feature is switched off for your role for now. Please try again later." })
  return strips
}

// The page a person is on, to the feature it belongs to. Explanatory only (the database decides what is refused).
const pageFeatures: Record<string, Record<string, FeatureKey>> = {
  engineer: { qa: "quality", verification: "quality", checklists: "quality", annotation: "blueprint_editor", "project-blueprint": "blueprint_editor" },
  foreman: { "daily-report": "daily_reports", "quality-control": "quality", "qa-workflow": "quality", issues: "quality", attendance: "attendance" },
  client: { ticket: "client_reports", communication: "client_reports" },
  manager: { quality: "quality", attendance: "attendance" },
}
export function featureForPage(persona: string, page: string): FeatureKey | null {
  return pageFeatures[persona]?.[page] ?? null
}
export const lockFor = (status: SiteStatus | null, feature: string | null): SiteLock | null => (status && feature ? status.locks.find((lock) => lock.feature === feature) ?? null : null)

// What is paused during maintenance and what keeps working, in the words shown to the Super Admin.
export const MAINTENANCE_PAUSES = [
  "Saving or changing work records by Engineers, Foremen, Clients, Project Managers and basic users: pins and progress, plans and markups, checklists and inspections, defect reports, daily reports and photos, client reports and questions, site issues, site visits, attendance requests, projects and team changes.",
]
export const MAINTENANCE_KEEPS = [
  "Signing in, signing out, password recovery and sign-up.",
  "Looking at plans, pins, reports and records.",
  "Admins and Super Admins (signed in with the authenticator app): they are never restricted.",
  "Biometric devices and scheduled jobs: scans and other backend writes are always accepted, because they are evidence.",
  "Notifications, a person's own details and preferences, privacy requests (including erasure) and access requests.",
]

// ---------------------------------------------------------------- forms and the forced logout
// "2026-11-02T14:30" typed in the page is Manila time.
export function manilaLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const date = new Date(`${local}:00+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function maintenanceProblem(input: { message: string; returnsLocal: string }, now: Date = new Date()): string | null {
  const message = input.message.trim()
  if (message.length < 5) return "Write a message people will see (at least 5 characters)."
  if (message.length > 500) return "The message can be at most 500 characters."
  if (input.returnsLocal) {
    const iso = manilaLocalToIso(input.returnsLocal)
    if (!iso) return "Enter the return time as a date and time."
    const at = new Date(iso).getTime()
    if (at <= now.getTime()) return "The return time must be in the future."
    if (at > now.getTime() + 14 * 86_400_000) return "The return time can be at most 14 days away."
  }
  return null
}

export const confirmPhrase = (total: number) => `LOG OUT ${total}`

export type ForceLogoutPreview = { total: number; by_role: Record<string, number>; signed_in_last_24h: number; confirm_phrase: string; cooldown_seconds: number }

export function parseForcePreview(raw: unknown): ForceLogoutPreview | null {
  if (raw === null || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  const number = (key: string) => (typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : null)
  const total = number("total"), recent = number("signed_in_last_24h"), cooldown = number("cooldown_seconds")
  if (total === null || recent === null || cooldown === null || typeof value.confirm_phrase !== "string") return null
  const roles = value.by_role && typeof value.by_role === "object" ? Object.fromEntries(Object.entries(value.by_role as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")) : {}
  return { total, by_role: roles, signed_in_last_24h: recent, confirm_phrase: value.confirm_phrase, cooldown_seconds: cooldown }
}

// The last step before a forced logout. The phrase must match exactly (case and spacing included); the database checks it again with the fresh count.
export function forceLogoutProblem(input: { preview: ForceLogoutPreview | null; phrase: string; reason: string }): string | null {
  const { preview } = input
  if (!preview) return "Preview who is affected first."
  if (preview.total === 0) return "No active account matches."
  if (preview.total > 1000) return "That is more than 1,000 accounts. Narrow it by role or project."
  if (preview.cooldown_seconds > 0) return `A forced logout was done a moment ago. Wait ${Math.ceil(preview.cooldown_seconds / 60)} minute${preview.cooldown_seconds > 60 ? "s" : ""}.`
  const reason = input.reason.replace(/\s+/g, " ").trim()
  if (reason.length < 5 || reason.length > 300) return "Give a reason of 5 to 300 characters."
  if (input.phrase !== preview.confirm_phrase) return `Type ${preview.confirm_phrase} exactly to confirm.`
  return null
}

// The app signs a person out when an administrator forced a logout after this sign-in began. Both times come from the server, so the person's own clock does not matter.
export function shouldForceSignOut(forceLogoutAt: string | null | undefined, lastSignInAt: string | null | undefined): boolean {
  if (!forceLogoutAt) return false
  const forced = new Date(forceLogoutAt).getTime()
  if (Number.isNaN(forced)) return false
  const signedIn = lastSignInAt ? new Date(lastSignInAt).getTime() : NaN
  return Number.isNaN(signedIn) ? false : forced > signedIn // without a known sign-in time nothing is forced, so a person who signed in again is never signed out twice
}

export const FORCED_LOGOUT_NOTICE = "An administrator signed you out. Sign in again to continue. Anything you saved offline on this device is kept and will be sent after you sign in."

export const FORCE_LOGOUT_LIMITS = [
  "Their saved sign-in is removed now, and the app signs them out within about 30 seconds.",
  "A sign-in token that was already issued can still be used until it expires (up to about an hour). To stop an account immediately, suspend it instead.",
  "They can sign in again straight away: this is not a suspension.",
  "Anything they saved offline stays on their device and is sent after they sign in again.",
  "Admins, Super Admins, you and suspended accounts are never affected.",
]
