// Pure QA rules (no network): labels, scoring and tolerance checks. The database is the authority (`complete_inspection`,
// `save_inspection_item`); these functions repeat its rules so the screen can show the verdict while the engineer works.
// Keep them identical to supabase/migrations/0025_qa_module.sql.

export type Trade = "structural" | "architectural" | "electrical" | "plumbing" | "mechanical" | "fire_protection" | "safety" | "general"
export type QaSeverity = "critical" | "major" | "minor"
export type ItemResult = "pending" | "pass" | "fail" | "na"
export type InspectionStatus = "requested" | "in_progress" | "passed" | "conditional" | "failed" | "cancelled"
export type DefectStatus = "open" | "in_progress" | "for_verification" | "closed"
export type DefectCategory = "workmanship" | "material" | "design" | "safety" | "documentation"
export type Weights = { critical: number; major: number; minor: number }

export const trades: Trade[] = ["structural", "architectural", "electrical", "plumbing", "mechanical", "fire_protection", "safety", "general"]
export const tradeLabels: Record<Trade, string> = {
  structural: "Structural",
  architectural: "Architectural",
  electrical: "Electrical",
  plumbing: "Plumbing and sanitary",
  mechanical: "Mechanical / HVAC",
  fire_protection: "Fire protection",
  safety: "Safety",
  general: "General",
}
export const severities: QaSeverity[] = ["critical", "major", "minor"]
export const qaSeverityLabels: Record<QaSeverity, string> = { critical: "Critical", major: "Major", minor: "Minor" }
export const qaSeverityHelp: Record<QaSeverity, string> = {
  critical: "Affects structural safety, life safety or code compliance. Work stops until fixed.",
  major: "Does not meet the drawings or specification. Must be corrected before handover.",
  minor: "Cosmetic or housekeeping. Fix in the normal course of work.",
}
export const categories: DefectCategory[] = ["workmanship", "material", "design", "safety", "documentation"]
export const categoryLabels: Record<DefectCategory, string> = { workmanship: "Workmanship", material: "Material", design: "Design / drawing", safety: "Safety", documentation: "Documentation" }
export const inspectionStatusLabels: Record<InspectionStatus, string> = {
  requested: "Requested",
  in_progress: "In progress",
  passed: "Passed",
  conditional: "Conditional",
  failed: "Failed",
  cancelled: "Cancelled",
}
export const defectStatusLabels: Record<DefectStatus, string> = { open: "Open", in_progress: "In progress", for_verification: "For verification", closed: "Closed" }
export const dueDays: Record<QaSeverity, number> = { critical: 3, major: 7, minor: 14 }

// Semantic colour pairs that stay readable on light and dark backgrounds.
export const severityTone: Record<QaSeverity, string> = {
  critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  major: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  minor: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
}
export const inspectionTone: Record<InspectionStatus, string> = {
  requested: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  in_progress: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  passed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  conditional: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  cancelled: "bg-gray-200 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200",
}
export const defectTone: Record<DefectStatus, string> = {
  open: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  in_progress: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  for_verification: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  closed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
}

export const refNumber = (kind: "ir" | "ncr" | "snag", number: number) => `${kind === "ir" ? "IR" : kind === "ncr" ? "NCR" : "SR"}-${String(number).padStart(4, "0")}`

export type ScoredItem = { severity: QaSeverity; result: ItemResult; hold_point: boolean }

export type ScorePreview = {
  score: number | null // null while nothing is judged yet
  passed: number
  failed: number
  na: number
  pending: number
  criticalFailed: boolean
  holdFailed: boolean
  result: "passed" | "conditional" | "failed" | null // null while items are pending or nothing was inspected
}

const weightOf = (severity: QaSeverity, weights: Weights) => weights[severity] ?? (severity === "critical" ? 5 : severity === "major" ? 3 : 1)

// Same arithmetic as complete_inspection: weighted share of passed items among judged (pass or fail) items, N/A left out.
export function previewScore(items: ScoredItem[], weights: Weights, threshold: number): ScorePreview {
  let passWeight = 0
  let totalWeight = 0
  let passed = 0
  let failed = 0
  let na = 0
  let pending = 0
  let criticalFailed = false
  let holdFailed = false
  for (const item of items) {
    if (item.result === "pending") pending++
    else if (item.result === "na") na++
    else {
      const weight = weightOf(item.severity, weights)
      totalWeight += weight
      if (item.result === "pass") {
        passed++
        passWeight += weight
      } else {
        failed++
        if (item.severity === "critical") criticalFailed = true
        if (item.hold_point) holdFailed = true
      }
    }
  }
  const score = totalWeight === 0 ? null : Math.round((10000 * passWeight) / totalWeight) / 100
  let result: ScorePreview["result"] = null
  if (pending === 0 && score !== null) result = failed === 0 ? "passed" : score >= threshold && !criticalFailed && !holdFailed ? "conditional" : "failed"
  return { score, passed, failed, na, pending, criticalFailed, holdFailed, result }
}

