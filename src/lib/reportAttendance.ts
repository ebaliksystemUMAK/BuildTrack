import { useCallback, useEffect, useRef, useState } from "react"
import { byProject, useLiveReload, usePeriodicReload } from "./realtime"
import { supabase } from "./supabase"

export function useReportAttendance(projectId: string | null, day: string, enabled = true) {
  const scope = enabled && projectId ? `${projectId}:${day}` : ""
  const generation = useRef(0)
  const [state, setState] = useState<{ scope: string; count: number | null; error: string }>({ scope: "", count: null, error: "" })
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!scope) { setState({ scope: "", count: null, error: "" }); return }
    try {
      const { data, error } = await supabase.rpc("daily_report_biometric_headcount", { p_project: projectId, p_day: day })
      if (run !== generation.current) return
      if (error || typeof data !== "number" || !Number.isInteger(data) || data < 0) throw new Error("Headcount unavailable")
      setState({ scope, count: data, error: "" })
    } catch {
      if (run === generation.current) setState({ scope, count: null, error: "Could not load biometric headcount. Retry before saving or submitting." })
    }
  }, [scope, projectId, day])
  useEffect(() => { void reload(); return () => { generation.current++ } }, [reload])
  useLiveReload(enabled ? byProject("biometric_attendance_events", projectId) : [], () => void reload())
  usePeriodicReload(scope ? `report-headcount:${scope}` : null, () => void reload())
  return { count: state.scope === scope ? state.count : null, error: state.scope === scope ? state.error : "", loading: Boolean(scope) && state.scope !== scope, reload }
}
