import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { markupCenter, markupProblem } from "../src/lib/issueMarkup.ts"
import { CANVAS_ZOOM_STEP, fitCanvasView, zoomCanvasView, pinchCanvasView } from "../src/lib/canvasView.ts"

// Match the pre-existing sheet editor formulas, including clamped extremes.
for(const image of [{width:2000,height:1000},{width:1000,height:4000},{width:100,height:100}]) {
  for(const viewport of [{width:1000,height:500},{width:320,height:240},{width:1920,height:1000}]) {
    const scale=Math.min(10,Math.max(0.05,Math.min((viewport.width-24)/image.width,(viewport.height-24)/image.height)))
    assert.deepEqual(fitCanvasView(image,viewport),{scale,tx:(viewport.width-image.width*scale)/2,ty:(viewport.height-image.height*scale)/2})
  }
}
for(const current of [{scale:0.05,tx:10,ty:20},{scale:0.75,tx:-40,ty:30},{scale:10,tx:-100,ty:-200}]) {
  for(const factor of [0.001,1/CANVAS_ZOOM_STEP,CANVAS_ZOOM_STEP,1000]) {
    const anchor={x:270,y:130},scale=Math.min(10,Math.max(0.05,current.scale*factor)),ratio=scale/current.scale
    assert.deepEqual(zoomCanvasView(current,factor,anchor),{scale,tx:anchor.x-(anchor.x-current.tx)*ratio,ty:anchor.y-(anchor.y-current.ty)*ratio})
  }
}

