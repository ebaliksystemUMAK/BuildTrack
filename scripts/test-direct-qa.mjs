import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { checklistProblem } from "../src/lib/qaModel.ts"
import { completionProblem } from "../src/lib/workItemModel.ts"
import { pickableChecklists } from "../src/lib/qaChecklists.ts"
import { progressPercent, taskProgress } from "../src/lib/taskProgress.ts"

// Real React component controls, isolated hooks and fake RPCs. No production fixtures or credentials.
let slots = [], cursor = 0, effects = [], tree, role = "foreman", calls = [], confirmation = true, saved = 0, preflightItem = null
const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
const hooks = {
  useState(initial) { const at = cursor++; if (!(at in slots)) slots[at] = typeof initial === "function" ? initial() : initial; return [slots[at], value => { slots[at] = typeof value === "function" ? value(slots[at]) : value }] },
  useRef(initial) { const at = cursor++; return slots[at] ??= { current: initial } },
  useEffect(fn) { effects.push(fn) }, useMemo(fn) { return fn() }, useId() { return "qa-test" },
  lazy() { return "LazyWorkspace" }, Suspense: "Suspense",
}
globalThis.__directQaHooks = hooks
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } })
const pin = { id: "pin", project_id: "project", blueprint_id: "sheet", title: "KITCHEN", assigned_to: "foreman", status: "in_progress", qa_template_id: null }
const item = { id: "floor", text: "FLOOR", pin_id: pin.id, project_id: pin.project_id, done: false, remark: "", review_status: "not_submitted", qa_template_id: "criteria" }
const criterion = { id: "c1", text: "Synthetic floor check", acceptance_criteria: "Synthetic floor pass condition", reference: "TEST only", kind: "check", severity: "major", requires_photo: false, hold_point: false, unit: null, min_value: null, max_value: null }
const template = { id: "criteria", name: "Floor-specific criteria", archived: false, qa_template_items: [criterion] }
const emptyHistory = { submissions: [], inspections: [], attempts: [], events: [], loading: false, reload: async () => {} }
const qa = { state: { status: "in_progress", open: false }, preflight: async itemId => { preflightItem = itemId; return null }, reload: async () => {} }
const stage = { view: { action: "submit", stage: "preparing", owner: "Foreman", next: "Submit FLOOR for QA Review" }, current: null, open: null, attempts: [], ncrs: [] }
const data = { item, pin, stage, draft: null, photos: [], defects: [], history: emptyHistory, qa, pinItems: [item], reload: async () => {}, templateName: template.name }
const fakeDb = {
  from(table) { return { update(payload) { calls.push({ table, payload }); return { eq() { return { select: async () => ({ data: [{ id: item.id }], error: null }) } } } } } },
  async rpc(name, payload) { calls.push({ name, payload }); return { data: item.id, error: null } },
}
globalThis.__directQaDeps = {
  useAuth: () => ({ profile: { id: role, role, status: "active" } }),
  usePinQa: () => qa, useChecklist: () => ({ items: [item], loading: false, reload: async () => {} }),
  usePinPhotos: () => ({ photos: [], reload: async () => {} }), useWorkQaHistory: () => emptyHistory,
  usePinDefects: () => [], stageOf: () => stage, useWorkItem: () => data, useDefectHistory: () => [],
  useTemplates: () => ({ templates: [template], loading: false, error: "" }),
  useProject: () => ({ project: null }), useProjectTeam: () => ({ team: [] }), useSettings: () => ({ settings: {} }),
  useConfirm: () => async () => confirmation, useToast: () => ({ success() {}, error() {}, info() {} }),
  // Per-type access: this person holds Assigned work on the sheet type (view-only behaviour is covered by test:blueprint-access).
  usePinTypeAccess: () => ({ canAct: true, viewOnly: false, typeLabel: "Civil / Structural" }),
  checklistProblem, pickableChecklists, progressPercent, taskProgress, pinLevelDefects: () => [], completionProblem, supabase: fakeDb,
  qaActions: {
    async submitItems(pinId, items) { calls.push({ name: "submitItems", pinId, items }); return { ok: true } },
    async completeItem(itemId) { calls.push({ name: "completeItem", itemId }); return { ok: true } },
  },
}

