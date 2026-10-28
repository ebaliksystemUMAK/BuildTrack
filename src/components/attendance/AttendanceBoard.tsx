import { useEffect, useMemo, useState } from "react"
import { useAttendance } from "../../lib/attendance"
import {
  attendanceDate,
  attendanceDay,
  attendanceTime,
  filterAttendance,
} from "../../lib/attendanceModel"
import WorkerPortrait from "./WorkerPortrait"
import ScanNoticePopup from "./ScanNoticePopup"

export default function AttendanceBoard({
  projectId,
  projectName,
  displayOnly = false,
}: {
  projectId: string
  projectName: string
  displayOnly?: boolean
}) {
  const [now, setNow] = useState(() => new Date())
  const today = attendanceDay(now)
  const [chosenDay, setChosenDay] = useState("")
  const day = displayOnly ? today : chosenDay || today
  const data = useAttendance(projectId, day)
  const [search, setSearch] = useState("")
  const [direction, setDirection] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const latest = data.events[0]?.id
  useEffect(() => {
    setSelected(null)
  }, [latest, day])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const rows = useMemo(
    () =>
      displayOnly
        ? data.events
        : filterAttendance(data.events, search, direction),
    [data.events, search, direction, displayOnly],
  )
  const active =
    (!displayOnly && data.events.find((event) => event.id === selected)) ||
    data.events[0]
  const WorkerLabel = displayOnly ? "div" : "button"
  const inputClass =
    "min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg"
  return (
    <div className="space-y-6">
      {/* Scan messages (recorded / already timed in or out / not registered) for the worker at the scanner. */}
      <ScanNoticePopup projectId={projectId} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[.18em] text-brand">
            Workforce / Site attendance
          </p>
          <h1 className="mb-2 text-3xl font-extrabold text-fg sm:text-4xl">
            Biometric attendance
          </h1>
          <p className="mb-0 text-sm text-fg-muted">
            {projectName} · Scan at the biometric terminal to record attendance.
          </p>
        </div>
        <div className="text-right">
          <p className="mb-1 font-mono text-3xl font-bold tabular-nums text-fg">
            {attendanceTime(now.toISOString())}
          </p>
          <p className="mb-0 text-xs text-fg-muted">
            {attendanceDate(now.toISOString())} · Philippine time
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          // Daily status from the database (one Time IN / Time OUT per worker per day; see attendance_daily_status).
          ["On time", data.summary.on_time ?? 0],
          ["Late", data.summary.late ?? 0],
          ["Absent", data.summary.absent ?? 0],
          ["Not in yet", data.summary.not_in_yet ?? 0],
        ].map(([label, count]) => (
          <div
            key={label}
            className="rounded-2xl border border-border bg-surface p-5"
          >
            <p className="mb-2 text-xs font-semibold text-fg-muted">{label}</p>
            <strong className="text-3xl tabular-nums text-fg">
              {data.loading || data.error ? "—" : count}
            </strong>
            <p className="mb-0 mt-1 text-xs text-fg-muted">
              {day === today ? "Today" : day} · selected project
            </p>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(290px,360px)]">
        <section
          className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
          aria-labelledby="recent-attendance-title"
        >
          <div className="border-b border-border p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2
                  id="recent-attendance-title"
                  className="mb-1 text-lg font-extrabold"
                >
                  Recent attendance
                </h2>
                <p className="mb-0 text-xs text-fg-muted">
                  {displayOnly
                    ? "Today's 50 most recent scans. Updates appear automatically."
                    : "Most recent 50 scans for the selected date. Summary counts cover the entire day."}
                </p>
              </div>
              {!displayOnly && (
                <button
                  className="rounded-lg border border-border px-3 py-2 text-sm"
                  onClick={() => void data.reload()}
                >
                  Refresh
                </button>
              )}
            </div>
            {!displayOnly && (
              <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_150px]">
                <label className="space-y-1 text-xs font-semibold">
                  Search recent scans
                  <input
                    className={inputClass}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Worker name, ID or device"
                  />
                </label>
                <label className="space-y-1 text-xs font-semibold">
                  Attendance
                  <select
                    className={inputClass}
                    value={direction}
                    onChange={(event) => setDirection(event.target.value)}
                  >
                    <option value="">All scans</option>
                    <option value="in">Time in</option>
                    <option value="out">Time out</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs font-semibold">
                  Date
                  <input
                    className={inputClass}
                    type="date"
                    value={day}
                    max={today}
                    onChange={(event) =>
                      setChosenDay(
                        event.target.value === today ? "" : event.target.value,
                      )
                    }
                  />
                </label>
              </div>
            )}
            <p className="mb-0 mt-3 text-xs text-fg-muted">
              {data.error ? "Database unavailable" : data.connection}
              {data.updated &&
                ` · Checked ${attendanceTime(data.updated.toISOString())}`}
            </p>
          </div>
          {data.error ? (
            <div className="p-8 text-sm text-red-600" role="alert">
              {data.error}{" "}
              {!displayOnly && (
                <button
                  className="underline"
                  onClick={() => void data.reload()}
                >
                  Retry
                </button>
              )}
              {displayOnly && <span>Updates retry automatically.</span>}
            </div>
          ) : data.loading ? (
            <p className="p-8 text-center text-fg-muted" role="status">
              Loading attendance…
            </p>
          ) : !rows.length ? (
            <div className="px-6 py-20 text-center">
              <p className="mb-2 text-lg font-bold">
                {data.events.length
                  ? "No matching scans"
                  : "No attendance recorded yet"}
              </p>
              <p className="mx-auto mb-0 max-w-md text-sm text-fg-muted">
                {data.events.length
                  ? "Change the search or attendance filter."
                  : "Real biometric entries will appear here once the device integration sends them to the database. No sample attendance is shown."}
              </p>
            </div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface-muted text-xs text-fg-muted">
                  <tr>
                    {["Worker", "Attendance", "Scan time", "Device"].map(
                      (label) => (
                        <th
                          key={label}
                          scope="col"
                          className="px-5 py-3 font-semibold"
                        >
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((event) => (
                    <tr
                      key={event.id}
                      className={`border-t border-border ${
                        active?.id === event.id ? "bg-brand-soft" : ""
                      }`}
                    >
                      <td className="px-5 py-4">
                        <WorkerLabel
                          className="text-left"
                          aria-pressed={
                            displayOnly ? undefined : active?.id === event.id
                          }
                          onClick={
                            displayOnly
                              ? undefined
                              : () => setSelected(event.id)
                          }
                        >
                          <strong className="block text-brand">
                            {event.worker?.full_name ?? "Worker unavailable"}
                          </strong>
                          <span className="text-xs text-fg-muted">
                            {event.worker?.worker_code ?? "—"}
                            {event.worker?.trade
                              ? ` · ${event.worker.trade}`
                              : ""}
                          </span>
                        </WorkerLabel>
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${
                            event.direction === "in"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-sky-100 text-sky-800"
                          }`}
                        >
                          {event.direction === "in" ? "Time in" : "Time out"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs">
                        {attendanceTime(event.occurred_at)}
                      </td>
                      <td className="max-w-40 break-words px-5 py-4 text-xs text-fg-muted">
                        {event.device_id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <aside
          className="rounded-2xl border border-border bg-surface p-6 shadow-sm lg:sticky lg:top-24"
          aria-label="Worker scan profile"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="mb-4 text-xs font-extrabold uppercase tracking-[.14em] text-fg-muted">
            {!displayOnly && selected && active?.id !== latest
              ? "Selected attendance record"
              : "Latest recorded scan"}
          </p>
          {active && !data.error ? (
            <div key={active.id}>
              <WorkerPortrait
                path={active.worker?.photo_path ?? null}
                name={active.worker?.full_name ?? "Worker"}
              />
              <h2 className="mb-1 mt-5 break-words text-2xl font-extrabold">
                {active.worker?.full_name ?? "Worker unavailable"}
              </h2>
              <p className="text-sm text-fg-muted">
                {active.worker?.worker_code ?? "—"} ·{" "}
                {active.worker?.trade || "Site worker"}
              </p>
              <div
                className={`rounded-xl p-4 ${
                  active.direction === "in"
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-sky-100 text-sky-900"
                }`}
              >
                <strong className="block text-xl">
                  {active.direction === "in"
                    ? "Time in recorded"
                    : "Time out recorded"}
                </strong>
                <span className="text-sm">
                  {attendanceTime(active.occurred_at)} ·{" "}
                  {attendanceDate(active.occurred_at)}
                </span>
              </div>
              <dl className="mb-0 mt-5 space-y-3 text-xs">
                <div>
                  <dt className="text-fg-muted">Project</dt>
                  <dd className="ml-0 mt-1 font-semibold">{projectName}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Biometric terminal</dt>
                  <dd className="ml-0 mt-1 break-words font-semibold">
                    {active.device_id}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Received by database</dt>
                  <dd className="ml-0 mt-1">
                    {attendanceDate(active.received_at)} ·{" "}
                    {attendanceTime(active.received_at)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="py-12 text-center">
              <div
                className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-brand-soft text-4xl text-brand"
                aria-hidden="true"
              >
                ◎
              </div>
              <h2 className="mb-2 text-xl font-extrabold">
                {data.error ? "Attendance unavailable" : "Waiting for a scan"}
              </h2>
              <p className="mb-0 text-sm text-fg-muted">
                The worker’s saved profile photo and attendance details will
                appear here when an entry is received.
              </p>
            </div>
          )}
          <p className="mb-0 mt-6 border-t border-border pt-4 text-xs leading-relaxed text-fg-muted">
            This screen displays device records. It does not capture
            fingerprints or confirm identity itself.
          </p>
        </aside>
      </div>
    </div>
  )
}
