import { useEffect, useState, type ReactNode } from "react"
import Modal from "../Modal"
import WorkerPortrait from "./WorkerPortrait"
import AttendanceReportButton from "./AttendanceReportButton"
import { attendanceDate, attendanceDay, attendancePath, attendanceTime, workerInitials, type AttendanceEvent, type AttendanceWorker } from "../../lib/attendanceModel"
import { useAttendanceWorkers, useDailyAttendance, useDailyStatus, useWorkerAttendance } from "../../lib/foremanAttendance"
import { RECORD_PAGE_SIZE, WORKER_PAGE_SIZE, attendancePageLabel, validAttendanceDay } from "../../lib/foremanAttendanceModel"
import { scheduleFlagLabel, scheduleFlagTone } from "../../lib/attendanceScheduleModel"
import { dailyStatusCounts, dailyStatusLabel, dailyStatusTone, directionLabel, undertimeLabel, type DailyStatusRow } from "../../lib/attendanceStatusModel"

const statusChip = { ok: "bg-ok-soft text-ok-fg", warn: "bg-[light-dark(#fff1d6,#3a2a10)] text-[light-dark(#8a4b00,#f6c27a)]", bad: "bg-danger-soft text-danger-fg", muted: "bg-surface-muted text-fg-muted" }

// One row per worker for the day: Time in, Time out and the status the database computed from the schedule.
export function DailyAttendanceTable({ rows, onWorker }: { rows: DailyStatusRow[]; onWorker?: (row: DailyStatusRow) => void }) {
  return <div className="overflow-x-auto rounded-xl border border-border">
    <table className="w-full min-w-[640px] text-left text-sm" aria-label="Daily attendance">
      <thead className="bg-surface-muted text-xs text-fg-muted"><tr>
        {["Worker", "Time in", "Time out", "Status", "Undertime"].map(label => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.day}:${row.worker_id}`} className="border-t border-border">
        <td className="px-4 py-3">{onWorker ? <button type="button" className="text-left font-bold text-brand hover:underline" onClick={() => onWorker(row)}>{row.full_name}<span className="block text-xs font-normal text-fg-muted">{row.worker_code}</span></button> : <span className="font-bold">{row.full_name}</span>}</td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{row.time_in ? attendanceTime(row.time_in) : "—"}</td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{row.time_out ? attendanceTime(row.time_out) : "—"}</td>
        <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${statusChip[dailyStatusTone(row.status)]}`}>{dailyStatusLabel(row)}</span></td>
        <td className="whitespace-nowrap px-4 py-3 text-xs">{undertimeLabel(row) || <span className="text-fg-muted">—</span>}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

const fieldClass = "min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-sm text-fg"
const secondary = "min-h-10 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-40"

function useToday() {
  const [today, setToday] = useState(() => attendanceDay())
  useEffect(() => {
    const timer = window.setInterval(() => setToday(attendanceDay()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  return today
}

export function AttendanceCalendar({ day, today, onChange, action }: { day: string; today: string; onChange: (day: string) => void; action?: ReactNode }) {
  const [error, setError] = useState("")
  return <div className="min-w-0">
    <div className={`grid items-end gap-3 ${action ? "sm:grid-cols-[minmax(0,1fr)_auto]" : ""}`}>
    <label className="block min-w-0 space-y-1 text-xs font-semibold">Attendance date
      <input type="date" aria-label="Attendance date" className={fieldClass} value={day} max={today} aria-invalid={Boolean(error)} onChange={event => {
        const value = event.target.value
        if (!validAttendanceDay(value, today)) { setError("Choose today or a valid past date."); return }
        setError(""); onChange(value)
      }} />
    </label>
    {action}
    </div>
    <p className="mb-0 mt-1 text-xs text-fg-muted">Philippine time</p>
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
  </div>
}

export function AttendancePager({ page, size, total, onChange }: { page: number; size: number; total: number; onChange: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
    <p className="mb-0 text-xs text-fg-muted">{attendancePageLabel(page, size, total)}</p>
    {(total > size || page > 0) && <div className="flex gap-2">
      <button type="button" className={secondary} disabled={page === 0} onClick={() => onChange(page - 1)}>Previous page</button>
      <button type="button" className={secondary} disabled={(page + 1) * size >= total} onClick={() => onChange(page + 1)}>Next page</button>
    </div>}
  </div>
}

export function AttendanceRecordsTable({ events, onWorker }: { events: AttendanceEvent[]; onWorker?: (worker: AttendanceWorker) => void }) {
  return <div className="overflow-x-auto rounded-xl border border-border">
    <table className="w-full text-left text-sm">
      <thead className="bg-surface-muted text-xs text-fg-muted"><tr>
        {onWorker && <th scope="col" className="px-4 py-3">Worker</th>}
        <th scope="col" className="px-4 py-3">Attendance</th><th scope="col" className="px-4 py-3">Scan time</th><th scope="col" className="px-4 py-3">Schedule</th><th scope="col" className="px-4 py-3">Received</th><th scope="col" className="px-4 py-3">Terminal</th>
      </tr></thead>
      <tbody>{events.map(event => <tr key={event.id} className="border-t border-border">
        {onWorker && <td className="px-4 py-3">{event.worker ? <button type="button" className="text-left font-bold text-brand hover:underline" onClick={() => onWorker(event.worker!)}>{event.worker.full_name}<span className="block text-xs font-normal text-fg-muted">{event.worker.worker_code}</span></button> : "Worker unavailable"}</td>}
        <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${event.direction === "in" ? "bg-emerald-100 text-emerald-900" : "bg-sky-100 text-sky-900"}`}>{directionLabel(event.direction)}</span></td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{attendanceTime(event.occurred_at)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-xs">{scheduleFlagLabel(event.schedule_flag, event.minutes_off) ? <span className={`rounded-full px-2.5 py-1 font-bold ${scheduleFlagTone(event.schedule_flag) === "warn" ? "bg-danger-soft text-danger-fg" : "bg-ok-soft text-ok-fg"}`}>{scheduleFlagLabel(event.schedule_flag, event.minutes_off)}</span> : <span className="text-fg-muted">—</span>}</td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-fg-muted">{attendanceDate(event.received_at)}<span className="block">{attendanceTime(event.received_at)}</span></td>
        <td className="max-w-44 break-words px-4 py-3 text-xs text-fg-muted">{event.device_id}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

export function WorkerDirectory({ projectId, search, page, onSearch, onPage, onWorker }: { projectId: string; search: string; page: number; onSearch: (value: string) => void; onPage: (page: number) => void; onWorker: (worker: AttendanceWorker) => void }) {
  const result = useAttendanceWorkers(projectId, search, page)
  return <section className="space-y-5 rounded-2xl border border-border bg-surface p-5 sm:p-6" aria-label="Project workers">
    <label className="block max-w-xl space-y-2 text-sm font-semibold">Search workers
      <input type="search" className={fieldClass} value={search} placeholder="Search by worker name" onChange={event => onSearch(event.target.value)} />
    </label>
    {result.error ? <p role="alert" className="text-sm text-red-600">{result.error}</p> : result.loading ? <p role="status" className="py-10 text-center text-fg-muted">Loading workers…</p> : result.data && <>
      <p className="text-xs text-fg-muted">{result.data.total} {result.data.total === 1 ? "worker" : "workers"} · Click a worker to view their details and attendance summary.</p>
      {!result.data.workers.length ? <p className="py-12 text-center text-sm text-fg-muted">{search.trim() ? "No matching workers. Try another name." : result.data.total ? "No workers on this page. Go to the previous page." : "No workers registered in this project yet."}</p> : <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[850px] text-left text-sm" aria-label="Worker details list">
          <thead className="bg-surface-muted text-xs text-fg-muted"><tr>
            {["Worker", "Trade / position", "Contact", "Status", "Fingerprint", "Details"].map(label => <th key={label} scope="col" className="px-4 py-3 font-semibold">{label}</th>)}
          </tr></thead>
          <tbody>{result.data.workers.map(worker => <tr key={worker.id} className="cursor-pointer border-t border-border transition hover:bg-brand-soft focus-within:bg-brand-soft" onClick={() => onWorker(worker)}>
            <td className="px-4 py-4"><div className="flex items-center gap-3">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-brand">{workerInitials(worker.full_name)}</span>
              <span className="min-w-0"><strong className="block break-words">{worker.full_name}</strong><span className="mt-1 block text-xs text-fg-muted">{worker.worker_code}</span></span>
            </div></td>
            <td className="px-4 py-4">{worker.trade || "Site worker"}</td>
            <td className="max-w-56 break-words px-4 py-4"><span className="block">{worker.contact_number || "No contact number"}</span><span className="mt-1 block text-xs text-fg-muted">{worker.email || "No email"}</span></td>
            <td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${worker.active ? "bg-emerald-100 text-emerald-900" : "bg-surface-muted text-fg-muted"}`}>{worker.active ? "Active" : "Inactive"}</span></td>
            <td className="px-4 py-4 text-xs">{worker.biometric_uid ? "Registered" : "Not registered"}</td>
            <td className="px-4 py-4"><button type="button" aria-label={`View details for ${worker.full_name}`} className="min-h-10 whitespace-nowrap rounded-lg px-3 text-xs font-bold text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand" onClick={event => { event.stopPropagation(); onWorker(worker) }}>View details <span aria-hidden="true">→</span></button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      <AttendancePager page={page} size={WORKER_PAGE_SIZE} total={result.data.total} onChange={onPage} />
    </>}
  </section>
}

export function ProjectAttendanceRecords({ projectId, day, today, page, onDay, onPage, onWorker }: { projectId: string; day: string; today: string; page: number; onDay: (day: string) => void; onPage: (page: number) => void; onWorker: (worker: AttendanceWorker) => void }) {
  const result = useDailyAttendance(projectId, day, page)
  const status = useDailyStatus(projectId, day)
  const counts = dailyStatusCounts(status.data ?? [])
  const openRow = (row: DailyStatusRow) => onWorker({ id: row.worker_id, project_id: projectId, full_name: row.full_name, worker_code: row.worker_code, trade: row.trade, biometric_uid: null, photo_path: null, active: true })
  return <section className="min-w-0 space-y-5 rounded-2xl border border-border bg-surface p-5 sm:p-6" aria-label="Project attendance records">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-bold">Attendance records</h2><p className="mt-1 text-sm text-fg-muted">{day === today ? "Today" : day} · Recorded biometric scans for this project.</p></div>
      <div className="w-full min-w-0 sm:w-auto"><AttendanceCalendar day={day} today={today} onChange={onDay} action={<AttendanceReportButton projectId={projectId} anchorDay={day} />} /></div>
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">Daily attendance</h3>
        {status.data && <p className="text-sm text-fg-muted">On time {counts.on_time} · Late {counts.late} · Absent {counts.absent}{day === today ? ` · Not in yet ${counts.not_in_yet}` : ""}</p>}
      </div>
      {status.error ? <p role="alert" className="text-sm text-red-600">{status.error}</p> : status.loading ? <p role="status" className="py-6 text-center text-fg-muted">Loading daily attendance…</p> : status.data && (status.data.length
        ? <DailyAttendanceTable rows={status.data} onWorker={openRow} />
        : <p className="py-6 text-center text-sm text-fg-muted">No active workers with a fingerprint in this project for this date.</p>)}
      <p className="text-xs text-fg-muted">One time in and one time out per worker per day. Late = time in after the schedule's grace period; Absent = no time in on a working day after time out. The Admin sets the schedule.</p>
    </div>
    <h3 className="text-lg font-bold">Scan records</h3>
    {result.error ? <p role="alert" className="text-sm text-red-600">{result.error}</p> : result.loading ? <p role="status" className="py-10 text-center text-fg-muted">Loading attendance records…</p> : result.data && <>
      {!result.data.events.length ? <p className="py-12 text-center text-sm text-fg-muted">{result.data.total ? "No records on this page. Go to the previous page." : "No attendance recorded on this date."}</p> : <AttendanceRecordsTable events={result.data.events} onWorker={onWorker} />}
      <AttendancePager page={page} size={RECORD_PAGE_SIZE} total={result.data.total} onChange={onPage} />
    </>}
  </section>
}

export function WorkerAttendanceDetails({ worker, projectId, initialDay, onClose, onEdit }: { worker: AttendanceWorker; projectId: string; initialDay: string; onClose: () => void; onEdit?: (worker: AttendanceWorker) => void }) {
  const today = useToday()
  const [chosenDay, setChosenDay] = useState(initialDay === today ? "" : initialDay)
  const day = chosenDay || today
  const [page, setPage] = useState(0)
  const result = useWorkerAttendance(projectId, worker.id, day, page)
  const status = useDailyStatus(projectId, day)
  const dayStatus = status.data?.find(row => row.worker_id === worker.id) ?? null
  const data = result.data
  return <Modal title={worker.full_name} description="Worker details and attendance" size="xl" onClose={onClose}>
    {result.error ? <p role="alert" className="text-sm text-red-600">{result.error}</p> : result.loading ? <p role="status">Loading worker details and attendance…</p> : data && <div className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div className="max-w-[150px]"><WorkerPortrait path={data.worker.photo_path} name={data.worker.full_name} /></div>
        <dl className="grid content-start gap-4 text-sm sm:grid-cols-2">
          {[["Full name", data.worker.full_name], ["Worker code", data.worker.worker_code], ["Trade / position", data.worker.trade || "Site worker"], ["Status", data.worker.active ? "Active" : "Inactive"], ["Contact number", data.worker.contact_number || "Not provided"], ["Email", data.worker.email || "Not provided"]].map(([label, value]) => <div key={label}><dt className="text-xs text-fg-muted">{label}</dt><dd className="ml-0 mt-1 break-words font-semibold">{value}</dd></div>)}
        </dl>
      </div>
      {onEdit && <button type="button" className={secondary} onClick={() => onEdit(data.worker)}>Edit profile</button>}
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-bold">Attendance summary</h3><p className="mt-1 text-xs text-fg-muted">{day === today ? "Today" : day} · Entire selected day, not just this record page.</p></div><div className="w-full sm:w-auto"><AttendanceCalendar day={day} today={today} onChange={value => { setChosenDay(value === today ? "" : value); setPage(0) }} action={<AttendanceReportButton projectId={projectId} workerId={data.worker.id} workerName={data.worker.full_name} anchorDay={day} />} /></div></div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Time in", data.summary.firstIn ? attendanceTime(data.summary.firstIn) : "—"], ["Time out", data.summary.lastOut ? attendanceTime(data.summary.lastOut) : "—"], ["Status", dayStatus ? dailyStatusLabel(dayStatus) : status.error ? "Unavailable" : "—"], ["Undertime", dayStatus && undertimeLabel(dayStatus) || "—"]].map(([label, value]) => <div key={label} className="rounded-xl border border-border p-4"><dt className="text-xs text-fg-muted">{label}</dt><dd className="ml-0 mt-2 text-lg font-bold tabular-nums">{value}</dd></div>)}
      </dl>
      <h3 className="text-lg font-bold">Attendance records · {data.total}</h3>
      {!data.events.length ? <p className="py-5 text-sm text-fg-muted">{data.total ? "No records on this page." : "No attendance recorded for this worker on this date."}</p> : <AttendanceRecordsTable events={data.events} />}
      <AttendancePager page={page} size={RECORD_PAGE_SIZE} total={data.total} onChange={setPage} />
    </div>}
  </Modal>
}

export default function ForemanWorkerAttendance({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [tab, setTab] = useState<"workers" | "records">("records")
  const [search, setSearch] = useState("")
  const [workerPage, setWorkerPage] = useState(0)
  const today = useToday()
  const [chosenDay, setChosenDay] = useState("")
  const day = chosenDay || today
  const [recordPage, setRecordPage] = useState(0)
  const [selected, setSelected] = useState<{ worker: AttendanceWorker; day: string } | null>(null)
  useEffect(() => setRecordPage(0), [day])
  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-extrabold sm:text-3xl">Workforce management</h1><p className="mt-2 text-sm text-fg-muted">{projectName}</p></div>
      <a href={attendancePath(projectId)} target="_blank" rel="noopener noreferrer" aria-label="Open standalone attendance screen" title="Open standalone attendance screen" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4M8 10h3l2-3 3 6 2-3" /></svg>
      </a>
    </div>
    <div role="tablist" aria-label="Foreman attendance tabs" className="flex gap-2 border-b border-border pb-3">
      {([['records', 'Attendance records'], ['workers', 'Workers']] as const).map(([key, label]) => <button type="button" role="tab" key={key} id={`foreman-attendance-${key}`} aria-selected={tab === key} aria-controls="foreman-attendance-panel" className={`min-h-11 rounded-xl px-5 text-sm font-bold ${tab === key ? 'bg-brand text-white' : 'border border-border bg-surface'}`} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    <div role="tabpanel" id="foreman-attendance-panel" aria-labelledby={`foreman-attendance-${tab}`}>
      {tab === "workers" ? <WorkerDirectory projectId={projectId} search={search} page={workerPage} onSearch={value => { setSearch(value); setWorkerPage(0) }} onPage={setWorkerPage} onWorker={worker => setSelected({ worker, day: today })} /> : <ProjectAttendanceRecords projectId={projectId} day={day} today={today} page={recordPage} onDay={value => { setChosenDay(value === today ? "" : value); setRecordPage(0) }} onPage={setRecordPage} onWorker={worker => setSelected({ worker, day })} />}
    </div>
    {selected && <WorkerAttendanceDetails key={`${projectId}:${selected.worker.id}:${selected.day}`} projectId={projectId} worker={selected.worker} initialDay={selected.day} onClose={() => setSelected(null)} />}
  </div>
}
