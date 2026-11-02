import { useCallback, useEffect, useState } from "react"
import Modal from "../../components/Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { Skeleton } from "../../components/ui/Skeleton"
import { formatDate, formatTime } from "../../lib/admin"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { useProjects } from "../../lib/projects"
import { forceLogout, loadSiteControls, previewForceLogout, saveFeatureLock, saveMaintenance, type FeatureState, type SiteControls } from "../../lib/siteControls"
import {
  AUDIENCE_ROLES, FORCE_LOGOUT_LIMITS, MAINTENANCE_KEEPS, MAINTENANCE_PAUSES, audienceLabels, confirmPhrase, featureLabels, forceLogoutProblem, maintenanceProblem, manilaLocalToIso,
  type AudienceRole, type FeatureKey, type ForceLogoutPreview,
} from "../../lib/siteStatusModel"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

const label = "block text-xs font-bold uppercase tracking-wider text-fg-muted"
const when = (iso: string | null) => (iso ? `${formatDate(iso)} ${formatTime(iso)}` : "")
const setupNote = (message: string) => <p role="status" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">{message}</p>

// ---------------------------------------------------------------- maintenance
export function MaintenancePanel({ state, onChanged }: { state: SiteControls["maintenance"]; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [message, setMessage] = useState(state.message)
  const [returns, setReturns] = useState("")
  const [busy, setBusy] = useState(false)
  const problem = maintenanceProblem({ message, returnsLocal: returns })

  const apply = async (on: boolean) => {
    if (on && problem) return toast.error("Not switched on", problem)
    const ok = await confirm({
      title: on ? (state.on ? "Update the maintenance notice?" : "Switch maintenance on?") : "Switch maintenance off?",
      message: on ? "Engineers, Foremen, Clients, Project Managers and basic users can still look at everything but cannot save changes until you switch it off. Admins, Super Admins, biometric devices and scheduled jobs are not affected. Saved offline items wait and send afterwards." : "Everyone can save changes again.",
      confirmLabel: on ? (state.on ? "Update" : "Switch on") : "Switch off", tone: on ? "danger" : undefined,
    })
    if (!ok) return
    setBusy(true)
    const result = await saveMaintenance({ on, message, returnsAt: returns ? manilaLocalToIso(returns) : null })
    setBusy(false)
    if (result.error || !result.data) return toast.error("Not saved", result.error)
    toast.success(on ? "Maintenance is on" : "Maintenance is off", result.data.changed ? undefined : "Nothing changed.")
    onChanged()
  }

  return (
    <Panel title="Maintenance mode (read-only)" action={<span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${state.on ? "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100" : "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100"}`}>{state.on ? "ON" : "Off"}</span>}>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-bold">What is paused</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{MAINTENANCE_PAUSES.map((line) => <li key={line}>{line}</li>)}</ul>
          <p className="text-sm font-bold">What keeps working</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-fg-muted">{MAINTENANCE_KEEPS.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
        <div className="space-y-3">
          <label className={label}>Message people will see
            <textarea className={`${inputClass} mt-1 min-h-24 normal-case`} value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder="For example: We are upgrading the database." />
          </label>
          <label className={label}>Expected back (optional, Manila time)
            <input type="datetime-local" className={`${inputClass} mt-1 !w-auto normal-case`} value={returns} onChange={(event) => setReturns(event.target.value)} />
          </label>
          <p className="text-xs text-fg-muted">The return time is only information. Maintenance stays on until you switch it off.</p>
          {problem && (message || returns) ? <p className="text-xs text-fg-muted">{problem}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void apply(true)}>{state.on ? "Update notice" : "Switch maintenance on"}</button>
            {state.on ? <button type="button" className={buttonSecondary} disabled={busy} onClick={() => void apply(false)}>Switch off</button> : null}
          </div>
          {state.updated_at ? <p className="text-xs text-fg-muted">Last changed {when(state.updated_at)}{state.updated_by ? ` by ${state.updated_by}` : ""}.</p> : null}
        </div>
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------- feature isolation
export function FeatureRow({ feature, onChanged }: { feature: FeatureState; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [audiences, setAudiences] = useState<AudienceRole[]>(feature.audiences)
  const [message, setMessage] = useState(feature.message)
  const [busy, setBusy] = useState(false)
  const apply = async (locked: boolean) => {
    if (locked && message.trim().length < 5) return toast.error("Not locked", "Write the message people will see (at least 5 characters).")
    if (locked && audiences.length === 0) return toast.error("Not locked", "Choose who is affected.")
    const ok = await confirm({ title: locked ? `Pause ${feature.label}?` : `Switch ${feature.label} back on?`, message: locked ? `${audiences.map((role) => audienceLabels[role]).join(", ")} cannot save changes in this feature until you switch it back on. Everything else keeps working. Admins and Super Admins are never affected.` : "Everyone it was paused for can save again.", confirmLabel: locked ? "Pause it" : "Switch back on", tone: locked ? "danger" : undefined })
    if (!ok) return
    setBusy(true)
    const result = await saveFeatureLock({ feature: feature.feature, locked, audiences, message })
    setBusy(false)
    if (result.error) return toast.error("Not saved", result.error)
    toast.success(locked ? `${feature.label} is paused` : `${feature.label} is back on`)
    onChanged()
  }
  const toggle = (role: AudienceRole) => setAudiences((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role]))
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{featureLabels[feature.feature as FeatureKey] ?? feature.label}</strong>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${feature.locked ? "bg-sky-100 text-sky-950 dark:bg-sky-900/40 dark:text-sky-100" : "bg-surface-muted text-fg-muted"}`}>{feature.locked ? "Paused" : "On"}</span>
      </div>
      <fieldset><legend className="sr-only">Who is affected by {feature.label}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">{AUDIENCE_ROLES.map((role) => <label key={role} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[#9E1F93]" checked={audiences.includes(role)} onChange={() => toggle(role)} />{audienceLabels[role]}</label>)}</div>
      </fieldset>
      <label className={label}>Message people will see
        <input className={`${inputClass} mt-1 normal-case`} value={message} maxLength={500} onChange={(event) => setMessage(event.target.value)} placeholder="Why it is paused and when it returns" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void apply(true)}>{feature.locked ? "Update pause" : "Pause for these roles"}</button>
        {feature.locked ? <button type="button" className={buttonSecondary} disabled={busy} onClick={() => void apply(false)}>Switch back on</button> : null}
      </div>
    </li>
  )
}

