import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { changePhotoScope, emptyPhotoScope } from "../src/lib/photoGalleryModel.ts"
import { correctionGroup, correctionRecordMatches } from "../src/lib/foremanCorrectionsModel.ts"
import * as qaModel from "../src/lib/qaModel.ts"
import { allDates, inRange, isFiltered } from "../src/lib/dateRangeModel.ts"
import { toCsv } from "../src/lib/progress.ts"

const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], cursor = 0, tree, opened, navigated, runEffects = false, effects = []
globalThis.__qaLayoutHooks = {
  useState(initial) { const n = cursor++, state = slots; if (!(n in state)) state[n] = typeof initial === "function" ? initial() : initial; return [state[n], value => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
  useMemo: fn => fn(), useEffect(fn) { if (runEffects) effects.push(fn) }, useCallback: fn => fn,
  useRef(initial) { const n = cursor++; if (!(n in slots)) slots[n] = { current: initial }; return slots[n] },
}
const pin = { id: "pin", project_id: "project", blueprint_id: "sheet", title: "Laundry", assigned_to: "foreman", status: "for_review" }
const row = (id, action, stage, owner) => ({ item: { id, pin_id: pin.id, position: 0, text: id, review_status: stage === "completed" ? "verified" : "for_review" }, pin, view: { action, stage, owner, status: "Synthetic status", next: "Synthetic next action" }, current: null, ncrs: [], attempts: 1 })
const rows = [row("WALL", "inspect", "inspecting", "Engineer"), row("FLOOR", null, "completed", null)]
const workspace = { work: { pins: [pin], sheetOf: () => "Plan", nameOf: () => "Foreman" }, inspections: [{ id: "old-stage", number: 99, status: "requested", title: "Synthetic stage request", pin_id: pin.id }], defects: [], project: { id: "project" }, nameOf: () => "Engineer", loading: false }
globalThis.__qaLayoutDeps = {
  changePhotoScope, emptyPhotoScope, correctionGroup, correctionRecordMatches,
  useAuth: () => ({ profile: { id: "foreman", role: "foreman" } }), getSelectedProjectId: () => "project",
  useQaWorkspace: () => workspace, useWorkItems: () => ({ rows, workInspectionIds: new Set(["work-inspection"]), loading: false }), useItemParam: () => [null, () => {}],
  selectedVerification: () => null,
  supabase: { from() { throw new Error("Layout changes must not mutate database records") } },
}
async function compile(file, exportName = "default") {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (declaration.importClause.name) exports.push(name.endsWith("/WorkItemBoard") ? "export default globalThis.__qaLayoutBoard" : "export default function Stub(){return null}")
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      const dependency = `globalThis.${name === "react" ? "__qaLayoutHooks" : "__qaLayoutDeps"}.${key}`
      exports.push(`export const ${key}=typeof ${dependency} === "function" ? (...args)=>${dependency}(...args) : ${dependency} ?? function Stub(){return null}`)
    }
    output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(url(exports.join(";")))}`)
  }
  output = output.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
  return (await import(url(output)))[exportName]
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected QA layout control"); return node }
const render = (Component, props) => { cursor = 0; tree = Component(props); return tree }
const filters = () => all(find(node => node.props?.["aria-label"] === "Show work items")).filter(node => node.type === "button")
const Board = await compile("../src/components/qa/WorkItemBoard.tsx")
globalThis.__qaLayoutBoard = Board
const boardProps = { groups: [
  { key: "submit", title: "Submit QA", short: "Submit QA", rows: [row("CEILING", "submit", "preparing", "Foreman")] },
  { key: "waiting", title: "Waiting", short: "Waiting", rows: [rows[0]] },
  { key: "completed", title: "Completed", short: "Completed", rows: [rows[1]] },
], loading: false, nameOf: () => "Engineer", sheetOf: () => "Plan", onOpen: id => { opened = id } }
render(Board, boardProps)
assert.deepEqual(filters().map(text), ["Submit QA 1", "Waiting 1", "Completed 1", "All 3"])
assert.equal(filters()[0].props["aria-pressed"], true, "Open on the first relevant list, never All")
assert.equal(filters().at(-1).props["aria-pressed"], false)
filters()[0].props.onClick(); render(Board, boardProps)
assert.match(text(tree), /Showing 1 of 3/)
find(node => node.type === "button" && text(node) === "Open").props.onClick(); assert.equal(opened, "CEILING")
filters().at(-1).props.onClick(); render(Board, boardProps)
assert.match(text(tree), /Showing 3 of 3/)
find(node => node.type === "input").props.onChange({ target: { value: "FLOOR" } }); render(Board, boardProps)
assert.equal(text(filters().at(-1)), "All 1"); assert.match(text(tree), /Showing 1 of 3/)
find(node => node.type === "input").props.onChange({ target: { value: "missing" } }); render(Board, boardProps)
assert.equal(text(filters().at(-1)), "All 0")
const originalWindow = globalThis.window
globalThis.window = { location: { search: "" } }
const Foreman = await compile("../src/pages/Foreman/ForemanQualityControl.tsx")
slots = []; render(Foreman, { onNavigate() {} })
assert.doesNotMatch(text(tree), /Stage and hold|Synthetic stage request/)
assert.ok(!all(tree).some(node => node.props?.inspectionKind === "stage"))
let groups = find(node => node.type === Board).props.groups
slots = []; render(Board, { ...boardProps, groups })
assert.deepEqual(filters().map(text), ["Waiting 1", "Completed 1", "All 2"])
const Engineer = await compile("../src/pages/Engineer/EngineerQa.tsx")
slots = []; render(Engineer, { onNavigate: page => { navigated = page } })
assert.doesNotMatch(text(tree), /Stage and hold|Synthetic stage request/)
assert.equal(find(node => node.props?.title === "QA register").props.title, "QA register")
assert.doesNotMatch(text(tree), /Review queue|Waiting for you/)
let register = find(node => node.props?.workTabs).props
assert.deepEqual(register.tabs, ["inspections", "defects", "complete", "completed", "snags"])
assert.equal(register.workTabs.complete.count, 0, "Inspection in progress cannot be completed")
assert.equal(register.workTabs.completed.count, 1, "Completed checklists live inside the register")
assert.deepEqual(register.workTabs.completed.content.props.groups[0].rows.map(row => row.item.id), ["FLOOR"])
for (const tab of ["complete", "completed"]) {
  assert.equal(register.workTabs[tab].content.props.showGroupFilters, false, "Engineer register tabs do not repeat the group tabs")
  slots = []; render(Board, register.workTabs[tab].content.props)
  assert.ok(!all(tree).some(node => node.props?.["aria-label"] === "Show work items"))
}
const originalRow = rows[0]
rows[0] = { ...originalRow, view: { ...originalRow.view, action: "complete", stage: "passed" } }
slots = []; render(Engineer, { onNavigate() {} })
register = find(node => node.props?.workTabs).props
assert.equal(register.workTabs.complete.count, 1)
globalThis.__qaLayoutDeps.useItemParam = () => [null, id => { opened = id }]
slots = []; render(Engineer, { onNavigate() {} })
register = find(node => node.props?.workTabs).props
slots = []; render(Board, register.workTabs.complete.content.props)
assert.ok(!all(tree).some(node => node.props?.["aria-label"] === "Show work items"))
assert.ok(all(tree).some(node => node.props?.["aria-label"] === "Search work items"), "Search remains available without duplicate tabs")
find(node => node.type === "button" && text(node) === "Open").props.onClick()
assert.equal(opened, "WALL", "Complete checklist opens the exact work item and retains its guarded completion action")
rows[0] = originalRow
groups = [{ key: "inspect", short: "Inspect", title: "Inspect", rows: [rows[0]] }]
// The page's other lists (here Recently completed) are separate: own chip, shown under All, hidden under Inspect.
const sections = () => all(tree).filter(node => node.type === "section").map(node => node.props["aria-label"])
const extras = [{ key: "recent", short: "Completed", title: "Recently completed", count: 2, content: "two completed pins" }]
slots = []; render(Board, { ...boardProps, groups, extras, showGroupFilters: false })
assert.deepEqual(sections(), ["Inspect", "Recently completed"], "Without group tabs all records remain accessible")
slots = []; render(Board, { ...boardProps, groups: [], extras, showGroupFilters: false, emptyTitle: "All caught up" })
assert.deepEqual(sections(), ["Recently completed"])
assert.ok(!all(tree).some(node => node.props?.title === "All caught up"), "Extras-only history does not show a misleading empty state")
slots = []; render(Board, { ...boardProps, groups, extras })
assert.deepEqual(filters().map(text), ["Inspect 1", "Completed 2", "All 3"], "All is now more than Inspect, and stays last")
assert.deepEqual(sections(), ["Inspect"])
filters().at(-1).props.onClick(); render(Board, { ...boardProps, groups, extras })
assert.deepEqual(sections(), ["Inspect", "Recently completed"], "All remains an explicit choice")
filters()[0].props.onClick(); render(Board, { ...boardProps, groups, extras })
assert.deepEqual(sections(), ["Inspect"], "Inspect shows only the work to inspect, not Recently completed")
filters()[1].props.onClick(); render(Board, { ...boardProps, groups, extras })
assert.deepEqual(sections(), ["Recently completed"]); assert.match(text(tree), /two completed pins/); assert.doesNotMatch(text(tree), /Showing/)
filters().at(-1).props.onClick(); render(Board, { ...boardProps, groups, extras })
find(node => node.type === "input").props.onChange({ target: { value: "WALL" } }); render(Board, { ...boardProps, groups, extras })
assert.ok(!sections().includes("Recently completed"), "searching work items sets the other lists aside"); assert.match(text(tree), /other lists come back/)
find(node => node.type === "input").props.onChange({ target: { value: "" } })
filters()[1].props.onClick(); render(Board, { ...boardProps, groups, extras: [] })
assert.equal(filters()[0].props["aria-pressed"], true, "a chip whose list emptied falls back to the first relevant list")
slots = []; render(Board, { ...boardProps, groups: [], extras, emptyTitle: "All caught up", emptyText: "Nothing waiting" })
assert.deepEqual(sections(), ["Recently completed"])
assert.equal(filters()[0].props["aria-pressed"], true, "an extras-only board opens its first available list")
rows[0].item.review_status = "verified"
slots = []; render(Engineer, { onNavigate: page => { navigated = page } })
register = find(node => node.props?.workTabs).props
assert.equal(register.workTabs.completed.count, 2, "A completed checklist stays in history while another requirement blocks its work pin")
assert.equal(workspace.inspections.length, 1, "Removing stage UI never deletes historical inspection data")
// Foreman Corrections: Other NCRs and Site issues are separate lists with their own chips, not sections below the board.
globalThis.__qaLayoutDeps.useIssueRegister = () => ({ everRaised: new Set(), reports: [] })
const Corrections = await compile("../src/pages/Foreman/ForemanIssueTracking.tsx")
const savedDefects = workspace.defects, savedPins = workspace.work.pins
workspace.defects = [{ id: "ncr-open", status: "open", assigned_to: "foreman" }, { id: "ncr-closed", status: "closed", assigned_to: "foreman" }, { id: "ncr-other", status: "open", assigned_to: "someone-else" }]
workspace.work.pins = [pin, { ...pin, id: "issue-pin", title: "Kitchen", status: "issue", severity: "high" }]
slots = []; render(Corrections, {})
let correctionsBoard = find(node => node.type === Board).props
assert.deepEqual(correctionsBoard.extras.map(extra => [extra.key, extra.count, Boolean(extra.always)]), [["other-ncrs", 1, true], ["site-issues", 1, false]], "open NCRs assigned to you are counted")
assert.doesNotMatch(text(tree), /Site issues on your work|Raised on site/, "the lists live inside the board, not below it")
slots = []; render(Board, correctionsBoard)
assert.deepEqual(filters().map(text), ["Completed 1", "Other NCRs 1", "Site issues 1", "All 3"])
assert.deepEqual(sections(), ["Completed checklists"])
filters().at(-1).props.onClick(); render(Board, correctionsBoard)
assert.deepEqual(sections(), ["Completed checklists", "Other NCRs", "Site issues on your work"], "All shows every list")
filters()[2].props.onClick(); render(Board, correctionsBoard)
assert.deepEqual(sections(), ["Site issues on your work"], "a chip shows only its own list")
filters()[1].props.onClick(); render(Board, correctionsBoard)
assert.deepEqual(sections(), ["Other NCRs"])
workspace.defects = [{ id: "ncr-closed", status: "closed", assigned_to: "foreman" }]
slots = []; render(Corrections, {})
correctionsBoard = find(node => node.type === Board).props
slots = []; render(Board, correctionsBoard)
assert.deepEqual(filters().map(text), ["Completed 1", "Other NCRs 0", "Site issues 1", "All 2"], "with nothing open, Other NCRs stays reachable for closed ones")
workspace.defects = savedDefects; workspace.work.pins = savedPins
// Corrections lifecycle: each item belongs to exactly one list; Pass alone is not Completed.
const fix = row("wall-a", "submit_correction", "correction", "Foreman")
const reviewing = { ...row("wall-b", "inspect", "requested", "Engineer"), attempts: 2, current: { id: "reinspection", status: "requested", reinspection_of: "original", number: 7 } }
const passed = { ...reviewing, current: { ...reviewing.current, status: "passed" } }
assert.equal(correctionGroup(fix), "fix")
assert.equal(correctionGroup(reviewing), "review", "a correction with no for-verification NCR is still in review")
assert.equal(correctionGroup(passed), "review", "a passed reinspection still awaits manual completion")
assert.equal(correctionGroup({ ...reviewing, current: { ...reviewing.current, status: "in_progress" } }), "review")
assert.equal(correctionGroup({ ...row("ncr", "review_ncrs", "passed", "Engineer"), ncrs: [{ status: "for_verification" }] }), "review")
assert.equal(correctionGroup({ ...fix, ncrs: [{ status: "for_verification" }, { status: "open" }] }), "fix", "mixed NCRs never duplicate a To fix item under In review")
assert.equal(correctionGroup(row("initial", "inspect", "requested", "Engineer")), null, "initial QA belongs to QA requests, not Corrections")
assert.equal(correctionGroup(row("done", null, "completed", null)), "completed")

// Real Sheet -> Pin -> item controls, including duplicate item names on different pins.
const pinB = { ...pin, id: "pin-b", blueprint_id: "sheet-b", title: "Kitchen", status: "issue", severity: "high" }
const issuePinA = { ...pin, status: "issue", severity: "high" }
const wallA = { ...fix, item: { ...fix.item, text: "WALL" }, pin: issuePinA }
const wallB = { ...reviewing, item: { ...reviewing.item, pin_id: pinB.id, text: "WALL" }, pin: pinB }
rows.splice(0, rows.length, wallA, wallB, row("done", null, "completed", null))
const reports = [
  { id: "observation-a", pin_id: pin.id, checklist_item_id: wallA.item.id, checklist_name: "WALL", description: "Crack in laundry wall" },
  { id: "observation-b", pin_id: pinB.id, checklist_item_id: wallB.item.id, checklist_name: "WALL", description: "Kitchen finish chipped" },
  { id: "whole-pin", pin_id: pinB.id, checklist_item_id: null, description: "Access blocked" },
]
const ncrA = { id: "ncr-a", pin_id: pin.id, checklist_item_id: wallA.item.id, checklist_name: "WALL", number: 12, title: "Laundry alignment", assigned_to: "foreman", status: "open" }
const ncrB = { ...ncrA, id: "ncr-b", pin_id: pinB.id, checklist_item_id: wallB.item.id, number: 13, title: "Kitchen finish" }
const projectNcr = { ...ncrA, id: "project-ncr", pin_id: null, checklist_item_id: null, number: 14, title: "Site-wide safety" }
workspace.work.pins = [issuePinA, pinB]
workspace.work.sheetOf = id => id === "sheet-b" ? "Second floor" : "Ground floor"
workspace.defects = [ncrA, ncrB, projectNcr]
globalThis.__qaLayoutDeps.useIssueRegister = () => ({ everRaised: new Set([pin.id, pinB.id]), reports, loading: false, error: "", reload: async () => {} })
const WorkFilters = await compile("../src/components/WorkFilters.tsx")
let pageSlots = [], boardSlots = []
const renderPage = () => { slots = pageSlots; render(Corrections, {}); pageSlots = slots; return find(node => node.type === Board).props }
let props = renderPage()
const renderBoard = () => { slots = boardSlots; render(Board, props); boardSlots = slots }
const workFilters = () => find(node => node.props?.label === "Filter work items").props
const changeScope = (key, value) => { workFilters().onChange(key, value); renderBoard() }
const selectList = prefix => { find(node => node.type === "button" && text(node).startsWith(prefix)).props.onClick(); renderBoard() }
renderBoard()
assert.deepEqual(filters().map(text), ["To fix 1", "In review 1", "Completed 1", "Other NCRs 3", "Site issues 2", "All 8"])
assert.equal(filters()[0].props["aria-pressed"], true)
assert.equal(props.groups.find(group => group.key === "completed").always, true)
assert.equal(new Set(workFilters().items.map(item => item.id)).size, 3, "all work-filter options use distinct permanent item ids")
changeScope("sheet", "sheet-b")
assert.equal(text(filters().at(-1)), "All 3", "All counts the matching work row, NCR and site issue")
assert.match(text(tree), /Showing 0 of 3/)
selectList("In review")
assert.deepEqual(sections(), ["Corrections the Engineer is reviewing"])
const selectedProps = workFilters()
slots = []; render(WorkFilters, selectedProps)
const selects = all(tree).filter(node => node.type === "select")
assert.deepEqual(all(selects[1]).filter(node => node.type === "option").map(node => node.props.value), ["", pinB.id], "Sheet narrows Pin choices")
assert.deepEqual(all(selects[2]).filter(node => node.type === "option").map(node => node.props.value), ["", wallB.item.id], "Sheet also narrows checklist choices")
renderBoard(); changeScope("pin", pinB.id); changeScope("item", wallB.item.id)
assert.equal(text(filters().at(-1)), "All 3", JSON.stringify({ scope: workFilters().scope, chips: filters().map(text) }))
selectList("Other NCRs")
assert.ok(workFilters(), "work filters remain visible on Other NCRs")
let extra = props.extras.find(extra => extra.key === "other-ncrs").filter({ scope: { sheet: "sheet-b", pin: pinB.id, item: wallB.item.id }, query: "" })
assert.equal(extra.count, 1)
assert.equal(extra.content.props.scope(ncrB), true)
assert.equal(extra.content.props.scope(ncrA), false)
assert.equal(extra.content.props.scope(projectNcr), false, "a project-wide NCR does not match a selected work location")
extra.content.props.onOpen(ncrB.id)
props = renderPage()
let modal = find(node => node.props?.defect?.id === ncrB.id)
assert.equal(modal.props.canWork, true); assert.equal(modal.props.canVerify, false)
modal.props.onClose(); props = renderPage()
assert.ok(!all(tree).some(node => node.props?.defect), "Close dismisses the NCR record")
renderBoard(); selectList("Site issues")
assert.equal(text(filters().at(-1)), "All 3")
assert.match(text(tree), /Kitchen/); assert.doesNotMatch(text(tree), /Laundry/)
find(node => node.type === "button" && text(node) === "Details / photos").props.onClick()
props = renderPage()
modal = find(node => node.props?.pin?.id === pinB.id && node.props?.nameOf)
modal.props.onClose(); props = renderPage()
renderBoard()
find(node => node.type === "button" && text(node) === "Fix and report").props.onClick()
props = renderPage()
modal = find(node => node.props?.pin?.id === pinB.id && node.props?.onSaved)
modal.props.onClose(); props = renderPage()
renderBoard()
find(node => node.type === "input").props.onChange({ target: { value: "Access blocked" } }); renderBoard()
assert.equal(text(filters().at(-1)), "All 0", "a whole-pin report cannot satisfy a selected checklist item")
assert.ok(workFilters().canClear)
workFilters().onClear(); renderBoard()
assert.equal(text(filters().at(-1)), "All 8"); assert.equal(find(node => node.type === "input").props.value, "")
changeScope("pin", pinB.id)
assert.equal(workFilters().scope.sheet, "sheet-b", "selecting a pin selects its parent sheet")
changeScope("item", wallB.item.id); changeScope("sheet", "sheet")
assert.deepEqual(workFilters().scope, { sheet: "sheet", pin: "", item: "" }, "changing Sheet clears incompatible child selections")
workFilters().onClear(); renderBoard()
find(node => node.type === "input").props.onChange({ target: { value: "NCR-0013" } }); renderBoard()
assert.equal(text(filters().at(-1)), "All 1", "NCR reference search reaches the extra register")
workFilters().onClear(); renderBoard()
selectList("All")
changeScope("sheet", "sheet-b")
assert.deepEqual(sections(), ["Corrections the Engineer is reviewing", "Other NCRs", "Site issues on your work"], "filterable extras remain visible under narrowed All")

// Errors are visible and Refresh reloads every source; incomplete history is not treated as an empty board.
const reloads = []
workspace.reloadAll = async () => reloads.push("qa")
workspace.work.reload = async () => reloads.push("pins/sheets")
globalThis.__qaLayoutDeps.useWorkItems = () => ({ rows, loading: false, error: "", reload: async () => reloads.push("items") })
globalThis.__qaLayoutDeps.useIssueRegister = () => ({ everRaised: new Set(), reports, loading: true, error: "Issue history unavailable", reload: async () => reloads.push("issues") })
props = renderPage(); assert.equal(props.loading, true); assert.equal(props.error, "Issue history unavailable")
find(node => node.props?.title === "Corrections").props.actions.props.onClick()
await Promise.resolve()
assert.deepEqual(reloads.sort(), ["issues", "items", "pins/sheets", "qa"])

// Notification links open their canonical record without relying on All or an extra register being mounted.
const listeners = new Map()
globalThis.window = { location: { search: "?defect=ncr-b" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener() {} }
globalThis.__qaLayoutDeps.useIssueRegister = () => ({ everRaised: new Set(), reports, loading: false, error: "", reload: async () => {} })
runEffects = true; pageSlots = []; effects = []
renderPage(); effects.splice(0).forEach(effect => effect()); props = renderPage(); effects = []
assert.ok(all(tree).some(node => node.props?.defect?.id === ncrB.id))
window.location.search = "?issue=observation-b"; listeners.get("popstate")()
renderPage(); effects.splice(0).forEach(effect => effect()); props = renderPage(); effects = []
assert.ok(all(tree).some(node => node.props?.pin?.id === pinB.id && node.props?.nameOf), "report-id links resolve to the parent issue pin")
window.location.search = "?defect=not-in-project"; listeners.get("popstate")()
renderPage(); effects.splice(0).forEach(effect => effect()); props = renderPage(); effects = []
assert.match(text(tree), /linked QA record is unavailable/)
assert.ok(!all(tree).some(node => node.props?.defect), "an invalid link does not leave the old record open")
runEffects = false

// An always-available Completed tab does not steal the initial selection from actionable extras.
slots = []; render(Board, { ...boardProps, groups: [{ key: "completed", short: "Completed", title: "Completed", always: true, rows: [] }], extras: [{ key: "other", short: "NCRs", title: "NCRs", count: 1, content: "one NCR" }] })
assert.equal(filters()[1].props["aria-pressed"], true)
assert.equal(filters().at(-1).props["aria-pressed"], false)

// The actual NCR table applies the board's outer scope AND its status/class/trade/search filters; CSV follows the same rows.
let csv = "", tableOpened = ""
Object.assign(globalThis.__qaLayoutDeps, qaModel, { allDates, inRange, isFiltered, toCsv, downloadCsv: (_name, contents) => { csv = contents } })
Object.assign(globalThis.__qaLayoutDeps, {
  useQaSubmissionIndex: () => ({ rows: [], loading: false, error: "" }),
  checklistGroups: () => [], checklistNames: () => [],
})
const DefectsPanel = await compile("../src/components/qa/QaPanels.tsx", "DefectsPanel")
const fullNcr = defect => ({ ...defect, severity: "major", trade: "architectural", raised_at: "2026-10-26T01:00:00Z", due_date: null })
workspace.today = "2026-10-26"
workspace.defects = [fullNcr(ncrA), fullNcr(ncrB), fullNcr({ ...ncrB, id: "closed-b", number: 15, status: "closed", title: "Kitchen completed fix" })]
const panelProps = { ws: workspace, mode: "foreman", onNew: null, onOpen: id => { tableOpened = id }, scope: extra.content.props.scope }
slots = []; render(DefectsPanel, panelProps)
assert.match(text(tree), /Kitchen finish/); assert.doesNotMatch(text(tree), /Laundry alignment|Kitchen completed fix/)
find(node => node.type === "tr" && node.props["aria-label"]?.includes("NCR-0013")).props.onClick()
assert.equal(tableOpened, ncrB.id)
find(node => node.type === "button" && text(node) === "Export CSV").props.onClick()
assert.match(csv, /NCR-0013/); assert.doesNotMatch(csv, /NCR-0012|NCR-0015/)
find(node => node.props?.["aria-label"] === "Filter by status").props.onChange({ target: { value: "closed" } }); render(DefectsPanel, panelProps)
assert.match(text(tree), /Kitchen completed fix/); assert.doesNotMatch(text(tree), /Kitchen finish|Laundry alignment/)
find(node => node.props?.["aria-label"] === "Filter by class").props.onChange({ target: { value: "critical" } }); render(DefectsPanel, panelProps)
assert.ok(!all(tree).some(node => node.type === "tr"))

// Engineer inspections open on Requested, omit unused statuses, and open from the whole row.
const InspectionsPanel = await compile("../src/components/qa/QaPanels.tsx", "InspectionsPanel")
const inspection = (id, number, status) => ({ id, number, status, title: `Inspection ${id}`, trade: "general", score: null, requested_at: "2026-10-28T01:00:00Z", requested_by: "foreman", inspector_id: null, target_at: null })
const inspectionProps = { ws: { ...workspace, inspections: [inspection("request", 21, "requested"), inspection("pass", 22, "passed"), inspection("fail", 23, "failed")] }, mode: "engineer", canRequest: false, onNew() {}, onOpen: id => { tableOpened = id; inspectionOpens++ } }
let inspectionOpens = 0
const statusControl = () => find(node => node.props?.["aria-label"] === "Filter by status")
const statusOptions = () => all(statusControl()).filter(node => node.type === "option").map(node => node.props.value)
slots = []; render(InspectionsPanel, inspectionProps)
assert.equal(statusControl().props.value, "requested")
assert.deepEqual(statusOptions(), ["requested", "passed", "failed", "all"], "Only relevant states and All remain; no duplicate waiting aggregate")
assert.match(text(tree), /IR-0021/); assert.doesNotMatch(text(tree), /IR-0022|IR-0023/)
let inspectionRow = find(node => node.type === "tr")
assert.equal(inspectionRow.props.tabIndex, 0)
inspectionRow.props.onClick(); assert.equal(tableOpened, "request")
for (const key of ["Enter", " "]) {
  let prevented = false
  inspectionRow.props.onKeyDown({ key, target: inspectionRow, currentTarget: inspectionRow, preventDefault() { prevented = true } })
  assert.ok(prevented)
}
const beforeChildKey = inspectionOpens
inspectionRow.props.onKeyDown({ key: "Enter", target: {}, currentTarget: inspectionRow, preventDefault() { assert.fail("Do not handle child keyboard events twice") } })
assert.equal(inspectionOpens, beforeChildKey)
const irButton = all(inspectionRow).find(node => node.type === "button")
let stopped = false
irButton.props.onClick({ stopPropagation() { stopped = true } })
assert.ok(stopped, "The IR button does not bubble into a second open")
assert.equal(inspectionOpens, beforeChildKey + 1)
find(node => node.type === "button" && text(node) === "Export CSV").props.onClick()
assert.match(csv, /IR-0021/); assert.doesNotMatch(csv, /IR-0022|IR-0023/)
statusControl().props.onChange({ target: { value: "all" } }); render(InspectionsPanel, inspectionProps)
assert.equal(all(tree).filter(node => node.type === "tr").length, 3, "All keeps inspection history accessible")
statusControl().props.onChange({ target: { value: "passed" } }); render(InspectionsPanel, inspectionProps)
assert.match(text(tree), /IR-0022/); assert.doesNotMatch(text(tree), /IR-0021|IR-0023/)
render(InspectionsPanel, { ...inspectionProps, ws: { ...inspectionProps.ws, inspections: [] } })
assert.equal(statusControl().props.value, "passed")
assert.ok(statusOptions().includes("passed"), "A live update cannot leave the selected value missing from the dropdown")
slots = []; render(InspectionsPanel, { ...inspectionProps, ws: { ...inspectionProps.ws, inspections: [] } })
assert.equal(statusControl().props.value, "requested")
assert.deepEqual(statusOptions(), ["requested", "all"])
slots = []; render(InspectionsPanel, { ...inspectionProps, mode: "foreman" })
assert.equal(statusControl().props.value, "all", "Foreman inspection filters keep their existing default")
assert.ok(statusOptions().includes("open"))

globalThis.window = originalWindow
delete globalThis.__qaLayoutHooks; delete globalThis.__qaLayoutDeps; delete globalThis.__qaLayoutBoard
console.log("QA boards default to relevant lists (All last); Foreman Corrections Sheet/Pin/item/search filters, Completed, lifecycle grouping, extra-list counts, record/notification buttons and refresh/error states passed")
