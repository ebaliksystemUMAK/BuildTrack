import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { resizedPoints } from "../src/lib/arrange.ts"
process.on("uncaughtException", error => { console.error(error.message.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, "isolated module")); process.exit(1) })

// Exercise the real stage's handles and pointer lifecycle without storage or a browser.
const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let values = [], cursor = 0, tree, writes = []
globalThis.__resizeHooks = {
  useState(initial) { const n = cursor++; if (!(n in values)) values[n] = typeof initial === "function" ? initial() : initial; return [values[n], next => { values[n] = typeof next === "function" ? next(values[n]) : next }] },
  useRef(initial) { const n = cursor++; return values[n] ??= { current: initial } },
  useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, useLayoutEffect() {},
}
const hooks = url(Object.keys(globalThis.__resizeHooks).map(name => `export const ${name}=(...args)=>globalThis.__resizeHooks.${name}(...args)`).join(";"))
const metadata = url('export const annotationColors={magenta:"#9e1f93"};export const isPointKind=kind=>["draw","highlight","arrow","dimension","polyline","area","cloud"].includes(kind);export const formatMeters=x=>String(x);export const measureDistance=()=>0;export const useSignedUrl=()=>({url:null,failed:false});export const statusDot={},statusLabels={};')
const source = readFileSync(new URL("../src/components/editor/StageCanvas.tsx", import.meta.url), "utf8")
const ast = ts.createSourceFile("stage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
  const name = declaration.moduleSpecifier.text
  const replacement = name === "react" ? hooks : name === "../../lib/blueprints" ? metadata : name === "./EditorToolbar" ? url("export const Icon=()=>null") : name === "../../lib/sheetImages" ? url("export const imageFilesFrom=()=>[]") : new URL(`../src/components/editor/${name}.ts`, import.meta.url).href
  output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
}
output = output.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
const { default: Stage } = await import(url(output))
const all = node => Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children)] : []
const dom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }), setPointerCapture() {} }
const annotation = { id: "drawing", kind: "draw", x: 10, y: 10, w: null, h: null, points: [[10,10],[20,30],[30,20]], color: "magenta", opacity: 1, stroke: 0.2, rotation: 0, z_index: 1, locked: false }
let props = { src: "plan.png", width: 1000, height: 500, tool: "select", color: "magenta", pins: [], annotations: [annotation], selection: { pin: null, ann: ["drawing"] }, canEdit: true, canStamp: false, readOnly: false, showPins: true, showNotes: true, showShapes: true, showDrawings: true, hiddenIds: new Set(), hiddenPinIds: new Set(), measurements: [], scaleWidthM: null, onResizeAnnotation: (...args) => writes.push(args) }
function render() { cursor = 0; tree = Stage(props); for (const node of all(tree)) if (node.props.ref && typeof node.props.ref === "object") node.props.ref.current = dom }
const handles = () => all(tree).filter(node => ["nw","ne","sw","se"].includes(node.props["data-handle"]))
const event = (x,y,corner="se") => ({ button: 0, pointerType: "mouse", pointerId: 1, clientX: x, clientY: y, currentTarget: dom, target: { closest: selector => selector === "[data-handle]" ? { dataset: { handle: corner } } : selector === "[data-ann-id]" ? { getAttribute: () => "drawing" } : null } })
render(); assert.equal(handles().length, 4, "Freehand drawings have four visible, usable corners")
tree.props.onPointerDown(event(300,150)); render()
tree.props.onPointerMove(event(400,200)); render()
assert.equal(writes.length, 0, "Dragging is preview-only until release")
const previewPath = all(tree).find(node => node.type === "path" && node.props.stroke === "#9e1f93").props.d
assert.match(previewPath, /400/, "The actual drawing vertices resize in the preview")
tree.props.onPointerUp(event(400,200)); render()
assert.equal(writes.length,1); assert.equal(writes[0][0],"drawing")
assert.deepEqual(resizedPoints(annotation.points,writes[0][1]),[[10,10],[25,40],[40,25]], "The saved box produces exactly the preview geometry")
tree.props.onPointerDown(event(300,150)); render(); tree.props.onPointerMove(event(500,200)); render()
tree.props.onPointerCancel(event(500,200)); render(); assert.equal(writes.length,1,"Pointer cancellation discards preview without saving")
for (const override of [{ canEdit:false }, { readOnly:true }, { annotations:[{...annotation,locked:true}] }, { showDrawings:false }]) {
  const before=props; props={...props,...override}; render(); assert.equal(handles().length,0,"Read-only, locked, hidden or unauthorized work has no resize handles"); props=before
}
for (const kind of ["arrow","dimension","polyline","area","cloud","highlight"]) {
  props={...props,annotations:[{...annotation,kind}]}; render(); assert.equal(handles().length,4,`${kind} can be resized`)
}
console.log("Blueprint corner handles, real geometry preview/release, cancellation and permission guards passed")

