import type { Project, ProjectPhase, ProjectStatus } from "./projects"
import { daysBetween, summarize, type Totals } from "./progress.ts"
import type { ProgressTask } from "./taskProgress"

// Pure rules of the Project Manager workspace (20261029100000). The database enforces the same rules;
// supabase/tests/99-…-project-managers.cases.mjs proves them there, scripts/test-project-manager.mjs proves these.

export type ManagerSlot = "primary" | "backup"
export type ProjectManagerRow = { project_id: string; user_id: string; full_name: string; email: string | null; designation: ManagerSlot; active: boolean; assigned_at: string }

export const slotLabels: Record<ManagerSlot, string> = { primary: "Primary Project Manager", backup: "Backup Project Manager" }
export const slotShort: Record<ManagerSlot, string> = { primary: "Primary", backup: "Backup" }

export function slotsOf(rows: ProjectManagerRow[], projectId: string): Record<ManagerSlot, ProjectManagerRow | null> {
  const here = rows.filter((row) => row.project_id === projectId)
  return { primary: here.find((row) => row.designation === "primary") ?? null, backup: here.find((row) => row.designation === "backup") ?? null }
}

export const myDesignation = (rows: ProjectManagerRow[], projectId: string, userId: string | null | undefined): ManagerSlot | null =>
  rows.find((row) => row.project_id === projectId && row.user_id === userId)?.designation ?? null

// What choosing a person for a slot will do (mirrors assign_project_manager): nothing, fill, replace, or swap with the other slot.
export function slotChange(rows: ProjectManagerRow[], projectId: string, userId: string, slot: ManagerSlot): { kind: "unchanged" | "assign" | "replace" | "swap" | "move"; replaced: ProjectManagerRow | null } {
  const slots = slotsOf(rows, projectId)
  const holder = slots[slot]
  const current = myDesignation(rows, projectId, userId)
  if (current === slot) return { kind: "unchanged", replaced: null }
  if (holder && current) return { kind: "swap", replaced: holder }
  if (holder) return { kind: "replace", replaced: holder }
  return { kind: current ? "move" : "assign", replaced: null }
}

// Columns a Project Manager may change. Keep identical to `allowed` in SQL guard_project_manager_edit.
export const PM_EDITABLE_FIELDS = ["location", "client_name", "description", "phase", "status", "start_date", "end_date", "lead_engineer_id", "lead_foreman_id", "site_lat", "site_lng", "site_radius_m"] as const
export type PmEditableField = (typeof PM_EDITABLE_FIELDS)[number]

export type DetailsForm = {
  location: string
  client_name: string
  description: string
  phase: ProjectPhase
  status: ProjectStatus
  start_date: string
  end_date: string
  lead_engineer_id: string
  lead_foreman_id: string
  site_lat: string
  site_lng: string
  site_radius_m: string
}
export type DetailsErrors = Partial<Record<keyof DetailsForm, string>>

export function detailsForm(project: Project): DetailsForm {
  return {
    location: project.location ?? "",
    client_name: project.client_name ?? "",
    description: project.description ?? "",
    phase: project.phase,
    status: project.status,
    start_date: project.start_date ?? "",
    end_date: project.end_date ?? "",
    lead_engineer_id: project.lead_engineer_id ?? "",
    lead_foreman_id: project.lead_foreman_id ?? "",
    site_lat: project.site_lat === null || project.site_lat === undefined ? "" : String(project.site_lat),
    site_lng: project.site_lng === null || project.site_lng === undefined ? "" : String(project.site_lng),
    site_radius_m: String(project.site_radius_m ?? 150),
  }
}

// Same limits as the Admin project form (Project Management).
export function validateDetails(form: DetailsForm): DetailsErrors {
  const errors: DetailsErrors = {}
  if (form.location.length > 200) errors.location = "Keep the location under 200 characters."
  if (form.client_name.length > 120) errors.client_name = "Keep the client name under 120 characters."
  if (form.description.length > 2000) errors.description = "Keep the description under 2,000 characters."
  if (form.start_date && form.end_date && form.end_date < form.start_date) errors.end_date = "End date must be on or after the start date."
  const lat = form.site_lat.trim()
  const lng = form.site_lng.trim()
  if (lat || lng) {
    if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) errors.site_lat = "Enter both the latitude and the longitude as numbers, or leave both empty."
    else if (Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) errors.site_lat = "Latitude is between -90 and 90 and longitude between -180 and 180."
  }
  const radius = Number(form.site_radius_m)
  if (!Number.isInteger(radius) || radius < 20 || radius > 5000) errors.site_radius_m = "Use a whole number of metres from 20 to 5,000."
  return errors
}

