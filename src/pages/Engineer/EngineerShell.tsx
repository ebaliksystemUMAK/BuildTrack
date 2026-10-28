import type { ReactNode } from "react"
import FieldProjects from "../../components/FieldProjects"
import AppShell from "../../components/shell/AppShell"
import { useAuth } from "../../lib/auth"
import { usePinCounts } from "../../lib/pinCounts"
import { useQaBadge } from "../../lib/qaLite"
import { phaseLabels, useFieldProject } from "../../lib/projects"
import type { AdminIconName } from "../Admin/AdminIcon"
import type { EngineerNavigate, EngineerPageKey } from "./types"

const labels: Record<EngineerPageKey, { label: string; icon: AdminIconName }> = {
  projects: { label: "My projects", icon: "building" },
  dashboard: { label: "Project dashboard", icon: "grid" },
  calendar: { label: "Project Calendar", icon: "calendar" },
  "project-blueprint": { label: "Blueprints", icon: "blueprint" },
  annotation: { label: "Plan Editor", icon: "pin" },
  verification: { label: "Quality & reviews", icon: "clipboard" }, // legacy route only
  "report-issue": { label: "Issue Register", icon: "close" },
  progress: { label: "Progress by Zone", icon: "chart" },
  assignments: { label: "Assignment Board", icon: "users" },
  reports: { label: "Site Logs & Reports", icon: "file" },
  qa: { label: "Quality & reviews", icon: "clipboard" },
  checklists: { label: "Checklist Configuration", icon: "settings" },
}

// First the Engineer's assigned projects; inside a project, the sidebar shows only that project's sections (and its own badges).
export default function EngineerShell({
  activePage,
  onNavigate,
  children,
}: {
  activePage: EngineerPageKey
  onNavigate: EngineerNavigate
  children: ReactNode
}) {
  const { profile } = useAuth()
  const { projectId, project, notFound, mode } = useFieldProject(activePage)
  const inProject = mode === "project"
  const counts = usePinCounts(activePage, projectId)
  const qaCount = useQaBadge("engineer", profile?.id ?? null, activePage, projectId)
  const badge = (key: EngineerPageKey) => (!inProject ? 0 : key === "report-issue" ? counts.issue : key === "qa" ? counts.review + qaCount : 0) || undefined
  const item = (key: EngineerPageKey) => ({ key, ...labels[key], badge: badge(key) })

  return (
    <AppShell
      persona="engineer"
      workspace="Engineering office"
      groups={inProject ? [
        { label: "Project", items: [item("dashboard"), item("calendar")] },
        { label: "Plans", items: [item("project-blueprint")] },
        { label: "Field & quality", items: [item("qa"), item("checklists"), item("report-issue"), item("progress")] },
        { label: "Team & reports", items: [item("assignments"), item("reports")] },
      ] : [{ label: "Workspace", items: [item("projects")] }]}
      active={inProject ? activePage : "projects"}
      onNavigate={(key) => onNavigate(key as EngineerPageKey)}
      project={inProject ? (project ? { code: project.code, name: project.name, sub: phaseLabels[project.phase] } : null) : undefined}
      onAllProjects={inProject ? () => onNavigate("projects") : undefined}
      mobileTabs={inProject ? ["dashboard", "qa", "project-blueprint"] : []}
    >
      {inProject || activePage === "projects" ? children : <FieldProjects role="engineer" notice={notFound ? "That project is not available: it was removed or is no longer assigned to you." : "Choose a project to open that page."} />}
    </AppShell>
  )
}
