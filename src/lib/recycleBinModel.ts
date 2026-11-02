// Pure rules for the project archive and recycle bin screens (no network, no React). The database enforces every rule again; these only explain and prepare.

export type ProjectContents = {
  plans: number; pins: number; pins_with_work: number; evidence_pins: number; attendance_workers: number; devices_total: number; team: number; daily_reports: number; inspections: number; defects: number
  site_issues: number; client_reports: number; questions: number; photos: number; devices: number; scans: number
}
export const emptyContents: ProjectContents = { plans: 0, pins: 0, pins_with_work: 0, evidence_pins: 0, attendance_workers: 0, devices_total: 0, team: 0, daily_reports: 0, inspections: 0, defects: 0, site_issues: 0, client_reports: 0, questions: 0, photos: 0, devices: 0, scans: 0 }

export type RemovedProject = { id: string; code: string; name: string; removed_at: string; removed_by: string | null; reason: string | null; archived_at: string | null; contents: ProjectContents }
export type RemovalPreview = { id: string; code: string; name: string; archived: boolean; removed: boolean; contents: ProjectContents }

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
export function parseContents(raw: unknown): ProjectContents {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return Object.fromEntries(Object.keys(emptyContents).map((key) => [key, count(value[key])])) as ProjectContents
}

export function parseRecycleBin(raw: unknown): RemovedProject[] | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { projects?: unknown }).projects)) return null
  const rows: RemovedProject[] = []
  for (const item of (raw as { projects: unknown[] }).projects) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== "string" || typeof row.code !== "string" || typeof row.removed_at !== "string") continue
    rows.push({
      id: row.id, code: row.code, name: typeof row.name === "string" ? row.name : row.code, removed_at: row.removed_at,
      removed_by: typeof row.removed_by === "string" ? row.removed_by : null, reason: typeof row.reason === "string" ? row.reason : null,
      archived_at: typeof row.archived_at === "string" ? row.archived_at : null, contents: parseContents(row.contents),
    })
  }
  return rows
}

export function parsePreview(raw: unknown): RemovalPreview | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (typeof value.id !== "string" || typeof value.code !== "string") return null
  return { id: value.id, code: value.code, name: typeof value.name === "string" ? value.name : value.code, archived: value.archived === true, removed: value.removed === true, contents: parseContents(value.contents) }
}

const noun = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// What is inside, in plain words, skipping what is empty.
export function describeContents(contents: ProjectContents): string[] {
  const lines = [
    contents.plans ? noun(contents.plans, "plan", "plans") : "",
    contents.pins ? noun(contents.pins, "pin", "pins") + (contents.evidence_pins ? ` (${contents.evidence_pins} with review or verification evidence)` : "") : "",
    contents.pins_with_work ? noun(contents.pins_with_work, "pin with recorded work", "pins with recorded work") : "",
    contents.team ? noun(contents.team, "team member", "team members") : "",
    contents.daily_reports ? noun(contents.daily_reports, "daily report", "daily reports") : "",
    contents.inspections ? noun(contents.inspections, "inspection", "inspections") : "",
    contents.defects ? noun(contents.defects, "defect report", "defect reports") : "",
    contents.site_issues ? noun(contents.site_issues, "site issue", "site issues") : "",
    contents.client_reports ? noun(contents.client_reports, "client report", "client reports") : "",
    contents.questions ? noun(contents.questions, "client question", "client questions") : "",
    contents.photos ? noun(contents.photos, "photo", "photos") : "",
    contents.scans ? noun(contents.scans, "biometric scan", "biometric scans") : "",
    contents.attendance_workers ? noun(contents.attendance_workers, "registered attendance worker", "registered attendance workers") : "",
  ]
  return lines.filter(Boolean)
}

export const isEmptyProject = (contents: ProjectContents) => describeContents(contents).length === 0

export const REASON_LIMITS = { min: 5, max: 300 }
export const cleanReason = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim()

// The checks before a project is moved to the recycle bin. The typed code must match exactly (the database compares the same way).
export function removalProblem(input: { preview: RemovalPreview | null; reason: string; typedCode: string }): string | null {
  const { preview } = input
  if (!preview) return "Check what is inside first."
  if (preview.removed) return "This project is already in the recycle bin."
  if (!preview.archived) return "Archive the project first. Only an archived project can be moved to the recycle bin."
  const reason = cleanReason(input.reason)
  if (reason.length < REASON_LIMITS.min || reason.length > REASON_LIMITS.max) return `Give a reason of ${REASON_LIMITS.min} to ${REASON_LIMITS.max} characters.`
  if (input.typedCode !== preview.code) return `Type ${preview.code} exactly to confirm.`
  return null
}

// The same rule as the project form (and the database). Empty means "keep the code".
export function restoreCodeProblem(code: string): string | null {
  const value = code.trim().toUpperCase()
  if (!value) return null
  return /^[A-Z0-9][A-Z0-9-]{1,29}$/.test(value) ? null : "Use 2-30 characters: letters, numbers and dashes (for example VCB-024)."
}

