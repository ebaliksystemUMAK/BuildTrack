import { useMemo, useState } from "react"
import ProjectCard from "../../components/ProjectCard"
import { EmptyState, PageHead, inputClass } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { useAuth } from "../../lib/auth"
import { myDesignation, slotShort, slotsOf } from "../../lib/projectManagerModel"
import { useProjectManagers } from "../../lib/projectManagers"
import { openProject, statusLabels, useProjects, type Project, type ProjectStatus } from "../../lib/projects"
import type { PmPageProps } from "./types"

const chip = "rounded-full px-2 py-0.5 text-[11px] font-bold"

// My projects: only the projects an Admin assigned to the signed-in Project Manager (Row Level Security returns nothing else).
// Archived projects stay readable in their own section.
export default function PmProjects({ notice }: PmPageProps & { notice?: string }) {
  const { profile } = useAuth()
  const { projects, loading, error, reload } = useProjects()
  const { managers } = useProjectManagers("all")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<ProjectStatus | "all">("all")
  const [showArchived, setShowArchived] = useState(false)

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return projects.filter((project) => (status === "all" || project.status === status) && (!text || `${project.code} ${project.name} ${project.location ?? ""} ${project.client_name ?? ""}`.toLowerCase().includes(text)))
  }, [projects, query, status])
  const open = filtered.filter((project) => !project.archived_at)
  const archived = filtered.filter((project) => project.archived_at)

  const card = (project: Project) => {
    const slot = myDesignation(managers, project.id, profile?.id)
    const slots = slotsOf(managers, project.id)
    const other = slot === "primary" ? slots.backup : slot === "backup" ? slots.primary : null
    return (
      <ProjectCard key={project.id} project={project} onOpen={() => openProject("project_manager", project.id)} actions={
        <>
          {slot ? <span className={`${chip} bg-brand-soft text-brand-text`}>{slotShort[slot]} PM</span> : null}
          {project.archived_at ? <span className={`${chip} border border-line bg-surface text-fg-muted`}>Archived • read-only</span> : null}
          {other ? <span className="truncate text-[11px] font-semibold text-fg-muted">{slot === "primary" ? "Backup" : "Primary"}: {other.full_name}</span> : null}
          <button type="button" onClick={() => openProject("project_manager", project.id)} className="ml-auto inline-flex min-h-6 items-center text-xs font-bold text-brand-text hover:underline">Open project →</button>
        </>
      } />
    )
  }

  return (
    <div className="admin-page">
      <PageHead eyebrow="Project office" title="My projects"
        description="The projects an Admin assigned to you, as primary or backup Project Manager. Each one opens with its own sidebar, team, plans and records." />
      {notice ? <p role="status" className="mb-4 rounded-lg bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">{notice}</p> : null}
      {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error} <button type="button" className="font-bold underline" onClick={() => void reload()}>Retry</button></p> : null}
      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by code, name, location or client" aria-label="Search projects" className={`min-h-10 ${inputClass}`} />
        <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | "all")} aria-label="Filter by status" className={`min-h-10 ${inputClass}`}>
          <option value="all">All statuses</option>
          {(Object.keys(statusLabels) as ProjectStatus[]).map((key) => <option key={key} value={key}>{statusLabels[key]}</option>)}
        </select>
        <span className="text-sm text-fg-muted sm:whitespace-nowrap" aria-live="polite">{open.length} active{archived.length ? ` • ${archived.length} archived` : ""}</span>
      </div>
      {loading ? <SkeletonCardGrid count={3} label="Loading your projects" /> : projects.length === 0 ? (
        <EmptyState title="No projects assigned yet">An Admin assigns Project Managers to projects. Once you are the primary or backup Project Manager of a project, it appears here.</EmptyState>
      ) : open.length === 0 && !archived.length ? (
        <p className="text-sm text-fg-muted">No projects match your filters.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{open.map(card)}</div>
      )}
      {!loading && archived.length ? (
        <section className="mt-6">
          <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived((value) => !value)} className="mb-3 inline-flex min-h-8 items-center gap-2 text-sm font-bold text-brand-text hover:underline">
            {showArchived ? "Hide" : "Show"} archived projects ({archived.length})
          </button>
          {showArchived ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{archived.map(card)}</div> : null}
        </section>
      ) : null}
    </div>
  )
}
