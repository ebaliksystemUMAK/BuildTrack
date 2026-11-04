import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { siteLogReports, filterSiteLogs } from "../src/lib/siteReportsModel.ts"
import { reportableDates, weatherLabels, linkedWorkLabel, reportEntries, blankEntry, carryForwardProgress, entryProblem, previousTaskProgress, reportProgressKey, savedEntries, saveReportArgs, dailyReportHtml, moveSummaryToTask } from "../src/lib/reportFormat.ts"
import { workItemPath } from "../src/lib/workItemModel.ts"
import { photosOutsideTasks } from "../src/lib/photoGalleryModel.ts"
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

// Task entries on a daily report: the rules mirror save_daily_report, and older links stay on the form.
const tiles = { ...blankEntry("e1", { pin_id: "pin", item_id: "floor" }), work_done: " Tiled the floor ", percent: 60, manpower: 5, notes: " Grouted ", issues: "Short of grout" }
const taskItems = [{ id: "floor", pin_id: "pin" }, { id: "wall", pin_id: "pin" }]
assert.deepEqual(reportEntries({ daily_report_entries: [{ ...tiles, id: "e2", item_id: "wall", position: 1 }, { ...tiles, position: 0 }], linked_work: [{ pin_id: "pin", item_id: "floor" }, { pin_id: "bare", item_id: null }] }, () => "new").map(entry => [entry.id, entry.pin_id, entry.item_id]),
  [["e1", "pin", "floor"], ["e2", "pin", "wall"], ["new", "bare", null]], "Saved entries in order, then links saved before entries existed")
assert.ok(!("position" in reportEntries({ daily_report_entries: [{ ...tiles, position: 0 }] }, () => "new")[0]), "The form never sends the position back")
const problem = (entry, submitting = false, all = [entry]) => entryProblem(entry, all, taskItems, submitting)
assert.equal(problem(tiles), ""); assert.equal(problem(tiles, true), "")
assert.match(problem(blankEntry("e")), /Choose the task/)
assert.match(problem({ ...tiles, item_id: null }), /task worked on/, "A pin with tasks needs one of them")
assert.equal(problem({ ...tiles, pin_id: "bare", item_id: null }), "", "A pin without tasks is reported as a whole")
assert.match(problem({ ...tiles, item_id: "deleted" }), /no longer available/)
assert.match(problem(tiles, false, [tiles, { ...tiles, id: "e2" }]), /already has an entry/)
assert.equal(problem({ ...tiles, percent: null }), "", "A draft may leave the percentage for later")
assert.match(problem({ ...tiles, percent: null }, true), /Enter the percentage/, "Submitting needs it")
assert.equal(problem({ ...tiles, work_done: "" }), "", "A draft may leave the work completed for later")
for (const work_done of ["", "  ", "abcd"]) assert.match(problem({ ...tiles, work_done }, true), /work completed on this task/, "Submitting needs it, with the same 5 characters as the report's rule")
assert.match(problem({ ...tiles, work_done: "x".repeat(2001) }), /under 2000/)
assert.deepEqual(moveSummaryToTask([tiles], "Old summary").map(entry => entry.work_done), [" Tiled the floor "], "Task text is never replaced")
const unwritten = [{ ...tiles, work_done: "" }, { ...tiles, id: "e2", work_done: "" }]
assert.deepEqual(moveSummaryToTask(unwritten, "Old summary").map(entry => entry.work_done), ["Old summary", ""], "An older summary moves to the first task")
assert.equal(moveSummaryToTask(unwritten, " "), unwritten, "Nothing to move"); assert.deepEqual(moveSummaryToTask([], "Old summary"), [])
assert.equal(reportEntries({ daily_report_entries: [{ ...tiles, work_done: undefined, position: 0 }] }, () => "new")[0].work_done, "", "An entry saved before this field reads as empty")
assert.equal(saveReportArgs({ projectId: "A", date: "2026-11-04", values: { weather: "sunny", work_done: "", status: "draft" }, entries: [{ ...tiles, work_done: undefined }] }).p_entries[0].work_done, "", "A copy queued before this field still sends")
for (const percent of [-1, 101, 12.5, Number.NaN]) assert.match(problem({ ...tiles, percent }), /0 to 100/)
assert.equal(problem({ ...tiles, percent: 0 }, true), ""); assert.equal(problem({ ...tiles, percent: 100 }, true), "")
for (const manpower of [-1, 5001, 1.5]) assert.match(problem({ ...tiles, manpower }), /0 to 5000/)
assert.match(problem({ ...tiles, notes: "x".repeat(2001) }), /under 2000/)
const args = saveReportArgs({ projectId: "A", date: "2026-11-04", values: { weather: "sunny", work_done: "Tiling", status: "draft" }, entries: [{ ...tiles, position: 3 }] })
assert.deepEqual(args.p_entries, [{ id: "e1", pin_id: "pin", item_id: "floor", work_done: "Tiled the floor", percent: 60, notes: "Grouted", issues: "Short of grout", manpower: 5 }], "Only the entry's own fields are sent, trimmed")
assert.deepEqual([args.p_project, args.p_date, args.p_weather, args.p_work_done, args.p_status], ["A", "2026-11-04", "sunny", "Tiling", "draft"])
assert.deepEqual(savedEntries({ daily_report_entries: [{ id: "b", position: 1 }, { id: "a", position: 0 }] }).map(entry => entry.id), ["a", "b"])
const printed = dailyReportHtml({ ...report("daily"), daily_report_entries: [{ ...tiles, position: 0 }], linked_work: [{ pin_id: "pin", item_id: "floor" }] }, { code: "A", name: "Project", location: null }, "Foreman", () => "Kitchen → FLOOR")
for (const part of ["Task progress", "Kitchen → FLOOR", "Tiled the floor", "60%", "Short of grout"]) assert.ok(printed.includes(part), `The print shows ${part}`)
assert.ok(!printed.includes("Linked work"), "Entries replace the plain list of links"); assert.ok(!printed.includes("Materials"), "Materials is no longer recorded")
assert.ok(dailyReportHtml({ ...report("daily"), linked_work: [{ pin_id: "pin", item_id: "floor" }] }, { code: "A", name: "Project", location: null }, "Foreman", () => "Kitchen").includes("Linked work"), "Older reports keep printing their links")

