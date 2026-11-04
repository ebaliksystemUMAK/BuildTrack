import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"
import { usePeriodicReload } from "./realtime"
import type { TimelineData } from "./projectTimelineModel"

export function useProjectTimeline(projectId: string | null) {
  const generation = useRef(0)
  const [state, setState] = useState<{
    projectId: string | null
    data: TimelineData | null
    error: string
    loading: boolean
    setupRequired?: boolean
  }>({ projectId, data: null, error: "", loading: Boolean(projectId) })
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!projectId) {
      setState({ projectId, data: null, error: "", loading: false })
      return
    }
    try {
      const { data, error } = await supabase.rpc("get_project_timeline", {
        p_project: projectId,
      })
      if (run !== generation.current) return
      setState({
        projectId,
        data: error ? null : data as TimelineData,
        loading: false,
        setupRequired: Boolean(error && /PGRST202|42883/.test(error.code ?? "")),
        error: error
          ? /PGRST202|42883/.test(error.code ?? "")
            ? "Gantt scheduling is ready for setup. Your administrator needs to enable the timeline before it can be used."
            : error.message
          : "",
      })
    } catch {
      if (run === generation.current)
        setState({
          projectId,
          data: null,
          loading: false,
          error:
            "Could not load the timeline. Check your connection and retry.",
        })
    }
  }, [projectId])
  useEffect(() => {
    setState({ projectId, data: null, error: "", loading: Boolean(projectId) })
    void reload()
    return () => {
      generation.current++
    }
  }, [projectId, reload])
  usePeriodicReload(projectId ? `timeline:${projectId}` : null, reload)
  const current = state.projectId === projectId
  return {
    data: current ? state.data : null,
    error: current ? state.error : "",
    loading: !current || state.loading,
    setupRequired: current && Boolean(state.setupRequired),
    reload,
  }
}
