import { useCallback, useEffect, useRef, useState } from "react"
import { usePeriodicReload } from "./realtime"
import { supabase } from "./supabase"
import { fieldShellMode, projectPath, readProjectRoute } from "./projectRoutes"

export type Discipline = "civil_structural" | "architectural" | "mep"
export type ProjectPhase = "plan_review" | "team_briefing" | "mobilization" | "execution"
export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled"

export type Project = {
  id: string
  code: string
  name: string
  location: string | null
  client_name: string | null
  description: string | null
  phase: ProjectPhase
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  manager_name: string | null
  lead_engineer_id: string | null
  lead_foreman_id: string | null
  disciplines: Discipline[]
  site_lat: number | null
  site_lng: number | null
  site_radius_m: number
  archived_at?: string | null
  archived_by?: string | null
  created_at: string
}

export type ProjectMember = {
  project_id: string
  user_id: string
  member_role: "engineer" | "foreman" | "client"
}

export const phaseLabels: Record<ProjectPhase, string> = {
  plan_review: "Plan review",
  team_briefing: "Team briefing",
  mobilization: "Mobilization",
  execution: "Execution",
}

export const statusLabels: Record<ProjectStatus, string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  cancelled: "Cancelled",
}

export const disciplineLabels: Record<Discipline, string> = {
  civil_structural: "Civil & Structural",
  architectural: "Architectural",
  mep: "MEP",
}

export const statusColor: Record<ProjectStatus, string> = {
  planning: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  active: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  on_hold: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  completed: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-200",
  cancelled: "bg-gray-200 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200",
}

// Row Level Security decides what comes back: Admins see all, everyone else only assigned projects.
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false })
    setError(loadError ? "Could not load projects. Check your connection and try again." : "")
    setProjects((data as Project[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { projects, loading, error, reload }
}

// ---- Selected project (which project's workspace the user is looking at) ----
// Kept in the URL (?project=<id>, shareable) and mirrored in sessionStorage so sidebar links keep the context.
const SELECTED_KEY = "buildtrack.project"

export function getSelectedProjectId(): string | null {
  if (window.location.pathname.replace(/\/$/, "") === "/client/projects") return null
  const route = readProjectRoute(window.location.pathname)
  if (route) return route.projectId
  const fromUrl = new URLSearchParams(window.location.search).get("project")
  if (fromUrl) return fromUrl
  if (window.location.pathname.startsWith("/admin/")) return null
  try {
    return sessionStorage.getItem(SELECTED_KEY)
  } catch {
    return null
  }
}

export type ProjectRole = "engineer" | "foreman" | "client" | "admin" | "project_manager"

// Where each role lands after picking a project card (Engineer / Foreman / Project Manager: that project's own dashboard).
const workspacePath: Record<ProjectRole, string> = {
  admin: "/admin/project-overview",
  project_manager: "/pm/dashboard",
  engineer: "/engineer/dashboard",
  foreman: "/foreman/dashboard",
  client: "/client/overview",
}

// Mirror of the selected project in sessionStorage (null forgets it, e.g. back on the project list or after sign-out).
export function rememberProject(projectId: string | null) {
  try {
    if (projectId) sessionStorage.setItem(SELECTED_KEY, projectId)
    else sessionStorage.removeItem(SELECTED_KEY)
  } catch {
    // sessionStorage unavailable: the URL parameter still carries the selection.
  }
}

export function openProject(role: ProjectRole, projectId: string) {
  rememberProject(projectId)
  window.history.pushState({}, "", role === "admin" ? projectPath(projectId) : `${workspacePath[role]}?project=${projectId}`)
  window.scrollTo({ top: 0 })
  window.dispatchEvent(new PopStateEvent("popstate")) // makes App re-read the path
}

// Assigned-project shells: on the project list there is no project; elsewhere the page belongs to the selected project.
// A project that is missing or not assigned (Row Level Security hides it) sends the person back to the list.
export function useFieldProject(page: string) {
  const selected = page === "projects" ? null : getSelectedProjectId()
  const { project, loading, notFound } = useProject(selected)
  useEffect(() => {
    if (page === "projects") rememberProject(null)
    else if (project) rememberProject(project.id)
  }, [page, project])
  return { projectId: selected, project, loading, notFound, mode: fieldShellMode({ page, projectId: selected, notFound }) }
}

export function useProject(projectId: string | null) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(Boolean(projectId))
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setProject(null)
      setLoading(false)
      setNotFound(false)
      return
    }
    let active = true
    setLoading(true)
    supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setProject((data as Project | null) ?? null)
        setNotFound(!data) // RLS hides projects the user is not assigned to
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [projectId])

  return { project, loading, notFound }
}

// can_take_work: set by the plan editor for Foremen (false = no Assigned work access to the open sheet's type).
export type TeamMember = { user_id: string; full_name: string; role: "engineer" | "foreman" | "client"; is_lead: boolean; can_take_work?: boolean }

// Who is on a project (names and roles only). The database decides if the caller may see it.
export function useProjectTeam(projectId: string | null) {
  const generation = useRef(0)
  const [state, setState] = useState<{ projectId: string | null; team: TeamMember[]; error: string }>({ projectId: null, team: [], error: "" })
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!projectId) { setState({ projectId, team: [], error: "" }); return }
    try {
      const { data, error } = await supabase.rpc("get_project_team", { pid: projectId })
      if (run === generation.current) setState({ projectId, team: error ? [] : (data ?? []) as TeamMember[], error: error ? "Could not load the project team. Retry before assigning work." : "" })
    } catch {
      if (run === generation.current) setState({ projectId, team: [], error: "Could not load the project team. Retry before assigning work." })
    }
  }, [projectId])
  useEffect(() => { void reload(); return () => { generation.current++ } }, [reload])
  usePeriodicReload(projectId ? `team:${projectId}` : null, () => void reload())
  const current = state.projectId === projectId
  return { team: current ? state.team : [], loading: Boolean(projectId) && !current, error: current ? state.error : "", reload }
}
