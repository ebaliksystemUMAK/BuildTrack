import { useEffect, useState } from "react"
import Modal from "../Modal"
import LimitedTimeline from "../ui/LimitedTimeline"
import { buttonPrimary, buttonSecondary } from "../ui/PageParts"
import { statusLabels, usePinTimeline, useSignedUrl, type Pin } from "../../lib/blueprints"
import { supabase } from "../../lib/supabase"
import { addSiteIssuePhotos, saveSiteIssuePhoto, useIssueEvidence, type IssuePhotoDraft, type IssuePhotoRevision, type SiteIssuePhoto } from "../../lib/siteIssues"
import IssuePhotoPicker from "./IssuePhotoPicker"
import IssuePhotoEditor from "./IssuePhotoEditor"
import { MarkupLayer } from "./MarkupLayer"
import { issueChecklistLabel } from "../../lib/issueChecklist"

const when = (iso:string) => new Date(iso).toLocaleString("en-PH",{timeZone:"Asia/Manila",dateStyle:"medium",timeStyle:"short"})

export default function IssueDetails({pin,canEdit=false,nameOf,onClose}:{pin:Pin;canEdit?:boolean;nameOf:(id:string|null)=>string;onClose:()=>void}) {
  const evidence=useIssueEvidence(pin.id)
  const timeline=usePinTimeline(pin.id)
  const [adding,setAdding]=useState<string|null>(null)
  const allowEdit=canEdit && pin.status!=="verified"
  const report=evidence.reports.find(row=>row.id===adding)
  return <Modal title={`Issue details: ${pin.title}`} description={`${statusLabels[pin.status]} · Assigned to ${nameOf(pin.assigned_to)}`} size="2xl" onClose={onClose} footer={<button type="button" className={buttonSecondary} onClick={onClose}>Close details</button>}>
    <div className="space-y-4">
      {evidence.error ? <p role="alert" className="text-sm text-danger-fg">{evidence.error} <button type="button" className="underline" onClick={()=>void evidence.reload()}>Retry</button></p> : null}
      {evidence.loading ? <p className="text-sm text-fg-muted">Loading descriptions and photo evidence…</p> : !evidence.reports.length ? <p className="rounded-lg bg-surface-muted p-3 text-sm">This issue was marked on the plan before photo reports were introduced. Its original notes are in the timeline below.</p> : null}
      {evidence.reports.map(row=><section key={row.id} className="space-y-3 rounded-xl border border-line p-4">
        <p className="text-xs font-bold text-brand-text">Task: {issueChecklistLabel(row)}{row.checklist_name && !row.checklist_item_id ? " (historical task)" : ""}</p>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-extrabold">Issue observation · {when(row.created_at)}</h3><p className="text-xs text-fg-muted">Logged by {nameOf(row.raised_by)} · {row.severity} severity at logging</p></div>{allowEdit && row.site_issue_photos.length<40 ? <button type="button" className={buttonSecondary} onClick={()=>setAdding(row.id)}>Add photos</button> : null}</div>
        <p className="whitespace-pre-wrap break-words text-sm">{row.description}</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{row.site_issue_photos.map(photo=><SavedIssuePhoto key={`${photo.id}-${photo.version}`} photo={photo} canEdit={allowEdit} nameOf={nameOf} onChanged={async()=>{await Promise.all([evidence.reload(),timeline.reload()])}} />)}</ul>
        {!row.site_issue_photos.length ? <p className="text-xs text-fg-muted">No photos attached to this observation.</p> : null}
      </section>)}
      <section className="rounded-xl border border-line p-4"><h3 className="mb-2 text-sm font-bold">Work and issue timeline</h3><LimitedTimeline entries={timeline.entries} resetKey={pin.id} label="Issue timeline" entryKey={entry=>entry.id} renderEntry={entry=><><strong className="text-xs">{when(entry.created_at)} · {entry.actor_name}</strong><p className="whitespace-pre-wrap text-xs">{entry.note || entry.kind}</p></>} /></section>
      {report ? <AddPhotos pin={pin} reportId={report.id} limit={40-report.site_issue_photos.length} onClose={()=>setAdding(null)} onSaved={async()=>{setAdding(null);await evidence.reload()}} /> : null}
    </div>
  </Modal>
}

