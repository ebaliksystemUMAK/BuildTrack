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
