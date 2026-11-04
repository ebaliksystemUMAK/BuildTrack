import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"
import { fetchAll } from "./paging"
import { byColumn, byProject, useLiveReload, usePeriodicReload } from "./realtime"
import type { Defect } from "./qa"
import type { Snag } from "./snags"
import type { SiteIssueReport } from "./siteIssues"
import type { DailyReport, ProjectQuestion } from "./reports"
import type { PanelRole } from "./pinRecordsModel"

export type PinRecords = { defects: Defect[]; snags: Snag[]; issues: SiteIssueReport[]; reports: DailyReport[]; questions: ProjectQuestion[] }
const none: PinRecords = { defects: [], snags: [], issues: [], reports: [], questions: [] }

// Every record stored against one blueprint pin, by its permanent id, complete (paged) and live. Row Level Security still decides
// what each person reads; the role only skips tables a role never sees (clients: no QA or site issues; Foremen: no client reports
// or client questions). A late answer for the previous pin is dropped.
export function usePinRecords(pin: { id: string; project_id: string } | null, role: PanelRole | null) {
  const pinId = pin?.id ?? null
  const projectId = pin?.project_id ?? null
  const [records, setRecords] = useState<PinRecords>(none)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState("")
  const sequence = useRef(0)
  const staff = role === "engineer" || role === "foreman" || role === "admin"
  const seesClientReports = role === "engineer" || role === "admin" || role === "client"
  const seesQuestions = role === "engineer" || role === "client"
  const reload = useCallback(async () => {
    const run = ++sequence.current
    if (!pinId || !role) { setRecords(none); setLoadedFor(null); setError(""); return }
    const skip = <T,>() => Promise.resolve({ data: [] as T[], error: false })
    const safe = <T,>(load: Promise<{ data: T[]; error: boolean }>) => load.catch(() => ({ data: [] as T[], error: true }))
    const [defects, snags, issues, reports, questions] = await Promise.all(([
      staff ? fetchAll<Defect>((from, to) => supabase.from("qa_defects").select("*").eq("pin_id", pinId).order("number", { ascending: false }).range(from, to)) : skip<Defect>(),
      seesClientReports ? fetchAll<Snag>((from, to) => supabase.from("client_snags").select("*").eq("pin_id", pinId).order("number", { ascending: false }).range(from, to)) : skip<Snag>(),
      staff ? fetchAll<SiteIssueReport>((from, to) => supabase.from("site_issue_reports").select("*").eq("pin_id", pinId).order("created_at", { ascending: false }).order("id").range(from, to)) : skip<SiteIssueReport>(),
      fetchAll<DailyReport>((from, to) => {
        let query = supabase.from("daily_reports").select<string, DailyReport>(staff ? "*,daily_report_entries(*)" : "*").eq("project_id", projectId as string).contains("linked_work", JSON.stringify([{ pin_id: pinId }]))
        if (role === "client") query = query.eq("status", "submitted")
        return query.order("report_date", { ascending: false }).order("id").range(from, to)
      }),
      seesQuestions ? fetchAll<ProjectQuestion>((from, to) => supabase.from("project_questions").select("*").eq("pin_id", pinId).order("created_at", { ascending: false }).order("id").range(from, to)) : skip<ProjectQuestion>(),
    ] as Array<Promise<{ data: unknown[]; error: boolean }>>).map(safe) as [Promise<{ data: Defect[]; error: boolean }>, Promise<{ data: Snag[]; error: boolean }>, Promise<{ data: SiteIssueReport[]; error: boolean }>, Promise<{ data: DailyReport[]; error: boolean }>, Promise<{ data: ProjectQuestion[]; error: boolean }>])
    if (run !== sequence.current) return
    const failed = [defects, snags, issues, reports, questions].some((result) => result.error)
    setError(failed ? "Some records of this pin could not be loaded. Retry before acting on them." : "")
    setRecords({ defects: defects.data as Defect[], snags: snags.data as Snag[], issues: issues.data as SiteIssueReport[], reports: reports.data as DailyReport[], questions: questions.data as ProjectQuestion[] })
    setLoadedFor(pinId)
  }, [pinId, projectId, role, staff, seesClientReports, seesQuestions])
  useEffect(() => {
    setRecords(none); setLoadedFor(null); setError("")
    void reload()
    return () => { sequence.current++ }
  }, [reload])
  useLiveReload([
    ...(staff ? byColumn("qa_defects", "pin_id", pinId) : []), ...(staff ? byColumn("site_issue_reports", "pin_id", pinId) : []),
    ...(seesClientReports ? byColumn("client_snags", "pin_id", pinId) : []), ...(seesQuestions ? byColumn("project_questions", "pin_id", pinId) : []),
    ...byProject("daily_reports", projectId),
  ], () => void reload())
  usePeriodicReload(pinId && role ? `pin-records:${pinId}` : null, () => void reload())
  const current = loadedFor === pinId
  return { records: current ? records : none, loading: Boolean(pinId) && !current, error: current ? error : "", reload }
}

// The assigned Foreman's field problem: written to the pin timeline and sent to the project Engineers (report_field_problem).
export async function reportFieldProblem(pinId: string, itemId: string | null, note: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const { error } = await supabase.rpc("report_field_problem", { p_pin: pinId, p_item: itemId, p_note: note.trim() })
    return error ? { ok: false, message: error.message } : { ok: true }
  } catch {
    return { ok: false, message: "Connection interrupted. Check the pin's Activity before sending it again." }
  }
}
