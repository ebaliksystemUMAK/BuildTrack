import { useMemo, useRef, useState } from "react"
import WeeklyReportModal from "../../components/WeeklyReportModal"
import AttendanceReportButton from "../../components/attendance/AttendanceReportButton"
import { EmptyState, Meter, PageHead, buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { attendanceDay } from "../../lib/attendanceModel"
import { severityLabels, statusLabels } from "../../lib/blueprints"
import { downloadBlob } from "../../lib/exportSheet"
import { printHtml, reportHtml } from "../../lib/printReport"
import { byZone, daysBetween, downloadCsv, isOverdue, summarize, toCsv } from "../../lib/progress"
import { exportProject, type ExportProgress, type ExportResult } from "../../lib/projectExport"
import { useProjectWork } from "../../lib/projectWork"
import { useDefects, useInspections, useQaSummary } from "../../lib/qa"
import { qaSummaryHtml } from "../../lib/qaPrint"
import { linkedWorkLabel, type ReportWork } from "../../lib/reportFormat"
import { useProjectWorkItems } from "../../lib/dailyPhotos"
import { dailyReportHtml, reportDateLong, useDailyReports, useQuestions, weatherLabels, type DailyReport } from "../../lib/reports"
import { siteLogReports } from "../../lib/siteReportsModel"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { Panel } from "../Admin/AdminShell"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`
const reviewLabel: Record<string, string> = { pending: "Waiting for review", reviewed: "Reviewed", returned: "Returned" }

// Reports & export for one project: daily site reports, progress, quality and attendance reports, and a backup of this project only.
// Company-wide backups stay with Admins.
export default function PmReports(_: PmPageProps) {
  const pm = usePmProject()
  const projectId = pm.project?.id ?? null
  const work = useProjectWork(projectId)
  const { reports, loading: reportsLoading, error: reportsError } = useDailyReports(projectId, true)
  const workItems = useProjectWorkItems(projectId, true)
  const { questions } = useQuestions(projectId)
  const { defects } = useDefects(projectId)
  const { inspections } = useInspections(projectId)
  const { summary } = useQaSummary(projectId)
  const toast = useToast()
  const [weekly, setWeekly] = useState(false)
  const [withFiles, setWithFiles] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [exportError, setExportError] = useState("")
  const cancel = useRef({ cancelled: false })
  const logs = useMemo(() => siteLogReports(reports, projectId), [reports, projectId])

  const describe = (link: ReportWork) => linkedWorkLabel(link, (id) => work.pins.find((pin) => pin.id === id)?.title, (id) => workItems.find((item) => item.id === id)?.text)
  const printDaily = (report: DailyReport) => {
    if (!work.project) return
    if (!printHtml(dailyReportHtml(report, work.project, work.nameOf(report.author_id), describe))) toast.error("Could not open the print dialog")
  }
  const dailyCsv = () => downloadCsv(`site-logs-${work.project?.code ?? "project"}-${work.today}.csv`, toCsv(["Date", "Prepared by", "Weather", "Workers", "Work done", "Review", "Revision"],
    logs.map((report) => [report.report_date, work.nameOf(report.author_id), weatherLabels[report.weather], report.workers_count, report.work_done, report.review_state ?? "pending", report.revision ?? 0])))

  const printProgress = () => {
    if (!work.project) return
    const totals = summarize(work.pins, work.today)
    const zones = byZone(work.blueprints, work.pins, work.today)
    const open = work.pins.filter((pin) => pin.status === "issue")
    const late = work.pins.filter((pin) => isOverdue(pin, work.today))
    const html = reportHtml({
      title: "Progress report",
      subtitle: `${work.project.name} (${work.project.code})${work.project.location ? " - " + work.project.location : ""}`,
      meta: [["As of", reportDateLong(work.today)], ["Approved task progress", `${totals.percentVerified}%`], ["Tasks approved / total", `${totals.approvedTasks} / ${totals.totalTasks}`], ["Work pins", String(totals.total)], ["Overdue / issues", `${totals.overdue} / ${totals.issue}`]],
      sections: [
        { heading: "Status summary", rows: (["verified", "for_review", "in_progress", "not_started", "issue"] as const).map((status) => [statusLabels[status], String(totals[status])] as [string, string]) },
        { heading: "Progress by sheet", table: { head: ["Sheet", "Level", "Pins", "Completed pins", "To review", "Issues", "Overdue", "Tasks approved / total", "% approved tasks"], rows: zones.map((zone) => [zone.title, zone.level ?? "-", String(zone.totals.total), String(zone.totals.verified), String(zone.totals.for_review), String(zone.totals.issue), String(zone.totals.overdue), `${zone.totals.approvedTasks} / ${zone.totals.totalTasks}`, `${zone.totals.percentVerified}%`]) } },
        { heading: "Open issues", table: open.length ? { head: ["Issue", "Sheet", "Severity", "Assigned to"], rows: open.map((pin) => [pin.title, work.sheetOf(pin.blueprint_id), severityLabels[pin.severity], work.nameOf(pin.assigned_to)]) } : undefined, body: open.length ? undefined : "No open issues." },
        { heading: "Late work", table: late.length ? { head: ["Pin", "Sheet", "Due", "Days late", "Assigned to"], rows: late.map((pin) => [pin.title, work.sheetOf(pin.blueprint_id), pin.due_date ?? "", String(daysBetween(pin.due_date as string, work.today)), work.nameOf(pin.assigned_to)]) } : undefined, body: late.length ? undefined : "Nothing is past its deadline." },
      ],
    })
    if (!printHtml(html)) toast.error("Could not open the print dialog")
  }

  const printQa = () => {
    if (!summary || !work.project) return
    const stamp = new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "long", year: "numeric" })
    if (!printHtml(qaSummaryHtml({ summary, defects, project: work.project, nameOf: work.nameOf, today: work.today, asOf: stamp }))) toast.error("Could not open the print dialog")
  }

  const backup = async () => {
    if (!projectId) return
    cancel.current = { cancelled: false }
    setBusy(true)
    setExportError("")
    setResult(null)
    try {
      const made = await exportProject(projectId, { withFiles, onProgress: setProgress, cancel: cancel.current })
      downloadBlob(made.blob, made.filename)
      const { error: logError } = await supabase.rpc("log_project_export", { p_project: projectId, p_with_files: withFiles, p_rows: made.rows })
      if (logError) toast.error("The export was saved, but it could not be written to the audit log", logError.message)
      setResult(made)
      toast.success("Project export downloaded", made.filename)
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "The export failed. Try again."
      setExportError(message)
      if (!/cancelled/i.test(message)) toast.error("Export failed", message)
    }
    setBusy(false)
    setProgress(null)
  }

  if (!pm.project || !projectId) return <div className="admin-page"><SkeletonList rows={4} label="Loading reports" /></div>
  const dataReady = !work.loading && !work.error && Boolean(work.project)

  return (
    <div className="admin-page">
      <PageHead eyebrow={`${pm.project.code} • Reports & export`} title="Reports & export" description="Daily site reports, progress, quality and attendance reports, and an export of this project only." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Progress">
          <p className="mb-3 text-sm text-fg-muted">A status snapshot by sheet with late work and open issues, or the weekly team report with quality and safety.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonSecondary} disabled={!dataReady} onClick={printProgress}>Status snapshot</button>
            <button type="button" className={buttonPrimary} disabled={!dataReady || reportsLoading} onClick={() => setWeekly(true)}>Weekly report</button>
          </div>
        </Panel>
        <Panel title="Quality">
          <p className="mb-3 text-sm text-fg-muted">Inspections, pass rate and NCRs of this project as a printable summary.</p>
          <button type="button" className={buttonSecondary} disabled={!summary || !dataReady} onClick={printQa}>Print QA summary</button>
        </Panel>
        <Panel title="Attendance">
          <p className="mb-3 text-sm text-fg-muted">Daily time records or per-worker attendance totals for a week, month or date range, as PDF or CSV.</p>
          <AttendanceReportButton projectId={projectId} anchorDay={attendanceDay()} />
        </Panel>
        <Panel title="Project export">
          <fieldset className="mb-3 space-y-2" disabled={busy}>
            <legend className="sr-only">What to include</legend>
            <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="pm-export" className="mt-1" checked={!withFiles} onChange={() => setWithFiles(false)} />
              <span><strong className="block">Data only</strong><span className="text-fg-muted">Small and quick: pins, timelines, reports, QA records and the list of files.</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="pm-export" className="mt-1" checked={withFiles} onChange={() => setWithFiles(true)} />
              <span><strong className="block">Data and files</strong><span className="text-fg-muted">Adds every plan file and photo. It can be large.</span></span>
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void backup()}>{busy ? "Working..." : `Export ${pm.project.code}`}</button>
            {busy ? <button type="button" className={buttonSecondary} onClick={() => { cancel.current.cancelled = true }}>Cancel</button> : null}
          </div>
          {progress ? <div role="status" aria-live="polite" className="mt-3"><p className="mb-1 text-sm font-semibold">{progress.step}</p><Meter value={progress.total ? (progress.done / progress.total) * 100 : 0} label="Export progress" /></div> : null}
          {exportError && !/cancelled/i.test(exportError) ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{exportError}</p> : null}
          {result ? <p className="mt-3 text-sm text-fg-muted">Done: {result.filename} • {result.rows} rows • {result.files} files • {megabytes(result.blob.size)}{result.missing.length ? ` • ${result.missing.length} files could not be included` : ""}</p> : null}
          <p className="mt-3 text-xs text-fg-muted">Each export is written to the project audit log. It holds only what you may read on this project.</p>
        </Panel>
      </div>

      <Panel title={`Daily site reports (${logs.length})`} action={logs.length ? <button type="button" className={buttonSecondary} onClick={dailyCsv}>Download CSV</button> : undefined}>
        {reportsError ? <p role="alert" className="text-sm text-danger-fg">{reportsError}</p> : reportsLoading ? <SkeletonList rows={3} /> : logs.length === 0 ? (
          <EmptyState title="No daily reports yet">The Foremen's submitted daily reports appear here.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Date</th><th>Prepared by</th><th>Workers</th><th>Work done</th><th>Review</th><th><span className="sr-only">Print</span></th></tr></thead>
              <tbody>
                {logs.slice(0, 60).map((report) => (
                  <tr key={report.id}>
                    <td className="is-strong">{reportDateLong(report.report_date)}</td>
                    <td>{work.nameOf(report.author_id)}</td>
                    <td>{report.workers_count}</td>
                    <td className="max-w-[28rem] truncate" title={report.work_done}>{report.work_done}</td>
                    <td>{reviewLabel[report.review_state ?? "pending"] ?? report.review_state}</td>
                    <td><button type="button" className="min-h-6 text-sm font-bold text-brand-text hover:underline" onClick={() => printDaily(report)}>Print</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {logs.length > 60 ? <p className="mt-2 text-xs text-fg-muted">Showing the latest 60. The CSV holds all {logs.length}.</p> : null}
      </Panel>

      {weekly && work.project ? (
        <WeeklyReportModal audience="team" project={work.project} pins={work.pins} start={work.project.start_date} end={work.project.end_date}
          logs={reports} questions={questions} defects={defects} inspections={inspections} nameOf={work.nameOf} sheetOf={work.sheetOf} onClose={() => setWeekly(false)} />
      ) : null}
    </div>
  )
}
