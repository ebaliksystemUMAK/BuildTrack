import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { checklistProblem, trades, tradeLabels, severities, qaSeverityLabels } from "../src/lib/qaModel.ts"
import { completionProblem } from "../src/lib/workItemModel.ts"
import { pickableChecklists } from "../src/lib/qaChecklists.ts"
import { progressPercent, taskProgress } from "../src/lib/taskProgress.ts"
import { previousTaskProgress, reportDateLong, reportProgressKey } from "../src/lib/reportFormat.ts"
import { addDays } from "../src/lib/progress.ts"
import { clearTaskDraft, loadTaskDraft, storeTaskDraft, taskDraftKey } from "../src/lib/workChecklistDraft.ts"
import { clearQcDraft, loadQcDraft, storeQcDraft, qcDraftKey } from "../src/lib/qcChecklistDraft.ts"

// Real React component controls, isolated hooks and fake RPCs. No production fixtures or credentials.
let slots = [], cursor = 0, effects = [], tree, role = "foreman", calls = [], confirmation = true, saved = 0, preflightItem = null
const moduleUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
const draftStorage = new Map()
globalThis.localStorage = { getItem: key => draftStorage.get(key) ?? null, setItem: (key,value) => draftStorage.set(key,value), removeItem: key => draftStorage.delete(key) }
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
  checklistProblem, pickableChecklists, progressPercent, taskProgress, previousTaskProgress, reportDateLong, reportProgressKey, addDays, manilaToday: () => "2026-11-04", pinLevelDefects: () => [], completionProblem, supabase: fakeDb,
  clearTaskDraft, loadTaskDraft, storeTaskDraft,
  clearQcDraft, loadQcDraft, storeQcDraft, qcDraftKey, trades, tradeLabels, severities, qaSeverityLabels,
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
const progressReport = (id, date, percent, extra = {}) => ({ id, project_id: pin.project_id, report_date: date, status: "submitted", submitted_at: `${date}T12:00:00Z`, daily_report_entries: [{ id, pin_id: pin.id, item_id: item.id, percent }], ...extra })
const reported = [progressReport("old", "2026-11-02", 15), progressReport("new", "2026-11-03", 25), progressReport("draft", "2026-11-04", 90, { status: "draft" }), progressReport("returned", "2026-11-04", 80, { review_state: "returned" }), progressReport("elsewhere", "2026-11-04", 70, { project_id: "other" })]
render(PinChecklist, { pin, canEdit: true, canTick: false, reports: reported })
assert.match(text(tree), /Foreman reported: 25%/); assert.doesNotMatch(text(tree), /Foreman reported: (90|80|70)%/)
render(PinChecklist, { pin, canEdit: true, canTick: false, reports: [progressReport("complete", "2026-11-04", 100)] })
assert.match(text(tree), /Foreman reported: 100%/); assert.equal(item.review_status, "not_submitted", "100% reported cannot complete the task's QA")
assert.equal(taskProgress([item]).approved, 0, "Reported progress never enters the QA-approved total")
render(PinChecklist, { pin, canEdit: true, canTick: false, reports: [progressReport("zero", "2026-11-04", 0)] }); assert.match(text(tree), /Foreman reported: 0%/)
render(PinChecklist, { pin, canEdit: true, canTick: false, reports: reported, reportsLoading: true }); assert.match(text(tree), /Loading Foreman reported progress/); assert.doesNotMatch(text(tree), /Foreman reported: 25%/)
let retriedProgress = 0
render(PinChecklist, { pin, canEdit: true, canTick: false, reports: reported, reportsError: "Test error", onRetryReports: () => { retriedProgress++ } }); assert.match(text(tree), /progress is unavailable/); assert.doesNotMatch(text(tree), /Foreman reported: 25%/)
button("Retry reported progress").props.onClick(); assert.equal(retriedProgress, 1)
render(PinChecklist, { pin, canEdit: true, canTick: false, reports: reported.map(report => ({ ...report, daily_report_entries: report.daily_report_entries.map(entry => ({ ...entry, pin_id: "other-pin" })) })) }); assert.match(text(tree), /No submitted progress/)
role = "client"; render(PinChecklist, { pin, canEdit: false, canTick: false, reports: reported }); assert.doesNotMatch(text(tree), /Foreman reported/)
role = "engineer"
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
assert.equal(calls[0].payload.p_criteria[0].requires_photo, false, "New Engineer criteria allow inspection without a photo")
assert.doesNotMatch(text(tree), /Engineer must attach inspection evidence/)
assert.match(text(tree), /Engineer inspection photos are optional/)
assert.equal(saved, 1)