async function compile(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const modules = new Map()
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    const path = declaration.moduleSpecifier.text
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const exports = []
    if (declaration.importClause.name) exports.push("export default function Stub(){return null}")
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const name = binding.propertyName?.text ?? binding.name.text
      exports.push(path === "react" ? `export const ${name}=globalThis.__directQaHooks.${name}` : `export const ${name}=globalThis.__directQaDeps[${JSON.stringify(name)}] ?? function Stub(){return null}`)
    }
    modules.set(path, moduleUrl(exports.join(";\n")))
  }
  modules.set("react/jsx-runtime", import.meta.resolve("react/jsx-runtime"))
  for (const [path, url] of modules) output = output.replaceAll(`from "${path}"`, `from ${JSON.stringify(url)}`)
  return import(moduleUrl(output))
}
const nodes = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children), ...nodes(node.props?.footer)]
const text = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : ""
const find = predicate => { const found = nodes(tree).find(predicate); assert.ok(found, "QA control not found"); return found }
const button = label => find(node => node.type === "button" && text(node) === label)
const reset = () => { slots = []; effects = []; cursor = 0 }
const render = (component, props) => { cursor = 0; effects = []; tree = component(props); return tree }

const { PinChecklist } = await compile("../src/components/editor/PinParts.tsx")
render(PinChecklist, { pin, canEdit: false, canTick: true })
assert.doesNotMatch(text(tree), /Upload photos|Take photo|Submit all ready|Ready:/)
assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").length, 0)
button("Open FLOOR").props.onClick()
render(PinChecklist, { pin, canEdit: false, canTick: true })
assert.ok(nodes(tree).some(node => node.props?.itemId === "floor"))
reset(); role = "engineer"
render(PinChecklist, { pin, canEdit: true, canTick: false })
button("Add task & QC criteria").props.onClick()
render(PinChecklist, { pin, canEdit: true, canTick: false })
assert.ok(nodes(tree).some(node => node.props?.onSaved && node.props?.pin === pin))

// Engineer action stays discoverable, with a reason rather than silently disappearing.
reset(); qa.state.open = true
render(PinChecklist, { pin, canEdit: true, canTick: false })
assert.equal(button("Add task & QC criteria").props.disabled, false)
qa.state.open = false; qa.state.awaitingVerification = true
render(PinChecklist, { pin, canEdit: true, canTick: false })
assert.equal(button("Add task & QC criteria").props.disabled, false)
qa.state.awaitingVerification = false; qa.state.status = "verified"
render(PinChecklist, { pin, canEdit: true, canTick: false })
assert.equal(button("Add task & QC criteria").props.disabled, true)
assert.match(text(tree), /Completed.*Reopen it from Details/)
qa.state.status = "in_progress"
const loadedQa = qa.state
qa.state = null; qa.error = "Test connection error"
render(PinChecklist, { pin, canEdit: true, canTick: false })
assert.equal(button("Add task & QC criteria").props.disabled, true)
assert.match(text(tree), /Could not check QC status/)
button("Retry QC check")
qa.error = ""; qa.state = loadedQa
render(PinChecklist, { pin, canEdit: false, canTick: false })
assert.equal(button("Add task & QC criteria").props.disabled, true)
assert.match(text(tree), /latest sheet revision.*exit presentation mode/)
render(PinChecklist, { pin, canEdit: true, canTick: false })
assert.equal(button("Add task & QC criteria").props.disabled, false)

reset(); role = "foreman"
pin.status = "for_review"; qa.state.open = true
const { default: Workspace } = await compile("../src/components/qa/WorkItemWorkspace.tsx")
render(Workspace, { itemId: item.id, onClose() {} })
assert.doesNotMatch(text(tree), /Mark FLOOR ready|Ready:/)
const evidence = find(node => node.props?.onRemarkChange)
assert.equal(evidence.props.canWork, true, "Another item's pending QA must not block fresh evidence")
// The real nested evidence component contains the photo controls, not the checklist row.
const parentSlots = slots
reset(); tree = evidence.type(evidence.props)
assert.ok(nodes(tree).some(node => node.props?.itemId === item.id && node.props?.onAdded))
assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox").length, 0)
find(node => node.type === "textarea").props.onChange({ target: { value: "Finished and checked on site" } })
slots = parentSlots
render(Workspace, { itemId: item.id, onClose() {} })
confirmation = false
button("Submit FLOOR for QA Review").props.onClick()
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(calls.length, 0, "Cancelled submission must not write")
confirmation = true
button("Submit FLOOR for QA Review").props.onClick()
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(calls.map(row => row.name ?? row.table), ["pin_checklist_items", "submitItems"])
assert.equal(calls[0].payload.remark, "Finished and checked on site")
assert.deepEqual(calls[1].items, [item.id])
assert.equal(preflightItem, item.id, "Submission must use item-scoped, not pin-wide preflight")
pin.status = "in_progress"; qa.state.open = false

