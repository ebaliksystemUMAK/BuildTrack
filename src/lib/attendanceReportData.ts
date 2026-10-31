import { supabase } from "./supabase"
import { attendanceReportRange, attendanceReportWindows, type AttendanceReportPeriod, type AttendanceReportEvent, type AttendanceReportData, type AttendanceReportPerson } from "./attendanceReportModel"
import type { DailyStatusRow } from "./attendanceStatusModel"

const PAGE_SIZE = 1000
const ROW_CAP = 50000
// Reports read the entire period, independently of the on-screen 30-record pagination.
export async function loadAttendanceReport(projectId: string, period: AttendanceReportPeriod, anchor: string, workerId: string | null = null, endDay?: string): Promise<AttendanceReportData> {
  const range = attendanceReportRange(period, anchor, undefined, endDay)
  const identity = await supabase.auth.getUser()
  if (identity.error || !identity.data.user) throw new Error("Sign in again before generating an attendance report.")
  const [project, person, generator] = await Promise.all([
    supabase.from("projects").select("id,code,name").eq("id", projectId).single(),
    workerId ? supabase.from("attendance_workers").select("id,full_name,worker_code,trade").eq("project_id", projectId).eq("id", workerId).single() : Promise.resolve({ data: null, error: null }),
    supabase.from("profiles").select("full_name").eq("id", identity.data.user.id).single(),
  ])
  if (project.error || !project.data || person.error || (workerId && !person.data)) throw new Error("This project or worker is not accessible. Check your project access and try again.")
  if (generator.error || !generator.data?.full_name?.trim()) throw new Error("Your account name could not be loaded. Please retry before generating the report.")
  const events: AttendanceReportEvent[] = [], ids = new Set<string>()
  let expected: number | null = null
  for (let from = 0; from < ROW_CAP; from += PAGE_SIZE) {
    let query = supabase.from("biometric_attendance_events")
      // All event columns: schedule_flag / minutes_off exist only after 20261027130000; older databases still work.
      .select("*,worker:attendance_workers(id,full_name,worker_code,trade)", { count: "exact" })
      .eq("project_id", projectId).gte("occurred_at", range.start).lt("occurred_at", range.endExclusive)
      .order("occurred_at").order("id")
    if (workerId) query = query.eq("worker_id", workerId)
    const result = await query.range(from, Math.min(from + PAGE_SIZE, ROW_CAP) - 1)
    if (result.error || result.count === null) throw new Error("The full attendance report could not be loaded. No partial report was generated. Please retry.")
    if (result.count > ROW_CAP) throw new Error("This report exceeds 50,000 scans. Choose a shorter period or an individual worker report.")
    if (expected !== null && result.count !== expected) throw new Error("Attendance changed while generating the report. Generate it again to get a complete report.")
    expected = result.count
    const rows = (result.data ?? []) as unknown as AttendanceReportEvent[]
    for (const event of rows) {
      if (ids.has(event.id) || event.project_id !== projectId || (workerId && event.worker_id !== workerId) || Date.parse(event.occurred_at) < Date.parse(range.start) || Date.parse(event.occurred_at) >= Date.parse(range.endExclusive)) throw new Error("Attendance changed or returned an unexpected scope. Please generate the report again.")
      ids.add(event.id); events.push(event)
    }
    if (events.length === expected) break
    if (rows.length !== PAGE_SIZE) throw new Error("Not all report records were returned. No partial report was generated; please retry.")
  }
  if (events.length !== expected) throw new Error("The full report was not returned. Try a shorter period.")
  const days: DailyStatusRow[] = [], dayIds = new Set<string>()
  for (const window of attendanceReportWindows(range)) {
    const before = days.length
    let expectedDays: number | null = null
    for (let from = 0; from < ROW_CAP; from += PAGE_SIZE) {
      let query = supabase.rpc("attendance_daily_status", { p_project: projectId, p_from: window.startDay, p_to: window.endDay }, { count: "exact" })
        .order("day").order("worker_id")
      if (workerId) query = query.eq("worker_id", workerId)
      const status = await query.range(from, from + PAGE_SIZE - 1)
      if (status.error || status.count === null || !Array.isArray(status.data)) throw new Error("Daily attendance statuses could not be loaded. No partial report was generated. Please retry.")
      if (before + status.count > ROW_CAP) throw new Error("This report exceeds 50,000 daily attendance records. Choose a shorter period or an individual worker report.")
      if (expectedDays !== null && status.count !== expectedDays) throw new Error("Daily attendance changed while generating the report. Please generate it again.")
      expectedDays = status.count
      for (const row of status.data as DailyStatusRow[]) {
        const key = `${row.day}:${row.worker_id}`
        if (dayIds.has(key) || row.day < window.startDay || row.day > window.endDay || (workerId && row.worker_id !== workerId)) throw new Error("Daily attendance changed or returned an unexpected scope. Please generate the report again.")
        dayIds.add(key); days.push(row)
      }
      if (days.length - before === expectedDays) break
      if (status.data.length !== PAGE_SIZE) throw new Error("Not all daily attendance records were returned. No partial report was generated; please retry.")
    }
    if (days.length - before !== expectedDays) throw new Error("The full daily attendance report was not returned. Try a shorter period.")
  }
  return { project: project.data, worker: person.data as AttendanceReportPerson | null, range, events, days, generatedBy: generator.data.full_name.trim(), generatedAt: new Date().toISOString() }
}
