import { useEffect, useRef, useState } from "react"
import Modal from "../Modal"
import { attendanceDay } from "../../lib/attendanceModel"
import { loadAttendanceReport } from "../../lib/attendanceReportData"
import { attendanceReportRange, attendanceReportSummary, reportPeriodTitle, type AttendanceReportPeriod, type AttendanceReportData } from "../../lib/attendanceReportModel"
import { attendanceReportHtml, attendanceReportCsv, attendanceReportFilename } from "../../lib/attendanceReportPrint"
import { printHtml } from "../../lib/printReport"
import { downloadCsv } from "../../lib/progress"
import { dailyStatusCounts } from "../../lib/attendanceStatusModel"

type Props = {
  projectId: string
  anchorDay: string
  workerId?: string
  workerName?: string
}

export default function AttendanceReportButton(props: Props) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="min-h-11 rounded-xl bg-brand px-4 text-sm font-bold text-white" aria-label={props.workerName ? `Generate attendance report for ${props.workerName}` : "Generate project attendance report"} onClick={() => setOpen(true)}>Generate report</button>
    {open && <AttendanceReportDialog {...props} onClose={() => setOpen(false)} />}
  </>
}

export function AttendanceReportDialog({ projectId, anchorDay, workerId, workerName, onClose }: Props & { onClose: () => void }) {
  const [period, setPeriod] = useState<AttendanceReportPeriod>("daily")
  const [anchor, setAnchor] = useState(anchorDay)
  const [report, setReport] = useState<AttendanceReportData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const generation = useRef(0)
  const today = attendanceDay()
  let range: ReturnType<typeof attendanceReportRange> | null = null
  try { range = attendanceReportRange(period, anchor, today) } catch { /* Validation is shown below. */ }
  useEffect(() => () => { generation.current++ }, [])
  async function generate() {
    if (busy || !range) return
    const request = ++generation.current
    setBusy(true); setError(""); setReport(null)
    try {
      const loaded = await loadAttendanceReport(projectId, period, anchor, workerId ?? null)
      if (request === generation.current) setReport(loaded)
    } catch (problem) {
      if (request === generation.current) setError(problem instanceof Error ? problem.message : "Report generation failed. Please retry.")
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }
  const summary = report ? attendanceReportSummary(report.events) : null
  return <Modal title={workerName ? `Attendance report · ${workerName}` : "Project attendance report"} description="Generate a complete daily, weekly or monthly report." size="lg" onClose={onClose}>
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-xs font-bold">Report period
          <select aria-label="Report period" disabled={busy} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" value={period} onChange={event => { setPeriod(event.target.value as AttendanceReportPeriod); setReport(null); setError("") }}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="block space-y-1 text-xs font-bold">Date within the period
          <input aria-label="Report date" type="date" max={today} disabled={busy} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" value={anchor} onChange={event => { setAnchor(event.target.value); setReport(null); setError("") }} />
        </label>
      </div>
      {range ? <div className="rounded-xl bg-surface-muted p-4 text-sm"><strong>{reportPeriodTitle(period)} · {range.startDay} – {range.endDay}</strong><p className="mb-0 mt-2 text-xs text-fg-muted">Records through {range.throughDay} · Philippine time. Weeks run Monday–Sunday; months use calendar dates. Current periods are to date.</p></div> : <p role="alert" className="text-sm text-red-600">Choose a valid date no later than today.</p>}
      <p className="text-xs text-fg-muted">{workerName ? `Only ${workerName}’s attendance in this project is included.` : "Includes all recorded attendance in the selected project."} Reports include the entire period—not just the page shown in the attendance list.</p>
      <button type="button" disabled={busy || !range} className="min-h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white disabled:opacity-50" onClick={() => void generate()}>{busy ? "Generating report…" : "Generate report"}</button>
      {busy && <p role="status" className="text-sm text-fg-muted">Loading all report records…</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {report && summary && <section aria-label="Generated attendance report" className="space-y-4 border-t border-border pt-5">
        <h3 className="text-lg font-bold">Report ready</h3>
        <p className="text-sm">{report.project.code} · {report.project.name}{report.worker ? ` · ${report.worker.full_name}` : ""}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{(report.days ? [["Scans", summary.scans], ["On time", dailyStatusCounts(report.days).on_time], ["Late", dailyStatusCounts(report.days).late], ["Absent", dailyStatusCounts(report.days).absent]] : [["Scans", summary.scans], ["Workers", summary.workers], ["Time-in scans", summary.clockIns], ["Time-out scans", summary.clockOuts]]).map(([label, value]) => <div key={label} className="rounded-xl border border-border p-3"><dt className="text-xs text-fg-muted">{label}</dt><dd className="ml-0 mt-1 text-xl font-bold">{value}</dd></div>)}</dl>
        {!summary.scans && <p className="text-sm text-fg-muted">No attendance recorded for this scope and period. The report will state this.</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold" onClick={() => {
            try { if (!printHtml(attendanceReportHtml(report))) throw new Error("The print dialog could not open. Please retry in your browser.") }
            catch (problem) { setError(problem instanceof Error ? problem.message : "Could not print the report.") }
          }}>Print / Save as PDF</button>
          <button type="button" className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold" onClick={() => {
            try { downloadCsv(attendanceReportFilename(report), attendanceReportCsv(report)) }
            catch { setError("Could not download the report. Please retry.") }
          }}>Download CSV</button>
        </div>
        <p className="mb-0 text-xs text-fg-muted">The printable report includes daily worker summaries and every scan record. CSV contains every scan. No worked-hours, absence or payroll assumptions are made.</p>
      </section>}
    </div>
  </Modal>
}
