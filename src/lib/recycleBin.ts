import { useCallback, useEffect, useState } from "react"
import { invokeFunction } from "./functions"
import { supabase } from "./supabase"
import { binError, cleanReason, parsePreview, parsePurgePreview, parseRecycleBin, parseRestore, type PurgePreview, type RemovalPreview, type RemovedProject, type RestoreResult } from "./recycleBinModel"

// Calls of the project recycle bin. The database functions decide who may do what (Admin with the Projects permission, or a Super Admin, with the authenticator).
export type BinOutcome<T> = { data: T; error: ""; setup: false } | { data: null; error: string; setup: boolean }
const failure = <T,>(error: { message?: string; code?: string }): BinOutcome<T> => { const found = binError(error); return { data: null, error: found.message, setup: found.setup } }

export async function previewRemoval(projectId: string): Promise<BinOutcome<RemovalPreview>> {
  const { data, error } = await supabase.rpc("preview_project_removal", { p_project: projectId })
  if (error) return failure(error)
  const preview = parsePreview(data)
  return preview ? { data: preview, error: "", setup: false } : { data: null, error: "The preview could not be read. Try again.", setup: false }
}

export async function removeProject(input: { projectId: string; reason: string; code: string }): Promise<BinOutcome<{ removed: true; code: string }>> {
  const { data, error } = await supabase.rpc("remove_project", { p_project: input.projectId, p_reason: cleanReason(input.reason), p_confirm: input.code })
  return error ? failure(error) : { data: data as { removed: true; code: string }, error: "", setup: false }
}

export async function restoreProject(input: { projectId: string; newCode: string }): Promise<BinOutcome<RestoreResult>> {
  const { data, error } = await supabase.rpc("restore_removed_project", { p_project: input.projectId, p_new_code: input.newCode.trim().toUpperCase() || null })
  if (error) return failure(error)
  const result = parseRestore(data)
  return result ? { data: result, error: "", setup: false } : { data: null, error: "The result could not be read. Check the project list.", setup: false }
}

// Permanent deletion: Super Admin only. The preview is a database function; the deletion itself is the `purge-project` Edge Function (it also removes the plan files).
export async function previewPurge(projectId: string): Promise<BinOutcome<PurgePreview>> {
  const { data, error } = await supabase.rpc("preview_project_purge", { p_project: projectId })
  if (error) return failure(error)
  const preview = parsePurgePreview(data)
  return preview ? { data: preview, error: "", setup: false } : { data: null, error: "The check could not be read. Try again.", setup: false }
}

export async function purgeProject(input: { projectId: string; phrase: string }): Promise<BinOutcome<{ purged: true; code: string; files_removed: number; files_failed: number }>> {
  const result = await invokeFunction<{ purged: true; code: string; files_removed: number; files_failed: number }>("purge-project", { project_id: input.projectId, confirm: input.phrase })
  if (result.error || !result.data) return { data: null, error: result.error ?? "The project could not be deleted.", setup: /not deployed yet/i.test(result.error ?? "") }
  return { data: result.data, error: "", setup: false }
}

// The removed projects. Loaded only for a person who may use the bin (`enabled`), so other Admins do not trigger a refusal on every visit.
export function useRecycleBin(enabled: boolean) {
  const [projects, setProjects] = useState<RemovedProject[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState("")
  const [setup, setSetup] = useState(false)
  const reload = useCallback(async () => {
    if (!enabled) { setProjects([]); setLoading(false); return }
    const { data, error: rpcError } = await supabase.rpc("get_recycle_bin")
    if (rpcError) {
      const found = binError(rpcError)
      setError(found.setup ? "" : found.message); setSetup(found.setup); setProjects([]); setLoading(false)
      return
    }
    const rows = parseRecycleBin(data)
    setProjects(rows ?? []); setError(rows ? "" : "The recycle bin could not be read. Try again."); setSetup(false); setLoading(false)
  }, [enabled])
  useEffect(() => { void reload() }, [reload])
  return { projects, loading, error, setup, reload }
}
