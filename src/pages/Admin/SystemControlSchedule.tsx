import { useCallback, useEffect, useState } from "react"
import Modal from "../../components/Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { Skeleton } from "../../components/ui/Skeleton"
import { formatDate, formatTime } from "../../lib/admin"
import { cancelWindow, loadLockouts, loadWindows, scheduleWindow, type Windows } from "../../lib/systemControl"
import { lockoutVerdict, manilaToIso, windowProblem, windowStatusLabel, windowTime, type LockoutWatch, type WindowRow } from "../../lib/systemControlModel"
import { useToast } from "../../lib/toast"
import { Panel } from "./AdminShell"

const label = "block text-xs font-bold uppercase tracking-wider text-fg-muted"
const problemBox = (message: string) => <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{message}</p>
const setupBox = (message: string) => <p role="status" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">{message}</p>
const dangerButton = buttonSecondary + " !border-danger-fg !text-danger-fg"
const whenOf = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`
const Loading = ({ name }: { name: string }) => <div className="space-y-3" role="status" aria-label={name}><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
const manilaNow = (plusMinutes = 0) => new Date(Date.now() + 8 * 3_600_000 + plusMinutes * 60_000).toISOString().slice(0, 16) // what a date-time box expects, in Manila time

// ---------------------------------------------------------------- Scheduled maintenance (Maintenance & isolation tab)
export function SchedulePanel({ refreshKey }: { refreshKey: number }) {
  const toast = useToast()
  const [data, setData] = useState<Windows | null>(null)
  const [problem, setProblem] = useState("")
  const [setup, setSetup] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState<WindowRow | null>(null)
  const load = useCallback(async () => {
    const result = await loadWindows()
    setProblem(result.error)
    setSetup(result.setup)
    if (result.data) setData(result.data)
  }, [])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const invalid = dialog ? windowProblem({ start, end, message }) : null
  const save = async () => {
    const startsAt = manilaToIso(start)
    const endsAt = manilaToIso(end)
    if (!startsAt || !endsAt) return
    setBusy(true)
    const result = await scheduleWindow({ startsAt, endsAt, message: message.replace(/\s+/g, " ").trim() })
    setBusy(false)
    if (result.error) return toast.error("Not scheduled", result.error)
    toast.success("Window scheduled", "Maintenance switches on and off by itself.")
    setDialog(false)
    setStart("")
    setEnd("")
    setMessage("")
    await load()
  }
  const cancel = async () => {
    if (!cancelling) return
    setBusy(true)
    const result = await cancelWindow(cancelling.id)
    setBusy(false)
    if (result.error) return toast.error("Not changed", result.error)
    toast.success(cancelling.status === "active" ? "Maintenance window ended" : "Window cancelled")
    setCancelling(null)
    await load()
  }
  const chip: Record<WindowRow["status"], string> = {
    scheduled: "bg-surface-muted text-fg",
    active: "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100",
    done: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
    cancelled: "bg-surface-muted text-fg-muted",
    skipped: "bg-danger-soft text-danger-fg",
  }
  return (
    <Panel title="Scheduled maintenance" action={<button type="button" className={buttonPrimary} onClick={() => { setStart(manilaNow(60)); setEnd(manilaNow(120)); setDialog(true) }}>Schedule a window</button>}>
      {problem ? (setup ? setupBox(problem) : problemBox(problem)) : !data ? <Loading name="Loading the scheduled windows" /> : (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Pick a start and an end (Manila time). Maintenance switches on by itself at the start with your message and the return time, and off by itself at the end. It never replaces maintenance you switched on by hand, and it only switches off what it switched on. The check runs every minute.</p>
          {!data.scheduler_ready ? <p role="alert" className="rounded-lg bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">The scheduler job is not running on this database, so windows will not start by themselves. The owner needs to enable pg_cron (the Health tab lists the Cron jobs).</p> : null}
          {data.windows.length === 0 ? <p className="text-sm text-fg-muted">No window is scheduled.</p> : (
            <div className="overflow-x-auto">
              <table className="admin-table w-full text-sm">
                <thead><tr><th>When (Manila)</th><th>Message</th><th>Status</th><th /></tr></thead>
                <tbody>{data.windows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{windowTime(row.starts_at)} to {windowTime(row.ends_at)}</td>
                    <td className="max-w-md break-words">{row.message}{row.end_note ? <span className="mt-1 block text-xs text-fg-muted">{row.end_note}</span> : null}</td>
                    <td><span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${chip[row.status]}`}>{windowStatusLabel[row.status]}</span></td>
                    <td>{row.status === "scheduled" || row.status === "active" ? <button type="button" className={buttonSecondary} onClick={() => setCancelling(row)}>{row.status === "active" ? "End now" : "Cancel"}</button> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {dialog ? (
        <Modal title="Schedule a maintenance window" size="md" onClose={busy ? () => undefined : () => setDialog(false)} footer={
          <>
            <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setDialog(false)}>Cancel</button>
            <button type="button" className={buttonPrimary} disabled={busy || Boolean(invalid)} onClick={() => void save()}>{busy ? "Saving..." : "Schedule"}</button>
          </>
        }>
          <div className="space-y-3">
            <label className={label}>Starts (Manila time)
              <input type="datetime-local" className={`${inputClass} mt-1 normal-case`} value={start} min={manilaNow(1)} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label className={label}>Ends (Manila time)
              <input type="datetime-local" className={`${inputClass} mt-1 normal-case`} value={end} min={start || manilaNow(6)} onChange={(event) => setEnd(event.target.value)} />
            </label>
            <label className={label}>Message people will see
              <textarea className={`${inputClass} mt-1 min-h-20 normal-case`} value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder="For example: BuildTrack is being upgraded. You can read everything but cannot save until it is finished." />
            </label>
            <p className={`text-xs ${invalid && message ? "text-danger-fg" : "text-fg-muted"}`}>{invalid ?? "Looks good. Between 5 minutes and 24 hours, up to 30 days ahead."}</p>
          </div>
        </Modal>
      ) : null}
      {cancelling ? (
        <Modal title={cancelling.status === "active" ? "End this maintenance now?" : "Cancel this window?"} size="sm" onClose={busy ? () => undefined : () => setCancelling(null)} footer={
          <>
            <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setCancelling(null)}>Keep it</button>
            <button type="button" className={dangerButton} disabled={busy} onClick={() => void cancel()}>{busy ? "Saving..." : cancelling.status === "active" ? "End now" : "Cancel window"}</button>
          </>
        }>
          <p className="text-sm text-fg-muted">{cancelling.status === "active" ? "Maintenance switched on by this window is switched off now and people can save again." : `The window ${windowTime(cancelling.starts_at)} to ${windowTime(cancelling.ends_at)} will not run.`}</p>
        </Modal>
      ) : null}
    </Panel>
  )
}

