import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { Pin } from "../lib/blueprints"
import { ENTRY_TEXT_LIMIT, blankEntry, linkedWorkLabel, reportDateLong, reportProgressKey, sameWork, savedEntries, type DailyReport, type ReportEntry, type ReportProgressHistory, type ReportWork, type SavedReportEntry } from "../lib/reportFormat"
import { useEvidencePhotos, useProjectWorkItems, type WorkItemOption } from "../lib/dailyPhotos"
import { supabase } from "../lib/supabase"
import { useConfirm } from "../lib/confirm"
import { useToast } from "../lib/toast"
import { byColumn, byProject, useLiveReload, usePeriodicReload } from "../lib/realtime"
import { buttonPrimary, buttonSecondary, inputClass } from "./ui/PageParts"
import { PhotoGrid } from "./PhotoGallery"
import DailyReportPhotos from "./DailyReportPhotos"
import { photosOutsideTasks, type GalleryPhoto } from "../lib/photoGalleryModel"
import { followLink } from "../lib/notifications"
import { workItemPath } from "../lib/workItemModel"
import OpenOnBlueprint from "./OpenOnBlueprint"

const itemState = (item: WorkItemOption) => (item.review_status === "verified" ? " · Completed" : item.review_status === "for_review" ? " · For review" : item.done ? " · Preparing" : "")

