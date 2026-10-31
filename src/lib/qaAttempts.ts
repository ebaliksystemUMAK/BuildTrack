import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"
import { fetchAll } from "./paging"
import { byColumn, byProject, useLiveReload } from "./realtime"
import type { Inspection } from "./qa"
import type { WorkQaSubmission, WorkQaAttempt, QaEvent } from "./qaAttemptsModel"

type SubmissionIndex = Pick<WorkQaSubmission,"id"|"inspection_id"|"pin_id"|"item_ids"|"checklist_snapshot"|"submitted_at">
export function useQaSubmissionIndex(projectId:string|null) {
  const [rows,setRows]=useState<SubmissionIndex[]>([])
  const [loading,setLoading]=useState(Boolean(projectId))
  const [error,setError]=useState("")
  const sequence=useRef(0)
  const reload=useCallback(async()=>{
    const run=++sequence.current
    if(!projectId) {setRows([]);setLoading(false);return}
    try {
      const result=await fetchAll<SubmissionIndex>((from,to)=>supabase.from("pin_qa_submissions").select("id,inspection_id,pin_id,item_ids,checklist_snapshot,submitted_at").eq("project_id",projectId).order("submitted_at").order("id").range(from,to))
      if(run!==sequence.current) return
      setRows(result.error ? [] : result.data)
      setError(result.error ? "Could not load task report names. Refresh to retry." : "")
    } catch {if(run===sequence.current) {setRows([]);setError("Could not load task report names. Refresh to retry.")}}
    finally {if(run===sequence.current) setLoading(false)}
  },[projectId])
  useEffect(()=>{setRows([]);setError("");setLoading(Boolean(projectId));void reload();return()=>{sequence.current++}},[reload,projectId])
  useLiveReload(byProject("pin_qa_submissions",projectId),()=>void reload())
  return {rows,loading,error,reload}
}

export function useInspectionTimeline(inspectionId: string) {
  const [events, setEvents] = useState<QaEvent[]>([])
  const [error, setError] = useState("")
  const seq = useRef(0)
  const reload = useCallback(async () => {
    const run = ++seq.current
    const result = await fetchAll<QaEvent>((from, to) => supabase.from("qa_inspection_events").select("*").eq("inspection_id", inspectionId).order("created_at").order("id").range(from, to))
    if (run !== seq.current) return
    setEvents(result.data); setError(result.error ? "Could not load the inspection timeline." : "")
  }, [inspectionId])
  useEffect(() => { setEvents([]); setError(""); void reload(); return () => { seq.current++ } }, [reload])
  useLiveReload(byColumn("qa_inspection_events", "inspection_id", inspectionId), () => void reload())
  return { events, error }
}

export function useWorkQaHistory(pinId: string | null) {
  const [submissions, setSubmissions] = useState<WorkQaSubmission[]>([])
  const [attempts, setAttempts] = useState<WorkQaAttempt[]>([])
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [events, setEvents] = useState<QaEvent[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(Boolean(pinId))
  const seq = useRef(0)
  const reload = useCallback(async () => {
    const run = ++seq.current
    if (!pinId) { setLoading(false); return }
    try {
      const [s, a, i] = await Promise.all([
        fetchAll<WorkQaSubmission>((from, to) => supabase.from("pin_qa_submissions").select("*").eq("pin_id", pinId).order("submitted_at").order("id").range(from, to)),
        fetchAll<WorkQaAttempt>((from, to) => supabase.from("qa_work_attempts").select("*").eq("pin_id", pinId).order("created_at").order("id").range(from, to)),
        fetchAll<Inspection>((from, to) => supabase.from("qa_inspections").select("*").eq("pin_id", pinId).order("number").range(from, to)),
      ])
      if (s.error || a.error || i.error) throw new Error("Could not load QA attempts. Refresh before submitting or reviewing.")
      const timeline: QaEvent[] = []
      for (let index = 0; index < i.data.length; index += 100) {
        const ids = i.data.slice(index, index + 100).map(row => row.id)
        const result = await fetchAll<QaEvent>((from, to) => supabase.from("qa_inspection_events").select("*").in("inspection_id", ids).order("created_at").order("id").range(from, to))
        if (result.error) throw new Error("Could not load the inspection timeline.")
        timeline.push(...result.data)
      }
      if (run !== seq.current) return
      setSubmissions(s.data); setAttempts(a.data); setInspections(i.data); setEvents(timeline); setError("")
    } catch (e) { if (run === seq.current) setError((e as Error).message) }
    finally { if (run === seq.current) setLoading(false) }
  }, [pinId])
  useEffect(() => {
    setSubmissions([]); setAttempts([]); setInspections([]); setEvents([]); setError(""); setLoading(Boolean(pinId)); void reload()
    return () => { seq.current++ }
  }, [reload, pinId])
  useLiveReload([...byColumn("qa_work_attempts", "pin_id", pinId), ...byColumn("qa_inspections", "pin_id", pinId), ...byColumn("pin_qa_submissions", "pin_id", pinId), ...(pinId ? [{ table: "qa_inspection_events" as const }] : [])], () => void reload())
  return { submissions, attempts, inspections, events, loading, error, reload }
}