// Cumulative progress belongs to the task, and comes only from a prior submitted report in this project.
const progressReport = (id, date, percent, extra = {}, work = { pin_id: "pin", item_id: "floor" }) => ({
  ...report(id), report_date: date, submitted_at: `${date}T09:00:00Z`,
  daily_report_entries: [{ ...blankEntry(`entry-${id}`, work), percent, position: 0 }], ...extra,
})
const progressReports = [
  progressReport("older", "2026-10-17", 10), progressReport("latest", "2026-10-19", 15, { author_id: "previous-assignee" }),
  progressReport("draft", "2026-10-20", 90, { status: "draft" }), progressReport("returned", "2026-10-20", 80, { review_state: "returned" }),
  progressReport("removed", "2026-10-20", 90, { removed_at: "2026-10-20T12:00:00Z" }), progressReport("elsewhere", "2026-10-20", 60, { project_id: "B" }),
  progressReport("same-day", "2026-10-21", 75), progressReport("future", "2026-10-22", 80), progressReport("blank", "2026-10-20", null),
  progressReport("wall", "2026-10-18", 0, {}, { pin_id: "pin", item_id: "wall" }), progressReport("bare", "2026-10-19", 100, {}, { pin_id: "bare", item_id: null }),
]
const progressHistory = previousTaskProgress(progressReports, "A", "2026-10-21")
assert.equal(progressHistory.get(reportProgressKey(tiles)).percent, 15, "Use the most recent prior total, across gaps and assignee changes")
assert.equal(progressHistory.get("pin:wall").percent, 0); assert.equal(progressHistory.get("bare:").percent, 100)
assert.deepEqual([...previousTaskProgress([...progressReports].reverse(), "A", "2026-10-21")].sort(), [...progressHistory].sort(), "Report input ordering does not change the result")
assert.equal(previousTaskProgress(progressReports, "A", "2026-10-19").get("pin:floor").percent, 10, "A backdated report never carries future progress")
assert.equal(previousTaskProgress(progressReports, "other", "2026-10-21").size, 0)
const tied = [progressReport("a", "2026-10-19", 15), progressReport("b", "2026-10-19", 20), progressReport("c", "2026-10-19", 25, { submitted_at: "2026-10-19T10:00:00Z" })]
assert.equal(previousTaskProgress(tied.slice(0, 2), "A", "2026-10-21").get("pin:floor").percent, 20, "Entry id breaks submission ties like Gantt")
assert.equal(previousTaskProgress(tied, "A", "2026-10-21").get("pin:floor").percent, 25, "The latest submission on that day wins")
const filled = carryForwardProgress([{ ...tiles, percent: null }, { ...tiles, percent: 35 }, { ...tiles, percent: 0 }, blankEntry("unknown")], progressHistory)
assert.deepEqual(filled.map(entry => entry.percent), [15, 35, 0, null], "Only blank known work carries forward; saved totals and zero remain exact")
assert.deepEqual(carryForwardProgress(filled, progressHistory), filled, "Loading twice never adds the previous percentage twice")

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
      select(columns) { spec.columns = columns; return chain }, eq(key, value) { spec.filters.push([key, value]); return chain }, order() { return chain },
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
assert.equal(requests[0].columns, "*", "Clients and other readers never ask for task entries")
reset(); render(() => reports.useDailyReports("A", true)); await tick()
assert.equal(requests[0].columns, "*,daily_report_entries(*)", "The project team's pages do")
reset(); render(reports.useDailyReports, "A"); await tick()
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
let reportPhotos = []
const item = { id: "floor", pin_id: "pin", text: "FLOOR", review_status: "verified", position: 0 }
records[0].linked_work = [{ pin_id: "pin", item_id: "floor" }]
Object.assign(globalThis.__recordDeps, {
  siteLogReports, filterSiteLogs, linkedWorkLabel, workItemPath, reportableDates, weatherLabels,
  reportDateLong: value => value, manilaToday: () => "2026-10-21", getSelectedProjectId: () => "A",
  useProjectWork: () => ({ pins: [pin], team: [], project: { id: "A" }, blueprints: [], today: "2026-10-21", nameOf: author }),
  useProjectWorkItems: () => [item], useDailyReports: () => ({ reports: records, loading: false, reload: async () => {} }),
  reportEntries, blankEntry, carryForwardProgress, entryProblem, previousTaskProgress, saveReportArgs, moveSummaryToTask, photosOutsideTasks, useEvidencePhotos: () => ({ photos: reportPhotos, loading: false, error: "", reload: async () => {} }),
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
find(node => node.type === "button" && text(node) === "Open task, QA and NCRs").props.onClick()
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

// The real task entry editor: the Foreman's assigned work only, a task fills in its pin, several entries under one report.
reset(); Object.assign(globalThis.__recordDeps, { useConfirm: () => async () => true })
const { TaskProgressEditor, ReportEntriesView } = await compile("../src/components/DailyReportWorkflow.tsx", { "../lib/reportFormat": format })
const reportSection = () => all(tree).some(node => Array.isArray(node.props?.taskIds))
const entryReport = { ...report("daily"), daily_report_entries: [{ ...tiles, position: 0 }] }
render(ReportEntriesView, { report: entryReport, describe: () => "Kitchen → FLOOR" })
assert.ok(!reportSection(), "A report whose photos are all under tasks has no empty report section")
assert.equal(find(node => node.type?.name === "EntryFacts").props.entry.issues, "Short of grout", "Each entry shows its own details")
reportPhotos = [{ id: "old", entry_id: null }]; render(ReportEntriesView, { report: entryReport, describe: () => "Kitchen → FLOOR" })
assert.ok(reportSection(), "A photo under no task stays visible to the team")
render(ReportEntriesView, { report: { ...report("daily"), daily_report_entries: [] }, describe: () => "" })
assert.ok(reportSection(), "An older report keeps its photo section"); reportPhotos = []
const site = (id, title, assigned_to, category = "progress") => ({ id, title, assigned_to, category, status: "in_progress", blueprint_id: "s1" })
const sites = [site("mine", "LAUNDRY", "foreman"), site("bare", "STAIR", "foreman"), site("theirs", "ROOF", "someone"), site("memo", "Note", "foreman", "note")]
const siteTask = (id, pin_id, label, position) => ({ id, pin_id, text: label, position, done: false, review_status: null })
const siteTasks = [siteTask("wall", "mine", "WALL", 1), siteTask("floor", "mine", "FLOOR", 0), siteTask("gutter", "theirs", "GUTTER", 0)]
let entriesNow = [], nextEntry = 0
const editorProps = (extra = {}) => ({ value: entriesNow, pins: sites, items: siteTasks, userId: "foreman", sheetTitle: () => "Ground floor", readOnly: false, disabled: false, problems: {}, photos: () => null, newId: () => `entry-${++nextEntry}`, onChange: value => { entriesNow = value }, ...extra })
const showEditor = extra => render(TaskProgressEditor, editorProps(extra))
const pressAdd = () => find(node => node.type === "button" && text(node) === "Add Task Progress").props.onClick()
const isSheetFilter = node => all(node).some(option => option.type === "option" && text(option) === "All blueprints")
// The task, then the pin, of each entry (the card shows them the other way round: see the field order below).
const selects = () => all(tree).filter(node => node.type === "select" && !isSheetFilter(node)).map((_, index, rows) => rows[index % 2 ? index - 1 : index + 1])
const sheetSelects = () => all(tree).filter(node => node.type === "select" && isSheetFilter(node))
const optionsOf = select => all(select).filter(node => node.type === "option").map(text)
showEditor(); assert.equal(selects().length, 0); assert.doesNotMatch(text(tree), /No work is assigned/)
pressAdd(); showEditor()
assert.deepEqual(entriesNow.map(entry => [entry.id, entry.pin_id, entry.item_id, entry.percent]), [["entry-1", "", null, null]])
assert.deepEqual(optionsOf(selects()[0]), ["Choose the task", "FLOOR", "WALL"], "Tasks of the Foreman's assigned pins only, in order")
assert.deepEqual(optionsOf(selects()[1]), ["Choose the pin", "LAUNDRY · Ground floor", "STAIR · Ground floor"], "Assigned work pins with their sheet; no notes and no one else's work")
selects()[0].props.onChange({ target: { value: "wall" } }); showEditor()
assert.deepEqual([entriesNow[0].pin_id, entriesNow[0].item_id], ["mine", "wall"], "Choosing a task fills in its linked pin")
find(node => node.type === "input" && node.props.placeholder === "0 to 100").props.onChange({ target: { value: "60" } }); showEditor()
assert.equal(entriesNow[0].percent, 60)
find(node => node.type === "input" && node.props.placeholder === "0 to 100").props.onChange({ target: { value: "" } }); showEditor()
assert.equal(entriesNow[0].percent, null, "An emptied percentage is blank, not zero")
pressAdd(); showEditor()
assert.equal(entriesNow.length, 2, "Add Task Progress adds another entry to the same report")
assert.equal(all(selects()[2]).find(node => node.type === "option" && text(node) === "WALL").props.disabled, true, "A task already on this report cannot be chosen twice")
selects()[3].props.onChange({ target: { value: "bare" } }); showEditor()
assert.deepEqual(optionsOf(selects()[2]), ["No tasks on this pin"]); assert.equal(selects()[2].props.disabled, true); assert.equal(entriesNow[1].pin_id, "bare")
selects()[3].props.onChange({ target: { value: "mine" } }); showEditor()
assert.deepEqual(optionsOf(selects()[2]), ["Choose the task", "FLOOR", "WALL"], "Choosing a pin narrows the tasks")
const [firstRemove] = all(tree).filter(node => node.type === "button" && text(node) === "Remove")
await firstRemove.props.onClick(); await tick(); showEditor()
assert.deepEqual(entriesNow.map(entry => entry.id), ["entry-2"], "Remove takes out that entry only")
entriesNow = [{ ...blankEntry("kept", { pin_id: "theirs", item_id: "gutter" }), percent: 30 }]; showEditor({ problems: { kept: "Fix this entry." } })
assert.ok(optionsOf(selects()[1]).includes("ROOF · Ground floor"), "Work already on the report stays selectable after it was reassigned")
assert.match(text(tree), /Fix this entry\./)
assert.ok(!all(tree).some(node => node.type === "textarea" && /cement/.test(node.props.placeholder ?? "")), "Materials is gone from the entry")
showEditor({ capturing: true }); assert.equal(find(node => node.type === "button" && text(node) === "Remove").props.disabled, true, "An entry with an unsaved photo cannot be removed")
showEditor({ readOnly: true })
assert.ok(!all(tree).some(node => node.type === "button"), "A submitted report has no add or remove buttons")
assert.ok([...selects(), ...sheetSelects()].every(select => select.props.disabled), "and its fields are locked")
entriesNow = []; showEditor({ pins: [sites[2]] })
assert.match(text(tree), /No work is assigned to you/); assert.equal(find(node => node.type === "button" && text(node) === "Add Task Progress").props.disabled, true)
entriesNow = Array.from({ length: 100 }, (_, n) => blankEntry(`full-${n}`)); showEditor()
assert.equal(find(node => node.type === "button" && text(node) === "Add Task Progress").props.disabled, true, "One report holds at most 100 entries")

entriesNow = [blankEntry("order")]; showEditor()
assert.deepEqual(all(tree).filter(node => node.type === "label").map(node => text(node).match(/^[A-Z][a-z]+( [a-z]+)?/)?.[0]).slice(0, 3), ["Blueprint", "Linked pin", "Task"], "The dropdowns read blueprint, pin, task")

// The blueprint filter on each task: only a filter, the entry links the pin.
const plans = [site("mine", "LAUNDRY", "foreman"), { ...site("roof", "ROOF DECK", "foreman"), blueprint_id: "s2" }, { ...site("empty", "STAIR", "foreman"), blueprint_id: "s4" }, { ...site("theirs", "ROOF", "someone"), blueprint_id: "s3" }]
const planProps = { pins: plans, items: [...siteTasks, siteTask("deck", "roof", "DECK", 0)], sheetTitle: id => ({ s1: "Ground floor", s2: "Roof plan" })[id] }
entriesNow = []; showEditor(planProps); pressAdd(); showEditor(planProps)
assert.deepEqual(optionsOf(sheetSelects()[0]), ["All blueprints", "Ground floor", "Roof plan", "Other plan"], "Only blueprints holding the Foreman's assigned work")
assert.deepEqual(optionsOf(selects()[0]), ["Choose the task", "FLOOR", "WALL", "DECK"], "All blueprints shows every assigned task")
sheetSelects()[0].props.onChange({ target: { value: "s2" } }); showEditor(planProps)
assert.equal(sheetSelects()[0].props.value, "s2")
assert.deepEqual(optionsOf(selects()[0]), ["Choose the task", "DECK"], "A blueprint narrows the tasks"); assert.deepEqual(optionsOf(selects()[1]), ["Choose the pin", "ROOF DECK · Roof plan"], "and the pins")
assert.deepEqual([entriesNow[0].pin_id, entriesNow[0].item_id], ["", null], "Filtering alone links nothing")
sheetSelects()[0].props.onChange({ target: { value: "s4" } }); showEditor(planProps)
assert.deepEqual(optionsOf(selects()[0]), ["No tasks on this blueprint"])
sheetSelects()[0].props.onChange({ target: { value: "s2" } }); showEditor(planProps)
selects()[0].props.onChange({ target: { value: "deck" } }); showEditor(planProps)
assert.deepEqual([entriesNow[0].pin_id, entriesNow[0].item_id], ["roof", "deck"]); assert.equal(sheetSelects()[0].props.value, "s2")
sheetSelects()[0].props.onChange({ target: { value: "s1" } }); showEditor(planProps)
assert.deepEqual([entriesNow[0].pin_id, entriesNow[0].item_id], ["", null], "Another blueprint clears work that is not on it")
assert.deepEqual(optionsOf(selects()[0]), ["Choose the task", "FLOOR", "WALL"])
pressAdd(); showEditor(planProps)
assert.equal(sheetSelects()[1].props.value, "", "Each task has its own filter")
entriesNow = [blankEntry("saved", { pin_id: "roof", item_id: "deck" })]; showEditor({ ...planProps, readOnly: true })
assert.equal(sheetSelects()[0].props.value, "s2", "A saved entry shows its pin's blueprint"); assert.equal(sheetSelects()[0].props.disabled, true)

const editorHistory = previousTaskProgress([
  progressReport("floor", "2026-10-19", 15, {}, { pin_id: "mine", item_id: "floor" }),
  progressReport("wall", "2026-10-20", 70, {}, { pin_id: "mine", item_id: "wall" }),
  progressReport("stair", "2026-10-20", 100, {}, { pin_id: "bare", item_id: null }),
], "A", "2026-10-21")
const carriedEditor = () => showEditor({ progressHistory: editorHistory })
const percentInput = () => find(node => node.type === "input" && node.props.placeholder === "0 to 100")
entriesNow = [blankEntry("carried")]; carriedEditor()
selects()[0].props.onChange({ target: { value: "floor" } }); carriedEditor()
assert.equal(percentInput().props.value, 15); assert.match(text(tree), /Last reported: 15%/)
assert.equal(percentInput().props.type, "text"); assert.equal(percentInput().props.inputMode, "numeric", "Type directly with the mobile number keyboard")
percentInput().props.onChange({ target: { value: "25" } }); carriedEditor()
assert.equal(entriesNow[0].percent, 25, "The typed number is the new total, not added to the carried total")
selects()[0].props.onChange({ target: { value: "floor" } }); carriedEditor()
assert.equal(entriesNow[0].percent, 25, "Reselecting the same task does not erase an edit")
for (const value of ["1e2", "12.5", "-1", "hello"]) { percentInput().props.onChange({ target: { value } }); carriedEditor(); assert.equal(entriesNow[0].percent, 25) }
percentInput().props.onChange({ target: { value: "" } }); carriedEditor(); assert.equal(entriesNow[0].percent, null, "Clearing is allowed while replacing the total")
percentInput().props.onChange({ target: { value: "0" } }); carriedEditor(); assert.equal(entriesNow[0].percent, 0)
selects()[0].props.onChange({ target: { value: "wall" } }); carriedEditor(); assert.equal(entriesNow[0].percent, 70, "Switching tasks takes that task's own baseline")
selects()[1].props.onChange({ target: { value: "bare" } }); carriedEditor(); assert.equal(entriesNow[0].percent, 100, "Pins without tasks also carry forward")
selects()[1].props.onChange({ target: { value: "" } }); carriedEditor(); assert.equal(entriesNow[0].percent, null, "Clearing the work clears its percentage")
showEditor({ progressHistory: editorHistory, readOnly: true }); assert.equal(percentInput().props.disabled, true)

// The real form: everything goes through save_daily_report, as a draft or at submission, or waits on the device with its entries.
reset(); requests = []
const queued = []
globalThis.__recordDeps.enqueue = async item => { queued.push(item) }
// Modules are cached by their text, so this page gets its own stubs instead of the ones bound to the first compile above.
const FormPage = (await compile("../src/pages/Foreman/ForemanDailyProgressReport.tsx", {
  "../../components/DailyReportWorkflow": url("export function ReportHistory(){return null};export function TaskProgressEditor(){return null}"),
  "../../components/DailyReportPhotos": url("export default function DailyReportPhotos(){return null}"),
  "../../lib/reportFormat": format,
  "../../lib/offlineQueue": url("export const enqueue=item=>globalThis.__recordDeps.enqueue(item)"),
  "../../lib/confirm": url("export const useConfirm=()=>async()=>true"),
  "../../lib/toast": url("export const useToast=()=>({success(){},error(){},info(){}})"),
  "../../lib/blueprints": url("export const useBlueprints=()=>({blueprints:[]}),useProjectPins=(...a)=>globalThis.__recordDeps.useProjectPins(...a)"),
  "../../lib/reports": url("const d=globalThis.__recordDeps;export const useDailyReports=(...a)=>d.useDailyReports(...a),reportableDates=(...a)=>d.reportableDates(...a),dailyReportHtml=()=>'',reportDateLong=value=>value,reportError=error=>error.message,weatherLabels=d.weatherLabels"),
})).default
Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true })
reportHeadcount = { count: 7, loading: false, error: "", reload: async () => {} }
const showForm = () => render(FormPage, {})
const editorNow = () => find(node => node.type?.name === "TaskProgressEditor").props
const summaryBox = () => all(tree).find(node => node.type === "textarea")
const saveDraft = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
const submitForm = () => find(node => node.type === "button" && text(node) === "Submit daily progress report").props.onClick()
const rpcCalls = () => requests.filter(row => row.name === "save_daily_report")
showForm(); showForm()
assert.equal(summaryBox(), undefined, "A Foreman with assigned work writes the work completed under each task, not on the report")
await submitForm(); await tick(); showForm()
assert.equal(rpcCalls().length, 0); assert.match(text(find(node => node.props?.role === "alert")), /Press Add Task Progress/, "An empty report says what to do")
const draftEntry = { ...blankEntry("e1", { pin_id: "pin", item_id: "floor" }), work_done: "Tiling the floor" }
editorNow().onChange([draftEntry]); showForm()
await submitForm(); await tick(); showForm()
assert.equal(rpcCalls().length, 0, "A blank percentage stops the submission in the form")
assert.match(editorNow().problems.e1, /Enter the percentage/)
void saveDraft(); await tick(); showForm()
assert.equal(rpcCalls().length, 1, "The same entry can be saved as a draft")
const savedDraft = rpcCalls()[0].args
assert.equal(savedDraft.p_status, "draft"); assert.equal(savedDraft.p_project, "A"); assert.equal(savedDraft.p_entries[0].work_done, "Tiling the floor")
assert.deepEqual(savedDraft.p_entries.map(entry => [entry.id, entry.pin_id, entry.item_id, entry.percent]), [["e1", "pin", "floor", null]])
assert.ok(!requests.some(row => row.table === "daily_reports" && !row.name), "The report is not written around the entries")
rpcCalls()[0].resolve({ error: null }); await tick(); showForm()
editorNow().onChange([{ ...draftEntry, percent: 80, manpower: 4 }, { ...blankEntry("e2", { pin_id: "bare", item_id: null }), work_done: "Set out the wall", percent: 15 }]); showForm()
void submitForm(); await tick(); await tick(); showForm()
assert.equal(rpcCalls().length, 2)
assert.deepEqual([rpcCalls()[1].args.p_status, rpcCalls()[1].args.p_entries.length, rpcCalls()[1].args.p_entries[0].percent, rpcCalls()[1].args.p_entries[0].manpower], ["submitted", 2, 80, 4], "Several tasks are submitted under the one report")
rpcCalls()[1].resolve({ error: null }); await tick(); showForm()
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true })
void saveDraft(); await tick(); await tick(); showForm()
assert.equal(queued.length, 1, "Without a signal the report waits on the device"); assert.equal(rpcCalls().length, 2)
assert.deepEqual(queued[0].payload.entries.map(entry => entry.id), ["e1", "e2"], "and its task entries wait with it"); assert.equal(queued[0].kind, "daily_report")
Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true })
const panel = editorNow().photos(editorNow().value[1]).props
assert.equal(panel.entryId, "e2"); assert.equal(panel.editable, true)
const drafted = panel.ensureDraft(); await tick()
assert.equal(rpcCalls().length, 3, "A photo on an unsaved task entry saves the draft first"); assert.equal(rpcCalls()[2].args.p_status, "draft")
rpcCalls()[2].resolve({ data: "report-id", error: null }); assert.equal(await drafted, "report-id")
const unchosen = editorNow().photos(blankEntry("e3")).props
assert.equal(unchosen.editable, true, "Take photo and Upload photo show on every task, even before its task is chosen")
unchosen.onBusy(true); showForm()
assert.equal(editorNow().disabled, false, "An unsaved photo leaves the entries editable, so its task can still be chosen"); assert.equal(editorNow().capturing, true, "and the entry cannot be removed under it")
assert.equal(find(node => node.type === "button" && text(node) === "Submit daily progress report").props.disabled, true, "The report still cannot be submitted past an unsaved photo")
unchosen.onBusy(false); showForm()
editorNow().onChange([...editorNow().value, blankEntry("e3")]); showForm()
const callsBefore = rpcCalls().length
assert.equal(await editorNow().photos(blankEntry("e3")).props.ensureDraft(), null, "The photo is kept until its task is chosen"); assert.equal(rpcCalls().length, callsBefore)
editorNow().onChange(editorNow().value.filter(entry => entry.id !== "e3")); showForm()
const reportPanel = () => all(tree).find(node => node.type?.name === "DailyReportPhotos")
assert.equal(reportPanel(), undefined, "The form has no report-level photo section")
reportPhotos = [{ id: "old", entry_id: null }]; showForm()
assert.deepEqual(reportPanel().props.taskIds, ["e1", "e2"], "A photo under no task is still listed, so it cannot go missing"); assert.equal(reportPanel().props.ensureDraft, undefined, "and nothing can be added there")
reportPhotos = []

