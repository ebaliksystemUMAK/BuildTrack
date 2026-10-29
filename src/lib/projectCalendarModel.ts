import type { Blueprint, Pin } from "./blueprints"
import type { Project } from "./projects"
import type { Defect, Inspection } from "./qa"
import { defectStatusLabels, inspectionStatusLabels, refNumber } from "./qaModel.ts"
import { manilaDayOf } from "./dateRangeModel.ts"
import { validPhotoDate } from "./photoGalleryModel.ts"
import { pinPlanPath } from "./pinRecordsModel.ts"
import { qaRecordPath } from "./qaAttemptsModel.ts"

export type CalendarRole = "admin" | "project_manager" | "engineer" | "foreman" | "client"
export type CalendarKind = "work" | "inspection" | "reinspection" | "ncr" | "milestone"
export type CalendarView = "month" | "week" | "day" | "schedule"
export type CalendarEvent = {
  id: string; projectId: string; kind: CalendarKind; title: string; date: string; at: string | null
  status: string; location: string; owner: string | null; note: string; completed: boolean
  recordHref: string | null; pinHref: string | null
}
export const calendarKinds: CalendarKind[] = ["work", "inspection", "reinspection", "ncr", "milestone"]
export const calendarLabels: Record<CalendarKind, string> = { work: "Work deadlines", inspection: "QA inspections", reinspection: "Reinspections", ncr: "NCR deadlines", milestone: "Project milestones" }
export const calendarViews: CalendarView[] = ["month", "week", "day", "schedule"]
// Project Managers monitor the whole schedule, QA included (read-only).
export const calendarKindsFor = (role: CalendarRole): CalendarKind[] => role === "engineer" || role === "foreman" || role === "project_manager" ? calendarKinds : ["work", "milestone"]
export const calendarQaAllowed = (role: CalendarRole) => role === "engineer" || role === "foreman" || role === "project_manager"
export const calendarRoleMatches = (role: CalendarRole, actual: string | null | undefined) => role === actual || role === "admin" && actual === "super_admin" || role === "project_manager" && (actual === "admin" || actual === "super_admin")

