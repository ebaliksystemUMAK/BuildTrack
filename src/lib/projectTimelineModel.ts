import {
  calendarAddDays,
  type CalendarEvent,
  type CalendarRole,
} from "./projectCalendarModel.ts"
import { pinPlanPath } from "./pinRecordsModel.ts"

export type TimelinePlan = {
  title: string
  phase: string
  planned_start: string | null
  planned_end: string | null
  actual_start: string | null
  actual_end: string | null
  predecessors: string[]
}
export type TimelineView = "timeline" | "requests" | "unscheduled" | "history"
export function timelineViewFromSearch(search: string): TimelineView {
  const view = new URLSearchParams(search).get("ganttview")
  return view === "requests" || view === "unscheduled" || view === "history" ? view : "timeline"
}
export type TimelineItem = TimelinePlan & {
  key: string
  kind: "work" | "milestone"
  pin_id?: string | null
  item_id?: string | null
  blueprint_id?: string | null
  pin_title?: string
  location?: string
  assigned_to?: string | null
  owner?: string
  verified: boolean
  blocked?: boolean
  revision?: number
  reported_percent?: number | null
  report_id?: string | null
  report_date?: string | null
  reported_start?: string | null
  reported_end?: string | null
}
export type TimelineRequest = {
  id: string
  work_key: string
  proposal: TimelinePlan
  expected_revision: number
  reason: string
  status: "draft" | "pending" | "approved" | "rejected" | "superseded"
  approved_plan?: TimelinePlan | null
  created_at: string
  review_note: string | null
}
export type TimelineData = {
  items: TimelineItem[]
  baseline: TimelineItem[]
  requests: TimelineRequest[]
  can_edit: boolean
  can_request: boolean
  version: number
  published_at: string | null
}
export type TimelineZoom = "day" | "week" | "month"
export const timelinePhases = [
  "Preparation",
  "Foundation",
  "Structural",
  "Architectural",
  "MEP",
  "Turnover",
  "Unassigned",
]
// Both calendar views read the saved schedule. Keep the original pin deadline until every
// visible task on that pin has its own schedule; that deadline still covers its unscheduled work.
export function timelineCalendarEvents(
  events: CalendarEvent[],
  items: TimelineItem[],
  projectId: string,
  role: CalendarRole,
): CalendarEvent[] {
  const scheduled = items.filter(
    (item) => item.planned_start && item.planned_end,
  )
  const replacedPins = new Set(
    scheduled
      .filter(
        (item) =>
          item.pin_id &&
          !items.some(
            (other) =>
              other.pin_id === item.pin_id &&
              (!other.planned_start || !other.planned_end),
          ),
      )
      .map((item) => item.pin_id),
  )
  const base = events.filter(
    (event) =>
      event.kind !== "work" ||
      !replacedPins.has(event.id.replace(/^work:/, "")),
  )
  return [
    ...base,
    ...scheduled.map((item) => {
      const href = item.pin_id
        ? pinPlanPath(role, {
            projectId,
            pinId: item.pin_id,
            sheetId: item.blueprint_id,
            section: "checklist",
          })
        : null
      return {
        id: `timeline:${item.key}`,
        projectId,
        kind:
          item.kind === "milestone" ? "milestone" as const : "work" as const,
        title: item.title,
        date: item.planned_end!,
        at: null,
        status: item.verified
          ? "Verified"
          : item.kind === "milestone" && item.actual_end
            ? "Reached"
            : "Scheduled",
        location: item.location ?? "Project-wide",
        owner: role === "client" ? null : (item.owner ?? null),
        note: `Scheduled ${item.planned_start} to ${item.planned_end}. Open Gantt Timeline to view the duration, dependencies and schedule changes.`,
        completed:
          item.verified ||
          (item.kind === "milestone" && Boolean(item.actual_end)),
        recordHref: href,
        pinHref: href,
      }
    }),
  ]
}
export function timelinePlan(item: TimelineItem): TimelinePlan {
  return {
    title: item.title,
    phase: item.phase,
    planned_start: item.planned_start,
    planned_end: item.planned_end,
    actual_start: item.actual_start,
    actual_end: item.actual_end,
    predecessors: [...item.predecessors],
  }
}
export const timelineDays = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86400000,
  )
