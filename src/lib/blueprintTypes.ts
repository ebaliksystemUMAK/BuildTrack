// Blueprint types and per-type access (20261028130000). Pure rules shared by the plan browser, the editor and the Admin
// access editor; the database enforces the same rules (tested in scripts/test-blueprint-access.mjs and test:sql).

export type ClassifiedType = "architectural" | "civil_structural" | "electrical" | "mechanical" | "plumbing_sanitary"
export type BlueprintType = ClassifiedType
export type AccessLevel = "none" | "view" | "assigned"
export type AccessGrant = { project_id: string; user_id: string; blueprint_type: BlueprintType; access_level: Exclude<AccessLevel, "none">; updated_at?: string }
export type BrowserRole = "admin" | "engineer" | "foreman" | "client"

// Order shown everywhere.
export const BLUEPRINT_TYPES: ClassifiedType[] = ["architectural", "civil_structural", "electrical", "mechanical", "plumbing_sanitary"]
export const ALL_TYPES: BlueprintType[] = BLUEPRINT_TYPES

export const blueprintTypeLabels: Record<BlueprintType, string> = {
  architectural: "Architectural",
  civil_structural: "Civil / Structural",
  electrical: "Electrical",
  mechanical: "Mechanical",
  plumbing_sanitary: "Plumbing / Sanitary",
}

export const blueprintTypeHints: Record<BlueprintType, string> = {
  architectural: "Floor plans, elevations, sections and finishes",
  civil_structural: "Foundations, framing, slabs and site works",
  electrical: "Power, lighting and panel layouts",
  mechanical: "Air-conditioning, ventilation and equipment",
  plumbing_sanitary: "Water supply, drainage and fixtures",
}

export const accessLabels: Record<AccessLevel, string> = { none: "No access", view: "View only", assigned: "Assigned work access" }
export const ACCESS_LEVELS: AccessLevel[] = ["none", "view", "assigned"]

export const isBlueprintType = (value: unknown): value is BlueprintType => typeof value === "string" && (ALL_TYPES as string[]).includes(value)

// Engineers and Foremen follow the per-type grants; Admins and Clients keep their whole-project rules.
export const typeScopedRole = (role: string | null | undefined): role is "engineer" | "foreman" => role === "engineer" || role === "foreman"

export function levelOf(grants: AccessGrant[], userId: string | null | undefined, projectId: string | null | undefined, type: BlueprintType): AccessLevel {
  if (!userId || !projectId) return "none"
  return grants.find((g) => g.user_id === userId && g.project_id === projectId && g.blueprint_type === type)?.access_level ?? "none"
}

export function levelsFor(grants: AccessGrant[], userId: string, projectId: string): Record<BlueprintType, AccessLevel> {
  return Object.fromEntries(ALL_TYPES.map((type) => [type, levelOf(grants, userId, projectId, type)])) as Record<BlueprintType, AccessLevel>
}

// What a role may do with a type. Admin uploads come from blueprints.manage (canManage), never from a grant.
export const canEditType = (role: BrowserRole, level: AccessLevel) => role === "engineer" && level === "assigned"
export const canUploadType = (role: BrowserRole, level: AccessLevel, canManage = false) => (role === "admin" ? canManage : canEditType(role, level))
export const canWorkType = (role: BrowserRole, level: AccessLevel) => typeScopedRole(role) && level === "assigned"

export function accessBadge(role: BrowserRole, level: AccessLevel, canManage = false): string {
  if (role === "admin") return canManage ? "Upload and manage" : "View only"
  if (role === "client") return "View only"
  return accessLabels[level]
}

export type TypeCard = { type: BlueprintType; label: string; hint: string; count: number; level: AccessLevel; badge: string }
type SheetLike = { blueprint_type?: BlueprintType | null; discipline?: string | null }

// A sheet's type. Before 20261028130000 sheets had no type: they are filed the way that migration files them
// (Architectural stays Architectural, everything else Civil / Structural).
export const sheetType = (sheet: SheetLike): BlueprintType => sheet.blueprint_type ?? (sheet.discipline === "architectural" ? "architectural" : "civil_structural")