const time = (day: string) => Date.parse(`${day}T12:00:00Z`)
const iso = (stamp: number) => new Date(stamp).toISOString().slice(0, 10)
export const calendarAddDays = (day: string, amount: number) => iso(time(day) + amount * 86400000)
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`
export function calendarMoveMonth(day: string, amount: number): string {
  const date = new Date(`${monthStart(day)}T12:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + amount)
  const first = iso(date.getTime())
  date.setUTCMonth(date.getUTCMonth() + 1)
  const last = new Date(date.getTime() - 86400000).getUTCDate()
  return `${first.slice(0, 7)}-${String(Math.min(Number(day.slice(8)), last)).padStart(2, "0")}`
}
export const monthEnd = (day: string) => calendarAddDays(monthStart(calendarMoveMonth(day, 1)), -1)
export const calendarWeekStart = (day: string) => calendarAddDays(day, -new Date(time(day)).getUTCDay())
export const calendarMonthDays = (day: string) => Array.from({ length: 42 }, (_, index) => calendarAddDays(calendarWeekStart(monthStart(day)), index))
export function calendarRange(date: string, view: CalendarView) {
  if (view === "day") return { from: date, to: date }
  if (view === "week") { const from = calendarWeekStart(date); return { from, to: calendarAddDays(from, 6) } }
  if (view === "schedule") return { from: monthStart(date), to: monthEnd(date) }
  const days = calendarMonthDays(date)
  return { from: days[0], to: days[41] }
}
export const calendarDateLabel = (day: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" }) => new Date(time(day)).toLocaleDateString("en-PH", { ...options, timeZone: "UTC" })
export const calendarTimeLabel = (at: string | null) => at ? new Date(at).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }) : "All day"
export function readCalendar(search: string, today: string): { date: string; view: CalendarView } {
  const params = new URLSearchParams(search), date = params.get("date") ?? "", view = params.get("view") as CalendarView
  return { date: validPhotoDate(date) && date >= "1900-01-01" && date <= "2199-12-31" ? date : today, view: calendarViews.includes(view) ? view : "month" }
}
export function calendarSearch(search: string, date: string, view: CalendarView) {
  const params = new URLSearchParams(search)
  params.set("date", date); params.set("view", view)
  return `?${params.toString()}`
}
export function calendarFilter(events: CalendarEvent[], input: { from: string; to: string; kinds: CalendarKind[]; query: string; completed: boolean }) {
  const query = input.query.trim().toLowerCase()
  return events.filter(event => event.date >= input.from && event.date <= input.to && input.kinds.includes(event.kind) && (input.completed || !event.completed) && (!query || `${event.title} ${event.location} ${event.owner ?? ""} ${event.status}`.toLowerCase().includes(query)))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(Boolean(a.at)) - Number(Boolean(b.at)) || (a.at ?? "").localeCompare(b.at ?? "") || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

// Read-only projection of canonical project records. No fabricated appointments or persisted duplicate calendar events.
// Client events deliberately contain no internal inspection/NCR data, staff identities, remarks or private evidence.
export function projectCalendarEvents(input: { role: CalendarRole; userId: string | null; project: Project; pins: Pin[]; blueprints: Blueprint[]; inspections: Inspection[]; defects: Defect[]; nameOf: (id: string | null) => string }) {
  const { role, userId, project } = input
  const pins = input.pins.filter(pin => pin.project_id === project.id && pin.category !== "note")
  const pinById = new Map(pins.map(pin => [pin.id, pin]))
  const sheets = new Map(input.blueprints.filter(sheet => sheet.project_id === project.id).map(sheet => [sheet.id, sheet.title]))
  const events: CalendarEvent[] = []
  let undated = 0
  const pinHref = (id: string | null, section: "details" | "issues" = "details") => {
    const pin = id ? pinById.get(id) : null
    return pin ? pinPlanPath(role, { projectId: project.id, pinId: pin.id, sheetId: pin.blueprint_id, section }) : null
  }
  const location = (id: string | null) => { const pin = id ? pinById.get(id) : null; return pin ? `${sheets.get(pin.blueprint_id) ?? "Blueprint"} · ${pin.title}` : "Project-wide" }
  for (const pin of pins) {
    if (role === "foreman" && (!userId || pin.assigned_to !== userId)) continue
    if (!pin.due_date || !validPhotoDate(pin.due_date)) { undated++; continue }
    const status = pin.status === "verified" ? "Completed" : pin.status === "not_started" ? "Not started" : "In progress"
    events.push({ id: `work:${pin.id}`, projectId: project.id, kind: "work", title: pin.title, date: pin.due_date, at: null, status, location: location(pin.id), owner: role === "client" ? null : input.nameOf(pin.assigned_to), note: "Planned completion date from the work pin. Change the original pin to update this calendar.", completed: pin.status === "verified", recordHref: pinHref(pin.id), pinHref: pinHref(pin.id) })
  }
  if (calendarQaAllowed(role)) {
    for (const row of input.inspections) {
      if (row.project_id !== project.id || row.status === "cancelled") continue
      if (role === "foreman" && (!userId || row.requested_by !== userId && (!row.pin_id || pinById.get(row.pin_id)?.assigned_to !== userId))) continue
      const date = manilaDayOf(row.target_at)
      if (!date) { undated++; continue }
      const kind = row.reinspection_of ? "reinspection" : "inspection"
      events.push({ id: `inspection:${row.id}`, projectId: project.id, kind, title: `${refNumber("ir", row.number)} · ${row.title}`, date, at: row.target_at ?? null, status: inspectionStatusLabels[row.status], location: location(row.pin_id), owner: input.nameOf(row.inspector_id ?? row.escalation_owner ?? null), note: "Inspection target time in Philippine time. This is a target, not an invented meeting duration.", completed: ["passed", "conditional", "failed"].includes(row.status), recordHref: qaRecordPath(role as "engineer" | "foreman" | "project_manager", project.id, "inspection", row.id), pinHref: pinHref(row.pin_id, "issues") })
    }
    for (const row of input.defects) {
      if (row.project_id !== project.id || role === "foreman" && (!userId || row.assigned_to !== userId)) continue
      if (!row.due_date || !validPhotoDate(row.due_date)) { undated++; continue }
      events.push({ id: `ncr:${row.id}`, projectId: project.id, kind: "ncr", title: `${refNumber("ncr", row.number)} · ${row.title}`, date: row.due_date, at: null, status: defectStatusLabels[row.status], location: location(row.pin_id), owner: input.nameOf(row.assigned_to), note: "Corrective action deadline from the NCR. Closing or changing the NCR updates this event.", completed: row.status === "closed", recordHref: qaRecordPath(role as "engineer" | "foreman" | "project_manager", project.id, "defect", row.id), pinHref: pinHref(row.pin_id, "issues") })
    }
  }
  for (const [key, title, date] of [["start", "Project start", project.start_date], ["end", "Target completion", project.end_date]] as const) {
    if (date && validPhotoDate(date)) events.push({ id: `milestone:${key}:${project.id}`, projectId: project.id, kind: "milestone", title, date, at: null, status: project.status === "completed" ? "Project completed" : "Planned", location: project.location ?? "Project site", owner: null, note: "Planned project date. It does not mean the work has been completed or approved.", completed: project.status === "completed", recordHref: null, pinHref: null })
  }
  return { events, undated }
}