export function timelineStatus(item: TimelineItem, today: string) {
  if (item.verified) return "Verified"
  if (item.kind === "milestone" && item.actual_end) return "Reached"
  if (!item.planned_start || !item.planned_end) return "Unscheduled"
  if (item.blocked) return "Blocked"
  if (item.planned_end < today) return "Overdue"
  if (
    item.actual_start ||
    item.reported_start ||
    (item.reported_percent ?? 0) > 0
  )
    return "In progress"
  return "Not started"
}
// Geometry uses day offsets on every zoom; date labels are windowed for long projects.
export function timelineGeometry(
  items: TimelineItem[],
  today: string,
  zoom: TimelineZoom,
) {
  const dates = items
    .flatMap((row) => [
      row.planned_start,
      row.planned_end,
      row.actual_start,
      row.actual_end,
    ])
    .filter((date): date is string => Boolean(date))
    .sort()
  const from = calendarAddDays(dates[0] ?? today, -3)
  const last = dates[dates.length - 1] ?? calendarAddDays(today, 30)
  const to = calendarAddDays(last, 7)
  const days = Math.max(14, timelineDays(from, to) + 1)
  const unit = zoom === "day" ? 34 : zoom === "week" ? 26 : 20
  return { from, to, days, width: Math.max(650, days * unit), unit }
}

// Every calendar day is available while scrolling, without creating years of offscreen labels.
export function timelineDateAxis(geometry: { from: string; days: number; width: number }, left = 0, viewportWidth = 1200) {
  const cell = geometry.width / geometry.days
  const first = Math.min(geometry.days - 1, Math.max(0, Math.floor(left / cell) - 7))
  const last = Math.min(geometry.days, Math.max(first + 1, Math.ceil((left + viewportWidth) / cell) + 7))
  const dates = Array.from({ length: last - first }, (_, index) => ({ offset: first + index, date: calendarAddDays(geometry.from, first + index) }))
  const months: Array<{ date: string; offset: number; days: number }> = []
  for (const day of dates) {
    const previous = months[months.length - 1]
    if (previous?.date.slice(0, 7) === day.date.slice(0, 7)) previous.days++
    else months.push({ date: day.date, offset: day.offset, days: 1 })
  }
  return { dates, months }
}
export function timelineBar(
  start: string | null,
  end: string | null,
  from: string,
  days: number,
) {
  if (!start || !end || end < start) return null
  const left = Math.max(0, timelineDays(from, start)),
    right = Math.min(days, timelineDays(from, end) + 1)
  if (right <= left) return null
  return {
    left: `${(left / days) * 100}%`,
    width: `${((right - left) / days) * 100}%`,
  }
}
export function timelinePlanProblem(
  plan: TimelinePlan,
  key: string,
  items: TimelineItem[],
) {
  if (!plan.phase.trim() || plan.phase.trim().length > 80)
    return "Enter a phase of 1 to 80 characters."
  if (key.startsWith("milestone:") && !plan.title.trim())
    return "Enter a milestone title."
  if (Boolean(plan.planned_start) !== Boolean(plan.planned_end))
    return "Enter both planned dates, or clear both to leave the task unscheduled."
  if (
    plan.planned_start &&
    plan.planned_end &&
    plan.planned_end < plan.planned_start
  )
    return "Planned finish must be on or after the start."
  if (
    key.startsWith("milestone:") &&
    (!plan.planned_start || plan.planned_start !== plan.planned_end)
  )
    return "A milestone needs the same planned start and finish date."
  if (
    plan.actual_end &&
    (!plan.actual_start || plan.actual_end < plan.actual_start)
  )
    return "Actual finish needs an actual start on or before it."
  if (
    plan.predecessors.length > 20 ||
    new Set(plan.predecessors).size !== plan.predecessors.length
  )
    return "Choose up to 20 distinct predecessors."
  for (const dep of plan.predecessors) {
    const before = items.find((row) => row.key === dep)
    if (
      dep === key ||
      !plan.planned_start ||
      !before?.planned_start ||
      !before.planned_end ||
      before.planned_end >= plan.planned_start
    )
      return "Each predecessor must finish before this task starts."
  }
  if (
    items.some(
      (row) =>
        row.key !== key &&
        row.predecessors.includes(key) &&
        (!plan.planned_end ||
          (row.planned_start && plan.planned_end >= row.planned_start)),
    )
  )
    return "This change conflicts with a dependent task. Update its dependencies first."
  return ""
}