// A copied or previously editable criterion must not retain a hidden photo requirement after removing its checkbox.
template.project_id=pin.project_id;template.standards=[];template.work_item_criteria=false
template.qa_template_items[0].requires_photo=true
template.qa_template_items[0].hold_point=true
reset();calls=[];editor=ChecklistEditor({...editorProps,item});render(Editor,editor.props)
button("Save task and QC criteria").props.onClick();await new Promise(resolve=>setTimeout(resolve,0))
assert.equal(calls[0].payload.p_criteria[0].requires_photo,false,"Editing unsent Engineer criteria clears the old photo requirement")
assert.equal(calls[0].payload.p_criteria[0].hold_point,true,"Other QC requirements remain intact")
assert.equal(template.qa_template_items[0].requires_photo,true,"The source checklist is not changed")
reset();calls=[];editor=ChecklistEditor(editorProps);render(Editor,editor.props)
find(node=>node.type==="input"&&node.props.placeholder).props.onChange({target:{value:"Copied task"}})
find(node=>node.props?.["aria-label"]==="Copy criteria from project checklist").props.onChange({target:{value:template.id}})
render(Editor,editor.props)
button("Save task and QC criteria").props.onClick();await new Promise(resolve=>setTimeout(resolve,0))
assert.equal(calls[0].payload.p_criteria[0].requires_photo,false,"Copying an Admin/project checklist makes the Engineer's task inspection photo optional")
assert.equal(template.qa_template_items[0].requires_photo,true)
assert.equal(nodes(tree).filter(node=>node.type==="input"&&node.props.type==="checkbox").length,1,"Only the Hold point checkbox remains")
console.log("Direct QA: item/criteria atomic save controls, Open-only checklist rows, nested photo controls, no Ready tick, cancellation and saved-remark submission checks passed")

// Drafts persist synchronously, not only in a later React effect or a Close handler.
const draftScope={userId:"engineer",projectId:pin.project_id,pinId:pin.id,itemId:null}
const nameInput=()=>find(node=>node.type==="input"&&node.props.placeholder)
const openDraft=(props=editorProps)=>{reset();const outer=ChecklistEditor(props);render(Editor,outer.props);return outer.props}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0))
calls=[];const draftProps=openDraft()
nameInput().props.onChange({target:{value:"Draft tile task"}})
find(node=>node.type==="input"&&node.props.id?.endsWith("-test")).props.onChange({target:{value:"Tile layout"}})
// These writes survive even if a page exits before another render/effect.
assert.equal(loadTaskDraft(draftScope).draft.values.name,"Draft tile task")
assert.equal(loadTaskDraft(draftScope).draft.values.criteria[0].text,"Tile layout")
button("Close").props.onClick();assert.equal(calls.length,0,"A draft never creates an incomplete server task")
openDraft();assert.equal(nameInput().props.value,"Draft tile task");assert.match(text(tree),/Draft restored/)
assert.equal(button("Save task and QC criteria").props.disabled,true,"Incomplete passing requirements are retained but cannot be submitted")
const restarted=await import(new URL("../src/lib/workChecklistDraft.ts?reopened-browser",import.meta.url).href)
assert.equal(restarted.loadTaskDraft(draftScope).draft.values.criteria[0].text,"Tile layout","Restoration reads browser storage, not only module memory")
role="other-engineer";openDraft();assert.equal(nameInput().props.value,"")
role="engineer";openDraft({...editorProps,pin:{...pin,id:"another-pin"}});assert.equal(nameInput().props.value,"")
openDraft({...editorProps,pin:{...pin,project_id:"another-project"}});assert.equal(nameInput().props.value,"")
openDraft({...editorProps,item});assert.equal(nameInput().props.value,"FLOOR","Editing a saved task does not load the new-task draft")
openDraft();assert.equal(nameInput().props.value,"Draft tile task")
find(node=>node.type==="textarea"&&node.props.id?.endsWith("-pass")).props.onChange({target:{value:"Match the approved layout"}})
render(Editor,draftProps)
const originalRpc=fakeDb.rpc
fakeDb.rpc=async()=>({error:{message:"Connection rejected"}})
button("Save task and QC criteria").props.onClick();await settle()
openDraft();assert.equal(nameInput().props.value,"Draft tile task","Failed server saves keep the draft")
fakeDb.rpc=originalRpc
confirmation=false;button("Discard draft").props.onClick();await settle();assert.ok(loadTaskDraft(draftScope).draft)
confirmation=true;button("Discard draft").props.onClick();await settle();render(Editor,draftProps)
assert.equal(nameInput().props.value,"");assert.equal(loadTaskDraft(draftScope).draft,null)
nameInput().props.onChange({target:{value:"Task after discard"}})
find(node=>node.type==="input"&&node.props.id?.endsWith("-test")).props.onChange({target:{value:"Tile layout"}})
find(node=>node.type==="textarea"&&node.props.id?.endsWith("-pass")).props.onChange({target:{value:"Match the approved layout"}})
const failedRefreshProps={...draftProps,onSaved:async()=>{throw Error("Refresh failed")}}
render(Editor,failedRefreshProps);button("Save task and QC criteria").props.onClick();await settle()
assert.equal(loadTaskDraft(draftScope).draft,null,"A committed task clears its draft even when list refresh fails")
openDraft();assert.equal(nameInput().props.value,"")

