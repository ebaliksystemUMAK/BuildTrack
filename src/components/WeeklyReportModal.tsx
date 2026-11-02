import { useMemo, useState } from "react"
import Modal from "./Modal"
import SCurveChart from "./SCurveChart"
import { buttonPrimary, buttonSecondary, inputClass } from "./ui/PageParts"
import type { Pin } from "../lib/blueprints"
import { manilaToday } from "../lib/progress"
import { buildWeekly, comparePeriods, headline, monthPresets, periodPresets, previousPeriod, weeklyReportHtml } from "../lib/weeklyReport"
import { printHtml } from "../lib/printReport"
import { useToast } from "../lib/toast"

type Preset = "last7" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth" | "custom"
const presetLabels: Record<Preset, string> = { last7: "Last 7 days", thisWeek: "This week", lastWeek: "Last week", thisMonth: "This month", lastMonth: "Last month", custom: "Choose dates" }
const stat = "rounded-xl border border-line bg-surface-muted/60 px-3 py-2"

// Weekly or monthly progress report: pick the period, see what moved, print it or save it as a PDF. The engineer's version includes quality and
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
  const presets = useMemo(() => ({ ...periodPresets(today), ...monthPresets(today) }), [today])
  const [preset, setPreset] = useState<Preset>("last7")
  const [custom, setCustom] = useState({ from: presets.last7.from, to: today })
  const range = preset === "custom" ? custom : presets[preset]
  const valid = range.from <= range.to && range.to <= today
  const monthly = preset === "thisMonth" || preset === "lastMonth"

  const summary = useMemo(
    () => (valid ? buildWeekly({ from: range.from, to: range.to, today, projectStart: start, projectEnd: end, pins, defects, inspections, logs, questions }) : null),
    [valid, range.from, range.to, today, start, end, pins, defects, inspections, logs, questions],
  )

  // Months are compared with the month before. Only dated records are compared, never a rebuilt past snapshot (see comparePeriods).
  const comparison = useMemo(() => {
    if (!summary || !monthly) return null
    const before = previousPeriod(range, "month")
    const earlier = buildWeekly({ from: before.from, to: before.to, today, projectStart: start, projectEnd: end, pins, defects, inspections, logs, questions })
    return { previous: before, rows: comparePeriods(summary, earlier, { audience, projectStart: start }) }
  }, [summary, monthly, range, today, start, end, pins, defects, inspections, logs, questions, audience])

  const print = () => {
    if (!summary) return
    if (!printHtml(weeklyReportHtml(summary, { project, nameOf, sheetOf }, audience, { kind: monthly ? "monthly" : "weekly", comparison }))) toast.error("Could not open the print dialog", "Allow pop-ups for this site and try again.")
  }

  return (
    <Modal
      title={monthly ? (audience === "client" ? "Monthly summary" : "Monthly progress report") : audience === "client" ? "Weekly summary" : "Weekly progress report"}
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
            {monthly ? (
              <p className="text-sm text-fg-muted">Task approvals move the progress figure. A work pin is completed only after final acceptance: <strong className="text-fg">{summary.pinsAccepted.length}</strong> completed in this period, <strong className="text-fg">{summary.verifiedThisPeriod.length}</strong> task{summary.verifiedThisPeriod.length === 1 ? "" : "s"} approved.</p>
            ) : null}
            {comparison ? (
              <section aria-label="Comparison with the previous month" className="rounded-xl border border-line">
                <h3 className="border-b border-line px-3 py-2 text-sm font-extrabold">Compared with {comparison.previous.from} to {comparison.previous.to}</h3>
                {comparison.rows ? (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs uppercase tracking-wider text-fg-muted"><th className="px-3 py-1.5 font-bold">Recorded in the period</th><th className="px-3 py-1.5 text-right font-bold">This period</th><th className="px-3 py-1.5 text-right font-bold">Before</th><th className="px-3 py-1.5 text-right font-bold">Change</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {comparison.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="px-3 py-1.5">{row.label}</td>
                          <td className="px-3 py-1.5 text-right font-bold tabular-nums">{row.current}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">{row.previous}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{row.change > 0 ? "+" : ""}{row.change}{row.percent === null ? "" : ` (${row.percent > 0 ? "+" : ""}${row.percent}%)`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="px-3 py-3 text-sm text-fg-muted">There is nothing to compare with: the project had not started in that earlier period.</p>}
                <p className="border-t border-line px-3 py-2 text-xs text-fg-muted">Only things recorded with a date are compared. Open counts such as waiting for review or overdue are today's state; past values were not stored.</p>
              </section>
            ) : null}
            <SCurveChart pins={pins} start={start} end={end} today={today} compact />
          </>
        )}
      </div>
    </Modal>
  )
}