// Exercise the actual editor (with its real toolbar, properties bar and slideshow strip) without a browser or uploads.
const dataModule=source=>"data:text/javascript;base64,"+Buffer.from(source).toString("base64")
const hookModule=dataModule("export const useState=(...a)=>globalThis.__issueEditorHooks.useState(...a);export const useRef=(...a)=>globalThis.__issueEditorHooks.useRef(...a);export const useEffect=(...a)=>globalThis.__issueEditorHooks.useEffect(...a);export const useId=()=> 'test-arrow';")
const modalModule=dataModule("export default function Modal(){return null}")
const pageModule=dataModule("export const buttonPrimary='primary',buttonSecondary='secondary',buttonDanger='danger',inputClass='field';")
const popoverModule=dataModule("export default function Popover(){return null}")
const iconModule=dataModule("export function Icon(){return null}")
const confirmModule=dataModule("export const useConfirm=()=>options=>globalThis.__issueEditorConfirm(options)")
const lib=name=>new URL(`../src/lib/${name}.ts`,import.meta.url).href
const compileModule=(file,map)=>{
  let out=ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
  for(const [path,replacement] of Object.entries({react:hookModule,"react/jsx-runtime":import.meta.resolve("react/jsx-runtime"),...map})) out=out.replaceAll(`from "${path}"`,`from ${JSON.stringify(replacement)}`)
  return dataModule(out)
}
const markupModule=compileModule("../src/components/issues/MarkupLayer.tsx",{"../../lib/issueMarkup":lib("issueMarkup")})
const toolbarModule=compileModule("../src/components/issues/PhotoEditorToolbar.tsx",{"../ui/Popover":popoverModule,"../editor/EditorToolbar":iconModule,"../../lib/photoEditorModel":lib("photoEditorModel")})
const slidesModule=compileModule("../src/components/issues/PhotoSlides.tsx",{"./MarkupLayer":markupModule})
const {default:Editor,MarkupLayer}=await import(compileModule("../src/components/issues/IssuePhotoEditor.tsx",{"../Modal":modalModule,"../ui/PageParts":pageModule,"./MarkupLayer":markupModule,"./PhotoEditorToolbar":toolbarModule,"./PhotoSlides":slidesModule,"../../lib/confirm":confirmModule,"../../lib/issueMarkup":lib("issueMarkup"),"../../lib/canvasView":lib("canvasView"),"../../lib/photoEditorModel":lib("photoEditorModel"),"../../lib/shapes":lib("shapes")}))
let values=[],cursor=0,queued=[]
globalThis.__issueEditorHooks={
  useState(initial){const n=cursor++;if(!(n in values))values[n]=typeof initial === "function" ? initial() : initial;return [values[n],next=>{values[n]=typeof next === "function" ? next(values[n]) : next}]},
  useRef(initial){const n=cursor++;if(!(n in values))values[n]={current:initial};return values[n]},
  useEffect(fn,deps){const n=cursor++,old=values[n];if(!old || deps.some((value,i)=>value!==old.deps[i])) queued.push(()=>{old?.cleanup?.();values[n]={deps,cleanup:fn()}})},
}
let confirmAnswer=true
const confirms=[]
globalThis.__issueEditorConfirm=async options=>{confirms.push(options);return confirmAnswer}
const resizeListeners=new Map(),viewportSize={width:1000,height:500}
const frameListeners=new Map(),captured=new Set()
const frameElement={get clientWidth(){return viewportSize.width},get clientHeight(){return viewportSize.height},getBoundingClientRect:()=>({left:0,top:0}),addEventListener:(name,fn)=>frameListeners.set(name,fn),removeEventListener:name=>frameListeners.delete(name),focus(){},setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)}
globalThis.window={confirm:()=>true,addEventListener:(name,fn)=>resizeListeners.set(name,fn),removeEventListener:name=>resizeListeners.delete(name)}
let saved,closed=0,tree
const photo=(id,caption="Original caption")=>({id,src:`${id}.jpg`,annotations:[],caption})
let props={photos:[photo("photo-1")],onClose:()=>closed++,onSave:async changes=>{saved=changes}}
// The toolbar parts are pure presentational components, so the test unfolds them to reach their real buttons.
const unfold=new Set(["PhotoEditorToolbar","MarkupProperties","IconButton","PhotoSlides"])
const all=node=>{
  if(!node || typeof node!=="object")return []
  if(Array.isArray(node))return node.flatMap(all)
  if(typeof node.type === "function" && unfold.has(node.type.name))return [node,...all(node.type(node.props))]
  return [node,...all(node.props?.children),...all(node.props?.footer)]
}
const label=node=>typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(label).join("") : node?.props ? label(node.props.children) : ""
const get=predicate=>{const found=all(tree).find(predicate);assert.ok(found,"Expected editor control");return found}
const has=predicate=>all(tree).some(predicate)
const button=name=>get(node=>node.type === "button" && (node.props["aria-label"]===name || label(node)===name))
const popover=name=>get(node=>node.type?.name === "Popover" && node.props.label.startsWith(name))
const inPopover=(name,predicate)=>{const found=all(popover(name).props.children(()=>{})).find(predicate);assert.ok(found,`Expected a control in ${name}`);return found}
const shape=name=>inPopover("Shapes",node=>node.type === "button" && node.props.children?.[1]?.props?.children===name)
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const render=()=>{
  cursor=0;tree=Editor(props)
  get(node=>node.props?.["aria-label"] === "Photo annotation canvas").props.ref.current={getBoundingClientRect:()=>({left:0,top:0,width:1000,height:500}),setPointerCapture(){},hasPointerCapture(){return false}}
  get(node=>node.props?.["aria-label"] === "Photo editing viewport").props.ref.current=frameElement
  const jobs=queued;queued=[];jobs.forEach(fn=>fn())
  return tree
}
const reset=next=>{for(const value of values)value?.cleanup?.();values=[];queued=[];props=next;viewportSize.width=1000;viewportSize.height=500}
const canvas=()=>get(node=>node.props?.["aria-label"] === "Photo annotation canvas")
const items=()=>get(node=>node.type === MarkupLayer).props.items
const event=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,stopPropagation(){},preventDefault(){}})
const draw=(x1,y1,x2,y2)=>{canvas().props.onPointerDown(event(x1,y1));render();canvas().props.onPointerMove(event(x2,y2));render();canvas().props.onPointerUp(event(x2,y2));render()}
const load=(width,height)=>{get(node=>node.type === "img").props.onLoad({currentTarget:{naturalWidth:width,naturalHeight:height}});render()}
const keys=(key,extra={})=>{tree.props.children.props.onKeyDown({key,target:{tagName:"DIV"},preventDefault(){},...extra});render()}
render()
assert.ok(!has(node=>node.type === MarkupLayer),"Markup waits for the photo's real size")
load(2000,1000)
const stage=()=>get(node=>node.props?.["data-photo-stage"] !== undefined)
const view=()=>{const [,tx,ty,scale]=stage().props.style.transform.match(/translate\(([^p]+)px, ([^p]+)px\) scale\(([^)]+)\)/);return {tx:Number(tx),ty:Number(ty),scale:Number(scale)}}
const frameWidth=()=>stage().props.style.width*view().scale
const near=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-8,message ?? `${actual} differs from ${expected}`)
const viewportClass=()=>get(node=>node.props?.["aria-label"] === "Photo editing viewport").props.className
near(frameWidth(),952,"The photo opens fitted: the whole image with blueprint padding, never cropped or stretched")
assert.equal(button("Fit").props["aria-pressed"],true)
assert.match(viewportClass(),/shrink-0/);assert.match(viewportClass(),/h-\[56vh\].*min-h-72/);assert.doesNotMatch(viewportClass(),/overscroll-contain/)
assert.ok(!has(node=>node.props?.["aria-label"] === "Next photo") && !has(node=>node.type?.name === "PhotoSlides"),"A single photo shows no slideshow controls")
for(let i=0;i<3;i++){button("Zoom out photo").props.onClick();render()}
near(frameWidth(),952/CANVAS_ZOOM_STEP**3)
for(let i=0;i<30 && !button("Zoom out photo").props.disabled;i++){button("Zoom out photo").props.onClick();render()}
near(view().scale,0.05);assert.equal(button("Zoom out photo").props.disabled,true,"Zoom out matches the blueprint 5 percent limit")
button("Fill").props.onClick();render();near(frameWidth(),1000,"Fill covers both viewport dimensions")
assert.equal(button("Fill").props["aria-pressed"],true);assert.equal(button("Fit").props["aria-pressed"],false)
load(1000,4000);near(frameWidth(),1000,"An explicit Fill is kept for the next image, without stretching it")
button("Fit").props.onClick();render();near(frameWidth(),119,"A tall portrait fits entirely with the same padding as a blueprint")
load(4000,1000);near(frameWidth(),976,"Fit stays the choice for the next image")
button("Fill").props.onClick();render();near(frameWidth(),2000,"A wide photo fills the canvas height; overflow remains pannable")
load(1000,1000)
button("Enter fullscreen photo editor").props.onClick();render()
viewportSize.width=1920;viewportSize.height=1000;resizeListeners.get("resize")();render()
near(frameWidth(),1920,"Fill adapts to fullscreen instead of leaving the photo as a small strip")
assert.match(viewportClass(),/min-h-80 flex-1/)
assert.match(tree.props.children.props.className,/min-h-full/,"Fullscreen gives the canvas the remaining height")
assert.doesNotMatch(tree.props.children.props.className,/(^|\s)h-full/,"Fullscreen content can exceed the modal body and scroll vertically")
assert.ok(has(node=>node.type === "details"),"Fullscreen caption is collapsed to leave more editing space")
assert.equal(get(node=>node.type === "details").props.open,undefined)
button("Fit").props.onClick();render();near(frameWidth(),976,"Fit remains available for a complete uncropped view")
tree.props.onEscape();render();viewportSize.width=1000;viewportSize.height=500;resizeListeners.get("resize")();render()
load(2000,1000);near(frameWidth(),952)