// All unfinished criteria/options and citations survive. Optional Engineer photos stay optional.
const values={name:"Measured tile task",criteria:[{text:"Edge height",acceptance_criteria:"Within project tolerance",evidence_requirement:"Use a straightedge",reference:"Project spec",severity:"critical",kind:"measure",unit:"mm",min_value:"-",max_value:"3",requires_photo:true,hold_point:true}],standards:["TEST-CODE"],sourceTemplateId:template.id}
const stored=storeTaskDraft(draftScope,values)
const restored=loadTaskDraft(draftScope).draft.values
assert.equal(restored.criteria[0].min_value,"-","Partial numeric input is a valid draft")
assert.equal(restored.criteria[0].hold_point,true);assert.equal(restored.criteria[0].requires_photo,false)
assert.deepEqual(restored.standards,["TEST-CODE"])
openDraft();assert.equal(find(node=>node.props?.["aria-label"]==="Copy criteria from project checklist").props.value,template.id,"The copied checklist selection is restored too")
const newer=storeTaskDraft(draftScope,{...values,name:"Newer tab draft"})
assert.equal(clearTaskDraft(draftScope,stored.draft.revision),true)
assert.equal(loadTaskDraft(draftScope).draft.values.name,"Newer tab draft","An older save cannot remove a newer tab's draft")
clearTaskDraft(draftScope,newer.draft.revision)
const largeValues={name:"Full draft",standards:[],criteria:Array.from({length:60},()=>({...values.criteria[0],text:"\\".repeat(500),acceptance_criteria:"\\".repeat(1000),evidence_requirement:"\\".repeat(1000),reference:"\\".repeat(200)}))}
const largeDraft=storeTaskDraft(draftScope,largeValues)
assert.ok(draftStorage.get(taskDraftKey(draftScope)).length>300000)
assert.equal(loadTaskDraft(draftScope).draft.values.criteria.length,60,"All allowed criteria survive, including JSON-escaped content")
clearTaskDraft(draftScope,largeDraft.draft.revision)
const unfinished=storeTaskDraft(draftScope,{...values,criteria:[{...values.criteria[0],min_value:"9".repeat(200),unit:"An unfinished unit description"}]})
assert.equal(loadTaskDraft(draftScope).draft.values.criteria[0].min_value.length,200,"Drafts keep unfinished measurement input even when it needs correction before Save")
clearTaskDraft(draftScope,unfinished.draft.revision)
role=null;tree=ChecklistEditor(editorProps);assert.match(text(tree),/Sign in to restore/);role="engineer"
draftStorage.set(taskDraftKey(draftScope),"{broken json")
openDraft();assert.equal(nameInput().props.value,"");assert.match(text(tree),/Browser draft storage is unavailable/)
draftStorage.delete(taskDraftKey(draftScope))

// A real storage error retains in-app work and installs a browser-exit warning, rather than claiming it was saved.
const realStorage=globalThis.localStorage,realWindow=globalThis.window,listeners=new Map()
globalThis.window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)}
globalThis.localStorage={...realStorage,setItem(){throw Error("Quota exceeded")}}
openDraft();nameInput().props.onChange({target:{value:"Do not lose this task"}})
openDraft();assert.equal(nameInput().props.value,"Do not lose this task");assert.match(text(tree),/Browser draft storage is unavailable/)
let prevented=false
listeners.get("beforeunload")({preventDefault(){prevented=true}});assert.equal(prevented,true)
globalThis.localStorage=realStorage
nameInput().props.onChange({target:{value:"Storage recovered"}})
assert.equal(listeners.has("beforeunload"),false)
const recovered=loadTaskDraft(draftScope);assert.equal(recovered.persistent,true);assert.equal(recovered.draft.values.name,"Storage recovered")
clearTaskDraft(draftScope,recovered.draft.revision)
globalThis.window=realWindow
console.log("Task drafts: immediate persistence, browser reopen, close/navigation restoration, account/project/pin/item isolation, incomplete fields, discard, failed save/refresh, newer-draft protection and storage failure recovery passed")

