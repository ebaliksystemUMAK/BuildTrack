// Pop-up messages for the site attendance screen, one per scan the database answered (20261027130000 / 20261027152428).
// Pure: rows from biometric_attendance_events (recorded), attendance_ignored_scans (repeat / out of order) and
// attendance_unregistered_scans (cannot count) become one message the worker at the scanner can read.
import { attendanceTime } from "./attendanceModel.ts"
import { scheduleFlagLabel } from "./attendanceScheduleModel.ts"

type Person = { full_name: string; worker_code?: string; photo_path?: string | null } | null
export type RecordedScanRow = { id: string; direction: "in" | "out"; occurred_at: string; received_at: string; schedule_flag?: string | null; minutes_off?: number | null; worker: Person }
export type IgnoredScanRow = { id: string; reason: "repeat" | "out_of_order"; occurred_at: string; received_at: string; worker: Person; kept: { direction: "in" | "out"; occurred_at: string } | null }
export type UnregisteredScanRow = { id: string; reason: "no_match" | "not_linked" | "inactive" | "other_device"; sensor_slot: string | null; occurred_at: string; received_at: string; worker: Person }
export type ScanNotice = { key: string; tone: "ok" | "warn" | "error"; title: string; message: string; name: string; photoPath: string | null; at: string; receivedAt: string }

const word = (direction: "in" | "out" | undefined) => (direction === "out" ? "OUT" : "IN")

export function recordedNotice(row: RecordedScanRow): ScanNotice {
  const flag = scheduleFlagLabel(row.schedule_flag, row.minutes_off)
  const name = row.worker?.full_name ?? "Worker"
  return {
    key: `recorded:${row.id}`, tone: "ok", title: `Time ${word(row.direction)} recorded`,
    message: `${name} · ${attendanceTime(row.occurred_at)}${flag ? ` · ${flag}` : ""}`,
    name, photoPath: row.worker?.photo_path ?? null, at: row.occurred_at, receivedAt: row.received_at,
  }
}

export function ignoredNotice(row: IgnoredScanRow): ScanNotice {
  const name = row.worker?.full_name ?? "This worker"
  const kept = row.kept
  const when = kept ? attendanceTime(kept.occurred_at) : "earlier"
  return row.reason === "repeat"
    ? { key: `ignored:${row.id}`, tone: "warn", title: `Already timed ${word(kept?.direction)}`, message: `${name} already timed ${word(kept?.direction)} at ${when}. This scan was not recorded again.${kept?.direction === "out" ? " Only one time in and one time out per day." : ""}`, name, photoPath: row.worker?.photo_path ?? null, at: row.occurred_at, receivedAt: row.received_at }
    : { key: `ignored:${row.id}`, tone: "warn", title: "Scan not recorded", message: `${name} already has a later scan today (time ${word(kept?.direction)} at ${when}). This older scan was not recorded.`, name, photoPath: row.worker?.photo_path ?? null, at: row.occurred_at, receivedAt: row.received_at }
}

export function unregisteredNotice(row: UnregisteredScanRow): ScanNotice {
  const name = row.worker?.full_name ?? ""
  const base = { key: `unregistered:${row.id}`, tone: "error" as const, name, photoPath: row.worker?.photo_path ?? null, at: row.occurred_at, receivedAt: row.received_at }
  if (row.reason === "not_linked")
    return { ...base, title: "Fingerprint not linked", message: `The scanner knows this finger${row.sensor_slot ? ` (slot ${row.sensor_slot})` : ""}, but no worker in this project is linked to it. Not recorded. Ask the Admin.` }
  if (row.reason === "inactive") return { ...base, title: "Worker inactive", message: `${name || "This worker"} is inactive in this project. The scan was not recorded. Ask the Admin.` }
  if (row.reason === "other_device") return { ...base, title: "Wrong scanner", message: `${name || "This worker"} is registered on another scanner. Not recorded here. Use that scanner or ask the Admin.` }
  return { ...base, title: "Fingerprint not registered", message: "This finger is not registered. Nothing was recorded. Ask the Admin to register the worker, then scan again." }
}

// Messages newer than `since`, newest first, without ones already shown.
export function pendingNotices(rows: { recorded: RecordedScanRow[]; ignored: IgnoredScanRow[]; unregistered: UnregisteredScanRow[] }, since: number, seen: Set<string>) {
  return [...rows.recorded.map(recordedNotice), ...rows.ignored.map(ignoredNotice), ...rows.unregistered.map(unregisteredNotice)]
    .filter((notice) => Date.parse(notice.receivedAt) >= since && !seen.has(notice.key))
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt) || b.key.localeCompare(a.key))
}

export const noticeDuration = (notice: ScanNotice) => (notice.tone === "ok" ? 6000 : 10000)
