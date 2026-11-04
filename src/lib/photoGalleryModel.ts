import type { StampFlag } from "./photoStamp"
import type { IssueMarkup } from "./issueMarkup"
import { addDays } from "./progress.ts"

export type GalleryPhoto = {
  id: string; path: string; caption: string | null; created_at: string; label: string
  uploaded_by?: string | null; uploaderName?: string
  recordState?: "snapshot"; requestLabel?: string
  taken_at?: string | null; stamp_flag?: StampFlag | null; distance_m?: number | null
  annotations?: IssueMarkup[] // markup saved over the photo (QA evidence); the file itself is the original
  checklist?: { id: string; text: string; done: boolean; remark: string | null; done_at: string | null } | null
  work?: { title: string; description: string | null; status: string } | null
  report?: { report_date: string; status: string; work_done: string } | null
  qa_attempt_id?: string | null // a checklist photo added to a correction (resubmission), not to the original submission
  entry_id?: string | null // a daily report photo attached to one task entry of the report
}

// Daily report photos that belong to no task on the report: older reports, and photos of an entry that was removed.
export const photosOutsideTasks = <T extends Pick<GalleryPhoto, "entry_id">>(photos: T[], taskIds: string[]) => photos.filter(photo => !photo.entry_id || !taskIds.includes(photo.entry_id))

export type PhotoDates = { from: string; to: string }
// Date filter buttons (Asia/Manila calendar days, both ends included). Daily report photos open on today.
export type PhotoRange = "today" | "yesterday" | "week" | "month" | "all"
export const photoRanges: Array<[PhotoRange, string]> = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "Last 7 days"], ["month", "This month"], ["all", "All dates"]]
export function photoRangeDates(range: PhotoRange, today: string): PhotoDates {
  if (range === "today") return { from: today, to: today }
  if (range === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) }
  if (range === "week") return { from: addDays(today, -6), to: today }
  if (range === "month") return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: "", to: "" }
}
export const photoRangeOf = (dates: PhotoDates, today: string): PhotoRange | "custom" =>
  photoRanges.find(([range]) => { const preset = photoRangeDates(range, today); return preset.from === dates.from && preset.to === dates.to })?.[0] ?? "custom"
// Sheet / pin / work item filters for pin photos (Work items and Progress tabs). Only valid ids are read from a link.
export type PhotoScope = { sheet: string; pin: string; item: string }
export const emptyPhotoScope: PhotoScope = { sheet: "", pin: "", item: "" }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function readPhotoScope(search: string): PhotoScope {
  const params = new URLSearchParams(search)
  const read = (key: string) => { const value = params.get(key) ?? ""; return uuidPattern.test(value) ? value : "" }
  return { sheet: read("sheet"), pin: read("pin"), item: read("item") }
}
// Narrower choices follow wider ones: a new sheet clears the pin and work item; a pin selects its own sheet and clears the work item.
export function changePhotoScope(scope: PhotoScope, key: keyof PhotoScope, value: string, sheetOfPin: (pinId: string) => string | undefined): PhotoScope {
  if (key === "sheet") return { sheet: value, pin: "", item: "" }
  if (key === "pin") return { sheet: value ? sheetOfPin(value) ?? scope.sheet : scope.sheet, pin: value, item: "" }
  return { ...scope, item: value }
}
export const defaultPhotoDates = (tab: string, today: string): PhotoDates => photoRangeDates(tab === "daily" ? "today" : "all", today)

export const adjustPhotoZoom = (current: number, change: number) => Math.min(300,Math.max(100,current+change))
export function validPhotoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function readPhotoDates(search: string): PhotoDates {
  const params = new URLSearchParams(search)
  const from = params.get("from") ?? ""
  const to = params.get("to") ?? ""
  return { from: validPhotoDate(from) ? from : "", to: validPhotoDate(to) ? to : "" }
}
export function photoDateBounds({ from, to }: PhotoDates) {
  if ((from && !validPhotoDate(from)) || (to && !validPhotoDate(to))) return { error: "Choose valid calendar dates." }
  if (from && to && from > to) return { error: "The end date must be on or after the start date." }
  return {
    start: from ? new Date(`${from}T00:00:00+08:00`).toISOString() : undefined,
    end: to ? new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86_400_000).toISOString() : undefined,
  }
}
export const photoTime = (value: string | null | undefined) => value
  ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  : "Not recorded"
