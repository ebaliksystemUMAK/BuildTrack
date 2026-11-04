import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { markupProblem } from "../src/lib/issueMarkup.ts"
import { stampFields } from "../src/lib/photoStamp.ts"
import { applyMarkupChanges } from "../src/lib/photoEditorModel.ts"
import { photosOutsideTasks } from "../src/lib/photoGalleryModel.ts"

// Inspection / NCR evidence photos use the client's markup editor before upload: the real lib/qa upload, EvidenceStrip,
// IssuePhotoPicker (prepare mode) and PhotoViewer overlay, each compiled with stubbed imports (no browser, no network).
const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], effects = [], pending = [], cursor = 0, tree
globalThis.__markupHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial } },
  useMemo: fn => fn(),
  useCallback(fn) { cursor++; return fn },
  useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  useId: () => "test-id",
}
const deps = globalThis.__markupDeps = {}
async function compile(file, overrides = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const replacements = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...overrides }
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (name in replacements) continue
    if (declaration.importClause.name) exports.push(`export default function ${declaration.importClause.name.text}(){return null}`)
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__markupHooks" : "__markupDeps"}.${key} ?? function ${key}(){return null}`)
    }
    replacements[name] = url(exports.join(";") + `\n// isolated dependency bindings for ${file}`)
  }
  for (const [name, replacement] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return import(url(output))
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const render = (Component, props = {}) => { cursor = 0; tree = Component(props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
const reset = () => { effects.forEach(effect => effect?.cleanup?.()); slots = []; effects = []; pending = [] }
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected a photo markup control"); return node }
const has = predicate => all(tree).some(predicate)
const button = label => find(node => node.type === "button" && text(node) === label)
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
globalThis.window = { addEventListener() {}, removeEventListener() {}, confirm: () => true }
globalThis.document = { querySelectorAll: () => [] }
const markup = [{ id: "arrow-1", kind: "arrow", x: 10, y: 10, x2: 40, y2: 35, color: "#d93a3a", stroke: 4, fontSize: 30, text: "", points: [] }]
const photoFile = (name, size = 10) => new File([new Uint8Array(size)], name, { type: "image/jpeg" })

// ---- lib/qa: prepareQaPhoto shrinks once; uploadQaPhoto stores that file and records caption + markup ----
const store = { uploads: [], removes: [], inserts: [], uploadError: null, insertError: null }
Object.assign(deps, {
  markupProblem, stampFields,
  prepareImage: async file => ({ blob: new Blob(["small"], { type: "image/webp" }), ext: "webp", width: 10, height: 5, source: file.name }),
  supabase: {
    storage: { from: bucket => ({ upload: async (path, file, options) => { store.uploads.push({ bucket, path, file, options }); return { error: store.uploadError } }, remove: async paths => { store.removes.push({ bucket, paths }); return { error: null } } }) },
    from: table => ({ insert: async row => { store.inserts.push({ table, row }); return { error: store.insertError } } }),
  },
})
const qa = await compile("../src/lib/qa.ts", { "./qaModel": url("export {}") })
const prepared = await qa.prepareQaPhoto(photoFile("IMG_0042.JPG", 5000))
assert.equal(prepared.name, "IMG_0042.webp"); assert.equal(prepared.type, "image/webp")
const stamp = { taken_at: "2026-10-21T02:00:00.000Z", lat: 14.6, lng: 121, accuracy_m: 8 }
await qa.uploadQaPhoto("P", { itemId: "I" }, { file: prepared, caption: "  Joint gap  ", annotations: markup }, stamp)
assert.equal(store.uploads[0].bucket, "qa-evidence"); assert.match(store.uploads[0].path, /^P\/item-I\/\d+-[a-f0-9]{8}\.webp$/)
assert.equal(store.uploads[0].file, prepared, "the prepared file is stored as is, not shrunk again")
assert.deepEqual(store.inserts[0].row.annotations, markup); assert.equal(store.inserts[0].row.caption, "Joint gap"); assert.equal(store.inserts[0].row.taken_at, stamp.taken_at)
await qa.uploadQaPhoto("P", { defectId: "D" }, { file: prepared })
assert.ok(!("annotations" in store.inserts[1].row), "a photo without markup sends no annotations column"); assert.equal(store.inserts[1].row.caption, null)
assert.match(store.uploads[1].path, /^P\/ncr-D\//)
await assert.rejects(qa.uploadQaPhoto("P", { itemId: "I" }, { file: prepared, annotations: [{ kind: "script" }] }), /Invalid annotation/)
assert.equal(store.uploads.length, 2, "invalid markup is refused before anything is stored")
store.insertError = { message: "Photos can only be added while the inspection is requested (Foremen) or in progress" }
await assert.rejects(qa.uploadQaPhoto("P", { itemId: "I" }, { file: prepared, annotations: markup }), /in progress/)
assert.deepEqual(store.removes.at(-1).paths, [store.uploads.at(-1).path], "a refused record removes its stored file again")
store.insertError = null
await qa.uploadQaPhoto("P", { itemId: "I" }, { file: prepared, caption: "x".repeat(260) })
assert.equal(store.inserts.at(-1).row.caption.length, qa.QA_CAPTION_LIMIT)

// ---- EvidenceStrip: chosen photos open the markup dialog; failures stay to retry; Cancel asks only after work ----
const calls = { prepare: [], upload: [], toasts: [], confirms: [], changed: 0 }
let uploadImpl = async () => {}, confirmAnswer = true
// Super Admin switch photos.allow_device_upload (lib/photoPolicy): uploads allowed unless a test turns them off.
const uploadsAllowed = { allowUpload: true, cameraOnly: false, qaCameraOnly: false, problem: () => "" }
let photoPolicy = uploadsAllowed, authRole = "engineer"
// qa = the role-aware QA rule from the hook (an Engineer without a choice of their own keeps uploads for inspection photos)
const cameraOnlyPolicy = (problem = "", qa = true) => ({ allowUpload: false, cameraOnly: true, qaCameraOnly: qa, problem: () => problem })
Object.assign(deps, {
  usePhotoPolicy: () => photoPolicy,
  useProjectTeam: () => ({ team: [] }), useAuth: () => ({ profile: { role: authRole } }), useSignedUrl: () => ({ url: "blob:photo", failed: false }),
  useToast: () => ({ success: (...args) => calls.toasts.push(["success", ...args]), error: (...args) => calls.toasts.push(["error", ...args]) }),
  useConfirm: () => async options => { calls.confirms.push(options); return confirmAnswer },
  errorText: error => error.message, captureStamp: async () => stamp, stampSummary: () => "", photoPreviewBlocked: () => false,
  QA_CAPTION_LIMIT: 200,
  prepareQaPhoto: async file => { calls.prepare.push(file.name); return new File(["small"], file.name.replace(/\.\w+$/, ".webp"), { type: "image/webp" }) },
  uploadQaPhoto: (...args) => { calls.upload.push(args); return uploadImpl(...args) },
})
const { EvidenceStrip } = await compile("../src/components/qa/QaBits.tsx")
const stripProps = { projectId: "P", photos: [], target: { itemId: "I" }, canAdd: true, onChanged: () => { calls.changed++ }, label: "Item 1", compact: true }
reset(); render(EvidenceStrip, stripProps)
const fileInput = () => find(node => node.type === "input" && node.props.type === "file")
fileInput().props.ref.current = { value: "C:\\fakepath\\a.jpg", click() {} }
fileInput().props.onChange({ target: { files: [photoFile("a.jpg"), photoFile("b.jpg")] } })
await settle(); render(EvidenceStrip, stripProps)
assert.deepEqual(calls.prepare, ["a.jpg", "b.jpg"], "each chosen photo is shrunk before markup")
const dialog = () => find(node => node.type?.name === "Modal")
assert.equal(dialog().props.title, "Add photos: Item 1")
let picker = find(node => node.type?.name === "IssuePhotoPicker")
assert.equal(picker.props.photos.length, 2); assert.equal(picker.props.photos[0].caption, "", "QA captions start empty, not as file names")
assert.equal(picker.props.limit, 6); assert.equal(picker.props.captionLimit, 200); assert.equal(picker.props.nameCaptions, false)
assert.equal(picker.props.prepare, deps.prepareQaPhoto, "photos added inside the dialog are shrunk the same way")
assert.equal(picker.props.editorTitle, "Mark up evidence photo")
picker.props.onChange([{ ...picker.props.photos[0], annotations: markup, caption: "Joint gap" }, picker.props.photos[1]])
render(EvidenceStrip, stripProps)
uploadImpl = async (_project, _target, draft) => { if (draft.caption !== "Joint gap") throw new Error("Network lost") }
button("Add 2 photos").props.onClick()
await settle(); render(EvidenceStrip, stripProps)
assert.equal(calls.upload.length, 2)
assert.deepEqual(calls.upload[0].slice(0, 2), ["P", { itemId: "I" }]); assert.deepEqual(calls.upload[0][2].annotations, markup); assert.equal(calls.upload[0][3], stamp, "the stamp from when the photos were chosen is used"); assert.equal(calls.upload[0][4], "upload", "chosen files are recorded as uploads")
assert.deepEqual(calls.toasts.at(-1), ["success", "Photo added"]); assert.equal(calls.changed, 1)
picker = find(node => node.type?.name === "IssuePhotoPicker")
assert.equal(picker.props.photos.length, 1, "only the failed photo stays in the dialog")
assert.match(text(find(node => node.props?.role === "alert")), /A photo was not added: Network lost\. Try again, or remove it\./)
uploadImpl = async () => {}
button("Add photo").props.onClick()
await settle(); render(EvidenceStrip, stripProps)
assert.ok(!has(node => node.type?.name === "Modal"), "the dialog closes once every photo is added"); assert.equal(calls.changed, 2)

fileInput().props.onChange({ target: { files: Array.from({ length: 8 }, (_, i) => photoFile(`p${i}.jpg`)) } })
await settle(); render(EvidenceStrip, stripProps)
assert.equal(find(node => node.type?.name === "IssuePhotoPicker").props.photos.length, 6)
assert.match(text(find(node => node.props?.role === "alert")), /Only the first 6 photos/)
button("Cancel").props.onClick(); await settle(); render(EvidenceStrip, stripProps)
assert.equal(calls.confirms.length, 0, "nothing marked up: Cancel needs no confirmation"); assert.ok(!has(node => node.type?.name === "Modal"))

fileInput().props.onChange({ target: { files: [photoFile("c.jpg")] } })
await settle(); render(EvidenceStrip, stripProps)
picker = find(node => node.type?.name === "IssuePhotoPicker")
picker.props.onChange([{ ...picker.props.photos[0], annotations: markup }]); render(EvidenceStrip, stripProps)
confirmAnswer = false
button("Cancel").props.onClick(); await settle(); render(EvidenceStrip, stripProps)
assert.equal(calls.confirms.length, 1); assert.ok(has(node => node.type?.name === "Modal"), "keeping the markup leaves the dialog open")
confirmAnswer = true
button("Cancel").props.onClick(); await settle(); render(EvidenceStrip, stripProps)
assert.ok(!has(node => node.type?.name === "Modal"))
assert.equal(calls.upload.length, 3, "cancelled photos are never uploaded")

// Uploads turned off: a Foreman gets only the in-app camera; a photo away from the site never reaches the dialog. Engineers keep files.
photoPolicy = cameraOnlyPolicy("", false)
render(EvidenceStrip, stripProps)
assert.ok(has(node => node.type === "input" && node.props.type === "file"), "the Engineer's own inspection photos are not affected")
authRole = "foreman"; photoPolicy = cameraOnlyPolicy()
const ForemanStrip = EvidenceStrip
const takeQaPhoto = () => find(node => node.type === "button" && node.props["aria-label"] === "Take a photo: Item 1")
reset(); render(ForemanStrip, stripProps)
assert.ok(!has(node => node.type === "input" && node.props.type === "file"), "no file picker for the Foreman")
photoPolicy = cameraOnlyPolicy("This photo was taken 2.6 km from the project site. Photos must be taken at the site.")
takeQaPhoto().props.onClick(); render(ForemanStrip, stripProps)
find(node => node.type?.name === "CameraCapture").props.onCapture(photoFile("shot.jpg"), stamp); await settle(); render(ForemanStrip, stripProps)
assert.ok(!has(node => node.type?.name === "Modal")); assert.deepEqual(calls.toasts.at(-1), ["error", "Photo not accepted", "This photo was taken 2.6 km from the project site. Photos must be taken at the site."])
photoPolicy = cameraOnlyPolicy()
takeQaPhoto().props.onClick(); render(ForemanStrip, stripProps)
find(node => node.type?.name === "CameraCapture").props.onCapture(photoFile("shot.jpg"), stamp); await settle(); render(ForemanStrip, stripProps)
assert.equal(find(node => node.type?.name === "IssuePhotoPicker").props.allowFiles, false, "no files can be added to a camera photo")
button("Add photo").props.onClick(); await settle(); render(ForemanStrip, stripProps)
assert.equal(calls.upload.at(-1)[4], "camera"); assert.equal(calls.upload.at(-1)[3], stamp, "the shutter stamp is used")
authRole = "engineer"; photoPolicy = uploadsAllowed

// The saved thumbnail draws the markup cropped exactly like the photo (object-cover = slice), with a badge.
render(EvidenceStrip, { ...stripProps, photos: [{ id: "q1", path: "P/item-I/1.webp", caption: null, annotations: markup }, { id: "q2", path: "P/item-I/2.webp", caption: null }] })
const thumbs = all(tree).filter(node => node.type?.name === "Thumb")
reset(); render(thumbs[0].type, thumbs[0].props)
find(node => node.type === "img").props.onLoad({ currentTarget: { naturalWidth: 2000, naturalHeight: 1500 } }); render(thumbs[0].type, thumbs[0].props)
const overlay = find(node => node.type === "svg" && node.props.preserveAspectRatio)
assert.equal(overlay.props.preserveAspectRatio, "xMidYMid slice"); assert.equal(overlay.props.viewBox, "0 0 1000 750")
assert.deepEqual(find(node => node.type?.name === "MarkupLayer").props.items, markup); assert.ok(has(node => node.props?.title === "Marked up"))
reset(); render(thumbs[1].type, thumbs[1].props)
assert.equal(tree.type, "img", "a photo without markup is a plain thumbnail")

// ---- IssuePhotoPicker prepare mode: shrinks each file, locks while busy, empty captions, QA caption limit in the editor ----
deps.applyMarkupChanges = applyMarkupChanges
const Picker = (await compile("../src/components/issues/IssuePhotoPicker.tsx", { "../../lib/issueMarkup": new URL("../src/lib/issueMarkup.ts", import.meta.url).href })).default
let drafts = [], busyStates = []
const shrink = async file => new File(["s"], file.name + ".webp", { type: "image/webp" })
const pickerProps = () => ({ photos: drafts, onChange: next => { drafts = next }, limit: 6, prepare: shrink, onPreparing: busy => busyStates.push(busy), captionLimit: 200, nameCaptions: false, editorTitle: "Mark up evidence photo" })
reset(); render(Picker, pickerProps())
const pick = (files) => { const target = { files, value: "x" }; find(node => node.type === "input").props.onChange({ currentTarget: target }); return target }
const target = pick([photoFile("big.jpg", 9 * 1024 * 1024)])
assert.equal(target.value, "", "the file input is cleared at once")
render(Picker, pickerProps()); assert.match(text(tree), /Preparing photos/)
await settle()
assert.deepEqual(busyStates, [true, false]); assert.equal(drafts.length, 1, "prepare mode has no 8 MB limit: the shrunk file is kept")
assert.equal(drafts[0].file.name, "big.jpg.webp"); assert.equal(drafts[0].caption, "")
render(Picker, pickerProps()); assert.match(text(tree), /No caption yet/)
pick([photoFile("second.jpg")]); await settle(); render(Picker, pickerProps())
assert.equal(drafts.length, 2)
all(tree).filter(node => node.type === "button" && text(node) === "Edit / annotate")[1].props.onClick(); render(Picker, pickerProps())
let editor = find(node => node.type?.name === "IssuePhotoEditor")
assert.equal(editor.props.start, 1, "Edit / annotate opens the slideshow on that photo"); assert.deepEqual(editor.props.photos.map(photo => photo.src), drafts.map(draft => draft.url))
assert.equal(editor.props.title, "Mark up evidence photo"); assert.equal(editor.props.captionLimit, 200)
editor.props.onClose(); render(Picker, pickerProps())
button("Mark up photos (2)").props.onClick(); render(Picker, pickerProps())
editor = find(node => node.type?.name === "IssuePhotoEditor"); assert.equal(editor.props.start, 0)
const untouched = drafts[1]
editor.props.onSave([{ id: drafts[0].id, annotations: markup, caption: "Joint gap" }]); render(Picker, pickerProps())
assert.deepEqual(drafts[0].annotations, markup); assert.equal(drafts[1], untouched, "photos that did not change stay as they were"); assert.match(text(tree), /Joint gap · 1 mark/)
calls.confirms.length = 0; confirmAnswer = false
all(tree).filter(node => node.type === "button" && text(node) === "Remove")[0].props.onClick(); await settle()
assert.equal(calls.confirms.length, 1, "removing a marked-up photo asks first"); assert.equal(drafts.length, 2, "keeping it leaves the photo and its markup")
confirmAnswer = true
all(tree).filter(node => node.type === "button" && text(node) === "Remove")[1].props.onClick(); await settle()
assert.equal(calls.confirms.length, 1, "an untouched photo is removed without asking"); assert.equal(drafts.length, 1); assert.equal(drafts[0].caption, "Joint gap")
render(Picker, pickerProps())
// Without prepare (client reports, site issues) nothing changes: file names as captions and the 8 MB limit.
drafts = []; reset(); render(Picker, { photos: drafts, onChange: next => { drafts = next } })
pick([photoFile("crack.jpg")]); await settle()
assert.equal(drafts[0].caption, "crack.jpg"); assert.equal(drafts[0].file.name, "crack.jpg")
render(Picker, { photos: drafts, onChange: next => { drafts = next } })
pick([photoFile("huge.jpg", 9 * 1024 * 1024)]); await settle(); render(Picker, { photos: drafts, onChange: next => { drafts = next } })
assert.equal(drafts.length, 1); assert.match(text(find(node => node.props?.role === "alert")), /8 MB/)

// ---- PhotoViewer: saved markup over the original, with View original / Show markup ----
Object.assign(deps, { adjustPhotoZoom: (value, step) => value + step, buttonSecondary: "secondary" })
const Viewer = (await compile("../src/components/PhotoViewer.tsx")).default
const viewerProps = { photo: { id: "q1", path: "P/item-I/1.webp", caption: "Joint gap", label: "Item 1", created_at: "2026-10-21", annotations: markup }, bucket: "qa-evidence", onClose() {} }
reset(); render(Viewer, viewerProps)
assert.ok(!has(node => node.type?.name === "MarkupLayer"), "the overlay waits for the photo's real size")
find(node => node.type === "img").props.onLoad({ currentTarget: { naturalWidth: 1000, naturalHeight: 1250 } }); render(Viewer, viewerProps)
const drawn = find(node => node.type === "svg" && node.props.preserveAspectRatio)
assert.equal(drawn.props.preserveAspectRatio, "xMidYMid meet"); assert.equal(drawn.props.viewBox, "0 0 1000 1250")
assert.deepEqual(find(node => node.type?.name === "MarkupLayer").props.items, markup)
button("View original").props.onClick(); render(Viewer, viewerProps)
assert.ok(!has(node => node.type?.name === "MarkupLayer")); assert.equal(button("Show markup").props["aria-pressed"], true)
reset(); render(Viewer, { ...viewerProps, photo: { ...viewerProps.photo, annotations: [] } })
assert.ok(!has(node => node.type === "button" && /View original|Show markup/.test(text(node))), "photos without markup get no toggle")
assert.equal(find(node => node.type === "img").props.onLoad, undefined)

// ---- Work item / correction photos (Foreman Corrections, work item checklist): the markup dialog before upload ----
const Dialog = (await compile("../src/components/issues/MarkupUploadDialog.tsx")).default
let dialogUploads = [], dialogDone = [], dialogClosed = 0, failName = "b.jpg"
const toJpeg = async file => { if (!file.type.startsWith("image/")) throw new Error("not an image"); return new File(["jpg"], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) }
const dialogProps = {
  files: [photoFile("a.png"), photoFile("b.png"), new File(["notes"], "notes.txt", { type: "text/plain" })], title: "Add photos: FLOOR correction", prepare: toJpeg,
  onUpload: async draft => { dialogUploads.push(draft); if (draft.file.name === failName) throw new Error("Network lost"); return draft.file.name === "a.jpg" ? "uploaded" : "queued" },
  onDone: result => { dialogDone.push(result) }, onClose: () => { dialogClosed++ },
}
reset(); render(Dialog, dialogProps)
assert.match(text(tree), /Preparing the photos/, "the chosen photos are shrunk first")
await settle(); render(Dialog, dialogProps)
let workPicker = find(node => node.type?.name === "IssuePhotoPicker")
assert.deepEqual(workPicker.props.photos.map(photo => photo.file.name), ["a.jpg", "b.jpg"]); assert.equal(workPicker.props.photos[0].caption, "")
assert.equal(workPicker.props.prepare, toJpeg, "photos added inside the dialog are shrunk the same way"); assert.equal(workPicker.props.captionLimit, 200)
assert.match(text(find(node => node.props?.role === "alert")), /notes\.txt: not an image/)
workPicker.props.onChange([{ ...workPicker.props.photos[0], annotations: markup, caption: "Joint fixed" }, workPicker.props.photos[1]]); render(Dialog, dialogProps)
button("Add 2 photos").props.onClick(); await settle(); render(Dialog, dialogProps)
assert.deepEqual(dialogUploads[0].annotations, markup); assert.deepEqual(dialogDone, [{ uploaded: 1, queued: 0 }]); assert.equal(dialogClosed, 0)
assert.deepEqual(find(node => node.type?.name === "IssuePhotoPicker").props.photos.map(photo => photo.file.name), ["b.jpg"], "only the failed photo stays")
assert.match(text(find(node => node.props?.role === "alert")), /A photo was not added: Network lost\./)
failName = null
button("Add photo").props.onClick(); await settle()
assert.deepEqual(dialogDone[1], { uploaded: 0, queued: 1 }, "a photo kept on the device for later counts as done"); assert.equal(dialogClosed, 1)
calls.confirms.length = 0; confirmAnswer = false
reset(); render(Dialog, { ...dialogProps, files: [photoFile("c.png")] }); await settle(); render(Dialog, { ...dialogProps, files: [photoFile("c.png")] })
workPicker = find(node => node.type?.name === "IssuePhotoPicker")
workPicker.props.onChange([{ ...workPicker.props.photos[0], annotations: markup }]); render(Dialog, { ...dialogProps, files: [photoFile("c.png")] })
button("Cancel").props.onClick(); await settle()
assert.equal(calls.confirms.length, 1); assert.equal(dialogClosed, 1, "keeping the markup leaves the dialog open")
confirmAnswer = true

// The Corrections / work item upload button: chosen photos open the dialog; each photo goes up with its caption and markup,
// or waits on the device (offline queue) with them.
const queued = [], pinInserts = [], pinStorage = []
let pinInsertError = null
Object.assign(deps, {
  compressPhoto: async () => new Blob(["small"], { type: "image/jpeg" }), enqueue: async input => { queued.push(input) }, isNetworkProblem: () => false,
  dbMessage: error => error.message, formatStamp: () => "", useSignedUrl: () => ({ url: null, failed: false }), lazy: () => null,
  useToast: () => ({ success: (...args) => calls.toasts.push(["success", ...args]), error: (...args) => calls.toasts.push(["error", ...args]), info: (...args) => calls.toasts.push(["info", ...args]) }),
})
deps.supabase.storage = { from: bucket => ({ upload: async path => { pinStorage.push(["upload", bucket, path]); return { error: null } }, remove: async paths => { pinStorage.push(["remove", bucket, paths]); return { error: null } } }) }
deps.supabase.from = table => ({ insert: async row => { pinInserts.push({ table, row }); return { error: pinInsertError } } })
const Parts = await compile("../src/components/editor/PinParts.tsx", { "../../lib/issueMarkup": new URL("../src/lib/issueMarkup.ts", import.meta.url).href })
const shrunk = await Parts.preparePinPhoto(photoFile("IMG_7.HEIC.png"))
assert.equal(shrunk.type, "image/jpeg"); assert.equal(shrunk.name, "IMG_7.HEIC.jpg")
await assert.rejects(Parts.preparePinPhoto(new File(["x"], "plan.pdf", { type: "application/pdf" })), /not an image/)
let added = 0
const pinWork = { id: "W", project_id: "P", title: "LAUNDRY" }
const buttonProps = { pin: pinWork, itemId: "I", label: "FLOOR correction", attemptId: "A", onAdded: () => { added++ } }
reset(); render(Parts.ChecklistUploadButton, buttonProps)
const inputs = () => all(tree).filter(node => node.type === "input")
assert.equal(inputs().length, 1, "Take photo opens the in-app camera, not a second file input")
const picked = { files: [photoFile("a.jpg"), photoFile("b.jpg")], value: "x" }
inputs()[0].props.onChange({ target: picked }); render(Parts.ChecklistUploadButton, buttonProps)
assert.equal(picked.value, "", "the file input is cleared")
const workDialog = find(node => node.type?.name === "MarkupUploadDialog")
assert.equal(workDialog.props.title, "Add photos: FLOOR correction"); assert.equal(workDialog.props.files.length, 2); assert.equal(workDialog.props.prepare, Parts.preparePinPhoto)
assert.ok(all(tree).filter(node => node.type === "button").every(node => node.props.disabled), "no second batch while one is being marked up")
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true })
const draft = { id: "d1", file: new File(["jpg"], "a.jpg", { type: "image/jpeg" }), url: "blob:a", caption: "  Joint fixed  ", annotations: markup }
assert.equal(await workDialog.props.onUpload(draft), "uploaded")
assert.equal(pinInserts[0].table, "pin_photos"); assert.equal(pinInserts[0].row.checklist_item_id, "I"); assert.equal(pinInserts[0].row.qa_attempt_id, "A", "correction photos stay linked to their correction")
assert.equal(pinInserts[0].row.caption, "Joint fixed"); assert.deepEqual(pinInserts[0].row.annotations, markup); assert.equal(pinInserts[0].row.taken_at, stamp.taken_at); assert.equal(pinInserts[0].row.capture_source, "upload")
assert.match(pinStorage[0][2], /^P\/W\/[0-9a-f-]+\.jpg$/)
await workDialog.props.onUpload({ ...draft, caption: "", annotations: [] })
assert.ok(!("annotations" in pinInserts[1].row) && !("caption" in pinInserts[1].row), "a plain photo sends neither")
await assert.rejects(workDialog.props.onUpload({ ...draft, annotations: [{ kind: "script" }] }), /Invalid annotation/)
pinInsertError = { message: "Awaiting Engineer inspection or verified: checklist and evidence are locked" }
await assert.rejects(workDialog.props.onUpload(draft), /evidence are locked/); assert.equal(pinStorage.at(-1)[0], "remove", "a refused record removes its file again")
pinInsertError = null
globalThis.navigator.onLine = false
assert.equal(await workDialog.props.onUpload(draft), "queued")
assert.equal(queued[0].kind, "pin_photo"); assert.deepEqual(queued[0].payload.annotations, markup); assert.equal(queued[0].payload.caption, "Joint fixed"); assert.equal(queued[0].payload.blob, draft.file); assert.equal(queued[0].payload.attemptId, "A"); assert.equal(queued[0].payload.source, "upload")
await workDialog.props.onDone({ uploaded: 1, queued: 1 })
assert.equal(added, 1); assert.ok(calls.toasts.some(toast => toast[1] === "1 photo added")); assert.ok(calls.toasts.some(toast => toast[1] === "1 photo saved on this device"))
workDialog.props.onClose(); render(Parts.ChecklistUploadButton, buttonProps)
assert.ok(!has(node => node.type?.name === "MarkupUploadDialog"))

// Uploads turned off: only Take photo (in-app camera); the camera photo goes up as a camera photo with its shutter stamp.
photoPolicy = cameraOnlyPolicy("Turn on location: photos must be taken at the project site, and this photo has no position.")
reset(); render(Parts.ChecklistUploadButton, buttonProps)
assert.equal(inputs().length, 0); assert.ok(!has(node => node.type === "button" && text(node) === "Upload photos"))
button("Take photo").props.onClick(); render(Parts.ChecklistUploadButton, buttonProps)
find(node => node.type?.name === "CameraCapture").props.onCapture(photoFile("cam.jpg"), stamp); render(Parts.ChecklistUploadButton, buttonProps)
assert.ok(!has(node => node.type?.name === "MarkupUploadDialog")); assert.match(calls.toasts.at(-1)[2], /Turn on location/)
photoPolicy = cameraOnlyPolicy()
button("Take photo").props.onClick(); render(Parts.ChecklistUploadButton, buttonProps)
find(node => node.type?.name === "CameraCapture").props.onCapture(photoFile("cam.jpg"), stamp); render(Parts.ChecklistUploadButton, buttonProps)
const cameraDialog = find(node => node.type?.name === "MarkupUploadDialog")
assert.equal(cameraDialog.props.files.length, 1); assert.equal(cameraDialog.props.allowFiles, false)
globalThis.navigator.onLine = true
assert.equal(await cameraDialog.props.onUpload({ ...draft, caption: "", annotations: [] }), "uploaded")
assert.equal(pinInserts.at(-1).row.capture_source, "camera"); assert.equal(pinInserts.at(-1).row.taken_at, stamp.taken_at)
cameraDialog.props.onClose(); photoPolicy = uploadsAllowed; globalThis.navigator.onLine = false

// The offline queue later sends the photo with its caption and markup; old queued photos (no markup) still send.
const queueInserts = []
Object.assign(deps, { sendOrder: rows => rows, summarizeQueue: () => ({}), verdictFor: () => "retry", backoffSeconds: () => 1, MAX_ATTEMPTS: 5, kindLabel: {} })
deps.supabase.from = table => ({ insert: async row => { queueInserts.push({ table, row }); return { error: null } } })
const Queue = await compile("../src/lib/offlineQueue.ts")
assert.equal(await Queue.sendQueuedItem({ kind: "pin_photo", payload: { ...queued[0].payload } }), null)
assert.deepEqual(queueInserts[0].row.annotations, markup); assert.equal(queueInserts[0].row.caption, "Joint fixed"); assert.equal(queueInserts[0].row.qa_attempt_id, "A"); assert.equal(queueInserts[0].row.capture_source, "upload")
await Queue.sendQueuedItem({ kind: "pin_photo", payload: { projectId: "P", pinId: "W", itemId: "I", attemptId: null, path: "P/W/old.jpg", blob: new Blob(["x"]), stamp } })
assert.ok(!("annotations" in queueInserts[1].row) && !("caption" in queueInserts[1].row) && !("capture_source" in queueInserts[1].row), "photos queued before markup existed send as before")

// Daily progress evidence: captured original + overlay, camera-only picker, retry uses the same record/path.
let dailyLookups = [{ data: null, error: null }], dailyRows = [], dailyUploads = [], dailyFailure = null
deps.supabase.from = () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => dailyLookups.shift() ?? { data: null, error: null },
    insert: async row => { dailyRows.push(row); return { error: dailyFailure } } }
  return chain
}
deps.supabase.storage = { from: bucket => ({ upload: async (path, file) => { dailyUploads.push({ bucket, path, file }); return { error: null } }, remove: async () => ({ error: null }) }) }
const { saveDailyReportCapture } = await compile("../src/lib/dailyReportCapture.ts", { "./issueMarkup": new URL("../src/lib/issueMarkup.ts", import.meta.url).href })
const dailyCapture = { id: "capture-1", file: photoFile("camera.jpg"), url: "blob:camera", caption: "  Slab progress  ", annotations: markup, stamp, source: "camera" }
await saveDailyReportCapture("P", "R", dailyCapture)
assert.equal(dailyUploads[0].file, dailyCapture.file, "Store the camera original without baking markup into its pixels")
assert.equal(dailyRows[0].capture_source, "camera"); assert.equal(dailyRows[0].taken_at, stamp.taken_at)
assert.deepEqual(dailyRows[0].annotations, markup); assert.equal(dailyRows[0].caption, "Slab progress")
dailyLookups = [{ data: { id: "saved" }, error: null }]
await saveDailyReportCapture("P", "R", dailyCapture)
assert.equal(dailyUploads.length, 1, "Retry recognizes an already committed capture")
dailyFailure = { message: "Connection lost after commit" }
dailyLookups = [{ data: null, error: null }, { data: { id: "saved" }, error: null }]
await saveDailyReportCapture("P", "R", dailyCapture)
assert.equal(dailyUploads.at(-1).path, dailyUploads[0].path)
dailyFailure = null; dailyLookups = [{ data: null, error: null }]
await saveDailyReportCapture("P", "R", { ...dailyCapture, id: "capture-2", source: "upload" })
assert.equal(dailyRows.at(-1).capture_source, "upload", "a photo chosen from the device is recorded as an upload")