// The report's own box: only for a Foreman with no assigned work, or an older summary, which moves to the first task added.
reset(); pin.assigned_to = "someone"; globalThis.__recordDeps.useDailyReports = () => ({ reports: [], loading: false, reload: async () => {} })
showForm(); showForm()
assert.ok(summaryBox(), "With no assigned work the report can still be written")
summaryBox().props.onChange({ target: { value: "A rain day, no work on site" } }); showForm()
assert.equal(summaryBox().props.value, "A rain day, no work on site")
editorNow().onChange([{ ...blankEntry("e9", { pin_id: "pin", item_id: "floor" }) }]); showForm()
assert.equal(editorNow().value[0].work_done, "A rain day, no work on site", "The summary moves to the first task"); assert.equal(summaryBox(), undefined, "and is not shown twice")
pin.assigned_to = "foreman"

// Opening a draft seeds only a blank total. A refresh never replaces a saved/typed number or a deliberately cleared input.
reset()
let formReports = [progressReport("prior", "2026-10-20", 15), progressReport("today", "2026-10-21", null, { status: "draft", work_done: "" })]
globalThis.__recordDeps.useDailyReports = () => ({ reports: formReports, loading: false, reload: async () => {} })
showForm(); showForm(); assert.equal(editorNow().value[0].percent, 15, "A blank draft carries yesterday's submitted total")
editorNow().onChange(editorNow().value.map(entry => ({ ...entry, percent: 25 }))); showForm()
formReports = [...formReports]; showForm(); showForm(); assert.equal(editorNow().value[0].percent, 25, "Background refresh preserves the entered total")
editorNow().onChange(editorNow().value.map(entry => ({ ...entry, percent: null }))); showForm()
formReports = [...formReports]; showForm(); showForm(); assert.equal(editorNow().value[0].percent, null, "Refresh does not refill a box being cleared")
reset(); formReports[1] = { ...formReports[1], daily_report_entries: [{ ...formReports[1].daily_report_entries[0], percent: 35 }] }
showForm(); showForm(); assert.equal(editorNow().value[0].percent, 35, "An existing draft keeps its saved total")
reset(); formReports[1] = { ...formReports[1], status: "submitted", daily_report_entries: [{ ...formReports[1].daily_report_entries[0], percent: null }] }
showForm(); showForm(); assert.equal(editorNow().value[0].percent, null, "Read-only history is never filled or rewritten")

