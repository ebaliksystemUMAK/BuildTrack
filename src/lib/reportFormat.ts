import { manilaToday } from "./progress.ts"
import { reportHtml } from "./printReport.ts"

export type Weather = "sunny" | "cloudy" | "rainy" | "stormy"
// A daily report link: the work pin and the checklist item (work item) worked on that day.
export type ReportWork = { pin_id: string; item_id: string | null }
// One task's progress on a daily report (daily_report_entries): the Foreman's record of that day. Clients never receive it (work_done reaches them
// through the report's summary, which is built from it), and official progress still comes only from Engineer-approved tasks. Its photos are
// daily_report_photos rows with entry_id set.
export type ReportEntry = ReportWork & { id: string; work_done: string; percent: number | null; notes: string; issues: string; manpower: number | null }
export type SavedReportEntry = ReportEntry & { position: number }
export type DailyReport = {
  linked_work?: ReportWork[]
  daily_report_entries?: SavedReportEntry[] // read only by the project team (useDailyReports with entries)
  review_state?: "pending" | "reviewed" | "returned"
  review_note?: string | null
  reviewed_by?: string | null
  reviewed_at?: string | null
  revision?: number
  id: string
  project_id: string
  report_date: string
  author_id: string
  weather: Weather
  workers_count: number
  workers_source?: "manual" | "biometrics"
  workers_synced_at?: string | null
  work_done: string
  issues: string | null
  delays: string | null
  safety: string | null
  status: "draft" | "submitted"
  submitted_at: string | null
  removed_at?: string | null
  created_at: string
  updated_at: string
}

export const weatherLabels: Record<Weather, string> = { sunny: "Sunny", cloudy: "Cloudy", rainy: "Rainy", stormy: "Stormy" }

export const reportDateLong = (isoDate: string) => new Date(isoDate + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", day: "numeric", month: "short", year: "numeric" })

// The dates a foreman may still write a report for (today and the 13 days before, matching the database rule).
export function reportableDates(today = manilaToday()): string[] {
  const base = new Date(today + "T00:00:00Z").getTime()
  return Array.from({ length: 14 }, (_, index) => new Date(base - index * 86_400_000).toISOString().slice(0, 10))
}

export function reportError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "You already have a report for that day."
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message)) return "You are not allowed to do that."
  if (/network|fetch/i.test(error.message)) return "Network problem. Check your connection and try again."
  return error.message
}

export function linkedWorkLabel(work: ReportWork, pinTitle: (id: string) => string | undefined, itemText: (id: string) => string | undefined) {
  const pin = pinTitle(work.pin_id) ?? "Work pin"
  return work.item_id ? `${pin} → ${itemText(work.item_id) ?? "Task"}` : pin
}

export const ENTRY_TEXT_LIMIT = 2000
export const sameWork = (a: ReportWork, b: ReportWork) => a.pin_id === b.pin_id && (a.item_id ?? null) === (b.item_id ?? null)
export const blankEntry = (id: string, work: ReportWork = { pin_id: "", item_id: null }): ReportEntry => ({ id, pin_id: work.pin_id, item_id: work.item_id ?? null, work_done: "", percent: null, notes: "", issues: "", manpower: null })
export const savedEntries = (report: Pick<DailyReport, "daily_report_entries">) => [...(report.daily_report_entries ?? [])].sort((a, b) => a.position - b.position)

export type ReportProgress = { percent: number; date: string; submittedAt: string; entryId: string }
export type ReportProgressHistory = ReadonlyMap<string, ReportProgress>
export const reportProgressKey = (work: ReportWork) => `${work.pin_id}:${work.item_id ?? ""}`

// Use the latest submitted total BEFORE the selected report date, including reports by a previous assignee.
// Match Gantt's report-date/submission/entry ordering. Drafts, returned/removed reports and future dates never seed progress.
export function previousTaskProgress(reports: DailyReport[], projectId: string | null, date: string): ReportProgressHistory {
  const history = new Map<string, ReportProgress>()
  for (const report of reports) {
    if (report.project_id !== projectId || report.report_date >= date || report.status !== "submitted" || report.review_state === "returned" || report.removed_at) continue
    for (const entry of report.daily_report_entries ?? []) {
      if (entry.percent === null || !Number.isInteger(entry.percent) || entry.percent < 0 || entry.percent > 100) continue
      const key = reportProgressKey(entry), previous = history.get(key)
      const next = { percent: entry.percent, date: report.report_date, submittedAt: report.submitted_at ?? "", entryId: entry.id }
      if (!previous || next.date > previous.date || (next.date === previous.date && (next.submittedAt > previous.submittedAt || (next.submittedAt === previous.submittedAt && next.entryId > previous.entryId)))) history.set(key, next)
    }
  }
  return history
}

// Fill only missing values when opening a draft or adding a linked task. Saved or typed totals are never added twice or replaced.
export const carryForwardProgress = (entries: ReportEntry[], history: ReportProgressHistory): ReportEntry[] => entries.map(entry => {
  const previous = history.get(reportProgressKey(entry))
  return entry.percent === null && previous ? { ...entry, percent: previous.percent } : entry
})