const pin={id:"work-pin",title:"Bedroom",x:30,y:40,status:"open",locked:false}
const pinWrites=[]
props={...props,annotations:[],pins:[pin],selection:{pin:pin.id,ann:[]},canEdit:true,readOnly:false,numberOf:()=>1,onPick(){},onMovePin:(...args)=>pinWrites.push(args),movingPinId:pin.id,onCancelPinMove(){props={...props,movingPinId:null}}}
render()
assert.ok(all(tree).some(node=>node.props.role==="status"),"Move mode displays placement instructions")
tree.props.onPointerDown({...event(600,300),preventDefault(){}});render()
assert.equal(pinWrites.length,0,"Choosing a location waits for release")
tree.props.onPointerUp(event(600,300));render()
assert.deepEqual(pinWrites,[[pin.id,60,60]],"A tap places the same pin at the chosen plan coordinates")
tree.props.onPointerDown({...event(600,300),preventDefault(){}});render()
tree.props.onPointerMove(event(700,350));render();tree.props.onPointerUp(event(700,350));render()
assert.equal(pinWrites.length,1,"A drag/pan gesture is not mistaken for a placement tap")
tree.props.onPointerDown({...event(500,250),preventDefault(){}});render();tree.props.onPointerCancel(event(500,250));render()
assert.equal(pinWrites.length,1,"Cancelled touch does not relocate the pin")
all(tree).find(node=>node.type==="button"&&node.props.children==="Cancel move").props.onClick();render()
assert.ok(!all(tree).some(node=>node.props.role==="status"));assert.equal(pinWrites.length,1)
const pinEvent=(x,y)=>({...event(x,y),target:{closest:selector=>selector==="[data-pin-id]"?{dataset:{pinId:pin.id}}:null}})
tree.props.onPointerDown(pinEvent(300,200));render();tree.props.onPointerMove(pinEvent(400,250));render()
assert.equal(pinWrites.length,1);tree.props.onPointerUp(pinEvent(400,250));render()
assert.deepEqual(pinWrites.at(-1),[pin.id,40,50],"Select-drag still moves the pin")
tree.props.onPointerDown(pinEvent(300,200));render();tree.props.onPointerMove(pinEvent(500,300));render();tree.props.onPointerCancel(pinEvent(500,300));render()
assert.equal(pinWrites.length,2,"Cancelled dragging preserves the saved position")
for(const override of [{canEdit:false},{readOnly:true},{pins:[{...pin,locked:true}]}]){
  const previous=props;props={...props,...override,movingPinId:pin.id};render()
  assert.ok(!all(tree).some(node=>node.props.role==="status"),"Move mode is unavailable to read-only/locked work")
  tree.props.onPointerDown(pinEvent(300,200));render();tree.props.onPointerMove(pinEvent(400,250));render();tree.props.onPointerUp(pinEvent(400,250));render()
  assert.equal(pinWrites.length,2,"Read-only, unauthorized and locked pins do not move")
  props=previous
}
props={...props,movingPinId:pin.id};render();tree.props.onPointerDown({...event(600,300),preventDefault(){}});render()
props={...props,canEdit:false};render();tree.props.onPointerUp(event(600,300));render()
assert.equal(pinWrites.length,2,"Losing editing access before release cancels placement")
console.log("Engineer pin placement/dragging, tap discrimination, cancellation, current lock/access and read-only guards passed")