const wholeNumber = (text: string) => (text === "" ? null : Number(text))
const fieldClass = `${inputClass} mt-1 min-h-10`
// Each task worked on that day, all under one report. Blueprint, pin and task narrow from left to right. The blueprint is only a filter: the entry links
// the pin, and a chosen pin shows its blueprint. Choosing a task still fills in its pin. The rows follow the card's own width, which depends on what sits
// beside the form, not the screen's. The choices are the Foreman's assigned work (the
// database checks this again) plus what the report already links. A record of the day only: QA, completion and official progress stay with the task.
export function TaskProgressEditor({ value, pins, items, userId, sheetTitle, readOnly, disabled, capturing = false, progressHistory = new Map(), problems, photos, newId, onChange }: {
  value: ReportEntry[]; pins: Pin[]; items: WorkItemOption[]; userId: string | undefined; sheetTitle: (id: string) => string | undefined; readOnly: boolean; disabled: boolean
  capturing?: boolean // a photo is waiting to be saved: entries stay editable (its task may still need choosing) but cannot be removed
  progressHistory?: ReportProgressHistory
  problems: Record<string, string>; photos: (entry: ReportEntry) => ReactNode; newId: () => string; onChange: (value: ReportEntry[]) => void
}) {
  const confirm = useConfirm()
  const [sheetFilter, setSheetFilter] = useState<Record<string, string>>({})
  const change = (index: number, patch: Partial<ReportEntry>) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row))
  const mine = pins.filter(pin => pin.category !== "note" && pin.assigned_to === userId)
  const pinLabel = (pin: Pin) => [pin.title, sheetTitle(pin.blueprint_id), pin.status === "verified" ? "Completed" : ""].filter(Boolean).join(" · ")
  const remove = async (entry: ReportEntry) => {
    if (entry.pin_id && !(await confirm({ title: "Remove this task entry?", message: "Its progress details are removed when you save. Photos already saved stay on this report.", confirmLabel: "Remove entry", tone: "danger" }))) return
    onChange(value.filter(row => row.id !== entry.id))
  }
  return <section className="space-y-4 rounded-xl border border-line p-4" aria-label="Task progress">
    <div>
      <h3 className="text-sm font-bold">Task progress</h3>
      <p className="text-xs text-fg-muted">Add an entry for each task you worked on, with its photos. Its last submitted percentage carries forward: type the new total completed, including earlier work. Official progress still comes from tasks the Engineer has approved. The client reads the work completed and the photos in the site logs; the rest of each entry stays with the project team.</p>
    </div>
    {value.map((row, index) => {
      const pin = pins.find(option => option.id === row.pin_id)
      const choices = pin && !mine.includes(pin) ? [...mine, pin] : mine
      const sheet = pin?.blueprint_id || sheetFilter[row.id] || ""
      const sheetIds = [...new Set(choices.map(option => option.blueprint_id))]
      const onSheet = choices.filter(option => !sheet || option.blueprint_id === sheet)
      const previous = progressHistory.get(reportProgressKey(row))
      const pickWork = (work: ReportWork) => change(index, { ...work, percent: sameWork(row, work) ? row.percent : progressHistory.get(reportProgressKey(work))?.percent ?? null })
      const pickSheet = (id: string) => { setSheetFilter(current => ({ ...current, [row.id]: id })); if (pin && pin.blueprint_id !== id) pickWork({ pin_id: "", item_id: null }) }
      const groups = onSheet.filter(option => !row.pin_id || option.id === row.pin_id)
        .map(option => ({ pin: option, tasks: items.filter(item => item.pin_id === option.id).sort((a, b) => a.position - b.position) })).filter(group => group.tasks.length)
      const pickTask = (id: string) => { const item = items.find(option => option.id === id); pickWork(item ? { item_id: item.id, pin_id: item.pin_id } : { pin_id: row.pin_id, item_id: null }) }
      const taken = (work: ReportWork) => value.some(other => other.id !== row.id && sameWork(other, work))
      return <article key={row.id} aria-label={`Task ${index + 1}`} className="@container space-y-4 rounded-lg border border-line bg-surface-muted/40 p-4">
        <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
          <h4 className="text-sm font-bold">Task {index + 1}</h4>
          {!readOnly ? <button type="button" className="min-h-6 text-xs font-bold text-danger-fg underline" disabled={disabled || capturing} onClick={() => void remove(row)}>Remove</button> : null}
        </div>
        <div className="grid gap-3 @xl:grid-cols-3">
          <label className="block text-sm font-semibold">Blueprint<select disabled={readOnly || disabled || !sheetIds.length} className={fieldClass} value={sheet} onChange={e => pickSheet(e.target.value)}>
            <option value="">All blueprints</option>
            {sheetIds.map(id => <option key={id} value={id}>{sheetTitle(id) ?? "Other plan"}</option>)}
          </select></label>
          <label className="block text-sm font-semibold">Linked pin *<select disabled={readOnly || disabled} className={fieldClass} value={row.pin_id} onChange={e => pickWork({ pin_id: e.target.value, item_id: null })}>
            <option value="">Choose the pin</option>
            {onSheet.map(option => <option key={option.id} value={option.id}>{pinLabel(option)}</option>)}
            {row.pin_id && !pin ? <option value={row.pin_id}>Pin unavailable</option> : null}
          </select></label>
          <label className="block text-sm font-semibold">Task *<select disabled={readOnly || disabled || !groups.length} className={fieldClass} value={row.item_id ?? ""} onChange={e => pickTask(e.target.value)}>
            <option value="">{row.pin_id && !groups.length ? "No tasks on this pin" : groups.length ? "Choose the task" : sheet ? "No tasks on this blueprint" : "No assigned tasks"}</option>
            {groups.map(group => <optgroup key={group.pin.id} label={group.pin.title}>{group.tasks.map(item => <option key={item.id} value={item.id} disabled={taken({ pin_id: item.pin_id, item_id: item.id })}>{item.text}{itemState(item)}</option>)}</optgroup>)}
            {row.item_id && !items.some(item => item.id === row.item_id) ? <option value={row.item_id}>Task unavailable</option> : null}
          </select></label>
        </div>
        <label className="block text-sm font-semibold">Work completed on this report date *<textarea rows={3} maxLength={ENTRY_TEXT_LIMIT} disabled={readOnly || disabled} className={fieldClass} placeholder="e.g. Poured slab B (north) and completed the formwork for column C4." value={row.work_done} onChange={e => change(index, { work_done: e.target.value })} /></label>
        <div className="grid gap-3 @md:grid-cols-2">
          <label className="block text-sm font-semibold">Percentage completed *<input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3} placeholder="0 to 100" aria-describedby={readOnly ? undefined : `progress-help-${row.id}`} disabled={readOnly || disabled} className={fieldClass} value={row.percent ?? ""} onChange={e => { if (/^\d{0,3}$/.test(e.target.value)) change(index, { percent: wholeNumber(e.target.value) }) }} />
            {!readOnly ? <span id={`progress-help-${row.id}`} className="mt-1 block text-xs font-normal text-fg-muted">{previous ? `Last reported: ${previous.percent}% on ${reportDateLong(previous.date)}. Update this to the new total completed (0–100%).` : "Type the total completed so far (0–100%)."}</span> : null}
          </label>
          <label className="block text-sm font-semibold">Manpower<input type="number" min={0} max={5000} step={1} inputMode="numeric" placeholder="Workers on this task" disabled={readOnly || disabled} className={fieldClass} value={row.manpower ?? ""} onChange={e => change(index, { manpower: wholeNumber(e.target.value) })} /></label>
        </div>
        <div className="grid gap-3 @md:grid-cols-2">
          <label className="block text-sm font-semibold">Daily notes<textarea rows={2} maxLength={ENTRY_TEXT_LIMIT} disabled={readOnly || disabled} className={fieldClass} value={row.notes} onChange={e => change(index, { notes: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Issues<textarea rows={2} maxLength={ENTRY_TEXT_LIMIT} disabled={readOnly || disabled} className={fieldClass} value={row.issues} onChange={e => change(index, { issues: e.target.value })} /></label>
        </div>
        {problems[row.id] ? <p role="alert" className="text-xs text-danger-fg">{problems[row.id]}</p> : null}
        <div className="border-t border-line pt-3">{photos(row)}</div>
      </article>
    })}
    {readOnly && !value.length ? <p className="text-xs text-fg-muted">No task progress on this report.</p> : null}
    {!readOnly ? <button type="button" className={buttonSecondary} disabled={disabled || !mine.length || value.length >= 100} onClick={() => onChange([...value, blankEntry(newId())])}>Add Task Progress</button> : null}
    {!readOnly && !mine.length ? <p className="text-xs text-fg-muted">No work is assigned to you on this project yet. Ask your Project Manager to assign it, then add its progress here.</p> : null}
  </section>
}

function EntryFacts({ entry }: { entry: ReportEntry }) {
  const facts = [["Work completed", entry.work_done], ["Percentage completed", entry.percent === null ? "Not entered" : `${entry.percent}%`], ["Manpower", entry.manpower === null ? "" : `${entry.manpower} workers`], ["Daily notes", entry.notes], ["Issues", entry.issues]]
  return <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">{facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="font-bold">{label}</dt><dd className="whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
}

// The Foreman's task entries with their photos, then the report's other photos, for the project team reading a report.
export function ReportEntriesView({ report, describe }: { report: DailyReport; describe: (work: ReportWork) => string }) {
  const evidence = useEvidencePhotos(report.project_id, "daily", report.id)
  const entries = savedEntries(report)
  const taskIds = entries.map(entry => entry.id)
  return <>
    {entries.length ? <section aria-label="Task progress" className="space-y-2">
      <h3 className="text-sm font-extrabold">Task progress</h3>
      <p className="text-xs text-fg-muted">The Foreman's report of the day. Official progress comes from approved tasks.</p>
      {entries.map(entry => <article key={entry.id} aria-label={describe(entry)} className="space-y-2 rounded-xl border border-line p-3">
        <h4 className="text-sm font-bold">{describe(entry)}</h4>
        <EntryFacts entry={entry} />
        <DailyReportPhotos projectId={report.project_id} evidence={evidence} entryId={entry.id} />
      </article>)}
    </section> : null}
    {!entries.length || photosOutsideTasks(evidence.photos, taskIds).length ? <DailyReportPhotos projectId={report.project_id} evidence={evidence} taskIds={taskIds} /> : null}
  </>
}

type Revision = { id: string; revision: number; event: string; actor_id: string | null; snapshot: DailyReport & { task_entries?: SavedReportEntry[] }; photos_snapshot: GalleryPhoto[]; created_at: string }
export function ReportHistory({ reportId, nameOf, describe }: { reportId: string; nameOf?: (id: string | null) => string; describe?: (work: ReportWork) => string }) {
  const [rows, setRows] = useState<Revision[]>([])
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    const result = await supabase.from("daily_report_revisions").select("*").eq("report_id", reportId).order("created_at", { ascending: false }).order("id")
    setError(result.error?.message ?? "")
    setRows(result.data ?? [])
  }, [reportId])
  useEffect(() => { void reload() }, [reload])
  useLiveReload(byColumn("daily_report_revisions", "report_id", reportId), () => void reload())
  return <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-sm font-bold">Revision and review history ({rows.length})</summary>
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    {rows.map(row => <details key={row.id} className="mt-2 border-t border-line pt-2"><summary className="cursor-pointer text-xs font-bold">Revision {row.revision} · {row.event} · {new Date(row.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}{nameOf ? ` · ${nameOf(row.actor_id)}` : ""}</summary>
      <dl className="mt-2 space-y-1 text-xs">{[["Work done", row.snapshot.work_done], ["Workers", row.snapshot.workers_count], ["Issues", row.snapshot.issues], ["Delays", row.snapshot.delays], ["Safety", row.snapshot.safety], ["Review feedback", row.snapshot.review_note]].filter(([key, value]) => value || !["Issues", "Delays", "Safety"].includes(String(key))).map(([key, value]) => <div key={String(key)}><dt className="font-bold">{key}</dt><dd className="whitespace-pre-wrap">{value || "—"}</dd></div>)}</dl>
      {row.snapshot.task_entries?.length ? row.snapshot.task_entries.map(entry => <div key={entry.id} className="mt-2"><p className="text-xs font-bold">{describe ? describe(entry) : "Task entry"}</p><EntryFacts entry={entry} /></div>)
        : (row.snapshot.linked_work ?? []).map((work, i) => <p key={i} className="mt-1 text-xs">Linked work: {describe ? describe(work) : work.item_id ? "task" : "work pin"}</p>)}
      {row.photos_snapshot.length ? <div className="mt-2"><PhotoGrid bucket="daily-photos" photos={row.photos_snapshot.map(p => ({ ...p, label: `Revision ${row.revision} evidence` }))} emptyHint="No evidence" /></div> : null}
    </details>)}
    {!rows.length && !error ? <p className="mt-2 text-xs text-fg-muted">History starts with the next submission or review.</p> : null}
  </details>
}