export function FeaturePanel({ features, onChanged }: { features: FeatureState[]; onChanged: () => void }) {
  return (
    <Panel title="Feature isolation">
      <p className="mb-3 text-sm text-fg-muted">Pause one feature for the roles you choose. Only that feature's own records are affected; shared work (pins and progress, notifications) and every other feature keep working. Admins and Super Admins are never affected, and neither are biometric devices.</p>
      <ul className="divide-y divide-line rounded-xl border border-line">{features.map((feature) => <FeatureRow key={`${feature.feature}-${feature.locked}-${feature.updated_at}`} feature={feature} onChanged={onChanged} />)}</ul>
    </Panel>
  )
}

// ---------------------------------------------------------------- forced logout
export function ForceLogoutPanel({ last }: { last: SiteControls["last_forced_logout"] }) {
  const toast = useToast()
  const { projects } = useProjects()
  const [roles, setRoles] = useState<AudienceRole[]>([])
  const [project, setProject] = useState("")
  const [preview, setPreview] = useState<ForceLogoutPreview | null>(null)
  const [reason, setReason] = useState("")
  const [phrase, setPhrase] = useState("")
  const [asking, setAsking] = useState(false)
  const [problem, setProblem] = useState("")
  const [setup, setSetup] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [busy, setBusy] = useState(false)

  const reset = () => { setPreview(null); setPhrase(""); setProblem("") }
  const toggle = (role: AudienceRole) => { setRoles((current) => (current.includes(role) ? current.filter((item) => item !== role) : [...current, role])); reset() }

  const ask = async () => {
    if (!roles.length) return toast.error("Choose who to sign out", "Pick at least one role.")
    setAsking(true); setProblem("")
    const result = await previewForceLogout(roles, project || null)
    setAsking(false)
    if (result.error || !result.data) { setProblem(result.error); setSetup(result.setup); setPreview(null); return }
    setPreview(result.data); setPhrase("")
  }

  const check = forceLogoutProblem({ preview, phrase, reason })
  const run = async () => {
    if (!preview || check) return
    setBusy(true)
    const result = await forceLogout({ roles, project: project || null, expected: preview.total, confirm: phrase, reason })
    setBusy(false)
    if (result.error || !result.data) { toast.error("Nobody was signed out", result.error); setPreview(null); setPhrase(""); return } // the count may have changed: preview again
    setDialog(false); reset(); setReason("")
    toast.success(`Signed out ${result.data.accounts} account${result.data.accounts === 1 ? "" : "s"}`, `${result.data.sessions_removed} saved sign-in${result.data.sessions_removed === 1 ? "" : "s"} removed. The app signs them out within about 30 seconds.`)
  }

  return (
    <Panel title="Forced logout">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <fieldset><legend className={label}>1. Who</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{AUDIENCE_ROLES.map((role) => <label key={role} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" className="accent-[#9E1F93]" checked={roles.includes(role)} onChange={() => toggle(role)} />{audienceLabels[role]}</label>)}</div>
          </fieldset>
          <label className={label}>Only people on this project (optional)
            <select className={`${inputClass} mt-1 !w-auto normal-case`} value={project} onChange={(event) => { setProject(event.target.value); reset() }}>
              <option value="">Every project</option>
              {projects.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
          </label>
          <button type="button" className={buttonSecondary} disabled={asking} onClick={() => void ask()}>{asking ? "Counting..." : "2. Preview who is affected"}</button>
          {problem ? (setup ? setupNote(problem) : <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{problem}</p>) : null}
          {preview ? (
            <div className="rounded-xl border border-line p-4 text-sm" aria-label="Who is affected">
              <p className="text-lg font-extrabold tabular-nums">{preview.total} account{preview.total === 1 ? "" : "s"} would be signed out</p>
              <p className="mt-1 text-fg-muted">{Object.entries(preview.by_role).map(([role, count]) => `${count} ${audienceLabels[role as AudienceRole] ?? role}`).join(", ") || "None"}. {preview.signed_in_last_24h} signed in during the last 24 hours.</p>
              {preview.cooldown_seconds > 0 ? <p className="mt-1 text-danger-fg">A forced logout was done a moment ago. Wait {Math.ceil(preview.cooldown_seconds / 60)} minute(s).</p> : null}
              <label className={`${label} mt-3`}>3. Reason (kept in the audit log)
                <input className={`${inputClass} mt-1 normal-case`} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="For example: lost phone, security review" />
              </label>
              <button type="button" className={`${buttonPrimary} mt-3`} disabled={preview.total === 0 || preview.cooldown_seconds > 0 || reason.replace(/\s+/g, " ").trim().length < 5} onClick={() => { setPhrase(""); setDialog(true) }}>4. Sign them out...</button>
            </div>
          ) : null}
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-bold">What this does, and does not do</p>
          <ul className="list-disc space-y-1 pl-5 text-fg-muted">{FORCE_LOGOUT_LIMITS.map((line) => <li key={line}>{line}</li>)}</ul>
          {last ? <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted">Last forced logout: {when(last.at)}{last.by ? ` by ${last.by}` : ""}, {last.details.accounts ?? "?"} account(s){last.details.reason ? `, reason: ${last.details.reason}` : ""}.</p> : null}
        </div>
      </div>

      {dialog && preview ? (
        <Modal
          title={`Sign out ${preview.total} account${preview.total === 1 ? "" : "s"}?`}
          description="This cannot be undone, but they can sign in again straight away."
          size="md"
          onClose={() => !busy && setDialog(false)}
          footer={
            <>
              <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setDialog(false)}>Cancel</button>
              <button type="button" className={buttonPrimary} disabled={busy || Boolean(check)} onClick={() => void run()}>{busy ? "Signing out..." : `Sign out ${preview.total}`}</button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>{Object.entries(preview.by_role).map(([role, count]) => `${count} ${audienceLabels[role as AudienceRole] ?? role}`).join(", ")}{project ? " on the chosen project" : " on every project"}. Reason: <strong>{reason.replace(/\s+/g, " ").trim()}</strong></p>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">{FORCE_LOGOUT_LIMITS.map((line) => <li key={line}>{line}</li>)}</ul>
            <label className={label}>To confirm, type <code className="rounded bg-surface-muted px-1.5 py-0.5 normal-case">{confirmPhrase(preview.total)}</code>
              <input className={`${inputClass} mt-1 normal-case`} value={phrase} autoComplete="off" aria-label="Confirmation phrase" onChange={(event) => setPhrase(event.target.value)} />
            </label>
            {check && phrase ? <p className="text-xs text-fg-muted">{check}</p> : null}
          </div>
        </Modal>
      ) : null}
    </Panel>
  )
}

export default function SiteControlsPage({ embedded = false, part = "all", refreshKey = 0 }: AdminPageProps & { embedded?: boolean; part?: "all" | "maintenance" | "logout"; refreshKey?: number }) {
  const { profile } = useAuth()
  const isSuper = profile?.role === "super_admin"
  const [controls, setControls] = useState<SiteControls | null>(null)
  const [problem, setProblem] = useState("")
  const [setup, setSetup] = useState(false)
  const load = useCallback(async () => {
    const result = await loadSiteControls()
    setProblem(result.error); setSetup(result.setup)
    if (result.data) setControls(result.data)
  }, [])
  useEffect(() => {
    if (isSuper) void load()
  }, [isSuper, load, refreshKey])

  return (
    <div className={embedded ? "space-y-4" : "admin-page"}>
      {embedded ? null : <PageIntro eyebrow="Security" title="Site controls" description="Pause saving for everyone but administrators during maintenance, pause one feature for chosen roles, or sign chosen non-admin accounts out. Everything starts off. Admins, Super Admins and biometric devices are never restricted." />}
      {!isSuper ? <Panel><p className="text-sm text-fg-muted">Only a Super Admin can open the site controls.</p></Panel> : problem ? (
        <Panel>{setup ? setupNote(problem) : <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{problem}</p>}</Panel>
      ) : !controls ? (
        <Panel><div className="space-y-3" role="status" aria-label="Loading the site controls"><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" /></div></Panel>
      ) : (
        <>
          {part !== "logout" ? <MaintenancePanel state={controls.maintenance} onChanged={() => void load()} /> : null}
          {part !== "logout" ? <FeaturePanel features={controls.features} onChanged={() => void load()} /> : null}
          {part !== "maintenance" ? <ForceLogoutPanel last={controls.last_forced_logout} /> : null}
        </>
      )}
    </div>
  )
}
