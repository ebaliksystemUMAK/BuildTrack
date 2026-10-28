export type AttendanceWorker = {
  id: string
  project_id: string
  worker_code: string
  biometric_uid: string | null
  first_name?: string
  last_name?: string
  middle_initial?: string
  contact_number?: string
  email?: string
  enrolled_device_id?: string | null
  fingerprint_enrolled_at?: string | null
  full_name: string
  trade: string
  photo_path: string | null
  active: boolean
}
export type AttendanceEvent = {
  id: string
  project_id: string
  worker_id: string
  direction: "in" | "out"
  occurred_at: string
  received_at: string
  device_id: string
  external_event_id: string
  // Set by the database since 20261027130000 (null on older scans): see attendanceScheduleModel.
  schedule_flag?: string | null
  minutes_off?: number | null
  worker: AttendanceWorker | null
}
export type AttendanceSummary = {
  scans: number
  workers: number
  clocked_in: number
  clocked_out: number
  // Since 20261028010000 (daily status of the day): workers on time, late, absent and not in yet; ignored repeat scans.
  on_time?: number
  late?: number
  absent?: number
  not_in_yet?: number
  ignored?: number
}
export const emptyAttendanceSummary: AttendanceSummary = {
  scans: 0,
  workers: 0,
  clocked_in: 0,
  clocked_out: 0,
}
export const attendanceDay = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
export const attendanceTime = (value: string) =>
  new Date(value).toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
export const attendanceDate = (value: string) =>
  new Date(value).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
export const attendancePath = (project: string) =>
  `/attendance?project=${encodeURIComponent(project)}`
export const workerInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?"
export function workerPhotoProblem(file: { type: string; size: number }) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    return "Choose a JPEG, PNG or WebP image."
  return file.size <= 0 || file.size > 2 * 1024 * 1024
    ? "Worker photos must be between 1 byte and 2 MB."
    : ""
}
export function filterAttendance(
  events: AttendanceEvent[],
  search: string,
  direction: string,
) {
  const query = search.trim().toLowerCase()
  return events.filter(
    (event) =>
      (!direction || event.direction === direction) &&
      (!query ||
        `${event.worker?.full_name ?? ""} ${event.worker?.worker_code ?? ""} ${event.device_id}`
          .toLowerCase()
          .includes(query)),
  )
}
