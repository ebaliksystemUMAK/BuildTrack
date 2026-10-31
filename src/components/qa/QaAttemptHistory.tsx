import { useState } from "react"
import type { useWorkQaHistory } from "../../lib/qaAttempts"
import { itemSubmissions, qaRecordPath } from "../../lib/qaAttemptsModel"
import { formatStamp } from "../../lib/blueprints"
import { inspectionStatusLabels, inspectionTone, refNumber } from "../../lib/qa"
import { useAuth } from "../../lib/auth"
import { useProjectTeam } from "../../lib/projects"
import { followLink } from "../../lib/notifications"
import { checklistAttemptNumber, checklistGroups, submittedChecklistItems } from "../../lib/qaChecklistModel"
import { PhotoGrid } from "../PhotoGallery"
import { buttonSecondary, inputClass } from "../ui/PageParts"
import Modal from "../Modal"

export default function QaAttemptHistory({ history, projectId, itemId, currentInspectionId, onOpen }: {
  history: ReturnType<typeof useWorkQaHistory>; projectId: string; itemId?: string; currentInspectionId?: string; onOpen?: (id: string) => void
}) {
  const { profile } = useAuth()
  const { team } = useProjectTeam(projectId)
  const [selectedId,setSelectedId] = useState<string | null>(null)
  const [filter,setFilter]=useState("")
  const [selectedChecklist,setSelectedChecklist]=useState("")
  const nameOf = (id: string | null) => team.find(row => row.user_id === id)?.full_name ?? (id ? "Project team member" : "System")
  const rows = itemId ? itemSubmissions(history.submissions, itemId) : history.submissions
  const groups=checklistGroups(rows,itemId)
  const visibleGroups=groups.filter(group=>!filter || group.key===filter)
  const selected=rows.find(row=>row.id===selectedId)
  const inspectionOf=(id:string)=>history.inspections.find(row=>row.id===id)
  const labelOf=(row:typeof rows[number],key?:string)=>{
    const number=checklistAttemptNumber(rows,row,itemId,key)
    return number ? "Resubmission "+number : "Original request"
  }
  const inspection=selected ? inspectionOf(selected.inspection_id) : null
  const checklist=selected ? submittedChecklistItems(selected,itemId,selectedChecklist) : []
  const selectedItems=new Set(checklist.map(item=>item.id))
  const photos=selected?.photos_snapshot.filter(p=>selectedItems.has(p.checklist_item_id ?? "")) ?? []
  const attempts=history.attempts.filter(a=>a.submitted_inspection_id===selected?.inspection_id && selectedItems.has(a.item_id))
  const ref=inspection ? refNumber("ir",inspection.number) : "Inspection"
  if (history.loading) return <p role="status" className="text-xs">Loading request history…</p>
  if (history.error) return <p role="alert" className="text-xs text-danger-fg">{history.error}</p>
  if (!rows.length) return null
  return <section className="mt-3 min-w-0 space-y-2" aria-label="QA request history">
    <h4 className="text-sm font-bold">QA requests · original and resubmissions</h4>
    {!itemId ? <label className="block space-y-1 text-xs font-bold">Filter by task name<select value={filter} onChange={event=>setFilter(event.target.value)} className={inputClass} aria-label="Filter QA history by task name"><option value="">All task names</option>{groups.map(group=><option key={group.key} value={group.key}>{group.name} ({group.rows.length} requests)</option>)}</select></label> : null}
    {visibleGroups.map(group=><section key={group.key} className="space-y-2 rounded-xl border border-line p-2" aria-label={group.name+" request history"}>
    <h5 className="break-words text-sm font-extrabold text-brand-text">{group.name} <span className="text-xs font-normal text-fg-muted">· {group.rows.length} request(s)</span></h5>
    <ul className="grid min-w-0 gap-2" style={{gridTemplateColumns:"repeat(auto-fill,minmax(min(100%,15rem),1fr))"}}>
      {group.rows.map(row=>{
        const record=inspectionOf(row.inspection_id)
        return <li key={row.id} className="min-w-0"><button type="button" aria-haspopup="dialog" onClick={()=>{setSelectedId(row.id);setSelectedChecklist(group.key)}} className={"flex h-full w-full min-w-0 flex-col gap-2 rounded-xl border p-3 text-left transition hover:border-brand hover:shadow-sm focus-visible:outline-brand "+(currentInspectionId===row.inspection_id ? "border-brand bg-brand-soft" : "border-line bg-surface")}>
          <span className="flex w-full flex-wrap items-center justify-between gap-2"><strong className="text-sm">{record ? refNumber("ir",record.number) : "Inspection"}</strong><span className={"rounded-full px-2 py-0.5 text-xs font-bold "+(record ? inspectionTone[record.status] : "bg-surface-muted")}>{record ? inspectionStatusLabels[record.status] : "Recorded"}</span></span>
          <span className="text-sm font-bold">{labelOf(row,group.key)}</span>
          <span className="text-xs font-bold text-brand-text">{group.name}</span>
          <span className="text-xs text-fg-muted">{formatStamp(row.submitted_at)}</span>
          <span className="text-xs text-fg-muted">{submittedChecklistItems(row,itemId,group.key).length} task(s) · {row.photos_snapshot.filter(p=>submittedChecklistItems(row,itemId,group.key).some(c=>c.id===p.checklist_item_id)).length} photo(s)</span>
          <span className="text-xs font-bold text-brand-text">View request details →</span>
        </button></li>
      })}
    </ul>
    </section>)}
    {!visibleGroups.length ? <p role="status" className="text-xs text-fg-muted">No requests match this task name.<button type="button" className="ml-1 font-bold underline" onClick={()=>setFilter("")}>Show all</button></p> : null}
    {selected ? <Modal title={checklist.map(item=>item.text).join(" / ")+" · "+ref+" · "+labelOf(selected,selectedChecklist)} description={"Submitted "+formatStamp(selected.submitted_at)+" by "+nameOf(selected.submitted_by)} size="2xl" onClose={()=>setSelectedId(null)} footer={<>
      <button type="button" className={buttonSecondary} onClick={()=>setSelectedId(null)}>Close details</button>
      {selected.inspection_id!==currentInspectionId ? <button type="button" className={buttonSecondary} onClick={()=>{setSelectedId(null);onOpen ? onOpen(selected.inspection_id) : followLink(qaRecordPath(profile?.role==="engineer" ? "engineer" : "foreman",projectId,"inspection",selected.inspection_id),projectId)}}>Open inspection</button> : null}
    </>}>
      <div className="min-w-0 space-y-4">
        <p className="rounded-lg bg-surface-muted p-3 text-sm">{inspection ? inspectionStatusLabels[inspection.status] : "Recorded"}. These photos and remarks belong only to this request. Later corrections do not change them.</p>
        {submittedChecklistItems(selected).length>checklist.length ? <p className="text-xs text-fg-muted">This request also contained other tasks. Only this item's remarks and photos are shown here.</p> : null}
        {inspection?.reinspection_of ? <p className="text-xs text-fg-muted">Follows {inspectionOf(inspection.reinspection_of) ? refNumber("ir",inspectionOf(inspection.reinspection_of)!.number) : "an earlier inspection"}.</p> : null}
        <section className="space-y-2" aria-label="Submitted remarks"><h3 className="text-sm font-bold">Tasks and remarks</h3>{checklist.map(c=><div key={c.id} className="rounded-lg border border-line p-3 text-sm"><strong>{c.text}</strong><p className="whitespace-pre-wrap break-words">{c.remark || "No Foreman remark recorded for this request."}</p>{c.remark_at ? <p className="text-xs text-fg-muted">Saved {formatStamp(c.remark_at)}</p> : null}</div>)}</section>
        {attempts.map(a=><p key={a.id} className="text-xs text-fg-muted">Correction holder opened {formatStamp(a.created_at)} · saved {formatStamp(a.updated_at)}</p>)}
        <section aria-label="Submitted photos" className="space-y-2"><h3 className="text-sm font-bold">Photos for {ref}</h3><PhotoGrid bucket="pin-photos" photos={photos.map(p=>({...p,label:ref+" evidence",requestLabel:ref,recordState:"snapshot",uploaderName:nameOf(p.uploaded_by ?? null),checklist:checklist.find(c=>c.id===p.checklist_item_id) ?? null}))} emptyHint="No photos captured in this request." /></section>
      </div>
    </Modal> : null}
  </section>
}
