import { useEffect, useRef } from "react"
import { supabase } from "./supabase"

// Live updates (migration 0034). A hook subscribes to database changes on the tables it shows and reloads itself, so a foreman's
// report appears in the engineer's queue, a verification moves the client's progress and a failed inspection's NCR reaches the
// foreman without anyone refreshing. Supabase Realtime applies Row Level Security: nobody hears about a row they cannot read.
// Not used inside the blueprint editor, whose optimistic edits and undo stack must not be replaced mid-gesture.

export type LiveTable =
  | "blueprints" | "blueprint_revisions" | "site_issue_reports" | "site_issue_photos" | "site_issue_photo_revisions"
  | "pins" | "pin_events" | "pin_photos" | "pin_checklist_items" | "daily_report_photos"
  | "qa_inspections" | "qa_inspection_items" | "qa_defects" | "qa_defect_events" | "qa_photos"
  | "client_snags" | "snag_photos" | "daily_reports" | "project_questions" | "notifications" | "site_visit_requests"
  | "daily_report_revisions" | "biometric_daily_totals" | "biometric_attendance_events"
  | "qa_work_attempts" | "qa_inspection_events" | "pin_qa_submissions"

// `filter` uses the Realtime syntax, for example "project_id=eq.<uuid>".
export type LiveSource = { table: LiveTable; filter?: string }

export const byProject = (table: LiveTable, projectId: string | null): LiveSource[] => (projectId ? [{ table, filter: `project_id=eq.${projectId}` }] : [])
export const byColumn = (table: LiveTable, column: string, value: string | null): LiveSource[] => (value ? [{ table, filter: `${column}=eq.${value}` }] : [])

let channelSeq = 0

// Recover when a Realtime connection was missed/interrupted. Reads only; never replays writes.
export function usePeriodicReload(key: string | null, onReload: () => void, intervalMs = 15000) {
  const latest = useRef(onReload)
  useEffect(() => { latest.current = onReload })
  useEffect(() => {
    if (!key) return
    const refresh = () => { if (!document.hidden) latest.current() }
    const timer = window.setInterval(refresh, intervalMs)
    window.addEventListener("online", refresh)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("online", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [key, intervalMs])
}

// Calls `onChange` (debounced, so a burst of changes means one reload) whenever a listed table changes. No sources = no listener.
export function useLiveReload(sources: LiveSource[], onChange: () => void, delayMs = 400) {
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  const key = sources.map((source) => `${source.table}${source.filter ? `?${source.filter}` : ""}`).join("|")

  useEffect(() => {
    if (!key) return
    let timer: number | undefined
    const fire = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => latest.current(), delayMs)
    }
    const channel = supabase.channel(`live-${++channelSeq}`)
    for (const part of key.split("|")) {
      const [table, filter] = part.split("?")
      channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, fire)
    }
    channel.subscribe()
    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [key, delayMs])
}
