import { useCallback, useEffect, useRef, useState } from "react"
import type { Pin } from "../lib/blueprints"
import { linkedWorkLabel, type DailyReport, type ReportWork } from "../lib/reportFormat"
import { useProjectWorkItems, type WorkItemOption } from "../lib/dailyPhotos"
import { supabase } from "../lib/supabase"
import { useToast } from "../lib/toast"
import { byColumn, byProject, useLiveReload, usePeriodicReload } from "../lib/realtime"
import { buttonPrimary, buttonSecondary, inputClass } from "./ui/PageParts"
import { PhotoGrid } from "./PhotoGallery"
import type { GalleryPhoto } from "../lib/photoGalleryModel"
import { followLink } from "../lib/notifications"
import { workItemPath } from "../lib/workItemModel"
import OpenOnBlueprint from "./OpenOnBlueprint"

const itemState = (item: WorkItemOption) => (item.review_status === "verified" ? " · Completed" : item.review_status === "for_review" ? " · For review" : item.done ? " · Preparing" : "")

// Today's work linked to the plan: the work pin and the checklist item (work item) worked on. A record of the day only; QA and
// completion stay with the work item itself.
export function LinkedWorkEditor({ value, pins, items, disabled, onChange }: { value: ReportWork[]; pins: Pin[]; items: WorkItemOption[]; disabled: boolean; onChange: (value: ReportWork[]) => void }) {
  const change = (index: number, patch: Partial<ReportWork>) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row))
  const options = pins.filter(p => p.category !== "note")
  return <section className="space-y-2 rounded-xl border border-line p-3" aria-label="Linked work">
    <h3 className="text-sm font-bold">Linked work · tasks</h3>
    <p className="text-xs text-fg-muted">Link today's work to the work pin and the task you worked on. This records the day; QA and completion stay with the task.</p>
    {value.map((row, index) => {
      const pinItems = items.filter(item => item.pin_id === row.pin_id).sort((a, b) => a.position - b.position)
      return <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
      <label className="text-xs">Work pin<select disabled={disabled} className={inputClass} value={row.pin_id} onChange={e => change(index, { pin_id: e.target.value, item_id: null })}><option value="">Choose work</option>{options.map(p => <option key={p.id} value={p.id}>{p.title}{p.status === "verified" ? " · Completed" : ""}</option>)}</select></label>
      <label className="text-xs">Task<select disabled={disabled || !row.pin_id || !pinItems.length} className={inputClass} value={row.item_id ?? ""} onChange={e => change(index, { item_id: e.target.value || null })}>
        <option value="">{!row.pin_id ? "Choose a work pin first" : pinItems.length ? "Choose the task" : "No tasks on this pin"}</option>
        {pinItems.map(item => <option key={item.id} value={item.id}>{item.text}{itemState(item)}</option>)}
      </select></label>
      {!disabled ? <button type="button" className={buttonSecondary + " self-end"} onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove</button> : null}
    </div>
    })}
    {!disabled ? <button type="button" className={buttonSecondary} disabled={!options.length || value.length >= 100} onClick={() => onChange([...value, { pin_id: "", item_id: null }])}>Link work pin</button> : null}
  </section>
}

type Revision = { id: string; revision: number; event: string; actor_id: string | null; snapshot: DailyReport; photos_snapshot: GalleryPhoto[]; created_at: string }
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
      {(row.snapshot.linked_work ?? []).map((work, i) => <p key={i} className="mt-1 text-xs">Linked work: {describe ? describe(work) : work.item_id ? "task" : "work pin"}</p>)}
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
      return <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted p-2 text-xs"><p><strong>{describe(work)}</strong> · {state}</p>
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
