import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

// Everything here runs against fakes: no database, no network, no record is removed or restored anywhere.
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
const fileUrl = (path) => new URL(path, import.meta.url).href
const settle = () => new Promise((resolve) => setImmediate(resolve))
const transpile = (path, replacements) => {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return source
}
const text = (node) => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node)
const all = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => all(child, predicate)) : [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate), ...all(node.props?.footer, predicate), ...all(node.props?.action, predicate)]

const modelSource = transpile("../src/lib/recordRemovalModel.ts", { "./recycleBinModel": fileUrl("../src/lib/recycleBinModel.ts") })
const modelUrl = url(modelSource)
const { RECORD_KINDS, RECORDS_NOT_INSTALLED, isRecordKind, kindLabels, kindNames, parseRecordPreview, parseRemovable, parseRemoved, recordError, recordRemovalProblem } = await import(modelUrl)

// ---------------------------------------------------------------- the pure rules
{
  assert.deepEqual(RECORD_KINDS, ["daily_report", "site_issue", "client_report"])
  for (const kind of RECORD_KINDS) { assert.ok(kindLabels[kind] && kindNames[kind]); assert.equal(isRecordKind(kind), true) }
  for (const bad of ["qa_inspection", "qa_defect", "attendance", "audit_log", "", null, 5, undefined]) assert.equal(isRecordKind(bad), false, String(bad))

  const row = { id: "r1", label: "SR-0001", title: "Crack", status: "submitted", created_at: "2026-11-01T01:00:00Z", project_code: "VCB-1", project_name: "Tower" }
  assert.deepEqual(parseRemovable([row, { id: 5 }, null, "x", { id: "r2", label: "A" }]).map((r) => r.id), ["r1", "r2"])
  for (const bad of [null, undefined, "x", {}]) assert.equal(parseRemovable(bad), null)
  const removed = { kind: "site_issue", id: "r1", label: "AB12CD34", title: "Beam", project_code: "VCB-1", project_name: "Tower", removed_at: "2026-11-01T02:00:00Z", removed_by: "Ana", reason: "Duplicate" }
  assert.equal(parseRemoved([removed, { ...removed, kind: "qa_defect" }, { ...removed, id: 3 }, { ...removed, removed_at: null }]).length, 1, "only the three kinds are ever shown")
  assert.deepEqual(parseRemoved([{ ...removed, removed_by: 5, reason: undefined }])[0].removed_by, null); assert.equal(parseRemoved("x"), null)

  const preview = { kind: "client_report", id: "r1", label: "SR-0001", title: "Crack", status: "submitted", project_code: "VCB-1", project_name: "Tower", project_removed: false, confirm_phrase: "REMOVE SR-0001" }
  assert.equal(parseRecordPreview(preview).confirm_phrase, "REMOVE SR-0001")
  for (const bad of [null, "x", {}, { ...preview, kind: "qa_defect" }, { ...preview, confirm_phrase: 5 }]) assert.equal(parseRecordPreview(bad), null)

  const parsed = parseRecordPreview(preview)
  const ok = { preview: parsed, reason: "Sent to the wrong project", typed: "REMOVE SR-0001" }
  assert.equal(recordRemovalProblem(ok), null)
  assert.match(recordRemovalProblem({ ...ok, preview: null }), /Check the record first/); assert.match(recordRemovalProblem({ ...ok, preview: { ...parsed, project_removed: true } }), /recycle bin/)
  assert.match(recordRemovalProblem({ ...ok, reason: "no" }), /5 to 300/); assert.match(recordRemovalProblem({ ...ok, reason: "x".repeat(301) }), /5 to 300/); assert.match(recordRemovalProblem({ ...ok, reason: "   " }), /5 to 300/)
  for (const wrong of ["remove sr-0001", "REMOVE SR-0001 ", " REMOVE SR-0001", "SR-0001", "REMOVE", ""]) assert.match(recordRemovalProblem({ ...ok, typed: wrong }), /Type REMOVE SR-0001 exactly/, JSON.stringify(wrong))

  assert.equal(recordError({ code: "PGRST202" }).setup, true); assert.equal(recordError({ message: "x" }).setup, false); assert.equal(recordError({ code: "PGRST202" }).message, RECORDS_NOT_INSTALLED)
  assert.match(recordError({ message: "Only a Super Admin can remove records", code: "42501" }).message, /authenticator app/); assert.match(recordError({ message: "Failed to fetch" }).message, /Network problem/)
  assert.equal(recordError({ message: "Type the confirmation exactly: REMOVE SR-0001" }).message, "Type the confirmation exactly: REMOVE SR-0001"); assert.equal(recordError(null).message, "That did not work. Try again.")
}