// Exercise the actual save handler, retaining its optimistic rollback and undo logic.
const editorSource=readFileSync(new URL("../src/components/editor/BlueprintEditor.tsx",import.meta.url),"utf8")
const editorAst=ts.createSourceFile("editor.tsx",editorSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let moveArrow
const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(editorAst)==="movePin")moveArrow=node.initializer.getText(editorAst);ts.forEachChild(node,visit)}
visit(editorAst);assert.ok(moveArrow)
const handlerSource=`export default async function(...args){const {pins,editable,blueprint,pinMovePending,setMovingPinId,setPins,writePin,toast,undoStack,reloadPins,touched}=globalThis.__pinSave;return (${moveArrow})(...args)}`
const {default:saveMove}=await import(url(ts.transpileModule(handlerSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText))
let saveOk=true,throws=false,undoSteps=[],pinUpdates=[],errors=[],reloads=0,touches=0
const pinBefore={...pin,blueprint_id:"sheet",status:"in_progress",assigned_to:"foreman"}
const fixture=globalThis.__pinSave={pins:[pinBefore],editable:true,blueprint:{id:"sheet"},pinMovePending:{current:new Set()},setMovingPinId(){},setPins:fn=>{fixture.pins=fn(fixture.pins)},writePin:async(id,patch)=>{pinUpdates.push({id,patch});if(throws)throw Error("Network request failed");return saveOk},toast:{info:(...args)=>errors.push(args),error:(...args)=>errors.push(args)},undoStack:{push:step=>undoSteps.push(step)},reloadPins:async()=>{reloads++},touched:()=>{touches++}}
await saveMove(pin.id,45,65)
assert.deepEqual(pinUpdates,[{id:pin.id,patch:{x:45,y:65}}],"Moving writes only coordinates, keeping assignments, dates and QA decisions")
assert.equal(fixture.pins[0].status,pinBefore.status);assert.equal(fixture.pins[0].assigned_to,"foreman");assert.equal(undoSteps.length,1)
assert.equal(await undoSteps[0].undo(),true);assert.deepEqual(pinUpdates.at(-1).patch,{x:30,y:40})
assert.equal(await undoSteps[0].redo(),true);assert.deepEqual(pinUpdates.at(-1).patch,{x:45,y:65});assert.equal(reloads,2)
saveOk=false;await saveMove(pin.id,50,70);assert.equal(fixture.pins[0].x,45);assert.equal(fixture.pins[0].y,65);assert.equal(undoSteps.length,1);assert.equal(errors.length,1)
saveOk=true;throws=true;await saveMove(pin.id,55,75);assert.equal(fixture.pins[0].x,45);assert.equal(errors.length,2);assert.equal(fixture.pinMovePending.current.size,0)
throws=false
const savedCount=pinUpdates.length
await saveMove(pin.id,45,65);await saveMove(pin.id,NaN,50)
fixture.editable=false;await saveMove(pin.id,50,70);fixture.editable=true
fixture.pins=[{...fixture.pins[0],locked:true}];await saveMove(pin.id,50,70)
fixture.pins=[{...fixture.pins[0],locked:false,blueprint_id:"other-sheet"}];await saveMove(pin.id,50,70)
assert.equal(pinUpdates.length,savedCount,"No-op, invalid, read-only, locked and other-sheet moves never write")
assert.equal(touches,1)
delete globalThis.__pinSave
console.log("Pin save handler: coordinate-only writes, undo/redo, denied/network rollback, no-op and current edit/sheet/lock guards passed")
