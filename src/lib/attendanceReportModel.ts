import { attendanceDay, attendanceTime } from "./attendanceModel.ts"
import { validAttendanceDay } from "./foremanAttendanceModel.ts"
import { scheduleFlagLabel } from "./attendanceScheduleModel.ts"
import type { DailyStatusRow } from "./attendanceStatusModel.ts"

export type AttendanceReportPeriod = "daily" | "weekly" | "monthly" | "custom"
export type AttendanceReportPerson = { id: string; full_name: string; worker_code: string; trade: string }
export type AttendanceReportEvent = {
  id: string
  project_id: string
  worker_id: string
  direction: "in" | "out"
  occurred_at: string
  received_at: string
  device_id: string
  schedule_flag?: string | null
  minutes_off?: number | null
  worker: AttendanceReportPerson | null
}
export type AttendanceReportRange = {
  period: AttendanceReportPeriod
  startDay: string
  endDay: string
  throughDay: string
  start: string
  endExclusive: string
}
export type AttendanceReportData = {
  project: { id: string; name: string; code: string }
  worker: AttendanceReportPerson | null
  range: AttendanceReportRange
  events: AttendanceReportEvent[]
  // Complete daily records, including workers without scans. Never substitute a scan-only report.
  days: DailyStatusRow[]
  generatedBy: string
  generatedAt: string
}
export type AttendanceDailyRow = {
  day: string
  workerId: string
  name: string
  code: string
  trade: string
  clockIns: number
  clockOuts: number
  firstIn: string | null
  lastOut: string | null
  // How the first IN and the last OUT compared with the project schedule ("" when not recorded or no schedule).
  arrival: string
  departure: string
}

// Present includes on-time and late arrivals. Late is a subset, not an additional attendance day.
export function attendanceReportCounts(days: DailyStatusRow[]) {
  return days.reduce((counts, row) => {
    if (row.status === "on_time" || row.status === "late" || row.status === "present") counts.present++
    if (row.status === "absent") counts.absent++
    if (row.status === "late") counts.late++
    return counts
  }, { present: 0, absent: 0, late: 0 })
}

// Permanent worker IDs keep workers with matching names or codes separate.
export function attendanceReportWorkers(days: DailyStatusRow[]) {
  const workers = new Map<string, { workerId: string; name: string; code: string; trade: string; present: number; absent: number; late: number }>()
  for (const day of days) {
    let worker = workers.get(day.worker_id)
    if (!worker) {
      worker = { workerId: day.worker_id, name: day.full_name, code: day.worker_code, trade: day.trade, present: 0, absent: 0, late: 0 }
      workers.set(day.worker_id, worker)
    }
    const counts = attendanceReportCounts([day])
    worker.present += counts.present; worker.absent += counts.absent; worker.late += counts.late
  }
  return [...workers.values()].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code) || a.workerId.localeCompare(b.workerId))
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10)
export function attendanceReportRange(period: AttendanceReportPeriod, anchor: string, today = attendanceDay(), endDay?: string): AttendanceReportRange {
  if (!["daily", "weekly", "monthly", "custom"].includes(period) || !validAttendanceDay(anchor, today)) throw new Error("Choose a valid report period and a date no later than today.")
  const start = new Date(`${anchor}T00:00:00Z`), end = new Date(start)
  if (period === "weekly") {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
    end.setTime(start.getTime()); end.setUTCDate(end.getUTCDate() + 6)
  } else if (period === "monthly") {
    start.setUTCDate(1)
    end.setUTCDate(1); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0)
  } else if (period === "custom") {
    if (!endDay || !validAttendanceDay(endDay, today)) throw new Error("Choose valid From and To dates no later than today.")
    if (endDay < anchor) throw new Error("The To date must be on or after the From date.")
    end.setTime(new Date(`${endDay}T00:00:00Z`).getTime())
  }
  const startDay = isoDay(start), lastDay = isoDay(end), throughDay = lastDay < today ? lastDay : today
  const until = new Date(`${throughDay}T00:00:00+08:00`)
  until.setTime(until.getTime() + 86400000)
  return { period, startDay, endDay: lastDay, throughDay, start: new Date(`${startDay}T00:00:00+08:00`).toISOString(), endExclusive: until.toISOString() }
}

// attendance_daily_status accepts at most 63 inclusive days per call.
export function attendanceReportWindows(range: AttendanceReportRange) {
  const windows: Array<{ startDay: string; endDay: string }> = []
  const cursor = new Date(`${range.startDay}T00:00:00Z`)
  while (isoDay(cursor) <= range.throughDay) {
    const startDay = isoDay(cursor)
    cursor.setUTCDate(cursor.getUTCDate() + 62)
    const endDay = isoDay(cursor) < range.throughDay ? isoDay(cursor) : range.throughDay
    windows.push({ startDay, endDay })
    cursor.setTime(new Date(`${endDay}T00:00:00Z`).getTime())
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return windows
}

export function attendanceReportSummary(events: AttendanceReportEvent[]) {
  const groups = new Map<string, AttendanceDailyRow>()
  let clockIns = 0, clockOuts = 0
  for (const event of events) {
    const day = attendanceDay(new Date(event.occurred_at)), key = `${day}:${event.worker_id}`
    let row = groups.get(key)
    if (!row) {
      row = { day, workerId: event.worker_id, name: event.worker?.full_name ?? "Worker unavailable", code: event.worker?.worker_code ?? event.worker_id, trade: event.worker?.trade || "Site worker", clockIns: 0, clockOuts: 0, firstIn: null, lastOut: null, arrival: "", departure: "" }
      groups.set(key, row)
    }
    if (event.direction === "in") {
      clockIns++; row.clockIns++
      if (!row.firstIn || Date.parse(event.occurred_at) < Date.parse(row.firstIn)) { row.firstIn = event.occurred_at; row.arrival = scheduleFlagLabel(event.schedule_flag, event.minutes_off) }
    } else {
      clockOuts++; row.clockOuts++
      if (!row.lastOut || Date.parse(event.occurred_at) > Date.parse(row.lastOut)) { row.lastOut = event.occurred_at; row.departure = scheduleFlagLabel(event.schedule_flag, event.minutes_off) }
    }
  }
  return {
    scans: events.length, clockIns, clockOuts,
    late: [...groups.values()].filter(row => row.arrival.startsWith("Late")).length,
    workers: new Set(events.map(event => event.worker_id)).size,
    days: new Set([...groups.values()].map(row => row.day)).size,
    rows: [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name) || a.workerId.localeCompare(b.workerId)),
  }
}

export const reportTime = (value: string | null) => value ? attendanceTime(value) : "—"
export const reportPeriodTitle = (period: AttendanceReportPeriod) => ({ daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Date range" })[period]