// The QC checklist form shares draft storage, but keeps its own scope and all checklist requirements.
let qcResult={ok:true,data:"saved-checklist"},qcThrow=false,qcSaves=[],qcClosed=0,qcRefreshed=0,focusedItem="",scrolledItem=""
globalThis.__directQaDeps.qaActions.saveTemplate=async payload=>{qcSaves.push(payload);if(qcThrow)throw Error("Network request failed");return qcResult}
const {default:TemplateEditor}=await compile("../src/components/qa/TemplateEditor.tsx")
const qcProps={template:null,projectId:"project",standards:[{code:"TEST-QC",title:"Synthetic reference"}],onClose:()=>{qcClosed++},onSaved:async()=>{qcRefreshed++}}
const qcScope={userId:"engineer",projectId:"project",templateId:null}
let qcFormProps,QcForm
const renderQc=()=>{
  render(QcForm,qcFormProps)
  for(const node of nodes(tree))if(node.props?.ref&&node.type==="input")node.props.ref.current={focus(){focusedItem=node.props["aria-label"]},scrollIntoView(){scrolledItem=node.props["aria-label"]}}
  const jobs=effects;effects=[];jobs.forEach(fn=>fn())
}
const openQc=(props=qcProps)=>{reset();const outer=TemplateEditor(props);QcForm=outer.type;qcFormProps=outer.props;renderQc()}
const qcInput=label=>find(node=>node.props?.["aria-label"]===label)
openQc()
qcInput("Item 1 text").props.onChange({target:{value:"Tile layout"}})
qcInput("Item 1 acceptance criteria").props.onChange({target:{value:"Follow the approved plan"}})
assert.equal(loadQcDraft(qcScope).draft.values.name,"")
assert.equal(loadQcDraft(qcScope).draft.values.items[0].text,"Tile layout","Criteria survive before the checklist is named")
renderQc();button("Add item").props.onClick();renderQc()
assert.equal(focusedItem,"Item 2 text");assert.equal(scrolledItem,"Item 2 text")
const itemContainer=find(node=>node.type==="div"&&Array.isArray(node.props.children)&&node.props.children.some(child=>child?.type==="ol"))
assert.ok(itemContainer.props.children.findIndex(child=>child?.type==="ol")<itemContainer.props.children.findIndex(child=>child?.type==="button"&&text(child)==="Add item"),"Add item stays below the newest item")
qcInput("Item 2 text").props.onChange({target:{value:"Tile height"}})
qcInput("Item 2 type").props.onChange({target:{value:"measure"}});renderQc()
qcInput("Item 2 unit").props.onChange({target:{value:"mm"}})
qcInput("Item 2 lowest value").props.onChange({target:{value:"-"}})
qcInput("Item 2 highest value").props.onChange({target:{value:"3"}})
find(node=>node.props?.id==="t-trade").props.onChange({target:{value:"architectural"}})
find(node=>node.props?.id==="t-desc").props.onChange({target:{value:"Final tile inspection"}})
button("TEST-QC").props.onClick()
const secondRow=find(node=>node.type==="li"&&text(node).includes("Leave both empty")&&nodes(node).some(child=>child.props?.["aria-label"]==="Item 2 text"))
nodes(secondRow).filter(node=>node.type==="input"&&node.props.type==="checkbox").forEach(node=>node.props.onChange({target:{checked:true}}))
renderQc();button("Close").props.onClick();assert.equal(qcSaves.length,0)
openQc();assert.match(text(tree),/Draft restored/);assert.equal(qcInput("Item 2 lowest value").props.value,"-")
assert.equal(find(node=>node.props?.id==="t-trade").props.value,"architectural")
assert.equal(find(node=>node.props?.id==="t-desc").props.value,"Final tile inspection")
assert.equal(button("TEST-QC").props["aria-pressed"],true)
assert.equal(loadQcDraft(qcScope).draft.values.items[1].requires_photo,true,"Checklist photo requirements are preserved, unlike task-specific optional photos")
const reopenedQc=await import(new URL("../src/lib/qcChecklistDraft.ts?reopened-browser",import.meta.url).href)
assert.equal(reopenedQc.loadQcDraft(qcScope).draft.values.items.length,2)
openQc({...qcProps,projectId:"other-project"});assert.equal(qcInput("Item 1 text").props.value,"")
openQc({...qcProps,projectId:null});assert.equal(qcInput("Item 1 text").props.value,"")
role="other-engineer";openQc();assert.equal(qcInput("Item 1 text").props.value,"");role="engineer"
openQc({...qcProps,template:{...template,name:"Existing checklist"}});assert.equal(find(node=>node.props?.id==="t-name").props.value,"Existing checklist")
openQc();qcInput("Move item 2 up").props.onClick();renderQc();assert.equal(qcInput("Item 1 text").props.value,"Tile height")
qcInput("Move item 1 down").props.onClick();renderQc()
find(node=>node.props?.id==="t-name").props.onChange({target:{value:"Tile QC"}})
qcInput("Item 2 lowest value").props.onChange({target:{value:"0"}});renderQc()
qcResult={ok:false,message:"Permission denied"};button("Save QC checklist").props.onClick();await settle()
assert.ok(loadQcDraft(qcScope).draft,"A rejected save keeps all checklist draft fields")
openQc();qcThrow=true;button("Save QC checklist").props.onClick();await settle();assert.ok(loadQcDraft(qcScope).draft);qcThrow=false
openQc();confirmation=false;button("Discard draft").props.onClick();await settle();assert.ok(loadQcDraft(qcScope).draft)
confirmation=true;button("Discard draft").props.onClick();await settle();renderQc()
assert.equal(qcInput("Item 1 text").props.value,"");assert.equal(loadQcDraft(qcScope).draft,null)
qcInput("Item 1 text").props.onChange({target:{value:"Clean tile joints"}})
find(node=>node.props?.id==="t-name").props.onChange({target:{value:"Finishing QC"}});renderQc()
qcResult={ok:true,data:"saved-checklist"}
button("Save QC checklist").props.onClick();button("Save QC checklist").props.onClick();await settle()
assert.equal(qcSaves.length,3,"Pending saves block duplicate submission")
assert.equal(qcRefreshed,1);assert.equal(loadQcDraft(qcScope).draft,null)
openQc();assert.equal(qcInput("Item 1 text").props.value,"")
qcInput("Item 1 text").props.onChange({target:{value:"Fresh criterion"}})
find(node=>node.props?.id==="t-name").props.onChange({target:{value:"Fresh checklist"}})
qcFormProps={...qcFormProps,onSaved:async()=>{throw Error("Refresh failed")}};renderQc()
button("Save QC checklist").props.onClick();await settle();assert.equal(loadQcDraft(qcScope).draft,null,"A refresh failure cannot resurrect an already-saved checklist")