// ---------------------------------------------------------------- Lockouts (read only)
export function LockoutPanel() {
  const [data, setData] = useState<LockoutWatch | null>(null)
  const [problem, setProblem] = useState("")
  const load = useCallback(async () => {
    const result = await loadLockouts()
    setProblem(result.error)
    if (result.data) setData(result.data)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const verdict = data ? lockoutVerdict(data) : null
  return (
    <>
      <Panel title="Lockout watch" action={<button type="button" className={buttonSecondary} onClick={() => void load()}>Refresh</button>}>
        {problem ? problemBox(problem) : !data ? <Loading name="Loading the lockout watch" /> : (
          <div className="space-y-4">
            <p className={`rounded-lg px-4 py-3 text-sm font-semibold ${verdict!.tone === "ok" ? "bg-green-100 text-green-950 dark:bg-green-900/40 dark:text-green-100" : "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100"}`} role="status">{verdict!.text}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[["Codes requested (24 h)", data.codes_requested_24h], ["Wrong code tries (24 h)", data.wrong_tries_24h], ["Locked codes (24 h)", data.locked_codes.length], ["Blocked sign-ins (7 days)", data.blocked_signins_7d]].map(([name, value]) => <div key={String(name)} className="rounded-lg border border-line px-3 py-2"><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">{name}</dt><dd className="text-xl font-extrabold">{value}</dd></div>)}
            </dl>
            <p className="text-sm text-fg-muted">Read only. A code locks after 5 wrong tries and an account after 8 wrong invitation codes in an hour; both clear by themselves. Wrong passwords at sign-in are kept by Supabase Auth, not by BuildTrack, so they are not listed here: see the Supabase Dashboard, Authentication, Logs.</p>
          </div>
        )}
      </Panel>
      {data ? (
        <>
          <Panel title="Locked sign-up and reset codes">
            {data.locked_codes.length === 0 ? <p className="text-sm text-fg-muted">No code was locked in the last 24 hours.</p> : (
              <div className="overflow-x-auto"><table className="admin-table w-full text-sm"><thead><tr><th>Address</th><th>For</th><th>Wrong tries</th><th>When</th><th>State</th></tr></thead>
                <tbody>{data.locked_codes.map((row, index) => <tr key={index}><td>{row.email}</td><td>{row.purpose === "reset" ? "Password reset" : "Email confirmation"}</td><td>{row.attempts}</td><td className="whitespace-nowrap">{whenOf(row.created_at)}</td><td>{row.still_locked ? "Locked now" : "Expired"}</td></tr>)}</tbody></table></div>
            )}
          </Panel>
          <Panel title="Invitation code tries (last hour)">
            {data.invite_attempts.length === 0 ? <p className="text-sm text-fg-muted">Nobody has three or more wrong invitation codes in the last hour.</p> : (
              <div className="overflow-x-auto"><table className="admin-table w-full text-sm"><thead><tr><th>Person</th><th>Wrong tries</th><th>Last try</th><th>State</th></tr></thead>
                <tbody>{data.invite_attempts.map((row, index) => <tr key={index}><td>{row.person ?? "Unknown"}</td><td>{row.failed}</td><td className="whitespace-nowrap">{whenOf(row.last_at)}</td><td>{row.locked ? "Locked for the hour" : "Warning"}</td></tr>)}</tbody></table></div>
            )}
          </Panel>
          <Panel title="Blocked Google sign-ins (7 days)">
            {data.blocked_signins.length === 0 ? <p className="text-sm text-fg-muted">None. A Google account without a registration is removed at sign-in and listed here.</p> : (
              <div className="overflow-x-auto"><table className="admin-table w-full text-sm"><thead><tr><th>When</th><th>Address</th><th>Why</th></tr></thead>
                <tbody>{data.blocked_signins.map((row, index) => <tr key={index}><td className="whitespace-nowrap">{whenOf(row.created_at)}</td><td>{row.email}</td><td className="text-fg-muted">{row.reason}</td></tr>)}</tbody></table></div>
            )}
          </Panel>
        </>
      ) : null}
    </>
  )
}
