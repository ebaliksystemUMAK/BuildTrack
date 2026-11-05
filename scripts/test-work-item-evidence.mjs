import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { itemAttempts, pinLevelDefects, irRef, ncrRef, completionProblem } from "../src/lib/workItemModel.ts"
import { correctionCloseProblem } from "../src/lib/qaReinspectionModel.ts"
import { submittedChecklistItems } from "../src/lib/qaChecklistModel.ts"
import { photoPreviewBlocked } from "../src/lib/photoStamp.ts"

const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let values = [], cursor = 0, tree, testProject = null, testRole = "engineer"
globalThis.__evidenceHooks = {
  useState(initial) { const n = cursor++; if (!(n in values)) values[n] = typeof initial === "function" ? initial() : initial; return [values[n], value => { values[n] = typeof value === "function" ? value(values[n]) : value }] },
  useRef(initial) { const n = cursor++; return values[n] ??= { current: initial } },
  useMemo: fn => fn(), useEffect() {}, useId: () => "evidence-test",
}
globalThis.__evidenceDeps = {
  itemAttempts, submittedChecklistItems, pinLevelDefects, irRef, ncrRef, photoPreviewBlocked,
  formatStamp: value => value, inputClass: "input", inspectionTone: { passed: "good", failed: "bad" },
  inspectionStatusLabels: { passed: "Passed", failed: "Failed" }, defectTone: { closed: "good" }, defectStatusLabels: { closed: "Closed" },
  useAuth: () => ({ profile: { id: testRole, role: testRole, status: "active" } }),
  useToast: () => ({}), useConfirm: () => () => false, useProject: () => ({ project: testProject }),
  useProjectTeam: () => ({ team: [{ user_id: "foreman", full_name: "Test Foreman" }] }), useSettings: () => ({ settings: {} }),
  useTemplates: () => ({ templates: [] }), completionProblem, manilaToday: () => "2026-10-26",
}
async function compile(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8")
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (declaration.importClause.name) exports.push(name === "./SubmittedEvidence" ? "export default globalThis.__submittedEvidenceUI" : name === "./EvidenceCompare" ? "export default globalThis.__evidenceCompareUI" : name === "./InspectionEvidenceComparisons" ? "export default globalThis.__inspectionCompareUI" : "export default function Stub(){return null}")
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__evidenceHooks" : "__evidenceDeps"}.${key} ?? function Stub(){return null}`)
    }
    output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(url(exports.join(";") + `\n// isolated bindings for ${path}`))}`)
  }
  output = output.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
  return (await import(url(output))).default
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected evidence control"); return node }
function render(Component, props) { cursor = 0; tree = Component(props); return tree }
const reset = () => { values = []; cursor = 0 }
const photo = (id, item = "floor") => ({ id, checklist_item_id: item, path: `${id}.jpg`, caption: null, uploaded_by: "foreman", created_at: "2026-10-20T01:00:00Z", stamp_flag: "at_site" })
const submission = (id, inspection, remark, photos = [photo(id)]) => ({ id, pin_id: "pin", inspection_id: inspection, item_ids: ["floor"], submitted_by: "foreman", submitted_at: "2026-10-20T02:00:00Z", checklist_snapshot: [{ id: "floor", text: "FLOOR", done: false, remark, remark_at: "2026-10-20T01:30:00Z" }, { id: "wall", text: "WALL", done: true, remark: "Other item's private remark" }], photos_snapshot: photos })
const original = submission("original", "ir-1", "Original floor remark", [photo("one"), photo("wall", "wall")])
const corrected = submission("corrected", "ir-2", "Corrected floor remark", [photo("two")])
const inspections = [{ id: "ir-1", number: 1, status: "failed" }, { id: "ir-2", number: 2, status: "passed" }]
const props = { pinId: "pin", itemId: "floor", submissions: [original], inspections, loading: false, error: "", nameOf: () => "Test Foreman" }
const Evidence = await compile("../src/components/qa/SubmittedEvidence.tsx")
globalThis.__submittedEvidenceUI = Evidence
globalThis.__evidenceCompareUI = await compile("../src/components/qa/EvidenceCompare.tsx")
let comparisonHistory = { submissions: [original, corrected], inspections, loading: false, error: "" }
globalThis.__evidenceDeps.useWorkQaHistory = () => comparisonHistory
const RequestComparisons = await compile("../src/components/qa/InspectionEvidenceComparisons.tsx")
globalThis.__inspectionCompareUI = RequestComparisons
const selectedRequest = { id: "ir-2", pin_id: "pin", status: "requested" }
const later = submission("later", "ir-3", "Later request", [photo("later-photo")])
comparisonHistory = { ...comparisonHistory, submissions: [later, corrected, original, { ...original, id: "foreign", pin_id: "foreign" }], inspections: [...inspections, { id: "ir-3", number: 3, status: "requested" }] }
reset(); render(RequestComparisons, { inspection: selectedRequest })
let requestComparison = find(node => node.type === globalThis.__evidenceCompareUI)
assert.deepEqual(requestComparison.props.attempts.map(row => row.id), ["original", "corrected"], "Pending QA compares the selected request, never newer submissions or another pin")
tree = requestComparison.type(requestComparison.props)
assert.equal(find(node => node.props?.after).props.after.path, "two.jpg")
assert.equal(find(node => node.props?.after).props.labels[1], "This request")
render(RequestComparisons, { inspection: { ...selectedRequest, status: "in_progress" } })
assert.ok(all(tree).some(node => node.type === globalThis.__evidenceCompareUI), "Starting inspection must not hide comparison")
render(RequestComparisons, { inspection: { ...selectedRequest, id: "ir-1" } })
assert.ok(!all(tree).some(node => node.type === globalThis.__evidenceCompareUI), "An original request must not borrow correction photos from the future")
comparisonHistory = { ...comparisonHistory, error: "History unavailable" }
render(RequestComparisons, { inspection: selectedRequest }); assert.match(text(tree), /History unavailable/)
assert.ok(!all(tree).some(node => node.type === globalThis.__evidenceCompareUI), "History errors must not display stale comparisons")
comparisonHistory = { ...comparisonHistory, error: "", loading: true }
render(RequestComparisons, { inspection: selectedRequest }); assert.match(text(tree), /Loading original/)
comparisonHistory = { ...comparisonHistory, loading: false }
const grid = () => find(node => node.props?.bucket === "pin-photos" && Array.isArray(node.props.photos))
render(Evidence, props)
assert.match(text(tree), /Original floor remark/)
assert.match(text(tree), /Original request · IR-0001/)
assert.match(text(tree), /2026-10-20T02:00:00Z.*Test Foreman/)
assert.match(text(tree), /Remark saved 2026-10-20T01:30:00Z/)
assert.equal(grid().props.photos.length, 1, "A single saved photo must be displayed without requiring a comparison")
assert.equal(grid().props.photos[0].id, "one")
assert.equal(grid().props.photos[0].recordState, "snapshot")
assert.equal(grid().props.photos[0].checklist.remark, "Original floor remark")
assert.equal(grid().props.onRemove, undefined, "Submitted evidence cannot be deleted")
assert.doesNotMatch(text(tree), /Other item's private remark/)
assert.ok(!all(tree).some(node => node.type === "select"))
const multiple = { ...props, submissions: [corrected, original, { ...original, id: "outsider", pin_id: "other", checklist_snapshot: [{ ...original.checklist_snapshot[0], remark: "Wrong pin" }] }] }
render(Evidence, multiple)
assert.match(text(tree), /Corrected floor remark/)
assert.match(text(tree), /Resubmission 1 · IR-0002/)
assert.equal(grid().props.photos[0].id, "two")
find(node => node.type === "select").props.onChange({ target: { value: original.id } })
render(Evidence, multiple)
assert.match(text(tree), /Original floor remark/); assert.doesNotMatch(text(tree), /Corrected floor remark|Wrong pin/)
assert.equal(grid().props.photos[0].id, "one", "Switching requests keeps photo and remark snapshots together")
render(Evidence, { ...multiple, itemId: "wall" })
assert.equal(all(tree).filter(node => node.props?.bucket).length, 0, "Explicit item IDs exclude unfinished/unsubmitted legacy snapshot entries")
reset(); render(Evidence, { ...props, submissions: [{ ...original, photos_snapshot: [], checklist_snapshot: [{ ...original.checklist_snapshot[0], remark: null }] }] })
assert.match(text(tree), /No Foreman remark recorded/); assert.equal(grid().props.photos.length, 0)
reset(); render(Evidence, { ...props, loading: true }); assert.match(text(tree), /Loading submitted evidence/)
render(Evidence, { ...props, error: "Cannot load QA history" }); assert.match(text(tree), /Cannot load QA history/); assert.ok(!all(tree).some(node => node.props?.bucket))
render(Evidence, { ...props, submissions: [] }); assert.match(text(tree), /No submitted evidence yet/)

const data = { item: { id: "floor", text: "FLOOR", review_status: "for_review" }, pin: { id: "pin", project_id: "project", assigned_to: "foreman", title: "Kitchen" }, photos: [], defects: [], history: { ...props, attempts: [], events: [] }, qa: {}, stage: { view: { stage: "passed", action: "complete" }, current: inspections[1], ncrs: [], attempts: itemAttempts("floor", [original], inspections) } }
globalThis.__evidenceDeps.useWorkItem = () => data
const Workspace = await compile("../src/components/qa/WorkItemWorkspace.tsx")
reset(); render(Workspace, { itemId: "floor", onClose() {} })
assert.ok(all(tree).some(node => node.type === Evidence), "Workspace embeds the saved gallery instead of directing users away")
assert.match(text(tree), /No NCR recorded for FLOOR/)
assert.match(text(tree), /No NCR correction is required/)
assert.doesNotMatch(text(tree), /Submitted photos and remarks are kept.*Attempts/)
find(node => node.props?.role === "tab" && text(node) === "Evidence").props.onClick()
render(Workspace, { itemId: "floor", onClose() {} })
assert.equal(find(node => node.props?.id === "evidence-test-panel-evidence").props.hidden, false)
let comparison = find(node => node.props?.draftPhotos)
assert.equal(comparison.type(comparison.props), null, "One request is not a before/after comparison")
const compareComponent = comparison.type
tree = compareComponent({ ...comparison.props, attempts: [original, corrected] })
assert.equal(find(node => node.props?.before).props.before.path, "one.jpg")
assert.equal(find(node => node.props?.after).props.after.path, "two.jpg", "Keep the interactive comparison for corrected photos")
assert.equal(compareComponent({ ...comparison.props, attempts: [original, { photos_snapshot: [photo("blocked", "floor")] }], draftPhotos: [ { ...photo("bad"), stamp_flag: "clock_ahead" } ], role: "engineer" }), null, "Comparison must preserve Engineer photo restrictions")
data.error = "Could not load NCRs"
render(Workspace, { itemId: "floor", onClose() {} })
assert.match(text(tree), /NCR information is unavailable/); assert.doesNotMatch(text(tree), /No NCR recorded/)
data.error = ""; data.stage.ncrs = [{ id: "closed", number: 3, status: "closed", title: "Old defect" }]
render(Workspace, { itemId: "floor", onClose() {} })
assert.match(text(tree), /0 open · 1 closed/)
assert.ok(all(tree).some(node => node.props?.defect?.id === "closed"), "Closed NCRs remain available")
// Engineer NCR decisions live only inside the opened record, never on the checklist summary.
const finding = { id: "ncr-9", project_id: "project", pin_id: "pin", number: 9, status: "for_verification", title: "Repair to verify", severity: "major", trade: "general", category: "workmanship", corrective_action: "Corrected and measured", correction_attempt_id: "correction-1" }
data.stage.ncrs = [finding]; data.defects = [finding]
data.stage.view = { stage: "passed", action: "review_ncrs" }
testProject = { id: "project", name: "Test project", code: "T" }
reset(); render(Workspace, { itemId: "floor", onClose() {} })
assert.doesNotMatch(text(tree.props.footer), /Review NCR corrections|Return FLOOR/)
assert.ok(all(tree.props.footer).find(node => node.type === "button" && text(node) === "Complete task")?.props.disabled, "Open NCR still blocks checklist completion")
let row = find(node => node.props?.defect?.id === finding.id && typeof node.props.onOpen === "function")
tree = row.type(row.props)
assert.ok(!all(tree).some(node => node.type === "textarea" || node.type === "form"), "No inline correction-decision textbox")
assert.doesNotMatch(text(tree), /Your decision on the correction|Send back|Close NCR/)
find(node => node.type === "button" && text(node) === "Open NCR record").props.onClick()
render(Workspace, { itemId: "floor", onClose() {} })
const opened = find(node => node.props?.defect?.id === finding.id && node.props.canVerify === true)
assert.equal(opened.props.defect, finding, "Opens the exact selected NCR with Engineer verification rights")

// Package NCRs start the exact linked reinspection from the footer; sign-off closes passing findings.
let readiness = { id: "ir-2", number: 2, status: "passed", ready: true, loading: false, error: "", reload: async () => {} }
let inspectionOpened = "", verificationCalls = [], verifiedRefreshes = 0, confirmDecision = true, verificationError = ""
let startCalls = [], startError = "", startWait = null, ncrRefreshes = 0
const settleAction = () => new Promise(resolve => setImmediate(resolve))
const footerAction = label => { const node = all(tree.props.footer).find(node => node.type === "button" && text(node) === label); assert.ok(node, `Expected footer action: ${label}`); return node }
Object.assign(globalThis.__evidenceDeps, {
  correctionCloseProblem, useCorrectionInspection: () => readiness,
  useDefectEvents: () => ({ events: [], reload: async () => {} }),
  useQaPhotos: () => ({ photos: [], reload: async () => {} }),
  dueState: () => ({ state: "ok" }), dueText: () => "Due in 2 days",
  refNumber: (kind, number) => kind === "ncr" ? ncrRef(number) : irRef(number),
  tradeLabels: { general: "General" }, categoryLabels: { workmanship: "Workmanship" },
  useConfirm: () => async () => confirmDecision, useToast: () => ({ success() {}, error() {} }),
  qaActions: {
    verifyDefect: async (...args) => { verificationCalls.push(args); return verificationError ? { ok: false, message: verificationError } : { ok: true } },
    start: async id => { startCalls.push(id); if (startWait) await startWait; return startError ? { ok: false, message: startError } : { ok: true } },
  },
  followLink: path => { inspectionOpened = path },
})
const Detail = await compile("../src/components/qa/DefectDetail.tsx")
const detailProps = { ...opened.props, onChanged: async () => { ncrRefreshes++ }, onOpenInspection: id => { inspectionOpened = id } }
reset(); render(Detail, detailProps)
assert.ok(!all(tree).some(node => node.type === "textarea" && node.props.id === "d-note"))
assert.doesNotMatch(text(tree), /Verify the corrected work|Verification note|Send back|Close NCR/)
assert.doesNotMatch(text(tree), /Open inspection/)
assert.ok(!all(tree.props.footer).some(node => text(node) === "Close window"))
footerAction("View inspection results").props.onClick(); await settleAction()
assert.equal(inspectionOpened, "ir-2", "Open inspection uses the correction reinspection, not the original failed request")
assert.equal(verificationCalls.length, 0, "Opening is read-only")
render(Detail, { ...detailProps, onOpenInspection: undefined })
footerAction("View inspection results").props.onClick(); await settleAction()
assert.match(inspectionOpened, /\/engineer\/qa\?project=project&tab=inspections&inspection=ir-2/)
readiness = { ...readiness, id: null, loading: true }; render(Detail, detailProps)
assert.ok(footerAction("View inspection results").props.disabled, "Never navigate to stale inspection data while loading")
readiness = { ...readiness, id: "ir-2", status: "requested", loading: false, ready: false }
reset(); render(Detail, detailProps)
assert.equal(footerAction("Start inspection").props.disabled,false)
const startButton=footerAction("Start inspection")
startButton.props.onClick(); startButton.props.onClick(); await settleAction()
assert.deepEqual(startCalls,["ir-2"],"Rapid clicks start only the exact correction inspection once")
assert.equal(inspectionOpened,"ir-2"); assert.equal(ncrRefreshes,1)
readiness = { ...readiness, status: "in_progress" }; reset(); render(Detail, detailProps)
footerAction("Continue inspection").props.onClick(); await settleAction()
assert.deepEqual(startCalls,["ir-2"],"Already started inspections are not started again")
readiness = { ...readiness, status: "requested" }; startError="Another Engineer already started this inspection"
inspectionOpened=""; reset(); render(Detail, detailProps)
footerAction("Start inspection").props.onClick(); await settleAction()
assert.equal(inspectionOpened,"","Server rejection never opens a falsely started inspection")
assert.equal(ncrRefreshes,1)
startError=""
for(const state of [{loading:true},{error:"Link unavailable"},{id:null}]) {
  const saved=readiness; readiness={...readiness,...state}; reset(); render(Detail,detailProps)
  assert.ok(footerAction("Start inspection").props.disabled)
  const count=startCalls.length; footerAction("Start inspection").props.onClick(); await settleAction(); assert.equal(startCalls.length,count)
  readiness=saved
}
for(const role of ["foreman","client","admin"]) {
  testRole=role; reset(); render(Detail,detailProps)
  assert.ok(footerAction("Start inspection").props.disabled,"Only an active Engineer starts corrections")
}
testRole="engineer"
let releaseStart
startWait=new Promise(resolve=>{releaseStart=resolve})
inspectionOpened=""; reset(); render(Detail,detailProps)
footerAction("Start inspection").props.onClick(); tree.props.onClose(); releaseStart(); await settleAction()
assert.equal(inspectionOpened,"","Closing with the header X prevents delayed navigation")
startWait=null

const actionButton = label => find(node => node.type === "button" && text(node) === label)
// Standalone NCRs have no linked correction inspection; their existing explicit closure path remains.
reset(); render(Detail, { ...detailProps, defect: { ...finding, correction_attempt_id: null } })
assert.ok(find(node => node.type === "textarea" && node.props.id === "d-note"))
assert.ok(actionButton("Close NCR").props.disabled)

// The real inspection screen has no pre-start NCR form; one remarks box accompanies sign-off.
let completionCalls = [], signoffConfirmation
let cancellationCalls = [], cancellationError = "", cancellationWait = null
let resumeCalls = [], resumeError = "", resumeWait = null
let historyRequests = []
let inspectionPreview = { result: "passed", score: 100, passed: 1, failed: 0, na: 0, pending: 0 }
Object.assign(globalThis.__evidenceDeps, {
  useInspectionItems: () => ({ items: [], loading: false, error: "", setItems() {}, reload: async () => {} }),
  useReinspectionContext: id => { historyRequests.push(id); return { rows: [], loading: false, error: "", reload: async () => {} } },
  useWorkSubmission: () => ({ submission: null, loading: false, error: "" }),
  useChecklist: () => ({ items: [], loading: false, error: "", reload: async () => {} }),
  usePinQa: () => ({ state: null, error: "" }), useInspectionTimeline: () => ({ events: [], error: "" }),
  previewScore: () => inspectionPreview,
  useConfirm: () => async options => { signoffConfirmation = options; return confirmDecision },
  qaActions: {
    start: async id => { resumeCalls.push(id); if(resumeWait) await resumeWait; return resumeError ? {ok:false,message:resumeError} : {ok:true} },
    complete: async (...args) => { completionCalls.push(args); return verificationError ? { ok: false, message: verificationError } : { ok: true, data: { result: "passed", score: 100, defects: 0 } } },
    cancel: async (...args) => { cancellationCalls.push(args); if(cancellationWait) await cancellationWait; return cancellationError ? {ok:false,message:cancellationError} : {ok:true} },
  },
})
const InspectionDetail = await compile("../src/components/qa/InspectionDetail.tsx")
const inspectionProps = { inspection: { id: "ir-2", project_id: "project", pin_id: "pin", status: "requested", reinspection_of: "ir-1", title: "Reinspection", number: 2, trade: "general", standards: [] }, project: testProject, weights: {}, threshold: 75,
  defects: [finding, { ...finding, id: "wrong-project", project_id: "foreign" }, { ...finding, id: "wrong-pin", pin_id: "another-pin" }, { ...finding, id: "closed", status: "closed" }],
  canInspect: true, canRequest: true, nameOf: () => "Engineer", onClose() {}, onChanged: async () => { verifiedRefreshes++ } }
const inspectionTabs=()=>all(tree).filter(node=>node.props?.role==="tab")
const tabPanel=key=>find(node=>node.props?.role==="tabpanel"&&node.props.id.endsWith(`-panel-${key}`))
const chooseTab=(label,props)=>{find(node=>node.props?.role==="tab"&&text(node)===label).props.onClick();render(InspectionDetail,props)}
reset(); render(InspectionDetail, inspectionProps)
assert.ok(!all(tree).some(node => node.type === RequestComparisons), "Comparison history loads only when evidence is opened")
chooseTab("Submitted evidence", inspectionProps)
assert.equal(find(node => node.type === RequestComparisons).props.inspection.status, "requested", "The actual pending inspection screen embeds the comparison")
reset(); render(InspectionDetail, inspectionProps)
assert.deepEqual(inspectionTabs().map(text),["QC Checklist","Submitted evidence","Previous results","Details & schedule","NCRs","History"])
assert.equal(historyRequests.at(-1),"ir-2","Even older/stage reinspections read their exact prior checks")
assert.equal(tabPanel("checklist").props.hidden,false)
assert.ok(all(tree).filter(node=>node.props?.role==="tabpanel"&&node.props.id!==tabPanel("checklist").props.id).every(node=>node.props.hidden))
for(const button of inspectionTabs()) {
  const panel=find(node=>node.props?.id===button.props["aria-controls"])
  assert.equal(panel.props["aria-labelledby"],button.props.id)
}
chooseTab("Previous results",inspectionProps)
assert.equal(tabPanel("previous").props.hidden,false);assert.equal(tabPanel("checklist").props.hidden,true)
assert.equal(find(node=>node.props?.fullChecklist!==undefined).props.fullChecklist,false,"Stage history is not described as full-checklist resubmission")
assert.ok(all(tree.props.footer).some(node=>text(node)==="Start inspection"),"Start stays accessible from Previous results")
let focused="",prevented=false
const keyboardTab=inspectionTabs()[2]
keyboardTab.props.onKeyDown({key:"End",preventDefault(){prevented=true},currentTarget:{parentElement:{querySelector(selector){focused=selector;return{focus(){}}}}}})
render(InspectionDetail,inspectionProps)
assert.ok(prevented);assert.match(focused,/-tab-history/);assert.equal(tabPanel("history").props.hidden,false)
assert.equal(inspectionTabs().filter(node=>node.props.tabIndex===0).length,1)
render(InspectionDetail,{...inspectionProps,inspection:{...inspectionProps.inspection,id:"other-request",reinspection_of:null}})
assert.ok(!inspectionTabs().some(node=>text(node)==="Previous results"))
assert.equal(tabPanel("checklist").props.hidden,false,"Another request always starts on Checklist")
assert.equal(historyRequests.at(-1),null,"Initial inspections do not request prior results")
reset();render(InspectionDetail,inspectionProps)
assert.ok(!all(tree).some(node => node.props?.defect && node.props?.inspection))
assert.ok(!all(tree).some(node => node.type === "textarea"), "No NCR textbox before inspection starts")
assert.doesNotMatch(text(tree), /Verification note|Send back|Close NCR/)
const activeProps = { ...inspectionProps, inspection: { ...inspectionProps.inspection, status: "in_progress", inspector_id: "engineer" } }
reset(); render(InspectionDetail, activeProps)
chooseTab("Previous results",activeProps)
assert.equal(tabPanel("previous").props.hidden,false,"Previous results remain available after Start")
assert.ok(all(tree.props.footer).some(node=>text(node)==="Complete inspection"))
inspectionPreview={...inspectionPreview,pending:1}
render(InspectionDetail,activeProps)
footerAction("Complete inspection").props.onClick();await settleAction();render(InspectionDetail,activeProps)
assert.equal(tabPanel("checklist").props.hidden,false,"Missing current results return the inspector to Checklist")
assert.equal(completionCalls.length,0)
inspectionPreview={...inspectionPreview,pending:0}
render(InspectionDetail,activeProps)
assert.equal(all(tree).filter(node => node.type === "textarea").length, 1)
assert.match(text(tree), /Remarks \(optional\).*close automatically/s)
find(node => node.type === "textarea").props.onChange({ target: { value: "Repaired wall checked on site" } }); render(InspectionDetail, activeProps)
chooseTab("Submitted evidence",activeProps)
assert.equal(tabPanel("checklist").props.hidden,true)
assert.equal(find(node=>node.props?.id==="qa-summary").props.value,"Repaired wall checked on site","Hidden checklist remains mounted with draft remarks")
assert.equal(all(tabPanel("evidence")).filter(node=>node.props?.record).length,1,"Submission gallery is isolated to its own panel")
chooseTab("Details & schedule",activeProps)
assert.equal(tabPanel("details").props.hidden,false)
assert.equal(all(tabPanel("details")).filter(node=>node.props?.inspection&&node.props.canEdit!==undefined).length,1)
chooseTab("QC Checklist",activeProps)
assert.equal(find(node=>node.props?.id==="qa-summary").props.value,"Repaired wall checked on site")
const signoff = async () => { all(tree.props.footer).find(node => text(node) === "Complete inspection").props.onClick(); await new Promise(resolve => setImmediate(resolve)) }
confirmDecision = false; await signoff(); assert.equal(completionCalls.length, 0)
assert.match(signoffConfirmation.message, /close automatically.*Failed or N\/A.*Task completion remains separate/s)
confirmDecision = true; await signoff()
assert.deepEqual(completionCalls, [["ir-2", "Repaired wall checked on site"]]); assert.equal(verifiedRefreshes, 1)
assert.equal(verificationCalls.length, 0, "No separate browser-side NCR mutation")
verificationError = "A required photo is missing"; await signoff(); assert.equal(verifiedRefreshes, 1, "A rejected atomic sign-off is not treated as successful")
verificationError = ""
for (const role of ["foreman", "admin", "client"]) { testRole = role; reset(); render(InspectionDetail, { ...activeProps, canInspect: false }); assert.ok(!all(tree).some(node => node.type === "textarea")) }
testRole = "engineer"; reset(); render(InspectionDetail, { ...activeProps, inspection: { ...activeProps.inspection, inspector_id: "another-engineer" } })
assert.ok(!all(tree).some(node => node.type === "textarea"), "Only the current inspector writes remarks")
reset(); render(InspectionDetail, { ...inspectionProps, inspection: { ...inspectionProps.inspection, status: "passed", summary: "Historical saved remarks" } })
assert.match(text(tree), /RemarksHistorical saved remarks/)

// Cancellation opens a focused confirmation instead of an off-screen inline form.
let cancelRefreshes=0
const cancelProps={...activeProps,onChanged:async()=>{cancelRefreshes++}}
const cancellationDialog=()=>find(node=>node.props?.title==="Cancel IR-0002?")
const dialogAction=label=>{const node=all(cancellationDialog().props.footer).find(node=>node.type==="button"&&text(node)===label);assert.ok(node);return node}
reset(); render(InspectionDetail,cancelProps)
footerAction("Cancel inspection").props.onClick(); render(InspectionDetail,cancelProps)
assert.equal(cancellationDialog().props.size,"md")
assert.ok(dialogAction("Cancel the inspection").props.disabled)
dialogAction("Cancel the inspection").props.onClick(); await settleAction(); assert.equal(cancellationCalls.length,0,"Handler rejects an empty reason")
find(node=>node.props?.id==="qa-cancel-reason").props.onChange({target:{value:"Keep this inspection"}}); render(InspectionDetail,cancelProps)
dialogAction("Keep inspection").props.onClick(); render(InspectionDetail,cancelProps)
assert.ok(!all(tree).some(node=>node.props?.title==="Cancel IR-0002?"));assert.equal(cancellationCalls.length,0)
footerAction("Cancel inspection").props.onClick(); render(InspectionDetail,cancelProps)
find(node=>node.props?.id==="qa-cancel-reason").props.onChange({target:{value:"  Fresh evidence must be provided  "}}); render(InspectionDetail,cancelProps)
const cancelButton=dialogAction("Cancel the inspection")
cancelButton.props.onClick();cancelButton.props.onClick();await settleAction()
assert.deepEqual(cancellationCalls,[["ir-2","Fresh evidence must be provided"]])
assert.equal(cancelRefreshes,1)
render(InspectionDetail,cancelProps);assert.ok(!all(tree).some(node=>node.props?.title==="Cancel IR-0002?"))
footerAction("Cancel inspection").props.onClick(); render(InspectionDetail,cancelProps)
find(node=>node.props?.id==="qa-cancel-reason").props.onChange({target:{value:"Retry this cancellation"}}); render(InspectionDetail,cancelProps)
cancellationError="Already signed off by another session"
dialogAction("Cancel the inspection").props.onClick();await settleAction();render(InspectionDetail,cancelProps)
assert.ok(cancellationDialog());assert.equal(cancelRefreshes,1,"Server failure keeps the form and does not report success")
assert.equal(find(node=>node.props?.id==="qa-cancel-reason").props.value,"Retry this cancellation")
assert.match(text(cancellationDialog()),/Already signed off by another session/)
cancellationError=""
render(InspectionDetail,{...cancelProps,inspection:{...cancelProps.inspection,status:"passed"}})
assert.ok(!all(tree).some(node=>node.props?.title==="Cancel IR-0002?"),"A completed inspection hides a stale cancel dialog")
assert.ok(!all(tree.props.footer).some(node=>text(node)==="Cancel inspection"))
reset();render(InspectionDetail,cancelProps)
footerAction("Cancel inspection").props.onClick();render(InspectionDetail,cancelProps)
find(node=>node.props?.id==="qa-cancel-reason").props.onChange({target:{value:"Cancel after fresh evidence review"}});render(InspectionDetail,cancelProps)
let releaseCancellation
cancellationWait=new Promise(resolve=>{releaseCancellation=resolve})
const pendingDialog=cancellationDialog(),keepWhilePending=dialogAction("Keep inspection")
dialogAction("Cancel the inspection").props.onClick()
keepWhilePending.props.onClick();pendingDialog.props.onClose();render(InspectionDetail,cancelProps)
assert.ok(cancellationDialog(),"Keep/header close cannot interrupt an already submitted cancellation")
assert.ok(find(node=>node.props?.id==="qa-cancel-reason").props.disabled)
releaseCancellation();await settleAction();cancellationWait=null
render(InspectionDetail,cancelProps)
assert.ok(!all(tree).some(node=>node.props?.title==="Cancel IR-0002?"))
testRole = "engineer"

// Cancelled initial requests and reinspections use the same confirmed, guarded continuation.
let resumeRefreshes=0
const resumeProps={...inspectionProps,inspection:{...inspectionProps.inspection,status:"cancelled"},onChanged:async()=>{resumeRefreshes++}}
reset();render(InspectionDetail,resumeProps)
assert.ok(footerAction("Continue inspection"));assert.ok(!all(tree.props.footer).some(node=>text(node)==="Complete inspection"))
confirmDecision=false
footerAction("Continue inspection").props.onClick();await settleAction()
assert.equal(resumeCalls.length,0)
assert.match(signoffConfirmation.message,/recorded QC checklist results.*original evidence.*newer submission/s)
confirmDecision=true
let releaseResume
resumeWait=new Promise(resolve=>{releaseResume=resolve})
const resumeButton=footerAction("Continue inspection")
resumeButton.props.onClick();resumeButton.props.onClick();await settleAction()
assert.deepEqual(resumeCalls,["ir-2"],"Double clicks cannot resume twice")
releaseResume();await settleAction();resumeWait=null
assert.equal(resumeRefreshes,1)
resumeError="A newer correction draft exists"
render(InspectionDetail,resumeProps);footerAction("Continue inspection").props.onClick();await settleAction()
assert.equal(resumeRefreshes,1,"Rejected continuation never reports a refresh/success")
resumeError=""
for(const role of ["foreman","client","admin"]) {
  testRole=role;reset();render(InspectionDetail,{...resumeProps,canInspect:false})
  assert.ok(!all(tree.props.footer).some(node=>text(node)==="Continue inspection"))
}
testRole="engineer";reset();render(InspectionDetail,{...resumeProps,inspection:{...resumeProps.inspection,reinspection_of:null}})
assert.ok(footerAction("Continue inspection"),"Initial inspections also continue")

// Hide Return after Pass, including a dialog opened before status changes; retain explicit Reopen for completed work.
data.stage.current = { ...inspections[1], status: "conditional" }
reset(); render(Workspace, { itemId: "floor", onClose() {} })
all(tree.props.footer).find(node => node.type === "button" && text(node) === "Return FLOOR").props.onClick()
render(Workspace, { itemId: "floor", onClose() {} })
assert.ok(all(tree).some(node => node.props?.name === "FLOOR" && typeof node.props.onSubmit === "function"))
data.stage.current = inspections[1]
render(Workspace, { itemId: "floor", onClose() {} })
assert.doesNotMatch(text(tree.props.footer), /Return FLOOR|Review NCR corrections/)
assert.ok(!all(tree).some(node => node.props?.name === "FLOOR" && typeof node.props.onSubmit === "function"), "Stale Return dialog disappears once Passed")
data.item.review_status = "verified"
reset(); render(Workspace, { itemId: "floor", onClose() {} })
assert.match(text(tree.props.footer), /Reopen FLOOR/)
for (const role of ["foreman", "admin", "client"]) {
  testRole = role
  reset(); render(Workspace, { itemId: "floor", onClose() {} })
  assert.doesNotMatch(text(tree.props.footer), /Return FLOOR|Reopen FLOOR|Complete task|Review NCR corrections/)
}

delete globalThis.__evidenceHooks; delete globalThis.__evidenceDeps; delete globalThis.__submittedEvidenceUI
console.log("Saved single-photo evidence/remarks, request selection, item/pin isolation, snapshots, empty/error states, NCR closure visibility and retained comparison/access guards passed")
console.log("Correction NCRs open the exact inspection; no pre-start NCR form; one reinspection remarks box saves on confirmed sign-off with server-error/role guards, no separate closure writes; standalone NCR/manual checklist flow retained")
console.log("NCR footer starts the exact correction once, resumes/reviews existing inspections and guards stale/denied/closed navigation; focused cancellation requires a reason, Keep is safe, failures retain input, duplicate cancellation is blocked")
console.log("Inspection section tabs: Checklist default, distinct mounted panels, preserved remarks, previous-results visibility before/during inspection, original/stage query scope, keyboard/ARIA links and request reset passed")
