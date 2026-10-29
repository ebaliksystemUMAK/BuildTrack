export const projectSections = {
  "project-overview": "overview",
  "blueprint-upload": "blueprints",
  "blueprint-mapping": "mapping",
  "blueprint-progress": "progress",
  "blueprint-version": "versions",
  calendar: "calendar",
} as const

export type ProjectSection = keyof typeof projectSections

export function readProjectRoute(path: string): { projectId: string; section: ProjectSection } | null {
  const match = path.match(/^\/admin\/projects\/([0-9a-f-]+)\/(overview|blueprints|mapping|progress|versions|calendar)\/?$/i)
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match[1])) return null
  const section = (Object.keys(projectSections) as ProjectSection[]).find((key) => projectSections[key] === match[2])
  return section ? { projectId: match[1], section } : null
}

export function projectPath(projectId: string, section: ProjectSection = "project-overview") {
  return `/admin/projects/${encodeURIComponent(projectId)}/${projectSections[section]}`
}

// Engineer, Foreman and Project Manager work one project at a time: "projects" is the list of their assigned projects (no project
// context); every other page belongs to the selected project, which travels in ?project= so each project stays separate and shareable.
export type FieldRole = "engineer" | "foreman" | "pm"
export const FIELD_PROJECT_LIST = "projects"

// Project Manager workspace pages (/pm/<page>?project=<id>).
export const PM_WORKSPACE_ROLES = ["project_manager"] as const
export const PM_PAGES = ["projects", "dashboard", "details", "team", "blueprints", "calendar", "quality", "attendance", "reports", "audit"] as const
export type PmPage = (typeof PM_PAGES)[number]
export const isPmPage = (value: string): value is PmPage => (PM_PAGES as readonly string[]).includes(value)

// A Project Manager who opens an Admin project link (shared plan / pin links, older notifications) lands on the same place in
// their own workspace. Returns null when the link has no Project Manager equivalent.
const adminSectionToPm: Record<string, { page: PmPage; tab?: string }> = {
  "project-overview": { page: "dashboard" },
  "blueprint-upload": { page: "blueprints" },
  "blueprint-mapping": { page: "blueprints", tab: "mapping" },
  "blueprint-progress": { page: "blueprints", tab: "progress" },
  "blueprint-version": { page: "blueprints", tab: "versions" },
  calendar: { page: "calendar" },
}
export function adminToPmPath(pathname: string, search: string): string | null {
  const route = readProjectRoute(pathname)
  const key = route ? route.section : pathname.replace(/^\/admin\//, "").replace(/\/$/, "")
  const target = adminSectionToPm[key]
  if (!target) return null
  const params = new URLSearchParams(search)
  const projectId = route?.projectId ?? params.get("project")
  if (!projectId) return null
  params.set("project", projectId)
  if (target.tab) params.set("tab", target.tab)
  params.delete("list")
  return `/pm/${target.page}?${params.toString()}`
}

export function fieldPagePath(role: FieldRole, page: string, projectId: string | null) {
  return page === FIELD_PROJECT_LIST || !projectId ? `/${role}/${page}` : `/${role}/${page}?project=${encodeURIComponent(projectId)}`
}

// Which sidebar a field workspace shows: the project list, or the sections of one project.
export function fieldShellMode(input: { page: string; projectId: string | null; notFound: boolean }): "list" | "project" {
  return input.page === FIELD_PROJECT_LIST || !input.projectId || input.notFound ? "list" : "project"
}
