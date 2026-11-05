import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import { MarkupLayer, SelectionFrame } from "./MarkupLayer"
import PhotoEditorToolbar, { MarkupProperties } from "./PhotoEditorToolbar"
import PhotoSlides from "./PhotoSlides"
import { useConfirm } from "../../lib/confirm"
import { clampCoordinate, MARKUP_LIMIT, MARKUP_POINT_LIMIT, markupCenter, markupProblem, moveMarkup, resizeMarkup, withRotation, type IssueMarkup, type MarkupPoint, type MarkupTool } from "../../lib/issueMarkup"
import { angleFromCenter, snapAngle, toLocalAxes } from "../../lib/shapes"
import type { Corner } from "../../lib/arrange"
import { CANVAS_ZOOM_STEP, MIN_CANVAS_SCALE, MAX_CANVAS_SCALE, canvasWheelFactor, fitCanvasView, zoomCanvasView, pinchCanvasView, type CanvasPoint, type CanvasView } from "../../lib/canvasView"
import { NUDGE_STEP, ROTATE_STEP, changeMark, docChanged, markupChanges, newDoc, openDocs, recordEdit, redoEdit, removeMark, restyleMark, stepPhoto, toolByKey, undoEdit, type MarkupChange, type MarkupPhoto, type MarkupStyle, type PhotoDoc, type PhotoTool } from "../../lib/photoEditorModel"

export { MarkupLayer } from "./MarkupLayer"
export type { MarkupChange, MarkupPhoto } from "../../lib/photoEditorModel"

type Sizing = "fill" | "fit" | "manual"
// draw = a new mark being drawn, move = dragging a selected mark, rotate = dragging its rotate handle (centre in SVG units).
type Gesture = { photoId: string; id: string; start: MarkupPoint; last: MarkupPoint; before: IssueMarkup[]; mode: "draw" | "move" | "rotate" | "resize"; pointerId: number; centre?: { x: number; y: number }; corner?: Corner }