// The cards on Project > Blueprints: a type appears once it has a plan (uploads with a type choice add new ones).
// Engineers / Foremen additionally need access to the type (No access is hidden, never shown read-only).
export function typeCards(input: { role: BrowserRole; sheets: SheetLike[]; grants: AccessGrant[]; userId: string | null; projectId: string | null; canManage?: boolean }): TypeCard[] {
  const counts = new Map<BlueprintType, number>()
  for (const sheet of input.sheets) counts.set(sheetType(sheet), (counts.get(sheetType(sheet)) ?? 0) + 1)
  return ALL_TYPES.flatMap((type) => {
    const count = counts.get(type) ?? 0
    const level: AccessLevel = typeScopedRole(input.role) ? levelOf(input.grants, input.userId, input.projectId, type) : "view"
    const shown = count > 0 && (!typeScopedRole(input.role) || level !== "none")
    return shown ? [{ type, label: blueprintTypeLabels[type], hint: blueprintTypeHints[type], count, level, badge: accessBadge(input.role, level, input.canManage) }] : []
  })
}

// Columns of the Admin access editor: the types this project has plans in, plus any type someone still holds (so that
// access can always be taken away again, e.g. after its last plan moved to another type).
export function accessColumns(sheets: SheetLike[], grants: AccessGrant[]): BlueprintType[] {
  const used = new Set<BlueprintType>([...sheets.map(sheetType), ...grants.map((g) => g.blueprint_type)])
  return ALL_TYPES.filter((type) => used.has(type))
}

export function accessSummary(levels: Partial<Record<BlueprintType, AccessLevel>>): string {
  const of = (wanted: AccessLevel) => ALL_TYPES.filter((type) => levels[type] === wanted).map((type) => blueprintTypeLabels[type])
  const assigned = of("assigned")
  const view = of("view")
  const parts = [assigned.length ? `Assigned work: ${assigned.join(", ")}` : "", view.length ? `View only: ${view.join(", ")}` : ""].filter(Boolean)
  return parts.length ? parts.join(" · ") : "No blueprint access yet"
}

// Asked before saving a change that takes something away; null = nothing to confirm.
export function downgradeWarning(role: "engineer" | "foreman", type: BlueprintType, from: AccessLevel, to: AccessLevel): string | null {
  if (from !== "assigned" || to === "assigned") return to === "none" && from === "view" ? `${blueprintTypeLabels[type]} plans and their records are hidden from them.` : null
  const label = blueprintTypeLabels[type]
  const lost = role === "foreman"
    ? `They can no longer report progress, add evidence or submit corrections on ${label} work. Their open ${label} work pins are unassigned so the Engineer can reassign them; completed work keeps their name.`
    : `They can no longer edit ${label} plans, manage tasks and QC checklists, inspect or verify ${label} work. Records they signed stay attributed to them.`
  return to === "none" ? `${lost} ${label} plans are hidden from them.` : lost
}

// ?btype= in a link opens that type's plans directly (only if the person may see it).
export function readTypeParam(search: string): BlueprintType | null {
  const value = new URLSearchParams(search).get("btype")
  return isBlueprintType(value) ? value : null
}

// Types a person may upload new plans into from a view without a fixed type.
export function uploadTypes(role: BrowserRole, levelFor: (type: BlueprintType) => AccessLevel, canManage = false): ClassifiedType[] {
  return BLUEPRINT_TYPES.filter((type) => canUploadType(role, levelFor(type), canManage))
}

// Unsaved edits in the access editor: person -> type -> level. Only real differences from what is saved count.
export type AccessDraft = Record<string, Partial<Record<BlueprintType, AccessLevel>>>
export type AccessChange = { userId: string; type: BlueprintType; from: AccessLevel; to: AccessLevel }
export function accessChanges(grants: AccessGrant[], draft: AccessDraft, projectId: string): AccessChange[] {
  return Object.entries(draft).flatMap(([userId, levels]) =>
    ALL_TYPES.flatMap((type) => {
      const to = levels[type]
      const from = levelOf(grants, userId, projectId, type)
      return to && to !== from ? [{ userId, type, from, to }] : []
    }),
  )
}

// The level a person holds on a QA record (inspection, NCR, work item): its pin's sheet type. A record without a pin is
// project-wide: the best level over all types (as the database's blueprint_access_level with no type). A pin that is not
// loaded (hidden from this person) gives "none". Mirrors SQL record_blueprint_scope.
export function recordLevel(
  pinId: string | null | undefined,
  pins: { id: string; blueprint_id: string }[],
  sheets: { id: string; blueprint_type?: BlueprintType | null; discipline?: string | null }[],
  levelFor: (type: BlueprintType) => AccessLevel,
): AccessLevel {
  if (!pinId) {
    const levels = ALL_TYPES.map(levelFor)
    return levels.includes("assigned") ? "assigned" : levels.includes("view") ? "view" : "none"
  }
  const pin = pins.find((row) => row.id === pinId)
  const sheet = pin ? sheets.find((row) => row.id === pin.blueprint_id) : undefined
  return sheet ? levelFor(sheetType(sheet)) : "none"
}
