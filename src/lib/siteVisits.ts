import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"
import { fetchAll } from "./paging"
import { byProject, useLiveReload, usePeriodicReload } from "./realtime"
import type { SiteVisit, SiteVisitDraft } from "./siteVisitsModel"

export function useSiteVisits(projectId: string | null) {
  const generation = useRef(0)
  const [state, setState] = useState<{ projectId: string | null; visits: SiteVisit[]; loading: boolean; error: string }>({ projectId: null, visits: [], loading: Boolean(projectId), error: "" })
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!projectId) { setState({ projectId: null, visits: [], loading: false, error: "" }); return }
    const result = await fetchAll<SiteVisit>((from, to) => supabase.from("site_visit_requests").select("*").eq("project_id", projectId)
      .order("created_at", { ascending: false }).order("id").range(from, to)).catch(() => ({ data: [], error: true }))
    if (run !== generation.current) return
    setState({ projectId, visits: result.error ? [] : result.data, loading: false, error: result.error ? "Could not load site visit requests. Please retry." : "" })
  }, [projectId])
  useEffect(() => { void reload(); return () => { generation.current++ } }, [reload])
  useLiveReload(byProject("site_visit_requests", projectId), () => void reload())
  usePeriodicReload(projectId ? `visits:${projectId}` : null, () => void reload())
  return { visits: state.projectId === projectId ? state.visits : [], loading: Boolean(projectId) && (state.loading || state.projectId !== projectId), error: state.projectId === projectId ? state.error : "", reload }
}

export async function requestSiteVisit(projectId: string, draft: SiteVisitDraft) {
  return supabase.from("site_visit_requests").insert({ project_id: projectId, preferred_at: `${draft.date}T${draft.time}:00+08:00`, purpose: draft.purpose.trim(), visitors: draft.visitors }).select("id").single()
}
export async function decideSiteVisit(visit: SiteVisit, status: "confirmed" | "declined" | "cancelled", note = "") {
  return supabase.from("site_visit_requests").update({ status, ...(status === "cancelled" ? {} : { engineer_note: note.trim() || null }) })
    .eq("project_id", visit.project_id).eq("id", visit.id).eq("status", visit.status).select("id")
}