let savedCaptures = [], parentBusy = [], photoReloads = 0, failingCapture = null
globalThis.navigator.onLine = true
Object.assign(deps, {
  photosOutsideTasks,
  useEvidencePhotos: () => ({ photos: [], loading: false, error: "", reload: async () => { photoReloads++ } }),
  saveDailyReportCapture: async (...args) => { if (args[2].id === failingCapture) throw new Error("Upload failed"); savedCaptures.push(args) },
})
const ReportPhotos = (await compile("../src/components/DailyReportPhotos.tsx")).default
const DailyPhotos = props => ReportPhotos({ ...props, evidence: deps.useEvidencePhotos() })
const dailyProps = { projectId: "P", entryId: "e0", editable: true, ensureDraft: async () => "R", onBusy: value => parentBusy.push(value) }
photoPolicy = cameraOnlyPolicy("This photo was taken 2.6 km from the project site. Photos must be taken at the site.")
reset(); render(DailyPhotos, dailyProps)
assert.ok(!all(tree).some(node => node.type === "input" && node.props.type === "file"))
assert.doesNotMatch(text(tree), /Choose photos|Add photos|Upload photo/); assert.match(text(tree), /Photo uploads are turned off/)
button("Take photo").props.onClick(); render(DailyPhotos, dailyProps)
find(node => node.type?.name === "CameraCapture").props.onCapture(dailyCapture.file, stamp); render(DailyPhotos, dailyProps)
assert.ok(!has(node => node.type?.name === "IssuePhotoEditor"), "a photo away from the site is not kept")
assert.match(text(find(node => node.props?.role === "alert")), /Photo not accepted: This photo was taken 2\.6 km/)
photoPolicy = cameraOnlyPolicy()
button("Take photo").props.onClick(); render(DailyPhotos, dailyProps)
find(node => node.type?.name === "CameraCapture").props.onCapture(dailyCapture.file, stamp); render(DailyPhotos, dailyProps)
let reportEditor = find(node => node.type?.name === "IssuePhotoEditor")
assert.equal(reportEditor.props.title, "Annotate daily progress photo")
const capturedId = reportEditor.props.photos[0].id
reportEditor.props.onSave([{ id: capturedId, caption: "Slab progress", annotations: markup }]); reportEditor.props.onClose(); render(DailyPhotos, dailyProps)
assert.ok(parentBusy.at(-1), "Unsaved capture prevents report submission/date switching")
button("Save photo to task").props.onClick(); button("Save photo to task").props.onClick(); await settle(); render(DailyPhotos, dailyProps)
assert.equal(savedCaptures.length, 1); assert.equal(savedCaptures[0][0], "P"); assert.equal(savedCaptures[0][1], "R")
assert.deepEqual(savedCaptures[0][2].annotations, markup); assert.equal(savedCaptures[0][2].file, dailyCapture.file)
assert.equal(savedCaptures[0][2].stamp.taken_at, stamp.taken_at, "Annotation time never replaces the shutter timestamp"); assert.equal(savedCaptures[0][2].source, "camera")
assert.equal(parentBusy.at(-1), false); assert.equal(photoReloads, 1)
photoPolicy = uploadsAllowed
reset(); render(DailyPhotos, dailyProps)
assert.match(text(tree), /or upload several from this device/)
assert.equal(find(node => node.type === "input" && node.props.type === "file").props.multiple, true, "Several photos can be chosen at once")
const chosenFile = { files: [photoFile("gallery.jpg")], value: "x" }
find(node => node.type === "input" && node.props.type === "file").props.onChange({ target: chosenFile }); await settle(); render(DailyPhotos, dailyProps)
assert.equal(chosenFile.value, "")
reportEditor = find(node => node.type?.name === "IssuePhotoEditor"); reportEditor.props.onClose(); render(DailyPhotos, dailyProps)
assert.match(text(tree), /1 unsaved photo\./); assert.equal(find(node => node.type?.name === "PendingPhoto").props.capture.source, "upload")
button("Save photo to task").props.onClick(); await settle(); render(DailyPhotos, dailyProps)
assert.equal(savedCaptures.at(-1)[2].source, "upload"); assert.equal(savedCaptures.at(-1)[2].file.type, "image/jpeg", "device photos are converted to JPEG first")
reset(); render(DailyPhotos, { ...dailyProps, editable: false })
assert.ok(!all(tree).some(node => node.type === "button" && text(node) === "Take photo"), "Submitted/history viewers have no capture controls")

