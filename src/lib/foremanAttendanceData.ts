import { supabase } from "./supabase"
import { manilaDayRange } from "./foremanDashboardModel"
import type { AttendanceEvent, AttendanceWorker } from "./attendanceModel"
import { RECORD_PAGE_SIZE, WORKER_PAGE_SIZE, validAttendanceDay, workerSearchPattern, type WorkerDaySummary } from "./foremanAttendanceModel"
import { attendanceDay } from "./attendanceModel"
import type { DailyStatusRow } from "./attendanceStatusModel"

// One row per worker for the day: Time in, Time out and status (On time / Late / Absent / ...), from the database.
export async function loadDailyStatus(project: string, day: string): Promise<DailyStatusRow[]> {
  dayQuery(project, day)
  const result = await supabase.rpc("attendance_daily_status", { p_project: project, p_from: day, p_to: day })
  if (result.error) throw new Error("Daily attendance status could not be loaded. Retrying automatically.")
  return (result.data ?? []) as DailyStatusRow[]
}

export type DirectoryData = { workers: AttendanceWorker[]; total: number }
export type DailyRecordsData = { events: AttendanceEvent[]; total: number }
export type WorkerDayData = DailyRecordsData & { worker: AttendanceWorker; summary: WorkerDaySummary }

export async function loadAttendanceWorkers(project: string, search: string, page: number): Promise<DirectoryData> {
  let query = supabase.from("attendance_workers").select("*", { count: "exact" }).eq("project_id", project).order("full_name").order("id")
  if (search.trim()) query = query.ilike("full_name", workerSearchPattern(search))
  const result = await query.range(page * WORKER_PAGE_SIZE, (page + 1) * WORKER_PAGE_SIZE - 1)
  if (result.error || result.count === null) throw new Error("Workers could not be loaded. Retrying automatically.")
  return { workers: (result.data ?? []) as AttendanceWorker[], total: result.count }
}

function dayQuery(project: string, day: string) {
  if (!validAttendanceDay(day, attendanceDay())) throw new Error("Choose today or a valid past attendance date.")
  const { start, end } = manilaDayRange(day)
  return { start, end, project }
}

export async function loadDailyAttendance(project: string, day: string, page: number): Promise<DailyRecordsData> {
  const { start, end } = dayQuery(project, day)
  const result = await supabase.from("biometric_attendance_events").select("*,worker:attendance_workers(*)", { count: "exact" })
    .eq("project_id", project).gte("occurred_at", start).lt("occurred_at", end)
    .order("occurred_at", { ascending: false }).order("received_at", { ascending: false }).order("id", { ascending: false })
    .range(page * RECORD_PAGE_SIZE, (page + 1) * RECORD_PAGE_SIZE - 1)
  if (result.error || result.count === null) throw new Error("Attendance records could not be loaded. Retrying automatically.")
  return { events: (result.data ?? []) as AttendanceEvent[], total: result.count }
}

export async function loadWorkerAttendance(project: string, workerId: string, day: string, page: number): Promise<WorkerDayData> {
  const { start, end } = dayQuery(project, day)
  const scope = (query: ReturnType<ReturnType<typeof supabase.from>["select"]>) =>
    query.eq("project_id", project).eq("worker_id", workerId).gte("occurred_at", start).lt("occurred_at", end)
  const [profile, records, ins, outs, first, last] = await Promise.all([
    supabase.from("attendance_workers").select("*").eq("project_id", project).eq("id", workerId).single(),
    scope(supabase.from("biometric_attendance_events").select("*", { count: "exact" }))
      .order("occurred_at", { ascending: false }).order("received_at", { ascending: false }).order("id", { ascending: false })
      .range(page * RECORD_PAGE_SIZE, (page + 1) * RECORD_PAGE_SIZE - 1),
    scope(supabase.from("biometric_attendance_events").select("id", { count: "exact", head: true })).eq("direction", "in"),
    scope(supabase.from("biometric_attendance_events").select("id", { count: "exact", head: true })).eq("direction", "out"),
    scope(supabase.from("biometric_attendance_events").select("occurred_at")).eq("direction", "in").order("occurred_at").order("id").limit(1).maybeSingle(),
    scope(supabase.from("biometric_attendance_events").select("occurred_at")).eq("direction", "out").order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
  ])
  if ([profile, records, ins, outs, first, last].some(result => result.error) || !profile.data || records.count === null || ins.count === null || outs.count === null)
    throw new Error("Worker details and attendance could not be loaded. Check project access or your connection; retrying automatically.")
  return {
    worker: profile.data as AttendanceWorker,
    events: ((records.data ?? []) as Omit<AttendanceEvent, "worker">[]).map(event => ({ ...event, worker: profile.data as AttendanceWorker })), total: records.count,
    summary: { clockIns: ins.count, clockOuts: outs.count, firstIn: (first.data as { occurred_at: string } | null)?.occurred_at ?? null, lastOut: (last.data as { occurred_at: string } | null)?.occurred_at ?? null },
  }
}
