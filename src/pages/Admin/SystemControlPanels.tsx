import { useCallback, useEffect, useState } from "react"
import Modal from "../../components/Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { Skeleton } from "../../components/ui/Skeleton"
import { formatDate, formatTime } from "../../lib/admin"
import { rolesForArea } from "../../components/RouteGuard"
import type { Profile } from "../../lib/auth"
import { loadActivity, loadCapacity, loadEmailDelivery, loadSwitches, saveSwitch, emergencyOff, type Capacity, type SwitchKey, type Switches } from "../../lib/systemControl"
import { ROLE_ORDER, ROLE_RULES, activityName, activitySummary, adminPageMatrix, areaMatrix, emailVerdict, formatBytes, roleNames, type ActivityRow, type EmailDelivery } from "../../lib/systemControlModel"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { Panel } from "./AdminShell"
import { adminMenuPages, adminPagePermission } from "./AdminShell"
import PermissionMatrix from "./PermissionMatrix"

const label = "block text-xs font-bold uppercase tracking-wider text-fg-muted"
const problemBox = (message: string) => <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{message}</p>
const setupBox = (message: string) => <p role="status" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">{message}</p>
const dangerButton = buttonSecondary + " !border-danger-fg !text-danger-fg"
const whenOf = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`

function Loading({ name }: { name: string }) {
  return <div className="space-y-3" role="status" aria-label={name}><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
}

// The two switches (registration, email) are read together so the tabs and the emergency button always agree.
export function useSwitches() {
  const [switches, setSwitches] = useState<Switches | null>(null)
  const [problem, setProblem] = useState("")
  const [setup, setSetup] = useState(false)
  const reload = useCallback(async () => {
    const result = await loadSwitches()
    setProblem(result.error)
    setSetup(result.setup)
    if (result.data) setSwitches(result.data)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])
  return { switches, problem, setup, reload }
}

// ---------------------------------------------------------------- one switch with a confirmation pop-up
function SwitchDialog({ title, intro, needMessage, messageLabel, confirmLabel, danger, busy, onClose, onConfirm }: {
  title: string; intro: string; needMessage: boolean; messageLabel: string; confirmLabel: string; danger?: boolean; busy: boolean; onClose: () => void; onConfirm: (message: string) => void
}) {
  const [message, setMessage] = useState("")
  const clean = message.replace(/\s+/g, " ").trim()
  const ready = !needMessage || (clean.length >= 5 && clean.length <= 300)
  return (
    <Modal title={title} size="md" onClose={busy ? () => undefined : onClose} footer={
      <>
        <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className={danger ? dangerButton : buttonPrimary} disabled={!ready || busy} onClick={() => onConfirm(clean)}>{busy ? "Saving..." : confirmLabel}</button>
      </>
    }>
      <p className="text-sm text-fg-muted">{intro}</p>
      {needMessage ? (
        <label className={`${label} mt-4`}>{messageLabel}
          <textarea className={`${inputClass} mt-1 min-h-20 normal-case`} value={message} maxLength={300} onChange={(event) => setMessage(event.target.value)} />
          <span className="mt-1 block text-xs font-normal normal-case text-fg-muted">{clean.length}/300, at least 5 characters.</span>
        </label>
      ) : null}
    </Modal>
  )
}

function useSwitchAction(reload: () => Promise<void>) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (key: SwitchKey, enabled: boolean, message: string, done: string): Promise<boolean> => {
    setBusy(true)
    const result = await saveSwitch(key, enabled, message)
    setBusy(false)
    if (result.error) {
      toast.error("Not saved", result.error)
      return false
    }
    toast.success(done)
    await reload()
    return true
  }
  return { busy, run }
}

// ---------------------------------------------------------------- Registration
export function RegistrationPanel({ state }: { state: ReturnType<typeof useSwitches> }) {
  const { switches, problem, setup, reload } = state
  const { busy, run } = useSwitchAction(reload)
  const [dialog, setDialog] = useState<"close" | "open" | null>(null)
  const current = switches?.registration_closed
  return (
    <Panel title="New registrations" action={current ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${current.enabled ? "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100" : "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100"}`}>{current.enabled ? "Closed" : "Open"}</span> : undefined}>
      {problem ? (setup ? setupBox(problem) : problemBox(problem)) : !switches ? <Loading name="Loading the registration switch" /> : (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">When closed, nobody new can send a registration to the administrators, ask for elevated access or use an invitation code, and the Register page shows your message. People who already have a role, pre-approved (whitelisted) emails and accounts made by an administrator are not affected. A closed registration does not delete anything.</p>
          {current?.enabled ? <p className="rounded-lg bg-surface-muted px-4 py-3 text-sm"><span className="font-bold">Message shown:</span> {current.message}{current.updated_at ? <span className="mt-1 block text-xs text-fg-muted">Closed {whenOf(current.updated_at)}{current.updated_by ? ` by ${current.updated_by}` : ""}.</span> : null}</p> : null}
          <button type="button" className={current?.enabled ? buttonPrimary : dangerButton} onClick={() => setDialog(current?.enabled ? "open" : "close")}>{current?.enabled ? "Open registration again" : "Close registration"}</button>
        </div>
      )}
      {dialog === "close" ? <SwitchDialog title="Close new registrations?" intro="People will see your message instead of the registration form. Nothing is deleted and people who are already registered are not affected." needMessage messageLabel="Message people will see" confirmLabel="Close registration" danger busy={busy} onClose={() => setDialog(null)} onConfirm={async (message) => { if (await run("registration_closed", true, message, "Registration is closed")) setDialog(null) }} /> : null}
      {dialog === "open" ? <SwitchDialog title="Open registration again?" intro="The Register page works again for everyone." needMessage={false} messageLabel="" confirmLabel="Open registration" busy={busy} onClose={() => setDialog(null)} onConfirm={async () => { if (await run("registration_closed", false, "", "Registration is open")) setDialog(null) }} /> : null}
    </Panel>
  )
}