// ---------------------------------------------------------------- a small harness that runs React hooks without a browser
function hooksHarness() {
  let state = [], effects = [], cursor = 0, pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial) { const n = cursor++; if (!(n in state)) state[n] = typeof initial === "function" ? initial() : initial; return [state[n], (value) => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
    useCallback(fn, deps) { const n = cursor++; if (!same(state[n]?.deps, deps)) state[n] = { deps, fn }; return state[n].fn },
    useEffect(fn, deps) { const n = cursor++; if (!same(effects[n]?.deps, deps)) pending.push(() => { effects[n]?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  }
  return { hooks, render(fn) { cursor = 0; const value = fn(); const work = pending; pending = []; work.forEach((run) => run()); return value }, unmount() { effects.forEach((effect) => effect?.cleanup?.()) } }
}

// ---------------------------------------------------------------- the data layer, with a fake database
{
  const calls = []
  let answers = {}
  globalThis.__rrSupabase = { rpc: async (name, args) => { calls.push([name, args]); const a = answers[name]; return typeof a === "function" ? a(args) : a ?? { data: null, error: null } } }
  const harness = hooksHarness(); globalThis.__rrHooks = harness.hooks
  const source = transpile("../src/lib/recordRemoval.ts", { react: url("export const useCallback=(...a)=>globalThis.__rrHooks.useCallback(...a),useEffect=(...a)=>globalThis.__rrHooks.useEffect(...a),useState=(...a)=>globalThis.__rrHooks.useState(...a);"), "./supabase": url("export const supabase=globalThis.__rrSupabase;"), "./recycleBinModel": fileUrl("../src/lib/recycleBinModel.ts"), "./recordRemovalModel": modelUrl })
  const api = await import(url(source))

  answers.search_removable_records = { data: [{ id: "r1", label: "SR-0001", title: "Crack", status: "submitted", created_at: "2026-11-01T01:00:00Z", project_code: "VCB-1", project_name: "Tower" }], error: null }
  let r = await api.searchRecords("client_report", "  crack "); assert.equal(r.data.length, 1); assert.deepEqual(calls.at(-1), ["search_removable_records", { p_kind: "client_report", p_query: "crack" }])
  answers.search_removable_records = { data: "nope", error: null }; r = await api.searchRecords("daily_report", ""); assert.equal(r.data, null); assert.match(r.error, /could not be read/)
  answers.search_removable_records = { data: null, error: { code: "PGRST202", message: "x" } }; r = await api.searchRecords("daily_report", ""); assert.equal(r.setup, true)

  answers.preview_record_removal = { data: { kind: "site_issue", id: "r1", label: "AB12CD34", confirm_phrase: "REMOVE AB12CD34", project_removed: false }, error: null }
  r = await api.previewRecord("site_issue", "r1"); assert.equal(r.data.confirm_phrase, "REMOVE AB12CD34"); assert.deepEqual(calls.at(-1), ["preview_record_removal", { p_kind: "site_issue", p_id: "r1" }])
  answers.preview_record_removal = { data: { x: 1 }, error: null }; r = await api.previewRecord("site_issue", "r1"); assert.equal(r.data, null)

  answers.remove_record = { data: { removed: true, label: "AB12CD34" }, error: null }
  r = await api.removeRecord({ kind: "site_issue", id: "r1", reason: "  Duplicate \u0007 issue ", phrase: "REMOVE AB12CD34" }); assert.equal(r.data.removed, true)
  assert.deepEqual(calls.at(-1), ["remove_record", { p_kind: "site_issue", p_id: "r1", p_reason: "Duplicate issue", p_confirm: "REMOVE AB12CD34" }], "the reason is cleaned and the phrase is sent exactly as typed")
  answers.remove_record = { data: null, error: { message: "Type the confirmation exactly: REMOVE AB12CD34" } }; r = await api.removeRecord({ kind: "site_issue", id: "r1", reason: "Duplicate issue", phrase: "x" }); assert.match(r.error, /^Type the confirmation exactly/)
  answers.restore_record = { data: { restored: true, label: "AB12CD34" }, error: null }
  r = await api.restoreRecord("site_issue", "r1"); assert.equal(r.data.restored, true); assert.deepEqual(calls.at(-1), ["restore_record", { p_kind: "site_issue", p_id: "r1" }])

  answers.get_removed_records = { data: [{ kind: "daily_report", id: "d1", label: "2026-11-01", title: "Tiles", project_code: "VCB-1", project_name: "Tower", removed_at: "2026-11-01T02:00:00Z", removed_by: "Ana", reason: "Mistake" }], error: null }
  const before = calls.length
  let view = harness.render(() => api.useRemovedRecords(false)); await settle(); view = harness.render(() => api.useRemovedRecords(false))
  assert.equal(calls.length, before, "nobody else asks"); assert.deepEqual(view.records, [])
  const allowed = hooksHarness(); globalThis.__rrHooks = allowed.hooks
  view = allowed.render(() => api.useRemovedRecords(true)); await settle(); view = allowed.render(() => api.useRemovedRecords(true))
  assert.equal(view.records.length, 1); assert.equal(view.loading, false); assert.equal(view.error, "")
  answers.get_removed_records = { data: null, error: { code: "PGRST202", message: "x" } }; await view.reload(); view = allowed.render(() => api.useRemovedRecords(true)); assert.equal(view.setup, true); assert.equal(view.error, "")
  answers.get_removed_records = { data: null, error: { message: "Failed to fetch" } }; await view.reload(); view = allowed.render(() => api.useRemovedRecords(true)); assert.match(view.error, /Network problem/)
  delete globalThis.__rrSupabase; delete globalThis.__rrHooks
}

// ---------------------------------------------------------------- the screens
{
  const harnesses = { modal: hooksHarness(), panel: hooksHarness(), removed: hooksHarness(), page: hooksHarness() }
  const draws = (name, fn) => { globalThis.__rrUiHooks = harnesses[name].hooks; return harnesses[name].render(fn) }
  const calls = { search: [], preview: [], remove: [], restore: [], toast: [], confirm: [], done: 0, closed: 0, changed: 0 }
  let role = "super_admin", confirmAnswer = true
  const record = { id: "r1", label: "SR-0001", title: "Crack above the door", status: "submitted", created_at: "2026-11-01T01:00:00Z", project_code: "VCB-1", project_name: "Tower" }
  let searchAnswer = { data: [record], error: "", setup: false }
  let previewAnswer = { data: { kind: "client_report", id: "r1", label: "SR-0001", title: "Crack above the door", status: "submitted", project_code: "VCB-1", project_name: "Tower", project_removed: false, confirm_phrase: "REMOVE SR-0001" }, error: "", setup: false }
  let removeAnswer = { data: { removed: true, label: "SR-0001" }, error: "", setup: false }
  let restoreAnswer = { data: { restored: true, label: "SR-0001" }, error: "", setup: false }
  globalThis.__rrUiApi = {
    searchRecords: async (kind, query) => { calls.search.push([kind, query]); return searchAnswer }, previewRecord: async (kind, id) => { calls.preview.push([kind, id]); return previewAnswer },
    removeRecord: async (input) => { calls.remove.push(input); return removeAnswer }, restoreRecord: async (kind, id) => { calls.restore.push([kind, id]); return restoreAnswer },
    useRemovedRecords: (enabled) => ({ records: [], loading: false, error: "", setup: false, reload: async () => { calls.changed++ }, enabled }),
  }
  globalThis.__rrUiToast = { error: (...a) => calls.toast.push(["error", ...a]), success: (...a) => calls.toast.push(["success", ...a]) }
  globalThis.__rrUiConfirm = async (options) => { calls.confirm.push(options); return confirmAnswer }
  globalThis.__rrUiRole = () => role
  const source = transpile("../src/pages/Admin/Records.tsx", {
    react: url("export const useState=(...a)=>globalThis.__rrUiHooks.useState(...a),useEffect=(...a)=>globalThis.__rrUiHooks.useEffect(...a);"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "../../components/Modal": url("export default function Modal(){return null}"), "../../components/ui/PageParts": url("export const buttonPrimary='primary',buttonSecondary='secondary',inputClass='input';"),
    "../../components/ui/Skeleton": url("export const Skeleton=function Skeleton(){return null};"), "../../lib/admin": url("export const formatDate=(x)=>x.slice(0,10),formatTime=(x)=>x.slice(11,16);"),
    "../../lib/auth": url("export const useAuth=()=>({profile:{role:globalThis.__rrUiRole()}});"), "../../lib/confirm": url("export const useConfirm=()=>globalThis.__rrUiConfirm;"),
    "../../lib/recordRemoval": url("export const searchRecords=(...a)=>globalThis.__rrUiApi.searchRecords(...a),previewRecord=(...a)=>globalThis.__rrUiApi.previewRecord(...a),removeRecord=(...a)=>globalThis.__rrUiApi.removeRecord(...a),restoreRecord=(...a)=>globalThis.__rrUiApi.restoreRecord(...a),useRemovedRecords=(...a)=>globalThis.__rrUiApi.useRemovedRecords(...a);"),
    "../../lib/recordRemovalModel": modelUrl, "../../lib/recycleBinModel": fileUrl("../src/lib/recycleBinModel.ts"), "../../lib/toast": url("export const useToast=()=>globalThis.__rrUiToast;"),
    "./AdminShell": url("export const PageIntro=function PageIntro(){return null},Panel=function Panel(){return null};"),
  })
  const page = await import(url(source))
  const click = async (element) => { element.props.onClick(); await settle(); await settle() }
  const button = (tree, wording) => all(tree, (node) => node.type === "button" && text(node).includes(wording))[0]
  const field = (tree, label) => all(tree, (node) => (node.type === "input" || node.type === "textarea" || node.type === "select") && node.props["aria-label"] === label)[0]
  const textarea = (tree) => all(tree, (node) => node.type === "textarea")[0]

  // --- the removal dialog
  const drawM = () => draws("modal", () => page.RemoveRecordModal({ kind: "client_report", record, onClose: () => calls.closed++, onDone: () => calls.done++ }))
  let tree = drawM(); await settle(); tree = drawM()
  assert.deepEqual(calls.preview, [["client_report", "r1"]], "the database is asked first"); assert.equal(tree.props.title, "Remove this client report?")
  assert.match(text(tree), /SR-0001/); assert.match(text(tree), /VCB-1 Tower/); assert.match(text(tree), /Restoring puts it back exactly as it was/)
  const confirmButton = () => button(tree, "Remove")
  assert.equal(confirmButton().props.disabled, true, "off until a reason is given and the phrase is typed")
  textarea(tree).props.onChange({ target: { value: "no" } }); field(tree, "Confirmation phrase").props.onChange({ target: { value: "REMOVE SR-0001" } }); tree = drawM(); assert.equal(confirmButton().props.disabled, true, "a one-word reason is not enough")
  textarea(tree).props.onChange({ target: { value: "Sent to the wrong project" } }); field(tree, "Confirmation phrase").props.onChange({ target: { value: "remove sr-0001" } }); tree = drawM()
  assert.equal(confirmButton().props.disabled, true); assert.match(text(tree), /Type REMOVE SR-0001 exactly/)
  await click(confirmButton()); assert.equal(calls.remove.length, 0, "a click on the disabled button sends nothing")
  field(tree, "Confirmation phrase").props.onChange({ target: { value: "REMOVE SR-0001" } }); tree = drawM(); assert.equal(confirmButton().props.disabled, false)
  removeAnswer = { data: null, error: "Its project is in the recycle bin. Restore the project first", setup: false }
  const doneBefore = calls.done
  await click(confirmButton()); tree = drawM(); assert.equal(calls.done, doneBefore, "a refusal keeps the dialog open"); assert.deepEqual(calls.toast.at(-1), ["error", "Not removed", "Its project is in the recycle bin. Restore the project first"])
  removeAnswer = { data: { removed: true, label: "SR-0001" }, error: "", setup: false }
  await click(confirmButton())
  assert.deepEqual(calls.remove.at(-1), { kind: "client_report", id: "r1", reason: "Sent to the wrong project", phrase: "REMOVE SR-0001" }); assert.equal(calls.done, doneBefore + 1)
  assert.deepEqual(calls.toast.at(-1), ["success", "SR-0001 was removed", "Nothing was deleted. You can restore it from Removed records."])
  previewAnswer = { data: null, error: "Record not found", setup: false }
  harnesses.modal = hooksHarness(); tree = drawM(); await settle(); tree = drawM(); assert.match(text(tree), /Record not found/); assert.equal(confirmButton().props.disabled, true)

  // --- finding records
  const drawP = () => draws("panel", () => page.RemovePanel({ onChanged: () => calls.changed++ }))
  tree = drawP(); await settle(); tree = drawP()
  assert.deepEqual(calls.search.at(-1), ["daily_report", ""], "the newest records of the first kind are listed at once"); assert.match(text(tree), /SR-0001/)
  assert.match(text(tree), /Inspections, defect reports, attendance records and the audit log cannot be removed here/)
  assert.deepEqual(all(field(tree, "Kind of record"), (node) => node.type === "option").map((node) => text(node)), ["Daily reports", "Site issues", "Client reports"], "only the three kinds are offered")
  field(tree, "Kind of record").props.onChange({ target: { value: "client_report" } }); field(tree, "Search records").props.onChange({ target: { value: "crack" } }); tree = drawP()
  all(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); tree = drawP(); await settle(); tree = drawP()
  assert.deepEqual(calls.search.at(-1), ["client_report", "crack"])
  searchAnswer = { data: [], error: "", setup: false }; harnesses.panel = hooksHarness(); tree = drawP(); await settle(); tree = drawP(); assert.match(text(tree), /No daily reports match/)
  searchAnswer = { data: null, error: "Record removal is not installed on the database yet", setup: true }; harnesses.panel = hooksHarness(); tree = drawP(); await settle(); tree = drawP(); assert.match(text(tree), /not installed on the database yet/)
  searchAnswer = { data: [record], error: "", setup: false }; harnesses.panel = hooksHarness(); tree = drawP(); await settle(); tree = drawP()
  await click(all(tree, (node) => node.type === "button" && node.props["aria-label"] === "Remove SR-0001")[0]); tree = drawP()
  assert.equal(all(tree, (node) => typeof node.type === "function" && node.type.name === "RemoveRecordModal" && node.props.record.id === "r1").length, 1, "the dialog opens for that record")

  // --- removed records and restore
  const removedRow = { kind: "site_issue", id: "i1", label: "AB12CD34", title: "Cracked beam", project_code: "VCB-1", project_name: "Tower", removed_at: "2026-11-01T02:00:00Z", removed_by: "Ana", reason: "Duplicate" }
  const drawR = (props = {}) => draws("removed", () => page.RemovedPanel({ records: [removedRow], loading: false, error: "", setup: false, onChanged: () => calls.changed++, ...props }))
  tree = drawR()
  assert.match(text(tree), /Site issues • AB12CD34/); assert.match(text(tree), /Removed 2026-11-01 02:00 by Ana/); assert.match(text(tree), /Reason: Duplicate/); assert.match(text(tree), /Nothing here expires/)
  assert.ok(!/delete forever|permanently/i.test(text(tree)), "there is no permanent deletion here")
  assert.match(text(drawR({ records: [] })), /No record has been removed/); assert.match(text(drawR({ setup: true })), /not installed on the database yet/); assert.match(text(drawR({ error: "Network problem." })), /Network problem\./)
  tree = drawR()
  confirmAnswer = false; const changed = calls.changed
  await click(button(tree, "Restore")); assert.equal(calls.restore.length, 0, "declining the confirmation changes nothing"); assert.equal(calls.confirm.at(-1).title, "Restore AB12CD34?")
  confirmAnswer = true; restoreAnswer = { data: null, error: "Its project is in the recycle bin. Restore the project first", setup: false }
  await click(button(tree, "Restore")); assert.deepEqual(calls.toast.at(-1), ["error", "Not restored", "Its project is in the recycle bin. Restore the project first"]); assert.equal(calls.changed, changed)
  restoreAnswer = { data: { restored: true, label: "AB12CD34" }, error: "", setup: false }
  tree = drawR(); await click(button(tree, "Restore")); assert.deepEqual(calls.restore.at(-1), ["site_issue", "i1"]); assert.deepEqual(calls.toast.at(-1), ["success", "AB12CD34 was restored"]); assert.equal(calls.changed, changed + 1)

  // --- the page: only a Super Admin gets anything
  role = "admin"; let shell = draws("page", () => page.default({ onNavigate() {} })); await settle()
  assert.match(text(shell), /Only a Super Admin can open Records/, "an Admin is told so"); assert.equal(all(shell, (node) => node.props?.role === "tablist").length, 0, "and gets no panel")
  role = "super_admin"; harnesses.page = hooksHarness(); shell = draws("page", () => page.default({ onNavigate() {} })); await settle(); shell = draws("page", () => page.default({ onNavigate() {} }))
  assert.equal(all(shell, (node) => node.props?.role === "tablist").length, 1)
  Object.values(harnesses).forEach((h) => h.unmount())
  for (const key of ["__rrUiHooks", "__rrUiApi", "__rrUiToast", "__rrUiConfirm", "__rrUiRole"]) delete globalThis[key]
}

// ---------------------------------------------------------------- nothing else changed on the page layer
{
  const nav = readFileSync(new URL("../src/pages/Admin/AdminShell.tsx", import.meta.url), "utf8")
  assert.match(nav, /item\.key === "records"\) && profile\?\.role !== "super_admin"/, "the menu entry is for a Super Admin only")
  const migration = readFileSync(new URL("../supabase/migrations/20261101200000_record_removal.sql", import.meta.url), "utf8")
  assert.doesNotMatch(migration.replace(/--.*$/gm, ""), /\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i, "the migration deletes nothing")
  for (const forbidden of ["qa_inspections", "qa_defects", "biometric_attendance_events", "attendance_workers"]) assert.ok(!new RegExp(`(update|alter table) public\\.${forbidden}`, "i").test(migration), forbidden + " is not touched")
}

console.log("Record removal: kinds and rules, data layer, remove dialog with typed confirmation, search, removed list and restore, Super Admin only page passed")
