import { useMemo, useState } from "react"
import { EmptyState, PageHead, buttonPrimary } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { useBlueprintAccess } from "../../lib/blueprintAccess"
import { accessSummary, levelsFor } from "../../lib/blueprintTypes"
import { slotLabels } from "../../lib/projectManagerModel"
import { useAssignablePeople, useProjectMembers } from "../../lib/projectManagers"
import { useProjectTeam, type ProjectMember } from "../../lib/projects"
import ProjectAccessDialog from "../Admin/ProjectAccessDialog"
import { AssignmentBoard } from "../Engineer/EngineerAssignments"
import { Panel } from "../Admin/AdminShell"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

const roleName: Record<ProjectMember["member_role"], string> = { engineer: "Engineer", foreman: "Foreman", client: "Client" }

// Team & work access: who is on the project, what each Engineer / Foreman may open per blueprint type, and who does which work item.
// The team and type access are edited in the same dialog Admins use; the database limits a Project Manager to their own projects.
export default function PmTeam(_: PmPageProps) {
  const pm = usePmProject()
  const projectId = pm.project?.id ?? null
  const { members, loading: membersLoading, error: membersError, reload: reloadMembers } = useProjectMembers(projectId)
  const { people, reload: reloadPeople } = useAssignablePeople(projectId)
  const { team, reload: reloadTeam } = useProjectTeam(projectId)
  const access = useBlueprintAccess(projectId)
  const [open, setOpen] = useState(false)
  const names = useMemo(() => new Map([...team.map((member) => [member.user_id, { name: member.full_name, lead: member.is_lead }] as const)]), [team])
  const emails = useMemo(() => new Map(people.map((person) => [person.id, person.email])), [people])
  // People shown in the dialog: everyone the caller may add, plus current members (an inactive member still needs a name).
  const dialogPeople = useMemo(() => {
    const list: Array<{ id: string; full_name: string | null; email: string; role: ProjectMember["member_role"] }> = people
      .filter((person) => person.role === "engineer" || person.role === "foreman" || person.role === "client")
      .map((person) => ({ id: person.id, full_name: person.full_name, email: person.email, role: person.role as ProjectMember["member_role"] }))
    for (const member of members) if (!list.some((person) => person.id === member.user_id)) list.push({ id: member.user_id, full_name: names.get(member.user_id)?.name ?? null, email: "", role: member.member_role })
    return list
  }, [people, members, names])

  if (!pm.project) return <div className="admin-page"><SkeletonList rows={4} label="Loading the team" /></div>
  const project = pm.project
  const ordered = [...members].sort((a, b) => a.member_role.localeCompare(b.member_role) || (names.get(a.user_id)?.name ?? "").localeCompare(names.get(b.user_id)?.name ?? ""))

  return (
    <div className="admin-page">
      <PageHead eyebrow={`${project.code} • Team & work access`} title="Team & work access"
        description="Add or remove approved Engineers, Foremen and Clients, choose which blueprint types each Engineer and Foreman can open or work on, and move work between Foremen."
        actions={pm.canManage ? <button type="button" className={buttonPrimary} onClick={() => setOpen(true)}>Manage team & access</button> : undefined} />
      {pm.note ? <p role="status" className="mb-4 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg">{pm.note}</p> : null}
      {membersError ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{membersError} <button type="button" className="font-bold underline" onClick={() => void reloadMembers()}>Retry</button></p> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="Project Managers">
          <dl className="divide-y divide-line text-sm">
            {(["primary", "backup"] as const).map((slot) => {
              const row = pm.managers.find((item) => item.designation === slot)
              return (
                <div key={slot} className="py-2">
                  <dt className="text-xs font-bold uppercase tracking-wide text-fg-muted">{slotLabels[slot]}</dt>
                  <dd className="mt-0.5 font-semibold text-fg">{row ? row.full_name : "Not assigned"}{row?.email ? <span className="block text-xs font-normal text-fg-muted">{row.email}</span> : null}{row && !row.active ? <span className="block text-xs font-semibold text-danger-fg">Account not active</span> : null}</dd>
                </div>
              )
            })}
          </dl>
          <p className="mt-2 text-xs text-fg-muted">Admins assign, replace or remove Project Managers. A Project Manager cannot change their own or another Project Manager's access.</p>
        </Panel>

        <Panel title={`Project team (${members.length})`}>
          {membersLoading ? <SkeletonList rows={3} /> : members.length === 0 ? (
            <EmptyState title="Nobody on the team yet" action={pm.canManage ? <button type="button" className={buttonPrimary} onClick={() => setOpen(true)}>Add people</button> : undefined}>Add approved Engineers, Foremen and Clients, then give each Engineer and Foreman their blueprint types.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {ordered.map((member) => {
                const info = names.get(member.user_id)
                const summary = member.member_role === "client" ? "Every plan, view only" : access.loading ? "Loading access…" : accessSummary(levelsFor(access.grants, member.user_id, project.id))
                const missing = member.member_role !== "client" && !access.loading && !access.grants.some((grant) => grant.user_id === member.user_id)
                return (
                  <li key={member.user_id} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-fg">{info?.name ?? "Inactive account"}{emails.get(member.user_id) ? <span className="ml-2 text-xs font-normal text-fg-muted">{emails.get(member.user_id)}</span> : null}</p>
                      <p className={`text-xs ${missing ? "font-semibold text-danger-fg" : "text-fg-muted"}`}>{summary}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs font-bold text-fg-muted">{roleName[member.member_role]}</span>
                      {info?.lead ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-text">In charge</span> : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <AssignmentBoard variant="pm" readOnly={!pm.canManage} />

      {open ? (
        <ProjectAccessDialog
          project={project}
          people={dialogPeople}
          members={members}
          onMembersChanged={async () => { await Promise.all([reloadMembers(), reloadTeam(), reloadPeople(), access.reload()]) }}
          onClose={() => { setOpen(false); void access.reload() }}
        />
      ) : null}
    </div>
  )
}
