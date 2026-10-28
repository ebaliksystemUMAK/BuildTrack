import { useCallback, useEffect, useState } from "react"
import { supabase } from "./supabase"
import { loadAttendanceWorkers, loadDailyAttendance, loadDailyStatus, loadWorkerAttendance } from "./foremanAttendanceData"

let sequence = 0
function useAttendanceResource<T>(project: string, key: string, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" })
  useEffect(() => {
    let active = true, running = false, again = false
    let debounce: number | undefined
    async function refresh() {
      if (!active) return
      if (running) { again = true; return }
      running = true
      try {
        const data = await load()
        if (active) setState({ key, data, error: "" })
      } catch (problem) {
        if (active) setState({ key, data: null, error: problem instanceof Error ? problem.message : "Attendance is unavailable. Retrying automatically." })
      } finally {
        running = false
        if (active && again) { again = false; void refresh() }
      }
    }
    const changed = () => {
      if (!active) return
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void refresh(), 200)
    }
    void refresh()
    const channel = supabase.channel(`foreman-workers-${++sequence}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_workers", filter: `project_id=eq.${project}` }, changed)
      .on("postgres_changes", { event: "*", schema: "public", table: "biometric_attendance_events", filter: `project_id=eq.${project}` }, changed)
      .subscribe()
    const timer = window.setInterval(() => void refresh(), 15000)
    const visible = () => { if (!document.hidden) changed() }
    window.addEventListener("online", changed)
    document.addEventListener("visibilitychange", visible)
    return () => {
      active = false
      window.clearTimeout(debounce)
      window.clearInterval(timer)
      window.removeEventListener("online", changed)
      document.removeEventListener("visibilitychange", visible)
      void supabase.removeChannel(channel)
    }
  }, [project, key, load])
  const current = state.key === key
  return { data: current ? state.data : null, error: current ? state.error : "", loading: !current || (!state.data && !state.error) }
}

export function useAttendanceWorkers(project: string, search: string, page: number) {
  const term = search.trim()
  const load = useCallback(() => loadAttendanceWorkers(project, term, page), [project, term, page])
  return useAttendanceResource(project, JSON.stringify(["workers", project, term, page]), load)
}
export function useDailyAttendance(project: string, day: string, page: number) {
  const load = useCallback(() => loadDailyAttendance(project, day, page), [project, day, page])
  return useAttendanceResource(project, JSON.stringify(["daily", project, day, page]), load)
}
export function useDailyStatus(project: string, day: string) {
  const load = useCallback(() => loadDailyStatus(project, day), [project, day])
  return useAttendanceResource(project, JSON.stringify(["status", project, day]), load)
}
export function useWorkerAttendance(project: string, worker: string, day: string, page: number) {
  const load = useCallback(() => loadWorkerAttendance(project, worker, day, page), [project, worker, day, page])
  return useAttendanceResource(project, JSON.stringify(["worker", project, worker, day, page]), load)
}
