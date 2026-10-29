import type { ReactNode } from "react"
import AppShell from "../../components/shell/AppShell"
import { useAuth } from "../../lib/auth"
import { phaseLabels, useFieldProject } from "../../lib/projects"
import { useProjectManagers } from "../../lib/projectManagers"
import { myDesignation, slotShort } from "../../lib/projectManagerModel"
import type { AdminIconName } from "../Admin/AdminIcon"
import PmProjects from "./PmProjects"
import type { PmNavigate, PmPageKey } from "./types"

const labels: Record<PmPageKey, { label: string; icon: AdminIconName }> = {
  projects: { label: "My projects", icon: "building" },
  dashboard: { label: "Project dashboard", icon: "grid" },
  details: { label: "Project details", icon: "file" },
  team: { label: "Team & work access", icon: "users" },
  blueprints: { label: "Blueprints", icon: "blueprint" },
  calendar: { label: "Schedule & calendar", icon: "calendar" },
  quality: { label: "Quality & QA", icon: "clipboard" },
  attendance: { label: "Attendance", icon: "fingerprint" },
  reports: { label: "Reports & export", icon: "chart" },
  audit: { label: "Project audit log", icon: "history" },
}

// Project Manager workspace ("Project office"): first the assigned projects; inside one project the sidebar shows only that project's
// sections, like the Engineer and Foreman workspaces. Company administration stays in the Admin workspace.
export default function PmShell({ activePage, onNavigate, children }: { activePage: PmPageKey; onNavigate: PmNavigate; children: ReactNode }) {
  const { profile } = useAuth()
  const { projectId, project, notFound, mode } = useFieldProject(activePage)
  const { managers } = useProjectManagers(mode === "project" ? projectId : null)
  const inProject = mode === "project"
  const slot = project ? myDesignation(managers, project.id, profile?.id) : null
  const item = (key: PmPageKey) => ({ key, ...labels[key] })

  const banner = inProject && project?.archived_at ? (
    <div role="note" className="border-b border-line bg-surface-muted px-4 py-2 text-sm font-semibold text-fg">This project is archived: everything here is read-only. Ask an Admin to restore it.</div>
  ) : null

  return (
    <AppShell
      persona="manager"
      workspace="Project office"
      groups={inProject ? [
        { label: "Project", items: [item("dashboard"), item("details"), item("team"), item("calendar")] },
        { label: "Plans", items: [item("blueprints")] },
        { label: "Monitoring", items: [item("quality"), item("attendance")] },
        { label: "Records", items: [item("reports"), item("audit")] },
      ] : [{ label: "Workspace", items: [item("projects")] }]}
      active={inProject ? activePage : "projects"}
      onNavigate={(key) => onNavigate(key as PmPageKey)}
      project={inProject ? (project ? { code: project.code, name: project.name, sub: [phaseLabels[project.phase], slot ? `${slotShort[slot]} PM` : null, project.archived_at ? "Archived" : null].filter(Boolean).join(" • ") } : null) : undefined}
      onAllProjects={inProject ? () => onNavigate("projects") : undefined}
      mobileTabs={inProject ? ["dashboard", "team", "blueprints", "quality"] : []}
      banner={banner}
    >
      {inProject || activePage === "projects" ? children : <PmProjects onNavigate={onNavigate} notice={notFound ? "That project is not available: it was removed or is no longer assigned to you." : "Choose a project to open that page."} />}
    </AppShell>
  )
}
