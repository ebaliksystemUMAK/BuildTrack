import { AdminButton, PageIntro, Panel } from "./AdminShell"
import AdminIcon from "./AdminIcon"
import ProjectHealth from "./ProjectHealth"
import type { AdminPageProps } from "./types"
import ProjectCard from "../../components/ProjectCard"
import { activityLabel, formatDate, formatTime, roleLabel, useActivity } from "../../lib/admin"
import { useAuth } from "../../lib/auth"
import {
  disciplineLabels,
  getSelectedProjectId,
  openProject,
  phaseLabels,
  statusLabels,
  useProject,
  useProjects,
  useProjectTeam,
} from "../../lib/projects"
import { Skeleton, SkeletonCardGrid, SkeletonRows } from "../../components/ui/Skeleton"

const dash = "—"
const roleNames = { engineer: "Engineer", foreman: "Foreman", client: "Client" } as const

export default function ProjectOverview({ onNavigate }: AdminPageProps) {
  const { can } = useAuth()
  const projectId = getSelectedProjectId()
  const { project, loading, notFound } = useProject(projectId)
  const { team } = useProjectTeam(project ? project.id : null)
  const { rows: activity, loading: activityLoading } = useActivity(project ? project.id : null, 10)
  const { projects, loading: listLoading } = useProjects()

  const back = (
    <div className="overview-breadcrumb">
      <button onClick={() => onNavigate("project-management")}>
        <AdminIcon name="arrow" /> Project Management
      </button>
      {project ? (
        <>
          <span>/</span>
          <strong>{project.name}</strong>
        </>
      ) : null}
    </div>
  )

  if (!projectId || (!loading && notFound)) {
    return (
      <div className="admin-page project-overview-page">
        {back}
        <PageIntro
          eyebrow="Project overview"
          title={notFound ? "Project not found" : "Choose a project"}
          description={notFound ? "It may have been deleted. Pick another project below." : "Select a project to see its team, scope and activity."}
        />
        {listLoading ? <SkeletonCardGrid count={3} /> : null}
        {!listLoading && projects.length === 0 ? <p className="text-sm text-fg-muted">There are no projects yet.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((item) => (
            <ProjectCard key={item.id} project={item} onOpen={() => openProject("admin", item.id)} />
          ))}
        </div>
      </div>
    )
  }

  if (loading || !project) {
    return (
      <div className="admin-page project-overview-page">
        {back}
        <div className="space-y-4"><Skeleton className="h-10 w-80" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div></div>
      </div>
    )
  }

  const lead = (role: "engineer" | "foreman") => team.find((member) => member.is_lead && member.role === role)?.full_name
  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right font-bold text-fg">{value}</dd>
    </div>
  )
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("")

  return (
    <div className="admin-page project-overview-page">
      {back}
      <PageIntro
        eyebrow={`${project.code} • ${project.location ?? "Location not set"}`}
        title={project.name}
        description={`${statusLabels[project.status]} • Phase: ${phaseLabels[project.phase]}${project.client_name ? ` • Client: ${project.client_name}` : ""}`}
        action={
          can("projects.manage") ? (
            <AdminButton icon="users" onClick={() => onNavigate("project-management")}>
              Edit project / assign managers
            </AdminButton>
          ) : undefined
        }
      />

      <ProjectHealth projects={[project]} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Who takes care of this project">
          <dl className="divide-y divide-line text-sm">
            {row("Person in charge", project.manager_name ?? dash)}
            {row("Engineer in charge", lead("engineer") ?? dash)}
            {row("Foreman in charge", lead("foreman") ?? dash)}
            {row("Start date", project.start_date ? formatDate(project.start_date) : dash)}
            {row("Target completion", project.end_date ? formatDate(project.end_date) : dash)}
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(project.disciplines ?? []).length === 0 ? <span className="text-xs text-fg-muted">No scope of work set</span> : null}
            {(project.disciplines ?? []).map((d) => (
              <span key={d} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand-text">
                {disciplineLabels[d]}
              </span>
            ))}
          </div>
          {project.description ? <p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm leading-relaxed text-fg">{project.description}</p> : null}
        </Panel>

        <Panel title={`Team (${team.length})`}>
          {team.length === 0 ? (
            <p className="text-sm text-fg-muted">Nobody is assigned yet. The project's Project Manager adds its team.</p>
          ) : (
            <ul className="divide-y divide-line">
              {team.map((member) => (
                <li key={member.user_id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-[#9e1f93] to-[#d466c9] text-xs font-extrabold text-white">{initials(member.full_name || "?")}</span>
                  <strong className="min-w-0 flex-1 truncate text-fg">{member.full_name}</strong>
                  <span className="rounded-full border border-line bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-fg-muted">{roleNames[member.role]}</span>
                  {member.is_lead ? <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand-text">In charge</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Project activity">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Activity</th>
                <th>Subject</th>
                <th>Date</th>
                <th>Time (PHT)</th>
              </tr>
            </thead>
            <tbody>
              {activityLoading ? (
                <SkeletonRows rows={3} cols={6} />
              ) : activity.length === 0 ? (
                <tr><td colSpan={6}>No activity recorded for this project yet.</td></tr>
              ) : (
                activity.map((entry) => (
                  <tr key={entry.id}>
                    <td className="is-strong">{entry.actor_name}</td>
                    <td>{entry.actor_role ? roleLabel[entry.actor_role] : dash}</td>
                    <td>{activityLabel(entry.action)}</td>
                    <td>{entry.subject ?? dash}</td>
                    <td className="is-muted">{formatDate(entry.created_at)}</td>
                    <td className="is-muted">{formatTime(entry.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

    </div>
  )
}