// A photo of a task entry: the entry is saved first (even on an existing report), the photo points at it, and each section shows its own photos.
let drafted = []
const entryProps = { ...dailyProps, entryId: "e1", ensureDraft: async () => { drafted.push("saved"); return "R" } }
photoPolicy = cameraOnlyPolicy()
reset(); render(DailyPhotos, entryProps)
button("Take photo").props.onClick(); render(DailyPhotos, entryProps)
find(node => node.type?.name === "CameraCapture").props.onCapture(dailyCapture.file, stamp); render(DailyPhotos, entryProps)
find(node => node.type?.name === "IssuePhotoEditor").props.onClose(); render(DailyPhotos, entryProps)
button("Save photo to task").props.onClick(); await settle(); render(DailyPhotos, entryProps)
assert.deepEqual(drafted, ["saved"]); assert.equal(savedCaptures.at(-1)[3], "e1", "The photo is attached to the task entry")
deps.useEvidencePhotos = () => ({ photos: [{ id: "task", entry_id: "e1" }, { id: "other", entry_id: "e2" }, { id: "report", entry_id: null }, { id: "moved", entry_id: "removed" }], loading: false, error: "", reload: async () => {} })
const grid = () => find(node => node.type?.name === "PhotoGrid").props.photos.map(photo => photo.id)
reset(); render(DailyPhotos, { ...entryProps, editable: false }); assert.deepEqual(grid(), ["task"], "A task entry shows only its photos")
const reportProps = { projectId: "P", editable: true, taskIds: ["e1", "e2"] }
reset(); render(DailyPhotos, { ...reportProps, editable: false }); assert.deepEqual(grid(), ["report", "moved"], "The report's section shows the rest, including a photo of an entry removed from the form")
assert.match(text(tree), /Other photos on this report/)
reset(); render(DailyPhotos, reportProps)
assert.ok(!has(node => node.type === "button" && /Take photo|Upload photo/.test(text(node))), "New photos are only added under a task")
assert.equal(typeof find(node => node.type?.name === "PhotoGrid").props.onRemove, "function", "A photo outside the tasks can still be removed from a draft")
assert.match(text(tree), /Add new photos under each task/)
reset(); render(DailyPhotos, { projectId: "P", editable: false }); assert.equal(grid().length, 4, "A report without entries shows every photo"); assert.match(text(tree), /Daily progress photos/)
deps.useEvidencePhotos = () => ({ photos: [], loading: false, error: "", reload: async () => {} })
reset(); render(DailyPhotos, { ...entryProps, editable: false })
assert.ok(!has(node => node.type?.name === "PhotoGrid"), "An empty task has a short note, not the large empty box"); assert.match(text(tree), /No photos for this task yet/)
reset(); render(DailyPhotos, entryProps); assert.ok(has(node => node.type === "button" && text(node) === "Take photo"), "A task offers its own photo buttons"); assert.match(text(tree), /save them to this task/)

