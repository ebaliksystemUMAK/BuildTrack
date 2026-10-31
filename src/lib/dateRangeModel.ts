import { addDays, manilaToday } from "./progress.ts"
import { validPhotoDate } from "./photoGalleryModel.ts"

// Calendar filter shared by the registers and progress pages. Days are Asia/Manila calendar days, both ends included.
// Pure; tested in `pnpm test:lib`.

export type DateRange = { from: string; to: string } // YYYY-MM-DD, "" = open end
export type RangePreset = "all" | "today" | "last7" | "thisWeek" | "thisMonth" | "lastMonth" | "last30" | "next30"
export const allDates: DateRange = { from: "", to: "" }
export const rangePresetLabels: Record<RangePreset, string> = {
  all: "All dates", today: "Today", last7: "Last 7 days", thisWeek: "This week", thisMonth: "This month", lastMonth: "Last month", last30: "Last 30 days", next30: "Next 30 days",
}
// Records that already happened (requested, raised, reported) and work that is scheduled (due dates).
export const pastPresets: RangePreset[] = ["all", "today", "last7", "thisWeek", "thisMonth", "lastMonth", "last30"]
export const schedulePresets: RangePreset[] = ["all", "today", "thisWeek", "thisMonth", "lastMonth"]

// Weeks run Monday to Sunday, like the defect trends.
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
const monthStart = (day: string) => `${day.slice(0, 8)}01`
const monthEnd = (day: string) => addDays(monthStart(addDays(monthStart(day), 32)), -1)

export function presetRange(preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case "today": return { from: today, to: today }
    case "last7": return { from: addDays(today, -6), to: today }
    case "last30": return { from: addDays(today, -29), to: today }
    case "next30": return { from: today, to: addDays(today, 29) }
    case "thisWeek": { const start = addDays(today, -weekday(today)); return { from: start, to: addDays(start, 6) } }
    case "thisMonth": return { from: monthStart(today), to: monthEnd(today) }
    case "lastMonth": { const last = addDays(monthStart(today), -1); return { from: monthStart(last), to: last } }
    default: return allDates
  }
}
export const presetOf = (range: DateRange, presets: RangePreset[], today: string): RangePreset | "custom" =>
  presets.find((preset) => { const value = presetRange(preset, today); return value.from === range.from && value.to === range.to }) ?? "custom"
export const isFiltered = (range: DateRange) => Boolean(range.from || range.to)

export function rangeProblem({ from, to }: DateRange): string {
  if ((from && !validPhotoDate(from)) || (to && !validPhotoDate(to))) return "Choose valid calendar dates."
  if (from && to && from > to) return "The end date must be on or after the start date."
  return ""
}

// The Manila calendar day of a stored value: plain dates (due dates) as they are, timestamps converted.
export function manilaDayOf(value: string | null | undefined): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const time = new Date(value)
  return Number.isFinite(time.getTime()) ? manilaToday(time) : null
}
// With no dates set everything matches. An invalid range hides nothing (the filter shows the problem instead). Otherwise a
// record without a date never matches.
export function inRange(value: string | null | undefined, range: DateRange): boolean {
  if (!isFiltered(range) || rangeProblem(range)) return true
  const day = manilaDayOf(value)
  if (!day) return false
  return (!range.from || day >= range.from) && (!range.to || day <= range.to)
}

// Written out by hand so every browser shows the same "5 Oct 2026".
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const longDay = (day: string) => `${Number(day.slice(8, 10))} ${months[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
export function rangeText(range: DateRange): string {
  if (!isFiltered(range)) return "all dates"
  if (range.from && range.from === range.to) return longDay(range.from)
  if (range.from && range.to) return `${longDay(range.from)} to ${longDay(range.to)}`
  return range.from ? `${longDay(range.from)} onwards` : `up to ${longDay(range.to)}`
}

// ?from=&to= keep the filter in the address, so a refresh or a shared link shows the same dates. Only real dates are read.
export function readRange(search: string): DateRange {
  const params = new URLSearchParams(search)
  const read = (key: string) => { const value = params.get(key) ?? ""; return validPhotoDate(value) ? value : "" }
  const range = { from: read("from"), to: read("to") }
  return rangeProblem(range) ? allDates : range
}
export function rangeSearch(search: string, range: DateRange): string {
  const params = new URLSearchParams(search)
  for (const key of ["from", "to"] as const) {
    if (range[key]) params.set(key, range[key])
    else params.delete(key)
  }
  const text = params.toString()
  return text ? `?${text}` : ""
}