// ---------------------------------------------------------------- Email: pause switch and what was really sent
export function EmailPanel({ state }: { state: ReturnType<typeof useSwitches> }) {
  const { switches, problem: switchProblem, setup, reload } = state
  const { busy, run } = useSwitchAction(reload)
  const [dialog, setDialog] = useState<"pause" | "resume" | null>(null)
  const paused = Boolean(switches?.email_paused?.enabled)
  return (
      <Panel title="Notification email" action={switches ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${paused ? "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100" : "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100"}`}>{paused ? "Paused" : "On"}</span> : undefined}>
        {switchProblem ? (setup ? setupBox(switchProblem) : problemBox(switchProblem)) : !switches ? <Loading name="Loading the email switch" /> : (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">Pausing stops the notification emails (QA, assignments, reminders, announcements). Nothing is lost while paused: they wait and go out when you resume, except anything older than 2 days. Sign-up and password-reset codes and account security notices use a separate path and keep working. What was really sent or failed is in System Logs, Email delivery.</p>
            <button type="button" className={paused ? buttonPrimary : dangerButton} onClick={() => setDialog(paused ? "resume" : "pause")}>{paused ? "Resume email" : "Pause email"}</button>
          </div>
        )}
        {dialog === "pause" ? <SwitchDialog title="Pause notification emails?" intro="Notifications stay in the bell and wait in the queue. Codes and security notices are not affected." needMessage={false} messageLabel="" confirmLabel="Pause email" danger busy={busy} onClose={() => setDialog(null)} onConfirm={async () => { if (await run("email_paused", true, "", "Email is paused")) setDialog(null) }} /> : null}
        {dialog === "resume" ? <SwitchDialog title="Resume notification emails?" intro="Waiting notifications go out within about 5 minutes." needMessage={false} messageLabel="" confirmLabel="Resume email" busy={busy} onClose={() => setDialog(null)} onConfirm={async () => { if (await run("email_paused", false, "", "Email is on")) setDialog(null) }} /> : null}
      </Panel>
  )
}

// The emails that were really attempted (System Logs > Email delivery); read only.
export function EmailDeliveryPanel({ paused }: { paused: boolean }) {
  const [data, setData] = useState<EmailDelivery | null>(null)
  const [problem, setProblem] = useState("")
  const load = useCallback(async () => {
    const result = await loadEmailDelivery()
    setProblem(result.error)
    if (result.data) setData(result.data)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const verdict = data ? emailVerdict(data, paused) : null
  const tones = { ok: "bg-green-100 text-green-950 dark:bg-green-900/40 dark:text-green-100", warn: "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100", bad: "bg-danger-soft text-danger-fg", idle: "bg-surface-muted text-fg" }
  return (
      <Panel title="What was sent" action={<button type="button" className={buttonSecondary} onClick={() => void load()}>Refresh</button>}>
        {problem ? problemBox(problem) : !data ? <Loading name="Loading the email log" /> : (
          <div className="space-y-4">
            <p className={`rounded-lg px-4 py-3 text-sm font-semibold ${tones[verdict!.tone]}`} role="status">{verdict!.text}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {[["Sent (24 h)", data.sent_24h], ["Failed (24 h)", data.failed_24h], ["Skipped (24 h)", data.skipped_24h], ["Waiting", data.waiting]].map(([name, value]) => <div key={String(name)} className="rounded-lg border border-line px-3 py-2"><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">{name}</dt><dd className="text-xl font-extrabold">{value}</dd></div>)}
            </dl>
            {data.recent.length ? (
              <div className="overflow-x-auto">
                <table className="admin-table w-full text-sm">
                  <thead><tr><th>When</th><th>Result</th><th>To</th><th>Kind</th><th>Reason</th></tr></thead>
                  <tbody>{data.recent.map((row, index) => <tr key={index}><td className="whitespace-nowrap">{whenOf(row.created_at)}</td><td>{row.status}</td><td>{row.person ?? ""}</td><td>{row.kind ?? ""}</td><td className="max-w-md break-words text-fg-muted">{row.detail}</td></tr>)}</tbody>
                </table>
              </div>
            ) : <p className="text-sm text-fg-muted">No notification email has been attempted yet. Reset and sign-up codes are not listed here.</p>}
          </div>
        )}
      </Panel>
  )
}

// ---------------------------------------------------------------- Storage and capacity (read only)
export function CapacityPanel() {
  const [data, setData] = useState<Capacity | null>(null)
  const [problem, setProblem] = useState("")
  const load = useCallback(async () => {
    const result = await loadCapacity()
    setProblem(result.error)
    if (result.data) setData(result.data)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const total = data ? data.buckets.reduce((sum, bucket) => sum + Number(bucket.bytes), 0) : 0
  return (
    <Panel title="Storage and capacity" action={<button type="button" className={buttonSecondary} onClick={() => void load()}>Refresh</button>}>
      {problem ? problemBox(problem) : !data ? <Loading name="Loading the storage numbers" /> : (
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">Sizes only. Your plan's limits are in the Supabase dashboard (Settings, Usage); this page does not guess them.</p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-line px-3 py-2"><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">Database</dt><dd className="text-xl font-extrabold">{formatBytes(data.database_bytes)}</dd></div>
            <div className="rounded-lg border border-line px-3 py-2"><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">Files</dt><dd className="text-xl font-extrabold">{formatBytes(total)}</dd></div>
            <div className="rounded-lg border border-line px-3 py-2"><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">Buckets</dt><dd className="text-xl font-extrabold">{data.buckets.length}</dd></div>
          </dl>
          <table className="admin-table w-full text-sm">
            <thead><tr><th>Bucket</th><th>Files</th><th>Size</th></tr></thead>
            <tbody>{data.buckets.map((bucket) => <tr key={bucket.bucket}><td>{bucket.bucket}</td><td>{Number(bucket.files).toLocaleString()}</td><td>{formatBytes(bucket.bytes)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------- Role access (RBAC)
export function RoleAccessPanel({ onOpenTab }: { onOpenTab: (tab: "maintenance") => void }) {
  const [admins, setAdmins] = useState<Profile[]>([])
  const [problem, setProblem] = useState("")
  const loadAdmins = useCallback(async () => {
    const { data, error } = await supabase.from("profiles").select("*").eq("role", "admin").order("full_name")
    if (error) setProblem("Could not load the Admin accounts. Check your connection and try again.")
    else {
      setProblem("")
      setAdmins((data as Profile[] | null) ?? [])
    }
  }, [])
  useEffect(() => {
    void loadAdmins()
  }, [loadAdmins])
  const areas = areaMatrix(rolesForArea)
  const pages = adminPageMatrix(adminMenuPages, adminPagePermission as Record<string, string | undefined>)
  return (
    <>
      <Panel title="Who can open which workspace">
        <p className="mb-4 text-sm text-fg-muted">This is the table the app really uses to let a role into a workspace. It is a list, not a switch: what each role may read or change inside is decided by the database rules, which change only with a migration. To pause one feature for some roles right now, use <button type="button" className="font-bold underline" onClick={() => onOpenTab("maintenance")}>Maintenance &amp; isolation</button>.</p>
        <div className="overflow-x-auto">
          <table className="admin-table w-full text-sm">
            <thead><tr><th>Workspace</th>{ROLE_ORDER.map((role) => <th key={role} className="text-center">{roleNames[role]}</th>)}</tr></thead>
            <tbody>{areas.map((area) => <tr key={area.key}><td className="font-semibold">{area.label}</td>{ROLE_ORDER.map((role) => <td key={role} className="text-center" aria-label={`${roleNames[role]}: ${area.roles[role] ? "yes" : "no"}`}>{area.roles[role] ? "✓" : "–"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Admin menu pages">
        <div className="overflow-x-auto">
          <table className="admin-table w-full text-sm">
            <thead><tr><th>Page</th><th>Who sees it</th></tr></thead>
            <tbody>{pages.map((page) => <tr key={page.key}><td className="font-semibold">{page.label}</td><td className="text-fg-muted">{page.need}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>
      <Panel title="What each role is for">
        <ul className="divide-y divide-line text-sm">{ROLE_RULES.map((rule) => <li key={rule.role} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]"><span className="font-bold">{roleNames[rule.role]}</span><span className="text-fg-muted">{rule.summary}</span></li>)}</ul>
      </Panel>
      <Panel title="Admin permissions (editable)">
        <p className="mb-4 text-sm text-fg-muted">The one part of role access you can change here: tick what each Admin may do. Changes are checked, confirmed and written to the audit log.</p>
        {problem ? problemBox(problem) : <PermissionMatrix admins={admins} onSaved={loadAdmins} />}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------- Emergency switch-off (pop-up)
export function EmergencyOff({ state, onDone }: { state: ReturnType<typeof useSwitches>; onDone: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    const result = await emergencyOff()
    setBusy(false)
    if (result.error || !result.data) return toast.error("Not switched off", result.error)
    const done = [result.data.maintenance ? "maintenance" : "", result.data.features.length ? `${result.data.features.length} feature pause(s)` : "", result.data.switches.length ? `${result.data.switches.length} switch(es)` : ""].filter(Boolean)
    toast.success("Everything is back to normal", done.length ? `Switched off: ${done.join(", ")}` : "Nothing was on")
    setOpen(false)
    await state.reload()
    onDone()
  }
  return (
    <>
      <button type="button" className={dangerButton} onClick={() => setOpen(true)}>Switch everything off</button>
      {open ? (
        <Modal title="Switch every control off?" size="md" onClose={busy ? () => undefined : () => setOpen(false)} footer={
          <>
            <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className={dangerButton} disabled={busy} onClick={() => void run()}>{busy ? "Switching off..." : "Switch everything off"}</button>
          </>
        }>
          <p className="text-sm text-fg-muted">This puts the system back to normal in one step: maintenance mode off, every feature pause off, registration open and email resumed. It does not sign anybody out, does not touch accounts or data, and is written to the activity log. Safe to press when nothing is on.</p>
        </Modal>
      ) : null}
    </>
  )
}
