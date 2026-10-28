import { useCallback, useMemo } from "react"
import { useDefects, useInspections, useQaSummary, useTemplates } from "./qa"
import { useProjectWork } from "./projectWork"
import { useSettings } from "./settings"
import { useAuth } from "./auth"
import { useBlueprintAccess } from "./blueprintAccess"
import { ALL_TYPES, blueprintTypeLabels, canWorkType, recordLevel, sheetType, typeScopedRole } from "./blueprintTypes"

// Everything the QA screens of one project share, loaded once: project, team, pins, checklists, inspections, defects, summary and the
// company's pass mark and weights. `reloadAll` is called after every change so lists, counters and badges agree.
export function useQaWorkspace(projectId: string | null) {
  const work = useProjectWork(projectId)
  const { settings, loading: settingsLoading } = useSettings()
  const templates = useTemplates(projectId)
  const inspections = useInspections(projectId)
  const defects = useDefects(projectId)
  const summary = useQaSummary(projectId)
  const { reload: reloadTemplates } = templates
  const { reload: reloadInspections } = inspections
  const { reload: reloadDefects } = defects
  const { reload: reloadSummary } = summary
  const { reloadPins } = work
  const { profile } = useAuth()
  const scoped = typeScopedRole(profile?.role)
  const access = useBlueprintAccess(scoped ? projectId : null)

  const reloadAll = useCallback(async () => {
    await Promise.all([reloadTemplates(), reloadInspections(), reloadDefects(), reloadSummary(), reloadPins()])
  }, [reloadTemplates, reloadInspections, reloadDefects, reloadSummary, reloadPins])

  const foremen = useMemo(() => work.team.filter((member) => member.role === "foreman"), [work.team])
  // Per-type access (20261028130000): Engineers / Foremen act only on records of types they hold with Assigned work; View only
  // records stay readable without action buttons. Admins and Clients keep their role rules (always true here).
  const inspectionList = inspections.inspections
  const pinOf = useCallback((record: { pin_id?: string | null; inspection_id?: string | null }) =>
    record.pin_id ?? (record.inspection_id ? (inspectionList.find((row) => row.id === record.inspection_id)?.pin_id ?? null) : null), [inspectionList])
  const canActOn = useCallback((record: { pin_id?: string | null; inspection_id?: string | null }) => {
    if (!scoped || !profile) return true
    if (access.loading) return false
    return canWorkType(profile.role as "engineer" | "foreman", recordLevel(pinOf(record), work.pins, work.blueprints, (type) => access.levelFor(profile.id, type)))
  }, [scoped, profile, access, pinOf, work.pins, work.blueprints])
  // The blueprint type a record belongs to (for the View only note); null = project-wide.
  const typeLabelOf = useCallback((record: { pin_id?: string | null; inspection_id?: string | null }) => {
    const pin = work.pins.find((row) => row.id === pinOf(record))
    const sheet = pin ? work.blueprints.find((row) => row.id === pin.blueprint_id) : undefined
    return sheet ? blueprintTypeLabels[sheetType(sheet)] : null
  }, [pinOf, work.pins, work.blueprints])
  const holdsAnyWork = !scoped || !profile || ALL_TYPES.some((type) => access.levelFor(profile.id, type) === "assigned")
  const weights = settings.weights
  const threshold = settings.threshold

  return {
    projectId,
    work,
    project: work.project,
    nameOf: work.nameOf,
    today: work.today,
    foremen,
    weights,
    threshold,
    standards: settings.standards,
    templates: templates.templates,
    inspections: inspections.inspections,
    defects: defects.defects,
    summary: summary.summary,
    loading: work.loading || templates.loading || inspections.loading || defects.loading || settingsLoading,
    summaryLoading: summary.loading,
    error: templates.error || inspections.error || defects.error,
    reloadAll,
    reloadTemplates,
    canActOn,
    typeLabelOf,
    holdsAnyWork,
  }
}

export type QaWorkspace = ReturnType<typeof useQaWorkspace>
