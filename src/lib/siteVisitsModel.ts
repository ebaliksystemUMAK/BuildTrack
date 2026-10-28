export type SiteVisitStatus = "requested" | "confirmed" | "declined" | "cancelled"
export type SiteVisit = {
  id: string; project_id: string; client_id: string; preferred_at: string; purpose: string; visitors: number
  status: SiteVisitStatus; engineer_note: string | null; responded_by: string | null; responded_at: string | null
  created_at: string; updated_at: string
}
export type SiteVisitDraft = { date: string; time: string; purpose: string; visitors: number }
export const visitStatusLabels: Record<SiteVisitStatus, string> = { requested: "Awaiting engineer", confirmed: "Confirmed", declined: "Declined", cancelled: "Cancelled" }
export const visitStatusTone: Record<SiteVisitStatus, string> = {
  requested: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100",
  confirmed: "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-100",
  declined: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100",
  cancelled: "bg-surface-muted text-fg-muted",
}
export const visitStamp = (iso: string) => new Date(iso).toLocaleString("en-PH", {
  timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
})
export function visitDraftProblem(draft: SiteVisitDraft, now = Date.now()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return "Choose a visit date and time."
  const date = new Date(`${draft.date}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== draft.date) return "Choose a valid visit date."
  if (new Date(`${draft.date}T${draft.time}:00+08:00`).getTime() <= now) return "Choose a future visit date and time (Manila time)."
  if (draft.purpose.trim().length < 5 || draft.purpose.trim().length > 1000) return "Describe the purpose of your visit (5–1,000 characters)."
  if (!Number.isInteger(draft.visitors) || draft.visitors < 1 || draft.visitors > 50) return "Enter between 1 and 50 visitors."
  return ""
}
