import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
const hooks = moduleUrl("export const useState=(...a)=>globalThis.__cameraHooks.useState(...a);export const useRef=(...a)=>globalThis.__cameraHooks.useRef(...a);export const useEffect=(...a)=>globalThis.__cameraHooks.useEffect(...a);export const useCallback=fn=>fn;")
async function compile(file, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [name, path] of Object.entries({ react: hooks, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...replacements })) {
    source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(path)}`)
  }
  return import(moduleUrl(source))
}
let values = [], effectValues = [], pending = [], cursor = 0
globalThis.__cameraHooks = {
  useState(initial) {
    const n = cursor++
    if (!(n in values)) values[n] = initial
    return [values[n], next => { values[n] = typeof next === "function" ? next(values[n]) : next }]
  },
  useRef(initial) {
    const n = cursor++
    if (!(n in values)) values[n] = { current: initial }
    return values[n]
  },
  useEffect(fn, deps) {
    const n = cursor++
    const before = effectValues[n]
    if (!before || deps.some((value, i) => value !== before.deps[i])) {
      pending.push(() => {
        before?.cleanup?.()
        effectValues[n] = { deps, cleanup: fn() }
      })
    }
  },
}
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator")
const originalDocument = globalThis.document
const originalWindow = globalThis.window
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
let cameraRequests = [], streams = [], revoked = [], objectCount = 0, drawn = [], encoded = []
let getMedia = async () => {
  const track = { stops: 0, stop() { this.stops++ } }
  const stream = { track, getTracks: () => [track] }
  streams.push(stream)
  return stream
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: constraints => { cameraRequests.push(constraints); return getMedia() } } } })
const video = { srcObject: null, videoWidth: 1920, videoHeight: 1080, play: async () => {} }
let encode = callback => callback(new Blob(["JPEG camera bytes"], { type: "image/jpeg" }))
globalThis.document = { createElement: kind => {
  assert.equal(kind, "canvas")
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (...args) => drawn.push(args) }),
    toBlob: (callback, type, quality) => { encoded.push({ width: canvas.width, height: canvas.height, type, quality }); encode(callback) },
  }
  return canvas
} }
URL.createObjectURL = () => `blob:portrait-${++objectCount}`
URL.revokeObjectURL = url => revoked.push(url)
const model = new URL("../src/lib/attendanceModel.ts", import.meta.url).href
const { default: Camera } = await compile("../src/components/attendance/WorkerCamera.tsx", { "../../lib/attendanceModel": model })
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" ? node : ""
let tree, props = { value: null, disabled: false, onChange: value => { props.value = value } }
const render = () => {
  for (let pass = 0; pass < 2; pass++) {
    cursor = 0
    tree = Camera(props)
    for (const element of all(tree)) if (element.type === "video") element.props.ref.current = video
    const queued = pending; pending = []; queued.forEach(fn => fn())
  }
}
const find = predicate => { const found = all(tree).find(predicate); assert.ok(found, "Expected camera control"); return found }
const button = label => find(node => node.type === "button" && text(node) === label)
const unmount = () => { effectValues.forEach(value => value?.cleanup?.()); values = []; effectValues = []; pending = [] }
const live = async () => {
  await button(props.value ? "Retake photo" : "Open camera").props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  render()
  find(node => node.type === "video").props.onLoadedData()
  render()
}

render()
assert.equal(cameraRequests.length, 0, "Never request camera permission automatically")
assert.equal(all(tree).filter(node => node.type === "input").length, 0, "No file picker")
await live()
assert.equal(cameraRequests[0].audio, false)
assert.equal(video.srcObject, streams[0])
await button("Capture photo").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render()
assert.equal(props.value.type, "image/jpeg")
assert.match(props.value.name, /\.jpg$/)
assert.equal(encoded[0].width, 1024); assert.equal(encoded[0].height, 576)
assert.equal(drawn[0][0], video)
assert.equal(streams[0].track.stops, 1)
assert.equal(video.srcObject, null)
assert.match(text(tree), /Save the worker profile to upload/)
assert.equal(find(node => node.type === "img").props.src, "blob:portrait-1")
const firstPhoto = props.value
await live(); button("Cancel camera").props.onClick(); render()
assert.equal(props.value, firstPhoto, "Cancel retake preserves the previous capture")
assert.equal(streams[1].track.stops, 1)
await live(); await button("Capture photo").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render()
assert.ok(revoked.includes("blob:portrait-1"))
button("Discard capture").props.onClick(); render()
assert.equal(props.value, null)
assert.ok(revoked.includes("blob:portrait-2"))

getMedia = async () => { throw { name: "NotAllowedError" } }
await button("Open camera").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render()
assert.match(text(tree), /Allow camera access/)
getMedia = async () => { throw { name: "NotFoundError" } }
await button("Open camera").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render()
assert.match(text(tree), /No camera was found/)
const realMedia = navigator.mediaDevices
navigator.mediaDevices = undefined
await button("Open camera").props.onClick(); render()
assert.match(text(tree), /HTTPS or localhost/)
navigator.mediaDevices = realMedia

let resolveMedia
getMedia = () => new Promise(resolve => { resolveMedia = resolve })
const opening = button("Open camera").props.onClick(); render()
assert.equal(button("Capture photo").props.disabled, true)
button("Cancel camera").props.onClick(); render()
const lateTrack = { stops: 0, stop() { this.stops++ } }
resolveMedia({ getTracks: () => [lateTrack] }); await opening; await new Promise(resolve => setImmediate(resolve)); render()
assert.equal(lateTrack.stops, 1, "Cancelled permission request releases its late stream")
assert.ok(!all(tree).some(node => node.type === "video"))

getMedia = async () => {
  const track = { stops: 0, stop() { this.stops++ } }
  const stream = { track, getTracks: () => [track] }; streams.push(stream); return stream
}
await live()
let resolveImage
encode = callback => { resolveImage = callback }
const capture = button("Capture photo").props.onClick(); render()
button("Cancel camera").props.onClick(); render()
resolveImage(new Blob(["late"], { type: "image/jpeg" })); await capture; await new Promise(resolve => setImmediate(resolve)); render()
assert.equal(props.value, null, "Cancelled image encoding cannot attach a stale photo")
await live()
const active = streams.at(-1)
props.disabled = true; render()
assert.equal(active.track.stops, 1, "Saving stops the camera")
assert.equal(button("Open camera").props.disabled, true)
props.disabled = false; render(); await live()
const last = streams.at(-1)
unmount()
assert.equal(last.track.stops, 1, "Navigation/worker switch stops all camera tracks")

// Daily progress report capture also requires a real camera frame and never offers a file/gallery picker.
const { default: ReportCamera } = await compile("../src/components/DailyReportCamera.tsx", {
  "./Modal": moduleUrl("export default function Modal(){return null}"),
  "./ui/PageParts": moduleUrl('export const buttonPrimary="primary",buttonSecondary="secondary"'),
  "../lib/photoStamp": moduleUrl('export const captureStamp=async()=>({taken_at:"2026-10-28T02:00:00Z"})'),
})
const reportAll = node => Array.isArray(node) ? node.flatMap(reportAll) : node && typeof node === "object" ? [node, ...reportAll(node.props?.children), ...reportAll(node.props?.footer)] : []
let capturedReport = null
const reportProps = { onCapture: (file, stamp) => { capturedReport = { file, stamp } }, onClose() {} }
const renderReport = () => {
  for (let pass = 0; pass < 2; pass++) {
    cursor = 0; tree = ReportCamera(reportProps)
    for (const element of reportAll(tree)) if (element.type === "video") element.props.ref.current = video
    const queued = pending; pending = []; queued.forEach(fn => fn())
  }
}
const reportButton = label => { const node = reportAll(tree).find(node => node.type === "button" && text(node) === label); assert.ok(node); return node }
encode = callback => callback(new Blob(["original camera bytes"], { type: "image/jpeg" }))
renderReport(); await new Promise(resolve => setImmediate(resolve)); renderReport()
assert.ok(!reportAll(tree).some(node => node.type === "input"), "Daily report capture has no upload fallback")
assert.equal(cameraRequests.at(-1).video.facingMode.ideal, "environment"); assert.equal(cameraRequests.at(-1).audio, false)
assert.equal(reportButton("Capture photo").props.disabled, true)
reportAll(tree).find(node => node.type === "video").props.onLoadedData(); renderReport()
await reportButton("Capture photo").props.onClick(); await new Promise(resolve => setImmediate(resolve)); renderReport()
assert.equal(capturedReport.file.type, "image/jpeg"); assert.equal(await capturedReport.file.text(), "original camera bytes")
assert.equal(capturedReport.stamp.taken_at, "2026-10-28T02:00:00Z")
assert.equal(encoded.at(-1).width, 1600); assert.equal(encoded.at(-1).height, 900)
assert.equal(streams.at(-1).track.stops, 1)
unmount()
getMedia = async () => { throw { name: "NotAllowedError" } }
renderReport(); await new Promise(resolve => setImmediate(resolve)); renderReport()
assert.match(text(tree), /Camera permission was denied/); assert.ok(reportButton("Retry camera"))
unmount()
let resolveReportMedia
getMedia = () => new Promise(resolve => { resolveReportMedia = resolve })
renderReport(); unmount()
const reportLate = { stops: 0, stop() { this.stops++ } }
resolveReportMedia({ getTracks: () => [reportLate] }); await new Promise(resolve => setImmediate(resolve))
assert.equal(reportLate.stops, 1, "Leaving the daily report releases a late camera stream")

// Real worker form sends the camera File through the existing private upload/link workflow.
let writes = [], uploads = []
globalThis.__workerCameraDB = { from(table) {
  const chain = {
    select() { return chain }, eq() { return chain }, order() { return chain }, limit() { return chain }, ilike() { return chain },
    insert(value) { writes.push({ table, value }); return chain },
    update(value) { writes.push({ table, value }); return chain },
    single: async () => ({ data: { id: "worker-id", full_name: "Camera Worker" }, error: null }),
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) },
  }; return chain
}, storage: { from(bucket) { return { upload: async (path, file, options) => { uploads.push({ bucket, path, file, options }); return { error: null } } } } } }
globalThis.window = { setTimeout: () => 1, clearTimeout() {} }
const cameraStub = moduleUrl("export default function CameraControl(){return null}")
const { default: CameraControl } = await import(cameraStub)
const { default: WorkerManagement } = await compile("../src/components/attendance/WorkerManagement.tsx", {
  "../../lib/supabase": moduleUrl("export const supabase=globalThis.__workerCameraDB"),
  "../../lib/attendanceModel": model,
  "../../lib/workerRegistrationModel": new URL("../src/lib/workerRegistrationModel.ts", import.meta.url).href,
  "./WorkerFingerprint": moduleUrl("export default function FingerprintControl(){return null}"),
  "./WorkerCamera": cameraStub,
  "./ForemanWorkerAttendance": moduleUrl("export function WorkerDirectory(){return null};export function WorkerAttendanceDetails(){return null}"),
  "./WorkerPortrait": moduleUrl("export default function Portrait(){return null}"),
  "./BiometricAdminGuard": moduleUrl("export default function Guard({children}){return children}"),
})
const renderWorker = () => {
  cursor = 0; tree = WorkerManagement({ projectId: "project" })
  while (typeof tree.type === "function") tree = tree.type(tree.props)
  const queued = pending; pending = []; queued.forEach(fn => fn())
}
renderWorker()
assert.ok(!all(tree).some(node => node.type === "input" && node.props.type === "file"))
for (const [name, value] of Object.entries({ first_name: "Camera", last_name: "Worker", contact_number: "09123456789", worker_code: "CAM-001" })) {
  find(node => node.type === "input" && node.props.name === name).props.onChange({ target: { value } })
  renderWorker()
}
find(node => node.type === CameraControl).props.onChange(firstPhoto)
renderWorker()
assert.equal(find(node => node.type === CameraControl).props.value, firstPhoto)
find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
await new Promise(resolve => setImmediate(resolve)); renderWorker()
assert.equal(uploads.length, 1)
assert.equal(uploads[0].bucket, "worker-photos")
assert.equal(uploads[0].file, firstPhoto)
assert.match(uploads[0].path, /^project\/worker-id\/.+\.jpg$/)
assert.equal(uploads[0].options.upsert, false)
assert.ok(writes.some(write => write.value.photo_path === uploads[0].path))
assert.equal(writes[0].value.first_name, "Camera")
assert.equal(writes[0].value.last_name, "Worker")
assert.equal(writes[0].value.full_name, "Camera Worker")
assert.equal(writes[0].value.contact_number, "09123456789")
assert.equal(Object.hasOwn(writes[0].value, "biometric_uid"), false)
assert.equal(find(node => node.type === CameraControl).props.value, null, "Successful save clears the captured draft")
unmount()
if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator)
else delete globalThis.navigator
globalThis.document = originalDocument
globalThis.window = originalWindow
URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
delete globalThis.__cameraHooks; delete globalThis.__workerCameraDB
console.log("Worker camera capture/preview/retake/discard, errors, cancellation races, track/URL cleanup and private photo save integration passed")
