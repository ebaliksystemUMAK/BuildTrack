import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { siteLogReports, filterSiteLogs } from "../src/lib/siteReportsModel.ts"
import { reportableDates, weatherLabels, linkedWorkLabel } from "../src/lib/reportFormat.ts"
import { workItemPath } from "../src/lib/workItemModel.ts"
import { hitPath } from "../src/lib/projectSearchModel.ts"

const report = (id, status = "submitted", review_state = "pending", project_id = "A") => ({ id, project_id, author_id: "foreman", report_date: "2026-10-19", status, review_state, work_done: id, weather: "sunny", workers_count: 4, linked_work: [] })
const records = [report("daily"), report("reviewed", "submitted", "reviewed"), report("returned", "draft", "returned"), report("private", "draft"), report("foreign", "submitted", "pending", "B")]
assert.deepEqual(siteLogReports(records, "A").map(row => row.id), ["daily", "reviewed", "returned"])
const filter = { query: "", state: "all", from: "", to: "" }, author = () => "Synthetic Foreman", links = () => "Kitchen FLOOR"
assert.equal(filterSiteLogs(siteLogReports(records, "A"), { ...filter, state: "returned" }, author, links)[0].id, "returned")
for (const query of ["2026-10-19", "Foreman", "FLOOR"]) assert.equal(filterSiteLogs([records[0]], { ...filter, query }, author, links).length, 1)
assert.equal(filterSiteLogs(records, { ...filter, from: "2026-10-20" }, author, links).length, 0)
assert.equal(filterSiteLogs(records, { ...filter, from: "2026-10-20", to: "2026-10-18" }, author, links).length, 0)
assert.match(hitPath("engineer", "log", "daily", "A"), /project=A&report=daily/)
assert.match(hitPath("foreman", "log", "daily", "A"), /project=A&report=daily/)

const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], effects = [], pending = [], cursor = 0, requests = [], live = [], periodic = [], result, tree
globalThis.__recordHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial } },
  useCallback(fn, deps) { const n = cursor++, old = slots[n]; if (!old || deps.some((value, i) => value !== old.deps[i])) slots[n] = { fn, deps }; return slots[n].fn },
  useMemo: fn => fn(),
  useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
}
const deferred = spec => new Promise((resolve, reject) => requests.push({ ...spec, resolve, reject }))
const db = {
  rpc: (name, args) => deferred({ name, args }),
  from(table) {
    const spec = { table, filters: [], range: [] }
    const chain = {
      select() { return chain }, eq(key, value) { spec.filters.push([key, value]); return chain }, order() { return chain },
      range(from, to) { spec.range = [from, to]; return chain }, maybeSingle() { return chain },
      then(resolve, reject) { return deferred(spec).then(resolve, reject) },
    }; return chain
  },
}
globalThis.__recordDeps = {
  supabase: db, byProject: (table, id) => id ? [{ table, filter: `project_id=eq.${id}` }] : [], byColumn: () => [],
  useLiveReload: (sources, fn) => live.push({ sources, fn }), usePeriodicReload: (key, fn) => periodic.push({ key, fn }),
}
async function compile(file, overrides = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const replacements = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...overrides }
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (name in replacements) continue
    if (declaration.importClause.name) exports.push("export default function Stub(){return null}")
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__recordHooks" : "__recordDeps"}.${key} ?? function Stub(){return null}`)
    }
    replacements[name] = url(exports.join(";"))
  }
  for (const [name, replacement] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return import(url(output))
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.actions)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
function render(Component, props) { cursor = 0; result = Component(props); tree = result; const jobs = pending; pending = []; jobs.forEach(fn => fn()); return result }
function reset() { effects.forEach(effect => effect?.cleanup?.()); slots = []; effects = []; pending = []; requests = []; live = []; periodic = [] }
const tick = () => new Promise(resolve => setImmediate(resolve))
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected project records control"); return node }
const paging = new URL("../src/lib/paging.ts", import.meta.url).href
const format = new URL("../src/lib/reportFormat.ts", import.meta.url).href
const reports = await compile("../src/lib/reports.ts", { "./paging": paging, "./reportFormat": format })
render(reports.useDailyReports, "A"); await tick()
assert.deepEqual(requests[0].filters, [["project_id", "A"]])
requests[0].resolve({ data: Array.from({ length: 1000 }, (_, i) => report(`row-${i}`)), error: null }); await tick()
assert.deepEqual(requests[1].range, [1000, 1999])
requests[1].resolve({ data: [report("last")], error: null }); await tick()
render(reports.useDailyReports, "A"); assert.equal(result.reports.length, 1001)
assert.ok(periodic.some(row => row.key === "reports:A"))
const oldLoad = result.reload(); await tick(); const oldRequest = requests.at(-1)
render(reports.useDailyReports, "B"); assert.equal(result.reports.length, 0); assert.equal(result.loading, true); await tick()
const newRequest = requests.at(-1)
oldRequest.resolve({ data: [report("late-A")], error: null }); await oldLoad
render(reports.useDailyReports, "B"); assert.equal(result.reports.length, 0)
newRequest.resolve({ data: [report("B-record", "submitted", "pending", "B")], error: null }); await tick()
render(reports.useDailyReports, "B"); assert.equal(result.reports[0].id, "B-record")
const failedLoad = result.reload(); await tick(); requests.at(-1).resolve({ data: null, error: new Error("offline") }); await failedLoad
render(reports.useDailyReports, "B"); assert.equal(result.reports.length, 0); assert.match(result.error, /Could not load/)

