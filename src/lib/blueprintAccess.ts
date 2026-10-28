import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"
import type { AccessGrant, AccessLevel, BlueprintType } from "./blueprintTypes"
import { blueprintTypeLabels, canWorkType, levelOf, recordLevel, sheetType } from "./blueprintTypes"
import { useBlueprints } from "./blueprints"
import { usePeriodicReload } from "./realtime"

// Per-type grants of one project (20261028130000). Row Level Security returns every grant of the project to its staff
// and Admins, and only their own to anyone else; Clients get none (they are not type-restricted).
export function useBlueprintAccess(projectId: string | null) {
  const generation = useRef(0)
  const [state, setState] = useState<{ projectId: string | null; grants: AccessGrant[]; error: string }>({ projectId: null, grants: [], error: "" })
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!projectId) {
      setState({ projectId, grants: [], error: "" })
      return
    }
    const { data, error } = await supabase
      .from("project_blueprint_access")
      .select("project_id, user_id, blueprint_type, access_level, updated_at")
      .eq("project_id", projectId)
      .order("user_id")
      .order("blueprint_type")
    if (run !== generation.current) return
    setState({ projectId, grants: error ? [] : ((data ?? []) as AccessGrant[]), error: error ? "Could not load blueprint access. Check your connection and retry." : "" })
  }, [projectId])
  useEffect(() => {
    void reload()
    return () => {
      generation.current++
    }
  }, [reload])
  usePeriodicReload(projectId ? `blueprint-access:${projectId}` : null, () => void reload())
  const current = state.projectId === projectId
  const grants = current ? state.grants : []
  const levelFor = useCallback((userId: string | null | undefined, type: BlueprintType): AccessLevel => levelOf(grants, userId, projectId, type), [grants, projectId])
  return { grants, loading: Boolean(projectId) && !current, error: current ? state.error : "", reload, levelFor, setGrants: (next: AccessGrant[]) => setState({ projectId, grants: next, error: "" }) }
}

// Admin (projects.manage + MFA): change one person's level on one or more types in one step.
export async function saveBlueprintAccess(projectId: string, userId: string, levels: Partial<Record<BlueprintType, AccessLevel>>) {
  const { error } = await supabase.rpc("set_blueprint_access", { p_project: projectId, p_user: userId, p_levels: levels })
  if (error) throw new Error(error.code === "42501" ? "You need the Projects permission (with MFA) to change blueprint access." : error.message)
}

// Can the signed-in Engineer / Foreman act on this work pin? With View only on its plan's type the work stays readable
// without action buttons. Admins and Clients are not type-restricted (their role rules decide).
export function usePinTypeAccess(pin: { id: string; project_id: string; blueprint_id: string } | null, role: string | null | undefined, userId: string | null | undefined) {
  const scoped = role === "engineer" || role === "foreman"
  const projectId = scoped && pin ? pin.project_id : null
  const access = useBlueprintAccess(projectId)
  const { blueprints } = useBlueprints(projectId)
  const sheet = blueprints.find((row) => row.id === pin?.blueprint_id)
  if (!scoped) return { canAct: true, viewOnly: false, typeLabel: null as string | null }
  const level = recordLevel(pin?.id, pin ? [pin] : [], blueprints, (type) => access.levelFor(userId, type))
  const canAct = !access.loading && Boolean(pin) && canWorkType(role as "engineer" | "foreman", level)
  return { canAct, viewOnly: !access.loading && Boolean(sheet) && !canAct, typeLabel: sheet ? blueprintTypeLabels[sheetType(sheet)] : null }
}
