import { useEffect, useMemo, useState } from "react"
import Modal from "../../components/Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import type { Profile } from "../../lib/auth"
import type { Project, ProjectMember } from "../../lib/projects"
import { saveBlueprintAccess, useBlueprintAccess } from "../../lib/blueprintAccess"
import {
  ACCESS_LEVELS,
  accessChanges,
  accessColumns,
  accessSummary,
  blueprintTypeLabels,
  downgradeWarning,
  levelsFor,
  sheetType,
  type AccessDraft,
  type AccessLevel,
  type BlueprintType,
} from "../../lib/blueprintTypes"
import { supabase } from "../../lib/supabase"
import { useConfirm } from "../../lib/confirm"
import { useToast } from "../../lib/toast"

const roleLabel: Record<ProjectMember["member_role"], string> = { engineer: "Engineer", foreman: "Foreman", client: "Client" }
const roleTone: Record<ProjectMember["member_role"], string> = {
  engineer: "bg-brand-soft text-brand-text",
  foreman: "border border-accent/60 bg-surface text-fg",
  client: "bg-surface-muted text-fg-muted border border-line",
}
const levelTone: Record<AccessLevel, string> = {
  none: "border-line bg-surface text-fg-muted",
  view: "border-line bg-surface-muted text-fg",
  assigned: "border-brand/40 bg-brand-soft font-semibold text-brand-text",
}
const shortLabel: Record<AccessLevel, string> = { none: "No access", view: "View only", assigned: "Assigned work" }
// Admins pass full profiles; the Project Manager workspace passes the names, emails and roles from get_assignable_people.
type Person = Pick<Profile, "id" | "full_name" | "email" | "role">
const displayName = (person: Person | undefined) => person?.full_name || person?.email || "Unknown user"

type Tab = "team" | "access"