shape("Line").props.onClick();render()
assert.match(popover("Shapes").props.className,/bg-brand/,"The shapes dropdown shows the active shape tool");assert.equal(label(popover("Shapes").props.trigger),"Line")
assert.ok(has(node=>node.props?.role === "toolbar" && node.props["aria-label"] === "Line options"),"A drawing tool shows its properties")
draw(100,100,700,400)
assert.equal(items().length,1);assert.equal(items()[0].kind,"line");assert.equal(items()[0].x,10);assert.equal(items()[0].y2,80)
assert.equal(button("Select").props["aria-pressed"],true,"A finished shape returns to Select, like the blueprint editor")
const frame=()=>get(node=>node.type?.name === "SelectionFrame")
assert.equal(frame().props.item.id,items()[0].id,"The new shape stays selected with its frame and rotate handle")
const resizeBefore = structuredClone(items()[0])
frame().props.onResizeStart("se",event(700,400));render()
canvas().props.onPointerMove(event(800,450));render()
assert.ok(items()[0].x2 > resizeBefore.x2 && items()[0].y2 > resizeBefore.y2, "Dragging a corner resizes the selected photo annotation")
canvas().props.onPointerUp(event(800,450));render()
button("Undo").props.onClick();render();assert.deepEqual(items()[0],resizeBefore,"A resize is one undo step")
button("Redo").props.onClick();render();assert.ok(items()[0].x2 > resizeBefore.x2)
button("Undo").props.onClick();render()
get(node=>node.type === MarkupLayer).props.onSelect(items()[0].id,event(100,100));render();canvas().props.onPointerUp(event(100,100));render()
frame().props.onResizeStart("nw",event(100,100));render()
canvas().props.onPointerMove(event(50,50));render()
canvas().props.onPointerCancel(event(50,50));render();assert.deepEqual(items()[0],resizeBefore,"Cancelled resize restores the annotation")
button("Select").props.onClick();render()
assert.equal(button("Select").props["aria-pressed"],true)
get(node=>node.type === MarkupLayer).props.onSelect(items()[0].id,event(100,100));render();canvas().props.onPointerMove(event(200,150));render();canvas().props.onPointerUp(event(200,150));render()
assert.equal(items()[0].x,20);assert.equal(items()[0].y,30)
assert.ok(has(node=>node.props?.role === "toolbar" && node.props["aria-label"] === "Selected mark"),"A selected mark shows its own properties")
button("Undo").props.onClick();render();assert.equal(items()[0].x,10)
button("Redo").props.onClick();render();assert.equal(items()[0].x,20)
get(node=>node.type === MarkupLayer).props.onSelect(items()[0].id,event(200,150));render();canvas().props.onPointerUp(event(200,150));render()
for(const width of [6,8,10]){inPopover("Line width",node=>node.type === "input").props.onChange({target:{value:String(width)}});render()}
assert.equal(items()[0].stroke,10,"Properties apply to the selected mark straight away")
inPopover("Color",node=>node.props?.["aria-label"] === "Blue").props.onClick();render()
assert.equal(items()[0].color,"#2563eb")
button("Undo").props.onClick();render();assert.equal(items()[0].color,"#d93a3a","A colour pick is its own undo step");assert.equal(items()[0].stroke,10)
button("Undo").props.onClick();render();assert.equal(items()[0].stroke,4,"A whole line-width drag is one undo step")
button("Redo").props.onClick();render();button("Redo").props.onClick();render();assert.equal(items()[0].stroke,10);assert.equal(items()[0].color,"#2563eb")
button("Text").props.onClick();render()
assert.ok(has(node=>node.props?.["aria-label"] === "Text size"),"Text shows its size choices instead of a line width")
canvas().props.onPointerDown(event(300,200));render()
assert.equal(items().length,1);assert.match(label(get(node=>node.props?.role === "alert")),/Type the text/)
get(node=>node.props?.["aria-label"] === "Annotation text").props.onChange({target:{value:"Engineer note"}});render()
canvas().props.onPointerDown(event(300,200));render()
assert.equal(items()[1].text,"Engineer note")
get(node=>node.props?.["aria-label"] === "Annotation text").props.onChange({target:{value:"Engineer note 2"}});render()
assert.equal(items()[1].text,"Engineer note 2","Typing edits the placed text")
get(node=>node.props?.["aria-label"] === "Annotation text").props.onChange({target:{value:"  "}});render()
assert.equal(items()[1].text,"Engineer note 2");assert.match(label(get(node=>node.props?.role === "alert")),/cannot be empty/)
get(node=>node.props?.["aria-label"] === "Annotation text").props.onChange({target:{value:"Engineer note"}});render()
assert.equal(button("Select").props["aria-pressed"],true,"Placed text is selected with the Select tool, ready to move or turn")
assert.equal(frame().props.item.id,items()[1].id)
// Turn the line with its handle: the angle from the mark's centre to the pointer is the rotation; Shift snaps to 15 degrees.
const pick=index=>{get(node=>node.type === MarkupLayer).props.onSelect(items()[index].id,event(200,150));render();canvas().props.onPointerUp(event(200,150));render()}
pick(0)
const centre=markupCenter(items()[0],500)
frame().props.onRotateStart({...event(centre.x,centre.y-80),stopPropagation(){}});render()
canvas().props.onPointerMove(event(centre.x+100,centre.y));render()
assert.equal(items()[0].rotation,90)
canvas().props.onPointerMove({...event(centre.x+100,centre.y-97),shiftKey:true});render()
assert.equal(items()[0].rotation,45,"Shift snaps to 15 degree steps")
canvas().props.onPointerUp(event(centre.x+100,centre.y-97));render()
assert.equal(items()[0].x,20,"Turning never moves the mark");assert.equal(markupProblem(items()),"")
button("Undo").props.onClick();render();assert.equal(items()[0].rotation,undefined,"A whole handle drag is one undo step")
button("Redo").props.onClick();render();assert.equal(items()[0].rotation,45)
pick(0)
keys("]");assert.equal(items()[0].rotation,60);keys("[");keys("[");assert.equal(items()[0].rotation,30)
const degrees=()=>get(node=>node.props?.["aria-label"] === "Rotation in degrees")
assert.equal(degrees().props.value,30)
for(const value of ["-1","-12","-120"]){degrees().props.onChange({target:{value}});render()}
assert.equal(items()[0].rotation,-120)
button("Rotate right 15°").props.onClick();render();assert.equal(items()[0].rotation,-105)
button("Undo").props.onClick();render();assert.equal(items()[0].rotation,-120,"Each 15 degree step is its own undo step")
button("Undo").props.onClick();render();assert.equal(items()[0].rotation,30,"Typing the angle is one undo step")
pick(1)
assert.ok(has(node=>node.props?.["aria-label"] === "Rotation"),"Text can be turned too")
keys("ArrowRight");keys("ArrowRight");keys("ArrowDown",{shiftKey:true})
assert.equal(items()[1].x,31);assert.equal(items()[1].y,45,"Arrow keys nudge the selected mark (Shift = 10x)")
button("Undo").props.onClick();render();assert.equal(items()[1].x,30);assert.equal(items()[1].y,40,"A run of arrow presses is one undo step")
for(const tool of ["Arrow","Rectangle","Ellipse","Freehand"]){shape(tool).props.onClick();render();draw(200,100,600,300)}
assert.equal(items().length,6);assert.equal(markupProblem(items()),"")
keys("r");assert.equal(label(popover("Shapes").props.trigger),"Rectangle","Shortcut keys choose tools like the blueprint editor")
keys("t",{target:{tagName:"TEXTAREA"}});assert.equal(label(popover("Shapes").props.trigger),"Rectangle","Typing in a field never switches tools")
keys("v");assert.equal(button("Select").props["aria-pressed"],true)
keys("z",{ctrlKey:true});assert.equal(items().length,5,"Ctrl+Z undoes the last mark")
keys("z",{ctrlKey:true,shiftKey:true});assert.equal(items().length,6,"Ctrl+Shift+Z redoes it")
const beforeFullscreen=JSON.stringify(items())
button("Zoom out photo").props.onClick();render()
near(frameWidth(),952/CANVAS_ZOOM_STEP)
const manualView=view()
button("Enter fullscreen photo editor").props.onClick();render()
assert.equal(tree.props.fullscreen,true)
viewportSize.width=1920;viewportSize.height=1000;resizeListeners.get("resize")();render()
assert.deepEqual(view(),manualView,"Fullscreen preserves manually adjusted zoom and pan")
assert.ok(has(node=>node.props?.role === "status" && label(node)==="37%"),"Zoom shows the actual photo scale, like the blueprint")
button("Fit").props.onClick();render();near(frameWidth(),1896,"Only explicit Fit adjusts a manually zoomed image to the larger viewport")
button("Zoom out photo").props.onClick();render();near(frameWidth(),1896/CANVAS_ZOOM_STEP)
const afterFitWidth=frameWidth()
assert.equal(JSON.stringify(items()),beforeFullscreen,"Fullscreen never modifies annotations")
tree.props.onEscape();render();assert.equal(tree.props.fullscreen,false);assert.equal(closed,0,"Escape exits fullscreen without closing or discarding the edit")
near(frameWidth(),afterFitWidth,"Leaving fullscreen also preserves the chosen image scale")
button("Enter fullscreen photo editor").props.onClick();render()
button("Exit fullscreen photo editor").props.onClick();render();assert.equal(tree.props.fullscreen,false)
viewportSize.width=1000;viewportSize.height=500;resizeListeners.get("resize")();render()
near(frameWidth(),afterFitWidth,"Resizing the viewport alone must not change a manually adjusted view")
button("Fit").props.onClick();render();near(frameWidth(),952)
for(let i=0;i<40 && !button("Zoom in photo").props.disabled;i++){button("Zoom in photo").props.onClick();render()}
assert.equal(button("Zoom in photo").props.disabled,true,"Zoom in matches the blueprint 1000 percent limit");near(view().scale,10)
button("Fit").props.onClick();render()
const viewport=()=>get(node=>node.props?.["aria-label"] === "Photo editing viewport")
const wheel=frameListeners.get("wheel")
const beforeWheel=view(),anchor={x:250,y:125}
let prevented=false
wheel({deltaY:100,clientX:anchor.x,clientY:anchor.y,preventDefault(){prevented=true}});render()
assert.equal(prevented,false,"Plain wheel is left to normal downward editor scrolling")
assert.deepEqual(view(),beforeWheel,"Scrolling down must not accidentally zoom the image")
wheel({ctrlKey:true,deltaY:-100,clientX:anchor.x,clientY:anchor.y,preventDefault(){prevented=true}});render()
assert.ok(prevented,"Explicit Ctrl+wheel zoom prevents browser/page scrolling")
near((anchor.x-beforeWheel.tx)/beforeWheel.scale,(anchor.x-view().tx)/view().scale,"Wheel zoom keeps the cursor on the same photo coordinate")
near((anchor.y-beforeWheel.ty)/beforeWheel.scale,(anchor.y-view().ty)/view().scale)
const navigationEvent=(id,x,y,buttonValue=0)=>({pointerId:id,button:buttonValue,clientX:x,clientY:y,currentTarget:frameElement,target:{closest:selector=>selector.includes("Photo annotation canvas") ? {} : null},preventDefault(){},stopPropagation(){}})
button("Select").props.onClick();render()
const beforePan=view()
viewport().props.onPointerDownCapture(navigationEvent(1,100,100));render()
viewport().props.onPointerMoveCapture(navigationEvent(1,170,140));render()
near(view().tx,beforePan.tx+70);near(view().ty,beforePan.ty+40)
viewport().props.onPointerUpCapture(navigationEvent(1,170,140));render()
assert.equal(items().length,6,"Panning never creates or moves annotations")
button("Pan").props.onClick();render();assert.equal(button("Pan").props["aria-pressed"],true);assert.equal(button("Select").props["aria-pressed"],false)
assert.ok(!has(node=>node.props?.role === "toolbar" && /options|Selected/.test(node.props["aria-label"])),"Pan needs no properties bar")
shape("Line").props.onClick();render();assert.equal(button("Pan").props["aria-pressed"],false)
const beforePinchItems=JSON.stringify(items())
viewport().props.onPointerDownCapture(navigationEvent(1,100,100));canvas().props.onPointerDown(event(100,100));render()
assert.equal(items().length,7,"First touch can begin a drawing")
viewport().props.onPointerDownCapture(navigationEvent(2,200,100));render()
assert.equal(JSON.stringify(items()),beforePinchItems,"A second finger cancels the unfinished stroke before pinch zoom")
const beforePinch=view()
viewport().props.onPointerMoveCapture(navigationEvent(2,300,100));render()
const expectedPinch=pinchCanvasView(beforePinch,2,{x:150,y:100},{x:200,y:100})
near(view().scale,expectedPinch.scale);near(view().tx,expectedPinch.tx);near(view().ty,expectedPinch.ty)
viewport().props.onPointerUpCapture(navigationEvent(2,300,100));render()
viewport().props.onPointerUpCapture(navigationEvent(1,100,100));render()
viewport().props.onKeyDown({key:" ",preventDefault(){}});render()
const beforeSpacePan=view()
viewport().props.onPointerDownCapture(navigationEvent(1,100,100));render()
viewport().props.onPointerMoveCapture(navigationEvent(1,125,110));render()
near(view().tx,beforeSpacePan.tx+25)
viewport().props.onPointerUpCapture(navigationEvent(1,125,110));render()
resizeListeners.get("keyup")({key:" "});render()
const beforeMiddle=view()
viewport().props.onPointerDownCapture(navigationEvent(1,100,100,1));render()
viewport().props.onPointerMoveCapture(navigationEvent(1,110,120,1));render()
near(view().ty,beforeMiddle.ty+20)
resizeListeners.get("blur")();render()
assert.equal(captured.size,0,"Blur releases navigation pointers instead of leaving zoom stuck")
viewport().props.onKeyDown({key:"0",preventDefault(){}});render()
assert.deepEqual(view(),fitCanvasView({width:2000,height:1000},viewportSize),"0 fits exactly like the sheet editor")
assert.equal(JSON.stringify(items()),beforePinchItems)
const zoomRoundTrip=zoomCanvasView(zoomCanvasView(view(),CANVAS_ZOOM_STEP,anchor),1/CANVAS_ZOOM_STEP,anchor)
near(zoomRoundTrip.scale,view().scale);near(zoomRoundTrip.tx,view().tx);near(zoomRoundTrip.ty,view().ty)
button("Select").props.onClick();render()
get(node=>node.type === MarkupLayer).props.onSelect(items()[items().length-1].id,event(100,100));render()
canvas().props.onPointerUp(event(100,100));render()
button("Delete selected").props.onClick();render();assert.equal(items().length,5)
const originalBefore=JSON.stringify(items())
button("View original").props.onClick();render()
assert.ok(!has(node=>node.type === MarkupLayer),"Original toggle hides markup without deleting it")
assert.equal(button("Text").props.disabled,true,"Drawing tools rest while the original is shown")
button("Show markup").props.onClick();render();assert.equal(JSON.stringify(items()),originalBefore)
get(node=>node.type === "textarea").props.onChange({target:{value:"Edited caption"}});render()
button("Save photo markup").props.onClick();await tick();render()
assert.equal(saved.length,1);assert.equal(saved[0].id,"photo-1");assert.equal(saved[0].annotations.length,5);assert.equal(saved[0].caption,"Edited caption");assert.equal(closed,1)
assert.deepEqual(props.photos[0].annotations,[],"The original input/saved version is never mutated")
const malicious={...saved[0].annotations[0],kind:"text",text:"<script>alert(1)</script>"}
const html=renderToStaticMarkup(createElement("svg",null,createElement(MarkupLayer,{items:[malicious],height:500})))
assert.ok(html.includes("&lt;script&gt;"));assert.ok(!html.includes("<script>"))
const turned={id:"turned",kind:"rectangle",x:10,y:10,x2:30,y2:30,color:"#d93a3a",stroke:4,fontSize:30,text:"",points:[],rotation:30}
const viewerHtml=renderToStaticMarkup(createElement("svg",null,createElement(MarkupLayer,{items:[turned],height:500})))
assert.ok(viewerHtml.includes('transform="rotate(30 200 100)"'),"Viewers and thumbnails draw the saved turn around the mark's centre")
assert.ok(!viewerHtml.includes("data-grab"),"Read-only views get no grab areas")
const editableHtml=renderToStaticMarkup(createElement("svg",null,createElement(MarkupLayer,{items:[turned,{...turned,id:"label",kind:"text",text:"Gap"}],height:500,onSelect(){}})))
assert.match(editableHtml,/data-grab="true" stroke="transparent" stroke-width="24"/,"Thin outlines get a wide invisible grab band")
assert.match(editableHtml,/<rect data-grab="true" x="[^"]+" y="[^"]+" width="[^"]+" height="[^"]+" fill="transparent"/,"Text gets a grab box around the whole text")
console.log("Photo editor blueprint-parity toolbar (tools, shapes dropdown, properties, shortcuts), select-after-create, rotate handle/keys/degrees, arrow nudge, grab areas, wheel/cursor zoom, button scale/limits, drag/Space/middle/pinch pan, touch drawing cancellation, Fit-first/Fill/fullscreen, markup preservation and save passed")