export type MeasureItem = { kind: "check" | "measure"; min_value: number | null; max_value: number | null }

// A measurement outside min / max is a failure whatever was ticked; inside is a pass. null = no tolerance to judge by.
export function measureVerdict(item: MeasureItem, value: number | null): "pass" | "fail" | null {
  if (item.kind !== "measure" || value === null || !Number.isFinite(value)) return null
  if (item.min_value === null && item.max_value === null) return null
  if ((item.min_value !== null && value < item.min_value) || (item.max_value !== null && value > item.max_value)) return "fail"
  return "pass"
}

export function toleranceText(item: { min_value: number | null; max_value: number | null; unit: string | null }): string {
  const unit = item.unit ? ` ${item.unit}` : ""
  if (item.min_value !== null && item.max_value !== null) return `${item.min_value} to ${item.max_value}${unit}`
  if (item.min_value !== null) return `at least ${item.min_value}${unit}`
  if (item.max_value !== null) return `at most ${item.max_value}${unit}`
  return item.unit ? `record in ${item.unit}` : "record the value"
}

export type DueState = "closed" | "overdue" | "due_soon" | "ok" | "none"

export function dueState(defect: { status: DefectStatus; due_date: string | null }, today: string): { state: DueState; days: number } {
  if (defect.status === "closed") return { state: "closed", days: 0 }
  if (!defect.due_date) return { state: "none", days: 0 }
  const days = Math.round((Date.parse(defect.due_date.slice(0, 10)) - Date.parse(today)) / 86_400_000)
  return { state: days < 0 ? "overdue" : days <= 2 ? "due_soon" : "ok", days }
}

export function dueText(defect: { status: DefectStatus; due_date: string | null }, today: string): string {
  const { state, days } = dueState(defect, today)
  if (state === "closed") return "Closed"
  if (state === "none") return "No due date"
  if (state === "overdue") return `${-days} day${days === -1 ? "" : "s"} overdue`
  if (days === 0) return "Due today"
  return `Due in ${days} day${days === 1 ? "" : "s"}`
}

export const defaultDueDate = (severity: QaSeverity, today: string): string => new Date(Date.parse(today) + dueDays[severity] * 86_400_000).toISOString().slice(0, 10)

// Check that a checklist is worth saving before it is sent to the database (the database checks again).
export type DraftItem = { text: string; severity: QaSeverity; kind: "check" | "measure"; unit: string; min_value: string; max_value: string; reference: string; acceptance_criteria?: string; evidence_requirement?: string; requires_photo: boolean; hold_point: boolean }

export function checklistProblem(name: string, items: DraftItem[], nameLabel = "QC checklist"): string {
  if (name.trim().length < 3) return `Give the ${nameLabel} a name (at least 3 characters).`
  if (!items.length) return "Add at least one item."
  if (items.length > 60) return "A QC checklist can have at most 60 items."
  for (const [index, item] of items.entries()) {
    const label = `Item ${index + 1}`
    if (item.text.trim().length < 3) return `${label}: describe what is checked.`
    if (item.reference.trim().length > 200) return `${label}: the standard, edition and clause must be at most 200 characters.`
    if ((item.acceptance_criteria?.trim().length ?? 0) > 1000) return `${label}: acceptance criteria must be at most 1000 characters.`
    if ((item.evidence_requirement?.trim().length ?? 0) > 1000) return `${label}: evidence / test instructions must be at most 1000 characters.`
    if (item.kind === "measure") {
      const min = item.min_value.trim() === "" ? null : Number(item.min_value)
      const max = item.max_value.trim() === "" ? null : Number(item.max_value)
      if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) return `${label}: the limits must be numbers.`
      if (min !== null && max !== null && min > max) return `${label}: the lowest value is above the highest.`
    }
  }
  return ""
}

// What the sidebar badge counts: the engineer's decisions (inspections waiting + repairs to verify) or the foreman's open repairs.
export function qaBadge(role: "engineer" | "foreman", userId: string | null, inspections: Array<{ status: string }>, defects: Array<{ status: string; assigned_to: string | null }>): number {
  if (role === "engineer") return inspections.filter((row) => row.status === "requested").length + defects.filter((row) => row.status === "for_verification").length
  return defects.filter((row) => row.assigned_to === userId && (row.status === "open" || row.status === "in_progress")).length
}

