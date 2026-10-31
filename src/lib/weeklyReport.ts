import type { Pin } from "./blueprints.ts"
import { addDays, manilaToday, sCurve, type SCurveData } from "./progress.ts"
import { escapeHtml, reportHtml, type PrintSection } from "./printReport.ts"
import { progressPercent, scheduledTasks, taskApproved } from "./taskProgress.ts"

// The weekly progress report: what moved in a period, where the project stands against its plan, what needs attention next.
// Everything is computed from the same rows the dashboards read (pins, NCRs, inspections, daily reports, client questions), so the
// report can never disagree with the screens. Pure (no network), tested in `pnpm test:lib`.

type PinRow = Pick<Pin, "id" | "title" | "blueprint_id" | "category" | "status" | "due_date" | "verified_at" | "assigned_to" | "tasks">
type DefectRow = { status: string; severity: string; due_date: string | null; raised_at: string; closed_at: string | null }
type InspectionRow = { status: string; completed_at: string | null }
type LogRow = { report_date: string; status: string; workers_count: number; work_done: string; delays: string | null; safety: string | null }
type QuestionRow = { created_at: string; answered_at: string | null }

export type WeeklyInput = {
  from: string
  to: string
  today: string
  projectStart: string | null
  projectEnd: string | null
  pins: PinRow[]
  defects?: DefectRow[] | null
  inspections?: InspectionRow[] | null
  logs: LogRow[]
  questions: QuestionRow[]
}

export type WeeklySummary = {
  from: string
  to: string
  progress: { atStart: number; now: number; change: number; planned: number; gap: number }
  total: number
  verifiedThisPeriod: Array<{ id: string; title: string; blueprintId: string; date: string }>
  waitingReview: number
  issues: number
  overdue: number
  dueNext: Array<{ id: string; title: string; blueprintId: string; due: string; assignedTo: string | null }>
  qa: null | { inspectionsDone: number; passed: number; failed: number; ncrOpened: number; ncrClosed: number; ncrOpen: number; ncrOverdue: number; ncrCritical: number }
  logs: { count: number; workersAverage: number | null; delays: Array<{ date: string; text: string }>; safety: Array<{ date: string; text: string }>; highlights: Array<{ date: string; text: string }> }
  questions: { asked: number; answered: number; waiting: number }
  curve: SCurveData | null
}

const day = (timestamp: string | null) => (timestamp ? manilaToday(new Date(timestamp)) : null)
const pct = progressPercent
const inPeriod = (date: string | null, from: string, to: string) => Boolean(date) && (date as string) >= from && (date as string) <= to
const short = (text: string, length = 160) => (text.length > length ? text.slice(0, length - 1).trimEnd() + "…" : text)