// Only the editable columns that really changed: the update never carries code, name, scope or archive state.
export function detailsPatch(form: DetailsForm, project: Project): Partial<Record<PmEditableField, string | number | null>> {
  const next: Record<PmEditableField, string | number | null> = {
    location: form.location.trim() || null,
    client_name: form.client_name.trim() || null,
    description: form.description.trim() || null,
    phase: form.phase,
    status: form.status,
    start_date: form.start_date || null,
    end_date: form.end_date || null,
    lead_engineer_id: form.lead_engineer_id || null,
    lead_foreman_id: form.lead_foreman_id || null,
    site_lat: form.site_lat.trim() ? Number(form.site_lat) : null,
    site_lng: form.site_lng.trim() ? Number(form.site_lng) : null,
    site_radius_m: Number(form.site_radius_m),
  }
  const before = project as unknown as Record<string, unknown>
  const patch: Partial<Record<PmEditableField, string | number | null>> = {}
  for (const key of PM_EDITABLE_FIELDS) {
    const old = before[key] ?? null
    const value = next[key]
    const same = typeof value === "number" && old !== null ? Number(old) === value : old === value
    if (!same) patch[key] = value
  }
  return patch
}

// Closing, pausing or cancelling a project changes what everyone assigned to it sees: the form asks first.
export const statusNeedsConfirm = (before: ProjectStatus, after: ProjectStatus) => before !== after && (after === "completed" || after === "cancelled" || after === "on_hold")

// Only assigned Project Managers run operations in this workspace, while the project is not archived.
// Company administration has its own workspace; the database re-checks every change.
export function pmAccess(input: { role: string | null | undefined; designation: ManagerSlot | null; archived: boolean }): { manage: boolean; note: string | null } {
  if (input.role === "super_admin") return { manage: false, note: "Super Admin view: this project is run by its assigned Project Manager. Use the Admin pages for company-level changes." }
  if (input.role !== "project_manager" || !input.designation) return { manage: false, note: "You do not manage this project." }
  if (input.archived) return { manage: false, note: "This project is archived and read-only. Ask an Admin to restore it." }
  return { manage: true, note: null }
}

type DashPin = { id: string; title: string; status: string; category: string; due_date: string | null; blueprint_id: string; tasks?: ProgressTask[] }
type DashInspection = { id: string; status: string; title: string; target_at?: string | null; requested_at: string }
type DashDefect = { id: string; status: string; severity: string; title: string; due_date: string | null }
export type Deadline = { id: string; kind: "work" | "ncr" | "milestone"; title: string; date: string; late: boolean }

// The numbers on the Project dashboard: progress, deadlines, what waits for review and the quality issues still open.
export function dashboardSummary(input: { pins: DashPin[]; inspections: DashInspection[]; defects: DashDefect[]; project: Pick<Project, "start_date" | "end_date" | "status">; today: string; horizonDays?: number }) {
  const horizon = input.horizonDays ?? 14
  const work = input.pins.filter((pin) => pin.category !== "note")
  const totals: Totals = summarize(work as Parameters<typeof summarize>[0], input.today)
  const openDefects = input.defects.filter((row) => row.status !== "closed")
  const overdueDefects = openDefects.filter((row) => row.due_date && row.due_date < input.today)
  const pendingReviews = work.filter((pin) => pin.status === "for_review").length
  const openInspections = input.inspections.filter((row) => row.status === "requested" || row.status === "in_progress").length
  const ncrForVerification = openDefects.filter((row) => row.status === "for_verification").length
  const correction = openDefects.filter((row) => row.status === "open" || row.status === "in_progress").length
  const bySeverity = { critical: 0, major: 0, minor: 0 } as Record<string, number>
  for (const row of openDefects) bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1
  const within = (date: string) => daysBetween(input.today, date) <= horizon
  const deadlines: Deadline[] = [
    ...work.filter((pin) => pin.status !== "verified" && pin.due_date && within(pin.due_date)).map((pin) => ({ id: `work:${pin.id}`, kind: "work" as const, title: pin.title, date: pin.due_date as string, late: (pin.due_date as string) < input.today })),
    ...openDefects.filter((row) => row.due_date && within(row.due_date)).map((row) => ({ id: `ncr:${row.id}`, kind: "ncr" as const, title: row.title, date: row.due_date as string, late: (row.due_date as string) < input.today })),
    ...(input.project.end_date && input.project.status !== "completed" && within(input.project.end_date) ? [{ id: "milestone:end", kind: "milestone" as const, title: "Target completion", date: input.project.end_date, late: input.project.end_date < input.today }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
  return {
    totals,
    pendingReviews,
    openInspections,
    reviewsWaiting: pendingReviews + openInspections + ncrForVerification,
    ncrForVerification,
    openNcrs: openDefects.length,
    overdueNcrs: overdueDefects.length,
    correction,
    bySeverity,
    deadlines,
    lateDeadlines: deadlines.filter((row) => row.late).length,
  }
}

export const concernCategories = ["absence", "late", "headcount", "device", "other"] as const
export type ConcernCategory = (typeof concernCategories)[number]
export const concernLabels: Record<ConcernCategory, string> = {
  absence: "Unexplained absence",
  late: "Repeated late arrival",
  headcount: "Head count does not match",
  device: "Scanner or device problem",
  other: "Other",
}

export function concernProblem(input: { day: string; today: string; note: string; category: string }): string | null {
  if (!(concernCategories as readonly string[]).includes(input.category)) return "Choose what kind of concern it is."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return "Choose the day."
  if (input.day > input.today) return "Choose today or an earlier day."
  if (daysBetween(input.day, input.today) > 120) return "Choose a day in the last 120 days."
  const length = input.note.trim().length
  if (length < 5 || length > 500) return "Describe the concern in 5 to 500 characters."
  return null
}