// General QA warning; the authoritative final verification gate is pin_qa_verification_problem (0042).
export function pinQualityWarning(quality: { inspections: Array<{ status: string }>; defects: Array<{ status: string }> } | null): string {
  if (!quality) return "Checking QA requirements."
  const latest = quality.inspections.find((row) => row.status === "passed" || row.status === "conditional" || row.status === "failed")
  const open = quality.defects.filter((row) => row.status !== "closed").length
  const parts: string[] = []
  if (latest?.status === "failed") parts.push("its latest inspection FAILED")
  if (latest?.status === "conditional") parts.push("its latest inspection is CONDITIONAL, not a final Pass")
  if (!latest) parts.push("no passed inspection is recorded")
  if (quality.inspections.some((row) => row.status === "requested" || row.status === "in_progress")) parts.push("an inspection is still open")
  if (open) parts.push(`${open} defect${open === 1 ? " is" : "s are"} still open`)
  return parts.length ? `Quality check: ${parts.join(", ")}.` : ""
}

// Client reports ("snags"): wording in plain language, because the client reads it.
export type SnagStatus = "submitted" | "accepted" | "declined" | "resolved" | "withdrawn"
export type Urgency = "low" | "normal" | "urgent"
export const urgencies: Urgency[] = ["low", "normal", "urgent"]
export const urgencyLabels: Record<Urgency, string> = { low: "Can wait", normal: "Normal", urgent: "Urgent" }
export const snagStatusLabels: Record<SnagStatus, string> = { submitted: "Waiting for the engineer", accepted: "Accepted", declined: "Reviewed", resolved: "Fixed and checked", withdrawn: "Withdrawn" }
export const snagTone: Record<SnagStatus, string> = {
  submitted: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  accepted: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  declined: "bg-gray-200 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  withdrawn: "bg-gray-200 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200",
}
export function fixStageText(status: SnagStatus, stage: string | null): string {
  if (status === "submitted") return "The engineer will look at it soon."
  if (status === "declined") return "The engineer reviewed it and explained below."
  if (status === "withdrawn") return "You withdrew this report."
  if (status === "resolved" || stage === "closed") return "Fixed, and the engineer has checked the repair."
  if (stage === "for_verification") return "The repair is done and is being checked."
  if (stage === "in_progress") return "The crew is fixing it now."
  return "Accepted. A crew will be assigned to fix it."
}

// ---------- Trends (for the QA overview) ----------
type TrendDefect = { raised_at: string; closed_at: string | null; category: DefectCategory; trade: Trade; severity: QaSeverity; status: DefectStatus }

const manilaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" })
const isoDay = (timestamp: string) => manilaDay.format(new Date(timestamp))
const plusDays = (date: string, days: number) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + days * 86_400_000).toISOString().slice(0, 10)
const mondayOf = (date: string) => plusDays(date, -((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7))

export type TrendWeek = { start: string; end: string; raised: number; closed: number }

// Defect reports raised and closed per calendar week (Monday to Sunday, Manila), for the last `weeks` weeks ending with the week of `today`.
export function defectTrend(defects: TrendDefect[], today: string, weeks = 8): TrendWeek[] {
  const last = mondayOf(today)
  const out: TrendWeek[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = plusDays(last, -7 * i)
    const end = plusDays(start, 6)
    out.push({
      start,
      end,
      raised: defects.filter((row) => isoDay(row.raised_at) >= start && isoDay(row.raised_at) <= end).length,
      closed: defects.filter((row) => row.closed_at && isoDay(row.closed_at) >= start && isoDay(row.closed_at) <= end).length,
    })
  }
  return out
}

export type Breakdown = { key: string; total: number; open: number; critical: number }

// Where defect reports come from: by trade or by category, biggest first (at most `top`; the rest folded into "other").
export function defectBreakdown(defects: TrendDefect[], by: "trade" | "category", top = 6): Breakdown[] {
  const map = new Map<string, Breakdown>()
  for (const row of defects) {
    const key = row[by]
    const entry = map.get(key) ?? { key, total: 0, open: 0, critical: 0 }
    entry.total++
    if (row.status !== "closed") entry.open++
    if (row.severity === "critical") entry.critical++
    map.set(key, entry)
  }
  const sorted = [...map.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
  if (sorted.length <= top) return sorted
  const rest = sorted.slice(top - 1).reduce((sum, row) => ({ key: "other", total: sum.total + row.total, open: sum.open + row.open, critical: sum.critical + row.critical }), { key: "other", total: 0, open: 0, critical: 0 })
  return [...sorted.slice(0, top - 1), rest]
}