export function ReportReviewPanel({ report, pins, nameOf, onChanged }: { report: DailyReport; pins: Pin[]; nameOf: (id: string | null) => string; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const items = useProjectWorkItems(report.project_id, Boolean(report.linked_work?.length))
  const describe = (work: ReportWork) => linkedWorkLabel(work, (id) => pins.find((pin) => pin.id === id)?.title, (id) => items.find((item) => item.id === id)?.text)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [attendance, setAttendance] = useState<{ workers_count: number; source: string; imported_at: string } | null>(null)
  const [attendanceError, setAttendanceError] = useState("")
  const [scans, setScans] = useState<{ workers: number; scans: number } | null>(null)
  const attendanceRun = useRef(0)
  const reload = useCallback(async () => {
    const run = ++attendanceRun.current
    try {
      const [imported, recorded] = await Promise.all([
        supabase.from("biometric_daily_totals").select("workers_count,source,imported_at").eq("project_id", report.project_id).eq("work_date", report.report_date).maybeSingle(),
        supabase.rpc("attendance_day_summary", { p_project: report.project_id, p_day: report.report_date }),
      ])
      if (run !== attendanceRun.current) return
      setAttendance(imported.error ? null : imported.data)
      setScans(recorded.error ? null : recorded.data as { workers: number; scans: number })
      setAttendanceError(imported.error || recorded.error ? "Attendance reconciliation could not be fully loaded. Retrying automatically." : "")
    } catch {
      if (run === attendanceRun.current) { setAttendance(null); setScans(null); setAttendanceError("Attendance reconciliation is unavailable. Retrying automatically.") }
    }
  }, [report.project_id, report.report_date])
  useEffect(() => { setAttendance(null); setScans(null); setAttendanceError(""); void reload(); return () => { attendanceRun.current++ } }, [reload])
  useLiveReload([...byProject("biometric_daily_totals", report.project_id), ...byProject("biometric_attendance_events", report.project_id)], () => void reload())
  usePeriodicReload(`report-attendance:${report.project_id}:${report.report_date}`, () => void reload())
  const review = async (accept: boolean) => {
    if (pending.current) return
    pending.current = true; setBusy(true)
    try {
      const { error } = await supabase.rpc("review_daily_report", { p_id: report.id, p_accept: accept, p_note: note.trim() })
      if (error) throw error
      toast.success(accept ? "Daily report reviewed" : "Daily report returned for correction")
      setNote(""); await onChanged()
    } catch (e) { toast.error("Review not saved", (e as { message: string }).message) }
    finally { pending.current = false; setBusy(false) }
  }
  return <section className="space-y-3 rounded-xl border border-line p-3">
    <h3 className="text-sm font-bold">Engineer review · {report.review_state === "reviewed" ? "Reviewed" : report.review_state === "returned" ? "Returned · awaiting Foreman corrections" : "Awaiting review"} · revision {report.revision ?? 0}</h3>
    {report.review_note ? <p className="whitespace-pre-wrap text-sm">{report.review_note}<span className="mt-1 block text-xs text-fg-muted">{nameOf(report.reviewed_by ?? null)} · {report.reviewed_at ? new Date(report.reviewed_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : ""}</span></p> : null}
    <div className="space-y-1 rounded-lg bg-surface-muted p-2 text-xs"><strong>Headcount reconciliation · {report.report_date} (Philippine time)</strong>
      <p>{report.workers_source === "biometrics" ? "Saved biometric headcount" : "Historical Foreman headcount"}: {report.workers_count} workers.{report.workers_source === "biometrics" ? " Unique workers with Time in on the report date, checked when the report was saved." : ""}</p>
      {attendanceError ? <p role="alert">{attendanceError}</p> : null}
      {scans ? scans.scans > 0 ? <p>Recorded biometric attendance: {scans.workers} unique workers · {scans.scans} scans · Difference from reported headcount: {report.workers_count - scans.workers}. Check whether the Foreman's crew and project-wide attendance cover the same workers.</p> : <p>No biometric scans recorded for this date. This does not prove workers were absent.</p> : !attendanceError ? <p>Loading recorded biometric attendance…</p> : null}
      {attendance ? <p>Separately imported total: {attendance.workers_count} workers · Source: {attendance.source}. This is not added to the recorded scan count.</p> : <p>No separate attendance total imported.</p>}
    </div>
    {(report.linked_work ?? []).map((work, i) => {
      const pin = pins.find(p => p.id === work.pin_id)
      const item = work.item_id ? items.find(row => row.id === work.item_id) : undefined
      const state = item ? (item.review_status === "verified" ? "Completed by the Engineer" : item.review_status === "for_review" ? "Submitted for QA Review" : item.done ? "Ready (not yet submitted)" : "In progress")
        : work.item_id ? "Linked task is unavailable" : pin?.status === "verified" ? "Work completed" : "Not completed"
      const reported = report.daily_report_entries?.find(entry => sameWork(entry, work))?.percent ?? null
      return <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted p-2 text-xs"><p><strong>{describe(work)}</strong> · {state}{reported === null ? "" : ` · Foreman reported ${reported}%`}</p>
        {pin && item && item.pin_id === pin.id ? <button type="button" className="font-bold text-brand-text underline" onClick={() => followLink(workItemPath("engineer", report.project_id, item.id), report.project_id)}>Open task, QA and NCRs</button>
          : pin ? <OpenOnBlueprint projectId={report.project_id} pinId={pin.id} sheetId={pin.blueprint_id} section="reports" label="Open work pin on blueprint" className="font-bold text-brand-text underline" /> : <span>Linked work is unavailable.</span>}
      </div>
    })}
    {report.status === "submitted" ? <><label className="block text-xs font-bold">Review feedback<textarea className={inputClass} rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="Record your review or identify what the Foreman must correct" /></label>
    <div className="flex flex-wrap gap-2"><button type="button" className={buttonPrimary} disabled={busy || note.trim().length < 5 || report.review_state === "reviewed"} onClick={() => void review(true)}>Mark reviewed</button><button type="button" className={buttonSecondary} disabled={busy || note.trim().length < 5} onClick={() => void review(false)}>Return for correction</button></div></> : <p className="text-xs text-fg-muted">The Foreman is correcting this draft. Review becomes available after resubmission.</p>}
    <ReportHistory reportId={report.id} nameOf={nameOf} describe={describe} />
  </section>
}

export function AttendanceImport({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState("")
  const upload = async (file?: File) => {
    if (!file || busy) return
    setBusy(true); setResult("")
    let imported = 0
    try {
      if (file.size > 1000000) throw new Error("Use a CSV smaller than 1 MB.")
      const lines = (await file.text()).trim().split(/\r?\n/)
      if (lines.shift()?.trim().toLowerCase() !== "date,workers_count,source") throw new Error("Use CSV headers: date,workers_count,source")
      const rows = lines.map((line, i) => {
        const [date, count, ...source] = line.split(",").map(s => s.trim())
        const workers = Number(count)
        const origin = source.join(",").replace(/^"|"$/g, "")
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(workers) || workers < 0 || workers > 5000 || origin.length < 3 || origin.length > 200) throw new Error(`Invalid CSV row ${i + 2}.`)
        return { date, workers, origin }
      })
      if (!rows.length || rows.length > 366) throw new Error("Import between 1 and 366 daily totals.")
      for (const row of rows) {
        const { error } = await supabase.rpc("import_biometric_total", { p_project: projectId, p_date: row.date, p_count: row.workers, p_source: row.origin })
        if (error) throw error
        imported++
      }
      setResult(`${imported} daily biometric totals imported.`)
      toast.success("Attendance totals imported")
    } catch (e) { setResult(`${imported} totals imported. ${(e as { message: string }).message}`) }
    finally { setBusy(false) }
  }
  return <details className="my-4 rounded-xl border border-line bg-surface p-3"><summary className="cursor-pointer text-sm font-bold">Import biometric totals for reconciliation</summary>
    <p className="my-2 text-xs text-fg-muted">Export project-wide daily unique-worker counts from the biometric device. CSV format: date,workers_count,source. Example: 2026-10-18,24,Gate A device export. Reimporting a date updates its total and preserves an audit entry.</p>
    <input aria-label="Import biometric totals CSV" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = "" }} />
    {result ? <p role="status" className="mt-2 text-xs">{result}</p> : null}
  </details>
}
