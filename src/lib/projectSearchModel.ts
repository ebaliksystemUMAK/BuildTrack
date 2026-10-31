// Rules of the project search (pure, no network): what a search pattern looks like and where each kind of hit opens for each role.
// Tested in `pnpm test:lib`. The queries themselves are in projectSearch.ts.

export type SearchRole = "engineer" | "foreman" | "client"
export type HitKind = "pin" | "defect" | "inspection" | "log"
export type SearchHit = { key: string; kind: HitKind; id: string; title: string; sub: string; path: string }

export const hitGroups: Record<HitKind, string> = { pin: "Work pins", defect: "Defect reports", inspection: "Inspections", log: "Site logs" }

// LIKE wildcards in what the person typed are matched literally.
export function searchPattern(text: string): string {
  const clean = text.trim().replace(/[\\%_]/g, (match) => "\\" + match)
  return `%${clean}%`
}

export const canSearch = (text: string) => text.trim().length >= 2

// Where a hit opens, per role. Null when the role has no screen for it.
export function hitPath(role: SearchRole, kind: HitKind, id: string, projectId: string): string | null {
  const q = `project=${projectId}`
  if (kind === "pin") return role === "engineer" ? `/engineer/annotation?${q}&pin=${id}` : role === "foreman" ? `/foreman/dashboard?${q}&pin=${id}` : `/client/blueprint?${q}&pin=${id}`
  if (kind === "defect") return role === "engineer" ? `/engineer/qa?${q}&tab=defects&defect=${id}` : role === "foreman" ? `/foreman/issues?${q}&defect=${id}` : null
  if (kind === "inspection") return role === "engineer" ? `/engineer/qa?${q}&tab=inspections&inspection=${id}` : null
  return role === "engineer" ? `/engineer/reports?${q}&report=${id}` : role === "foreman" ? `/foreman/daily-report?${q}&report=${id}` : `/client/site-logs?${q}&report=${id}`
}