// Final checklist completion is explicit, Engineer-only and blocked until every linked NCR is closed.
reset(); calls = []; role = "engineer"; confirmation = true
item.done = true; item.review_status = "for_review"
stage.current = { id: "inspection", status: "passed" }
stage.view = { stage: "passed", action: "complete", owner: "Engineer" }
render(Workspace, { itemId: item.id, onClose() {} })
assert.equal(calls.length, 0, "Passing QA/rendering does not complete the checklist automatically")
assert.equal(button("Complete task").props.disabled, false)
assert.doesNotMatch(text(tree), /Accept FLOOR|Accepted/)
for (const status of ["open", "in_progress", "for_verification"]) {
  stage.ncrs = [{ id: "ncr", number: 1, status }]
  render(Workspace, { itemId: item.id, onClose() {} })
  assert.equal(button("Complete task").props.disabled, true, `${status} NCR blocks completion`)
  assert.match(text(tree), /Cannot complete task: Close the 1 open NCR/)
  await button("Complete task").props.onClick()
  assert.equal(calls.length, 0, "Even an invoked disabled handler must not bypass the guard")
}
stage.ncrs = [{ id: "ncr", number: 1, status: "closed" }]
data.error = "NCR data unavailable"
render(Workspace, { itemId: item.id, onClose() {} })
assert.equal(button("Complete task").props.disabled, true)
data.error = ""; emptyHistory.loading = true
render(Workspace, { itemId: item.id, onClose() {} })
assert.equal(button("Complete task").props.disabled, true)
emptyHistory.loading = false
render(Workspace, { itemId: item.id, onClose() {} })
confirmation = false; await button("Complete task").props.onClick()
assert.equal(calls.length, 0, "Cancelling confirmation does not complete the checklist")
confirmation = true; await button("Complete task").props.onClick()
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(calls, [{ name: "completeItem", itemId: item.id }])
for (const status of ["requested", "in_progress", "failed", "conditional"]) {
  stage.current.status = status
  render(Workspace, { itemId: item.id, onClose() {} })
  assert.ok(!nodes(tree).some(node => node.type === "button" && text(node) === "Complete task"), `${status} QA cannot be completed`)
}
stage.current.status = "passed"; role = "foreman"
render(Workspace, { itemId: item.id, onClose() {} })
assert.ok(!nodes(tree).some(node => node.type === "button" && text(node) === "Complete task"))
role = "engineer"; item.review_status = "verified"
render(Workspace, { itemId: item.id, onClose() {} })
assert.ok(!nodes(tree).some(node => node.type === "button" && text(node) === "Complete task"), "Completed records cannot be completed twice")
const { StageRail } = await compile("../src/components/qa/WorkItemParts.tsx")
render(StageRail, { stage: "passed", completed: false })
assert.deepEqual(nodes(tree).filter(node => node.type === "li").map(node => text(node).replace("✓ ", "")), ["Submitted", "Passed", "Completed"])
assert.equal(nodes(tree).filter(node => node.type === "li").at(-1).props["aria-current"], undefined)
render(StageRail, { stage: "completed", completed: false })
assert.equal(nodes(tree).filter(node => node.type === "li").at(-1).props["aria-current"], "step")

reset(); calls = []
const { default: ChecklistEditor } = await compile("../src/components/qa/WorkChecklistEditor.tsx")
const editorProps = { pin, onClose() {}, onSaved() { saved++ } }
let editor = ChecklistEditor(editorProps)
const Editor = editor.type
render(Editor, editor.props)
assert.equal(button("Save task and QC criteria").props.disabled, true)
find(node => node.type === "input" && node.props.placeholder).props.onChange({ target: { value: "FLOOR" } })
find(node => node.type === "input" && node.props.id?.endsWith("-test")).props.onChange({ target: { value: "Synthetic floor check" } })
find(node => node.type === "textarea" && node.props.id?.endsWith("-pass")).props.onChange({ target: { value: "Synthetic floor passing requirement" } })
render(Editor, editor.props)
assert.equal(button("Save task and QC criteria").props.disabled, false)
button("Save task and QC criteria").props.onClick()
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(calls[0].name, "save_work_checklist_item")
assert.equal(calls[0].payload.p_text, "FLOOR")
assert.equal(calls[0].payload.p_criteria[0].acceptance_criteria, "Synthetic floor passing requirement")
assert.equal(saved, 1)
console.log("Direct QA: item/criteria atomic save controls, Open-only checklist rows, nested photo controls, no Ready tick, cancellation and saved-remark submission checks passed")
