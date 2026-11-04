import { useCallback, useEffect, useRef, useState } from "react"
import type { DailyReport } from "./reportFormat"
import { supabase } from "./supabase"
import { fetchAll } from "./paging"
import { byProject, useLiveReload, usePeriodicReload } from "./realtime"

export * from "./reportFormat"

const reportColumns = (withEntries: boolean): string => (withEntries ? "*,daily_report_entries(*)" : "*")

// Reports of one project, newest first. The database decides what the caller may see (own drafts, everyone's submitted reports).
// withEntries adds the task entries for the project team's pages; a Client's read of them returns nothing.
export function useDailyReports(projectId: string | null, withEntries = false) {
  const generation = useRef(0)
  const [reports, setReports] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(Boolean(projectId))
  const [error, setError] = useState("")
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!projectId) {
      setReports([])
      setError("")
      setLoading(false)
      setLoadedFor(null)
      return
    }
    const { data, error: loadError } = await fetchAll<DailyReport>((from, to) => supabase.from("daily_reports").select<string, DailyReport>(reportColumns(withEntries)).eq("project_id", projectId).order("report_date", { ascending: false }).order("id").range(from, to)).catch(() => ({ data: [] as DailyReport[], error: true }))
    if (run !== generation.current) return
    setError(loadError ? "Could not load the reports. Check your connection and try again." : "")
    setReports(loadError ? [] : data)
    setLoadedFor(projectId)
    setLoading(false)
  }, [projectId, withEntries])
  useEffect(() => {
    setReports([])
    setLoading(Boolean(projectId))
    void reload()
    return () => { generation.current++ }
  }, [reload, projectId])
  useLiveReload(byProject("daily_reports", projectId), reload)
  usePeriodicReload(projectId ? `reports:${projectId}` : null, () => void reload())
  return { reports: loadedFor === projectId ? reports : [], loading: loading || loadedFor !== projectId, error: loadedFor === projectId ? error : "", reload }
}

export type ProjectQuestion = {
  id: string
  project_id: string
  pin_id: string | null
  author_id: string
  question: string
  answer: string | null
  answered_by: string | null
  answered_at: string | null
  created_at: string
}

export function useQuestions(projectId: string | null) {
  const generation = useRef(0)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [questions, setQuestions] = useState<ProjectQuestion[]>([])
  const [loading, setLoading] = useState(Boolean(projectId))
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!projectId) {
      setQuestions([])
      setLoading(false)
      setError(""); setLoadedFor(null)
      return
    }
    const { data, error: loadError } = await fetchAll<ProjectQuestion>((from, to) => supabase.from("project_questions").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).order("id").range(from, to)).catch(() => ({ data: [] as ProjectQuestion[], error: true }))
    if (run !== generation.current) return
    setError(loadError ? "Could not load the questions. Check your connection and try again." : "")
    setQuestions(loadError ? [] : data)
    setLoadedFor(projectId)
    setLoading(false)
  }, [projectId])
  useEffect(() => {
    setQuestions([]); setError("")
    setLoading(Boolean(projectId))
    void reload()
    return () => { generation.current++ }
  }, [reload, projectId])
  useLiveReload(byProject("project_questions", projectId), reload)
  usePeriodicReload(projectId ? `questions:${projectId}` : null, () => void reload())
  return { questions: loadedFor === projectId ? questions : [], loading: loading || loadedFor !== projectId, error: loadedFor === projectId ? error : "", reload }
}
