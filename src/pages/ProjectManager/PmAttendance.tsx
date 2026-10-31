import { useEffect, useMemo, useState, type FormEvent } from "react"
import Modal from "../../components/Modal"
import AttendanceReportButton from "../../components/attendance/AttendanceReportButton"
import { ProjectAttendanceRecords, WorkerAttendanceDetails, WorkerDirectory } from "../../components/attendance/ForemanWorkerAttendance"
import { EmptyState, PageHead, buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { formatDate } from "../../lib/admin"
import { attendanceDay, type AttendanceWorker } from "../../lib/attendanceModel"
import { concernCategories, concernLabels, concernProblem, type ConcernCategory } from "../../lib/projectManagerModel"
import { flagAttendanceConcern, resolveAttendanceConcern, useAttendanceConcerns, type AttendanceConcern } from "../../lib/projectManagers"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

type Tab = "records" | "workers" | "concerns"

// Project attendance for the Project Manager: daily time records and workers (read-only), the attendance report, and concerns flagged
// to the Admins who manage workers, fingerprints and devices. Biometric enrollment and devices stay in the Admin Control center.
export default function PmAttendance(_: PmPageProps) {
  const pm = usePmProject()
  const projectId = pm.project?.id ?? null
  const toast = useToast()
  const today = attendanceDay()
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get("tab") === "concerns" ? "concerns" : "records"))
  const [chosenDay, setChosenDay] = useState("")
  const [recordPage, setRecordPage] = useState(0)
  const [search, setSearch] = useState("")
  const [workerPage, setWorkerPage] = useState(0)
  const [selected, setSelected] = useState<{ worker: AttendanceWorker; day: string } | null>(null)
  const [flagging, setFlagging] = useState<{ day: string; workerId: string | null } | null>(null)
  const [resolving, setResolving] = useState<AttendanceConcern | null>(null)
  const { concerns, loading, error, reload } = useAttendanceConcerns(projectId)
  const [workers, setWorkers] = useState<Array<{ id: string; full_name: string; worker_code: string }>>([])
  const day = chosenDay || today
  const open = concerns.filter((row) => row.status === "open").length
  const workerName = useMemo(() => new Map(workers.map((row) => [row.id, `${row.full_name} (${row.worker_code})`])), [workers])

  useEffect(() => {
    if (!projectId) return
    let active = true
    void supabase.from("attendance_workers").select("id, full_name, worker_code").eq("project_id", projectId).order("full_name").limit(1000).then(({ data }) => {
      if (active) setWorkers((data ?? []) as Array<{ id: string; full_name: string; worker_code: string }>)
    })
    return () => { active = false }
  }, [projectId])

  if (!pm.project || !projectId) return <div className="admin-page"><SkeletonList rows={4} label="Loading attendance" /></div>

  return (
    <div className="admin-page">
      <PageHead eyebrow={`${pm.project.code} • Attendance`} title="Project attendance"
        description="Daily time records from the site scanners and the registered workers of this project. Flag anything that needs an Admin's attention; worker registration, fingerprints and devices are managed by Admins."
        actions={<>
          {pm.canManage ? <button type="button" className={buttonSecondary} onClick={() => setFlagging({ day, workerId: null })}>Flag a concern</button> : null}
          {tab !== "records" ? <AttendanceReportButton projectId={projectId} anchorDay={day} /> : null}
        </>} />
      {pm.note ? <p role="status" className="mb-4 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg">{pm.note}</p> : null}
      <div role="tablist" aria-label="Attendance" className="mb-4 inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm">
        {([["records", "Attendance records"], ["workers", "Workers"], ["concerns", `Concerns${open ? ` (${open} open)` : ""}`]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}>{label}</button>
        ))}
      </div>

      {tab === "records" ? (
        <ProjectAttendanceRecords projectId={projectId} day={day} today={today} page={recordPage} onDay={(value) => { setChosenDay(value === today ? "" : value); setRecordPage(0) }} onPage={setRecordPage} onWorker={(worker) => setSelected({ worker, day })} />
      ) : tab === "workers" ? (
        <WorkerDirectory projectId={projectId} search={search} page={workerPage} onSearch={(value) => { setSearch(value); setWorkerPage(0) }} onPage={setWorkerPage} onWorker={(worker) => setSelected({ worker, day: today })} />
      ) : (
        <section aria-label="Attendance concerns">
          {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error} <button type="button" className="font-bold underline" onClick={() => void reload()}>Retry</button></p> : null}
          {loading ? <SkeletonList rows={3} label="Loading concerns" /> : concerns.length === 0 ? (
            <EmptyState title="No concerns flagged" action={pm.canManage ? <button type="button" className={buttonPrimary} onClick={() => setFlagging({ day, workerId: null })}>Flag a concern</button> : undefined}>Flag an unexplained absence, repeated late arrival, a head count that does not match the daily report, or a scanner problem. Admins who manage attendance are notified.</EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {concerns.map((row) => (
                <li key={row.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-fg">{concernLabels[row.category]} <span className="font-normal text-fg-muted">• {formatDate(`${row.work_date}T12:00:00+08:00`)}{row.worker_id ? ` • ${workerName.get(row.worker_id) ?? "Worker"}` : ""}</span></p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{row.note}</p>
                    {row.status === "resolved" ? <p className="mt-1 text-xs text-fg-muted">Resolved {row.resolved_at ? formatDate(row.resolved_at) : ""}{row.resolution_note ? `: ${row.resolution_note}` : ""}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${row.status === "open" ? "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100" : "bg-ok-soft text-ok-fg"}`}>{row.status === "open" ? "Open" : "Resolved"}</span>
                    {row.status === "open" && pm.canManage ? <button type="button" className="min-h-8 rounded-lg border border-line px-3 text-xs font-bold text-fg hover:border-brand/50 hover:text-brand-text" onClick={() => setResolving(row)}>Mark resolved</button> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selected ? <WorkerAttendanceDetails key={`${projectId}:${selected.worker.id}:${selected.day}`} projectId={projectId} worker={selected.worker} initialDay={selected.day} onClose={() => setSelected(null)} /> : null}
      {flagging ? <FlagConcernDialog projectId={projectId} today={today} initial={flagging} workers={workers} onClose={() => setFlagging(null)} onDone={async () => { setFlagging(null); setTab("concerns"); await reload(); toast.success("Concern flagged", "Admins who manage attendance were notified.") }} /> : null}
      {resolving ? <ResolveDialog concern={resolving} onClose={() => setResolving(null)} onDone={async () => { setResolving(null); await reload(); toast.success("Concern resolved") }} /> : null}
    </div>
  )
}

function FlagConcernDialog({ projectId, today, initial, workers, onClose, onDone }: { projectId: string; today: string; initial: { day: string; workerId: string | null }; workers: Array<{ id: string; full_name: string; worker_code: string }>; onClose: () => void; onDone: () => Promise<void> }) {
  const [day, setDay] = useState(initial.day)
  const [workerId, setWorkerId] = useState(initial.workerId ?? "")
  const [category, setCategory] = useState<ConcernCategory>("absence")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = concernProblem({ day, today, note, category })
    if (problem) return setFailure(problem)
    setBusy(true)
    setFailure("")
    try {
      await flagAttendanceConcern({ projectId, day, workerId: workerId || null, category, note })
      await onDone()
    } catch (error) {
      setFailure((error as Error).message)
    }
    setBusy(false)
  }
  return (
    <Modal title="Flag an attendance concern" size="md" onClose={onClose}>
      <form className="space-y-3" noValidate onSubmit={(event) => void submit(event)}>
        {failure ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{failure}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Day<input type="date" max={today} value={day} onChange={(event) => setDay(event.target.value)} className={`mt-1 min-h-10 ${inputClass}`} /></label>
          <label className="block text-sm font-semibold">Kind of concern
            <select value={category} onChange={(event) => setCategory(event.target.value as ConcernCategory)} className={`mt-1 min-h-10 ${inputClass}`}>
              {concernCategories.map((key) => <option key={key} value={key}>{concernLabels[key]}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm font-semibold">Worker (optional)
          <select value={workerId} onChange={(event) => setWorkerId(event.target.value)} className={`mt-1 min-h-10 ${inputClass}`}>
            <option value="">Whole project / not about one worker</option>
            {workers.map((row) => <option key={row.id} value={row.id}>{row.full_name} ({row.worker_code})</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">What needs attention
          <textarea rows={4} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={`mt-1 ${inputClass}`} placeholder="e.g. Scanned in at 07:02 but the daily report lists 12 workers and the scanner shows 9." />
        </label>
        <p className="text-xs text-fg-muted">Admins who manage attendance and the other Project Manager of this project are notified. Describe facts only.</p>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={buttonPrimary} disabled={busy}>{busy ? "Sending..." : "Flag concern"}</button>
        </div>
      </form>
    </Modal>
  )
}

function ResolveDialog({ concern, onClose, onDone }: { concern: AttendanceConcern; onClose: () => void; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState("")
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFailure("")
    try {
      await resolveAttendanceConcern(concern.id, note)
      await onDone()
    } catch (error) {
      setFailure((error as Error).message)
    }
    setBusy(false)
  }
  return (
    <Modal title="Mark the concern resolved" size="md" onClose={onClose}>
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        {failure ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{failure}</p> : null}
        <p className="text-sm text-fg">{concernLabels[concern.category]}: {concern.note}</p>
        <label className="block text-sm font-semibold">How it was resolved (optional)
          <textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} className={`mt-1 ${inputClass}`} />
        </label>
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="submit" className={buttonPrimary} disabled={busy}>{busy ? "Saving..." : "Mark resolved"}</button>
        </div>
      </form>
    </Modal>
  )
}