reset(); render(reports.useQuestions, "A"); await tick(); const oldQuestion = requests[0]
render(reports.useQuestions, "B"); await tick(); const newQuestion = requests[1]
oldQuestion.resolve({ data: [{ id: "old" }], error: null }); await tick(); render(reports.useQuestions, "B"); assert.equal(result.questions.length, 0)
newQuestion.resolve({ data: [{ id: "new" }], error: null }); await tick(); render(reports.useQuestions, "B"); assert.equal(result.questions[0].id, "new")

reset(); const Headcount = (await compile("../src/lib/reportAttendance.ts")).useReportAttendance
render(() => Headcount("A", "2026-10-21")); const oldCount = requests[0]
assert.deepEqual(oldCount.args, { p_project: "A", p_day: "2026-10-21" })
render(() => Headcount("A", "2026-10-20")); assert.equal(result.count, null); assert.equal(result.loading, true)
const currentCount = requests[1]
oldCount.resolve({ data: 99, error: null }); await tick(); render(() => Headcount("A", "2026-10-20")); assert.equal(result.count, null)
currentCount.resolve({ data: 7, error: null }); await tick(); render(() => Headcount("A", "2026-10-20")); assert.equal(result.count, 7)
assert.ok(live.at(-1).sources.some(source => source.table === "biometric_attendance_events"))
const countRetry = result.reload(); requests.at(-1).resolve({ data: null, error: { message: "offline" } }); await countRetry
render(() => Headcount("A", "2026-10-20")); assert.equal(result.count, null); assert.match(result.error, /Could not load/)
const beforeHistorical = requests.length
render(() => Headcount("A", "2026-10-20", false)); assert.equal(result.loading, false); assert.equal(requests.length, beforeHistorical, "Historical reports never substitute live headcounts")

reset(); const projects = await compile("../src/lib/projects.ts")
render(projects.useProjectTeam, "A"); const oldTeam = requests[0]
render(projects.useProjectTeam, "B"); assert.equal(result.team.length, 0)
oldTeam.resolve({ data: [{ user_id: "old" }], error: null }); await tick(); render(projects.useProjectTeam, "B"); assert.equal(result.team.length, 0)
requests[1].resolve({ data: [{ user_id: "current" }], error: null }); await tick(); render(projects.useProjectTeam, "B"); assert.equal(result.team[0].user_id, "current")
const teamReload = result.reload(); requests.at(-1).resolve({ data: null, error: new Error("access") }); await teamReload
render(projects.useProjectTeam, "B"); assert.match(result.error, /Retry before assigning/); assert.equal(result.team.length, 0)

