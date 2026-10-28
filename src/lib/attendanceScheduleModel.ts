// Project attendance schedule (Admin > Biometric Registration > Attendance schedule) and how a recorded scan compares
// with it. Pure. The decision itself (IN/OUT, repeat / out-of-order, late / early out) is made only by the database
// function record_biometric_scan (20261027130000); these helpers validate the form and label its results.

export type AttendanceSchedule = {
  project_id: string
  time_in: string
  time_out: string
  grace_minutes: number
  repeat_guard_minutes: number
  // ISO weekdays (1 = Monday ... 7 = Sunday); a day off is a rest day, never absent. Since 20261028010000.
  work_days?: number[]
  updated_at?: string | null
  updated_by?: string | null
}
export type ScheduleDraft = { timeIn: string; timeOut: string; grace: string; repeat: string; workDays: number[] }
export type ScheduleFlag = "on_time" | "late" | "early_out" | "returned" | "no_schedule"

export const defaultScheduleDraft: ScheduleDraft = { timeIn: "08:00", timeOut: "17:00", grace: "15", repeat: "15", workDays: [1, 2, 3, 4, 5, 6] }
export const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

// "Mon–Sat", "Mon–Fri, Sun", "Every day".
export function workDaysText(days: number[]) {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b)
  if (sorted.length === 7) return "Every day"
  const parts: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j - i >= 2 ? `${weekdayNames[sorted[i] - 1]}–${weekdayNames[sorted[j] - 1]}` : sorted.slice(i, j + 1).map((d) => weekdayNames[d - 1]).join(", "))
    i = j
  }
  return parts.join(", ")
}

const hhmm = (value: string) => value.slice(0, 5)
const toMinutes = (value: string) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
const clock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

export function scheduleDraft(schedule: AttendanceSchedule | null): ScheduleDraft {
  if (!schedule) return defaultScheduleDraft
  return { timeIn: hhmm(schedule.time_in), timeOut: hhmm(schedule.time_out), grace: String(schedule.grace_minutes), repeat: String(schedule.repeat_guard_minutes), workDays: schedule.work_days?.length ? [...schedule.work_days].sort((a, b) => a - b) : defaultScheduleDraft.workDays }
}

const wholeMinutes = (value: string, min: number, max: number) => /^\d{1,3}$/.test(value.trim()) && Number(value) >= min && Number(value) <= max

// Same limits as set_attendance_schedule.
export function scheduleProblem(draft: ScheduleDraft) {
  const timeIn = toMinutes(draft.timeIn), timeOut = toMinutes(draft.timeOut)
  if (timeIn === null) return "Enter the time in (HH:MM)."
  if (timeOut === null) return "Enter the time out (HH:MM)."
  if (timeOut <= timeIn) return "Time out must be later than time in on the same day."
  if (!wholeMinutes(draft.grace, 0, 120)) return "Grace period must be 0 to 120 whole minutes."
  if (!wholeMinutes(draft.repeat, 1, 120)) return "Repeat-scan window must be 1 to 120 whole minutes."
  if (!draft.workDays.some((d) => d >= 1 && d <= 7)) return "Choose at least one working day."
  return ""
}

export function minutesText(minutes: number) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return hours ? (rest ? `${hours} h ${rest} min` : `${hours} h`) : `${rest} min`
}

// One line the Admin, Foreman and reports can show.
export function scheduleSummary(schedule: AttendanceSchedule | ScheduleDraft) {
  const draft = "timeIn" in schedule ? schedule : scheduleDraft(schedule)
  const start = toMinutes(draft.timeIn)
  const lateAfter = start === null ? draft.timeIn : clock(start + Number(draft.grace || 0))
  return `${workDaysText(draft.workDays)} · Time in ${draft.timeIn} (late after ${lateAfter}) · Time out ${draft.timeOut} · repeat scans within ${draft.repeat} min ignored`
}

export function scheduleFlagLabel(flag: string | null | undefined, minutes: number | null | undefined) {
  if (flag === "late") return minutes ? `Late ${minutesText(minutes)}` : "Late"
  if (flag === "early_out") return minutes ? `Early out ${minutesText(minutes)}` : "Early out"
  if (flag === "on_time") return "On time"
  if (flag === "returned") return "Back on site"
  return ""
}
export const scheduleFlagTone = (flag: string | null | undefined) =>
  flag === "late" || flag === "early_out" ? "warn" : flag === "on_time" || flag === "returned" ? "ok" : "none"
