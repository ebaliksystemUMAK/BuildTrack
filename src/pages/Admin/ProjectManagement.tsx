import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { AdminButton, PageIntro } from "./AdminShell"
import type { AdminPageProps } from "./types"
import Modal from "../../components/Modal"
import ProjectCard, { type CardPerson } from "../../components/ProjectCard"
import ProjectAccessDialog from "./ProjectAccessDialog"
import ProjectManagersDialog from "./ProjectManagersDialog"
import { setProjectArchived, useProjectManagers } from "../../lib/projectManagers"
import { slotsOf } from "../../lib/projectManagerModel"
import { buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import type { Profile } from "../../lib/auth"
import {
  disciplineLabels,
  phaseLabels,
  statusLabels,
  type Discipline,
  openProject,
  rememberProject,
  useProjects,
  type Project,
  type ProjectMember,
  type ProjectPhase,
  type ProjectStatus,
} from "../../lib/projects"
import { supabase } from "../../lib/supabase"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { useConfirm } from "../../lib/confirm"
import { useToast } from "../../lib/toast"
import { captureStamp } from "../../lib/photoStamp"

type Form = {
  id?: string
  code: string
  name: string
  location: string
  client_name: string
  description: string
  phase: ProjectPhase
  status: ProjectStatus
  start_date: string
  end_date: string
  manager_name: string
  lead_engineer_id: string
  lead_foreman_id: string
  disciplines: Discipline[]
  site_lat: string
  site_lng: string
  site_radius_m: string
}
type FieldErrors = Partial<Record<keyof Form, string>>

const emptyForm: Form = {
  code: "",
  name: "",
  location: "",
  client_name: "",
  description: "",
  phase: "plan_review",
  status: "planning",
  start_date: "",
  end_date: "",
  manager_name: "",
  lead_engineer_id: "",
  lead_foreman_id: "",
  disciplines: [],
  site_lat: "",
  site_lng: "",
  site_radius_m: "150",
}

const field = "mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-fg"
const legend = "px-1 text-xs font-bold uppercase tracking-wider text-brand-text"
const cardAction = "inline-flex min-h-8 items-center rounded-lg border border-line bg-surface px-2.5 text-xs font-bold text-fg shadow-sm hover:border-brand/50 hover:text-brand-text"

const displayName = (person: Profile | undefined) => person?.full_name || person?.email || "Unknown user"

function validate(form: Form): FieldErrors {
  const errors: FieldErrors = {}
  const code = form.code.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{1,29}$/.test(code)) errors.code = "2-30 characters: letters, numbers, dashes (e.g. VCB-024)."
  const name = form.name.trim()
  if (name.length < 2 || name.length > 120) errors.name = "Enter a name between 2 and 120 characters."
  if (form.location.length > 200) errors.location = "Keep the location under 200 characters."
  if (form.manager_name.length > 120) errors.manager_name = "Keep the name under 120 characters."
  if (form.client_name.length > 120) errors.client_name = "Keep the client name under 120 characters."
  if (form.start_date && form.end_date && form.end_date < form.start_date) errors.end_date = "End date must be on or after the start date."
  const lat = form.site_lat.trim()
  const lng = form.site_lng.trim()
  if (lat || lng) {
    if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) errors.site_lat = "Enter both the latitude and the longitude as numbers, or leave both empty."
    else if (Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180) errors.site_lat = "Latitude is between -90 and 90 and longitude between -180 and 180."
  }
  const radius = Number(form.site_radius_m)
  if (!Number.isInteger(radius) || radius < 20 || radius > 5000) errors.site_radius_m = "Use a whole number of metres from 20 to 5,000."
  return errors
}

