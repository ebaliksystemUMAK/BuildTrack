import { useEffect, useState, type FormEvent } from "react"
import { PageHead, buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { useConfirm } from "../../lib/confirm"
import { captureStamp } from "../../lib/photoStamp"
import { detailsForm, detailsPatch, statusNeedsConfirm, validateDetails, type DetailsErrors, type DetailsForm } from "../../lib/projectManagerModel"
import { useAssignablePeople } from "../../lib/projectManagers"
import { disciplineLabels, phaseLabels, statusLabels, type Project, type ProjectPhase, type ProjectStatus } from "../../lib/projects"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

const field = "mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-fg disabled:opacity-70"
const legend = "px-1 text-xs font-bold uppercase tracking-wider text-brand-text"

// Project details a Project Manager keeps current: dates, location, client, phase, status and the Engineer / Foreman in charge.
// Code, name, scope of work and archiving stay with Admins (the database refuses them: guard_project_manager_edit).
export default function PmDetails(_: PmPageProps) {
  const pm = usePmProject()
  const toast = useToast()
  const confirm = useConfirm()
  const { people } = useAssignablePeople(pm.projectId)
  const [saved, setSaved] = useState<Project | null>(null)
  const [form, setForm] = useState<DetailsForm | null>(null)
  const [errors, setErrors] = useState<DetailsErrors>({})
  const [failure, setFailure] = useState("")
  const [busy, setBusy] = useState(false)
  const base = saved ?? pm.project

  useEffect(() => {
    setSaved(null)
    setForm(pm.project ? detailsForm(pm.project) : null)
  }, [pm.project])

  if (!base || !form) return <div className="admin-page"><SkeletonCardGrid count={2} label="Loading project details" /></div>
  const readOnly = !pm.canManage || busy
  const set = (patch: Partial<DetailsForm>) => setForm({ ...form, ...patch })
  const errorText = (key: keyof DetailsForm) => (errors[key] ? <span className="mt-1 block text-xs font-normal text-danger-fg">{errors[key]}</span> : null)
  const engineers = people.filter((person) => person.role === "engineer")
  const foremen = people.filter((person) => person.role === "foreman")
  const changes = detailsPatch(form, base)
  const dirty = Object.keys(changes).length > 0

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const found = validateDetails(form)
    setErrors(found)
    if (Object.keys(found).length || !dirty) return
    if (statusNeedsConfirm(base.status, form.status)) {
      const verb = form.status === "completed" ? "Mark as completed" : form.status === "cancelled" ? "Cancel this project" : "Put this project on hold"
      if (!(await confirm({ title: `${verb}?`, message: `${base.code} changes from ${statusLabels[base.status]} to ${statusLabels[form.status]} for everyone assigned to it. You can change it back later.`, confirmLabel: verb, tone: form.status === "cancelled" ? "danger" : undefined }))) return
    }
    setBusy(true)
    setFailure("")
    const { data, error } = await supabase.from("projects").update(changes).eq("id", base.id).select("*")
    setBusy(false)
    if (error) return setFailure(/in charge must be/i.test(error.message) ? error.message.replace(/^.*?(The (engineer|foreman) in charge[^"]*).*$/i, "$1") : error.message)
    if (!data?.length) return setFailure("Nothing was saved. You may no longer manage this project.")
    const next = data[0] as Project
    setSaved(next)
    setForm(detailsForm(next))
    toast.success("Project details saved", changes.lead_engineer_id || changes.lead_foreman_id ? "The person in charge joins the team automatically. Give them blueprint access in Team & work access." : undefined)
  }

  const fillFromHere = async () => {
    const here = await captureStamp(10_000)
    if (here.lat === undefined || here.lng === undefined) return toast.error("Could not read your location", "Allow location access for this site, or type the coordinates.")
    set({ site_lat: here.lat.toFixed(6), site_lng: here.lng.toFixed(6) })
    toast.success("Location filled in", `Accuracy about ${Math.round(here.accuracy_m ?? 0)} m. Save to keep it.`)
  }

  return (
    <div className="admin-page">
      <PageHead eyebrow={`${base.code} • Project details`} title="Project details" description="Dates, location, client details, status and the Engineer and Foreman in charge. Everyone on the project sees the changes at once." />
      {pm.note ? <p role="status" className="mb-4 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg">{pm.note}</p> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <form className="space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-[var(--bt-shadow)] sm:p-5" noValidate onSubmit={(event) => void save(event)}>
          {failure ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{failure}</p> : null}
          <fieldset className="space-y-3 rounded-xl border border-line p-3" disabled={readOnly}>
            <legend className={legend}>Schedule and status</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Status
                <select className={field} value={form.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
                  {(Object.keys(statusLabels) as ProjectStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">Phase
                <select className={field} value={form.phase} onChange={(e) => set({ phase: e.target.value as ProjectPhase })}>
                  {(Object.keys(phaseLabels) as ProjectPhase[]).map((phase) => <option key={phase} value={phase}>{phaseLabels[phase]}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">Start date<input className={field} type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Target completion<input className={field} type="date" value={form.end_date} onChange={(e) => set({ end_date: e.target.value })} />{errorText("end_date")}</label>
            </div>
          </fieldset>
          <fieldset className="space-y-3 rounded-xl border border-line p-3" disabled={readOnly}>
            <legend className={legend}>Client and location</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Client<input className={field} maxLength={120} value={form.client_name} onChange={(e) => set({ client_name: e.target.value })} />{errorText("client_name")}</label>
              <label className="block text-sm font-semibold">Location<input className={field} maxLength={200} value={form.location} onChange={(e) => set({ location: e.target.value })} />{errorText("location")}</label>
            </div>
            <label className="block text-sm font-semibold">Description<textarea className={field} rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} />{errorText("description")}</label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm font-semibold">Site latitude<input className={field} inputMode="decimal" placeholder="14.676000" value={form.site_lat} onChange={(e) => set({ site_lat: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Site longitude<input className={field} inputMode="decimal" placeholder="120.983000" value={form.site_lng} onChange={(e) => set({ site_lng: e.target.value })} /></label>
              <label className="block text-sm font-semibold">Radius (metres)<input className={field} inputMode="numeric" value={form.site_radius_m} onChange={(e) => set({ site_radius_m: e.target.value })} /></label>
            </div>
            {errorText("site_lat")}{errorText("site_radius_m")}
            <p className="text-xs text-fg-muted">Site photos are compared with this point and radius and marked "At the site" or "Away from site". They are never blocked.</p>
            {!readOnly ? <button type="button" className="min-h-8 text-sm font-bold text-brand-text hover:underline" onClick={() => void fillFromHere()}>Use my current location</button> : null}
          </fieldset>
          <fieldset className="space-y-3 rounded-xl border border-line p-3" disabled={readOnly}>
            <legend className={legend}>In charge on site</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold">Engineer in charge
                <select className={field} value={form.lead_engineer_id} onChange={(e) => set({ lead_engineer_id: e.target.value })}>
                  <option value="">Not assigned</option>
                  {form.lead_engineer_id && !engineers.some((person) => person.id === form.lead_engineer_id) ? <option value={form.lead_engineer_id}>Current Engineer in charge</option> : null}
                  {engineers.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold">Foreman in charge
                <select className={field} value={form.lead_foreman_id} onChange={(e) => set({ lead_foreman_id: e.target.value })}>
                  <option value="">Not assigned</option>
                  {form.lead_foreman_id && !foremen.some((person) => person.id === form.lead_foreman_id) ? <option value={form.lead_foreman_id}>Current Foreman in charge</option> : null}
                  {foremen.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-fg-muted">They join the project team automatically. Choose their blueprint types in Team & work access.</p>
          </fieldset>
          {pm.canManage ? (
            <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:justify-end">
              <button type="button" className={buttonSecondary} disabled={!dirty || busy} onClick={() => { setForm(detailsForm(base)); setErrors({}); setFailure("") }}>Discard changes</button>
              <button type="submit" className={buttonPrimary} disabled={!dirty || busy}>{busy ? "Saving..." : "Save details"}</button>
            </div>
          ) : null}
        </form>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--bt-shadow)]">
            <h2 className="text-sm font-extrabold uppercase tracking-wider text-fg-muted">Set by Admins</h2>
            <dl className="mt-2 divide-y divide-line text-sm">
              <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Code</dt><dd className="font-semibold text-fg">{base.code}</dd></div>
              <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Name</dt><dd className="text-right font-semibold text-fg">{base.name}</dd></div>
              <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Scope of work</dt><dd className="text-right font-semibold text-fg">{(base.disciplines ?? []).map((d) => disciplineLabels[d]).join(", ") || "Not set"}</dd></div>
              <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Person in charge</dt><dd className="text-right font-semibold text-fg">{base.manager_name || "Not set"}</dd></div>
              <div className="flex justify-between gap-3 py-2"><dt className="text-fg-muted">Archived</dt><dd className="font-semibold text-fg">{base.archived_at ? new Date(base.archived_at).toLocaleDateString("en-PH") : "No"}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-fg-muted">To change these, ask an Admin (Control center, All projects).</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