// Several photos: a manual slideshow. Every photo keeps its own markup, caption and undo history; Save returns only changes.
reset({photos:[photo("a","First"),photo("b","Second"),{...photo("c","Third"),annotations:[{id:"kept",kind:"rectangle",x:10,y:10,x2:30,y2:30,color:"#2563eb",stroke:4,fontSize:30,text:"",points:[]}]}],onClose:()=>closed++,onSave:async changes=>{saved=changes}})
saved=undefined;closed=0
render();load(2000,1000)
const counter=()=>label(get(node=>node.type === "span" && /^Image \d+ of \d+$/.test(label(node))))
const slides=()=>get(node=>node.type?.name === "PhotoSlides")
assert.equal(counter(),"Image 1 of 3");assert.equal(button("Previous photo").props.disabled,true,"No wrap-around before the first photo")
assert.equal(slides().props.slides.length,3);assert.ok(has(node=>node.props?.role === "option" && node.props["aria-selected"] === true && node.props["data-slide"] === 0),"The current thumbnail is highlighted")
shape("Line").props.onClick();render();draw(100,100,700,400)
assert.equal(items().length,1);assert.equal(slides().props.slides[0].changed,true)
button("Enter fullscreen photo editor").props.onClick();render()
button("Next photo").props.onClick();render()
assert.equal(counter(),"Image 2 of 3");assert.equal(tree.props.fullscreen,true,"Fullscreen stays on while moving between photos")
assert.ok(!has(node=>node.type === MarkupLayer),"The next photo waits for its own image size")
load(1000,1000)
assert.equal(items().length,0,"Photo 2 has its own markup");assert.equal(button("Undo").props.disabled,true,"Photo 2 has its own undo history")
assert.equal(button("Select").props["aria-pressed"],true,"The tool stays while moving between photos")
assert.ok(!has(node=>node.type?.name === "SelectionFrame"),"A selection never carries over to another photo")
shape("Line").props.onClick();render();draw(200,100,600,300)
get(node=>node.type === "textarea").props.onChange({target:{value:"Second, marked"}});render()
slides().props.onSelect(0);render();load(2000,1000)
assert.equal(counter(),"Image 1 of 3");assert.equal(items().length,1);assert.equal(button("Undo").props.disabled,false,"Photo 1 kept its undo history")
button("Undo").props.onClick();render();assert.equal(items().length,0);button("Redo").props.onClick();render();assert.equal(items().length,1)
keys("PageDown");keys("PageDown");load(1000,1000)
assert.equal(counter(),"Image 3 of 3");assert.equal(items()[0].id,"kept");assert.equal(button("Next photo").props.disabled,true,"No wrap-around after the last photo")
keys("PageUp");load(1000,1000)
assert.equal(get(node=>node.type === "textarea").props.value,"Second, marked","Each photo keeps its own caption")
button("Hide photo thumbnails").props.onClick();render();assert.ok(!has(node=>node.type?.name === "PhotoSlides"))
button("Show photo thumbnails").props.onClick();render();assert.ok(has(node=>node.type?.name === "PhotoSlides"))
assert.ok(has(node=>label(node) === "2 of 3 photos changed"))
confirmAnswer=false
button("Close").props.onClick();await tick();render()
assert.equal(closed,0);assert.equal(confirms.length,1,"Closing with unsaved markup asks first");assert.equal(confirms[0].tone,"danger")
confirmAnswer=true
button("Save markup").props.onClick();await tick();render()
assert.deepEqual(saved.map(change=>change.id),["a","b"],"Save returns only the photos that changed");assert.equal(saved[1].caption,"Second, marked");assert.equal(saved[0].annotations.length,1);assert.equal(closed,1)