function SavedIssuePhoto({photo,canEdit,nameOf,onChanged}:{photo:SiteIssuePhoto;canEdit:boolean;nameOf:(id:string|null)=>string;onChanged:()=>Promise<void>}) {
  const {url,failed}=useSignedUrl("issue-photos",photo.path)
  const [height,setHeight]=useState(750)
  const [showHistory,setShowHistory]=useState(false)
  const [history,setHistory]=useState<IssuePhotoRevision[]>([])
  const [historyLimit,setHistoryLimit]=useState(20)
  const [historyError,setHistoryError]=useState("")
  const [active,setActive]=useState<{revision:IssuePhotoRevision|null;edit:boolean}|null>(null)
  useEffect(()=>{
    if(!showHistory) return
    let valid=true
    supabase.from("site_issue_photo_revisions").select("*").eq("photo_id",photo.id).order("version",{ascending:false}).limit(historyLimit).then(({data,error})=>{if(valid){setHistoryError(error ? "Could not load photo history." : "");setHistory((data as IssuePhotoRevision[]|null) ?? [])}})
    return()=>{valid=false}
  },[showHistory,photo.id,historyLimit])
  return <li className="min-w-0 space-y-2 rounded-xl border border-line p-2">
    <button type="button" className="relative block w-full overflow-hidden rounded bg-black/10" disabled={!url} onClick={()=>setActive({revision:null,edit:false})} aria-label={`Open ${photo.caption || "issue photo"}`}>
      {url ? <><img src={url} alt={photo.caption || "Issue photo"} className="max-h-44 w-full object-contain" onLoad={e=>setHeight(1000*e.currentTarget.naturalHeight/e.currentTarget.naturalWidth)} /><svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 1000 ${height}`}><MarkupLayer items={photo.annotations} height={height} /></svg></> : <p className="p-4 text-xs">{failed ? "Photo unavailable" : "Loading photo…"}</p>}
    </button>
    <p className="break-words text-xs font-bold">{photo.caption || "Issue photo"}</p>
    <p className="text-[11px] text-fg-muted">Uploaded {when(photo.created_at)} · {nameOf(photo.uploaded_by)}<br/>Markup v{photo.version} · {when(photo.updated_at)} · {nameOf(photo.updated_by)}</p>
    <div className="flex flex-wrap gap-2">{canEdit ? <button type="button" className={buttonSecondary+" !px-2 !py-1 !text-xs"} disabled={!url} onClick={()=>setActive({revision:null,edit:true})}>Edit markup</button> : null}<button type="button" className={buttonSecondary+" !px-2 !py-1 !text-xs"} onClick={()=>setShowHistory(!showHistory)}>Photo history</button></div>
    {showHistory ? <div className="max-h-40 overflow-y-auto text-xs"><p className="mb-1 text-fg-muted">Saved versions, newest first</p>{historyError ? <p role="alert">{historyError}</p> : history.map(revision=><button key={revision.version} type="button" disabled={!url} className="block w-full border-t border-line py-2 text-left hover:bg-surface-muted" onClick={()=>setActive({revision,edit:false})}>Version {revision.version} · {when(revision.created_at)} · {nameOf(revision.edited_by)}</button>)}{history.length>=historyLimit ? <button type="button" className="py-2 font-bold text-brand-text" onClick={()=>setHistoryLimit(value=>value+20)}>Load older versions</button> : null}</div> : null}
    {active && url ? <IssuePhotoEditor key={active.revision?.version ?? `current-${active.edit}`} photos={[{id:photo.id,src:url,annotations:active.revision?.annotations ?? photo.annotations,caption:active.revision?.caption ?? photo.caption}]} readOnly={!active.edit} onClose={()=>setActive(null)} onSave={async([change])=>{if(!change) return;await saveSiteIssuePhoto(photo,change.annotations,change.caption);await onChanged()}} /> : null}
  </li>
}

function AddPhotos({pin,reportId,limit,onClose,onSaved}:{pin:Pin;reportId:string;limit:number;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const [photos,setPhotos]=useState<IssuePhotoDraft[]>([])
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const close=()=>{if(!busy && (!photos.length || window.confirm("Discard these unsaved photos?"))) onClose()}
  const save=async()=>{setBusy(true);setError("");try{await addSiteIssuePhotos(pin.project_id,pin.id,reportId,photos);await onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal title="Add issue photos" size="xl" onClose={close} footer={<><button type="button" className={buttonSecondary} disabled={busy} onClick={close}>Cancel</button><button type="button" className={buttonPrimary} disabled={busy || !photos.length} onClick={()=>void save()}>{busy ? "Uploading…" : "Save photos"}</button></>}><IssuePhotoPicker photos={photos} onChange={setPhotos} limit={limit} disabled={busy}/>{error ? <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p> : null}</Modal>
}