// Many photos on one task: all can be chosen at once, each annotated in the same editor, and all saved to that task.
photoPolicy = uploadsAllowed
savedCaptures = []
const pendingCards = () => all(tree).filter(node => node.type?.name === "PendingPhoto")
const upload = async (names, props = entryProps) => { find(node => node.type === "input" && node.props.type === "file").props.onChange({ target: { files: names.map(name => photoFile(name)), value: "x" } }); await settle(); render(DailyPhotos, props) }
reset(); render(DailyPhotos, entryProps)
await upload(["one.jpg", "two.jpg", "three.jpg"])
let manyEditor = find(node => node.type?.name === "IssuePhotoEditor")
assert.equal(manyEditor.props.photos.length, 3, "The editor moves between all the new photos"); assert.equal(manyEditor.props.start, 0)
manyEditor.props.onSave([{ id: manyEditor.props.photos[1].id, caption: "Second", annotations: markup }]); manyEditor.props.onClose(); render(DailyPhotos, entryProps)
assert.equal(pendingCards().length, 3); assert.deepEqual(pendingCards().map(card => card.props.capture.annotations.length), [0, markup.length, 0], "Each photo keeps its own annotations")
assert.equal(pendingCards()[1].props.capture.caption, "Second")
assert.ok(has(node => node.type === "button" && text(node) === "Take photo"), "More photos can be added before saving")
await upload(["four.jpg"]); manyEditor = find(node => node.type?.name === "IssuePhotoEditor")
assert.equal(manyEditor.props.start, 3, "The editor opens on the newest photo"); manyEditor.props.onClose(); render(DailyPhotos, entryProps)
pendingCards()[0].props.onAnnotate(); render(DailyPhotos, entryProps)
assert.equal(find(node => node.type?.name === "IssuePhotoEditor").props.start, 0, "Annotate opens on that photo"); find(node => node.type?.name === "IssuePhotoEditor").props.onClose(); render(DailyPhotos, entryProps)
pendingCards()[3].props.onDiscard(); await settle(); render(DailyPhotos, entryProps)
assert.equal(pendingCards().length, 3, "One photo can be discarded on its own")
failingCapture = pendingCards()[1].props.capture.id
button("Save 3 photos to task").props.onClick(); await settle(); render(DailyPhotos, entryProps)
assert.equal(savedCaptures.length, 1, "A failure stops at that photo"); assert.equal(pendingCards().length, 2, "and only the photos still to send remain")
failingCapture = null
button("Save 2 photos to task").props.onClick(); await settle(); render(DailyPhotos, entryProps)
assert.equal(savedCaptures.length, 3); assert.ok(savedCaptures.every(call => call[3] === "e1"), "Every photo goes to this task"); assert.equal(pendingCards().length, 0)
assert.equal(savedCaptures[1][2].annotations.length, markup.length, "Annotations are saved with their photo")
assert.equal(parentBusy.at(-1), false, "Once all are saved the report can be submitted")
// The report's limit: only what fits is added, and the rest is explained.
const nearlyFull = Array.from({ length: 48 }, (_, n) => ({ id: `p${n}`, entry_id: "e2" }))
deps.useEvidencePhotos = () => ({ photos: nearlyFull, loading: false, error: "", reload: async () => {} })
reset(); render(DailyPhotos, entryProps); await upload(["a.jpg", "b.jpg", "c.jpg"])
assert.equal(find(node => node.type?.name === "IssuePhotoEditor").props.photos.length, 2); assert.match(text(find(node => node.props?.role === "alert")), /1 not added: one report can hold 50 photos/)
find(node => node.type?.name === "IssuePhotoEditor").props.onClose(); render(DailyPhotos, entryProps)
assert.equal(button("Take photo").props.disabled, true, "A full report takes no more photos")

console.log("QA and daily report photo markup: Super Admin photo switch (in-app camera at the site only, or device uploads allowed) for report, work item and Foreman QA photos, report capture, annotation/caption before save, original bytes and shutter timestamp preserved, duplicate-safe save/retry, report-submit lock; existing QA/correction markup, picker/editor, viewer and offline queue passed")