// Read-only viewing has no drawing tools, never asks, and an unchanged editor closes without writing a new version.
reset({photos:[{...photo("r","Client caption"),annotations:[{id:"m",kind:"arrow",x:1,y:1,x2:9,y2:9,color:"#d93a3a",stroke:4,fontSize:30,text:"",points:[]}]}],readOnly:true,onClose:()=>closed++})
closed=0;confirms.length=0
render();load(1000,1000)
assert.ok(!has(node=>node.props?.["aria-label"] === "Text") && !has(node=>node.type?.name === "Popover"),"Read-only has no drawing tools")
assert.ok(!has(node=>node.type === "textarea") && has(node=>node.type === "p" && label(node) === "Client caption"))
assert.ok(!has(node=>node.type === "button" && label(node) === "Save photo markup"));assert.equal(items().length,1)
button("Close").props.onClick();await tick();assert.equal(closed,1);assert.equal(confirms.length,0,"Read-only never asks")
reset({photos:[photo("n")],onClose:()=>closed++,onSave:async()=>{throw new Error("nothing changed, nothing to save")}})
render();load(1000,1000)
button("Save photo markup").props.onClick();await tick();assert.equal(closed,2,"Saving without changes just closes")
button("Close").props.onClick();await tick();assert.equal(confirms.length,0,"Closing without changes never asks")
console.log("Photo editor slideshow (one photo at a time, counter, highlighted thumbnails, hide/show strip, Page Up/Down, fullscreen kept, per-photo markup/caption/undo, changed-only save), unsaved-change protection and read-only view passed")