// The one photo markup editor (site issues, client problem reports, QA / NCR evidence). Markup is a separate overlay; the
// photo bytes are never changed. Several photos open as a manual slideshow: each keeps its own markup, caption and undo
// history while you move between them, and Save hands back only the photos that changed. Navigation, zoom and the toolbar
// follow the blueprint editor (shared canvas maths in lib/canvasView). `title` / `captionLimit` adapt it per evidence type.
export default function IssuePhotoEditor({ photos, start: startAt = 0, readOnly = false, title, captionLimit = 500, onClose, onSave }: {
  photos: MarkupPhoto[]; start?: number; readOnly?: boolean; title?: string; captionLimit?: number; onClose: () => void
  onSave?: (changes: MarkupChange[]) => Promise<void> | void
}) {
  const confirm = useConfirm()
  const [index,setIndex] = useState(() => stepPhoto(startAt,0,photos.length))
  const at = stepPhoto(index,0,photos.length)
  const photo = photos[at]
  const photoId = photo?.id ?? ""
  const [docs,setDocs] = useState<Record<string,PhotoDoc>>(() => openDocs(photos))
  const doc = docs[photoId] ?? (photo ? newDoc(photo) : { items:[], past:[], future:[], note:"" })
  const items = doc.items
  const updateDoc = (id: string, change: (doc: PhotoDoc) => PhotoDoc) => setDocs(all => {
    const source = photos.find(row => row.id === id)
    const current = all[id] ?? (source ? newDoc(source) : null)
    return current ? { ...all, [id]: change(current) } : all
  })
  const edit = (change: (doc: PhotoDoc) => PhotoDoc) => updateDoc(photoId,change)
  const [tool,setTool] = useState<MarkupTool>("select")
  const [panMode,setPanMode] = useState(false)
  const [selected,setSelected] = useState("")
  const [color,setColor] = useState("#d93a3a")
  const [stroke,setStroke] = useState(4)
  const [fontSize,setFontSize] = useState(30)
  const [text,setText] = useState("")
  const [slidesOpen,setSlidesOpen] = useState(true)
  const [imageSize,setImageSize] = useState({width:1000,height:750})
  const height = 1000*imageSize.height/imageSize.width
  const [original,setOriginal] = useState(false)
  const [error,setError] = useState("")
  const [saving,setSaving] = useState(false)
  const [loaded,setLoaded] = useState(false)
  const [fullscreen,setFullscreen] = useState(false)
  const [view,setView] = useState<CanvasView>({scale:1,tx:0,ty:0})
  const [sizing,setSizing] = useState<Sizing>("fit")
  const [space,setSpace] = useState(false)
  const [panning,setPanning] = useState(false)
  const viewRef = useRef(view)
  const sizeRef = useRef(imageSize)
  const sizingRef = useRef(sizing)
  viewRef.current = view; sizeRef.current = imageSize; sizingRef.current = sizing
  const pointers = useRef(new Map<number,CanvasPoint>())
  const pan = useRef<{id:number;start:CanvasPoint;view:CanvasView} | null>(null)
  const pinch = useRef<{distance:number;mid:CanvasPoint;view:CanvasView} | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const textInput = useRef<HTMLInputElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const styleRun = useRef("") // the property being changed continuously (one undo step), see restyleMark
  const commitView = (next: CanvasView) => { viewRef.current=next; setView(next) }
  const sizePhoto = (mode: "fill" | "fit", size = sizeRef.current) => {
    const frame=viewportRef.current
    sizingRef.current=mode;setSizing(mode)
    if(frame && frame.clientWidth>=40 && frame.clientHeight>=40) commitView(fitCanvasView(size,{width:frame.clientWidth,height:frame.clientHeight},mode))
  }
  const zoomAt = (factor: number, anchor?: CanvasPoint) => {
    const frame=viewportRef.current
    if(!frame || gesture.current || pointers.current.size) return
    sizingRef.current="manual";setSizing("manual")
    commitView(zoomCanvasView(viewRef.current,factor,anchor ?? {x:frame.clientWidth/2,y:frame.clientHeight/2}))
  }
  const cancelEdit = () => {
    const active=gesture.current
    if(!active) return
    gesture.current=null
    updateDoc(active.photoId,current=>({...current,items:active.before}))
    if(svg.current?.hasPointerCapture(active.pointerId)) svg.current.releasePointerCapture(active.pointerId)
  }
  const releasePointers = () => {
    const frame=viewportRef.current
    for(const id of pointers.current.keys()) if(frame?.hasPointerCapture(id)) frame.releasePointerCapture(id)
    pointers.current.clear();pan.current=null;pinch.current=null;setPanning(false)
  }
  const controls = useRef({zoomAt,sizePhoto,cancelEdit,releasePointers})
  controls.current={zoomAt,sizePhoto,cancelEdit,releasePointers}
  useEffect(() => {
    const frame = viewportRef.current
    if (!frame) return
    const measure = () => {
      if(sizingRef.current !== "manual") controls.current.sizePhoto(sizingRef.current)
    }
    measure()
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null
    observer?.observe(frame)
    window.addEventListener("resize",measure)
    return () => { observer?.disconnect(); window.removeEventListener("resize",measure) }
  }, [fullscreen])
  useEffect(() => {
    const frame=viewportRef.current
    if(!frame) return
    const wheel=(event:WheelEvent)=>{
      // Ordinary wheel scrolling belongs to the taller editor/modal content.
      // Explicit Ctrl/Command+wheel still zooms toward the pointer.
      if(!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const rect=frame.getBoundingClientRect()
      controls.current.zoomAt(canvasWheelFactor(event.deltaY),{x:event.clientX-rect.left,y:event.clientY-rect.top})
    }
    const releaseSpace=(event:KeyboardEvent)=>{if(event.key===" ")setSpace(false)}
    const blur=()=>{setSpace(false);controls.current.cancelEdit();controls.current.releasePointers()}
    frame.addEventListener("wheel",wheel,{passive:false})
    window.addEventListener("keyup",releaseSpace)
    window.addEventListener("blur",blur)
    return()=>{frame.removeEventListener("wheel",wheel);window.removeEventListener("keyup",releaseSpace);window.removeEventListener("blur",blur)}
  }, [])
  useEffect(() => { if(tool==="text" && !panMode) textInput.current?.focus() }, [tool,panMode])
  const viewportPoint = (point: CanvasPoint) => {
    const rect=viewportRef.current!.getBoundingClientRect()
    return {x:point.x-rect.left,y:point.y-rect.top}
  }
  const downView = (event: PointerEvent<HTMLDivElement>) => {
    if(event.button!==0 && event.button!==1) return
    event.currentTarget.focus({preventScroll:true})
    pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY})
    if(pointers.current.size===2) {
      cancelEdit();pan.current=null
      const [a,b]=[...pointers.current.values()]
      pinch.current={distance:Math.hypot(a.x-b.x,a.y-b.y)||1,mid:viewportPoint({x:(a.x+b.x)/2,y:(a.y+b.y)/2}),view:viewRef.current}
      for(const id of pointers.current.keys()) event.currentTarget.setPointerCapture(id)
      setPanning(true);event.preventDefault();event.stopPropagation();return
    }
    if(pointers.current.size!==1) {event.stopPropagation();return}
    const target=event.target as Element
    const annotation=target.closest?.("[data-markup-id],[data-rotate-handle],[data-resize-handle]")
    const onPhoto=target.closest?.('[aria-label="Photo annotation canvas"]')
    if(event.button===1 || space || panMode || readOnly || original || (tool==="select" && !annotation) || !onPhoto) {
      if(tool==="select" && !annotation && !panMode && !space) setSelected("")
      pan.current={id:event.pointerId,start:{x:event.clientX,y:event.clientY},view:viewRef.current}
      event.currentTarget.setPointerCapture(event.pointerId)
      setPanning(true);event.preventDefault();event.stopPropagation()
    }
  }
  const moveView = (event: PointerEvent<HTMLDivElement>) => {
    if(!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY})
    if(pinch.current && pointers.current.size>=2) {
      const [a,b]=[...pointers.current.values()],initial=pinch.current
      sizingRef.current="manual";setSizing("manual")
      commitView(pinchCanvasView(initial.view,Math.hypot(a.x-b.x,a.y-b.y)/initial.distance,initial.mid,viewportPoint({x:(a.x+b.x)/2,y:(a.y+b.y)/2})))
      event.preventDefault();event.stopPropagation()
    } else if(pan.current?.id===event.pointerId) {
      const initial=pan.current
      sizingRef.current="manual";setSizing("manual")
      commitView({...initial.view,tx:initial.view.tx+event.clientX-initial.start.x,ty:initial.view.ty+event.clientY-initial.start.y})
      event.preventDefault();event.stopPropagation()
    }
  }
  const endView = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
    if(!pinch.current && !pan.current) return
    pinch.current=null;pan.current=null
    if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if(pointers.current.size===1) {
      const [id,start]=[...pointers.current.entries()][0]
      pan.current={id,start,view:viewRef.current}
    }
    setPanning(pointers.current.size>0);event.preventDefault();event.stopPropagation()
  }
  // Leaving fullscreen keeps every photo's unsaved markup, caption and history.
  const exitFullscreen = () => {
    cancelEdit();releasePointers();setSpace(false)
    setFullscreen(false)
  }
  // Manual slideshow: the next photo opens fitted; fullscreen, tool and every photo's unsaved work stay as they are.
  const goTo = (next: number) => {
    const target=stepPhoto(next,0,photos.length)
    if(target===at) return
    cancelEdit();releasePointers()
    styleRun.current="";setSelected("");setError("");setLoaded(false)
    if(sizingRef.current==="manual") {sizingRef.current="fit";setSizing("fit")}
    setIndex(target)
  }
  const point = (event: PointerEvent, clamp = true): MarkupPoint => {
    const rect = svg.current!.getBoundingClientRect()
    const x=(event.clientX-rect.left)/rect.width*100, y=(event.clientY-rect.top)/rect.height*100
    return clamp ? { x: clampCoordinate(x), y: clampCoordinate(y) } : { x, y }
  }
  // Selecting a mark shows its own colour, width, size and text in the properties bar.
  const choose = (id: string) => {
    styleRun.current=""
    setSelected(id)
    const row=items.find(item=>item.id===id)
    if(row) {setColor(row.color);setStroke(row.stroke);setFontSize(row.fontSize);if(row.kind==="text") setText(row.text)}
  }
  const start = (event: PointerEvent<SVGSVGElement>) => {
    if (readOnly || original || !loaded || saving || event.button !== 0 || gesture.current) return
    if (tool === "select") { choose(""); return }
    if (items.length >= MARKUP_LIMIT) return setError(`Limit: ${MARKUP_LIMIT} annotations per photo.`)
    if (tool === "text" && !text.trim()) { textInput.current?.focus(); return setError("Type the text in the bar above, then click the photo.") }
    const p=point(event), id=crypto.randomUUID()
    const item: IssueMarkup = { id,kind:tool,x:p.x,y:p.y,x2:p.x,y2:p.y,color,stroke,fontSize,text:tool === "text" ? text.trim() : "",points:tool === "draw" ? [p] : [] }
    setError(""); styleRun.current=""; setSelected(id)
    if (tool === "text") { edit(current=>recordEdit(current,[...current.items,item])); setTool("select"); return }
    gesture.current = { photoId,id,start:p,last:p,before:items,mode:"draw",pointerId:event.pointerId }
    svg.current?.setPointerCapture(event.pointerId)
    edit(current=>({...current,items:[...current.items,item]}))
  }
  const select = (id: string,event: PointerEvent<SVGGElement>) => {
    if (readOnly || original || saving || tool !== "select" || event.button !== 0) return
    event.stopPropagation()
    choose(id)
    const p=point(event)
    gesture.current={photoId,id,start:p,last:p,before:items,mode:"move",pointerId:event.pointerId}
    svg.current?.setPointerCapture(event.pointerId)
  }
  // The handle sits straight above the centre, so the angle from the centre to the pointer is the mark's rotation.
  const rotateStart = (event: PointerEvent<SVGCircleElement>) => {
    if (readOnly || original || saving || !selectedMark || event.button !== 0 || gesture.current) return
    event.stopPropagation()
    const p=point(event,false)
    gesture.current={photoId,id:selectedMark.id,start:p,last:p,before:items,mode:"rotate",pointerId:event.pointerId,centre:markupCenter(selectedMark,height)}
    svg.current?.setPointerCapture(event.pointerId)
  }
  const resizeStart = (corner: Corner, event: PointerEvent<SVGRectElement>) => {
    if (readOnly || original || saving || !selectedMark || event.button !== 0 || gesture.current) return
    event.preventDefault(); event.stopPropagation()
    const p = point(event, false)
    styleRun.current = ""
    gesture.current = { photoId, id: selectedMark.id, start: p, last: p, before: items, mode: "resize", corner, pointerId: event.pointerId }
    svg.current?.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const g=gesture.current; if(!g || g.pointerId!==event.pointerId) return
    if (g.mode === "resize" && g.corner) {
      const p = point(event, false), originalMark = g.before.find(item => item.id === g.id)
      if (!originalMark) return
      const delta = toLocalAxes((p.x - g.start.x) * 10, (p.y - g.start.y) * height / 100, originalMark.rotation ?? 0)
      const resized = resizeMarkup(originalMark, g.corner, delta.x, delta.y, height, event.shiftKey)
      g.last = p
      updateDoc(g.photoId, current => ({ ...current, items: g.before.map(item => item.id === g.id ? resized : item) }))
      if (resized.kind === "text") setFontSize(resized.fontSize)
      return
    }
    if(g.mode==="rotate" && g.centre) {
      const p=point(event,false),raw=angleFromCenter(g.centre.x,g.centre.y,p.x*10,p.y*height/100)
      const degrees=event.shiftKey ? snapAngle(raw,ROTATE_STEP) : Math.round(raw*10)/10
      g.last=p
      updateDoc(g.photoId,current=>({...current,items:g.before.map(item=>item.id===g.id ? withRotation(item,degrees) : item)}))
      return
    }
    const p=point(event)
    g.last=p
    if(g.mode==="move") updateDoc(g.photoId,current=>({...current,items:g.before.map(item=>item.id===g.id ? moveMarkup(item,p.x-g.start.x,p.y-g.start.y) : item)}))
    else updateDoc(g.photoId,current=>({...current,items:current.items.map(item=>item.id!==g.id ? item : { ...item,x2:p.x,y2:p.y,points:item.kind === "draw" ? [...item.points.slice(0,MARKUP_POINT_LIMIT-1),p] : [] })}))
  }
  const end = (event: PointerEvent<SVGSVGElement>,cancel=false) => {
    const g=gesture.current;if(!g || g.pointerId!==event.pointerId) return
    gesture.current=null
    updateDoc(g.photoId,current=>{
      if(cancel) return {...current,items:g.before}
      // A click without dragging leaves no empty shape behind.
      const valid=current.items.filter(item=>item.id!==g.id || g.mode!=="draw" || (item.kind === "draw" ? item.points.length>=2 : Math.abs(item.x2-item.x)+Math.abs(item.y2-item.y)>0.2))
      return recordEdit(current,valid,g.before)
    })
    // A finished shape stays selected and the tool goes back to Select (as on the blueprint), ready to move or turn.
    if(!cancel && g.mode==="draw" && Math.abs(g.last.x-g.start.x)+Math.abs(g.last.y-g.start.y)>0.2) setTool("select")
    if(svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId)
  }
  const chooseTool = (next: PhotoTool) => {
    if(next==="pan") {setPanMode(true);return}
    styleRun.current="";setPanMode(false);setTool(next)
    if(next!=="select") setSelected("")
  }
  const undo = () => { if(gesture.current) return; styleRun.current="";setSelected("");edit(undoEdit) }
  const redo = () => { if(gesture.current) return; styleRun.current="";setSelected("");edit(redoEdit) }
  const selectedMark = items.find(item=>item.id===selected) ?? null
  const deleteSelected = () => { if(!selectedMark || gesture.current) return; styleRun.current="";edit(current=>removeMark(current,selectedMark.id));setSelected("") }
  // `live` changes (slider drag, typing, custom colour) of the same property stay one undo step; a pick is its own step.
  const restyle = (style: MarkupStyle, key: string, live: boolean) => {
    if(!selectedMark || gesture.current) return
    const run=live ? `${photoId}:${selectedMark.id}:${key}` : ""
    const continuing=live && styleRun.current===run
    styleRun.current=run
    edit(current=>restyleMark(current,selectedMark.id,style,continuing))
  }
  const rotateBy = (delta: number) => { if(selectedMark) restyle({rotation:(selectedMark.rotation ?? 0)+delta},"rotation",false) }
  // Arrow keys nudge the selected mark (Shift = 10x); a run of presses is one undo step.
  const nudge = (dx: number, dy: number) => {
    if(!selectedMark || gesture.current) return
    const run=`${photoId}:${selectedMark.id}:nudge`
    const continuing=styleRun.current===run
    styleRun.current=run
    edit(current=>changeMark(current,selectedMark.id,item=>moveMarkup(item,dx,dy),continuing))
  }
  const changeText = (value: string) => {
    setText(value)
    if(selectedMark?.kind!=="text") return
    if(!value.trim()) return setError("Text cannot be empty: type something or delete the mark.")
    setError("");restyle({text:value},"text",true)
  }
  const changes = markupChanges(photos,docs)
  const close = async () => {
    if(saving) return
    if(!readOnly && changes.length && !(await confirm({ title:"Discard unsaved photo markup?", message:`${changes.length === 1 ? "A photo has" : `${changes.length} photos have`} markup or caption changes that are not saved.`, confirmLabel:"Discard", tone:"danger" }))) return
    onClose()
  }
  const save = async () => {
    if(saving || gesture.current) return
    for(const change of changes) {
      const why=markupProblem(change.annotations)
      if(why) {goTo(photos.findIndex(row=>row.id===change.id));return setError(why)}
    }
    if(!changes.length) return onClose()
    setSaving(true);setError("")
    try { await onSave?.(changes);onClose() } catch(e) {setError((e as Error).message)} finally {setSaving(false)}
  }
  const onKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target=event.target as HTMLElement
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "")) return
    if(event.key==="PageDown" || event.key==="PageUp") {
      if(photos.length>1) {event.preventDefault();goTo(at+(event.key==="PageDown" ? 1 : -1))}
      return
    }
    if(readOnly) return
    const key=event.key.toLowerCase()
    if((event.ctrlKey || event.metaKey) && (key==="z" || key==="y")) {event.preventDefault();if(key==="y" || event.shiftKey) redo();else undo();return}
    if(event.ctrlKey || event.metaKey || event.altKey) return
    if((event.key==="Delete" || event.key==="Backspace") && selectedMark) {event.preventDefault();deleteSelected();return}
    if(selectedMark && !original && event.key.startsWith("Arrow")) {
      event.preventDefault()
      const step=NUDGE_STEP*(event.shiftKey ? 10 : 1)
      nudge(event.key==="ArrowLeft" ? -step : event.key==="ArrowRight" ? step : 0,event.key==="ArrowUp" ? -step : event.key==="ArrowDown" ? step : 0)
      return
    }
    if(selectedMark && !original && (event.key==="[" || event.key==="]")) {event.preventDefault();rotateBy(event.key==="]" ? ROTATE_STEP : -ROTATE_STEP);return}
    const next=toolByKey[key]
    if(next && !(original && next!=="select" && next!=="pan")) {event.preventDefault();chooseTool(next)}
  }

  if(!photo) return null
  const many = photos.length>1
  const busy = Boolean(gesture.current) || panning || saving
  const showProps = !readOnly && !original && !panMode && (tool!=="select" || Boolean(selectedMark))
  const slides = photos.map(row=>{const current=docs[row.id] ?? newDoc(row);return {id:row.id,src:row.src,caption:current.note,items:current.items,changed:docChanged(docs[row.id],row)}})
  const captionLabel = many ? `Caption for image ${at+1}` : "Photo caption"
  const caption = <textarea className={`${inputClass} mt-1`} rows={2} maxLength={captionLimit} disabled={saving} value={doc.note} onChange={e=>{const value=e.target.value;edit(current=>({...current,note:value}))}} />
  return <Modal title={title ?? (readOnly ? "Issue photo and details" : "Annotate issue photo")} description={readOnly ? "Original photo with its saved markup." : "Original photo preserved. Text, lines, arrows, shapes and drawings are saved separately."} size="2xl" fullscreen={fullscreen} onEscape={fullscreen ? exitFullscreen : undefined} onClose={()=>void close()} footer={<>
    {many && !readOnly ? <span className="mr-auto text-xs text-fg-muted" aria-live="polite">{changes.length ? `${changes.length} of ${photos.length} photos changed` : "No changes yet"}</span> : null}
    <button type="button" className={buttonSecondary} disabled={saving} onClick={()=>void close()}>Close</button>
    {!readOnly ? <button type="button" className={buttonPrimary} disabled={saving || Boolean(gesture.current)} onClick={()=>void save()}>{saving ? "Saving..." : many ? "Save markup" : "Save photo markup"}</button> : null}
  </>}>
    <div className={`flex min-w-0 flex-col gap-2 ${fullscreen ? "min-h-full" : ""}`} onKeyDown={onKeys}>
      <PhotoEditorToolbar readOnly={readOnly} active={panMode ? "pan" : tool} onTool={chooseTool} busy={busy}
        canUndo={doc.past.length>0 && !original} canRedo={doc.future.length>0 && !original} onUndo={undo} onRedo={redo}
        original={original} onOriginal={()=>{cancelEdit();setOriginal(value=>!value)}}
        scale={view.scale} canZoomIn={view.scale<MAX_CANVAS_SCALE} canZoomOut={view.scale>MIN_CANVAS_SCALE} onZoomIn={()=>zoomAt(CANVAS_ZOOM_STEP)} onZoomOut={()=>zoomAt(1/CANVAS_ZOOM_STEP)}
        sizing={sizing} onFit={()=>sizePhoto("fit")} onFill={()=>sizePhoto("fill")}
        fullscreen={fullscreen} onFullscreen={()=>fullscreen ? exitFullscreen() : setFullscreen(true)}
        slides={many ? {index:at,count:photos.length,open:slidesOpen,onToggle:()=>setSlidesOpen(value=>!value),onPrev:()=>goTo(at-1),onNext:()=>goTo(at+1)} : undefined} />
      {showProps ? <MarkupProperties mark={selectedMark} tool={tool} color={color} stroke={stroke} fontSize={fontSize} text={text} textRef={textInput} disabled={saving}
        onColor={(value,live)=>{setColor(value);restyle({color:value},"color",live)}} onStroke={value=>{setStroke(value);restyle({stroke:value},"stroke",true)}}
        onFontSize={value=>{setFontSize(value);restyle({fontSize:value},"fontSize",false)}} onText={changeText} onDelete={deleteSelected}
        rotation={selectedMark?.rotation ?? 0} onRotate={(value,live)=>restyle({rotation:value},"rotation",live)} onRotateBy={rotateBy} /> : null}
      {error ? <p role="alert" className="text-sm text-danger-fg">{error}</p> : null}
      <div className={`flex min-w-0 flex-col gap-2 md:flex-row ${fullscreen ? "min-h-80 flex-1" : "md:h-[64vh] md:min-h-80"}`}>
        {many && slidesOpen ? <PhotoSlides slides={slides} index={at} onSelect={goTo} /> : null}
        <div ref={viewportRef} tabIndex={0} aria-label="Photo editing viewport" style={{touchAction:"none"}} className={`relative min-w-0 shrink-0 overflow-hidden rounded-xl border border-line bg-black/80 outline-none focus-visible:ring-2 focus-visible:ring-brand md:flex-1 ${panning ? "cursor-grabbing" : space || panMode || tool==="select" || readOnly || original ? "cursor-grab" : "cursor-crosshair"} ${fullscreen ? "min-h-80 flex-1" : "h-[56vh] min-h-72 md:h-full"}`} onPointerDownCapture={downView} onPointerMoveCapture={moveView} onPointerUpCapture={endView} onPointerCancelCapture={endView} onKeyDown={event=>{if(event.key===" "){event.preventDefault();setSpace(true)}else if(event.key==="+" || event.key==="="){event.preventDefault();zoomAt(CANVAS_ZOOM_STEP)}else if(event.key==="-"){event.preventDefault();zoomAt(1/CANVAS_ZOOM_STEP)}else if(event.key==="0" && !gesture.current && !panning){event.preventDefault();sizePhoto("fit")}}}>
          <div data-photo-stage className="absolute left-0 top-0 origin-top-left" style={{width:imageSize.width,height:imageSize.height,transform:`translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`}}>
            <img key={photoId} src={photo.src} alt={doc.note || (many ? `Image ${at+1} of ${photos.length}` : "Issue evidence")} className="pointer-events-none block h-full w-full select-none" draggable={false} onLoad={e=>{const size={width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight};sizeRef.current=size;setImageSize(size);sizePhoto(sizingRef.current==="fill" ? "fill" : "fit",size);setLoaded(true)}} onError={()=>{setLoaded(false);setError("Photo could not be loaded.")}} />
            <svg ref={svg} viewBox={`0 0 1000 ${height}`} className="absolute inset-0 h-full w-full" style={{touchAction:readOnly || original ? "auto" : "none",overflow:"visible"}} onPointerDown={start} onPointerMove={move} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)} aria-label="Photo annotation canvas">
              {!original && loaded ? <MarkupLayer items={items} height={height} selected={selected} onSelect={readOnly ? undefined : select} /> : null}
              {!original && loaded && !readOnly && selectedMark && tool==="select" && !panMode ? <SelectionFrame item={selectedMark} height={height} unit={1000/(imageSize.width*view.scale)} onRotateStart={rotateStart} onResizeStart={resizeStart} /> : null}
            </svg>
          </div>
        </div>
      </div>
      {readOnly ? <p className="shrink-0 text-sm">{doc.note || "No caption."}</p>
        : fullscreen ? <details className="shrink-0 rounded-lg border border-line px-3 py-2"><summary className="cursor-pointer text-sm font-bold">{captionLabel} <span className="ml-2 font-normal text-fg-muted">Edit details</span></summary><label className="mt-2 block text-sm font-bold">{captionLabel}{caption}</label></details>
        : <label className="block shrink-0 text-sm font-bold">{captionLabel}{caption}</label>}
      <p className="shrink-0 text-xs text-fg-muted">Ctrl/⌘ + scroll zooms toward the cursor; plain scrolling moves down the editor. Pan, Space-drag or the middle button moves the photo; pinch with two fingers.{readOnly ? "" : " Keys: V select, H pan, T text, L A R E D shapes; select a mark and drag a square corner to resize (Shift keeps proportions; text always scales). Drag to move, arrow keys nudge, the round handle or [ ] rotates, Del deletes; Ctrl+Z / Ctrl+Shift+Z."}{many ? " Page Up / Page Down change the photo." : ""}</p>
    </div>
  </Modal>
}