const qcValues={name:"Pending QC",trade:"architectural",description:"",cited:[],items:[{...values.criteria[0],requires_photo:true}]}
const firstQc=storeQcDraft(qcScope,qcValues),laterQc=storeQcDraft(qcScope,{...qcValues,name:"Newer QC draft"})
clearQcDraft(qcScope,firstQc.draft.revision);assert.equal(loadQcDraft(qcScope).draft.values.name,"Newer QC draft")
storeTaskDraft(draftScope,values);clearQcDraft(qcScope,laterQc.draft.revision)
assert.equal(loadTaskDraft(draftScope).draft.values.name,values.name,"QC cleanup cannot delete a task draft")
clearTaskDraft(draftScope,loadTaskDraft(draftScope).draft.revision)
const savedWindow=globalThis.window,qcListeners=new Map()
globalThis.window={addEventListener:(name,fn)=>qcListeners.set(name,fn),removeEventListener:name=>qcListeners.delete(name)}
globalThis.localStorage={...realStorage,setItem(){throw Error("Quota exceeded")}}
openQc();qcInput("Item 1 text").props.onChange({target:{value:"Keep this QC item"}})
openQc();assert.equal(qcInput("Item 1 text").props.value,"Keep this QC item");assert.match(text(tree),/Browser draft storage is unavailable/)
storeTaskDraft(draftScope,values)
globalThis.localStorage=realStorage
qcInput("Item 1 text").props.onChange({target:{value:"Recovered QC item"}})
assert.equal(qcListeners.has("beforeunload"),true,"A remaining task draft failure retains the shared browser-exit warning")
const fixedTask=storeTaskDraft(draftScope,values);assert.equal(qcListeners.has("beforeunload"),false)
clearTaskDraft(draftScope,fixedTask.draft.revision);clearQcDraft(qcScope,loadQcDraft(qcScope).draft.revision)
globalThis.window=savedWindow
role=null;tree=TemplateEditor(qcProps);assert.match(text(tree),/Sign in to restore/);role="engineer"
console.log("QC checklist drafts: all fields/options/order, unnamed criteria, reopen and scope isolation, shared storage failure recovery, safe save/discard, duplicate-save guard, and Add item below the list with new-item focus passed")
