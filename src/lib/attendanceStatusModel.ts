// Daily time record wording and statuses. Pure. The status itself comes from the database function
// attendance_daily_status (20261028010000): one Time IN and one Time OUT per worker per Philippine day.
import { minutesText } from "./attendanceScheduleModel.ts"

export type DailyStatus = "on_time" | "late" | "present" | "absent" | "not_in_yet" | "rest_day" | "no_schedule" | "not_enrolled"
export type DailyStatusRow = {
  day: string
  worker_id: string
  full_name: string
  worker_code: string
  trade: string
  time_in: string | null
  time_out: string | null
  status: DailyStatus
  late_minutes: number | null
  early_minutes: number | null
}

export const directionLabel = (direction: "in" | "out" | string) => (direction === "out" ? "Time out" : "Time in")

const labels: Record<DailyStatus, string> = {
  on_time: "On time", late: "Late", present: "Present", absent: "Absent", not_in_yet: "Not in yet",
  rest_day: "Rest day", no_schedule: "No schedule", not_enrolled: "No fingerprint",
}
export function dailyStatusLabel(row: Pick<DailyStatusRow, "status" | "late_minutes">) {
  return row.status === "late" && row.late_minutes ? `Late ${minutesText(row.late_minutes)}` : labels[row.status] ?? "—"
}
export const dailyStatusTone = (status: DailyStatus) =>
  status === "on_time" || status === "present" ? "ok" : status === "late" || status === "not_in_yet" ? "warn" : status === "absent" ? "bad" : "muted"

// Undertime is only about leaving before the scheduled time out.
export const undertimeLabel = (row: Pick<DailyStatusRow, "early_minutes">) => (row.early_minutes ? `Early out ${minutesText(row.early_minutes)}` : "")

export function dailyStatusCounts(rows: Pick<DailyStatusRow, "status">[]) {
  const counts = { on_time: 0, late: 0, absent: 0, not_in_yet: 0, present: 0 }
  for (const row of rows) if (row.status in counts) counts[row.status as keyof typeof counts]++
  return counts
}
