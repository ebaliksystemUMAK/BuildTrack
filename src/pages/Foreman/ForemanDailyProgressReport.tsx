import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import DailyReportPhotos from "../../components/DailyReportPhotos"
import { ReportHistory, TaskProgressEditor } from "../../components/DailyReportWorkflow"
import { useBlueprints, useProjectPins } from "../../lib/blueprints"
import ProjectContextBar from "../../components/ProjectContextBar"
import { EmptyState, PageHead, buttonDanger, buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { isNetworkProblem } from "../../lib/offlineModel"
import { enqueue } from "../../lib/offlineQueue"
import { manilaToday } from "../../lib/progress"
import { printHtml } from "../../lib/printReport"
import { getSelectedProjectId, useProject } from "../../lib/projects"
import { dailyReportHtml, reportDateLong, reportError, reportableDates, useDailyReports, weatherLabels, type DailyReport, type Weather, type ReportWork } from "../../lib/reports"
import { blankEntry, carryForwardProgress, entryProblem, linkedWorkLabel, moveSummaryToTask, previousTaskProgress, reportEntries, saveReportArgs, sameWork, type ReportEntry, type ReportProgressHistory, type ReportSave } from "../../lib/reportFormat"
import { useEvidencePhotos, useProjectWorkItems } from "../../lib/dailyPhotos"
import { photosOutsideTasks } from "../../lib/photoGalleryModel"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { useReportAttendance } from "../../lib/reportAttendance"
import type { ForemanPageProps } from "./types"

// Issues, delays and safety are no longer asked for: an existing report keeps whatever it already has (those columns are never written here).
type Form = { weather: Weather; work_done: string; entries: ReportEntry[] }
type Errors = { work_done?: string; entries?: Record<string, string> }
const emptyForm: Form = { weather: "sunny", work_done: "", entries: [] }
// The browser chooses each entry's id, so a retried save and a photo attached to the entry keep pointing at the same row.
const newEntryId = () => crypto.randomUUID()
// form.work_done is only the report's own box (older reports, or no assigned work). When tasks hold the text, the saved summary is built from them.
const fromReport = (report: DailyReport, editable: boolean, progressHistory: ReportProgressHistory): Form => {
  const saved = reportEntries(report, newEntryId)
  const entries = editable ? carryForwardProgress(saved, progressHistory) : saved
  const moved = editable ? moveSummaryToTask(entries, report.work_done) : entries
  return { weather: report.weather, entries: moved, work_done: moved.some(entry => entry.work_done.trim()) ? "" : report.work_done }
}

// The foreman's daily site report: write it (autosave is a button press, not a surprise), submit it, and it becomes the site log.
export default function ForemanDailyProgressReport(_: ForemanPageProps) {
  const projectId = getSelectedProjectId()
  const { profile } = useAuth()
  const { project } = useProject(projectId)
  const { pins, loading: pinsLoading } = useProjectPins(projectId, true)
  const { blueprints } = useBlueprints(projectId)
  const workItems = useProjectWorkItems(projectId, true)
  const describeWork = (work: ReportWork) => linkedWorkLabel(work, (id) => pins.find((pin) => pin.id === id)?.title, (id) => workItems.find((item) => item.id === id)?.text)
  const { reports, loading, error, reload } = useDailyReports(projectId, true)
  const toast = useToast()
  const confirm = useConfirm()
  const today = manilaToday()
  const dates = useMemo(() => reportableDates(today), [today])
  const [date, setDate] = useState(today)
  const progressHistory = useMemo(() => previousTaskProgress(reports, projectId, date), [reports, projectId, date])
  const [form, setForm] = useState<Form>(emptyForm)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  // Any open photo capture holds the report back from being saved, whichever task entry it belongs to.
  const capturing = useRef(new Set<string>())
  const trackPhotos = useCallback((panel: string, active: boolean) => {
    if (active) capturing.current.add(panel); else capturing.current.delete(panel)
    setPhotoBusy(capturing.current.size > 0)
  }, [])
  const dirty = useRef(false)
  const formScope = useRef("")

  const mine = useMemo(() => reports.filter((report) => report.author_id === profile?.id && report.project_id === projectId), [reports, profile?.id, projectId])
  const reportDays = [...new Set([...dates, ...mine.map(report => report.report_date)])].sort().reverse()
  const existing = mine.find((report) => report.report_date === date) ?? null
  const historical = !dates.includes(date)
  const readOnly = existing?.status === "submitted" || historical
  const attendance = useReportAttendance(projectId, date, !readOnly)
  const evidence = useEvidencePhotos(projectId, "daily", existing?.id ?? null)
  const openedLink = useRef("")
  const openLinkedReport = useCallback(() => {
    const id = new URLSearchParams(window.location.search).get("report")
    const linked = mine.find(report => report.id === id)
    const key = `${projectId}:${id}`
    if (linked && openedLink.current !== key) { openedLink.current = key; setDate(linked.report_date) }
  }, [mine, projectId])
  useEffect(() => { openLinkedReport(); window.addEventListener("popstate", openLinkedReport); return () => window.removeEventListener("popstate", openLinkedReport) }, [openLinkedReport])

  // Load the report for the chosen day into the form (or a blank one). History arrives in the same query;
  // changes to other reports must not reset this form while its own saved record/date is unchanged.
  useEffect(() => {
    const scope = `${projectId}:${date}`
    if (formScope.current !== scope) { dirty.current = false; formScope.current = scope }
    if (dirty.current && existing?.status !== "submitted") return
    setForm(existing ? fromReport(existing, !readOnly, progressHistory) : emptyForm)
    setErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, date, existing?.id, existing?.updated_at])

  // "Add this pin to today's daily report" from a pin panel: ?linkpin=<pin>[&linkitem=<item>] adds that work to today's draft once
  // today's report is known (an existing draft is never replaced). The Foreman still saves or submits it.
  const linkRequest = useRef<ReportWork | null>((() => {
    const params = new URLSearchParams(window.location.search)
    const pin = params.get("linkpin")
    return pin ? { pin_id: pin, item_id: params.get("linkitem") || null } : null
  })())
  useEffect(() => {
    const wanted = linkRequest.current
    if (!wanted || loading || date !== today || !pins.length) return
    linkRequest.current = null
    const url = new URL(window.location.href)
    url.searchParams.delete("linkpin"); url.searchParams.delete("linkitem")
    window.history.replaceState({}, "", url)
    const pin = pins.find((row) => row.id === wanted.pin_id && row.project_id === projectId && row.category !== "note")
    if (!pin) { toast.error("Work pin not found", "Choose the linked work in the report."); return }
    if (pin.assigned_to !== profile?.id) { toast.error("This work is not assigned to you", `${pin.title} was not added.`); return }
    if (readOnly) { toast.info("Today's report is already submitted", `${pin.title} was not added. The Engineer can return the report for changes.`); return }
    dirty.current = true
    setForm((current) => current.entries.some((row) => sameWork(row, wanted)) ? current : { ...current, entries: [...current.entries, ...carryForwardProgress([blankEntry(newEntryId(), wanted)], progressHistory)] })
    toast.success("Work pin added to today's report", workItems.some((item) => item.pin_id === pin.id) && !wanted.item_id ? `Choose the task worked on for ${pin.title}, then save.` : "Save or submit the report to keep it.")
  }, [loading, date, today, pins, projectId, readOnly, workItems, toast, profile?.id, progressHistory])

  // Work completed is written under each task. The report's own box remains only for an older summary, or for a Foreman with no assigned work to add.
  const hasAssignedWork = pins.some(pin => pin.category !== "note" && pin.assigned_to === profile?.id)
  const showSummary = Boolean(form.work_done) || (!form.entries.length && !pinsLoading && !hasAssignedWork)

  const validate = (submitting: boolean) => {
    const found: Errors = {}
    if (submitting && !form.entries.length && form.work_done.trim().length < 5) found.work_done = showSummary ? "Describe the work done today (at least 5 characters)." : "Press Add Task Progress and describe the work done today."
    if (form.work_done.length > 4000) found.work_done = "Keep it under 4000 characters."
    const problems = form.entries.map(entry => [entry.id, entryProblem(entry, form.entries, workItems, submitting)]).filter(([, problem]) => problem)
    if (problems.length) found.entries = Object.fromEntries(problems)
    setErrors(found)
    if (found.work_done || found.entries) toast.error(submitting ? "Report not submitted" : "Draft not saved", "Check the marked fields first.")
    return !found.work_done && !found.entries
  }

  const save = async (status: "draft" | "submitted", event?: FormEvent) => {
    event?.preventDefault()
    if (readOnly || photoBusy || busy || !projectId || !validate(status === "submitted")) return
    if (status === "submitted" && (attendance.loading || attendance.error || attendance.count === null)) return toast.error("Biometric headcount unavailable", "Refresh attendance before submitting this report.")
    if (status === "submitted" && !(await confirm({ title: "Submit this report?", message: "After you submit, the report cannot be edited. The engineers are notified. The client can read the work completed and the photos in the site logs; the rest of each task entry stays with the project team.", confirmLabel: "Submit report" }))) return
    setBusy(true)
    const payload: ReportSave = { projectId, date, values: { weather: form.weather, work_done: form.work_done.trim(), status }, entries: form.entries }
    // No signal: keep the report on this device and send it when the connection is back.
    const saveOffline = async () => {
      if (!profile) return
      await enqueue({ userId: profile.id, kind: "daily_report", label: reportDateLong(date), payload })
      setBusy(false)
      toast.info("Saved on this device", "It will be sent when you are back online.")
    }
    if (!navigator.onLine) return saveOffline()
    const { error: writeError } = await supabase.rpc("save_daily_report", saveReportArgs(payload))
    if (writeError && isNetworkProblem(writeError)) return saveOffline()
    setBusy(false)
    if (writeError) return toast.error(status === "submitted" ? "Report not submitted" : "Draft not saved", reportError(writeError))
    dirty.current = false
    toast.success(status === "submitted" ? "Report submitted" : "Draft saved", reportDateLong(date))
    await reload()
  }

  // The report and the task entry a photo will point at must be saved before the photo. A new entry saves the draft as it stands.
  const ensureDraft = async (entryId: string): Promise<string | null> => {
    if (existing?.daily_report_entries?.some(entry => entry.id === entryId)) return existing.id
    if (!form.entries.find(entry => entry.id === entryId)?.pin_id) { toast.error("Choose the task first", "Your photo is kept here. Choose the task, then save it."); return null }
    if (!projectId || !validate(false)) return null
    const { data, error } = await supabase.rpc("save_daily_report", saveReportArgs({ projectId, date, values: { weather: form.weather, work_done: form.work_done.trim(), status: "draft" }, entries: form.entries }))
    if (error) { toast.error("Draft not saved", reportError(error)); return null }
    dirty.current = false
    await reload()
    return data as string
  }

  const remove = async () => {
    if (!existing || !(await confirm({ title: "Delete this draft?", message: "This cannot be undone.", confirmLabel: "Delete draft", tone: "danger" }))) return
    setBusy(true)
    const files = await supabase.from("daily_report_photos").select("path").eq("report_id", existing.id)
    if (files.error) { setBusy(false); return toast.error("Could not delete", files.error.message) }
    const { data, error: deleteError } = await supabase.from("daily_reports").delete().eq("id", existing.id).select("id")
    if (deleteError || !data?.length) { setBusy(false); return toast.error("Could not delete", deleteError ? reportError(deleteError) : "This report is no longer an editable draft.") }
    if (files.data.length) {
      const cleanup = await supabase.storage.from("daily-photos").remove(files.data.map((file) => file.path))
      if (cleanup.error) toast.error("Unused files remain", "The draft was deleted, but its unused photo files could not be cleaned up.")
    }
    dirty.current = false
    setBusy(false)
    toast.success("Draft deleted")
    await reload()
  }

  const taskIds = form.entries.map(entry => entry.id)
  const print = () => {
    if (!existing || !project) return
    if (!printHtml(dailyReportHtml(existing, project, profile?.full_name || profile?.email || "Foreman", describeWork))) toast.error("Could not open the print dialog")
  }

  const set = (key: "weather" | "work_done") => (event: { target: { value: string } }) => { dirty.current = true; setForm((current) => ({ ...current, [key]: event.target.value })) }

  return (
    <div className="foreman-page">
      <ProjectContextBar listPath="/foreman/projects" listLabel="My projects" />
      <PageHead eyebrow="Foreman · Daily site record" title="Daily progress report" description="Record the work completed for the selected date, add each task's progress with its own photos and annotations. Save a draft during the day and submit at the end of the day. Worker headcount comes from this project’s biometric Time in records." />

      {!projectId ? null : (
        <div className="grid gap-5 lg:grid-cols-[17rem_1fr]">
          <aside aria-label="Your reports">
            <h2 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Your reports</h2>
            {loading ? (
              <SkeletonList rows={4} label="Loading reports" />
            ) : (
              <ul className="max-h-[38rem] space-y-1.5 overflow-y-auto">
                {reportDays.map((day) => {
                  const report = mine.find((item) => item.report_date === day)
                  return (
                    <li key={day}>
                      <button type="button" disabled={busy || photoBusy} onClick={() => setDate(day)} aria-current={day === date} className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${day === date ? "border-brand bg-brand-soft" : "border-line bg-surface hover:bg-surface-muted"}`}>
                        <span className="font-semibold">{day === today ? "Today" : reportDateLong(day)}</span>
                        {report ? (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase ${report.status === "submitted" ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"}`}>{report.review_state === "reviewed" ? "Reviewed" : report.review_state === "returned" ? "Returned" : report.status === "submitted" ? "Submitted" : "Draft"}</span>
                        ) : (
                          <span className="text-[11px] text-fg-muted">Empty</span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-3 text-xs text-fg-muted">You can write a report for today and the 13 days before. Older saved reports remain available here as read-only history.</p>
          </aside>

          <section className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-sm">
            {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p> : null}
            <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-extrabold">{reportDateLong(date)}</h2>
                <p className="text-xs text-fg-muted">{historical ? "Historical report · outside the 14-day editing window. Read only." : readOnly ? existing?.review_state === "reviewed" ? "Reviewed by the Engineer. Report locked." : "Submitted · awaiting Engineer review. Report locked." : existing?.review_state === "returned" ? "Returned by the Engineer. Correct the report and submit a new revision." : existing ? "Draft: only you can see it." : "New report"}</p>
              </div>
              {existing ? <button type="button" className={buttonSecondary} onClick={print}>Print / Save as PDF</button> : null}
            </header>
            {existing?.review_note ? <p role="status" className="mb-3 whitespace-pre-wrap rounded-lg bg-brand-soft p-3 text-sm"><strong>Engineer feedback: </strong>{existing.review_note}</p> : null}
            <form className="space-y-4" noValidate onSubmit={(event) => void save("draft", event)}>
              <fieldset disabled={busy || photoBusy || loading} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">Weather
                  <select className={`${inputClass} mt-1`} value={form.weather} onChange={set("weather")} disabled={readOnly}>
                    {(Object.keys(weatherLabels) as Weather[]).map((key) => <option key={key} value={key}>{weatherLabels[key]}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-semibold">Workers present · biometrics
                  <input aria-label="Biometric worker headcount" className={`${inputClass} mt-1 bg-surface-muted`} readOnly value={readOnly ? existing?.workers_count ?? "" : attendance.loading ? "Loading attendance..." : attendance.count ?? "Unavailable"} />
                  <span className="mt-1 block text-xs font-normal text-fg-muted">{readOnly ? existing?.workers_source === "biometrics" ? "Saved biometric headcount for this report. Later scans do not rewrite submitted reports." : "Historical headcount saved with this report; it has not been replaced with current attendance." : "Unique workers with a biometric Time in on this project and report date (Manila). Workers who already timed out still count once. Refreshed automatically and checked again when saved."}</span>
                </label>
              </div>
              {!readOnly && attendance.error ? <p role="alert" className="text-sm text-danger-fg">{attendance.error} <button type="button" className="font-bold underline" onClick={() => void attendance.reload()}>Retry attendance</button></p> : null}
              {showSummary ? <label className="block text-sm font-semibold">Work completed on this report date *
                <textarea className={`${inputClass} mt-1`} rows={5} value={form.work_done} onChange={set("work_done")} disabled={readOnly} />
                <span className="mt-1 block text-xs font-normal text-fg-muted">The client reads this in the site logs.</span>
              </label> : null}
              {errors.work_done ? <p role="alert" className="text-xs text-danger-fg">{errors.work_done}</p> : null}
              </fieldset>
              <TaskProgressEditor value={form.entries} pins={pins} items={workItems} userId={profile?.id} sheetTitle={id => blueprints.find(sheet => sheet.id === id)?.title} readOnly={readOnly} disabled={busy || loading} capturing={photoBusy} progressHistory={progressHistory} problems={errors.entries ?? {}} newId={newEntryId}
                photos={entry => <DailyReportPhotos key={`${date}:${entry.id}`} projectId={projectId} evidence={evidence} entryId={entry.id} editable={!readOnly && !busy && !loading} ensureDraft={() => ensureDraft(entry.id)} onBusy={active => trackPhotos(entry.id, active)} />}
                onChange={entries => { dirty.current = true; setForm(current => { const moved = moveSummaryToTask(entries, current.work_done); return { ...current, entries: moved, work_done: moved === entries ? current.work_done : "" } }) }} />
              {photosOutsideTasks(evidence.photos, taskIds).length ? <DailyReportPhotos key={`${projectId}:${date}`} projectId={projectId} evidence={evidence} taskIds={taskIds} editable={!readOnly && !busy && !loading} onBusy={active => trackPhotos("report", active)} /> : null}
              {existing ? <ReportHistory reportId={existing.id} describe={describeWork} /> : null}
              {!readOnly ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
                  <div>{existing && !existing.revision ? <button type="button" className={buttonDanger + " !bg-transparent !text-danger-fg hover:!bg-danger-soft"} onClick={() => void remove()} disabled={busy || photoBusy || loading}>Delete draft</button> : null}</div>
                  <div className="flex gap-2">
                    <button type="submit" className={buttonSecondary} disabled={busy || photoBusy || loading}>{busy ? "Saving..." : "Save draft"}</button>
                    <button type="button" className={buttonPrimary} disabled={busy || photoBusy || loading || attendance.loading || Boolean(attendance.error) || attendance.count === null} onClick={() => void save("submitted")}>Submit daily progress report</button>
                  </div>
                </div>
              ) : null}
            </form>
          </section>
        </div>
      )}
      {projectId && !loading && mine.length === 0 ? <div className="mt-5"><EmptyState title="No reports yet">Pick a day on the left and write your first report.</EmptyState></div> : null}
    </div>
  )
}