// A pin/task deep link waits for report history before carrying forward, then saves the exact new total.
reset(); formReports = [progressReport("prior", "2026-10-20", 15)]
let reportsLoading = true
globalThis.__recordDeps.useDailyReports = () => ({ reports: reportsLoading ? [] : formReports, loading: reportsLoading, reload: async () => {} })
window.location = { search: "?project=A&linkpin=pin&linkitem=floor", href: "https://buildtrack.test/?project=A&linkpin=pin&linkitem=floor" }
window.history = { replaceState(_state, _unused, url) { window.location.search = url.search; window.location.href = url.href } }
showForm(); showForm(); assert.equal(editorNow().value.length, 0)
reportsLoading = false; showForm(); showForm(); assert.equal(editorNow().value[0].percent, 15, "The linked task starts at the last submitted total")
assert.equal(editorNow().progressHistory.get("pin:floor").percent, 15, "The form passes prior progress to its task picker")
editorNow().onChange(editorNow().value.map(entry => ({ ...entry, percent: 25, work_done: "More floor tiling" }))); showForm()
void saveDraft(); await tick(); showForm(); assert.equal(rpcCalls()[0].args.p_entries[0].percent, 25, "Saving sends 25%, not 15+25 or just the increment")
rpcCalls()[0].resolve({ error: null }); await tick()

reset(); globalThis.window = originalWindow; globalThis.document = originalDocument
delete globalThis.__recordHooks; delete globalThis.__recordDeps; delete globalThis.__lastReportLink
console.log("Project report pagination/scope/races, team refresh/error guards, reconnect polling, linked checklist status, report filters/privacy/deep links, real attendance reconciliation and historical Foreman reports, the task entry editor and the daily report save flow passed")
