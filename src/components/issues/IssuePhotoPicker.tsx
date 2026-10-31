import { useEffect, useRef, useState } from "react"
import { ISSUE_PHOTO_LIMIT, issuePhotoProblem } from "../../lib/issueMarkup"
import type { IssuePhotoDraft } from "../../lib/siteIssues"
import { buttonSecondary } from "../ui/PageParts"
import IssuePhotoEditor from "./IssuePhotoEditor"
import { MarkupLayer } from "./MarkupLayer"
import { useConfirm } from "../../lib/confirm"
import { applyMarkupChanges } from "../../lib/photoEditorModel"

// Chosen photos waiting to be sent, each with its own markup and caption. The editor opens on all of them as a slideshow. With `prepare` (QA evidence) every picture is shrunk
// first, one at a time, so the markup sits on exactly the pixels that are stored; without it the file is kept as chosen (8 MB max).
// allowFiles=false hides "Add photos" (camera-only photos while the Super Admin has turned photo uploads off).
export default function IssuePhotoPicker({photos,onChange,disabled=false,limit=ISSUE_PHOTO_LIMIT,prepare,onPreparing,captionLimit=500,nameCaptions=true,hint,editorTitle,allowFiles=true}:{
  photos:IssuePhotoDraft[];onChange:(photos:IssuePhotoDraft[])=>void;disabled?:boolean;limit?:number
  prepare?:(file:File)=>Promise<File>;onPreparing?:(busy:boolean)=>void;captionLimit?:number;nameCaptions?:boolean;hint?:string;editorTitle?:string;allowFiles?:boolean
}) {
  const [editing,setEditing]=useState<number|null>(null)
  const confirm=useConfirm()
  const [error,setError]=useState("")
  const [preparing,setPreparing]=useState(false)
  const urls=useRef(new Set<string>())
  useEffect(()=>()=>{for(const url of urls.current) URL.revokeObjectURL(url)},[])
  const locked=disabled || preparing
  const draft=(file:File,chosen:File):IssuePhotoDraft=>{const url=URL.createObjectURL(file);urls.current.add(url);return {id:crypto.randomUUID(),file,url,caption:nameCaptions ? chosen.name.slice(0,captionLimit) : "",annotations:[]}}
  const add=async(files:FileList|null)=>{
    if(!files) return
    const list=Array.from(files)
    if(photos.length+list.length>limit) return setError(`You can add ${limit} photos here. Remove some or select fewer.`)
    if(!prepare) {
      for(const file of list) {const why=issuePhotoProblem(file);if(why) return setError(`${file.name}: ${why}`)}
      setError("")
      return onChange([...photos,...list.map(file=>draft(file,file))])
    }
    // While preparing, every control here is locked and the parent is told, so `photos` cannot change underneath.
    setPreparing(true);onPreparing?.(true);setError("")
    const ready:IssuePhotoDraft[]=[],problems:string[]=[]
    for(const file of list) {try{ready.push(draft(await prepare(file),file))}catch(e){problems.push(`${file.name}: ${(e as Error).message}`)}}
    setPreparing(false);onPreparing?.(false)
    if(problems.length) setError(problems.join(" "))
    if(ready.length) onChange([...photos,...ready])
  }
  const defaultCaption=(photo:IssuePhotoDraft)=>nameCaptions ? photo.file.name.slice(0,captionLimit) : ""
  // Removing a photo that was marked up or captioned asks first; untouched photos go at once.
  const remove=async(photo:IssuePhotoDraft)=>{
    if((photo.annotations.length || photo.caption!==defaultCaption(photo)) && !(await confirm({title:"Remove this photo?",message:"Its markup and caption will be lost.",confirmLabel:"Remove",tone:"danger"}))) return
    URL.revokeObjectURL(photo.url);urls.current.delete(photo.url);onChange(photos.filter(p=>p.id!==photo.id))
  }
  return <section className="space-y-3 rounded-xl border border-line p-3" aria-label="Issue photos">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold">Photos ({photos.length}/{limit})</h3><span className="flex flex-wrap gap-2">{photos.length ? <button type="button" className={buttonSecondary} disabled={locked} onClick={()=>setEditing(0)}>{photos.length>1 ? `Mark up photos (${photos.length})` : "Mark up photo"}</button> : null}{allowFiles ? <label className={`${buttonSecondary} cursor-pointer ${locked ? "pointer-events-none opacity-50" : ""}`}>{preparing ? "Preparing photos..." : "Add photos"}<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={locked} className="sr-only" onChange={e=>{void add(e.currentTarget.files);e.currentTarget.value=""}} /></label> : null}</span></div>
    <p className="text-xs text-fg-muted">{hint ?? "JPEG, PNG or WebP, up to 8 MB each. Select several at once. Annotate each photo before submitting; originals are preserved."}</p>
    {error ? <p role="alert" className="text-xs text-danger-fg">{error}</p> : null}
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{photos.map((photo,index)=><li key={photo.id} className="min-w-0 rounded-lg border border-line p-2">
      <button type="button" disabled={locked} className="block w-full" onClick={()=>setEditing(index)} aria-label={`Annotate ${photo.caption || `photo ${index+1}`}`}><DraftThumbnail photo={photo} /></button>
      <p className={`mt-1 truncate text-xs ${photo.caption ? "" : "text-fg-muted"}`} title={photo.caption}>{photo.caption || "No caption yet"}{photo.annotations.length ? ` · ${photo.annotations.length} mark${photo.annotations.length === 1 ? "" : "s"}` : ""}</p>
      <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={buttonSecondary+" !px-2 !py-1 !text-xs"} disabled={locked} onClick={()=>setEditing(index)}>Edit / annotate</button><button type="button" className={buttonSecondary+" !px-2 !py-1 !text-xs"} disabled={locked} onClick={()=>void remove(photo)}>Remove</button></div>
    </li>)}</ul>
    {editing!==null && photos.length ? <IssuePhotoEditor photos={photos.map(photo=>({id:photo.id,src:photo.url,annotations:photo.annotations,caption:photo.caption}))} start={editing} title={editorTitle} captionLimit={captionLimit} onClose={()=>setEditing(null)} onSave={changes=>onChange(applyMarkupChanges(photos,changes))} /> : null}
  </section>
}

function DraftThumbnail({photo}:{photo:IssuePhotoDraft}) {
  const [height,setHeight]=useState(750)
  return <div className="relative overflow-hidden rounded bg-black/10"><img src={photo.url} alt={photo.caption} className="max-h-40 w-full object-contain" onLoad={e=>setHeight(1000*e.currentTarget.naturalHeight/e.currentTarget.naturalWidth)} /><svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 1000 ${height}`}><MarkupLayer items={photo.annotations} height={height} /></svg></div>
}
