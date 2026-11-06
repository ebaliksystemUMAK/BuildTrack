import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as model from "../src/lib/pinRecordsModel.ts"
import * as picker from "../src/lib/pinPickerModel.ts"
import * as qaModel from "../src/lib/qaModel.ts"
import { clientActionPath } from "../src/lib/clientPortalModel.ts"
import * as dateModel from "../src/lib/dateRangeModel.ts"
import * as sizeModel from "../src/lib/panelSize.ts"
import { blankEntry, carryForwardProgress, moveSummaryToTask, previousTaskProgress, reportEntries, sameWork } from "../src/lib/reportFormat.ts"
import { photosOutsideTasks } from "../src/lib/photoGalleryModel.ts"

// Pin records in the blueprint panel: the shared pin picker, each role's Issues & NCRs section (lists, next actions, create
// actions, which detail opens with which rights), Open on blueprint, reports / communication / photos sections and the
// per-pin loader (role-skipped tables, stale answers dropped). No network: hooks and data are stubbed.
const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], effects = [], pending = [], cursor = 0, tree
globalThis.__pinHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial } },
  useMemo: fn => fn(),
  useId: () => ":r1:",
  useCallback(fn, deps) { const n = cursor++, old = slots[n]; if (old && deps && deps.every((value, i) => value === old.deps[i])) return old.fn; slots[n] = { fn, deps }; return fn },
  useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  lazy(loader) { const component = function Lazy() { return null }; component.loader = String(loader); return component },
  Suspense: function Suspense({ children }) { return children },
}
const deps = globalThis.__pinDeps = {}
async function compile(file, real = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const replacements = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...real }
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (name in replacements) continue
    if (declaration.importClause.name) exports.push(`export default globalThis.__pinDeps[${JSON.stringify("default:" + name)}] ?? function ${declaration.importClause.name.text}(){return null}`)
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__pinHooks" : "__pinDeps"}.${key} ?? function ${key}(){return null}`)
    }
    replacements[name] = url(exports.join(";") + `\n// stub bindings for ${file}`)
  }
  for (const [name, replacement] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return import(url(output))
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const render = (Component, props = {}) => { cursor = 0; tree = Component(props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
const reset = () => { effects.forEach(effect => effect?.cleanup?.()); slots = []; effects = []; pending = [] }
const find = (predicate, message = "Expected pin record control") => { const node = all(tree).find(predicate); assert.ok(node, message); return node }
const named = name => node => typeof node?.type === "function" && node.type.name === name
const lazyOf = name => node => typeof node?.type === "function" && node.type.loader?.includes(name)
const buttonText = label => node => node.type === "button" && text(node).trim() === label

// ---------- Shared picker: project work pins, search, Project-wide only where allowed ----------
Object.assign(deps, { inputClass: "input", ...picker })
const Picker = (await compile("../src/components/ui/PinLinkPicker.tsx")).default
const pins = [
  { id: "p1", title: "Laundry", blueprint_id: "s1", project_id: "A", category: "progress", status: "in_progress" },
  { id: "p2", title: "Kitchen", blueprint_id: "s2", project_id: "A", category: "progress", status: "in_progress" },
  { id: "n1", title: "Note", blueprint_id: "s1", project_id: "A", category: "note", status: "not_started" },
  { id: "x1", title: "Foreign", blueprint_id: "sx", project_id: "B", category: "progress", status: "in_progress" },
]
const sheets = [{ id: "s1", title: "Ground floor", project_id: "A" }, { id: "s2", title: "Roof", project_id: "A" }, { id: "sx", title: "Other project", project_id: "B" }]
let changes = []
const pickerProps = (extra = {}) => ({ projectId: "A", sheets, pins, value: picker.emptyPinLink, onChange: link => changes.push(link), checklist: { items: [{ id: "i1", pin_id: "p1", text: "FLOOR" }], loading: false, error: "" }, ...extra })
render(Picker, pickerProps())
const selectOf = id => find(node => node.type === "select" && node.props.id === id)
const optionLabels = select => all(select.props.children).filter(node => node.type === "option").map(text)
assert.deepEqual(optionLabels(selectOf("r1-sheet")), ["All sheets", "Ground floor", "Roof"], "Only this project's sheets")
assert.deepEqual(optionLabels(selectOf("r1-pin")), ["Choose a work pin", "Kitchen · Roof", "Laundry · Ground floor"], "Work pins of this project only; no notes")
assert.equal(all(selectOf("r1-pin").props.children).find(node => node.type === "option").props.disabled, true, "A location record has no Project-wide choice")
assert.equal(selectOf("r1-item").props.disabled, true, "The checklist waits for a pin")
find(node => node.type === "input" && node.props.id === "r1-find").props.onChange({ target: { value: "laun" } })
render(Picker, pickerProps()); assert.deepEqual(optionLabels(selectOf("r1-pin")).slice(1), ["Laundry · Ground floor"]); assert.match(text(tree), /1 of 2 pins match "laun"/)
selectOf("r1-pin").props.onChange({ target: { value: "p1" } }); assert.deepEqual(changes.at(-1), { sheetId: "s1", pinId: "p1", itemId: "" })
reset(); render(Picker, pickerProps({ value: { sheetId: "s1", pinId: "p1", itemId: "i1" }, allowProjectWide: true }))
assert.equal(optionLabels(selectOf("r1-pin"))[0], "Project-wide (not one pin)")
assert.deepEqual(optionLabels(selectOf("r1-item")), ["Whole work pin (no specific item)", "FLOOR"])
selectOf("r1-sheet").props.onChange({ target: { value: "s2" } }); assert.deepEqual(changes.at(-1), { sheetId: "s2", pinId: "", itemId: "" }, "Another sheet clears pin and item")
reset(); render(Picker, pickerProps({ value: { sheetId: "s1", pinId: "p1", itemId: "" }, checklist: { items: [], loading: false, error: "offline", reload() { changes.push("retry") } } }))
find(buttonText("Retry")).props.onClick(); assert.equal(changes.at(-1), "retry")
console.log("Pin picker: project sheets and work pins only, search, dependent clearing, Project-wide only where allowed, checklist retry passed")

// ---------- Issues & NCRs section per role ----------
let opened = [], followed = [], fieldProblems = [], toasts = []
Object.assign(deps, {
  ...model, ...qaModel, ...dateModel, clientActionPath, openClientPath: path => opened.push(path), followLink: (path, project) => followed.push([path, project]),
  buttonPrimary: "primary", buttonSecondary: "secondary", severityLabels: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
  useProject: id => ({ project: id ? { id, name: "Project A", code: "A" } : null }), useSettings: () => ({ settings: { weights: { critical: 5, major: 3, minor: 1 }, threshold: 80 } }),
  manilaToday: () => "2026-10-24", useToast: () => ({ success: (...args) => toasts.push(["success", ...args]), error: (...args) => toasts.push(["error", ...args]), info() {} }),
  reportFieldProblem: async (...args) => { fieldProblems.push(args); return { ok: true } },
  useProjectPins: () => ({ pins, loading: false }), useBlueprints: () => ({ blueprints: sheets }),
})
const Sections = await compile("../src/components/editor/PinRecordSections.tsx")
const pin = { id: "p1", project_id: "A", blueprint_id: "s1", title: "Laundry", status: "in_progress", category: "progress", assigned_to: "fore" }
const team = [{ user_id: "eng", full_name: "Erin Engineer", role: "engineer" }, { user_id: "fore", full_name: "Frank Foreman", role: "foreman" }]
const defects = [
  { id: "d1", number: 1, status: "open", title: "Gap at threshold", pin_id: "p1", inspection_id: "ir1", inspection_item_id: "x", checklist_item_id: null, checklist_name: null, assigned_to: "fore", due_date: "2026-10-20" },
  { id: "d2", number: 2, status: "for_verification", title: "Crack", pin_id: "p1", inspection_id: null, checklist_item_id: "i1", checklist_name: "FLOOR", assigned_to: "fore", due_date: null },
  { id: "d3", number: 3, status: "open", title: "Stain", pin_id: "p1", inspection_id: null, checklist_item_id: null, checklist_name: null, assigned_to: null, due_date: null },
]
const inspections = [{ id: "ir1", number: 4, status: "failed", title: "Floor check", pin_id: "p1", requested_at: "2026-10-18T02:00:00Z", requested_by: "fore", inspector_id: "eng" }, { id: "ir2", number: 5, status: "requested", title: "Re-check", pin_id: "p1", requested_at: "2026-10-23T02:00:00Z", requested_by: "fore", inspector_id: null }]
const submissions = [{ inspection_id: "ir1", pin_id: "p1", item_ids: ["i1"], checklist_snapshot: [{ id: "i1", text: "FLOOR", done: true }] }]
const snags = [{ id: "s1", number: 7, status: "submitted", title: "Loose tile", fix_stage: null, defect_id: null, created_at: "2026-10-22T02:00:00Z" }]
const issues = [{ id: "is1", pin_id: "p1", checklist_item_id: "i1", checklist_name: "FLOOR", description: "Wet floor", severity: "high", raised_by: "eng", created_at: "2026-10-21T02:00:00Z" }]
const dataFor = (role, extra = {}) => {
  const records = { defects: role === "client" ? [] : defects, snags: role === "foreman" ? [] : snags, issues: role === "client" ? [] : issues, reports: [], questions: [], ...extra }
  const set = { defects: records.defects, inspections: role === "client" ? [] : inspections, snags: records.snags, issues: records.issues.length, questions: records.questions, reports: records.reports.length }
  return { records, set, counts: model.pinSectionCounts(role, set), loading: false, error: "", reload: async () => {}, history: { inspections: set.inspections, submissions, loading: false, error: "", reload: async () => {} }, checklist: { items: [{ id: "i1", pin_id: "p1", text: "FLOOR TILES" }] } }
}
const issuesFor = (role, extra = {}) => { reset(); const props = { pin, role, meId: role === "foreman" ? "fore" : role === "engineer" ? "eng" : "me", team, canEdit: role === "engineer", canWork: role === "foreman", data: dataFor(role), wide: true, ...extra }; render(Sections.PinIssuesSection, props); return props }
const actionsFor = (role, extra = {}) => issuesFor(role, { ...extra, view: "actions" })
const lists = () => all(tree).filter(named("RecordList")).map(node => node.props)
reset(); render(Sections.PinActionsSection, { pin, role: "foreman" })
assert.equal(find(named("PinIssuesSection")).props.view, "actions", "The new section reuses the canonical dialogs in actions-only mode")

let props = actionsFor("engineer")
assert.ok(find(buttonText("Log an issue")) && find(buttonText("Raise NCR")), "The Engineer logs issues and raises NCRs from the pin")
assert.ok(!all(tree).some(buttonText("Report a field problem")))
assert.ok(!all(tree).some(named("RecordList")) && !all(tree).some(named("RecordFilterBar")), "The actions tab contains no register or register filters")
props = issuesFor("engineer")
assert.ok(!all(tree).some(named("NextActions")) && !all(tree).some(buttonText("Log an issue")), "Records contain no next actions or creation buttons")
assert.deepEqual(lists().map(list => list.title), ["NCRs (non-conformances)", "Inspections and QA requests", "Site issues", "Client problem reports"])
const ncrRows = lists()[0].rows
assert.deepEqual(lists()[0].columns, ["NCR", "Problem", "Task", "Status", "Responsible", "Due", "Source"], "Detailed columns in the full view")
assert.deepEqual(ncrRows.map(row => [row.cells[0], row.cells[2], row.cells[4], row.cells[6]]), [
  ["NCR-0001", "FLOOR TILES", "Frank Foreman", "Inspection IR-0004"], ["NCR-0002", "FLOOR TILES", "Frank Foreman", "Raised directly"], ["NCR-0003", "Whole work pin", "Not assigned", "Raised directly"]],
  "An inspection NCR keeps its criterion's item; a direct NCR its own item (current name)")
assert.equal(ncrRows[0].cells[5], "4 days overdue")
assert.deepEqual(lists()[1].rows.map(row => [row.cells[0], row.cells[2]]), [["IR-0005", "Whole work pin"], ["IR-0004", "FLOOR TILES"]], "Newest inspection first, with the checklist items it was requested for")
assert.equal(lists()[2].rows[0].cells[2], "FLOOR TILES")
props = actionsFor("engineer")
const actions = find(named("NextActions")).props.actions
assert.deepEqual(actions.map(action => action.text), ["Inspect IR-0005 Re-check", "Verify the correction of NCR-0002 Crack", "Assign NCR-0003 Stain to a Foreman", "Decide on client report SR-0007 Loose tile"])
find(named("NextActions")).props.onOpen(actions[1]); render(Sections.PinIssuesSection, props)
let detail = find(lazyOf("DefectDetail"), "Verifying opens the NCR record")
assert.deepEqual([detail.props.defect.id, detail.props.canVerify, detail.props.canWork, detail.props.onPlan], ["d2", true, false, true])
detail.props.onOpenInspection("ir1"); render(Sections.PinIssuesSection, props)
detail = find(lazyOf("InspectionDetail")); assert.deepEqual([detail.props.inspection.id, detail.props.canInspect, detail.props.canRequest, detail.props.onPlan], ["ir1", true, true, true])
props = issuesFor("engineer")
lists()[3].rows[0].onOpen(); render(Sections.PinIssuesSection, props); assert.equal(find(lazyOf("SnagPanel")).props.snag.id, "s1", "The Engineer decides client reports here")
lists()[2].rows[0].onOpen(); render(Sections.PinIssuesSection, props); assert.equal(find(lazyOf("IssueDetails")).props.canEdit, true)
props = actionsFor("engineer"); find(buttonText("Raise NCR")).props.onClick(); render(Sections.PinIssuesSection, props)
const raise = find(named("RaiseNcrFromPin")); render(raise.type, raise.props)
const ncrForm = find(lazyOf("NewDefectModal")); assert.deepEqual([ncrForm.props.projectId, ncrForm.props.initialPinId, ncrForm.props.foremen[0].user_id], ["A", "p1", "fore"], "The NCR form starts on this project and pin, assigned Foreman first")
actionsFor("engineer", { pin: { ...pin, status: "verified" } }); assert.equal(find(buttonText("Log an issue")).props.disabled, true, "Completed work must be reopened before a new issue")
props = actionsFor("engineer", { pin: { ...pin, status: "for_review", locked: true } })
assert.equal(find(buttonText("Log an issue")).props.disabled, false, "Pending QA and movement locks do not disable the Engineer's issue form")
find(buttonText("Log an issue")).props.onClick(); render(Sections.PinIssuesSection, props)
const logFromPin = find(named("LogIssueFromPin")); reset(); render(logFromPin.type, logFromPin.props)
assert.equal(find(lazyOf("LogIssueModal")).props.initialPinId, "p1", "Clicking Log an issue opens the form on this pin")
actionsFor("engineer", { pin: { ...pin, category: "note" } }); assert.equal(find(buttonText("Log an issue")).props.disabled, true)
const compactProps = issuesFor("engineer", { wide: false, data: dataFor("engineer", { defects: [{ ...defects[0], description: "Full defect description.", corrective_action: "Replace the damaged threshold.", severity: "major", raised_at: "2026-10-18T02:00:00Z", raised_by: "eng" }] }) })
const detailedList = find(named("RecordList"))
detailedList.props.rows[0].onOpen(); render(Sections.PinIssuesSection, compactProps)
detail = find(lazyOf("DefectDetail"))
assert.equal(detail.props.defect.description, "Full defect description.")
assert.equal(detail.props.defect.corrective_action, "Replace the damaged threshold.", "Opening retains full record data and existing rights")
assert.equal(detail.props.canVerify, true)
let openedRows = 0, stopped = 0, prevented = 0
const compactListProps = { ...detailedList.props, rows: detailedList.props.rows.map(row => ({ ...row, onOpen: () => openedRows++ })) }
reset(); render(detailedList.type, compactListProps)
assert.equal(find(node => node.type === "table").props["aria-label"], "NCRs (non-conformances) detailed view")
assert.ok(find(node => node.props?.role === "region").props.className.includes("overflow-x-auto"), "Narrow panels use a keyboard-focusable horizontal detail view")
assert.ok(!all(tree).some(node => node.type === "li"), "The record list no longer renders large cards")
assert.ok(!all(tree).some(named("RecordDetails")), "Extra details are not mounted inside summary rows")
assert.doesNotMatch(text(tree), /Full defect description|Replace the damaged threshold|Severity|Correction submitted/)
assert.ok(all(tree).some(node => node.type === "span" && node.props.className?.includes("line-clamp-2")), "Summary cells are limited to two lines")
const compactRow = find(node => node.type === "tr" && node.props.tabIndex === 0)
compactRow.props.onClick(); assert.equal(openedRows, 1)
for (const key of ["Enter", " "]) compactRow.props.onKeyDown({ key, target: compactRow, currentTarget: compactRow, preventDefault() { prevented++ } })
assert.equal(openedRows, 3); assert.equal(prevented, 2)
compactRow.props.onKeyDown({ key: "Enter", target: {}, currentTarget: compactRow, preventDefault() { throw new Error("Child keyboard event must not trigger the row") } })
assert.equal(openedRows, 3)
find(buttonText("View details")).props.onClick({ stopPropagation() { stopped++ } })
assert.equal(openedRows, 4); assert.equal(stopped, 1, "The button does not also trigger the row's open handler")
const readOnlyListProps = { ...detailedList.props, rows: detailedList.props.rows.map(row => ({ ...row, onOpen: undefined })) }
reset(); render(detailedList.type, readOnlyListProps)
find(buttonText("View details")).props.onClick({ stopPropagation() {} }); render(detailedList.type, readOnlyListProps)
const readOnlyModal = find(named("Modal"))
assert.ok(!all(readOnlyModal).some(buttonText("Close NCR")), "Summary-only read access never gains operational actions")
const notes = find(named("RecordDetails")); tree = notes.type(notes.props)
assert.match(text(tree), /Full defect description.*Severitymajor.*Raised.*Due date.*Corrective actionReplace the damaged threshold/s, "Read-only records keep their extra information behind the click too")
render(detailedList.type, readOnlyListProps); find(buttonText("Close details")).props.onClick(); render(detailedList.type, readOnlyListProps)
assert.ok(!all(tree).some(named("Modal")))

// Filters on the pin's records (the Next actions list stays whole).
props = actionsFor("engineer")
assert.match(text(tree), /Log an issue: flags this pin as an Issue.*Raise NCR: a numbered non-conformance/, "The panel explains the difference")
props = issuesFor("engineer")
const bar = () => find(named("RecordFilterBar"))
const filterTo = (patch) => { bar().props.onChange({ ...model.emptyRecordFilter, ...patch }); render(Sections.PinIssuesSection, props) }
const rowIds = () => Object.fromEntries(lists().map((list) => [list.title, list.rows.map((row) => row.key)]))
assert.equal(bar().props.facts.length, 7, "3 NCRs, 2 inspections, 1 site issue, 1 client report")
filterTo({ kind: "ncr" }); assert.deepEqual(Object.keys(rowIds()), ["NCRs (non-conformances)"], "A type chip shows only that list")
filterTo({ kind: "ncr", state: "closed" }); assert.deepEqual(rowIds()["NCRs (non-conformances)"], []); assert.equal(lists()[0].empty, "No NCR matches these filters.")
filterTo({ state: "open" }); assert.deepEqual(rowIds(), { "NCRs (non-conformances)": ["d1", "d2", "d3"], "Inspections and QA requests": ["ir2"], "Site issues": ["is1"], "Client problem reports": ["s1"] })
filterTo({ item: "i1" }); assert.deepEqual(rowIds(), { "NCRs (non-conformances)": ["d1", "d2"], "Inspections and QA requests": ["ir1"], "Site issues": ["is1"], "Client problem reports": [] }, "Inspection NCRs follow their request's item; direct NCRs their own")
filterTo({ item: model.WHOLE_PIN_ITEM }); assert.deepEqual(rowIds(), { "NCRs (non-conformances)": ["d3"], "Inspections and QA requests": ["ir2"], "Site issues": [], "Client problem reports": ["s1"] })
filterTo({ query: "ncr-0003" }); assert.deepEqual(rowIds()["NCRs (non-conformances)"], ["d3"])
filterTo({ query: "frank overdue" }); assert.deepEqual(rowIds()["NCRs (non-conformances)"], [], "Due text is not searched")
filterTo({ query: "frank" }); assert.deepEqual(rowIds()["NCRs (non-conformances)"], ["d1", "d2"]); assert.deepEqual(rowIds()["Inspections and QA requests"], ["ir2", "ir1"], "Requested by Frank")
assert.ok(!all(tree).some(named("NextActions")), "Next actions remain in their separate unfiltered tab")
const barNode = bar(); tree = barNode.type(barNode.props)
assert.match(text(tree), /Showing 4 of 7 records/)
const typeSelect = find(node => node.type === "select" && node.props["aria-label"] === "Record type")
assert.deepEqual(optionLabels(typeSelect), ["All records (4)", "NCRs (2)", "Inspections (2)", "Site issues (0)", "Client reports (0)"], "Dropdown counts respect the other filters")
typeSelect.props.onChange({ target: { value: "ncr" } }); render(Sections.PinIssuesSection, props); assert.equal(bar().props.filter.kind, "ncr")
tree = bar().type(bar().props)
find(node => node.type === "select" && node.props["aria-label"] === "Record status").props.onChange({ target: { value: "closed" } })
render(Sections.PinIssuesSection, props); assert.equal(bar().props.filter.state, "closed")
tree = bar().type(bar().props)
find(buttonText("Clear filters")).props.onClick(); render(Sections.PinIssuesSection, props); assert.equal(bar().props.filter.query, "")
filterTo({ state: "closed" }); render(Sections.PinIssuesSection, { ...props, pin: { ...pin, id: "p9" } }); render(Sections.PinIssuesSection, { ...props, pin: { ...pin, id: "p9" } }); assert.deepEqual(bar().props.filter, model.emptyRecordFilter, "Another pin starts unfiltered")
props = issuesFor("engineer", { pin: { ...pin, status: "verified" } }); filterTo({ kind: "issue", state: "closed" }); assert.deepEqual(rowIds(), { "Site issues": ["is1"] }, "A site issue is closed once its work is completed")

props = actionsFor("foreman")
assert.ok(find(buttonText("Report a field problem")) && !all(tree).some(buttonText("Raise NCR")) && !all(tree).some(buttonText("Log an issue")))
assert.deepEqual(find(named("NextActions")).props.actions.map(action => [action.open.id, action.tone]), [["d1", "act"], ["d2", "wait"], ["ir2", "wait"]], "Only the Foreman's own NCRs; unassigned ones are the Engineer's to assign")
props = issuesFor("foreman")
assert.deepEqual(lists().map(list => list.title), ["NCRs (non-conformances)", "Inspections and QA requests", "Site issues"], "Foremen do not see client reports")
assert.equal(lists()[0].rows.filter(row => row.mine).length, 2, "The Foreman's own open NCRs stand out")
lists()[0].rows[0].onOpen(); render(Sections.PinIssuesSection, props)
detail = find(lazyOf("DefectDetail")); assert.deepEqual([detail.props.canWork, detail.props.canVerify], [true, false], "Foremen correct; only Engineers verify and close")
lists()[1].rows[0].onOpen(); render(Sections.PinIssuesSection, props)
detail = find(lazyOf("InspectionDetail")); assert.deepEqual([detail.props.canInspect, detail.props.canRequest], [false, true])
props = actionsFor("foreman"); find(buttonText("Report a field problem")).props.onClick(); render(Sections.PinIssuesSection, props)
const dialog = find(named("FieldProblemDialog")); reset(); render(dialog.type, dialog.props)
const send = () => find(buttonText("Send to the Engineer"))
assert.equal(send().props.disabled, true, "A field problem needs a description")
find(node => node.type === "select" && node.props.id === "field-problem-item").props.onChange({ target: { value: "i1" } })
find(node => node.type === "textarea").props.onChange({ target: { value: "Tiles delivered cracked" } }); render(dialog.type, dialog.props)
await send().props.onClick(); assert.deepEqual(fieldProblems.at(-1), ["p1", "i1", "Tiles delivered cracked"])
actionsFor("foreman", { canWork: false }); assert.ok(!all(tree).some(buttonText("Report a field problem"))); assert.match(text(tree), /Only the Foreman assigned/)

props = issuesFor("client", { data: dataFor("client", { snags: [{ ...snags[0], status: "accepted", fix_stage: "in_progress" }] }) })
assert.deepEqual(lists().map(list => list.title), ["My problem reports on this pin"], "Clients see only their own reports, never QA records")
const clientBar = find(named("RecordFilterBar")); tree = clientBar.type(clientBar.props)
assert.deepEqual(all(tree).filter(node => node.type === "select").map(node => node.props["aria-label"]), ["Record status"], "Clients get only the status dropdown, never internal record types or checklist filters")
render(Sections.PinIssuesSection, props)
assert.match(String(lists()[0].rows[0].cells[3]), /crew is fixing it/)
const clientProps = props; props = actionsFor("client"); find(buttonText("Report a problem here")).props.onClick(); assert.equal(opened.at(-1), clientActionPath("ticket", "A", "p1")); props = issuesFor("client", clientProps)
lists()[0].rows[0].onOpen(); render(Sections.PinIssuesSection, props); assert.equal(find(lazyOf("SnagParts")).props.onPlan, true)
assert.ok(!all(tree).some(lazyOf("DefectDetail")))

props = issuesFor("admin")
assert.ok(!all(tree).some(node => node.type === "button" && ["Log an issue", "Raise NCR", "Report a field problem"].includes(text(node))), "Admins get no operational actions")
assert.equal(lists()[3].rows[0].onOpen, undefined, "Admins cannot decide client reports")
assert.ok(!all(tree).some(named("NextActions")), "Admin register remains read-only without an actions list")
lists()[0].rows[0].onOpen(); render(Sections.PinIssuesSection, props)
detail = find(lazyOf("DefectDetail")); assert.deepEqual([detail.props.canWork, detail.props.canVerify], [false, false], "Admins read NCRs without approval rights")
console.log("Issues & NCRs: per-role lists, detailed columns, checklist links, next actions, create forms on the pin, detail rights (Engineer verifies, Foreman corrects, Admin reads, Client own reports), field problems and record filters passed")

// ---------- Reports and communication sections ----------
const reportProps = { pin, role: "foreman", canWork: true, data: dataFor("foreman") }
reset(); render(Sections.PinReportsSection, reportProps)
find(buttonText("Add this pin to today's daily report")).props.onClick(); assert.deepEqual(followed.at(-1), ["/foreman/daily-report?project=A&linkpin=p1", "A"])
assert.equal(find(named("PinDailyReports")).props.staff, true)
assert.deepEqual(find(named("PinDailyReports")).props.dates, { from: "2026-10-24", to: "2026-10-24" }, "Panel reports open on today's Manila report date")
const originalReportKey = find(named("PinDailyReports")).key
find(named("DateRangeFilter")).props.onChange({ from: "2026-10-01", to: "2026-10-23" }); render(Sections.PinReportsSection, reportProps)
assert.notEqual(find(named("PinDailyReports")).key, originalReportKey, "Changing dates remounts open report details and photo slideshows")
find(named("DateRangeFilter")).props.onChange({ from: "2026-10-25", to: "2026-10-01" }); render(Sections.PinReportsSection, reportProps)
assert.ok(!all(tree).some(named("PinDailyReports")), "Invalid dates never fall back to all reports")
reset(); render(Sections.PinReportsSection, reportProps)
assert.deepEqual(find(named("PinDailyReports")).props.dates, { from: "2026-10-24", to: "2026-10-24" }, "Reopening the tab restores Today")
reset(); render(Sections.PinReportsSection, { pin, role: "client", canWork: false, data: dataFor("client") })
assert.ok(!all(tree).some(buttonText("Add this pin to today's daily report"))); assert.equal(find(named("PinDailyReports")).props.staff, false)
assert.deepEqual(find(named("PinDailyReports")).props.dates, { from: "2026-10-24", to: "2026-10-24" }, "Client pin reports share the Today default without exposing drafts")
reset(); render(Sections.PinCommunicationSection, { pin, role: "engineer", meId: "eng", team, data: dataFor("engineer", { questions: [{ id: "q", answer: null }] }) })
assert.equal(find(named("ProjectQuestions")).props.questions[0].id, "q", "The Engineer answers this pin's questions here")
reset(); render(Sections.PinCommunicationSection, { pin, role: "client", meId: "me", team, data: dataFor("client", { questions: [{ id: "q", question: "When is the floor done?", answer: "Friday", answered_by: "eng", created_at: "2026-10-22T02:00:00Z" }] }) })
assert.match(text(tree), /When is the floor done\?.*Answered by Erin Engineer.*Friday/)
find(buttonText("Ask about this pin")).props.onClick(); assert.equal(opened.at(-1), clientActionPath("communication", "A", "p1"))
console.log("Daily reports (add to today's report for the assigned Foreman) and Communication (Engineer answers, client sees own) passed")

// ---------- Open on blueprint ----------
let role = "engineer"
deps.useAuth = () => ({ profile: { role } })
const Open = (await compile("../src/components/OpenOnBlueprint.tsx", { "../lib/pinRecordsModel": new URL("../src/lib/pinRecordsModel.ts", import.meta.url).href })).default
reset(); render(Open, { projectId: "A", pinId: "p1", sheetId: "s1", section: "issues" })
find(buttonText("Open on blueprint")).props.onClick(); assert.deepEqual(followed.at(-1), ["/engineer/annotation?project=A&sheet=s1&pin=p1&pintab=issues", "A"])
role = "client"; reset(); render(Open, { projectId: "A", pinId: "p1", sheetId: "s1", section: "reports" })
find(buttonText("Open on blueprint")).props.onClick(); assert.equal(followed.at(-1)[0], "/client/blueprint?project=A&sheet=s1&pin=p1&pintab=reports")
reset(); assert.equal(render(Open, { projectId: "A", pinId: null }), null, "Project-wide records have no plan link")
role = "user"; reset(); assert.equal(render(Open, { projectId: "A", pinId: "p1" }), null)
console.log("Open on blueprint: role plan page with project, sheet, pin and section; none for project-wide records or roles without a plan passed")

// ---------- Photos: original submission evidence apart from correction evidence ----------
let photoQuery
deps.useEvidencePhotos = (...args) => { photoQuery = args; return { photos: [{ id: "o", qa_attempt_id: null, uploaded_by: "fore" }, { id: "c", qa_attempt_id: "attempt", uploaded_by: "fore" }], loading: false, error: "", reload() {} } }
Object.assign(deps, { useProjectWorkItems: () => [], useProjectTeam: () => ({ team }), emptyPhotoScope: { sheet: "", pin: "", item: "" }, changePhotoScope: scope => scope })
Object.assign(deps, dateModel)
const Photos = (await compile("../src/components/ChecklistPhotos.tsx")).default
reset(); render(Photos, { pin })
assert.deepEqual(find(named("DateRangeFilter")).props.range, { from: "2026-10-24", to: "2026-10-24" }, "Photos open on today's Manila date")
const todayResults = find(named("PinPhotoResults"))
find(named("DateRangeFilter")).props.onChange({ from: "2026-10-01", to: "2026-10-05" }); render(Photos, { pin })
const earlierResults = find(named("PinPhotoResults")); assert.notEqual(earlierResults.key, todayResults.key, "Changing dates remounts results and closes the old slideshow")
reset(); render(earlierResults.type, earlierResults.props)
assert.deepEqual(photoQuery, ["A", "checklist", undefined, { from: "2026-10-01", to: "2026-10-05" }, { sheet: "s1", pin: "p1", item: "" }], "Dates and pin scope reach the database hook, before its query limit")
const grids = all(tree).filter(named("PhotoGrid"))
assert.deepEqual(grids.map(grid => grid.props.photos.map(photo => photo.id)), [["o"], ["c"]], "Correction photos never mix with the original submission")
assert.ok(grids.every(grid => grid.props.variant === "tiles" && grid.props.photos[0].uploaderName === "Frank Foreman"), "Photo tiles retain uploader details for the viewer")
assert.match(text(tree), /Original submission evidence \(1\).*Correction evidence \(1\)/)
reset(); render(Photos, { pin }); assert.deepEqual(find(named("DateRangeFilter")).props.range, { from: "2026-10-24", to: "2026-10-24" }, "Reopening the tab resets to today")
console.log("Pin photos: today default/reset, calendar query range, fresh result/viewer per filter, tiles and separate original/correction evidence passed")

// ---------- Resizable inspector: captured pointer, keyboard, limits ----------
Object.assign(deps, sizeModel)
const Resize = (await compile("../src/components/editor/PanelResizeHandle.tsx")).default
const widths = []
reset(); render(Resize, { width: 480, maximum: 760, onResize: width => widths.push(width) })
const capture = new Set(), target = { focus() {}, setPointerCapture: id => capture.add(id), hasPointerCapture: id => capture.has(id), releasePointerCapture: id => capture.delete(id) }
const resizeEvent = x => ({ button: 0, pointerId: 1, clientX: x, currentTarget: target, preventDefault() {}, stopPropagation() {} })
tree.props.onPointerDown(resizeEvent(800)); tree.props.onPointerMove(resizeEvent(650)); assert.equal(widths.at(-1), 630, "Dragging the docked left edge left widens the panel")
tree.props.onPointerMove(resizeEvent(100)); assert.equal(widths.at(-1), 760)
tree.props.onPointerMove(resizeEvent(1200)); assert.equal(widths.at(-1), 320)
tree.props.onPointerUp(resizeEvent(1200)); assert.equal(capture.size, 0)
const before = widths.length; tree.props.onPointerMove(resizeEvent(400)); assert.equal(widths.length, before, "Released pointers do not resize")
tree.props.onKeyDown({ key: "ArrowLeft", preventDefault() {}, stopPropagation() {} }); assert.equal(widths.at(-1), 504)
reset(); render(Resize, { side: "right", width: 480, maximum: 700, onResize: width => widths.push(width) })
tree.props.onPointerDown(resizeEvent(800)); tree.props.onPointerMove(resizeEvent(900)); assert.equal(widths.at(-1), 580, "Floating right edge widens to the right")
tree.props.onPointerCancel(resizeEvent(900)); assert.equal(capture.size, 0)
assert.equal(sizeModel.panelWidth(NaN), 480); assert.equal(sizeModel.panelWidth(1000), 760); assert.equal(sizeModel.panelWidth(480, 280), 280)
assert.equal(sizeModel.dockedPanelMaximum(1024), 504); assert.equal(sizeModel.dockedPanelMaximum(1920), 760)
console.log("Panel resizing: both edges, pointer capture/cancel, keyboard, narrow viewport and saved width sanitization passed")

// ---------- Loader: role-skipped tables, pin-scoped queries, stale answers dropped ----------
const queries = []
const builder = table => {
  const query = { table, filters: [] }
  queries.push(query)
  const chain = { select(columns) { query.columns = columns; return chain }, eq(column, value) { query.filters.push(["eq", column, value]); return chain }, contains(column, value) { query.filters.push(["cs", column, value]); return chain }, order() { return chain },
    range() { return new Promise(resolve => { query.resolve = resolve }) } }
  return chain
}
deps.supabase = { from: builder, rpc: async () => ({ error: null }) }
deps.useLiveReload = () => {}; deps.usePeriodicReload = () => {}; deps.byColumn = () => []; deps.byProject = () => []
const Loader = await compile("../src/lib/pinRecords.ts", { "./paging": new URL("../src/lib/paging.ts", import.meta.url).href })
let result
const hook = input => { result = Loader.usePinRecords(input.pin, input.role); return null }
const tick = () => new Promise(resolve => setImmediate(resolve))
reset(); render(hook, { pin: { id: "p1", project_id: "A" }, role: "client" }); await tick()
assert.deepEqual(queries.map(query => query.table).sort(), ["client_snags", "daily_reports", "project_questions"], "Clients never query QA or site issue tables")
const clientReports = queries.find(query => query.table === "daily_reports")
assert.equal(clientReports.columns, "*", "The Client's blueprint never requests internal task percentages")
assert.deepEqual(clientReports.filters, [["eq", "project_id", "A"], ["cs", "linked_work", JSON.stringify([{ pin_id: "p1" }])], ["eq", "status", "submitted"]], "Clients get submitted reports that link this pin")
queries.length = 0; reset(); render(hook, { pin: { id: "p1", project_id: "A" }, role: "foreman" }); await tick()
assert.deepEqual(queries.map(query => query.table).sort(), ["daily_reports", "qa_defects", "site_issue_reports"], "Foremen read no client reports or client questions")
assert.ok(queries.every(query => query.filters.some(([, column, value]) => (column === "pin_id" && value === "p1") || column === "linked_work")), "Every query is scoped to this pin")
assert.equal(queries.find(query => query.table === "daily_reports").columns, "*,daily_report_entries(*)", "Staff blueprint records include task percentages in the existing pin-scoped read")
const oldQueries = [...queries]; queries.length = 0
render(hook, { pin: { id: "p2", project_id: "A" }, role: "foreman" }); await tick()
const newQueries = [...queries]
assert.equal(result.loading, true)
for (const query of newQueries) query.resolve({ data: query.table === "qa_defects" ? [{ id: "new", number: 2 }] : [], error: null })
await tick(); render(hook, { pin: { id: "p2", project_id: "A" }, role: "foreman" })
assert.deepEqual(result.records.defects.map(row => row.id), ["new"]); assert.equal(result.loading, false); assert.equal(result.error, "")
for (const query of oldQueries) query.resolve({ data: [{ id: `old-${query.table}`, number: 1 }], error: null })
await tick(); render(hook, { pin: { id: "p2", project_id: "A" }, role: "foreman" })
assert.deepEqual(result.records.defects.map(row => row.id), ["new"], "A late answer for the previous pin never replaces the current pin's records"); assert.equal(result.loading, false)
queries.length = 0; reset(); render(hook, { pin: { id: "p3", project_id: "A" }, role: "engineer" }); await tick()
for (const query of queries) query.resolve(query.table === "client_snags" ? { data: null, error: { message: "offline" } } : { data: [], error: null })
await tick(); render(hook, { pin: { id: "p3", project_id: "A" }, role: "engineer" })
assert.match(result.error, /could not be loaded/, "A failed table is reported, not shown as empty")
console.log("Pin record loader: role-skipped tables, pin-scoped queries, submitted-only client reports, stale answers dropped and failures reported passed")
// ---------- Foreman daily report: "Add this pin to today's daily report" ----------
const reportState = { reports: [], items: [] }, infos = [], successes = []
let replaced = ""
globalThis.window = { location: { search: "", href: "" }, history: { replaceState(_a, _b, next) { replaced = String(next) } }, addEventListener() {}, removeEventListener() {} }
const openReport = search => { window.location.search = search; window.location.href = `https://app.test/foreman/daily-report${search}` }
Object.assign(deps, {
  useAuth: () => ({ profile: { id: "fore", role: "foreman" } }), getSelectedProjectId: () => "A", reportableDates: today => [today],
  useDailyReports: () => ({ reports: reportState.reports, loading: false, error: "", reload: async () => {} }), useProjectWorkItems: () => reportState.items,
  useReportAttendance: () => ({ count: 4, loading: false, error: "", reload: async () => {} }),
  useToast: () => ({ success: (...args) => successes.push(args), error() {}, info: (...args) => infos.push(args) }), useConfirm: () => async () => true,
  blankEntry, carryForwardProgress, moveSummaryToTask, previousTaskProgress, reportEntries, sameWork, photosOutsideTasks,
})
for (const row of pins) row.assigned_to = "fore"
const ForemanReport = (await compile("../src/pages/Foreman/ForemanDailyProgressReport.tsx")).default
const linked = () => find(named("TaskProgressEditor")).props.value.map(({ pin_id, item_id }) => ({ pin_id, item_id }))
reset(); reportState.items = [{ id: "i1", pin_id: "p1", text: "FLOOR" }]; openReport("?project=A&linkpin=p1")
render(ForemanReport, {}); render(ForemanReport, {})
assert.deepEqual(linked(), [{ pin_id: "p1", item_id: null }], "The pin is added to today's new draft")
assert.equal(find(named("TaskProgressEditor")).props.value[0].percent, null, "A pin added from its panel starts as a blank task entry")
assert.match(successes.at(-1)[1], /Choose the task worked on for Laundry/)
assert.ok(!replaced.includes("linkpin"), "The request is used once and removed from the address")
reset(); successes.length = 0
reportState.reports = [{ id: "draft", project_id: "A", author_id: "fore", report_date: "2026-10-24", status: "draft", weather: "sunny", workers_count: 4, work_done: "Tiling", linked_work: [{ pin_id: "p2", item_id: null }], updated_at: "1" }]
openReport("?project=A&linkpin=p1&linkitem=i1"); render(ForemanReport, {}); render(ForemanReport, {})
assert.deepEqual(linked(), [{ pin_id: "p2", item_id: null }, { pin_id: "p1", item_id: "i1" }], "An existing draft keeps its linked work; the pin and item are added")
reset(); reportState.reports = [{ ...reportState.reports[0], status: "submitted" }]
openReport("?project=A&linkpin=p1"); render(ForemanReport, {}); render(ForemanReport, {})
assert.deepEqual(linked(), [{ pin_id: "p2", item_id: null }], "A submitted report is never changed"); assert.match(infos.at(-1)[0], /already submitted/)
reset(); reportState.reports = []; openReport("?project=A&linkpin=x1"); render(ForemanReport, {}); render(ForemanReport, {})
assert.deepEqual(linked(), [], "A pin of another project is not linked")
reset(); pins[1].assigned_to = "someone"; openReport("?project=A&linkpin=p2"); render(ForemanReport, {}); render(ForemanReport, {})
assert.deepEqual(linked(), [], "Work assigned to someone else is not added"); pins[1].assigned_to = "fore"
console.log("Foreman daily report: a pin from the panel is added once to today's draft, existing drafts keep their links, submitted reports and foreign pins are refused passed")
reset()
Object.assign(deps,{usePinPanelData:()=>({counts:{}}),pinSectionsFor:()=>["details"],readPinSection:()=>"details",sectionLabel:()=>"Details"})
const Inspector=(await compile("../src/components/editor/Inspector.tsx")).default
const movedPins=[]
const moveProps={role:"engineer",canEdit:true,selectedAnnotations:[],selectedPin:{id:"movable",title:"Bedroom",status:"open",locked:false},numberOf:()=>1,onMovePin:pin=>movedPins.push(pin.id)}
const showPinHeader=props=>{reset();render(Inspector,props);const Panel=tree.type,child=tree.props;render(Panel,child)}
showPinHeader(moveProps)
find(buttonText("Move pin")).props.onClick();assert.deepEqual(movedPins,["movable"],"The Engineer can start moving the selected pin from its visible panel")
showPinHeader({...moveProps,selectedPin:{...moveProps.selectedPin,locked:true}})
assert.equal(find(buttonText("Move pin")).props.disabled,true,"A locked pin must be unlocked first")
for(const override of [{canEdit:false},{role:"foreman"},{role:"client"},{role:"admin"}]){
  showPinHeader({...moveProps,...override});assert.ok(!all(tree).some(buttonText("Move pin")),"Only editing Engineers have the placement action")
}
console.log("Engineer Move pin action: visible panel control, exact pin callback, lock and read-only/role guards passed")
Object.assign(deps, {
  usePinPanelData: () => ({ ...dataFor("engineer"), checklist: { items: [] } }),
  taskProgress: () => ({ approved: 0, percent: 0 }),
})
const PinDetailsModal = (await compile("../src/components/editor/PinDetailsModal.tsx")).default
const modalMoves = []
let modalCloses = 0
const fullPin = { ...moveProps.selectedPin, assigned_to: null, planned_start: null, due_date: null }
const fullInspector = { ...moveProps, team: [], onMovePin: pin => modalMoves.push(pin.id) }
const showFullPin = (inspector = fullInspector, pin = fullPin) => {
  reset()
  render(PinDetailsModal, { pin, inspector, onClose: () => { modalCloses++ }, onDelete() {} })
  // The footer is a Modal prop, rather than a child in the rendered body.
  tree = tree.props.footer
}
showFullPin()
find(buttonText("Move pin")).props.onClick()
assert.deepEqual(modalMoves, [fullPin.id], "Full pin details sends the same pin to the existing placement handler")
assert.equal(modalCloses, 1, "Full details closes so the Engineer can choose the new position")
showFullPin(fullInspector, { ...fullPin, locked: true })
assert.equal(find(buttonText("Move pin")).props.disabled, true)
for (const override of [{ canEdit: false }, { role: "foreman" }, { role: "client" }, { role: "admin" }, { onMovePin: undefined }]) {
  showFullPin({ ...fullInspector, ...override })
  assert.ok(!all(tree).some(buttonText("Move pin")))
}
console.log("Full pin details: Engineer move action, modal handoff, lock and role guards passed")
reset(); delete globalThis.__pinHooks; delete globalThis.__pinDeps; delete globalThis.window