export type ProjectScope = "open" | "archived" | "all" | "bin"
export const scopeLabels: Record<ProjectScope, string> = { open: "Open projects", archived: "Archived", all: "Open and archived", bin: "Recycle bin" }

type ScopeProject = { archived_at?: string | null; deleted_at?: string | null }
// The projects list never contains a removed project (the database hides it), but the filter defends against it anyway.
export function inScope(project: ScopeProject, scope: ProjectScope): boolean {
  if (project.deleted_at) return false
  if (scope === "open") return !project.archived_at
  if (scope === "archived") return Boolean(project.archived_at)
  if (scope === "all") return true
  return false
}
export const scopeCounts = (projects: ScopeProject[], removed: number) => ({
  open: projects.filter((project) => inScope(project, "open")).length,
  archived: projects.filter((project) => inScope(project, "archived")).length,
  all: projects.filter((project) => inScope(project, "all")).length,
  bin: removed,
})

// What happened to a person who was on the project, read from the restore result.
export type RestoreResult = { restored: boolean; code: string; code_changed: boolean; still_archived: boolean; inactive_members: number; has_primary_manager: boolean }
export function parseRestore(raw: unknown): RestoreResult | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (value.restored !== true || typeof value.code !== "string") return null
  return { restored: true, code: value.code, code_changed: value.code_changed === true, still_archived: value.still_archived === true, inactive_members: count(value.inactive_members), has_primary_manager: value.has_primary_manager === true }
}

// The follow-up to tell the Admin after a restore: nothing is hidden, and what needs a look is named.
export function restoreNotes(result: RestoreResult): string[] {
  const notes: string[] = []
  if (result.still_archived) notes.push("It is back as an archived project (read-only). Use Restore from archive when work should continue.")
  if (result.code_changed) notes.push(`Its code is now ${result.code}.`)
  if (result.inactive_members > 0) notes.push(`${noun(result.inactive_members, "team member is", "team members are")} no longer active or changed role. Review Team & access.`)
  if (!result.has_primary_manager) notes.push("It has no active primary Project Manager. Assign one under Managers.")
  return notes
}

// ---------------------------------------------------------------- permanent deletion (Super Admin only)
export type PurgePreview = { ok: boolean; reasons: string[]; code: string; name: string; removed_at: string | null; removed_by: string | null; removal_reason: string | null; days_in_bin: number | null; min_days: number; contents: ProjectContents }

export const purgePhrase = (code: string) => `DELETE FOREVER ${code}`

export function parsePurgePreview(raw: unknown): PurgePreview | null {
  if (!raw || typeof raw !== "object") return null
  const value = raw as Record<string, unknown>
  if (typeof value.ok !== "boolean" || !Array.isArray(value.reasons)) return null
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null)
  return {
    ok: value.ok, reasons: value.reasons.filter((reason): reason is string => typeof reason === "string"), code: text("code") ?? "", name: text("name") ?? text("code") ?? "",
    removed_at: text("removed_at"), removed_by: text("removed_by"), removal_reason: text("removal_reason"),
    days_in_bin: typeof value.days_in_bin === "number" ? value.days_in_bin : null, min_days: typeof value.min_days === "number" ? value.min_days : 30, contents: parseContents(value.contents),
  }
}

// The last step before a project is deleted forever. The phrase must match exactly (case and spacing included); the server checks it again.
export function purgeProblem(input: { preview: PurgePreview | null; typed: string }): string | null {
  const { preview } = input
  if (!preview) return "Check the project first."
  if (!preview.ok) return preview.reasons[0] ?? "This project cannot be deleted forever."
  if (input.typed !== purgePhrase(preview.code)) return `Type ${purgePhrase(preview.code)} exactly to confirm.`
  return null
}

export const RECYCLE_NOT_INSTALLED = "The recycle bin is not installed on the database yet (migration 20261101180000_project_recycle_bin). The owner reviews and runs it first."

export function binError(error: { message?: string; code?: string } | null | undefined): { message: string; setup: boolean } {
  const message = error?.message ?? ""
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function|does not exist/i.test(message)) return { message: RECYCLE_NOT_INSTALLED, setup: true }
  if (/Only a Super Admin/i.test(message)) return { message: "Only a Super Admin, signed in with the authenticator app, can delete a project forever.", setup: false }
  if (/Only an Admin with the Projects permission|permission denied/i.test(message)) return { message: "Only an Admin with the Projects permission, signed in with the authenticator app, can use the recycle bin.", setup: false }
  if (/fetch|network/i.test(message)) return { message: "Network problem. Check your connection and try again.", setup: false }
  return { message: message || "That did not work. Try again.", setup: false } // the database messages are written to be read
}