reset(); const daily = await compile("../src/lib/dailyPhotos.ts", { "./paging": paging })
render(() => daily.useProjectWorkItems("A", true)); await tick(); requests[0].resolve({ data: [{ id: "floor", pin_id: "pin", review_status: "for_review" }], error: null }); await tick()
render(() => daily.useProjectWorkItems("A", true)); assert.equal(result[0].review_status, "for_review")
live.at(-1).fn(); await tick(); requests.at(-1).resolve({ data: [{ id: "floor", pin_id: "pin", review_status: "verified" }], error: null }); await tick()
render(() => daily.useProjectWorkItems("A", true)); assert.equal(result[0].review_status, "verified", "A checklist completion refreshes linked report status")
render(() => daily.useProjectWorkItems("B", true)); assert.equal(result.length, 0)

reset(); let teamError = "", teamLoading = true, reloaded = []
Object.assign(globalThis.__recordDeps, {
  useProject: () => ({ project: { id: "A" }, loading: false }),
  useBlueprints: () => ({ blueprints: [{ id: "sheet", project_id: "A" }, { id: "other", project_id: "B" }], reload: async () => { reloaded.push("sheets") } }),
  useProjectPins: () => ({ pins: [{ id: "pin", project_id: "A" }, { id: "other", project_id: "B" }], setPins() {}, reload: async () => { reloaded.push("pins") } }),
  useProjectTeam: () => ({ team: [], loading: teamLoading, error: teamError, reload: async () => { reloaded.push("team") } }),
  manilaToday: () => "2026-10-21",
})
const projectWork = (await compile("../src/lib/projectWork.ts")).useProjectWork
render(projectWork, "A"); assert.equal(result.loading, true); assert.equal(result.pins.length, 1); assert.equal(result.blueprints.length, 1)
teamLoading = false; teamError = "Team unavailable"
render(projectWork, "A"); assert.equal(result.error, "Team unavailable")
teamError = ""; render(projectWork, "A"); await result.reload()
assert.deepEqual(reloaded, ["sheets", "pins", "team"], "Retry/save refreshes assignments and team together")

reset()
const originalWindow = globalThis.window, originalDocument = globalThis.document
let timer, cleared = 0, windowEvents = new Map(), documentEvents = new Map(), refreshes = 0
globalThis.window = { location: { search: "?report=returned" }, setInterval: fn => { timer = fn; return 1 }, clearInterval: () => { cleared++ }, addEventListener: (name, fn) => windowEvents.set(name, fn), removeEventListener: name => windowEvents.delete(name) }
globalThis.document = { hidden: false, addEventListener: (name, fn) => documentEvents.set(name, fn), removeEventListener: name => documentEvents.delete(name) }
const realtime = await compile("../src/lib/realtime.ts")
render(() => realtime.usePeriodicReload("A", () => { refreshes++ }))
timer(); windowEvents.get("online")(); assert.equal(refreshes, 2)
document.hidden = true; timer(); assert.equal(refreshes, 2)
document.hidden = false; documentEvents.get("visibilitychange")(); assert.equal(refreshes, 3)
reset(); assert.ok(cleared); assert.equal(windowEvents.size, 0); assert.equal(documentEvents.size, 0)

const pin = { id: "pin", project_id: "A", blueprint_id: "sheet", title: "Kitchen", category: "progress", status: "in_progress", assigned_to: "foreman" }
let reportHeadcount = { count: 0, loading: false, error: "", reload: async () => {} }
const item = { id: "floor", pin_id: "pin", text: "FLOOR", review_status: "verified", position: 0 }
records[0].linked_work = [{ pin_id: "pin", item_id: "floor" }]
Object.assign(globalThis.__recordDeps, {
  siteLogReports, filterSiteLogs, linkedWorkLabel, workItemPath, reportableDates, weatherLabels,
  reportDateLong: value => value, manilaToday: () => "2026-10-21", getSelectedProjectId: () => "A",
  useProjectWork: () => ({ pins: [pin], team: [], project: { id: "A" }, blueprints: [], today: "2026-10-21", nameOf: author }),
  useProjectWorkItems: () => [item], useDailyReports: () => ({ reports: records, loading: false, reload: async () => {} }),
  useQuestions: () => ({ questions: [], loading: false }), useDefects: () => ({ defects: [] }), useInspections: () => ({ inspections: [] }),
  useToast: () => ({ error() {}, success() {} }), useConfirm: () => async () => true,
  followLink: (...args) => { globalThis.__lastReportLink = args },
  useAuth: () => ({ profile: { id: "foreman" } }), useProject: () => ({ project: { id: "A" } }), useProjectPins: () => ({ pins: [pin] }),
  useReportAttendance: () => reportHeadcount,
})
const Engineer = (await compile("../src/pages/Engineer/EngineerReports.tsx")).default
render(Engineer, { onNavigate() {} }); render(Engineer, { onNavigate() {} })
assert.match(text(tree), /Daily reports \(3\)/); assert.match(text(tree), /Showing 3 of 3/)
assert.deepEqual(all(tree).filter(node => node.type === "li").map(node => node.key), ["daily", "reviewed", "returned"], "Private drafts and other projects never enter the Engineer report list")
find(node => node.type === "input" && node.props["aria-label"] === "Search the logs").props.onChange({ target: { value: "FLOOR" } })
render(Engineer, { onNavigate() {} }); assert.match(text(tree), /Showing 1 of 3/)
find(node => node.type === "button" && text(node) === "Clear filters").props.onClick()
render(Engineer, { onNavigate() {} })
find(node => node.type === "select" && node.props["aria-label"] === "Filter report review").props.onChange({ target: { value: "returned" } })
render(Engineer, { onNavigate() {} }); assert.match(text(tree), /Showing 1 of 3/)

