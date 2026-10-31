import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase"
import { formatStamp, type ChecklistItem, type PinPhoto } from "../../lib/blueprints"
import { PhotoGrid } from "../PhotoGallery"
import { checklistGroups, submittedChecklistItems } from "../../lib/qaChecklistModel"
import { inputClass } from "../ui/PageParts"

type Submission = { submitted_by: string; submitted_at: string; all_complete: boolean; item_ids?: string[] | null; checklist_snapshot: ChecklistItem[]; photos_snapshot: PinPhoto[] }
export function useWorkSubmission(inspectionId: string) {
  const [submission, setSubmission] = useState<Submission | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  useEffect(() => {
    let active = true
    setLoading(true)
    void supabase.from("pin_qa_submissions").select("*").eq("inspection_id", inspectionId).maybeSingle().then(({ data, error }) => {
      if (!active) return
      setSubmission(data as Submission | null)
      setError(error?.message ?? "")
      setLoading(false)
    })
    return () => { active = false }
  }, [inspectionId])
  return { submission, loading, error }
}

export default function WorkSubmissionEvidence({ record }: { record: ReturnType<typeof useWorkSubmission> }) {
  const { submission, loading, error } = record
  const [filter,setFilter]=useState("")
  const groups=submission ? checklistGroups([submission]) : []
  const shownGroups=groups.filter(group=>!filter || group.key===filter)
  if (loading) return <p role="status">Loading submission evidence…</p>
  if (error) return <p role="alert" className="text-danger-fg">Submission evidence unavailable: {error}</p>
  if (!submission) return null
  return <section className="space-y-3 rounded-xl border border-line p-3">
    <h3 className="font-bold">Foreman submission — {submission.item_ids ? `${submission.item_ids.length} task(s) for review` : submission.all_complete ? "all tasks submitted" : "selected tasks submitted"}</h3>
    <p className="text-xs text-fg-muted">Submitted {formatStamp(submission.submitted_at)}. This immutable snapshot is evidence, not an Engineer Pass. Inspect against approved drawings, project specifications and the configured criteria in the QC Checklist tab.</p>
    {groups.length>1 ? <label className="block space-y-1 text-xs font-bold">Task name<select className={inputClass} aria-label="Filter submission evidence by task name" value={filter} onChange={event=>setFilter(event.target.value)}><option value="">All task names</option>{groups.map(group=><option key={group.key} value={group.key}>{group.name}</option>)}</select></label> : null}
    {shownGroups.map(group=>{
      const items=submittedChecklistItems(submission,undefined,group.key)
      return <section key={group.key} className="space-y-3 rounded-xl border border-line p-3" aria-label={group.name+" submitted evidence"}><h4 className="font-bold text-brand-text">{group.name}</h4>
    <ul className="space-y-2">{items.map(item => <li key={item.id} className="text-sm">
      <strong>Ready: {item.text}</strong>
      {item.remark ? <p className="whitespace-pre-wrap text-fg-muted">{item.remark}</p> : null}
    </li>)}</ul>
    <PhotoGrid bucket="pin-photos" emptyHint="No photos were attached for this task." photos={submission.photos_snapshot.filter(photo=>items.some(item=>item.id===photo.checklist_item_id)).map(photo => ({
      ...photo, label: "Submitted work evidence",recordState:"snapshot", checklist: submission.checklist_snapshot.find(item => item.id === photo.checklist_item_id) ?? null,
    }))} />
    </section>})}
    {!filter && submission.photos_snapshot.some(photo=>!submittedChecklistItems(submission).some(item=>item.id===photo.checklist_item_id)) ? <section className="space-y-2 rounded-xl border border-line p-3"><h4 className="font-bold">Other historical work evidence</h4><PhotoGrid bucket="pin-photos" emptyHint="No other evidence." photos={submission.photos_snapshot.filter(photo=>!submittedChecklistItems(submission).some(item=>item.id===photo.checklist_item_id)).map(photo=>({...photo,label:"Other submitted work evidence",recordState:"snapshot",checklist:submission.checklist_snapshot.find(item=>item.id===photo.checklist_item_id) ?? null}))} /></section> : null}
    <p className="text-sm font-semibold">After QA passes and linked NCRs are closed, the Engineer clicks Complete task for each item. The work pin completes after all tasks are completed and all QA requirements are clear.</p>
  </section>
}
