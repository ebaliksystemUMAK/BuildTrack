import { useEffect, useState, type ReactNode } from "react"
import FieldProjects from "../../components/FieldProjects"
import SampleNotice from "../../components/SampleNotice"
import AppShell from "../../components/shell/AppShell"
import { useAuth } from "../../lib/auth"
import { useQaBadge } from "../../lib/qaLite"
import { phaseLabels, useFieldProject } from "../../lib/projects"
import type { AdminIconName } from "../Admin/AdminIcon"
import type { ForemanNavigate, ForemanPageKey } from "./types"

const labels: Record<ForemanPageKey, { label: string; icon: AdminIconName }> = {
  projects: { label: "My projects", icon: "building" },
  dashboard: { label: "Dashboard", icon: "grid" },
  calendar: { label: "Project Calendar", icon: "calendar" },
  "daily-work": { label: "My Work", icon: "blueprint" },
  "daily-report": { label: "Daily Progress Report", icon: "file" },
  "photo-documentation": { label: "Photo Documentation", icon: "camera" },
  "quality-control": { label: "Tasks", icon: "clipboard" },
  issues: { label: "Corrections", icon: "edit" },
  "qa-workflow": { label: "QC Checklist Reference", icon: "check" },
  attendance: { label: "Workforce Management", icon: "users" },
}

const samplePages: ForemanPageKey[] = []

// First the Foreman's assigned projects; inside a project, the sidebar shows only that project's sections (and its own badges).
export default function ForemanShell({
  activePage,
  onNavigate,
  children,
}: {
  activePage: ForemanPageKey
  onNavigate: ForemanNavigate
  children: ReactNode
}) {
  const { profile } = useAuth()
  const { projectId, project, notFound, mode } = useFieldProject(activePage)
  const inProject = mode === "project"
  const qaCount = useQaBadge("foreman", profile?.id ?? null, activePage, projectId)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const clock = `${now.toLocaleString("en-PH", { timeZone: "Asia/Manila", weekday: "short", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })} PHT`
  const item = (key: ForemanPageKey) => ({ key, ...labels[key], badge: inProject && key === "issues" ? qaCount || undefined : undefined })

  return (
    <AppShell
      persona="foreman"
      workspace="Field operations"
      groups={inProject ? [
        { label: "Today", items: [item("dashboard"), item("calendar"), item("daily-work"), item("daily-report"), item("photo-documentation")] },
        { label: "Quality", items: [item("quality-control"), item("issues"), item("qa-workflow")] },
        { label: "Crew", items: [item("attendance")] },
      ] : [{ label: "Workspace", items: [item("projects")] }]}
      active={inProject ? activePage : "projects"}
      onNavigate={(key) => onNavigate(key as ForemanPageKey)}
      project={inProject ? (project ? { code: project.code, name: project.name, sub: phaseLabels[project.phase] } : null) : undefined}
      onAllProjects={inProject ? () => onNavigate("projects") : undefined}
      mobileTabs={inProject ? ["dashboard", "daily-work", "quality-control", "issues"] : []}
      topExtra={<time className="hidden whitespace-nowrap text-xs font-semibold text-fg-muted xl:block">{clock}</time>}
      banner={inProject && samplePages.includes(activePage) ? <SampleNotice /> : null}
    >
      {inProject || activePage === "projects" ? children : <FieldProjects role="foreman" notice={notFound ? "That project is not available: it was removed or is no longer assigned to you." : "Choose a project to open that page."} />}
    </AppShell>
  )
}