// The report's entries, then any link saved before entries existed, so an older draft keeps the work it linked.
export function reportEntries(report: Pick<DailyReport, "daily_report_entries" | "linked_work">, newId: () => string): ReportEntry[] {
  const saved: ReportEntry[] = savedEntries(report).map(({ id, pin_id, item_id, work_done, percent, notes, issues, manpower }) => ({ id, pin_id, item_id, work_done: work_done ?? "", percent, notes, issues, manpower }))
  return [...saved, ...(report.linked_work ?? []).filter(link => !saved.some(entry => sameWork(entry, link))).map(link => blankEntry(newId(), link))]
}

// A summary written before tasks had their own box moves to the first task, so it is neither lost nor shown twice.
export const moveSummaryToTask = (entries: ReportEntry[], summary: string) =>
  entries.length && summary.trim() && !entries.some(entry => entry.work_done.trim()) ? entries.map((entry, index) => index ? entry : { ...entry, work_done: summary }) : entries

const wholeInRange = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max
// What is wrong with one entry ("" = nothing). Mirrors save_daily_report and require_complete_report_entries, which have the final word.
export function entryProblem(entry: ReportEntry, entries: ReportEntry[], items: { id: string; pin_id: string }[], submitting: boolean): string {
  if (!entry.pin_id) return "Choose the task."
  if (!entry.item_id && items.some(item => item.pin_id === entry.pin_id)) return "Choose the task worked on for this pin."
  if (entry.item_id && items.length && !items.some(item => item.id === entry.item_id && item.pin_id === entry.pin_id)) return "This task is no longer available. Choose another."
  if (entries.some(other => other.id !== entry.id && sameWork(other, entry))) return "This task already has an entry in this report."
  if (submitting && entry.work_done.trim().length < 5) return "Describe the work completed on this task (at least 5 characters)."
  if (entry.percent === null) { if (submitting) return "Enter the percentage completed." }
  else if (!wholeInRange(entry.percent, 100)) return "Percentage completed must be a whole number from 0 to 100."
  if (entry.manpower !== null && !wholeInRange(entry.manpower, 5000)) return "Manpower must be a whole number from 0 to 5000."
  if ([entry.work_done, entry.notes, entry.issues].some(text => text.length > ENTRY_TEXT_LIMIT)) return `Keep each box under ${ENTRY_TEXT_LIMIT} characters.`
  return ""
}

export type ReportSave = { projectId: string; date: string; values: { weather: Weather; work_done: string; status: "draft" | "submitted" }; entries: ReportEntry[] }
// Arguments of save_daily_report: the report and all its entries are saved together, from the form and from the offline queue.
export const saveReportArgs = ({ projectId, date, values, entries }: ReportSave) => ({
  p_project: projectId, p_date: date, p_weather: values.weather, p_work_done: values.work_done, p_status: values.status,
  // work_done may be missing from a copy queued on this device before tasks had their own box.
  p_entries: entries.map(({ id, pin_id, item_id, work_done, percent, notes, issues, manpower }) => ({ id, pin_id, item_id: item_id || null, work_done: work_done?.trim() ?? "", percent, notes: notes.trim(), issues: issues.trim(), manpower })),
})

export function dailyReportHtml(report: DailyReport, project: { code: string; name: string; location: string | null }, authorName: string, workLabel: (work: ReportWork) => string = (work) => work.pin_id): string {
  return reportHtml({
    title: "Daily site report",
    subtitle: `${project.name} (${project.code})${project.location ? " - " + project.location : ""}`,
    meta: [
      ["Date", reportDateLong(report.report_date)],
      ["Prepared by", authorName],
      ["Weather", weatherLabels[report.weather]],
      [report.workers_source === "biometrics" ? "Workers present (biometrics)" : "Workers on site", String(report.workers_count)],
    ],
    sections: [
      { heading: "Work done", body: report.work_done || "-" },
      // Issues, delays and safety are no longer asked for; older reports that have them still print them.
      ...(report.issues ? [{ heading: "Issues and problems", body: report.issues }] : []),
      ...(report.delays ? [{ heading: "Delays", body: report.delays }] : []),
      ...(report.safety ? [{ heading: "Safety", body: report.safety }] : []),
      // Staff print the task entries; older reports (and anyone without entries) keep the plain list of links.
      ...(report.daily_report_entries?.length ? [{ heading: "Task progress", table: { head: ["Work pin and task", "Work completed", "Completed", "Manpower", "Daily notes", "Issues"], rows: savedEntries(report).map(entry => [workLabel(entry), entry.work_done || "-", entry.percent === null ? "-" : `${entry.percent}%`, entry.manpower === null ? "-" : String(entry.manpower), entry.notes || "-", entry.issues || "-"]) } }]
        : (report.linked_work ?? []).length ? [{ heading: "Linked work", table: { head: ["Work pin and task"], rows: (report.linked_work ?? []).map(row => [workLabel(row)]) } }] : []),
      { heading: "Engineer review", rows: [["Review", report.review_state ?? "pending"], ["Revision", String(report.revision ?? 0)], ["Feedback", report.review_note || "Awaiting review"], ["Reviewed at", report.reviewed_at ? new Date(report.reviewed_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "-"]] },
      { heading: "Status", rows: [["Report status", report.status === "submitted" ? "Submitted" : "Draft"], ["Submitted at", report.submitted_at ? new Date(report.submitted_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "-"]] },
    ],
  })
}