reset(); const ReviewPanel = (await compile("../src/components/DailyReportWorkflow.tsx")).ReportReviewPanel
render(ReviewPanel, { report: records[0], pins: [pin], nameOf: author, onChanged: async () => {} }); await tick()
requests.find(row => row.table === "biometric_daily_totals").resolve({ data: null, error: null })
requests.find(row => row.name === "attendance_day_summary").resolve({ data: { workers: 3, scans: 7 }, error: null }); await tick()
render(ReviewPanel, { report: records[0], pins: [pin], nameOf: author, onChanged: async () => {} })
assert.match(text(tree), /3 unique workers · 7 scans/)
find(node => node.type === "button" && text(node) === "Open checklist, QA and NCRs").props.onClick()
assert.deepEqual(globalThis.__lastReportLink, ["/engineer/verification?project=A&item=floor", "A"])
assert.match(text(tree), /Completed by the Engineer/)

reset(); const archived = { ...report("archive"), report_date: "2026-09-01" }
globalThis.__recordDeps.useDailyReports = () => ({ reports: [archived], loading: false, reload: async () => {} })
window.location.search = "?report=archive"
const Foreman = (await compile("../src/pages/Foreman/ForemanDailyProgressReport.tsx")).default
for (let n = 0; n < 3; n++) render(Foreman, {})
assert.match(text(tree), /2026-09-01/)
assert.match(text(tree), /Historical report.*Read only/)
assert.ok(!all(tree).some(node => node.type === "button" && text(node) === "Submit daily progress report"))
assert.equal(find(node => node.props?.["aria-label"] === "Biometric worker headcount").props.value, archived.workers_count, "Historical headcount is preserved")
reset(); globalThis.__recordDeps.useDailyReports = () => ({ reports: [], loading: false, reload: async () => {} })
// Recompile to bind the new report source; the component uses a read-only biometric count, never a typed value.
const EditableForeman = (await compile("../src/pages/Foreman/ForemanDailyProgressReport.tsx")).default
window.location.search = "?project=A"; reportHeadcount = { ...reportHeadcount, count: 7 }
render(EditableForeman, {}); render(EditableForeman, {})
const countInput = find(node => node.props?.["aria-label"] === "Biometric worker headcount")
assert.equal(countInput.props.value, 7); assert.equal(countInput.props.readOnly, true); assert.equal(countInput.props.onChange, undefined)
reportHeadcount = { ...reportHeadcount, count: null, error: "Could not load biometric headcount" }
render(EditableForeman, {})
assert.equal(find(node => node.type === "button" && text(node) === "Submit daily progress report").props.disabled, true)
reset(); globalThis.window = originalWindow; globalThis.document = originalDocument
delete globalThis.__recordHooks; delete globalThis.__recordDeps; delete globalThis.__lastReportLink
console.log("Project report pagination/scope/races, team refresh/error guards, reconnect polling, linked checklist status, report filters/privacy/deep links, real attendance reconciliation and historical Foreman reports passed")
