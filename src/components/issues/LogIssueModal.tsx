import { useRef, useState, type FormEvent } from "react"
import Modal from "../Modal"
import { buttonDanger, buttonSecondary, inputClass } from "../ui/PageParts"
import PinLinkPicker from "../ui/PinLinkPicker"
import { severityLabels, useChecklist, type Pin, type PinSeverity } from "../../lib/blueprints"
import { severityOrder } from "../../lib/progress"
import { logSiteIssue, type IssuePhotoDraft } from "../../lib/siteIssues"
import { pinLinkProblem, startPinLink, type PickSheet, type PinLink } from "../../lib/pinPickerModel"
import IssuePhotoPicker from "./IssuePhotoPicker"

// A site issue always belongs to one work pin (and optionally one of its checklist items). From a pin panel the pin is chosen
// already; from the issue register the Engineer picks the sheet, searches the pin and picks the item.
export default function LogIssueModal({pins,sheets,sheetOf,initialPinId,initialItemId,onClose,onDone}:{pins:Pin[];sheets?:PickSheet[];sheetOf:(id:string)=>string;initialPinId?:string;initialItemId?:string;onClose:()=>void;onDone:()=>Promise<void>}) {
  const candidates=pins.filter(pin=>pin.status!=="verified" && pin.category!=="note")
  const projectId=candidates[0]?.project_id ?? pins[0]?.project_id ?? ""
  const sheetList:PickSheet[]=sheets ?? [...new Set(candidates.map(pin=>pin.blueprint_id))].map(id=>({id,title:sheetOf(id)}))
  const [link,setLink]=useState<PinLink>(()=>startPinLink(candidates,initialPinId,initialItemId))
  const checklist=useChecklist(link.pinId || null)
  const linkProblem=pinLinkProblem(link,{projectId,pins:candidates,items:checklist.items,requirePin:true,itemsLoading:checklist.loading,itemsError:checklist.error,waitForChecklist:true})
  const [severity,setSeverity]=useState<PinSeverity>("medium")
  const [reason,setReason]=useState("")
  const [photos,setPhotos]=useState<IssuePhotoDraft[]>([])
  const [error,setError]=useState("")
  const [busy,setBusy]=useState(false)
  const requestId=useRef(crypto.randomUUID())
  const pending=useRef(false)
  const close=()=>{if(!pending.current && ((!reason.trim() && !photos.length) || window.confirm("Discard this unsaved issue report?"))) onClose()}
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(pending.current) return
    const pin=candidates.find(row=>row.id===link.pinId)
    if(!pin || linkProblem) return setError(linkProblem || "Choose an available work pin.")
    if(reason.trim().length<5) return setError("Describe the issue (at least 5 characters).")
    pending.current=true;setBusy(true);setError("")
    try{await logSiteIssue({id:requestId.current,projectId:pin.project_id,pinId:pin.id,checklistItemId:link.itemId || null,severity,description:reason.trim(),photos});await onDone()}catch(e){setError((e as Error).message)}finally{pending.current=false;setBusy(false)}
  }
  return <Modal title="Log an issue" size="xl" description="Linked to a work pin and optionally one of its tasks. Visible to the assigned Foreman. Original photos and all saved markup versions are preserved." onClose={close} footer={<><button type="button" className={buttonSecondary} disabled={busy} onClick={close}>Cancel</button><button type="submit" form="log-site-issue" className={buttonDanger} disabled={busy || !candidates.length || Boolean(linkProblem)}>{busy ? "Uploading and saving…" : "Log issue"}</button></>}>
    {!candidates.length ? <p className="text-sm text-fg-muted">No available work pins. Add a work pin on the plan, or reopen completed work first.</p> : <form id="log-site-issue" className="space-y-4" onSubmit={event=>void submit(event)}>
      <PinLinkPicker projectId={projectId} sheets={sheetList} pins={candidates} value={link} disabled={busy} checklist={checklist} onChange={next=>{setLink(next);setError("")}}/>
      {linkProblem && link.pinId ? <p role="status" className="text-xs text-fg-muted">{linkProblem}</p> : null}
      <label className="block text-sm font-bold">Severity<select className={`${inputClass} mt-1`} disabled={busy} value={severity} onChange={e=>setSeverity(e.target.value as PinSeverity)}>{severityOrder.slice().reverse().map(value=><option key={value} value={value}>{severityLabels[value]}</option>)}</select></label>
      <label className="block text-sm font-bold">What is wrong? *<textarea className={`${inputClass} mt-1`} rows={3} minLength={5} maxLength={1000} required disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <IssuePhotoPicker photos={photos} onChange={setPhotos} disabled={busy}/>
      {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
    </form>}
  </Modal>
}
