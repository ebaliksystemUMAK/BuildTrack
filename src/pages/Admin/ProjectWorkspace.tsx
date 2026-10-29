import type { ReactNode } from "react"
import { useAuth } from "../../lib/auth"
import { getSelectedProjectId, useProject, useProjects } from "../../lib/projects"
import { projectPath, type ProjectSection } from "../../lib/projectRoutes"
import ProjectCard from "../../components/ProjectCard"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { adminPagePermission } from "./AdminShell"
import type { AdminNavigate } from "./types"

const tabs: { key: ProjectSection; label: string }[] = [
  { key: "project-overview", label: "Project Overview" },
  { key: "calendar", label: "Project Calendar" },
  { key: "blueprint-upload", label: "Blueprint Upload" },
  { key: "blueprint-mapping", label: "Blueprint Mapping" },
  { key: "blueprint-progress", label: "Progress Tracking" },
  { key: "blueprint-version", label: "Version Control" },
]

export default function ProjectWorkspace({ activePage, onNavigate, children }: { activePage: ProjectSection; onNavigate: AdminNavigate; children: ReactNode }) {
  const id = getSelectedProjectId()
  const { project, loading, notFound } = useProject(id)
  const { projects, loading: listLoading, error } = useProjects()
  const { can } = useAuth()
  if (!id || notFound) return (
    <div className="admin-page space-y-5">
      <div><h1 className="text-2xl font-extrabold text-fg">{id ? "Project unavailable" : "Choose a project"}</h1><p className="mt-2 text-sm text-fg-muted">{id ? "This project does not exist or you do not have access. Select another project." : "Open a project to manage its own blueprints, mapping and progress."}</p></div>
      {error ? <p role="alert">{error}</p> : null}
      {listLoading ? <SkeletonCardGrid count={3} /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{projects.map((item) => <ProjectCard key={item.id} project={item} onOpen={() => onNavigate(activePage, `?project=${item.id}`)} />)}</div>}
      {!listLoading && !projects.length ? <p>No projects yet. Create a project in Project Management.</p> : null}
    </div>
  )
  if (loading || !project) return <div className="p-6"><SkeletonCardGrid count={3} /></div>
  return (
    <>
      {/* Same container as the page below (.admin-page): the header lines up with every section's content. */}
      <div className="admin-page pb-5">
      <div className="rounded-2xl border border-line bg-surface p-4 shadow-[var(--bt-shadow)] sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="inline-flex min-h-6 items-center text-sm font-bold text-brand-text hover:underline" onClick={() => onNavigate(can("projects.manage") ? "project-management" : "blueprint-upload", "?list=1")}>← All projects</button>
        </div>
        <p className="text-xs font-bold uppercase tracking-wider text-brand-text">{project.code}{project.archived_at ? " • Archived" : ""}</p>
        <h2 className="mt-1 text-xl font-extrabold text-fg">{project.name}</h2>
        <p className="mt-1 text-sm text-fg-muted">{project.location || "Location not set"}</p>
        <nav aria-label="Project sections" className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {tabs.filter(({ key }) => !adminPagePermission[key] || can(adminPagePermission[key]!)).map(({ key, label }) => (
            <a key={key} href={projectPath(id, key)} aria-current={activePage === key ? "page" : undefined} className={`inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-bold ${activePage === key ? "bg-brand text-white" : "bg-surface-muted text-fg hover:bg-brand-soft"}`} onClick={(event) => { if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return; event.preventDefault(); onNavigate(key, `?project=${id}`) }}>{label}</a>
          ))}
        </nav>
      </div>
      </div>
      {children}
    </>
  )
}
