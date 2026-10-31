import { useEffect, useRef, useState } from "react"
import Modal from "../Modal"
import { attendanceDay } from "../../lib/attendanceModel"
import { loadAttendanceReport } from "../../lib/attendanceReportData"
import { attendanceReportRange, attendanceReportCounts, attendanceReportWorkers, reportPeriodTitle, type AttendanceReportPeriod, type AttendanceReportData } from "../../lib/attendanceReportModel"
import { attendanceReportHtml, attendanceReportCsv, attendanceReportFilename } from "../../lib/attendanceReportPrint"
import { printHtml } from "../../lib/printReport"
import { downloadCsv } from "../../lib/progress"

type Props = {
  projectId: string
  anchorDay: string
  workerId?: string
  workerName?: string
}

export default function AttendanceReportButton(props: Props) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-xl bg-brand px-4 text-sm font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" aria-label={props.workerName ? `Generate attendance report for ${props.workerName}` : "Generate project attendance report"} onClick={() => setOpen(true)}>Generate report</button>
    {open && <AttendanceReportDialog key={`${props.projectId}:${props.workerId ?? "all"}`} {...props} onClose={() => setOpen(false)} />}
  </>
}

export function AttendanceReportDialog({ projectId, anchorDay, workerId, workerName, onClose }: Props & { onClose: () => void }) {
  const [period, setPeriod] = useState<AttendanceReportPeriod>("daily")
  const [anchor, setAnchor] = useState(anchorDay)
  const [endDay, setEndDay] = useState(anchorDay)
  const [workerPage, setWorkerPage] = useState(0)
  const [report, setReport] = useState<AttendanceReportData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const generation = useRef(0)
  const today = attendanceDay()
  let range: ReturnType<typeof attendanceReportRange> | null = null
  let rangeProblem = ""
  try { range = attendanceReportRange(period, anchor, today, endDay) } catch (problem) { rangeProblem = (problem as Error).message }
  useEffect(() => () => { generation.current++ }, [])
  async function generate() {
    if (busy || !range) return
    const request = ++generation.current
    setBusy(true); setError(""); setReport(null); setWorkerPage(0)
    try {
      const loaded = await loadAttendanceReport(projectId, period, anchor, workerId ?? null, period === "custom" ? endDay : undefined)
      if (request === generation.current) setReport(loaded)
    } catch (problem) {
      if (request === generation.current) setError(problem instanceof Error ? problem.message : "Report generation failed. Please retry.")
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }
  const counts = report ? attendanceReportCounts(report.days) : null
  const workers = report && report.range.period !== "daily" ? attendanceReportWorkers(report.days) : []
  const workerPageSize = 20
  return <Modal title={workerName ? `Attendance report · ${workerName}` : "Project attendance report"} description="Generate a daily report or attendance totals by worker for a week, month or date range." size="lg" onClose={onClose}>
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={`block space-y-1 text-xs font-bold ${period === "custom" ? "sm:col-span-2" : ""}`}>Report period
          <select aria-label="Report period" disabled={busy} className="min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm" value={period} onChange={event => { setPeriod(event.target.value as AttendanceReportPeriod); if (event.target.value === "custom" && endDay < anchor) setEndDay(anchor); setReport(null); setError("") }}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Date range</option>
          </select>
        </label>
        <label className="block min-w-0 space-y-1 text-xs font-bold">{period === "custom" ? "From date" : "Date within the period"}
          <input aria-label={period === "custom" ? "From date" : "Report date"} type="date" max={today} disabled={busy} className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm" value={anchor} onChange={event => { setAnchor(event.target.value); setReport(null); setError("") }} />
        </label>
        {period === "custom" && <label className="block min-w-0 space-y-1 text-xs font-bold">To date
          <input aria-label="To date" type="date" min={anchor || undefined} max={today} disabled={busy} className="min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm" value={endDay} onChange={event => { setEndDay(event.target.value); setReport(null); setError("") }} />
        </label>}
      </div>
      {range ? <div className="rounded-xl bg-surface-muted p-4 text-sm"><strong>{reportPeriodTitle(period)} · {range.startDay} – {range.endDay}</strong><p className="mb-0 mt-2 text-xs text-fg-muted">Records through {range.throughDay} · Philippine time. Weeks run Monday–Sunday; months use calendar dates. Date ranges include both selected dates. Current periods are to date.</p></div> : <p role="alert" className="text-sm text-red-600">{rangeProblem}</p>}
      <p className="text-xs text-fg-muted">{workerName ? `Only ${workerName}’s attendance in this project is included.` : "Includes daily attendance for all project workers, including absences."} Reports include the entire period—not just the page shown in the attendance list.</p>
      <div className="flex justify-end"><button type="button" disabled={busy || !range} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-brand px-5 text-sm font-bold text-white disabled:opacity-50 sm:w-auto" onClick={() => void generate()}>{busy ? "Generating report…" : "Generate report"}</button></div>
      {busy && <p role="status" className="text-sm text-fg-muted">Loading all report records…</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {report && counts && <section aria-label="Generated attendance report" className="space-y-4 border-t border-border pt-5">
        <h3 className="text-lg font-bold">Report ready</h3>
        <p className="break-words text-sm">{report.project.code} · {report.project.name}{report.worker ? ` · ${report.worker.full_name}` : ""}</p>
        <p className="break-words text-xs text-fg-muted">Generated by <strong className="text-fg">{report.generatedBy}</strong> · {new Date(report.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} PHT</p>
        <dl className="grid grid-cols-3 gap-3 text-sm">{[["Present", counts.present], ["Absent", counts.absent], ["Late", counts.late]].map(([label, value]) => <div key={label} className="rounded-xl border border-border p-3"><dt className="text-xs text-fg-muted">{label}</dt><dd className="ml-0 mt-1 text-xl font-bold">{value}</dd></div>)}</dl>
        {!report.days.length && <p className="text-sm text-fg-muted">No daily attendance records for this scope and period.</p>}
        {workers.length > 0 && <div className="space-y-2">
          <h4 className="text-sm font-bold">Attendance totals by worker</h4>
          <div className="overflow-x-auto rounded-xl border border-border"><table aria-label="Attendance totals by worker" className="w-full min-w-[480px] text-left text-sm">
            <thead className="bg-surface-muted text-xs text-fg-muted"><tr>{["Worker", "Code", "Present (days)", "Absent (days)", "Late (days)"].map(label => <th key={label} scope="col" className="px-3 py-2">{label}</th>)}</tr></thead>
            <tbody>{workers.slice(workerPage * workerPageSize, (workerPage + 1) * workerPageSize).map(worker => <tr key={worker.workerId} className="border-t border-border"><td className="break-words px-3 py-2 font-semibold">{worker.name}</td><td className="whitespace-nowrap px-3 py-2">{worker.code}</td><td className="px-3 py-2 tabular-nums">{worker.present}</td><td className="px-3 py-2 tabular-nums">{worker.absent}</td><td className="px-3 py-2 tabular-nums">{worker.late}</td></tr>)}</tbody>
          </table></div>
          {workers.length > workerPageSize && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted"><span>{workerPage * workerPageSize + 1}–{Math.min((workerPage + 1) * workerPageSize, workers.length)} of {workers.length} workers · PDF and CSV include everyone.</span><div className="flex gap-2"><button type="button" className="min-h-9 rounded-lg border border-border px-3 font-bold disabled:opacity-50" disabled={workerPage === 0} onClick={() => setWorkerPage(value => value - 1)}>Previous workers</button><button type="button" className="min-h-9 rounded-lg border border-border px-3 font-bold disabled:opacity-50" disabled={(workerPage + 1) * workerPageSize >= workers.length} onClick={() => setWorkerPage(value => value + 1)}>Next workers</button></div></div>}
        </div>}
        <div className="grid gap-3 sm:flex sm:flex-wrap sm:justify-end">
          <button type="button" className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold" onClick={() => {
            try { if (!printHtml(attendanceReportHtml(report))) throw new Error("The print dialog could not open. Please retry in your browser.") }
            catch (problem) { setError(problem instanceof Error ? problem.message : "Could not print the report.") }
          }}>Print / Save as PDF</button>
          <button type="button" className="min-h-11 rounded-xl border border-border px-4 text-sm font-bold" onClick={() => {
            try { downloadCsv(attendanceReportFilename(report), attendanceReportCsv(report)) }
            catch { setError("Could not download the report. Please retry.") }
          }}>Download CSV</button>
        </div>
        <p className="mb-0 text-xs text-fg-muted">{report.range.period === "daily" ? "PDF and CSV show daily time records." : "PDF and CSV show one row per worker with Present, Absent and Late day counts for the selected period."} Present includes late arrivals; Late is a subset of Present. Pending attendance, rest days, no schedule and no fingerprint are excluded from the totals.</p>
      </section>}
    </div>
  </Modal>
}
