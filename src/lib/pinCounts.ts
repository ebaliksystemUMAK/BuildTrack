import { useEffect, useState } from "react"
import { supabase } from "./supabase"
import { useLiveReload } from "./realtime"
import { useAuth } from "./auth"

// Live counts for sidebar badges (what the database says, never fixed numbers). Row Level Security limits them to the
// signed-in person's projects. Refreshed live when a pin changes, when the page changes, on focus and every minute.
// With a project, only that project is counted (Engineer project workspaces). Engineers / Foremen count only sheets of the
// blueprint types they hold with Assigned work (20261028130000): View only work never shows up as waiting for them.
export function usePinCounts(refreshKey: string, projectId: string | null = null) {
  const [counts, setCounts] = useState({ review: 0, issue: 0 })
  const [tick, setTick] = useState(0)
  const { profile } = useAuth()
  const scoped = profile?.role === "engineer" || profile?.role === "foreman"
  useLiveReload([{ table: "pins" }], () => setTick((value) => value + 1))
  useEffect(() => {
    let active = true
    const load = async () => {
      let sheets: string[] | null = null
      if (scoped) {
        const { data, error } = await supabase.rpc("scoped_blueprint_ids", { p_work: true })
        if (!error) sheets = ((data ?? []) as string[]).filter(Boolean)
      }
      const count = async (status: "for_review" | "issue") => {
        if (sheets && !sheets.length) return { count: 0 }
        let query = supabase.from("pins").select("id", { count: "exact", head: true }).eq("status", status).neq("category", "note")
        if (projectId) query = query.eq("project_id", projectId)
        return sheets ? query.in("blueprint_id", sheets) : query
      }
      const [review, issue] = await Promise.all([count("for_review"), count("issue")])
      if (active) setCounts({ review: review.count ?? 0, issue: issue.count ?? 0 })
    }
    void load()
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 60_000)
    window.addEventListener("focus", load)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener("focus", load)
    }
  }, [refreshKey, tick, projectId, scoped])
  return counts
}
