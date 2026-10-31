import type { Blueprint, Pin, PinSeverity, PinStatus } from "./blueprints"
import { progressPercent, scheduledTasks, taskApproved } from "./taskProgress.ts"

// Pure helpers behind the engineer dashboards (no network): counts, overdue checks, per-sheet roll-ups and CSV.

export const STATUSES: PinStatus[] = ["not_started", "in_progress", "for_review", "issue", "verified"]

// Calendar date in Manila as YYYY-MM-DD (deadlines are plain dates, so compare them as text).
// One formatter for the whole app: creating one per call made the S-curve slow on big projects (load test).
const manilaDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" })
export function manilaToday(now = new Date()): string {
  return manilaDay.format(now)
}

export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10))
  const to = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10))
  return Math.round((to - from) / 86_400_000)
}

export const isOpen = (pin: Pick<Pin, "status" | "category">) => pin.status !== "verified" && pin.category !== "note"
export const isOverdue = (pin: Pick<Pin, "status" | "due_date" | "category">, today: string) => isOpen(pin) && Boolean(pin.due_date) && (pin.due_date as string) < today
export const isDueSoon = (pin: Pick<Pin, "status" | "due_date" | "category">, today: string, days = 3) =>
  isOpen(pin) && Boolean(pin.due_date) && (pin.due_date as string) >= today && daysBetween(today, pin.due_date as string) <= days

export type Totals = Record<PinStatus, number> & { total: number; totalTasks: number; approvedTasks: number; percentVerified: number; overdue: number }

// Notes (category "note") are comments on the plan, not work, so they are left out of progress figures.
export function summarize(pins: Pick<Pin, "status" | "due_date" | "category" | "tasks">[], today: string): Totals {
  const work = pins.filter((pin) => pin.category !== "note")
  const totals: Totals = { not_started: 0, in_progress: 0, for_review: 0, issue: 0, verified: 0, total: work.length, totalTasks: 0, approvedTasks: 0, percentVerified: 0, overdue: 0 }
  for (const pin of work) {
    totals[pin.status] += 1
    if (isOverdue(pin, today)) totals.overdue += 1
  }
  const tasks = scheduledTasks(work)
  totals.totalTasks = tasks.length
  totals.approvedTasks = tasks.filter(taskApproved).length
  totals.percentVerified = progressPercent(totals.approvedTasks, totals.totalTasks)
  return totals
}

export type ZoneRow = { blueprintId: string; title: string; level: string | null; discipline: string | null; totals: Totals }

// One row per sheet (a sheet is a floor / zone / discipline), sorted with the most behind first.
export function byZone(blueprints: Pick<Blueprint, "id" | "title" | "level" | "discipline">[], pins: Pin[], today: string): ZoneRow[] {
  return blueprints
    .map((bp) => ({
      blueprintId: bp.id,
      title: bp.title,
      level: bp.level,
      discipline: bp.discipline,
      totals: summarize(
        pins.filter((pin) => pin.blueprint_id === bp.id),
        today,
      ),
    }))
    .sort((a, b) => b.totals.overdue + b.totals.issue - (a.totals.overdue + a.totals.issue) || a.totals.percentVerified - b.totals.percentVerified)
}

// Expected progress from the schedule: share of the project's duration that has passed (0-100).
export function scheduleElapsed(start: string | null, end: string | null, today: string): number | null {
  if (!start || !end) return null
  const total = daysBetween(start, end)
  if (total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((daysBetween(start, today) / total) * 100)))
}

export type Health = "good" | "watch" | "risk" | "empty"

// One word for how a project is doing. Risk: a critical issue, 5+ late pins, or 20+ points behind the schedule.
// Watch: any issue or late pin, or 10+ points behind. Otherwise good.
export function projectHealth(totals: Totals, elapsed: number | null, criticalIssues: number): Health {
  if (!totals.total) return "empty"
  const behind = elapsed === null ? 0 : elapsed - totals.percentVerified
  if (criticalIssues > 0 || totals.overdue >= 5 || behind >= 20) return "risk"
  if (totals.issue > 0 || totals.overdue > 0 || behind >= 10) return "watch"
  return "good"
}

export const severityOrder: PinSeverity[] = ["critical", "high", "medium", "low"]

export function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value)
  // Leading = + - @ can be run as a formula by spreadsheets; prefix a quote to keep it text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n")
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- S-curve (planned vs verified, cumulative) ----------
// Planned: share of tasks due by each date, inheriting the due date on their pin.
// Verified: share of approved tasks, dated by each task's Engineer approval.
// Notes are not work. Items without a due date count in the total but never as planned; `undated` lets the screen say so.
export type SCurvePoint = { date: string; planned: number; verified: number | null }
export type SCurveData = { points: SCurvePoint[]; total: number; undated: number; todayIndex: number }

export const addDays = (date: string, days: number) =>
  new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) + days * 86_400_000).toISOString().slice(0, 10)

const countUpTo = (sorted: string[], date: string) => {
  let n = 0
  while (n < sorted.length && sorted[n] <= date) n++
  return n
}

export function sCurve(
  pins: Pick<Pin, "category" | "status" | "due_date" | "verified_at" | "tasks">[],
  start: string | null,
  end: string | null,
  today: string,
  maxPoints = 40,
): SCurveData | null {
  const work = scheduledTasks(pins)
  if (!work.length) return null
  const due = work.map((pin) => pin.due_date?.slice(0, 10)).filter((value): value is string => Boolean(value)).sort()
  const done = work.filter((task) => taskApproved(task) && task.verified_at).map((task) => manilaToday(new Date(task.verified_at as string))).sort()
  const from = [start, due[0], done[0], today].filter((value): value is string => Boolean(value)).sort()[0]
  let to = [end, due[due.length - 1], today].filter((value): value is string => Boolean(value)).sort().reverse()[0]
  if (to <= from) to = addDays(from, 1)
  const span = daysBetween(from, to)
  const step = Math.max(1, Math.ceil(span / Math.max(1, maxPoints - 1)))
  const dates: string[] = []
  for (let day = 0; day < span; day += step) dates.push(addDays(from, day))
  dates.push(to)
  if (!dates.includes(today)) dates.push(today)
  dates.sort()
  const pct = (count: number) => Math.round((count / work.length) * 1000) / 10
  const points = dates.map((date) => ({ date, planned: pct(countUpTo(due, date)), verified: date <= today ? pct(countUpTo(done, date)) : null }))
  return { points, total: work.length, undated: work.length - due.length, todayIndex: dates.indexOf(today) }
}