function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "That project code is already used. Choose another."
  if (error.code === "42501") return "You do not have permission to do that. Ask a Super Admin for the Projects permission."
  if (error.code === "23514") return "One of the values is not allowed."
  if (/in charge must be/i.test(error.message)) return error.message.replace(/^.*?(The (engineer|foreman) in charge[^"]*).*$/i, "$1")
  if (/fetch|network/i.test(error.message)) return "Network problem. Check your connection and try again."
  return error.message
}

export default function ProjectManagement({ onNavigate }: AdminPageProps) {
  const { projects, loading, error, reload } = useProjects()
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [peopleError, setPeopleError] = useState("")
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [shareId, setShareId] = useState<string | null>(null)
  const [managersId, setManagersId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [managerPeople, setManagerPeople] = useState<Array<{ id: string; full_name: string | null; email: string }>>([])
  const { managers, reload: reloadManagers } = useProjectManagers("all")
  const toast = useToast()
  const confirm = useConfirm()
  // All success / failure messages go through toasts now.
  const setMessage = (m: { text: string; ok: boolean } | null) => {
    if (m) (m.ok ? toast.success(m.text) : toast.error(m.text))
  }
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">("all")
  const [sort, setSort] = useState<"newest" | "name" | "status">("newest")

  const loadPeople = useCallback(async () => {
    const [memberResult, profileResult, managerResult] = await Promise.all([
      supabase.from("project_members").select("project_id, user_id, member_role"),
      supabase.from("profiles").select("*").in("role", ["engineer", "foreman", "client"]).eq("status", "active"),
      supabase.from("profiles").select("id, full_name, email").eq("role", "project_manager").eq("status", "active").order("full_name"),
    ])
    if (memberResult.error || profileResult.error || managerResult.error) {
      setPeopleError("Could not load the team list. Check your connection and retry.")
      return
    }
    setPeopleError("")
    setMembers((memberResult.data as ProjectMember[] | null) ?? [])
    setPeople((profileResult.data as Profile[] | null) ?? [])
    setManagerPeople((managerResult.data as Array<{ id: string; full_name: string | null; email: string }> | null) ?? [])
  }, [])

  useEffect(() => {
    void loadPeople()
  }, [loadPeople])

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const cardPeople = (projectId: string): CardPerson[] =>
    members
      .filter((member) => member.project_id === projectId)
      .map((member) => ({ id: member.user_id, name: displayName(peopleById.get(member.user_id)) }))

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase()
    const list = projects.filter(
      (project) =>
        (showArchived || !project.archived_at) &&
        (statusFilter === "all" || project.status === statusFilter) &&
        (!text || `${project.code} ${project.name} ${project.location ?? ""} ${project.client_name ?? ""}`.toLowerCase().includes(text)),
    )
    if (sort === "name") return [...list].sort((a, b) => a.name.localeCompare(b.name))
    if (sort === "status") return [...list].sort((a, b) => a.status.localeCompare(b.status))
    return list
  }, [projects, query, statusFilter, sort, showArchived])

  const openForm = (project?: Project) => {
    setErrors({})
    setFormError("")
    setForm(
      project
        ? {
            id: project.id,
            code: project.code,
            name: project.name,
            location: project.location ?? "",
            client_name: project.client_name ?? "",
            description: project.description ?? "",
            phase: project.phase,
            status: project.status,
            start_date: project.start_date ?? "",
            end_date: project.end_date ?? "",
            manager_name: project.manager_name ?? "",
            lead_engineer_id: project.lead_engineer_id ?? "",
            lead_foreman_id: project.lead_foreman_id ?? "",
            disciplines: project.disciplines ?? [],
            site_lat: project.site_lat === null || project.site_lat === undefined ? "" : String(project.site_lat),
            site_lng: project.site_lng === null || project.site_lng === undefined ? "" : String(project.site_lng),
            site_radius_m: String(project.site_radius_m ?? 150),
          }
        : emptyForm,
    )
  }

  const saveProject = async (event: FormEvent) => {
    event.preventDefault()
    if (!form) return
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) return
    // Closing, pausing or cancelling a project changes what everyone assigned to it sees: ask first.
    const before = form.id ? projects.find((project) => project.id === form.id)?.status : undefined
    if (before && before !== form.status && (form.status === "completed" || form.status === "cancelled" || form.status === "on_hold")) {
      const verb = form.status === "completed" ? "Mark as completed" : form.status === "cancelled" ? "Cancel this project" : "Put this project on hold"
      if (!(await confirm({ title: `${verb}?`, message: `${form.code.trim().toUpperCase()} changes from ${statusLabels[before]} to ${statusLabels[form.status]} for everyone assigned to it. You can change it back later.`, confirmLabel: verb, tone: form.status === "cancelled" ? "danger" : undefined }))) return
    }
    setBusy(true)
    setFormError("")
    const row = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      location: form.location.trim() || null,
      client_name: form.client_name.trim() || null,
      description: form.description.trim() || null,
      phase: form.phase,
      status: form.status,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      manager_name: form.manager_name.trim() || null,
      lead_engineer_id: form.lead_engineer_id || null,
      lead_foreman_id: form.lead_foreman_id || null,
      disciplines: form.disciplines,
      site_lat: form.site_lat.trim() ? Number(form.site_lat) : null,
      site_lng: form.site_lng.trim() ? Number(form.site_lng) : null,
      site_radius_m: Number(form.site_radius_m),
    }
    const { data, error: saveError } = form.id
      ? await supabase.from("projects").update(row).eq("id", form.id).select("id")
      : await supabase.from("projects").insert(row).select("id")
    setBusy(false)
    if (saveError) return setFormError(dbMessage(saveError))
    if (!data?.length) return setFormError("Nothing was saved. You may not have permission to manage projects.")
    setMessage({ text: form.id ? "Project updated." : "Project created. Use Team & access to add its team and choose their blueprint types.", ok: true })
    setForm(null)
    await Promise.all([reload(), loadPeople()]) // the engineer / foreman in charge are added to the team automatically
  }

  const removeProject = async (project: Project) => {
    if (!(await confirm({ title: `Delete ${project.code}?`, message: `${project.name} and its plans, pins and team assignments are removed for everyone. This cannot be undone.`, confirmLabel: "Delete project", tone: "danger" }))) return
    const { data, error: deleteError } = await supabase.from("projects").delete().eq("id", project.id).select("id")
    if (deleteError) return setMessage({ text: dbMessage(deleteError), ok: false })
    if (!data?.length) return setMessage({ text: "Nothing was deleted. You may not have permission.", ok: false })
    setMessage({ text: "Project deleted.", ok: true })
    await Promise.all([reload(), loadPeople()])
  }

  // Archiving keeps every record; the project's Project Managers can still read it but not change it. Restoring undoes it.
  const archiveProject = async (project: Project, archived: boolean) => {
    if (!(await confirm(archived
      ? { title: `Archive ${project.code}?`, message: `${project.name} is kept with all its records. Its Project Managers can still read it but can no longer change it. You can restore it later.`, confirmLabel: "Archive project" }
      : { title: `Restore ${project.code}?`, message: "Its Project Managers can manage it again.", confirmLabel: "Restore project" }))) return
    try {
      await setProjectArchived(project.id, archived)
      setMessage({ text: archived ? "Project archived." : "Project restored.", ok: true })
      await reload()
    } catch (error) {
      setMessage({ text: (error as Error).message, ok: false })
    }
  }
  const managersProject = projects.find((project) => project.id === managersId) ?? null
  const managerLine = (projectId: string) => {
    const slots = slotsOf(managers, projectId)
    return slots.primary ? `PM: ${slots.primary.full_name}${slots.backup ? ` • Backup: ${slots.backup.full_name}` : ""}` : slots.backup ? `Backup PM: ${slots.backup.full_name}` : "No Project Manager"
  }

  // Manage access (team, then blueprint access per type) lives in ProjectAccessDialog; every change is saved at once.
  const shareProject = projects.find((project) => project.id === shareId) ?? null
  const openAccess = (projectId: string) => setShareId(projectId)
  const openBlueprints = (projectId: string) => {
    rememberProject(projectId)
    onNavigate("blueprint-upload", `?project=${projectId}`)
  }

  // Fills the site coordinates from the phone or laptop the admin is using, standing on the site.
  const fillFromHere = async () => {
    if (!form) return
    const here = await captureStamp(10_000)
    if (here.lat === undefined || here.lng === undefined) return toast.error("Could not read your location", "Allow location access for this site, or type the coordinates.")
    setForm({ ...form, site_lat: here.lat.toFixed(6), site_lng: here.lng.toFixed(6) })
    toast.success("Location filled in", `Accuracy about ${Math.round(here.accuracy_m ?? 0)} m. Save the project to keep it.`)
  }

  const errorText = (key: keyof Form) => (errors[key] ? <span className="mt-1 block text-xs font-normal text-danger-fg">{errors[key]}</span> : null)

  return (
    <div className="admin-page">
      <PageIntro
        eyebrow="Projects • Admin"
        title="All projects"
        description="Create and archive projects and assign their primary and backup Project Managers. Project Managers handle day-to-day operations in their own workspace."
        action={
          <AdminButton icon="plus" onClick={() => openForm()}>
            New project
          </AdminButton>
        }
      />

      {error || peopleError ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">
          {error || peopleError}
          <button className="min-h-6 font-bold underline" onClick={() => { void reload(); void loadPeople() }}>Retry</button>
        </div>
      ) : null}

      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-center">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by code, name, location or client"
          aria-label="Search projects"
          className="min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
        />
        <div className="grid grid-cols-2 gap-2 sm:contents">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ProjectStatus | "all")} aria-label="Filter by status" className="min-h-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg">
            <option value="all">All statuses</option>
            {(Object.keys(statusLabels) as ProjectStatus[]).map((key) => (
              <option key={key} value={key}>{statusLabels[key]}</option>
            ))}
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="Sort projects" className="min-h-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg">
            <option value="newest">Newest first</option>
            <option value="name">Name A-Z</option>
            <option value="status">Status</option>
          </select>
        </div>
        <label className="flex min-h-10 items-center gap-2 text-sm font-semibold text-fg sm:whitespace-nowrap"><input type="checkbox" className="h-4 w-4" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Show archived</label>
        <span className="text-sm text-fg-muted sm:whitespace-nowrap" aria-live="polite">{visible.length} of {projects.length}</span>
      </div>

      {loading ? <SkeletonCardGrid count={6} /> : null}
      {!loading && !error && projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line p-10 text-center">
          <p className="mb-3 text-fg-muted">No projects yet. Create the first one to start assigning your team.</p>
          <AdminButton icon="plus" onClick={() => openForm()}>New project</AdminButton>
        </div>
      ) : null}
      {!loading && projects.length > 0 && visible.length === 0 ? <p className="text-sm text-fg-muted">No projects match your filters.</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            people={cardPeople(project.id)}
            onOpen={() => openProject("admin", project.id)}
            actions={
              <>
                <span className="mr-auto min-w-0 max-w-full truncate text-[11px] font-semibold text-fg-muted" title={managerLine(project.id)}>{managerLine(project.id)}</span>
                <button type="button" className={cardAction} onClick={() => setManagersId(project.id)} aria-label={`Project Managers of ${project.code}`}>Managers</button>
                <button type="button" className={cardAction} onClick={() => openForm(project)} aria-label={`Edit details of ${project.code}`}>Details</button>
                <button type="button" className={cardAction} onClick={() => openAccess(project.id)} aria-label={`Team and access of ${project.code}`}>Team & access</button>
                <button type="button" className={cardAction} onClick={() => openBlueprints(project.id)} aria-label={`Blueprints of ${project.code}`}>Blueprints</button>
                <button type="button" className={cardAction} onClick={() => void archiveProject(project, !project.archived_at)} aria-label={`${project.archived_at ? "Restore" : "Archive"} ${project.code}`}>{project.archived_at ? "Restore" : "Archive"}</button>
                <button type="button" className="inline-flex min-h-8 items-center rounded-lg px-2.5 text-xs font-bold text-danger-fg hover:bg-danger-soft" onClick={() => void removeProject(project)} aria-label={`Delete ${project.code}`}>
                  Delete
                </button>
              </>
            }
          />
        ))}
      </div>

      {form ? (
        <Modal title={form.id ? `Edit ${form.code || "project"}` : "New project"} size="lg" onClose={() => setForm(null)}>
          <form className="space-y-4" noValidate onSubmit={(event) => void saveProject(event)}>
            {formError ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{formError}</p> : null}
            <fieldset className="space-y-3 rounded-xl border border-line p-3">
              <legend className={legend}>Project</legend>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                <label className="block text-sm font-semibold">
                  Code *
                  <input className={field} maxLength={30} placeholder="VCB-024" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                  {errorText("code")}
                </label>
                <label className="block text-sm font-semibold">
                  Project name *
                  <input className={field} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  {errorText("name")}
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Client
                  <input className={field} placeholder="William Brothers Manila" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} />
                  {errorText("client_name")}
                </label>
                <label className="block text-sm font-semibold">
                  Location
                  <input className={field} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                  {errorText("location")}
                </label>
              </div>
              <label className="block text-sm font-semibold">
                Description
                <textarea className={field} rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>
            </fieldset>

            <fieldset className="space-y-3 rounded-xl border border-line p-3">
              <legend className={legend}>Schedule</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Phase
                  <select className={field} value={form.phase} onChange={(e) => setForm({ ...form, phase: e.target.value as ProjectPhase })}>
                    {(Object.keys(phaseLabels) as ProjectPhase[]).map((phase) => (
                      <option key={phase} value={phase}>{phaseLabels[phase]}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Status
                  <select className={field} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}>
                    {(Object.keys(statusLabels) as ProjectStatus[]).map((status) => (
                      <option key={status} value={status}>{statusLabels[status]}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Start date
                  <input className={field} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
                </label>
                <label className="block text-sm font-semibold">
                  End date
                  <input className={field} type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
                  {errorText("end_date")}
                </label>
              </div>
            </fieldset>

            <fieldset className="space-y-3 rounded-xl border border-line p-3">
              <legend className={legend}>Who takes care of this project</legend>
              <label className="block text-sm font-semibold">
                Person in charge (any name)
                <input className={field} maxLength={120} placeholder="e.g. Mr. Roxan Valencia (no login needed)" value={form.manager_name} onChange={(e) => setForm({ ...form, manager_name: e.target.value })} />
                {errorText("manager_name")}
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Engineer in charge
                  <select className={field} value={form.lead_engineer_id} onChange={(e) => setForm({ ...form, lead_engineer_id: e.target.value })}>
                    <option value="">Not assigned</option>
                    {people.filter((person) => person.role === "engineer").map((person) => (
                      <option key={person.id} value={person.id}>{displayName(person)}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-semibold">
                  Foreman in charge
                  <select className={field} value={form.lead_foreman_id} onChange={(e) => setForm({ ...form, lead_foreman_id: e.target.value })}>
                    <option value="">Not assigned</option>
                    {people.filter((person) => person.role === "foreman").map((person) => (
                      <option key={person.id} value={person.id}>{displayName(person)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-fg-muted">They join the project team automatically. Choose their blueprint types in Team & access.</p>
            </fieldset>

            <fieldset className="rounded-xl border border-line p-3">
              <legend className={legend}>Scope of work</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {(Object.keys(disciplineLabels) as Discipline[]).map((discipline) => (
                  <label key={discipline} className="flex min-h-8 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={form.disciplines.includes(discipline)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          disciplines: e.target.checked
                            ? [...form.disciplines, discipline]
                            : form.disciplines.filter((d) => d !== discipline),
                        })
                      }
                    />
                    {disciplineLabels[discipline]}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2 rounded-xl border border-line p-3">
              <legend className={legend}>Site location (optional)</legend>
              <p className="text-xs text-fg-muted">Photos taken on site are compared with this point and radius and marked "At the site" or "Away from site". They are never blocked.</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm font-semibold">Latitude<input className={field} inputMode="decimal" value={form.site_lat} onChange={(e) => setForm({ ...form, site_lat: e.target.value })} placeholder="14.676000" /></label>
                <label className="block text-sm font-semibold">Longitude<input className={field} inputMode="decimal" value={form.site_lng} onChange={(e) => setForm({ ...form, site_lng: e.target.value })} placeholder="120.983000" /></label>
                <label className="block text-sm font-semibold">Radius (metres)<input className={field} inputMode="numeric" value={form.site_radius_m} onChange={(e) => setForm({ ...form, site_radius_m: e.target.value })} /></label>
              </div>
              {errorText("site_lat")}
              {errorText("site_radius_m")}
              <button type="button" className="min-h-8 text-sm font-bold text-brand-text hover:underline" onClick={() => void fillFromHere()}>Use my current location</button>
            </fieldset>

            <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
              {form.id ? (
                <button type="button" className={buttonSecondary} onClick={() => { openAccess(form.id!); setForm(null) }}>
                  Team & access
                </button>
              ) : <span className="hidden sm:block" />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button type="button" className={buttonSecondary} onClick={() => setForm(null)}>Cancel</button>
                <button type="submit" className={buttonPrimary} disabled={busy}>{busy ? "Saving..." : form.id ? "Save changes" : "Create project"}</button>
              </div>
            </div>
          </form>
        </Modal>
      ) : null}

      {managersProject ? (
        <ProjectManagersDialog
          project={managersProject}
          managers={managers}
          people={managerPeople}
          onChanged={async () => { await Promise.all([reloadManagers(), loadPeople()]) }}
          onClose={() => setManagersId(null)}
        />
      ) : null}

      {shareProject ? (
        <ProjectAccessDialog
          project={shareProject}
          people={people}
          members={members}
          onMembersChanged={async () => { await Promise.all([loadPeople(), reload()]) }}
          onClose={() => setShareId(null)}
        />
      ) : null}
    </div>
  )
}
