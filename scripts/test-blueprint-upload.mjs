import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], effects = [], pending = [], cursor = 0, tree, docs = [], uploads = [], done = [], closed = 0, failPage = null, deferredRead = null, deferredUpload = null
globalThis.__uploadHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial } },
  useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || deps.some((value, i) => value !== old.deps[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  useId: () => "upload-form",
}
const deps = globalThis.__uploadDeps = {}
deps.supabase = {}
async function compile(file, nativePdf = false) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const replacements = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") }
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    if (!node.importClause || node.importClause.isTypeOnly) continue
    const exports = []
    if (node.importClause.name) exports.push(`export default function ${node.importClause.name.text}(){return null}`)
    for (const binding of node.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const name = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${name}=globalThis.${node.moduleSpecifier.text === "react" ? "__uploadHooks" : "__uploadDeps"}.${name} ?? function ${name}(){return null}`)
    }
    replacements[node.moduleSpecifier.text] = moduleUrl(exports.join(";"))
  }
  for (const [name, url] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(url)}`)
  if (nativePdf) output = output.replace('import("pdfjs-dist")', `import(${JSON.stringify(import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"))})`).replace('new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()', JSON.stringify(import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")))
  return import(moduleUrl(output))
}
const library = await compile("../src/lib/blueprints.ts")
const pdf = (name, count = 3) => Object.assign(new File(["synthetic PDF fixture"], name, { type: "application/pdf" }), { count })
const documentFor = file => {
  const doc = { numPages: file.count, renders: [], destroyed: 0, async destroy() { doc.destroyed++ }, async renderPage(page, edge = 3200) { doc.renders.push([page, edge]); return { blob: new Blob([`page ${page}`], { type: "image/png" }), width: 800, height: 600, ext: "png" } } }
  docs.push(doc); return doc
}
Object.assign(deps, {
  BLUEPRINT_ACCEPT: library.BLUEPRINT_ACCEPT, validateBlueprintFile: library.validateBlueprintFile,
  blueprintTypeLabels: { architectural: "Architectural" },
  openBlueprintPdf: async file => deferredRead ? deferredRead : documentFor(file),
  uploadBlueprintRevision: async (input, progress) => {
    uploads.push(input); progress("Saving page…")
    const id = input.blueprintId ?? `plan-${input.page}`
    if (!input.blueprintId) input.onCreated?.(id)
    if (deferredUpload) return deferredUpload
    if (failPage === input.page) throw new Error("Synthetic connection failure")
    return id
  },
})
const Dialog = (await compile("../src/components/BlueprintUploadDialog.tsx")).default
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected upload control"); return node }
let props = { projectId: "P", blueprintType: "architectural", onDone: id => done.push(id), onClose: () => { closed++ } }
const render = () => { cursor = 0; tree = Dialog(props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
const tick = () => new Promise(resolve => setImmediate(resolve))
const reset = () => { effects.forEach(effect => effect?.cleanup?.()); slots = []; effects = []; pending = []; uploads = []; done = []; docs = []; failPage = null; deferredRead = null; deferredUpload = null; closed = 0; props = { projectId: "P", blueprintType: "architectural", onDone: id => done.push(id), onClose: () => { closed++ } } }
const choose = async file => { find(node => node.type === "input" && node.props.type === "file").props.onChange({ target: { files: file ? [file] : [] } }); await tick(); render() }
const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
const pageRows = () => all(tree).filter(node => node.type === "article")
const label = page => find(node => node.props?.["aria-label"] === `Label for PDF page ${page}`)
const change = (control, value) => { control.props.onChange({ target: { value } }); render() }
const checkPage = (page, checked) => { all(pageRows().find(node => node.props["aria-label"] === `PDF page ${page}`)).find(node => node.type === "input").props.onChange({ target: { checked } }); render() }

render(); await choose(pdf("Building.pdf", 12))
assert.equal(pageRows().length, 12); assert.equal(tree.props.size, "2xl", "The upload dialog expands for all PDF pages")
assert.equal(label(12).props.value, "Building - Page 12")
change(label(1), "Ground floor"); change(find(node => node.props?.["aria-label"] === "Level or area for PDF page 1"), "L01")
change(label(2), " "); void submit(); await tick(); render(); assert.equal(uploads.length, 0); assert.match(text(tree), /page label between/)
checkPage(2, false)
for (let page = 4; page <= 12; page++) checkPage(page, false)
void submit(); await tick(); await tick(); render()
assert.deepEqual(uploads.map(row => row.page), [1, 3], "Only selected pages upload, in source-page order")
assert.equal(uploads[0].title, "Ground floor"); assert.equal(uploads[0].level, "L01")
assert.ok(uploads.every(row => row.projectId === "P" && row.file.type === "application/pdf" && row.preparedPreview.blob.type === "image/png"))
assert.notEqual(uploads[0].revisionId, uploads[1].revisionId)
assert.deepEqual(done, ["plan-1"])

reset(); render(); await choose(pdf("Selection.pdf", 2))
find(node => node.type === "button" && text(node) === "Clear selection").props.onClick(); render()
void submit(); await tick(); render(); assert.equal(uploads.length, 0); assert.match(text(tree), /Choose at least one PDF page/)
find(node => node.type === "button" && text(node) === "Select all").props.onClick(); render()
assert.equal(all(tree).filter(node => node.type === "input" && node.props.type === "checkbox" && node.props.checked).length, 2)
reset(); render(); deferredRead = Promise.reject(new Error("Damaged PDF fixture"))
await choose(pdf("Damaged.pdf", 2)); assert.match(text(tree), /Could not read this PDF/); assert.equal(pageRows().length, 0)

reset(); render(); await choose(pdf("Retry.pdf")); failPage = 2
void submit(); await tick(); await tick(); render()
assert.deepEqual(uploads.map(row => row.page), [1, 2]); assert.match(text(tree), /Saved pages are kept/)
assert.equal(label(1).props.disabled, true); assert.equal(label(2).props.disabled, true, "Prepared labels remain tied to their existing plan on retry")
const failedRevision = uploads[1].revisionId
failPage = null; void submit(); await tick(); await tick(); render()
assert.deepEqual(uploads.map(row => row.page), [1, 2, 2, 3], "Retry skips completed pages")
assert.equal(uploads[2].blueprintId, "plan-2"); assert.equal(uploads[2].revisionId, failedRevision, "Retry reuses the same plan and revision id")
assert.deepEqual(done, ["plan-1"])

reset(); render(); await choose(pdf("Preview.pdf", 2))
const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL, revoked = []
URL.createObjectURL = () => "blob:page-preview"; URL.revokeObjectURL = url => revoked.push(url)
find(node => node.type === "button" && text(node) === "Preview page").props.onClick(); await tick(); render()
assert.deepEqual(docs[0].renders, [[1, 900]]); assert.equal(find(node => node.type === "img").props.alt, "Preview of PDF page 1")
await choose(new File(["image"], "plan.png", { type: "image/png" }))
assert.ok(revoked.includes("blob:page-preview")); assert.equal(docs[0].destroyed, 1); assert.equal(pageRows().length, 0)
URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke
change(find(node => node.type === "input" && node.props.placeholder === "Ground floor - general arrangement"), "Image plan")
void submit(); await tick(); render(); assert.equal(uploads.length, 1); assert.equal(uploads[0].file.type, "image/png")

reset(); props.existing = { id: "existing-plan", title: "Original sheet", level: "L01", blueprint_type: "architectural", blueprint_revisions: [{ revision: 4 }] }
render(); await choose(pdf("Revision.pdf", 4))
assert.equal(pageRows().length, 4); assert.equal(all(tree).filter(node => node.type === "input" && node.props.type === "radio").length, 4)
assert.ok(!all(tree).some(node => node.props?.["aria-label"]?.startsWith("Label for PDF page")), "A new revision keeps its existing plan label/history")
checkPage(3, true); void submit(); await tick(); render()
assert.equal(uploads.length, 1); assert.equal(uploads[0].blueprintId, "existing-plan"); assert.equal(uploads[0].page, 3)

reset(); render(); let finishRead
deferredRead = new Promise(resolve => { finishRead = resolve })
await choose(pdf("Slow.pdf", 8)); assert.match(text(tree), /Reading PDF pages/)
await choose(new File(["image"], "new.png", { type: "image/png" }))
const stale = documentFor(pdf("Old.pdf", 8)); finishRead(stale); await tick(); render()
assert.equal(stale.destroyed, 1); assert.equal(pageRows().length, 0, "Late PDF loads cannot replace the newly selected file")
await choose(new File(["CAD"], "bad.dwg", { type: "application/octet-stream" })); assert.match(text(tree), /DWG\/DXF/)

reset(); render(); await choose(pdf("Leaving.pdf")); let finishUpload
deferredUpload = new Promise(resolve => { finishUpload = resolve })
void submit(); await tick(); const leavingDoc = docs[0]; reset(); finishUpload("plan-1"); await tick()
assert.equal(uploads.length, 0); assert.equal(done.length, 0); assert.equal(leavingDoc.destroyed, 1, "Closing/unmounting stops the remaining batch and releases its worker")

// Exercise the actual upload function with private storage and PostgREST substitutes.
const revisions = new Map(), stored = [], removed = [], blueprintRows = []
let writeMode = "ok", readBlocked = false, writes = 0, storageFailure = false
Object.assign(deps.supabase, {
  from(table) {
    let requested
    const chain = {
      select() { return chain }, eq(_key, value) { requested = value; return chain },
      async maybeSingle() { return { data: revisions.get(requested) ?? null, error: readBlocked ? { message: "Network down" } : null } },
      insert(value) {
        if (table === "blueprints") return { select() { return { async single() { const id = `created-${blueprintRows.length + 1}`; blueprintRows.push({ id, ...value }); return { data: { id }, error: null } } } } }
        writes++
        if (writeMode !== "before") revisions.set(value.id, { blueprint_id: value.blueprint_id, project_id: value.project_id })
        if (writeMode === "unknown") readBlocked = true
        return Promise.resolve({ error: writeMode === "ok" ? null : { message: "Synthetic network response lost" } })
      },
    }; return chain
  },
  storage: { from(bucket) { assert.equal(bucket, "blueprints"); return { async upload(path, body, options) { stored.push({ path, body, options }); return { error: storageFailure && path.includes("preview") ? { message: "Storage unavailable" } : null } }, async remove(paths) { removed.push(...paths); return { error: null } } } } },
})
const realUpload = (await compile("../src/lib/blueprints.ts")).uploadBlueprintRevision
const input = { projectId: "P", title: " Labelled page ", level: " L01 ", blueprintType: "architectural", file: pdf("Original.pdf", 2), page: 2, notes: "Notes", preparedPreview: { blob: new Blob(["preview"], { type: "image/png" }), width: 800, height: 600, ext: "png" }, revisionId: crypto.randomUUID() }
let createdId
const first = await realUpload({ ...input, onCreated: id => { createdId = id } }, () => {})
assert.equal(first, createdId); assert.equal(blueprintRows[0].title, "Labelled page"); assert.equal(blueprintRows[0].level, "L01")
assert.equal(stored[0].body, input.file, "Each sheet retains its original PDF privately")
assert.equal(revisions.size, 1)
const storedBefore = stored.length
assert.equal(await realUpload({ ...input, blueprintId: first }, () => {}), first)
assert.equal(stored.length, storedBefore); assert.equal(writes, 1, "Retrying a committed revision is a read, with no duplicate files or revision")
writeMode = "after"
await realUpload({ ...input, revisionId: crypto.randomUUID() }, () => {})
assert.equal(removed.length, 0, "A failed response after a committed revision never deletes its files")
writeMode = "unknown"
const uncertain = { ...input, revisionId: crypto.randomUUID(), onCreated: id => { createdId = id } }
await assert.rejects(realUpload(uncertain, () => {}), /confirm whether this page was saved/)
assert.equal(removed.length, 0, "Unconfirmed saves retain files until a safe retry")
readBlocked = false
const uncertainFiles = stored.length
assert.equal(await realUpload({ ...uncertain, blueprintId: createdId }, () => {}), createdId)
assert.equal(stored.length, uncertainFiles)
writeMode = "ok"; storageFailure = true
await assert.rejects(realUpload({ ...input, revisionId: crypto.randomUUID() }, () => {}), /Storage unavailable/)
assert.ok(removed.length, "A confirmed storage failure cleans up only that attempt's unused files")

// Parse and render a real two-page PDF through the production helper using PDF.js
// and the optional native canvas installed by pdfjs-dist. No hosted data or files.
let nativeCanvas
try { nativeCanvas = await import("@napi-rs/canvas") } catch { console.log("Optional native-canvas PDF fixture unavailable on this installation; form/storage tests still ran") }
if (nativeCanvas) {
  const { createCanvas, loadImage } = nativeCanvas
  const oldDocument = globalThis.document
  globalThis.document = { createElement(tag) { assert.equal(tag, "canvas"); const canvas = createCanvas(1, 1); canvas.toBlob = (callback, type) => callback(new Blob([canvas.toBuffer(type)], { type })); return canvas } }
  try {
    const red = "1 0 0 rg 0 0 200 100 re f\n", blue = "0 0 1 rg 0 0 200 100 re f\n"
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 4 0 R >>",
      `<< /Length ${Buffer.byteLength(red)} >>\nstream\n${red}endstream`,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> /Contents 6 0 R >>",
      `<< /Length ${Buffer.byteLength(blue)} >>\nstream\n${blue}endstream`,
    ]
    let pdfSource = "%PDF-1.7\n", offsets = [0]
    for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(pdfSource)); pdfSource += `${i + 1} 0 obj\n${objects[i]}\nendobj\n` }
    const xref = Buffer.byteLength(pdfSource)
    pdfSource += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const realPdf = await compile("../src/lib/blueprints.ts", true)
    const source = await realPdf.openBlueprintPdf(new File([pdfSource], "two-pages.pdf", { type: "application/pdf" }))
    try {
      assert.equal(source.numPages, 2)
      await assert.rejects(source.renderPage(3), /between 1 and 2/)
      for (const [page, expected] of [[1, [255, 0, 0]], [2, [0, 0, 255]]]) {
        const preview = await source.renderPage(page, 900)
        assert.equal(preview.width, 900); assert.equal(preview.height, 450)
        const image = await loadImage(Buffer.from(await preview.blob.arrayBuffer()))
        const canvas = createCanvas(image.width, image.height), context = canvas.getContext("2d")
        context.drawImage(image, 0, 0)
        assert.deepEqual([...context.getImageData(10, 10, 1, 1).data].slice(0, 3), expected, "The stored preview renders the selected source page")
      }
    } finally { await source.destroy() }
    console.log("Real two-page PDF.js count, source-page rendering, bounded preview size and cleanup passed")
  } finally { globalThis.document = oldDocument }
}
reset(); delete globalThis.__uploadHooks; delete globalThis.__uploadDeps
console.log("PDF upload: all-page labels/selection, previews and worker cleanup, stale reads, revision selection, partial retry, original-file retention and committed/uncertain-save idempotency passed")