// Manage access, in two separate steps: (1) who is on the project team, (2) what each Engineer / Foreman may do per
// blueprint type. Team changes are saved at once; access changes are collected and saved with "Save changes" after a
// confirmation that lists them (and warns about anything taken away). The database re-checks all of it (set_blueprint_access).
export default function ProjectAccessDialog({ project, people, members, onMembersChanged, onClose }: {
  project: Project
  people: Person[]
  members: ProjectMember[]
  onMembersChanged: () => Promise<void>
  onClose: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const access = useBlueprintAccess(project.id)
  const [tab, setTab] = useState<Tab>("team")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("")
  const [busy, setBusy] = useState(false)
  const [sheets, setSheets] = useState<{ blueprint_type: BlueprintType | null; discipline: string | null }[]>([])
  const [failure, setFailure] = useState("")
  const [draft, setDraft] = useState<AccessDraft>({})

  useEffect(() => {
    let active = true
    void supabase.from("blueprints").select("blueprint_type, discipline").eq("project_id", project.id).then(({ data }) => {
      if (active) setSheets((data ?? []) as { blueprint_type: BlueprintType | null; discipline: string | null }[])
    })
    return () => {
      active = false
    }
  }, [project.id])

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people])
  const team = members.filter((member) => member.project_id === project.id)
  const field = team.filter((member) => member.member_role !== "client")
  const clients = team.filter((member) => member.member_role === "client")
  const columns = accessColumns(sheets, access.grants)
  const planCount = (type: BlueprintType) => sheets.filter((sheet) => sheetType(sheet) === type).length
  const suggestions = people
    .filter((person) => !team.some((member) => member.user_id === person.id))
    .filter((person) => `${person.full_name ?? ""} ${person.email}`.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 6)
  const pending = accessChanges(access.grants, draft, project.id).filter((c) => field.some((m) => m.user_id === c.userId))
  const shownField = field.filter((member) => `${displayName(peopleById.get(member.user_id))} ${peopleById.get(member.user_id)?.email ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()))

  const addMember = async (person: Person) => {
    setBusy(true)
    setFailure("")
    const { error } = await supabase.from("project_members").insert({ project_id: project.id, user_id: person.id })
    setBusy(false)
    if (error) return setFailure(error.code === "42501" ? "You cannot change this team: Admins need the Projects permission (with MFA), and Project Managers can change only their own projects that are not archived." : error.message)
    setQuery("")
    await onMembersChanged()
    if (person.role === "engineer" || person.role === "foreman") {
      toast.success(`${displayName(person)} added`, "They see no blueprint type yet: choose their access per type.")
      setFilter(displayName(person))
      setTab("access")
    } else toast.success(`${displayName(person)} added`, "Clients see every plan of the project, read-only.")
  }

  const removeMember = async (member: ProjectMember) => {
    const person = peopleById.get(member.user_id)
    const ok = await confirm({
      title: `Remove ${displayName(person)} from ${project.code}?`,
      message: member.member_role === "foreman"
        ? "They lose this project and all its blueprint access straight away. Their open work items are unassigned; completed work and history keep their name."
        : "They lose this project and all its blueprint access straight away. Records they made or signed keep their name.",
      confirmLabel: "Remove from project",
      tone: "danger",
    })
    if (!ok) return
    setBusy(true)
    setFailure("")
    const { error } = await supabase.from("project_members").delete().eq("project_id", project.id).eq("user_id", member.user_id)
    setBusy(false)
    if (error) return setFailure(error.message)
    await Promise.all([onMembersChanged(), access.reload()])
  }

  const savedLevel = (userId: string, type: BlueprintType) => levelsFor(access.grants, userId, project.id)[type]
  const shownLevel = (userId: string, type: BlueprintType) => draft[userId]?.[type] ?? savedLevel(userId, type)
  const edit = (userId: string, type: BlueprintType, level: AccessLevel) =>
    setDraft((current) => ({ ...current, [userId]: { ...current[userId], [type]: level } }))

  // Leaving with unsaved access changes asks first (closing the dialog or Done).
  const leave = async () => {
    if (busy) return
    if (pending.length && !(await confirm({ title: "Discard unsaved access changes?", message: `${pending.length} change${pending.length === 1 ? "" : "s"} will not be saved.`, confirmLabel: "Discard changes", cancelLabel: "Keep editing", tone: "danger" }))) return
    onClose()
  }

  const saveAll = async () => {
    if (!pending.length) return
    const roleOf = (userId: string) => (field.find((m) => m.user_id === userId)?.member_role ?? "engineer") as "engineer" | "foreman"
    const warnings = [...new Set(pending.map((c) => downgradeWarning(roleOf(c.userId), c.type, c.from, c.to)).filter(Boolean))] as string[]
    const ok = await confirm({
      title: `Save ${pending.length} access change${pending.length === 1 ? "" : "s"}?`,
      size: "md",
      tone: warnings.length ? "danger" : "default",
      confirmLabel: "Save changes",
      message: (
        <div className="space-y-3 text-sm">
          <ul className="divide-y divide-line rounded-lg border border-line">
            {pending.map((c) => (
              <li key={`${c.userId}:${c.type}`} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                <span className="min-w-0 truncate"><strong className="text-fg">{displayName(peopleById.get(c.userId))}</strong> · {blueprintTypeLabels[c.type]}</span>
                <span className="text-fg-muted">{shortLabel[c.from]} <span aria-hidden="true">→</span><span className="sr-only">to</span> <strong className="text-fg">{shortLabel[c.to]}</strong></span>
              </li>
            ))}
          </ul>
          {warnings.length ? <div className="space-y-1 rounded-lg bg-danger-soft px-3 py-2 text-danger-fg">{warnings.map((w) => <p key={w}>{w}</p>)}</div> : null}
        </div>
      ),
    })
    if (!ok) return
    setBusy(true)
    setFailure("")
    const byPerson = new Map<string, Partial<Record<BlueprintType, AccessLevel>>>()
    for (const c of pending) byPerson.set(c.userId, { ...byPerson.get(c.userId), [c.type]: c.to })
    const failed: string[] = []
    for (const [userId, levels] of byPerson) {
      try {
        await saveBlueprintAccess(project.id, userId, levels)
        setDraft((current) => {
          const next = { ...current }
          delete next[userId]
          return next
        })
      } catch (error) {
        failed.push(`${displayName(peopleById.get(userId))}: ${error instanceof Error ? error.message : "not saved"}`)
      }
    }
    await access.reload()
    setBusy(false)
    if (failed.length) setFailure(failed.join(" "))
    else toast.success("Access saved", `${pending.length} change${pending.length === 1 ? "" : "s"} saved.`)
  }

  // Plain render helper (not a component) so a select keeps focus while the list re-renders.
  const levelSelect = (member: ProjectMember, type: BlueprintType) => {
    const level = shownLevel(member.user_id, type)
    const changed = level !== savedLevel(member.user_id, type)
    return (
      <label key={type} className="block w-full sm:w-40">
        <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
          <span className="truncate">{blueprintTypeLabels[type]}</span>
          {changed ? <span className="flex-none rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">Changed</span> : null}
        </span>
        <select
          value={level}
          disabled={busy || access.loading}
          onChange={(event) => edit(member.user_id, type, event.target.value as AccessLevel)}
          aria-label={`${displayName(peopleById.get(member.user_id))}: ${blueprintTypeLabels[type]} access`}
          className={`min-h-9 w-full rounded-lg border px-2 text-[13px] disabled:opacity-60 ${levelTone[level]} ${changed ? "ring-2 ring-brand/60 ring-offset-1 ring-offset-surface" : ""}`}
        >
          {ACCESS_LEVELS.map((value) => <option key={value} value={value}>{shortLabel[value]}</option>)}
        </select>
      </label>
    )
  }

  const personCell = (member: ProjectMember) => {
    const person = peopleById.get(member.user_id)
    return (
      <span className="block min-w-0">
        <strong className="block truncate text-sm text-fg">{displayName(person)}</strong>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleTone[member.member_role]}`}>{roleLabel[member.member_role]}</span>
          <span className="truncate text-xs text-fg-muted">{person?.email}</span>
        </span>
      </span>
    )
  }

  return (
    <Modal title={`Manage access: ${project.code}`} size="xl" onClose={() => void leave()}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-fg-muted">{project.name}</p>
          <div className="grid w-full grid-cols-2 gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm sm:inline-flex sm:w-auto" role="tablist" aria-label="Manage access">
            {(["team", "access"] as Tab[]).map((key) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-bold transition ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}>
                {key === "team" ? `1. Project team (${team.length})` : "2. Blueprint access"}
                {key === "access" && pending.length ? <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${tab === key ? "bg-white/25" : "bg-brand text-white"}`} aria-label={`${pending.length} unsaved`}>{pending.length}</span> : null}
              </button>
            ))}
          </div>
        </div>
        {failure || access.error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{failure || access.error}</p> : null}

        {tab === "team" ? (
          <section className="space-y-3" aria-label="Project team">
            <div>
              <label className="block text-sm font-semibold text-fg" htmlFor="access-add">Add an active Engineer, Foreman or Client</label>
              <input id="access-add" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email" className={`mt-1 min-h-10 ${inputClass}`} />
              {query.trim() ? (
                <ul className="mt-1 max-h-56 overflow-y-auto rounded-xl border border-line bg-surface">
                  {suggestions.length === 0 ? <li className="px-3 py-2 text-sm text-fg-muted">No active person matches.</li> : suggestions.map((person) => (
                    <li key={person.id}>
                      <button type="button" disabled={busy} onClick={() => void addMember(person)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-muted disabled:opacity-60">
                        <span className="min-w-0">
                          <strong className="block truncate text-sm text-fg">{displayName(person)}</strong>
                          <span className="block truncate text-xs text-fg-muted">{person.email}</span>
                        </span>
                        <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-semibold ${roleTone[person.role as ProjectMember["member_role"]] ?? ""}`}>{roleLabel[person.role as ProjectMember["member_role"]] ?? person.role}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-xs text-fg-muted">Joining the team gives no blueprint type: set it in step 2. Clients see every plan, read-only.</p>
            </div>
            {team.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-fg-muted">Nobody yet. Only administrators can see this project.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {[...field, ...clients].map((member) => {
                  const summary = member.member_role === "client" ? "Every plan, view only" : accessSummary(levelsFor(access.grants, member.user_id, project.id))
                  const missing = member.member_role !== "client" && !access.grants.some((g) => g.user_id === member.user_id)
                  return (
                    <li key={member.user_id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div className="min-w-0 space-y-0.5">
                        {personCell(member)}
                        <p className={`text-xs ${missing ? "font-semibold text-danger-fg" : "text-fg-muted"}`}>{access.loading ? "Loading access…" : summary}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        {member.member_role !== "client" ? (
                          <button type="button" className="inline-flex min-h-8 min-w-[6.5rem] items-center justify-center rounded-lg border border-line bg-surface px-3 text-xs font-bold text-fg hover:border-brand/50 hover:text-brand-text" onClick={() => { setFilter(displayName(peopleById.get(member.user_id))); setTab("access") }}>
                            {missing ? "Set access" : "Edit access"}
                          </button>
                        ) : null}
                        <button type="button" disabled={busy} onClick={() => void removeMember(member)} className="min-h-8 rounded-lg px-3 text-xs font-bold text-danger-fg hover:bg-danger-soft disabled:opacity-60" aria-label={`Remove ${displayName(peopleById.get(member.user_id))}`}>
                          Remove
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        ) : (
          <section className="space-y-3" aria-label="Blueprint access by type">
            <p className="text-sm text-fg-muted">
              <strong className="text-fg">No access</strong> hides the type. <strong className="text-fg">View only</strong> opens its plans and records read-only. <strong className="text-fg">Assigned work</strong> lets an Engineer edit plans, manage checklists, inspect and verify; a Foreman reports progress, adds evidence and submits corrections on the work assigned to them. New plans follow their type. Changes are saved with Save changes.
            </p>
            {field.length > 4 || filter ? (
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter people by name or email" aria-label="Filter people" className={`min-h-10 ${inputClass}`} />
            ) : null}
            {field.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-fg-muted">Add an Engineer or Foreman in step 1 first.</p>
            ) : columns.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-fg-muted">This project has no plans yet. Upload a plan in Blueprints: its type then appears here to give access.</p>
            ) : shownField.length === 0 ? (
              <p className="text-sm text-fg-muted">Nobody matches the filter. <button type="button" className="font-bold text-brand-text hover:underline" onClick={() => setFilter("")}>Show everyone</button></p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {shownField.map((member) => (
                  <li key={member.user_id} className="grid gap-3 px-3 py-3 md:grid-cols-[15rem_minmax(0,1fr)] md:items-end">
                    <div className="min-w-0 md:pb-1.5">{personCell(member)}</div>
                    <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">{columns.map((type) => levelSelect(member, type))}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-end">
          {pending.length ? (
            <>
              <p className="text-sm text-fg-muted sm:mr-auto" aria-live="polite">{pending.length} unsaved change{pending.length === 1 ? "" : "s"}</p>
              <button type="button" className={buttonSecondary} onClick={() => setDraft({})} disabled={busy}>Discard</button>
              <button type="button" className={buttonPrimary} onClick={() => void saveAll()} disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
            </>
          ) : (
            <button type="button" className={buttonPrimary} onClick={() => void leave()} disabled={busy}>Done</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
