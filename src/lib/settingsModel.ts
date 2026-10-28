export type Weights = { critical: number; major: number; minor: number }
export type WorkHours = { start: string; end: string; days: number[] }
// source = official source link (documentation of the cited standard), optional (20261028150000).
export type Standard = { code: string; title: string; source?: string }
export type SystemSettings = { threshold: number; weights: Weights; hours: WorkHours; standards: Standard[]; inactiveDays: number }
export type SettingRow = { key: string; value: unknown; updated_at: string; updated_by: string | null }

export const defaultSettings: SystemSettings = {
  threshold: 90,
  weights: { critical: 5, major: 3, minor: 1 },
  hours: { start: "07:00", end: "17:00", days: [1, 2, 3, 4, 5, 6] },
  standards: [],
  inactiveDays: 60,
}

export const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

const isInt = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max

// Turns the rows from the database into typed settings. Anything missing or malformed falls back to the default, so a screen never breaks.
export function parseSettings(rows: Array<Pick<SettingRow, "key" | "value">>): SystemSettings {
  const get = (key: string) => rows.find((row) => row.key === key)?.value
  const result: SystemSettings = { ...defaultSettings, weights: { ...defaultSettings.weights }, hours: { ...defaultSettings.hours, days: [...defaultSettings.hours.days] }, standards: [] }
  const threshold = get("qa.acceptance_threshold")
  if (isInt(threshold, 50, 100)) result.threshold = threshold
  const weights = get("qa.weights") as Partial<Weights> | undefined
  if (weights && isInt(weights.critical, 1, 20) && isInt(weights.major, 1, 20) && isInt(weights.minor, 1, 20)) result.weights = { critical: weights.critical, major: weights.major, minor: weights.minor }
  const hours = get("work.hours") as Partial<WorkHours> | undefined
  if (hours && typeof hours.start === "string" && typeof hours.end === "string" && Array.isArray(hours.days) && hours.days.every((day) => isInt(day, 1, 7)) && hours.days.length) {
    result.hours = { start: hours.start, end: hours.end, days: [...hours.days].sort((a, b) => a - b) }
  }
  const standards = get("standards")
  if (Array.isArray(standards))
    result.standards = standards
      .filter((item): item is Standard => Boolean(item) && typeof item.code === "string" && typeof item.title === "string")
      .map((item) => (typeof item.source === "string" && /^https:\/\//.test(item.source) ? { code: item.code, title: item.title, source: item.source } : { code: item.code, title: item.title }))
  const inactive = get("access.inactive_days")
  if (isInt(inactive, 14, 365)) result.inactiveDays = inactive
  return result
}

// Maps the typed settings back to the database keys (used by the settings screen to save one card at a time).
export const settingKeys = { threshold: "qa.acceptance_threshold", weights: "qa.weights", hours: "work.hours", standards: "standards", inactiveDays: "access.inactive_days" } as const

export function settingsError(error: { message: string }): string {
  if (/Only a Super Admin/i.test(error.message)) return "Only a Super Admin who has completed the authenticator check can change settings."
  if (/network|fetch/i.test(error.message)) return "Network problem. Check your connection and try again."
  return error.message
}
