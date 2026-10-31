import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as taskModel from "../src/lib/workItemModel.ts"
import { submittedChecklistItems } from "../src/lib/qaChecklistModel.ts"

// Render the real task, NCR and inspection controls with isolated hooks and read-only fixture queries.
const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
const contexts = new Map()
let context, tree
globalThis.__taskNavHooks = {
  useState(initial) {
    const owner = context, index = owner.cursor++
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial
    return [owner.slots[index], value => { owner.slots[index] = typeof value === "function" ? value(owner.slots[index]) : value }]
  },
  useRef(initial) { const index = context.cursor++; return context.slots[index] ??= { current: initial } },
  useId: () => "task-navigation",
  useMemo: fn => fn(), useCallback: fn => fn,
  useEffect(fn, deps) {
    const owner = context, index = owner.cursor++, previous = owner.effects[index]
    if (!previous || deps.some((value, i) => value !== previous.deps[i])) owner.jobs.push(() => {
      previous?.cleanup?.()
      owner.effects[index] = { deps, cleanup: fn() }
    })
  },
}
const listeners = new EventTarget()
globalThis.PopStateEvent = class extends Event {}
globalThis.sessionStorage = { setItem() {} }
globalThis.window = {
  location: new URL("https://buildtrack.test/foreman/issues?project=project&item=floor&tasktab=corrections"),
  history: {
    pushState(_state, _title, path) { window.location = new URL(path, window.location) },
    replaceState(_state, _title, path) { window.location = new URL(path, window.location) },
  },
  scrollTo() {},
  addEventListener: (...args) => listeners.addEventListener(...args),
  removeEventListener: (...args) => listeners.removeEventListener(...args),
  dispatchEvent: event => listeners.dispatchEvent(event),
}
const project = { id: "project", name: "Test project", code: "TEST" }
const item = { id: "floor", pin_id: "pin", text: "DINING-FLOOR", review_status: "returned", review_inspection_id: "inspection", remark: "Keep this saved evidence" }
const pin = { id: "pin", project_id: project.id, title: "Dining area", assigned_to: "foreman", status: "in_progress" }
const inspection = { id: "inspection", project_id: project.id, pin_id: pin.id, number: 14, title: pin.title, status: "failed", trade: "general", standards: [], score: 50 }
const defect = { id: "ncr", project_id: project.id, pin_id: pin.id, inspection_id: inspection.id, number: 11, title: "Wall layout", status: "in_progress", severity: "major", trade: "general", category: "workmanship", assigned_to: "foreman" }
const submission = { item_ids: [item.id], checklist_snapshot: [{ ...item, done: true }] }
const task = {
  item, pin, photos: [], defects: [defect], draft: null, pinItems: [item], qa: {}, reload: async () => {},
  history: { submissions: [submission], inspections: [inspection], attempts: [], events: [], loading: false },
  stage: { view: { stage: "correction", action: "start_correction", owner: "Foreman" }, current: inspection, attempts: [], ncrs: [defect] },
}
const empty = { loading: false, error: "", reload: async () => {} }
let taskStatus = { ...empty, items: [item] }
const deps = globalThis.__taskNavDeps = {
  ...taskModel, submittedChecklistItems,
  useAuth: () => ({ profile: { id: "foreman", role: "foreman", status: "active" } }),
  useWorkItem: () => task, useProject: () => ({ project }), useProjectTeam: () => ({ team: [] }),
  useSettings: () => ({ settings: {} }), useTemplates: () => ({ templates: [] }),
  usePinTypeAccess: () => ({ canAct: true, viewOnly: false }), useDefectHistory: () => [],
  useToast: () => ({ success() {}, error() {} }), useConfirm: () => async () => false,
  useDefectEvents: () => ({ ...empty, events: [] }), useQaPhotos: () => ({ ...empty, photos: [] }),
  useCorrectionInspection: () => ({ ...empty, id: null }), correctionCloseProblem: () => "",
  useInspectionItems: () => ({ ...empty, items: [], setItems() {} }),
  useWorkSubmission: () => ({ ...empty, submission }), useReinspectionContext: () => ({ ...empty, rows: [] }),
  useChecklist: () => taskStatus,
  usePinQa: () => ({ state: {}, preflight: async () => null }), useInspectionTimeline: () => ({ ...empty, events: [] }),
  previewScore: () => ({ result: "failed", score: 50, passed: 1, failed: 1, pending: 0, na: 0 }),
  manilaToday: () => "2026-10-31", formatStamp: value => value,
  dueState: () => ({ state: "none" }), dueText: () => "No due date", photoEligible: () => true,
  tradeLabels: { general: "General" }, categoryLabels: { workmanship: "Workmanship" },
  defectStatusLabels: { in_progress: "In progress" }, defectTone: {}, inspectionTone: {}, inspectionStatusLabels: { failed: "Failed" },
  refNumber: (kind, number) => `${kind.toUpperCase()}-${number}`,
  supabase: {
    from(table) {
      const result = { data: table === "pin_qa_submissions" ? submission : [], error: null }
      return {
        select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
        maybeSingle: async () => result,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      }
    },
  },
}
async function compile(file) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (declaration.importClause.name) exports.push(`export default function ${declaration.importClause.name.text}(){return null}`)
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__taskNavHooks" : "__taskNavDeps"}.${key} ?? function ${key}(){return null}`)
    }
    output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(url(exports.join(";") + `\n// ${file}`))}`)
  }
  output = output.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
  return import(url(output))
}
const render = (key, Component, props) => {
  if (!contexts.has(key)) contexts.set(key, { slots: [], effects: [], jobs: [], cursor: 0 })
  context = contexts.get(key); context.cursor = 0
  tree = Component(props)
  const jobs = context.jobs.splice(0); jobs.forEach(fn => fn())
  return tree
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children), ...all(node.props.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected navigation control"); return node }
const settle = () => new Promise(resolve => setImmediate(resolve))
deps.followLink = (await compile("../src/lib/notifications.ts")).followLink
const Workspace = (await compile("../src/components/qa/WorkItemWorkspace.tsx")).default
const Detail = (await compile("../src/components/qa/DefectDetail.tsx")).default
const Inspection = (await compile("../src/components/qa/InspectionDetail.tsx")).default
const workspaceProps = { itemId: item.id, onClose() {} }
const openWorkspace = () => render("workspace", Workspace, workspaceProps)
const correctionsVisible = () => assert.equal(find(node => node.props?.role === "tabpanel" && node.props.id.endsWith("-panel-corrections")).props.hidden, false)

openWorkspace(); openWorkspace(); correctionsVisible()
find(node => node.props?.role === "tab" && text(node) === "Evidence").props.onClick()
openWorkspace()
find(node => node.type?.name === "NcrRow").props.onOpen()
openWorkspace()
const ncrProps = find(node => node.props?.defect?.id === defect.id && node.props.project).props
render("ncr", Detail, ncrProps); await settle(); render("ncr", Detail, ncrProps)
assert.doesNotMatch(text(tree), /Correct this NCR from its task|One correction form re-submits|Open the correction form:/)
const before = window.location.href
find(node => node.type === "button" && text(node) === `Open task: ${item.text}`).props.onClick()
assert.equal(window.location.href, before, "Regression: this is deliberately navigation to the identical task URL")
openWorkspace(); correctionsVisible()
assert.ok(!all(tree).some(node => node.props?.defect?.id === defect.id && node.props.project), "The NCR dialog must close")
assert.ok(all(tree).some(node => node.props?.formId && node.props.item === item), "The task's correction form is available")
assert.equal(item.remark, "Keep this saved evidence", "Navigation does not change saved evidence")

find(node => node.props?.role === "tab" && text(node) === "Inspection").props.onClick()
openWorkspace()
find(node => node.type?.name === "CurrentInspection").props.onOpen()
openWorkspace()
const inspectionProps = find(node => node.props?.inspection?.id === inspection.id && node.props.project).props
render("inspection", Inspection, inspectionProps)
find(node => node.type === "button" && text(node) === "Open the correction form").props.onClick()
openWorkspace(); correctionsVisible()
assert.ok(!all(tree).some(node => node.props?.inspection?.id === inspection.id && node.props.project), "The inspection dialog must close")

window.history.replaceState({}, "", "/foreman/quality-control?project=project")
let closed = false
render("standalone", Inspection, { ...inspectionProps, onClose() { closed = true } })
find(node => node.type === "button" && text(node) === "Open the correction form").props.onClick()
assert.ok(closed, "Standalone inspection closes before navigating to Corrections")
assert.equal(window.location.pathname, "/foreman/issues")
assert.equal(taskModel.readWorkItemTab(window.location.search, item.id), "corrections")
assert.equal(taskModel.readWorkItemTab(window.location.search, "other-task"), null)
assert.equal(taskModel.readWorkItemTab("?item=floor&tasktab=invalid", item.id), null)

// An old failed inspection must not invite another correction once its task has moved to reinspection or completion.
const formButton = () => all(tree.props.footer).find(node => node.type === "button" && text(node) === "Open the correction form")
for (const current of [
  { ...item, review_status: "for_review", review_inspection_id: "reinspection" },
  { ...item, review_status: "verified" },
  { ...item, review_status: "returned", review_inspection_id: "reinspection" },
]) {
  taskStatus = { ...empty, items: [current] }
  render("visibility", Inspection, inspectionProps)
  assert.ok(!formButton(), "Submitted, completed and superseded correction requests hide the form button")
  assert.ok(all(tree).some(node => node.type === "button" && text(node) === `${inspection.title} → ${item.text}`), "The task's read/navigation link stays available")
}
render("visibility", Inspection, { ...inspectionProps, inspection: { ...inspection, id: "reinspection" } })
assert.ok(formButton(), "If the latest reinspection fails, its own task can be corrected again")
for (const status of [{ ...empty, items: [] }, { ...empty, items: [item], loading: true }]) {
  taskStatus = status
  render("visibility", Inspection, inspectionProps)
  assert.ok(!formButton(), "Missing or loading task status cannot show a stale correction action")
}
let retried = 0
taskStatus = { ...empty, items: [item], error: "Task status unavailable", reload: async () => { retried++ } }
render("visibility", Inspection, inspectionProps)
assert.ok(!formButton())
find(node => node.type === "button" && text(node) === "Retry task status").props.onClick()
assert.equal(retried, 1)

// In a batch request, skip a task already resubmitted and open the one that still needs correction.
const wall = { ...item, id: "wall", text: "WALL" }
submission.item_ids.push(wall.id)
submission.checklist_snapshot.push({ ...wall, done: true })
taskStatus = { ...empty, items: [{ ...item, review_status: "for_review", review_inspection_id: "reinspection" }, wall] }
render("visibility", Inspection, inspectionProps)
assert.ok(formButton())
formButton().props.onClick()
assert.equal(new URLSearchParams(window.location.search).get("item"), wall.id, "Open only the task still returned on this inspection")

const { useItemParam } = await compile("../src/lib/workItem.ts")
const [, closeTask] = render("item-link", useItemParam)
closeTask(null)
assert.equal(window.location.search, "?project=project", "Closing removes the task's section hint as well as its id")
for (const owner of contexts.values()) for (const effect of owner.effects) effect?.cleanup?.()
console.log("Task navigation: NCR/inspection links open Corrections; submitted/completed/obsolete requests hide the correction button; latest failed retries, mixed batches, loading/error retry, record access and saved evidence retained; redundant NCR panel removed")