// Preset periods the screen offers. A week is Monday to Sunday (Manila); "last 7 days" ends today.
export function periodPresets(today: string) {
  const weekday = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7 // Monday = 0
  const thisMonday = addDays(today, -weekday)
  return {
    last7: { from: addDays(today, -6), to: today },
    thisWeek: { from: thisMonday, to: today },
    lastWeek: { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
  }
}

export function buildWeekly(input: WeeklyInput): WeeklySummary {
  const { from, to, today } = input
  const asOf = to < today ? to : today
  const work = input.pins.filter((pin) => pin.category !== "note")
  const tasks = scheduledTasks(work)
  const total = tasks.length
  const parents = new Map(work.map(pin => [pin.id, pin]))
  const verifiedDates = tasks.filter(task => taskApproved(task) && task.verified_at).map(task => ({ task, date: day(task.verified_at ?? null) as string }))
  const upTo = (date: string) => verifiedDates.filter((entry) => entry.date <= date).length
  const dueUpTo = (date: string) => tasks.filter((task) => task.due_date && task.due_date.slice(0, 10) <= date).length

  const atStart = pct(upTo(addDays(from, -1)), total)
  const now = pct(upTo(asOf), total)
  const planned = pct(dueUpTo(asOf), total)

  const verifiedThisPeriod = verifiedDates
    .filter((entry) => inPeriod(entry.date, from, asOf))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ task, date }) => ({ id: task.id, title: `${parents.get(task.pin_id)?.title ?? "Work pin"} → ${task.text}`, blueprintId: parents.get(task.pin_id)?.blueprint_id ?? "", date }))

  const open = work.filter((pin) => pin.status !== "verified")
  const dueNext = open
    .filter((pin) => pin.due_date && pin.due_date.slice(0, 10) > asOf && pin.due_date.slice(0, 10) <= addDays(asOf, 7))
    .sort((a, b) => (a.due_date as string).localeCompare(b.due_date as string))
    .map((pin) => ({ id: pin.id, title: pin.title, blueprintId: pin.blueprint_id, due: (pin.due_date as string).slice(0, 10), assignedTo: pin.assigned_to }))

  let qa: WeeklySummary["qa"] = null
  if (input.defects && input.inspections) {
    const done = input.inspections.filter((row) => inPeriod(day(row.completed_at), from, to))
    const openNcr = input.defects.filter((row) => row.status !== "closed")
    qa = {
      inspectionsDone: done.length,
      passed: done.filter((row) => row.status === "passed").length,
      failed: done.filter((row) => row.status === "failed").length,
      ncrOpened: input.defects.filter((row) => inPeriod(day(row.raised_at), from, to)).length,
      ncrClosed: input.defects.filter((row) => inPeriod(day(row.closed_at), from, to)).length,
      ncrOpen: openNcr.length,
      ncrOverdue: openNcr.filter((row) => row.due_date && row.due_date.slice(0, 10) < asOf).length,
      ncrCritical: openNcr.filter((row) => row.severity === "critical").length,
    }
  }

  const logs = input.logs.filter((row) => row.status === "submitted" && inPeriod(row.report_date, from, to)).sort((a, b) => a.report_date.localeCompare(b.report_date))
  const workers = logs.map((row) => row.workers_count).filter((value) => Number.isFinite(value))
  const questions = {
    asked: input.questions.filter((row) => inPeriod(day(row.created_at), from, to)).length,
    answered: input.questions.filter((row) => inPeriod(day(row.answered_at), from, to)).length,
    waiting: input.questions.filter((row) => !row.answered_at).length,
  }

  return {
    from,
    to,
    progress: { atStart, now, change: Math.round((now - atStart) * 10) / 10, planned, gap: Math.round((now - planned) * 10) / 10 },
    total,
    verifiedThisPeriod,
    waitingReview: work.filter((pin) => pin.status === "for_review").length,
    issues: work.filter((pin) => pin.status === "issue").length,
    overdue: open.filter((pin) => pin.due_date && pin.due_date.slice(0, 10) < asOf).length,
    dueNext,
    qa,
    logs: {
      count: logs.length,
      workersAverage: workers.length ? Math.round(workers.reduce((sum, value) => sum + value, 0) / workers.length) : null,
      delays: logs.filter((row) => row.delays?.trim()).map((row) => ({ date: row.report_date, text: short(row.delays as string) })),
      safety: logs.filter((row) => row.safety?.trim()).map((row) => ({ date: row.report_date, text: short(row.safety as string) })),
      highlights: logs.filter((row) => row.work_done.trim()).map((row) => ({ date: row.report_date, text: short(row.work_done) })),
    },
    questions,
    curve: sCurve(input.pins, input.projectStart, input.projectEnd, today, 28),
  }
}

// One plain sentence that tells the reader where the project stands (used at the top of both reports).
export function headline(summary: WeeklySummary): string {
  const { progress } = summary
  const move = progress.change > 0 ? `moved up ${progress.change} points` : progress.change < 0 ? `went down ${Math.abs(progress.change)} points` : "did not move"
  const plan = progress.gap >= 0 ? "on or ahead of the plan" : `${Math.abs(progress.gap)} points behind the plan`
  return `Verified progress ${move} to ${progress.now}%, ${plan} (${progress.planned}% planned by now).`
}

// ---------- Print layout ----------
const longDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })
const shortDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-PH", { day: "numeric", month: "short" })

// Static chart for paper: planned (dashed blue) against verified (solid magenta). Colours match the on-screen chart.
export function sCurveSvg(data: SCurveData, width = 640, height = 210): string {
  const pad = { top: 12, right: 14, bottom: 26, left: 38 }
  const w = width - pad.left - pad.right
  const h = height - pad.top - pad.bottom
  const { points } = data
  const x = (i: number) => pad.left + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w)
  const y = (value: number) => pad.top + h - (value / 100) * h
  const path = (pick: (point: (typeof points)[number]) => number | null) =>
    points.map((point, i) => ({ v: pick(point), i })).filter((p): p is { v: number; i: number } => p.v !== null).map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
  const grid = [0, 25, 50, 75, 100].map((value) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}" stroke="#ddd"/><text x="${pad.left - 6}" y="${y(value) + 3}" text-anchor="end" font-size="9" fill="#555">${value}%</text>`).join("")
  const ticks = [0, Math.round((points.length - 1) / 2), points.length - 1].map((i, n) => `<text x="${x(i)}" y="${height - 8}" text-anchor="${n === 0 ? "start" : n === 2 ? "end" : "middle"}" font-size="9" fill="#555">${escapeHtml(shortDate(points[i].date))}</text>`).join("")
  const today = points[data.todayIndex]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Planned against verified progress">${grid}${ticks}<line x1="${x(data.todayIndex)}" x2="${x(data.todayIndex)}" y1="${pad.top}" y2="${pad.top + h}" stroke="#777"/><text x="${x(data.todayIndex) + 3}" y="${pad.top + 9}" font-size="9" fill="#555">Today</text><path d="${path((p) => p.planned)}" fill="none" stroke="#2563eb" stroke-width="2" stroke-dasharray="5 4"/><path d="${path((p) => p.verified)}" fill="none" stroke="#9e1f93" stroke-width="2"/><circle cx="${x(data.todayIndex)}" cy="${y(today.verified ?? 0)}" r="3.5" fill="#9e1f93"/></svg><p style="margin:2px 0 0;color:#555;font-size:10px"><span style="color:#2563eb">- - -</span> planned (due dates) &nbsp; <span style="color:#9e1f93">&mdash;</span> verified by the engineer</p>`
}

