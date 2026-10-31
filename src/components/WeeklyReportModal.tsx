import { useMemo, useState } from "react"
import Modal from "./Modal"
import SCurveChart from "./SCurveChart"
import { buttonPrimary, buttonSecondary, inputClass } from "./ui/PageParts"
import type { Pin } from "../lib/blueprints"
import { manilaToday } from "../lib/progress"
import { buildWeekly, headline, periodPresets, weeklyReportHtml } from "../lib/weeklyReport"
import { printHtml } from "../lib/printReport"
import { useToast } from "../lib/toast"

type Preset = "last7" | "thisWeek" | "lastWeek" | "custom"
const presetLabels: Record<Preset, string> = { last7: "Last 7 days", thisWeek: "This week", lastWeek: "Last week", custom: "Choose dates" }
const stat = "rounded-xl border border-line bg-surface-muted/60 px-3 py-2"

// Weekly progress report: pick the period, see what moved, print it or save it as a PDF. The engineer's version includes quality and
// safety; the client's version is plain language and leaves internal sections out. Both read the same rows as the dashboards.
export default function WeeklyReportModal({
  audience,
  project,
  pins,
  start,
  end,
  logs,
  questions,
  defects,
  inspections,
  nameOf,
  sheetOf,
  onClose,
}: {
  audience: "team" | "client"
  project: { code: string; name: string; location: string | null }
  pins: Pin[]
  start: string | null
  end: string | null
  logs: Parameters<typeof buildWeekly>[0]["logs"]
  questions: Parameters<typeof buildWeekly>[0]["questions"]
  defects?: Parameters<typeof buildWeekly>[0]["defects"]
  inspections?: Parameters<typeof buildWeekly>[0]["inspections"]
  nameOf: (id: string | null) => string
  sheetOf: (id: string) => string
  onClose: () => void
}) {
  const toast = useToast()
  const today = manilaToday()
  const presets = useMemo(() => periodPresets(today), [today])
  const [preset, setPreset] = useState<Preset>("last7")
  const [custom, setCustom] = useState({ from: presets.last7.from, to: today })
  const range = preset === "custom" ? custom : presets[preset]
  const valid = range.from <= range.to && range.to <= today

  const summary = useMemo(
    () => (valid ? buildWeekly({ from: range.from, to: range.to, today, projectStart: start, projectEnd: end, pins, defects, inspections, logs, questions }) : null),
    [valid, range.from, range.to, today, start, end, pins, defects, inspections, logs, questions],
  )

  const print = () => {
    if (!summary) return
    if (!printHtml(weeklyReportHtml(summary, { project, nameOf, sheetOf }, audience))) toast.error("Could not open the print dialog", "Allow pop-ups for this site and try again.")
  }

  return (
    <Modal
      title={audience === "client" ? "Weekly summary" : "Weekly progress report"}
      description={`${project.name} (${project.code})`}
      size="xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Close</button>
          <button type="button" className={buttonPrimary} onClick={print} disabled={!summary}>Print or save as PDF</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-surface p-1" role="group" aria-label="Period">
            {(Object.keys(presetLabels) as Preset[]).map((key) => (
              <button key={key} type="button" aria-pressed={preset === key} onClick={() => setPreset(key)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${preset === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}>{presetLabels[key]}</button>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-bold text-fg-muted">From <input type="date" className={`${inputClass} !w-auto`} value={custom.from} max={today} onChange={(event) => setCustom((value) => ({ ...value, from: event.target.value }))} /></label>
              <label className="text-xs font-bold text-fg-muted">To <input type="date" className={`${inputClass} !w-auto`} value={custom.to} max={today} onChange={(event) => setCustom((value) => ({ ...value, to: event.target.value }))} /></label>
            </div>
          ) : null}
        </div>

        {!summary ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">Choose a start date that is not after the end date, and an end date that is not in the future.</p>
        ) : (
          <>
            <p className="text-sm font-semibold">{headline(summary)}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className={stat}><p className="text-[11px] font-extrabold uppercase tracking-wider text-fg-muted">Verified now</p><p className="text-2xl font-extrabold tabular-nums">{summary.progress.now}%</p><p className="text-xs text-fg-muted">{summary.progress.change > 0 ? "+" : ""}{summary.progress.change} points this period</p></div>
              <div className={stat}><p className="text-[11px] font-extrabold uppercase tracking-wider text-fg-muted">Planned by now</p><p className="text-2xl font-extrabold tabular-nums">{summary.progress.planned}%</p><p className="text-xs text-fg-muted">{summary.progress.gap >= 0 ? "on or ahead of plan" : `${Math.abs(summary.progress.gap)} points behind`}</p></div>
              <div className={stat}><p className="text-[11px] font-extrabold uppercase tracking-wider text-fg-muted">Verified this period</p><p className="text-2xl font-extrabold tabular-nums">{summary.verifiedThisPeriod.length}</p><p className="text-xs text-fg-muted">tasks approved</p></div>
              <div className={stat}><p className="text-[11px] font-extrabold uppercase tracking-wider text-fg-muted">{audience === "client" ? "Coming up" : "Needs attention"}</p><p className="text-2xl font-extrabold tabular-nums">{audience === "client" ? summary.dueNext.length : summary.waitingReview + summary.issues + summary.overdue}</p><p className="text-xs text-fg-muted">{audience === "client" ? "planned in the next 7 days" : `${summary.waitingReview} to verify, ${summary.issues} issue${summary.issues === 1 ? "" : "s"}, ${summary.overdue} overdue`}</p></div>
            </div>
            {audience === "team" && summary.qa ? (
              <p className="text-sm text-fg-muted">Quality: {summary.qa.inspectionsDone} inspection{summary.qa.inspectionsDone === 1 ? "" : "s"} completed ({summary.qa.passed} passed, {summary.qa.failed} failed); {summary.qa.ncrOpened} defect report{summary.qa.ncrOpened === 1 ? "" : "s"} raised, {summary.qa.ncrClosed} closed, {summary.qa.ncrOpen} still open.</p>
            ) : null}
            <p className="text-sm text-fg-muted">Site logs: {summary.logs.count} daily report{summary.logs.count === 1 ? "" : "s"} submitted{summary.logs.workersAverage === null ? "" : `, about ${summary.logs.workersAverage} workers on site`}. Questions: {summary.questions.asked} asked, {summary.questions.answered} answered.</p>
            <SCurveChart pins={pins} start={start} end={end} today={today} compact />
          </>
        )}
      </div>
    </Modal>
  )
}
