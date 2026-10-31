import { manilaToday } from "./progress.ts"
import { reportHtml } from "./printReport.ts"

export type Weather = "sunny" | "cloudy" | "rainy" | "stormy"
// A daily report link: the work pin and the checklist item (work item) worked on that day.
export type ReportWork = { pin_id: string; item_id: string | null }
export type DailyReport = {
  linked_work?: ReportWork[]
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
      ...((report.linked_work ?? []).length ? [{ heading: "Linked work", table: { head: ["Work pin and task"], rows: (report.linked_work ?? []).map(row => [workLabel(row)]) } }] : []),
      { heading: "Engineer review", rows: [["Review", report.review_state ?? "pending"], ["Revision", String(report.revision ?? 0)], ["Feedback", report.review_note || "Awaiting review"], ["Reviewed at", report.reviewed_at ? new Date(report.reviewed_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "-"]] },
      { heading: "Status", rows: [["Report status", report.status === "submitted" ? "Submitted" : "Draft"], ["Submitted at", report.submitted_at ? new Date(report.submitted_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "-"]] },
    ],
  })
}
