import type { ReactNode } from "react"
import AppShell from "../../components/shell/AppShell"
import { phaseLabels, useFieldProject } from "../../lib/projects"
import { Skeleton } from "../../components/ui/Skeleton"
import type { AdminIconName } from "../Admin/AdminIcon"
import type { ClientNavigate, ClientPageKey } from "./types"
import ClientProjects from "./ClientProjects"

const labels: Record<ClientPageKey, { label: string; icon: AdminIconName }> = {
  projects: { label: "My projects", icon: "building" },
  overview: { label: "Overview & progress", icon: "grid" },
  calendar: { label: "Project Calendar", icon: "calendar" },
  blueprint: { label: "Blueprint & issues", icon: "blueprint" },
  ticket: { label: "Report a Problem", icon: "pin" },
  "site-logs": { label: "Site logs & media", icon: "history" },
  communication: { label: "Communication", icon: "users" },
}

export default function ClientShell({
  activePage,
  onNavigate,
  children,
}: {
  activePage: ClientPageKey
  onNavigate: ClientNavigate
  children: ReactNode
}) {
  const { projectId, project: loadedProject, loading, notFound, mode } = useFieldProject(activePage)
  const project = loadedProject?.id === projectId ? loadedProject : null
  const inProject = mode === "project"
  const item = (key: ClientPageKey) => ({ key, ...labels[key] })
  return (
    <AppShell
      persona="client"
      workspace="Client portal"
      groups={inProject ? [
        { label: "Your project", items: [item("overview"), item("calendar"), item("blueprint"), item("site-logs")] },
        { label: "Talk to the team", items: [item("ticket"), item("communication")] },
      ] : [{ label: "Workspace", items: [item("projects")] }]}
      active={inProject ? activePage : "projects"}
      onNavigate={(key) => onNavigate(key as ClientPageKey)}
      project={inProject && project ? { code: project.code, name: project.name, sub: phaseLabels[project.phase] } : undefined}
      onAllProjects={inProject ? () => onNavigate("projects") : undefined}
      mobileTabs={inProject ? ["overview", "blueprint", "ticket", "communication"] : []}
    >
      {!inProject ? <ClientProjects notice={notFound ? "That project is unavailable or is no longer assigned to you. Choose one of your assigned projects." : activePage !== "projects" ? "Choose a project to open that page." : undefined} /> : loading || !project ? <Skeleton className="m-6 h-64 rounded-xl" /> : <div key={project.id}>
        {activePage !== "blueprint" ? <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 sm:mx-8">
          <div><p className="text-xs font-bold text-brand-text">{project.code}</p><h2 className="font-extrabold">{project.name}</h2></div>
          <button type="button" className="min-h-9 rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:bg-surface-muted" onClick={() => onNavigate("projects")}>All projects</button>
        </div> : null}
        {children}
      </div>}
    </AppShell>
  )
}
