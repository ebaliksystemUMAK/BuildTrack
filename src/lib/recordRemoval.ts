import { useCallback, useEffect, useState } from "react"
import { supabase } from "./supabase"
import { cleanReason } from "./recycleBinModel"
import { parseRecordPreview, parseRemovable, parseRemoved, recordError, type RecordKind, type RecordPreview, type RemovableRecord, type RemovedRecord } from "./recordRemovalModel"

// Calls of the Super Admin "Records" screen. The database functions decide who may do what (Super Admin with the authenticator); nothing is enforced here.
export type RecordOutcome<T> = { data: T; error: ""; setup: false } | { data: null; error: string; setup: boolean }
const failure = <T,>(error: { message?: string; code?: string }): RecordOutcome<T> => { const found = recordError(error); return { data: null, error: found.message, setup: found.setup } }

export async function searchRecords(kind: RecordKind, query: string): Promise<RecordOutcome<RemovableRecord[]>> {
  const { data, error } = await supabase.rpc("search_removable_records", { p_kind: kind, p_query: query.trim() })
  if (error) return failure(error)
  const rows = parseRemovable(data)
  return rows ? { data: rows, error: "", setup: false } : { data: null, error: "The list could not be read. Try again.", setup: false }
}

export async function previewRecord(kind: RecordKind, id: string): Promise<RecordOutcome<RecordPreview>> {
  const { data, error } = await supabase.rpc("preview_record_removal", { p_kind: kind, p_id: id })
  if (error) return failure(error)
  const preview = parseRecordPreview(data)
  return preview ? { data: preview, error: "", setup: false } : { data: null, error: "The preview could not be read. Try again.", setup: false }
}

export async function removeRecord(input: { kind: RecordKind; id: string; reason: string; phrase: string }): Promise<RecordOutcome<{ removed: true; label: string }>> {
  const { data, error } = await supabase.rpc("remove_record", { p_kind: input.kind, p_id: input.id, p_reason: cleanReason(input.reason), p_confirm: input.phrase })
  return error ? failure(error) : { data: data as { removed: true; label: string }, error: "", setup: false }
}

export async function restoreRecord(kind: RecordKind, id: string): Promise<RecordOutcome<{ restored: true; label: string }>> {
  const { data, error } = await supabase.rpc("restore_record", { p_kind: kind, p_id: id })
  return error ? failure(error) : { data: data as { restored: true; label: string }, error: "", setup: false }
}

export function useRemovedRecords(enabled: boolean) {
  const [records, setRecords] = useState<RemovedRecord[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState("")
  const [setup, setSetup] = useState(false)
  const reload = useCallback(async () => {
    if (!enabled) { setRecords([]); setLoading(false); return }
    const { data, error: rpcError } = await supabase.rpc("get_removed_records")
    if (rpcError) {
      const found = recordError(rpcError)
      setError(found.setup ? "" : found.message); setSetup(found.setup); setRecords([]); setLoading(false)
      return
    }
    const rows = parseRemoved(data)
    setRecords(rows ?? []); setError(rows ? "" : "The removed records could not be read. Try again."); setSetup(false); setLoading(false)
  }, [enabled])
  useEffect(() => { void reload() }, [reload])
  return { records, loading, error, setup, reload }
}