// Verify fullscreen sizing and the topmost dialog's Escape override in the actual shared Modal.
for(const value of values)value?.cleanup?.();values=[];queued=[]
const portalModule=dataModule("export const createPortal=node=>node;")
let modalCompiled=ts.transpileModule(readFileSync(new URL("../src/components/Modal.tsx",import.meta.url),"utf8"),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
for(const [path,replacement] of [["react",hookModule],["react-dom",portalModule],["react/jsx-runtime",import.meta.resolve("react/jsx-runtime")]])modalCompiled=modalCompiled.replace(`from "${path}"`,`from ${JSON.stringify(replacement)}`)
const {default:ActualModal}=await import(dataModule(modalCompiled))
let keyboard,escaped=0,modalClosed=0,restored=0
const fakePanel={querySelectorAll:()=>[],querySelector:()=>null,focus(){}}
globalThis.document={activeElement:{focus(){restored++}},body:{style:{overflow:"auto"}},querySelectorAll:()=>[fakePanel],addEventListener:(_name,fn)=>{keyboard=fn},removeEventListener(){}}
const renderModal=props=>{cursor=0;tree=ActualModal(props);get(node=>node.props?.role === "dialog").props.ref.current=fakePanel;const jobs=queued;queued=[];jobs.forEach(fn=>fn())}
const modalProps={title:"Photo",children:"Canvas",fullscreen:true,onClose:()=>modalClosed++,onEscape:()=>escaped++}
renderModal(modalProps)
assert.match(get(node=>node.props?.role === "dialog").props.className,/h-\[100dvh\].*max-w-none/)
keyboard({key:"Escape",stopPropagation(){},preventDefault(){}});assert.equal(escaped,1);assert.equal(modalClosed,0)
renderModal({...modalProps,fullscreen:false,onEscape:undefined})
assert.match(get(node=>node.props?.role === "dialog").props.className,/max-w-lg/)
keyboard({key:"Escape",stopPropagation(){},preventDefault(){}});assert.equal(modalClosed,1,"Normal modal Escape retains its original close action")
for(const value of values)value?.cleanup?.();values=[];queued=[]
assert.equal(document.body.style.overflow,"auto");assert.equal(restored,1)
let focusOptions,focused=""
const firstLink={closest(){return null},focus(){focused="first"}},lastLink={closest(){return null},focus(){focused="last"}}
const hiddenControl={closest(){return {}},focus(){assert.fail("Hidden inspection panels must never receive focus")}}
fakePanel.querySelectorAll=()=>[hiddenControl,firstLink,lastLink,hiddenControl]
document.activeElement={focus(options){restored++;focusOptions=options}}
renderModal({title:"Valencia navigation",children:"Links",placement:"right",onClose:()=>modalClosed++})
assert.equal(get(node=>node.props?.role === "dialog").props["aria-modal"],"true")
assert.match(tree.props.className,/items-stretch justify-end p-0/)
assert.match(get(node=>node.props?.role === "dialog").props.className,/h-\[100dvh\].*max-w-\[min\(88vw,24rem\)\]/)
assert.equal(document.body.style.overflow,"hidden")
assert.equal(focused,"first","Opening focuses the first drawer control")
document.activeElement=lastLink
keyboard({key:"Tab",preventDefault(){}});assert.equal(focused,"first","Tab wraps within visible controls, skipping hidden inspection panels")
document.activeElement=firstLink
keyboard({key:"Tab",shiftKey:true,preventDefault(){}});assert.equal(focused,"last","Shift+Tab wraps within the drawer")
keyboard({key:"Escape",stopPropagation(){},preventDefault(){}});assert.equal(modalClosed,2)
const backdrop={}
tree.props.onMouseDown({target:{},currentTarget:backdrop});assert.equal(modalClosed,2,"Inside clicks do not dismiss the drawer")
tree.props.onMouseDown({target:backdrop,currentTarget:backdrop});assert.equal(modalClosed,3,"Backdrop click dismisses the drawer")
for(const value of values)value?.cleanup?.();values=[];queued=[]
assert.equal(document.body.style.overflow,"auto");assert.equal(restored,2)
assert.deepEqual(focusOptions,{preventScroll:true},"Closing the drawer restores focus without jumping away from the chosen section")
console.log("Shared modal fullscreen/default and sidebar sizing, current Escape handler, backdrop close, focus trap, scroll lock and scroll-preserving drawer focus restoration passed")

// Exercise the actual Log issue form: the shared sheet -> pin -> checklist picker, the saved selection and its guards, without network access.
let logCalls=[],retryCalls=0
globalThis.__issueChecklistTest={
  lists:{
    "pin-a":{items:[{id:"floor-a",pin_id:"pin-a",text:"FLOOR"}],loading:false,error:"",reload:async()=>retryCalls++},
    "pin-b":{items:[{id:"wall-b",pin_id:"pin-b",text:"WALL"}],loading:false,error:"",reload:async()=>retryCalls++},
  },
  log:async input=>{logCalls.push(input)},
}
const blueprintModule=dataModule("export const severityLabels={low:'Low',medium:'Medium',high:'High',critical:'Critical'};export const useChecklist=id=>id?globalThis.__issueChecklistTest.lists[id]:{items:[],loading:false,error:'',reload:async()=>{}};")
const progressModule=dataModule("export const severityOrder=['critical','high','medium','low'];")
const issueModule=dataModule("export const logSiteIssue=input=>globalThis.__issueChecklistTest.log(input);")
const pickerModule=dataModule("export default function PinLinkPicker(){return null}")
let logCompiled=ts.transpileModule(readFileSync(new URL("../src/components/issues/LogIssueModal.tsx",import.meta.url),"utf8"),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
for(const [path,replacement] of [["react",hookModule],["react/jsx-runtime",import.meta.resolve("react/jsx-runtime")],["../Modal",modalModule],["../ui/PageParts",pageModule],["../ui/PinLinkPicker",pickerModule],["../../lib/blueprints",blueprintModule],["../../lib/progress",progressModule],["../../lib/siteIssues",issueModule],["./IssuePhotoPicker",modalModule],["../../lib/pinPickerModel",new URL("../src/lib/pinPickerModel.ts",import.meta.url).href]]) {
  logCompiled=logCompiled.replace(`from "${path}"`,`from ${JSON.stringify(replacement)}`)
}
const {default:LogIssueModal}=await import(dataModule(logCompiled))
const logPins=[{id:"pin-a",project_id:"project",blueprint_id:"sheet",status:"in_progress",category:"progress",title:"Kitchen"},{id:"pin-b",project_id:"project",blueprint_id:"sheet",status:"in_progress",category:"progress",title:"Laundry"},{id:"done",project_id:"project",blueprint_id:"sheet",status:"verified",category:"progress",title:"Completed"}]
let logProps={pins:logPins,sheets:[{id:"sheet",title:"Ground floor"}],sheetOf:()=>"Plan",onClose:()=>{},onDone:async()=>{}}
const renderLog=()=>{cursor=0;tree=LogIssueModal(logProps)}
const picker=()=>get(node=>typeof node.type === "function" && node.type.name === "PinLinkPicker")
values=[];renderLog()
assert.deepEqual(picker().props.value,{sheetId:"",pinId:"",itemId:""},"From the issue register nothing is preselected")
assert.deepEqual(picker().props.pins.map(pin=>pin.id),["pin-a","pin-b"],"Completed work is not offered")
assert.deepEqual(picker().props.sheets,[{id:"sheet",title:"Ground floor"}])
assert.equal(button("Log issue").props.disabled,true,"A site issue needs its work pin")
picker().props.onChange({sheetId:"sheet",pinId:"pin-a",itemId:"floor-a"});renderLog()
assert.equal(picker().props.checklist,globalThis.__issueChecklistTest.lists["pin-a"],"The picker shows the chosen pin's checklist")
get(node=>node.type === "textarea").props.onChange({target:{value:"Synthetic issue description"}});renderLog()
assert.equal(button("Log issue").props.disabled,false)
get(node=>node.type === "form").props.onSubmit({preventDefault(){}})
await new Promise(resolve=>setImmediate(resolve));renderLog()
assert.equal(logCalls.length,1);assert.equal(logCalls[0].checklistItemId,"floor-a");assert.equal(logCalls[0].pinId,"pin-a");assert.equal(logCalls[0].projectId,"project")
picker().props.onChange({sheetId:"sheet",pinId:"pin-b",itemId:"floor-a"});renderLog()
assert.equal(button("Log issue").props.disabled,true,"An item of another pin is refused")
get(node=>node.type === "form").props.onSubmit({preventDefault(){}})
await new Promise(resolve=>setImmediate(resolve));assert.equal(logCalls.length,1,"Wrong-pin checklist cannot be submitted")
picker().props.onChange({sheetId:"sheet",pinId:"pin-b",itemId:""})
globalThis.__issueChecklistTest.lists["pin-b"].loading=true;renderLog();assert.equal(button("Log issue").props.disabled,true,"Wait for the checklist before saving")
globalThis.__issueChecklistTest.lists["pin-b"].loading=false;globalThis.__issueChecklistTest.lists["pin-b"].error="offline";renderLog()
assert.equal(button("Log issue").props.disabled,true);await picker().props.checklist.reload();assert.equal(retryCalls,1)
globalThis.__issueChecklistTest.lists["pin-b"].error="";renderLog();assert.equal(button("Log issue").props.disabled,false)
logProps={...logProps,initialPinId:"pin-b",initialItemId:"wall-b"};values=[];renderLog()
assert.deepEqual(picker().props.value,{sheetId:"sheet",pinId:"pin-b",itemId:"wall-b"},"From a pin panel the sheet, pin and item are already chosen")
logProps={...logProps,pins:logPins.map(pin=>pin.id==="pin-b"?{...pin,status:"for_review",locked:true}:pin)};values=[];renderLog()
assert.equal(picker().props.value.pinId,"pin-b","A pin waiting for QA remains selected even if its position is locked")
assert.equal(button("Log issue").props.disabled,false,"Pending QA does not prevent logging a site issue")
assert.ok(!picker().props.pins.some(pin=>pin.id==="done"),"Completed work remains unavailable")
console.log("Issue form: shared pin picker, preselected pin from the panel, saved selection, wrong-pin rejection, checklist loading/error guards and retry passed")
delete globalThis.__issueChecklistTest
delete globalThis.__issueEditorHooks
