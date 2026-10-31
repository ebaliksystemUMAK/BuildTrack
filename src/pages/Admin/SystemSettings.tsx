import { useEffect, useState, type ReactNode } from "react"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { dayNames, defaultSettings, settingKeys, useSettings, type Standard } from "../../lib/settings"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel } from "./AdminShell"
import PhotoAccountRules from "./PhotoAccountRules"
import type { AdminPageProps } from "./types"

type SettingsTab = "quality" | "hours" | "standards" | "access" | "photos"
const tabs: Array<{ key: SettingsTab; label: string }> = [
  { key: "quality", label: "Quality scoring" },
  { key: "hours", label: "Working hours" },
  { key: "standards", label: "Standards and codes" },
  { key: "access", label: "Access review" },
  { key: "photos", label: "Site photos" },
]

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "")

// A settings card: its own Save button, shown only when something changed.
function Card({ title, description, updated, dirty, busy, canEdit, error, onSave, onReset, children }: { title: string; description: string; updated?: string; dirty: boolean; busy: boolean; canEdit: boolean; error: string; onSave: () => void; onReset: () => void; children: ReactNode }) {
  return (
    <Panel title={title}>
      <p className="mb-4 text-sm text-fg-muted">{description}</p>
      <div className="space-y-4">{children}</div>
      {error ? <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-xs text-fg-muted">{updated ? `Last changed ${when(updated)}` : "Using the default"}</span>
        {canEdit ? (
          <span className="flex gap-2">
            <button type="button" className={buttonSecondary} disabled={!dirty || busy} onClick={onReset}>Reset</button>
            <button type="button" className={buttonPrimary} disabled={!dirty || busy} onClick={onSave}>{busy ? "Saving..." : "Save"}</button>
          </span>
        ) : null}
      </div>
    </Panel>
  )
}

export default function SystemSettings(_: AdminPageProps) {
  const { profile, can } = useAuth()
  const { settings, rows, loading, error, save } = useSettings()
  const toast = useToast()
  const confirm = useConfirm()
  const canEdit = profile?.role === "super_admin"
  // Site photos: also Admins the Super Admin gave the Site photos permission (photos.manage); the list is visible with View users too.
  const canPhotos = can("photos.manage")
  const canSeeAccounts = canPhotos || can("users.view")
  const [tab, setTab] = useState<SettingsTab>("quality")
  const [photosVisited, setPhotosVisited] = useState(false)
  const [photoAccountsDirty, setPhotoAccountsDirty] = useState(false)
  const updatedOf = (key: string) => rows.find((row) => row.key === key)?.updated_at

  const [threshold, setThreshold] = useState(String(defaultSettings.threshold))
  const [weights, setWeights] = useState({ critical: "5", major: "3", minor: "1" })
  const [hours, setHours] = useState({ start: "07:00", end: "17:00", days: [1, 2, 3, 4, 5, 6] })
  const [standards, setStandards] = useState<Standard[]>([])
  const [inactive, setInactive] = useState("60")
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const load = () => {
    setThreshold(String(settings.threshold))
    setWeights({ critical: String(settings.weights.critical), major: String(settings.weights.major), minor: String(settings.weights.minor) })
    setHours({ start: settings.hours.start, end: settings.hours.end, days: settings.hours.days })
    setStandards(settings.standards)
    setInactive(String(settings.inactiveDays))
    setErrors({})
  }
  useEffect(() => {
    if (!loading) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows])

  const commit = async (card: string, key: string, value: unknown, confirmText?: string) => {
    if (confirmText && !(await confirm({ title: "Change this setting?", message: confirmText, confirmLabel: "Save" }))) return
    setBusy(card)
    const problem = await save(key, value)
    setBusy(null)
    setErrors((current) => ({ ...current, [card]: problem ?? "" }))
    if (problem) toast.error("Not saved", problem)
    else toast.success("Setting saved")
  }

  const wantsThreshold = Number(threshold)
  const w = { critical: Number(weights.critical), major: Number(weights.major), minor: Number(weights.minor) }
  const dirty = {
    qa: wantsThreshold !== settings.threshold || w.critical !== settings.weights.critical || w.major !== settings.weights.major || w.minor !== settings.weights.minor,
    hours: hours.start !== settings.hours.start || hours.end !== settings.hours.end || hours.days.join() !== settings.hours.days.join(),
    standards: JSON.stringify(standards) !== JSON.stringify(settings.standards),
    inactive: Number(inactive) !== settings.inactiveDays,
  }

  return (
    <div className="admin-page">
      <PageIntro eyebrow="Administration" title="System settings" description="Settings the whole product shares. Everyone reads them; only the Super Admin changes them (Site photos also an Admin with the Site photos permission), and every change is written to the audit log." />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="System settings sections">
        {tabs.map((item) => {
          const unsaved = item.key === "quality" ? dirty.qa : item.key === "access" ? dirty.inactive : item.key === "photos" ? photoAccountsDirty : dirty[item.key]
          return (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => { if (item.key === "photos") setPhotosVisited(true); setTab(item.key) }}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition ${tab === item.key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted"}`}>
              {item.label}
              {unsaved && !loading ? <><span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" /><span className="sr-only">(unsaved changes)</span></> : null}
            </button>
          )
        })}
      </div>
      {tab === "photos" ? (!canPhotos ? <p className="mb-4 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg-muted">You can read these settings. Only the Super Admin or an Admin with the Site photos permission can change them.</p> : null)
        : !canEdit ? <p className="mb-4 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg-muted">You can read the settings. Only the Super Admin can change them.</p> : null}
      {error ? <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p> : null}
      {loading ? (
        <SkeletonCardGrid count={1} label="Loading settings" />
      ) : (
        <div role="tabpanel" aria-label={tabs.find((item) => item.key === tab)?.label} className="w-full min-w-0">
          {tab === "quality" ? <Card title="Quality scoring" description="Used by inspections: the pass mark and how much each kind of QC check counts." updated={updatedOf(settingKeys.threshold)} dirty={dirty.qa} busy={busy === "qa"} canEdit={canEdit} error={errors.qa ?? ""} onReset={load}
            onSave={async () => {
              if (wantsThreshold !== settings.threshold) await commit("qa", settingKeys.threshold, wantsThreshold, `The pass mark changes from ${settings.threshold}% to ${wantsThreshold}%. It applies to every new inspection.`)
              if (w.critical !== settings.weights.critical || w.major !== settings.weights.major || w.minor !== settings.weights.minor) await commit("qa", settingKeys.weights, w)
            }}>
            <label className="block text-sm font-semibold">Pass mark (percent)
              <input className={`${inputClass} mt-1 max-w-[10rem]`} inputMode="numeric" value={threshold} disabled={!canEdit} onChange={(event) => setThreshold(event.target.value)} />
              <span className="mt-1 block text-xs font-normal text-fg-muted">A whole number from 50 to 100. An inspection also fails if any critical item fails.</span>
            </label>
            <div>
              <p className="mb-1 text-sm font-semibold">Weight of each item</p>
              <div className="grid grid-cols-3 gap-3">
                {(["critical", "major", "minor"] as const).map((key) => (
                  <label key={key} className="block text-xs font-bold uppercase tracking-wider text-fg-muted">{key}
                    <input className={`${inputClass} mt-1 normal-case`} inputMode="numeric" value={weights[key]} disabled={!canEdit} onChange={(event) => setWeights((current) => ({ ...current, [key]: event.target.value }))} />
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-fg-muted">Whole numbers from 1 to 20. A critical item must weigh at least as much as a major one, and a major at least as much as a minor one.</p>
            </div>
          </Card> : null}

          {tab === "hours" ? <Card title="Working hours" description="Normal site hours. Used for attendance and late-report rules." updated={updatedOf(settingKeys.hours)} dirty={dirty.hours} busy={busy === "hours"} canEdit={canEdit} error={errors.hours ?? ""} onReset={load} onSave={() => void commit("hours", settingKeys.hours, hours)}>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-semibold">Start<input type="time" className={`${inputClass} mt-1`} value={hours.start} disabled={!canEdit} onChange={(event) => setHours((current) => ({ ...current, start: event.target.value }))} /></label>
              <label className="block text-sm font-semibold">End<input type="time" className={`${inputClass} mt-1`} value={hours.end} disabled={!canEdit} onChange={(event) => setHours((current) => ({ ...current, end: event.target.value }))} /></label>
            </div>
            <fieldset>
              <legend className="mb-1 text-sm font-semibold">Working days</legend>
              <div className="flex flex-wrap gap-1.5">
                {dayNames.map((name, index) => {
                  const day = index + 1
                  const on = hours.days.includes(day)
                  return (
                    <button key={name} type="button" aria-pressed={on} disabled={!canEdit} onClick={() => setHours((current) => ({ ...current, days: (on ? current.days.filter((d) => d !== day) : [...current.days, day]).sort((a, b) => a - b) }))} className={`h-9 w-12 rounded-lg border text-sm font-bold transition disabled:opacity-60 ${on ? "border-brand bg-brand text-white" : "border-line hover:bg-surface-muted"}`}>{name}</button>
                  )
                })}
              </div>
            </fieldset>
          </Card> : null}

          {tab === "standards" ? <Card title="Standards and codes" description="Reference catalog, including cement, masonry and roofing standards. Include the edition, and the official source link (https) where it is documented: QC checklists show it as the documentation of what they cite. Applicability and exact clauses must be confirmed by the project Engineer. Up to 30." updated={updatedOf(settingKeys.standards)} dirty={dirty.standards} busy={busy === "standards"} canEdit={canEdit} error={errors.standards ?? ""} onReset={load} onSave={() => void commit("standards", settingKeys.standards, standards.map((item) => ({ code: item.code.trim(), title: item.title.trim(), ...(item.source?.trim() ? { source: item.source.trim() } : {}) })))}>
            {standards.length === 0 ? <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-fg-muted">No standards yet.</p> : null}
            <ul className="space-y-2">
              {standards.map((item, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
                  <input className={inputClass} aria-label={`Code ${index + 1}`} placeholder="Code" maxLength={40} value={item.code} disabled={!canEdit} onChange={(event) => setStandards((current) => current.map((row, i) => (i === index ? { ...row, code: event.target.value } : row)))} />
                  <input className={`${inputClass} col-start-1 sm:col-start-auto`} aria-label={`Title ${index + 1}`} placeholder="Title" maxLength={120} value={item.title} disabled={!canEdit} onChange={(event) => setStandards((current) => current.map((row, i) => (i === index ? { ...row, title: event.target.value } : row)))} />
                  <input className={`${inputClass} col-start-1 sm:col-start-auto`} aria-label={`Official source ${index + 1}`} placeholder="Official source link (optional, https://)" type="url" inputMode="url" maxLength={300} value={item.source ?? ""} disabled={!canEdit} onChange={(event) => setStandards((current) => current.map((row, i) => (i === index ? { ...row, source: event.target.value } : row)))} />
                  {canEdit ? <button type="button" aria-label={`Remove standard ${index + 1}`} className="col-start-2 row-start-1 h-9 w-9 rounded-lg text-danger-fg hover:bg-danger-soft sm:col-start-auto sm:row-start-auto" onClick={() => setStandards((current) => current.filter((_, i) => i !== index))}>×</button> : <span className="hidden sm:block" />}
                </li>
              ))}
            </ul>
            {canEdit && standards.length < 30 ? <button type="button" className={buttonSecondary} onClick={() => setStandards((current) => [...current, { code: "", title: "" }])}>Add a standard</button> : null}
          </Card> : null}

          {tab === "access" ? <Card title="Access review" description="How many days without signing in before an account is listed on the Access review page." updated={updatedOf(settingKeys.inactiveDays)} dirty={dirty.inactive} busy={busy === "inactive"} canEdit={canEdit} error={errors.inactive ?? ""} onReset={load} onSave={() => void commit("inactive", settingKeys.inactiveDays, Number(inactive))}>
            <label className="block text-sm font-semibold">Days
              <input className={`${inputClass} mt-1 max-w-[10rem]`} inputMode="numeric" value={inactive} disabled={!canEdit} onChange={(event) => setInactive(event.target.value)} />
              <span className="mt-1 block text-xs font-normal text-fg-muted">A whole number from 14 to 365.</span>
            </label>
          </Card> : null}

          {photosVisited ? <div key="photo-account-rules" hidden={tab !== "photos"} className="w-full min-w-0"><PhotoAccountRules canEdit={canPhotos} canView={canSeeAccounts} companyAllows={settings.allowDeviceUpload} onDirtyChange={setPhotoAccountsDirty} /></div> : null}
        </div>
      )}
    </div>
  )
}
