import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as qaModel from "../src/lib/qaModel.ts"
import * as progress from "../src/lib/progress.ts"
import { allDates } from "../src/lib/dateRangeModel.ts"
import { qaOverviewSummary, qaOverviewTrend } from "../src/lib/qaOverviewModel.ts"
import { qaSummaryHtml } from "../src/lib/qaPrint.ts"

// Calendar filtering on the QA register (inspections requested / NCRs raised / client reports made) and Progress by zone
// (work due): the real filter control, page, view and panels, compiled with stubbed imports (no browser, no network).
const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], effects = [], pending = [], cursor = 0, tree
globalThis.__dateHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial } },
  useMemo: fn => fn(),
  useCallback(fn, deps) { const n = cursor++, old = slots[n]; if (!old || deps.some((value, i) => value !== old.deps[i])) slots[n] = { deps, fn }; return slots[n].fn },
  useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
}
const deps = globalThis.__dateDeps = {}
const model = new URL("../src/lib/dateRangeModel.ts", import.meta.url).href
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
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__dateHooks" : "__dateDeps"}.${key} ?? function ${key}(){return null}`)
    }
    replacements[name] = url(exports.join(";") + `\n// isolated dependency bindings for ${file}`)
  }
  for (const [name, replacement] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return import(url(output))
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.footer), ...all(node.props?.actions)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const render = (Component, props = {}) => { cursor = 0; tree = Component(props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
const reset = () => { effects.forEach(effect => effect?.cleanup?.()); slots = []; effects = []; pending = [] }
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected a calendar filter control"); return node }
const has = predicate => all(tree).some(predicate)
const named = name => node => node.type?.name === name
let replaced = [], listeners = {}
const setLocation = (pathname, search) => { listeners = {}; globalThis.window = { location: { pathname, search, hash: "" }, history: { state: null, replaceState(_state, _title, path) { replaced.push(path); const next = new URL(path, "https://buildtrack.test"); Object.assign(window.location, { pathname: next.pathname, search: next.search, hash: next.hash }) } }, addEventListener(name, fn) { listeners[name] = fn }, removeEventListener(name) { delete listeners[name] } } }
const october = { from: "2026-10-01", to: "2026-10-31" }
Object.assign(deps, { buttonSecondary: "secondary", buttonPrimary: "primary", inputClass: "field" })

// ---- The control: quick choices, Pick dates..., validation and Clear dates ----
const Filter = (await compile("../src/components/ui/DateRangeFilter.tsx", { "../../lib/dateRangeModel": model })).default
let chosen
const filterProps = range => ({ label: "Due date", range, presets: ["all", "thisWeek", "thisMonth", "next30"], today: "2026-10-22", onChange: next => { chosen = next } })
reset(); render(Filter, filterProps(allDates))
assert.equal(find(node => node.type === "select").props.value, "all")
assert.deepEqual(all(find(node => node.type === "select").props.children).filter(node => node.type === "option").map(node => node.props.value), ["all", "thisWeek", "thisMonth", "next30", "custom"])
assert.ok(!has(node => node.type === "input") && !has(node => text(node) === "Clear dates"), "no date boxes or clear button until needed")
find(node => node.type === "select").props.onChange({ target: { value: "thisMonth" } }); assert.deepEqual(chosen, october)
find(node => node.type === "select").props.onChange({ target: { value: "custom" } }); render(Filter, filterProps(allDates))
assert.equal(all(tree).filter(node => node.type === "input" && node.props.type === "date").length, 2, "Pick dates... opens From and To")
reset(); render(Filter, filterProps({ from: "2026-10-20", to: "2026-10-01" }))
assert.match(text(find(node => node.props?.role === "alert")), /end date must be on or after/); assert.equal(find(node => node.type === "input").props["aria-invalid"], true)
reset(); render(Filter, filterProps(october)); assert.equal(find(node => node.type === "select").props.value, "thisMonth")
find(node => node.type === "button" && text(node) === "Clear dates").props.onClick(); assert.deepEqual(chosen, allDates)

// ---- Progress by zone: work due in the chosen dates, per zone and discipline; CSV and the address follow ----
const sheets = [{ id: "A", title: "Ground floor", level: "1", discipline: "civil" }, { id: "B", title: "Roof", level: "R", discipline: null }]
const pin = (id, blueprint_id, status, due_date, extra = {}) => ({ id, blueprint_id, status, due_date, category: "progress", title: id, discipline: null, assigned_to: null, verified_at: null, ...extra })
const pins = [
  pin("a1", "A", "verified", "2026-10-10", { verified_at: "2026-10-12T02:00:00Z" }),
  pin("a2", "A", "in_progress", "2026-10-20"),
  pin("b1", "B", "not_started", "2026-11-15"),
  pin("a3", "A", "in_progress", null),
  pin("b2", "B", "verified", "2026-09-30", { verified_at: "2026-10-02T03:00:00Z" }),
  pin("n1", "A", "not_started", "2026-10-05", { category: "note" }),
]
let csv = null
Object.assign(deps, {
  ...progress, downloadCsv: (name, content) => { csv = { name, content } },
  getSelectedProjectId: () => "P", disciplineLabels: { civil: "Civil" }, statusDot: {}, statusLabels: { not_started: "Not started", in_progress: "In progress", for_review: "For review", issue: "Issue", verified: "Completed" },
  useProjectWork: () => ({ project: { code: "PRJ", start_date: "2026-09-01", end_date: "2026-12-31" }, blueprints: sheets, pins, today: "2026-10-22", loading: false, error: "", reload: async () => {}, sheetOf: id => id, nameOf: () => "Foreman" }),
})
const Progress = (await compile("../src/pages/Engineer/EngineerProgress.tsx", { "../../lib/dateRangeModel": model })).default
const card = label => find(node => named("StatCard")(node) && node.props.label === label)
setLocation("/engineer/progress", "?project=P"); replaced = []
reset(); render(Progress, { onNavigate() {} })
assert.equal(card("Verified").props.note, "2 of 5 work pins", "unfiltered: every work pin, notes left out")
assert.equal(find(named("DateRangeFilter")).props.label, "Due date"); assert.deepEqual(find(named("DateRangeFilter")).props.presets, ["all", "thisWeek", "thisMonth", "lastMonth", "next30", "last30"])
find(named("DateRangeFilter")).props.onChange(october); render(Progress, { onNavigate() {} })
assert.deepEqual(replaced.at(-1), "/engineer/progress?project=P&from=2026-10-01&to=2026-10-31", "the dates stay in the address")
assert.equal(card("Verified").props.note, "1 of 2 work pins", "only work due in October counts"); assert.equal(card("Verified").props.value, "50%")
assert.equal(all(tree).filter(node => node.type === "article").length, 1, "zones with nothing due are hidden")
assert.match(text(tree), /1 sheet has no work due on these dates/)
const summary = text(find(node => node.type === "p" && /Work due 1 Oct 2026 to 31 Oct 2026/.test(text(node))))
assert.match(summary, /2 work pins verified on these dates/, "verified in October counts any due date (b2 was due in September)")
assert.match(summary, /1 work pin has no due date and is left out/)
assert.ok(has(node => node.type === "h2" && text(node) === "Work due 1 Oct 2026 to 31 Oct 2026"))
assert.equal(find(named("SCurveChart")).props.pins, pins, "the S-curve stays whole-project")
find(node => node.type === "button" && text(node) === "Export CSV").props.onClick()
assert.equal(csv.name, "progress-PRJ-2026-10-22-due-2026-10-01-to-2026-10-31.csv"); assert.match(csv.content, /Ground floor/); assert.doesNotMatch(csv.content, /Roof/)
find(named("DateRangeFilter")).props.onChange({ from: "2026-12-01", to: "2026-12-31" }); render(Progress, { onNavigate() {} })
const empty = find(node => named("EmptyState")(node) && node.props.title === "No work due on these dates")
empty.props.action.props.onClick(); render(Progress, { onNavigate() {} })
assert.equal(card("Verified").props.note, "2 of 5 work pins", "Show all dates clears the filter"); assert.equal(replaced.at(-1), "/engineer/progress?project=P")
setLocation("/engineer/progress", "?project=P&from=2026-11-01&to=2026-11-30")
reset(); render(Progress, { onNavigate() {} })
assert.equal(card("Verified").props.note, "0 of 1 work pins", "a shared link opens with its dates"); assert.match(text(find(node => node.type === "article")), /Roof/)

// ---- QA register view: one filter for the Overview and registers, labelled by the date each one reads ----
Object.assign(deps, { useSnags: () => ({ snags: [], loading: false, error: "", reload: async () => {} }) })
const View = (await compile("../src/components/qa/QaView.tsx", { "../../lib/dateRangeModel": model })).default
const ws = { projectId: "P", loading: false, error: "", inspections: [], defects: [], today: "2026-10-22", project: null, nameOf: () => "", reloadAll: async () => {}, work: { pins: [] }, templates: [], foremen: [], weights: {}, threshold: 85, standards: [] }
setLocation("/engineer/qa", "?project=P&tab=inspections&from=2026-10-01&to=2026-10-31"); replaced = []
const viewProps = { ws, mode: "engineer", tabs: ["overview", "inspections", "defects", "snags"], dateFilter: true }
reset(); render(View, viewProps)
assert.equal(find(named("DateRangeFilter")).props.label, "Requested date"); assert.deepEqual(find(named("InspectionsPanel")).props.dates, october)
assert.equal(find(named("InspectionsPanel")).props.mode, "engineer", "QA register uses Requested-first inspection filters")
const tab = name => find(node => node.props?.role === "tab" && text(node).startsWith(name))
tab("NCR register").props.onClick(); render(View, viewProps)
assert.equal(find(named("DateRangeFilter")).props.label, "Raised date"); assert.deepEqual(find(named("DefectsPanel")).props.dates, october, "the dates carry over between registers")
tab("Client reports").props.onClick(); render(View, viewProps)
assert.equal(find(named("DateRangeFilter")).props.label, "Reported date"); assert.deepEqual(find(named("SnagsPanel")).props.dates, october)
find(named("DateRangeFilter")).props.onChange({ from: "2026-10-19", to: "2026-10-25" }); render(View, viewProps)
assert.equal(replaced.at(-1), "/engineer/qa?project=P&tab=inspections&from=2026-10-19&to=2026-10-25"); assert.deepEqual(find(named("SnagsPanel")).props.dates, { from: "2026-10-19", to: "2026-10-25" })
tab("Overview").props.onClick(); render(View, viewProps)
assert.equal(find(named("DateRangeFilter")).props.label, "Overview date")
assert.deepEqual(find(named("OverviewPanel")).props.dates, { from: "2026-10-19", to: "2026-10-25" })
find(named("DateRangeFilter")).props.onChange(allDates); render(View, viewProps)
assert.deepEqual(find(named("OverviewPanel")).props.dates, allDates, "clearing dates restores the whole-project Overview")
Object.assign(window.location, { search: "?project=P&tab=overview&from=2026-09-01&to=2026-09-30" }); listeners.popstate(); render(View, viewProps); render(View, viewProps)
assert.deepEqual(find(named("OverviewPanel")).props.dates, { from: "2026-09-01", to: "2026-09-30" }, "Back / Forward restores the calendar")
find(named("DateRangeFilter")).props.onChange({ from: "2026-10-31", to: "2026-10-01" }); render(View, viewProps)
assert.deepEqual(find(named("OverviewPanel")).props.dates, allDates, "invalid dates never yield a misleading filtered summary")
setLocation("/engineer/qa", "?project=P&tab=overview&from=2026-10-01&to=2026-10-31")
reset(); render(View, viewProps)
assert.deepEqual(find(named("OverviewPanel")).props.dates, october, "Overview supports shared date-filter links")
setLocation("/foreman/quality-control", "?project=P&from=2026-10-01&to=2026-10-31")
reset(); render(View, { ws, mode: "foreman", tabs: ["inspections"] })
assert.ok(!has(named("DateRangeFilter")), "Foreman pages are unchanged"); assert.deepEqual(find(named("InspectionsPanel")).props.dates, allDates)

// Engineer completion and history share the register navigation and keep their own content.
const completionProps = { ...viewProps, tabs: ["inspections", "defects", "complete", "completed", "snags"], workTabs: {
  complete: { count: 2, content: "Ready checklist content" }, completed: { count: 8, content: "Completed checklist history" },
} }
setLocation("/engineer/qa", "?project=P&tab=complete")
reset(); render(View, completionProps)
assert.equal(tab("Complete checklist").props["aria-selected"], true)
assert.equal(text(tab("Complete checklist")), "Complete checklist2")
assert.match(text(tree), /Ready checklist content/); assert.doesNotMatch(text(tree), /Completed checklist history|Review queue/)
assert.ok(!has(named("DateRangeFilter")), "Requested/raised date filters never imply they filter completion dates")
tab("Completed").props.onClick(); render(View, completionProps)
assert.match(text(tree), /Completed checklist history/); assert.doesNotMatch(text(tree), /Ready checklist content/)
tab("Inspections").props.onClick(); render(View, completionProps)
assert.ok(has(named("InspectionsPanel")) && has(named("DateRangeFilter")))
assert.doesNotMatch(text(tree), /Completed checklist history|Ready checklist content/)

// ---- Panels: NCR register by raised day (Manila), inspections by requested day, client reports by reported day ----
Object.assign(deps, {
  ...qaModel, ...progress, downloadCsv: (name, content) => { csv = { name, content } }, useAuth: () => ({ profile: { id: "eng" } }),
  useQaSubmissionIndex: () => ({ rows: [], loading: false, error: "", reload: async () => {} }), checklistGroups: () => [], checklistNames: () => [],
  useQaOverviewItems: () => overviewItems, useToast: () => ({ error: message => assert.fail(message) }), qaSummaryHtml, printHtml: html => { printed = html; return true },
})
let overviewItems = { items: [], loading: false, error: "", reload: async () => {} }, printed
const Panels = await compile("../src/components/qa/QaPanels.tsx", { "../../lib/dateRangeModel": model, "../../lib/qaOverviewModel": new URL("../src/lib/qaOverviewModel.ts", import.meta.url).href })
const defect = (id, number, raised_at) => ({ id, number, raised_at, title: `Defect ${number}`, description: null, reference: null, status: "open", severity: "minor", trade: "general", category: "workmanship", assigned_to: "fore", due_date: "2026-11-30", closed_at: null, root_cause: null, corrective_action: null, closing_note: null })
const registerWs = { ...ws, project: { code: "PRJ" }, nameOf: () => "Foreman", defects: [defect("d1", 1, "2026-10-03T01:00:00Z"), defect("d2", 2, "2026-09-28T05:00:00Z"), defect("d3", 3, "2026-10-31T16:30:00Z")] }
const rows = () => all(tree).filter(node => node.type === "tr" && node.props.tabIndex === 0)
reset(); render(Panels.DefectsPanel, { ws: registerWs, mode: "engineer", onOpen() {}, onNew: null, dates: october })
assert.deepEqual(rows().map(row => row.key), ["d1"], "raised 1 Nov 00:30 Manila is not October")
find(node => node.type === "button" && text(node) === "Export CSV").props.onClick()
assert.match(csv.content, /NCR-0001/); assert.doesNotMatch(csv.content, /NCR-0002|NCR-0003/, "the CSV follows the dates")
reset(); render(Panels.DefectsPanel, { ws: registerWs, mode: "engineer", onOpen() {}, onNew: null })
assert.equal(rows().length, 3, "no dates = the whole register")
reset(); render(Panels.DefectsPanel, { ws: registerWs, mode: "engineer", onOpen() {}, onNew: null, dates: { from: "2026-12-01", to: "" } })
assert.equal(text(find(named("EmptyState"))), "Change the dates, the filters or the search.")
const inspection = (id, number, requested_at) => ({ id, number, requested_at, title: `Check ${number}`, location: null, trade: "general", status: "requested", score: null, threshold: null, requested_by: "fore", inspector_id: null, completed_at: null, target_at: null, reinspection_of: null })
reset(); render(Panels.InspectionsPanel, { ws: { ...registerWs, inspections: [inspection("i1", 1, "2026-10-05T01:00:00Z"), inspection("i2", 2, "2026-09-01T01:00:00Z")] }, canRequest: false, onOpen() {}, onNew() {}, dates: october })
assert.deepEqual(all(tree).filter(node => node.type === "tr" && node.key).map(row => row.key), ["i1"])
Object.assign(deps, { refNumber: qaModel.refNumber })
const Snags = await compile("../src/components/qa/SnagPanel.tsx", { "../../lib/dateRangeModel": model })
const snag = (id, number, created_at, status = "submitted") => ({ id, number, created_at, status, title: `Report ${number}`, author_id: "client", location: null, urgency: "normal" })
const snagProps = dates => ({ snags: [snag("s1", 1, "2026-10-04T01:00:00Z"), snag("s2", 2, "2026-08-04T01:00:00Z")], loading: false, error: "", nameOf: () => "Client", onOpen() {}, dates })
reset(); render(Snags.SnagsPanel, snagProps(october))
assert.equal(all(tree).filter(node => node.type === "li").length, 1)
reset(); render(Snags.SnagsPanel, snagProps({ from: "2026-12-01", to: "2026-12-31" }))
assert.equal(find(named("EmptyState")).props.title, "Nothing in these dates")

// ---- Overview summary: matching server formulas, accurate item denominator and independently filtered NCR cohort ----
const selectedInspections = [
  { ...inspection("pass", 1, "2026-10-04T00:00:00Z"), status: "passed", score: 100, completed_at: "2026-10-06T00:00:00Z" },
  { ...inspection("fail", 2, "2026-10-05T00:00:00Z"), status: "failed", score: 50, completed_at: "2026-10-07T00:00:00Z" },
  { ...inspection("redo", 3, "2026-10-06T00:00:00Z"), status: "passed", score: 100, reinspection_of: "fail", completed_at: "2026-10-08T00:00:00Z" },
  inspection("waiting", 4, "2026-10-07T00:00:00Z"),
  { ...inspection("cancel", 5, "2026-10-08T00:00:00Z"), status: "cancelled" },
]
const selectedDefects = [
  { ...defect("oct-open", 1, "2026-10-04T00:00:00Z"), severity: "critical", due_date: "2026-10-10", trade: "electrical" },
  { ...defect("oct-closed", 2, "2026-10-05T00:00:00Z"), status: "closed", closed_at: "2026-10-07T00:00:00Z" },
  { ...defect("oct-verify", 3, "2026-10-06T00:00:00Z"), status: "for_verification", severity: "major" },
]
const itemResults = [{ inspection_id: "pass", result: "pass" }, { inspection_id: "fail", result: "fail" }, { inspection_id: "fail", result: "pass" }, { inspection_id: "redo", result: "pass" }, { inspection_id: "fail", result: "na" }, { inspection_id: "waiting", result: "fail" }, { inspection_id: "cancel", result: "fail" }, { inspection_id: "outside", result: "fail" }]
const overviewSummary = qaOverviewSummary(selectedInspections, selectedDefects, itemResults, ws.today)
assert.equal(overviewSummary.inspections.total, 4); assert.equal(overviewSummary.inspections.first_pass_rate, 50, "re-inspections do not inflate first-time pass rate")
assert.equal(overviewSummary.inspections.average_score, 83.3)
assert.deepEqual(overviewSummary.items, { checked: 4, failed: 1, defects_per_100_items: 25 }, "only pass/fail results on completed selected inspections count")
assert.equal(overviewSummary.defects.open, 2); assert.equal(overviewSummary.defects.overdue, 1); assert.equal(overviewSummary.defects.average_days_to_close, 2)
assert.equal(overviewSummary.defects.for_verification, 1)
assert.equal(overviewSummary.by_trade.find(row => row.trade === "electrical").open_defects, 1, "standalone NCR trades are not dropped")
assert.ok(overviewSummary.recent.every(row => row.status !== "cancelled"))
assert.equal(qaOverviewSummary([], [], [], ws.today).inspections.first_pass_rate, null)
assert.equal(qaOverviewSummary([], [], [], ws.today).items.defects_per_100_items, null)

const oldInspection = { ...inspection("outside", 6, "2026-09-30T15:59:59Z"), status: "failed", score: 0, completed_at: "2026-10-20T00:00:00Z" }
const oldDefect = { ...defect("outside-ncr", 4, "2026-09-20T00:00:00Z"), status: "for_verification", severity: "critical" }
const overviewWs = { ...registerWs, summaryLoading: false, inspections: [...selectedInspections, oldInspection], defects: [...selectedDefects, oldDefect] }
overviewWs.summary = qaOverviewSummary(overviewWs.inspections, overviewWs.defects, itemResults, ws.today)
overviewItems = { ...overviewItems, items: itemResults }
const overviewProps = { ws: overviewWs, mode: "engineer", dates: october, onOpenInspection() {}, onOpenDefect() {}, onGo() {} }
reset(); render(Panels.OverviewPanel, overviewProps)
assert.equal(card("First-time pass rate").props.value, "50%")
assert.equal(card("Waiting for inspection").props.value, 1); assert.equal(card("Open NCRs").props.value, 2)
assert.equal(card("Defects per 100 checks").props.value, 25); assert.equal(card("Re-inspections").props.value, 1)
assert.deepEqual(find(named("DefectTrends")).props.defects.map(row => row.id), selectedDefects.map(row => row.id))
assert.deepEqual(find(named("DefectTrends")).props.dates, october)
assert.doesNotMatch(text(tree), /NCR-0004/, "out-of-period attention entries are excluded")
find(node => node.type === "button" && text(node) === "Print summary").props.onClick()
assert.match(printed, /Period \(Manila\)/); assert.match(printed, /1 Oct 2026 to 31 Oct 2026/); assert.match(printed, /25/); assert.doesNotMatch(printed, /NCR-0004/)
reset(); render(Panels.OverviewPanel, { ...overviewProps, dates: allDates })
assert.equal(card("First-time pass rate").props.value, "33.3%", "All dates restores server figures")
reset(); render(Panels.OverviewPanel, { ...overviewProps, dates: { from: "2026-12-01", to: "2026-12-31" } })
assert.equal(find(named("EmptyState")).props.title, "No QA records in these dates"); assert.equal(card("Open NCRs").props.value, 0)
overviewItems = { ...overviewItems, loading: true }; reset(); render(Panels.OverviewPanel, overviewProps)
assert.ok(has(named("SkeletonKpis")) && !has(named("StatCard")), "never show an inaccurate zero item count while loading")
overviewItems = { ...overviewItems, loading: false, error: "Could not load the filtered quality summary." }; reset(); render(Panels.OverviewPanel, overviewProps)
assert.ok(has(node => node.props?.role === "alert") && !has(named("StatCard")), "read failure does not fall back to whole-project figures")

// Filtered chart: all selected dates, including old ranges, single days, open ends and long ranges; no outside closure dates.
const longDates = { from: "2025-01-01", to: "2026-12-31" }
let buckets = qaOverviewTrend(selectedDefects, ws.today, october)
assert.equal(buckets[0].start, october.from); assert.equal(buckets.at(-1).end, october.to)
assert.equal(buckets.reduce((sum, row) => sum + row.raised, 0), 3); assert.equal(buckets.reduce((sum, row) => sum + row.closed, 0), 1)
buckets = qaOverviewTrend(selectedDefects, ws.today, longDates); assert.ok(buckets.length <= 8); assert.equal(buckets[0].start, longDates.from); assert.equal(buckets.at(-1).end, longDates.to)
assert.equal(qaOverviewTrend(selectedDefects, ws.today, { from: "2026-10-04", to: "2026-10-04" }).length, 1)
assert.equal(qaOverviewTrend(selectedDefects, ws.today, { from: "2026-10-04", to: "2026-10-04" })[0].raised, 1)
buckets = qaOverviewTrend([{ ...selectedDefects[0], closed_at: "2026-11-01T00:00:00Z", status: "closed" }], ws.today, october)
assert.equal(buckets.reduce((sum, row) => sum + row.closed, 0), 0)
assert.equal(qaOverviewTrend([], ws.today, { from: "", to: "2025-01-01" })[0].start, "2025-01-01")
assert.equal(qaOverviewTrend([], ws.today, { from: "2027-01-01", to: "" })[0].start, "2027-01-01")
assert.deepEqual(qaOverviewTrend([], ws.today, { from: "9999-12-31", to: "9999-12-31" }), [{ start: "9999-12-31", end: "9999-12-31", raised: 0, closed: 0 }], "valid extreme dates terminate without stepping beyond the calendar")
assert.equal(qaOverviewTrend(selectedDefects, ws.today).length, 8, "unfiltered chart stays last eight weeks")

// Read hook: paginated, project-scoped, minimal columns, errors / retry and late project responses.
let reads = [], queue = [], sourceSubscriptions = [], periodicKey
const api = { from(table) { const read = { table }; const query = { select(columns) { read.columns = columns; return query }, eq(column, value) { read[column] = value; return query }, order(column) { read.order = column; return query }, range(from, to) { reads.push({ ...read, from, to }); return queue.shift() ?? Promise.resolve({ data: [], error: null }) } }; return query } }
Object.assign(deps, { supabase: api, byProject: (table, projectId) => projectId ? [{ table, filter: `project_id=eq.${projectId}` }] : [], useLiveReload: sources => { sourceSubscriptions = sources }, usePeriodicReload: key => { periodicKey = key } })
const Hook = (await compile("../src/lib/qaOverview.ts", { "./paging": new URL("../src/lib/paging.ts", import.meta.url).href })).useQaOverviewItems
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
reset(); reads = []; queue = [Promise.resolve({ data: Array.from({ length: 1000 }, () => itemResults[0]), error: null }), Promise.resolve({ data: [itemResults[1]], error: null })]
render(Hook, "P"); await settle(); render(Hook, "P")
assert.equal(tree.items.length, 1001); assert.equal(reads.length, 2); assert.deepEqual(reads[0], { table: "qa_inspection_items", columns: "inspection_id,result", project_id: "P", order: "id", from: 0, to: 999 })
assert.equal(reads[1].from, 1000); assert.equal(tree.loading, false)
assert.ok(sourceSubscriptions.some(source => source.table === "qa_inspection_items")); assert.equal(periodicKey, "P")
queue = [Promise.resolve({ data: null, error: { message: "denied" } })]; await tree.reload(); render(Hook, "P")
assert.match(tree.error, /Could not load/); assert.deepEqual(tree.items, [])
queue = [Promise.resolve({ data: [itemResults[0]], error: null })]; await tree.reload(); render(Hook, "P"); assert.equal(tree.error, ""); assert.equal(tree.items.length, 1)
let resolveOld
queue = [new Promise(resolve => { resolveOld = resolve })]; const oldRead = tree.reload()
queue = [Promise.resolve({ data: [itemResults[1]], error: null })]; render(Hook, "Q")
assert.deepEqual(tree.items, [], "old project is masked before effect cleanup"); assert.equal(tree.loading, true)
await settle(); render(Hook, "Q"); assert.equal(tree.items[0].result, "fail")
resolveOld({ data: [itemResults[0]], error: null }); await oldRead; render(Hook, "Q"); assert.equal(tree.items[0].result, "fail", "late old-project read is discarded")
const readCount = reads.length; render(Hook, null); await settle(); render(Hook, null)
assert.equal(reads.length, readCount, "all-date Overview adds no item query"); assert.equal(tree.loading, false); assert.deepEqual(tree.items, [])
queue = Array.from({ length: 50 }, () => Promise.resolve({ data: Array.from({ length: 1000 }, () => itemResults[0]), error: null }))
render(Hook, "large"); for (let i = 0; i < 100; i++) await settle(); render(Hook, "large")
assert.match(tree.error, /record limit/); assert.deepEqual(tree.items, [], "never report partial totals when the paging cap is reached")
reset()

console.log("Calendar filters: presets / custom / validation / clear; Progress due dates and CSV; QA Overview and registers share dates and URL / history; Overview cards, current-state cohorts, real inspection-item denominator, attention, recent, trends and print; loading/error/empty states; minimal project-scoped paginated reads, retry and stale-response protection; Foreman pages unchanged")
