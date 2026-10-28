// Which checklists a project uses, and the documentation of the standards they cite (20261028150000). Pure rules, tested in
// scripts/test-project-checklists.mjs.

type ChecklistLike = { project_id: string | null; archived: boolean; description: string | null; work_item_criteria?: boolean; qa_template_items: unknown[]; name: string }
export type CatalogStandard = { code: string; title: string; source?: string }
export type CitedStandard = { code: string; title: string | null; source: string | null }

// Each work item's criteria are stored as a hidden copy; before the flag existed they were recognised by this description.
export const WORK_ITEM_CRITERIA_NOTE = "Criteria defined by the Engineer with the work checklist item"
export const isWorkItemCriteria = (t: Pick<ChecklistLike, "work_item_criteria" | "description" | "project_id">) =>
  t.work_item_criteria ?? (t.project_id !== null && t.description === WORK_ITEM_CRITERIA_NOTE)

// The checklists the Engineer added to this project (from the library or new): what Checklist configuration lists.
export function projectChecklists<T extends ChecklistLike>(templates: T[], projectId: string | null, includeArchived = false): T[] {
  if (!projectId) return []
  return templates.filter((t) => t.project_id === projectId && !isWorkItemCriteria(t) && (includeArchived || !t.archived))
}

// What a work item or an inspection request may use: the project's own checklists that have criteria.
export const pickableChecklists = <T extends ChecklistLike>(templates: T[], projectId: string | null): T[] =>
  projectChecklists(templates, projectId).filter((t) => t.qa_template_items.length > 0)

export const libraryChecklists = <T extends ChecklistLike>(templates: T[], includeArchived = false): T[] =>
  templates.filter((t) => t.project_id === null && (includeArchived || !t.archived))

// A library checklist counts as added when the project has a live checklist of the same name (older copies end in "(copy)").
export function addedToProject(library: Pick<ChecklistLike, "name">, project: ChecklistLike[]): boolean {
  const name = library.name.trim().toLowerCase()
  return project.some((t) => !t.archived && [name, `${name} (copy)`].includes(t.name.trim().toLowerCase()))
}

// The documentation of what a checklist cites: each code with its catalog title and official source, in the checklist's order.
// A code missing from today's catalog is kept (title null) so old citations never disappear.
export function citedStandards(codes: string[], catalog: CatalogStandard[]): CitedStandard[] {
  const seen = new Set<string>()
  return codes.flatMap((raw) => {
    const code = raw.trim()
    const key = code.toLowerCase()
    if (!code || seen.has(key)) return []
    seen.add(key)
    const entry = catalog.find((s) => s.code.trim().toLowerCase() === key)
    return [{ code, title: entry?.title ?? null, source: entry?.source ?? null }]
  })
}

// The exact clauses the criteria point to (Reference / specification clause), each once, in order.
export function clauseReferences(items: { reference?: string | null }[]): string[] {
  return [...new Set(items.map((item) => item.reference?.trim() ?? "").filter(Boolean))]
}

// Short label for a source link ("bps.dti.gov.ph"); never throws on a malformed value.
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