type Names = { project: { code: string; name: string; location: string | null }; nameOf: (id: string | null) => string; sheetOf: (id: string) => string }

export function weeklyReportHtml(summary: WeeklySummary, names: Names, audience: "team" | "client"): string {
  const { progress } = summary
  const list = (rows: Array<{ date: string; text: string }>) => (rows.length ? rows.map((row) => `${shortDate(row.date)}: ${row.text}`).join("\n") : "")
  const sections: PrintSection[] = [
    { heading: "Where we stand", body: `${headline(summary)} Progress counts Engineer-approved tasks divided by all tasks; notes are excluded.` },
    ...(summary.curve ? [{ heading: "Plan against verified work", html: sCurveSvg(summary.curve) } satisfies PrintSection] : []),
    { heading: audience === "client" ? "Tasks approved this period" : "Tasks verified this period", ...(summary.verifiedThisPeriod.length ? { table: { head: ["Task", "Sheet", "Approved on"], rows: summary.verifiedThisPeriod.map((row) => [row.title, names.sheetOf(row.blueprintId), shortDate(row.date)]) } } : { body: "No tasks were approved in this period." }) },
    { heading: audience === "client" ? "Coming up in the next 7 days" : "Due in the next 7 days", ...(summary.dueNext.length ? { table: { head: audience === "client" ? ["Work pin", "Sheet", "Planned for"] : ["Work pin", "Sheet", "Due", "Assigned to"], rows: summary.dueNext.map((row) => (audience === "client" ? [row.title, names.sheetOf(row.blueprintId), shortDate(row.due)] : [row.title, names.sheetOf(row.blueprintId), shortDate(row.due), names.nameOf(row.assignedTo)])) } } : { body: "Nothing is due in the next 7 days." }) },
    ...(audience === "team"
      ? [
          { heading: "Needs attention", rows: [["Waiting for verification", String(summary.waitingReview)], ["Open issues", String(summary.issues)], ["Overdue work pins", String(summary.overdue)]] as Array<[string, string]> },
          ...(summary.qa
            ? [{ heading: "Quality", rows: [["Inspections completed", `${summary.qa.inspectionsDone} (${summary.qa.passed} passed, ${summary.qa.failed} failed)`], ["Defect reports raised / closed", `${summary.qa.ncrOpened} / ${summary.qa.ncrClosed}`], ["Defect reports still open", `${summary.qa.ncrOpen} (${summary.qa.ncrOverdue} overdue, ${summary.qa.ncrCritical} critical)`]] as Array<[string, string]> } satisfies PrintSection]
            : []),
        ]
      : []),
    {
      heading: "Site logs",
      rows: [["Daily reports submitted", String(summary.logs.count)], ["Average workers on site", summary.logs.workersAverage === null ? "-" : String(summary.logs.workersAverage)]],
    },
    ...(summary.logs.highlights.length ? [{ heading: "Work done on site", body: list(summary.logs.highlights) } satisfies PrintSection] : []),
    ...(summary.logs.delays.length ? [{ heading: "Delays reported", body: list(summary.logs.delays) } satisfies PrintSection] : []),
    ...(audience === "team" && summary.logs.safety.length ? [{ heading: "Safety notes", body: list(summary.logs.safety) } satisfies PrintSection] : []),
    { heading: audience === "client" ? "Your questions" : "Client questions", rows: [["Asked", String(summary.questions.asked)], ["Answered", String(summary.questions.answered)], ["Waiting for an answer", String(summary.questions.waiting)]] },
  ]
  return reportHtml({
    title: audience === "client" ? "Weekly progress summary" : "Weekly progress report",
    subtitle: `${names.project.name} (${names.project.code})${names.project.location ? " - " + names.project.location : ""}`,
    meta: [
      ["Period", `${longDate(summary.from)} to ${longDate(summary.to)}`],
      ["Verified now", `${progress.now}%`],
      ["Change", `${progress.change > 0 ? "+" : ""}${progress.change} pts`],
      ["Planned by now", `${progress.planned}%`],
    ],
    sections,
  })
}

