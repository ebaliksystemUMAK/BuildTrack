import { useEffect, useMemo, useState } from "react"
import GetStarted from "../../components/GetStarted"
import { AdminButton, PageIntro, Panel, StatusBadge } from "./AdminShell"
import AdminIcon, { type AdminIconName } from "./AdminIcon"
import type { AdminPageProps } from "./types"
import { activityLabel, formatDate, formatTime, roleLabel, useActivity, useDecisionCounts, useUserStats } from "../../lib/admin"
import { useAuth } from "../../lib/auth"
import { useProjectManagers } from "../../lib/projectManagers"
import { openProject, phaseLabels, useProjects } from "../../lib/projects"
import { supabase } from "../../lib/supabase"
import ProjectHealth from "./ProjectHealth"
import { SkeletonKpis, SkeletonList, SkeletonRows } from "../../components/ui/Skeleton"

type Tone = "info" | "success" | "warning" | "danger"
type Kpi = { label: string; value: string; note: string; icon: AdminIconName; tone: Tone }

const dash = "—"

export default function AdminDashboard({ onNavigate }: AdminPageProps) {
  const { can, profile } = useAuth()
  const { managers } = useProjectManagers(can("projects.manage") ? "all" : null)
  const { projects, loading: projectsLoading, error: projectsError } = useProjects()
  const { stats, error: statsError } = useUserStats(can("users.view"))
  const { rows: activity, loading: activityLoading, error: activityError } = useActivity(null, 12)
  const decisions = useDecisionCounts(can("users.approve"))
  const [filter, setFilter] = useState<"all" | "people" | "projects" | "security">("all")
  const [memberCounts, setMemberCounts] = useState<Map<string, number> | null>(null)

  useEffect(() => {
    if (!can("projects.manage")) return
    supabase
      .from("project_members")
      .select("project_id")
      .then(({ data }) => {
        const counts = new Map<string, number>()
        for (const row of data ?? []) counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1)
        setMemberCounts(counts)
      })
  }, [can])

  const projectsHidden = Boolean(projectsError) || !can("projects.manage")
  const byStatus = (status: string) => projects.filter((project) => project.status === status).length
  const userValue = (value: number | undefined) => (value === undefined ? dash : String(value))

  const kpis: Kpi[] = [
    { label: "Total Projects", value: projectsHidden ? dash : String(projects.length), note: "All statuses", icon: "building", tone: "info" },
    { label: "Active Projects", value: projectsHidden ? dash : String(byStatus("active")), note: `${byStatus("planning")} planning • ${byStatus("on_hold")} on hold`, icon: "building", tone: "success" },
    { label: "Completed Projects", value: projectsHidden ? dash : String(byStatus("completed")), note: `${byStatus("cancelled")} cancelled`, icon: "check", tone: "info" },
    { label: "Engineers / Foremen", value: stats ? `${stats.engineers} / ${stats.foremen}` : dash, note: can("users.view") ? "Active accounts (admins not counted)" : "Needs the View users permission", icon: "users", tone: "info" },
    { label: "Clients", value: userValue(stats?.clients), note: can("users.view") ? "Active client accounts" : "Needs the View users permission", icon: "users", tone: "info" },
    { label: "Access Requests", value: userValue(stats?.pending), note: stats && stats.pending > 0 ? "Waiting for your review" : "Nobody waiting", icon: "history", tone: stats && stats.pending > 0 ? "warning" : "success" },
  ]

  // Projects that still need someone in charge or a team.
  const attention = useMemo(
    () =>
      projects
        .filter((project) => project.status !== "completed" && project.status !== "cancelled")
        .map((project) => {
          const issues: string[] = []
          if (!project.manager_name && !project.lead_engineer_id) issues.push("No person in charge")
          if (!project.lead_engineer_id) issues.push("No engineer in charge")
          if (!project.lead_foreman_id) issues.push("No foreman in charge")
          if (memberCounts && !memberCounts.get(project.id)) issues.push("No team assigned")
          return { project, issues }
        })
        .filter((entry) => entry.issues.length > 0),
    [projects, memberCounts],
  )

  // First-run checklist for a new system: only for admins who manage projects, and gone once everything is in place.
  const firstProject = projects.find((project) => project.status !== "completed" && project.status !== "cancelled") ?? projects[0]
  const setupSteps = [
    { key: "project", title: "Create the first project", text: "Give it a code, a name, the client and the dates. Everything else hangs on a project.", done: projects.length > 0, action: { label: "New project", run: () => onNavigate("project-management") } },
    { key: "team", title: "Assign the Project Manager", text: "Assign a primary Project Manager. They add the Engineers, Foremen and Clients and set their blueprint access.", done: Boolean(firstProject && managers.some(manager => manager.project_id === firstProject.id && manager.designation === "primary" && manager.active)), action: { label: "Assign managers", run: () => onNavigate("project-management") } },
    { key: "invite", title: "Let the team sign up", text: "Pre-approve their emails or create an invitation code, so each person gets the right role the moment they join.", done: (stats?.engineers ?? 0) + (stats?.foremen ?? 0) + (stats?.clients ?? 0) > 0, action: { label: "Invitation codes", run: () => onNavigate("invites") } },
  ]

  const shown = activity.filter((row) => {
    if (filter === "all") return true
    const security = /impersonate|privacy|set_permissions|settings|oauth|disable|enable|role_changed|status_changed/.test(row.action)
    if (filter === "security") return security
    if (filter === "projects") return /^(projects|project_members|project)\./.test(row.action)
    return /^(user|access|whitelist|invite|registration|profile)\./.test(row.action) && !security
  })

  return (
    <div className="admin-page">
      <PageIntro
        eyebrow={`System overview • ${profile?.role === "super_admin" ? "Super Admin" : "Administrator"}`}
        title="Admin Dashboard"
        description="Live numbers for projects, people and quality across Valencia Construction Services."
        action={
          can("projects.manage") ? (
            <AdminButton icon="arrow" onClick={() => onNavigate("project-management")}>
              Manage projects
            </AdminButton>
          ) : undefined
        }
      />

      {statsError ? (
        <p className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">Could not load user counts. Refresh to retry.</p>
      ) : null}

      {can("projects.manage") && !projectsLoading && !projectsError && memberCounts !== null ? (
        <GetStarted title="Set up BuildTrack" intro="Three steps take a new system from empty to a team working on a project. Each one is ticked when it is really done." steps={setupSteps} />
      ) : null}

      {can("users.approve") ? (
        <section aria-label="Needs your decision" className="mb-5 rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-extrabold">Needs your decision</h2>
            <span className="text-xs text-fg-muted">Things that cannot move until an administrator acts</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Google sign-ups to approve", value: decisions?.registrations, tab: "?tab=queue" },
              { label: "ID checks to review", value: decisions?.ids, tab: "?tab=queue" },
              { label: "Access requests", value: stats?.pending, tab: "?tab=requests" },
              { label: "Data deletion requests", value: decisions?.erasures, tab: "?tab=queue" },
            ].map((item) => (
              <button key={item.label} type="button" onClick={() => onNavigate("user-management", item.tab)} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted px-4 py-3 text-left transition hover:border-brand">
                <span className="text-sm font-semibold">{item.label}</span>
                <span className={`min-w-8 rounded-full px-2.5 py-1 text-center text-sm font-extrabold tabular-nums ${item.value ? "bg-brand text-white" : "bg-surface text-fg-muted"}`}>{item.value === undefined ? dash : item.value}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {projectsLoading ? <SkeletonKpis /> : null}
      <div className="admin-kpi-grid" hidden={projectsLoading}>
        {kpis.map(({ label, value, note, icon, tone }) => (
          <article className="admin-kpi" key={label}>
            <div className={`admin-kpi__icon admin-kpi__icon--${tone}`}>
              <AdminIcon name={icon} />
            </div>
            <div>
              <span>{label}</span>
              <strong>{projectsLoading && label.includes("Project") ? "…" : value}</strong>
              <small>{note}</small>
            </div>
          </article>
        ))}
      </div>

      {can("projects.manage") && !projectsLoading && !projectsError ? <ProjectHealth projects={projects} /> : null}

      <Panel
        title="Projects needing attention"
        action={<StatusBadge tone={attention.length ? "warning" : "success"}>{attention.length ? `${attention.length} to review` : "All set"}</StatusBadge>}
      >
        {projectsLoading ? (
          <SkeletonList rows={3} label="Loading projects" />
        ) : projectsHidden ? (
          <p className="text-sm text-fg-muted">Project numbers need the Projects permission. Ask a Super Admin to grant it.</p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-fg-muted">No projects yet. Create the first one in Project Management.</p>
        ) : attention.length === 0 ? (
          <p className="text-sm text-fg-muted">Every open project has a person in charge, an engineer, a foreman and a team.</p>
        ) : (
          <ul className="divide-y divide-line">
            {attention.map(({ project, issues }) => (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <button className="text-left" onClick={() => openProject("admin", project.id)}>
                  <strong className="text-fg">{project.code}</strong> <span className="text-fg-muted">{project.name}</span>
                  <span className="block text-xs text-fg-muted">{phaseLabels[project.phase]} • {issues.join(" • ")}</span>
                </button>
                {can("projects.manage") ? (
                  <AdminButton variant="outline" onClick={() => onNavigate("project-management")}>
                    Fix in Project Management
                  </AdminButton>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recent System Activity" action={<span className="admin-panel-note">Newest first • Philippine time</span>}>
        {activityError ? <p className="text-sm text-danger-fg">{activityError}</p> : null}
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter activity">
          {([["all", "Everything"], ["people", "People"], ["projects", "Projects"], ["security", "Security"]] as const).map(([key, text]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 text-xs font-bold transition ${filter === key ? "border-brand bg-brand text-white" : "border-line text-fg-muted hover:border-brand"}`}>{text}</button>
          ))}
        </div>
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
                <SkeletonRows rows={5} cols={6} />
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    {can("users.view") || can("projects.manage")
                      ? activity.length ? "Nothing in this group yet." : "No activity recorded yet."
                      : "Activity is visible to admins with the View users or Projects permission."}
                  </td>
                </tr>
              ) : (
                shown.map((row) => (
                  <tr key={row.id}>
                    <td className="is-strong">{row.actor_name}</td>
                    <td>{row.actor_role ? roleLabel[row.actor_role] : dash}</td>
                    <td>{activityLabel(row.action)}</td>
                    <td>{row.subject ?? dash}</td>
                    <td className="is-muted">{formatDate(row.created_at)}</td>
                    <td className="is-muted">{formatTime(row.created_at)}</td>
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
