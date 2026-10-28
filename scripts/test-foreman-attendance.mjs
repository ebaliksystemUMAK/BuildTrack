import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { attendanceDay } from "../src/lib/attendanceModel.ts"
import { validAttendanceDay, attendancePageLabel, workerSearchPattern } from "../src/lib/foremanAttendanceModel.ts"

assert.equal(validAttendanceDay("2026-02-29", "2026-10-20"), false)
assert.equal(validAttendanceDay("2024-02-29", "2026-10-20"), true)
for (const day of ["", "bad", "2026-13-01", "2026-10-21"]) assert.equal(validAttendanceDay(day, "2026-10-20"), false)
assert.equal(attendancePageLabel(1, 30, 62), "31–60 of 62")
assert.equal(workerSearchPattern("  A_50%\\  "), "%A\\_50\\%\\\\%")

const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
async function compile(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries({ "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...replacements })) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  const module = url(source)
  return { module, exports: await import(module) }
}
const worker = (id, name, project = "project") => ({ id, project_id: project, full_name: name, worker_code: id, trade: "Mason", active: true, contact_number: "09123456789", email: "worker@example.com", photo_path: null, biometric_uid: null })
const a = worker("worker-a", "Anna Worker"), b = worker("worker-b", "Ben Worker"), outsider = worker("worker-x", "Other Project", "other")
const scan = (id, person, stamp, direction = "in") => ({ id, worker_id: person.id, project_id: person.project_id, direction, occurred_at: stamp, received_at: stamp, device_id: "gate", external_event_id: id, worker: person })
const scans = Array.from({ length: 61 }, (_, i) => scan(`scan-${String(i).padStart(3, "0")}`, a, new Date(Date.UTC(2026, 0, 2, 0, i)).toISOString(), i % 2 ? "out" : "in"))
scans.push(scan("second-worker", b, "2026-01-02T02:00:00Z"), scan("midnight", b, "2026-01-01T16:00:00Z", "out"), scan("prev-day", a, "2026-01-01T15:59:59Z"), scan("next-day", a, "2026-01-02T16:00:00Z"), scan("other-project", outsider, "2026-01-02T02:00:00Z"))
let queryLog = [], databaseError = false
globalThis.__foremanAttendanceDB = { from(table) {
  const spec = { table, filters: [], orders: [], from: 0, to: Infinity, options: {}, one: false }
  queryLog.push(spec)
  function result() {
    if (databaseError) return { data: null, count: null, error: new Error("offline") }
    let rows = [...(table === "attendance_workers" ? [a, b, outsider] : scans)]
    for (const [kind, column, value] of spec.filters) rows = rows.filter(row => kind === "eq" ? row[column] === value : kind === "gte" ? row[column] >= value : kind === "lt" ? row[column] < value : row[column].toLowerCase().includes(value.slice(1, -1).replace(/\\([%_\\])/g, "$1").toLowerCase()))
    rows.sort((x, y) => { for (const [column, ascending] of spec.orders) { const cmp = String(x[column]).localeCompare(String(y[column])); if (cmp) return ascending ? cmp : -cmp } return 0 })
    const count = rows.length
    rows = rows.slice(spec.from, spec.to + 1)
    return { data: spec.options.head ? null : spec.one ? rows[0] ?? null : rows, count, error: null }
  }
  const chain = {
    select(columns, options = {}) { spec.columns = columns; spec.options = options; return chain },
    eq(column, value) { spec.filters.push(["eq", column, value]); return chain },
    gte(column, value) { spec.filters.push(["gte", column, value]); return chain },
    lt(column, value) { spec.filters.push(["lt", column, value]); return chain },
    ilike(column, value) { spec.filters.push(["ilike", column, value]); return chain },
    order(column, options = {}) { spec.orders.push([column, options.ascending !== false]); return chain },
    range(from, to) { spec.from = from; spec.to = to; return chain },
    limit(n) { spec.to = n - 1; return chain },
    single() { spec.one = true; return chain }, maybeSingle() { spec.one = true; return chain },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
  }
  return chain
} }
const model = new URL("../src/lib/attendanceModel.ts", import.meta.url).href
const helper = new URL("../src/lib/foremanAttendanceModel.ts", import.meta.url).href
const dataModule = await compile("../src/lib/foremanAttendanceData.ts", {
  "./supabase": url("export const supabase=globalThis.__foremanAttendanceDB"),
  "./attendanceModel": model,
  "./foremanAttendanceModel": helper,
  "./foremanDashboardModel": url("export const manilaDayRange=day=>{const start=new Date(day+'T00:00:00+08:00');return {start:start.toISOString(),end:new Date(start.getTime()+86400000).toISOString()}}"),
})
const { loadAttendanceWorkers, loadDailyAttendance, loadWorkerAttendance } = dataModule.exports
assert.equal((await loadAttendanceWorkers("project", "", 0)).workers.length, 2, "Workers without scans remain in the directory")
assert.equal((await loadAttendanceWorkers("project", "anna", 0)).workers[0].id, a.id)
assert.equal((await loadAttendanceWorkers("project", "other", 0)).total, 0)
const day = await loadDailyAttendance("project", "2026-01-02", 1)
assert.equal(day.events.length, 30); assert.equal(day.total, 63)
assert.ok((await loadDailyAttendance("project", "2026-01-02", 2)).events.some(row => row.id === "midnight"), "Manila midnight belongs to the selected day")
assert.ok(!day.events.some(row => ["prev-day", "next-day", "other-project"].includes(row.id)))
const detail = await loadWorkerAttendance("project", a.id, "2026-01-02", 1)
assert.equal(detail.events.length, 30); assert.equal(detail.total, 61)
assert.equal(detail.summary.clockIns, 31); assert.equal(detail.summary.clockOuts, 30)
assert.equal(detail.summary.firstIn, "2026-01-02T00:00:00.000Z")
assert.equal(detail.summary.lastOut, "2026-01-02T00:59:00.000Z")
const todayNone = await loadWorkerAttendance("project", b.id, "2026-01-01", 0)
assert.equal(todayNone.total, 0); assert.equal(todayNone.summary.firstIn, null)
for (const query of queryLog) assert.ok(query.filters.some(([kind, column, value]) => kind === "eq" && column === "project_id" && value === "project"))
const eventQueries = queryLog.filter(query => query.table === "biometric_attendance_events")
assert.ok(eventQueries.some(query => query.filters.some(([kind, column, value]) => kind === "gte" && column === "occurred_at" && value === "2026-01-01T16:00:00.000Z")))
assert.ok(eventQueries.some(query => query.filters.some(([kind, column, value]) => kind === "lt" && column === "occurred_at" && value === "2026-01-02T16:00:00.000Z")))
databaseError = true
await assert.rejects(() => loadWorkerAttendance("project", a.id, "2026-01-02", 0), /could not be loaded/)
await assert.rejects(() => loadDailyAttendance("project", "2026-01-02", 0), /could not be loaded/)
databaseError = false
await assert.rejects(() => loadDailyAttendance("project", "2099-01-01", 0), /valid past/)
await assert.rejects(() => loadWorkerAttendance("project", outsider.id, "2026-01-02", 0), /could not be loaded/)

// Actual component interactions with isolated hooks; never writes profiles/attendance.
let values = [], effects = [], pending = [], cursor = 0
globalThis.__foremanAttendanceHooks = {
  useState(initial) { const n = cursor++; if (!(n in values)) values[n] = typeof initial === "function" ? initial() : initial; return [values[n], value => { values[n] = typeof value === "function" ? value(values[n]) : value }] },
  useEffect(fn, deps) { const n = cursor++, before = effects[n]; if (!before || deps.some((value, i) => value !== before.deps[i])) pending.push(() => { before?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
}
const hooks = url("export const useState=(...a)=>globalThis.__foremanAttendanceHooks.useState(...a);export const useEffect=(...a)=>globalThis.__foremanAttendanceHooks.useEffect(...a);")
globalThis.__foremanAttendanceState = {
  directory: { data: { workers: [a, b], total: 2 }, error: "", loading: false },
  records: { data: day, error: "", loading: false },
  detail: { data: detail, error: "", loading: false },
  // Daily time record from attendance_daily_status (one row per worker for the day).
  status: { data: [
    { day: "2026-01-02", worker_id: a.id, full_name: a.full_name, worker_code: a.worker_code, trade: a.trade, time_in: "2026-01-02T00:12:00Z", time_out: "2026-01-02T08:30:00Z", status: "late", late_minutes: 12, early_minutes: 30 },
    { day: "2026-01-02", worker_id: b.id, full_name: b.full_name, worker_code: b.worker_code, trade: b.trade, time_in: null, time_out: null, status: "absent", late_minutes: null, early_minutes: null },
  ], error: "", loading: false },
}
const mockData = url("export const useAttendanceWorkers=(...a)=>{globalThis.__foremanAttendanceState.directoryArgs=a;return globalThis.__foremanAttendanceState.directory};export const useDailyAttendance=(...a)=>{globalThis.__foremanAttendanceState.recordsArgs=a;return globalThis.__foremanAttendanceState.records};export const useWorkerAttendance=(...a)=>{globalThis.__foremanAttendanceState.detailArgs=a;return globalThis.__foremanAttendanceState.detail};export const useDailyStatus=(...a)=>{globalThis.__foremanAttendanceState.statusArgs=a;return globalThis.__foremanAttendanceState.status};")
const modal = url("export default function Modal(){return null}")
const reportButton = url("export default function ReportButton(){return null}")
const { default: ReportButton } = await import(reportButton)
const { exports: UI, module: uiModule } = await compile("../src/components/attendance/ForemanWorkerAttendance.tsx", { react: hooks, "../../lib/attendanceModel": model, "../../lib/foremanAttendanceModel": helper, "../../lib/attendanceStatusModel": new URL("../src/lib/attendanceStatusModel.ts", import.meta.url).href, "../../lib/attendanceScheduleModel": new URL("../src/lib/attendanceScheduleModel.ts", import.meta.url).href, "../../lib/foremanAttendance": mockData, "../Modal": modal, "./WorkerPortrait": url("export default function Portrait(){return null}"), "./AttendanceReportButton": reportButton })
const originalWindow = globalThis.window
globalThis.window = { setInterval: () => 1, clearInterval() {} }
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
// Schedule column: the database's flag, never computed in the browser.
const flagged = UI.AttendanceRecordsTable({ events: [{ ...scans[0], schedule_flag: "late", minutes_off: 80 }, { ...scans[1], schedule_flag: "early_out", minutes_off: 30 }, { ...scans[2], schedule_flag: null, minutes_off: null }] })
assert.match(text(flagged), /Schedule/); assert.match(text(flagged), /Late 1 h 20 min/); assert.match(text(flagged), /Early out 30 min/)
let tree
const find = predicate => { const found = all(tree).find(predicate); assert.ok(found, "Expected Foreman attendance control"); return found }
function render(Component, props) { for (let i = 0; i < 2; i++) { cursor = 0; tree = Component(props); const tasks = pending; pending = []; tasks.forEach(fn => fn()) } return tree }
function reset() { effects.forEach(effect => effect?.cleanup?.()); effects = []; pending = []; values = [] }
render(UI.default, { projectId: "project", projectName: "Test project" })
assert.equal(all(tree).filter(node => node.props?.role === "tab").length, 2)
assert.deepEqual(all(tree).filter(node => node.props?.role === "tab").map(text), ["Attendance records", "Workers"])
assert.ok(all(tree).some(node => node.type === UI.ProjectAttendanceRecords))
assert.match(text(tree), /Workforce management/)
find(node => node.props?.role === "tab" && text(node) === "Workers").props.onClick()
render(UI.default, { projectId: "project", projectName: "Test project" })
assert.ok(all(tree).some(node => node.type === UI.WorkerDirectory))
assert.ok(!all(tree).some(node => node.type === UI.ProjectAttendanceRecords || node.type === UI.WorkerAttendanceDetails))
const link = find(node => node.type === "a")
assert.equal(text(link), ""); assert.equal(link.props.href, "/attendance?project=project")
assert.equal(link.props["aria-label"], "Open standalone attendance screen")
assert.ok(all(link).some(node => node.type === "svg"))
assert.doesNotMatch(text(tree), /Worker registration|Latest recorded scan|Workers scanned|Biometric attendance/)
find(node => node.props?.role === "tab" && text(node) === "Attendance records").props.onClick()
render(UI.default, { projectId: "project", projectName: "Test project" })
assert.ok(!all(tree).some(node => node.type === UI.WorkerDirectory))
let records = find(node => node.type === UI.ProjectAttendanceRecords)
assert.equal(records.props.day, attendanceDay())
records.props.onDay("2026-01-02"); render(UI.default, { projectId: "project", projectName: "Test project" })
find(node => node.type === UI.ProjectAttendanceRecords).props.onWorker(a)
render(UI.default, { projectId: "project", projectName: "Test project" })
assert.equal(find(node => node.type === UI.WorkerAttendanceDetails).props.initialDay, "2026-01-02")
find(node => node.type === UI.WorkerAttendanceDetails).props.onClose(); render(UI.default, { projectId: "project", projectName: "Test project" })
// Records tab: Daily attendance (time in, time out, status) above the scan records.
const statusPick = {}
render(UI.ProjectAttendanceRecords, { projectId: "project", day: "2026-01-02", today: "2026-01-03", page: 0, onDay() {}, onPage() {}, onWorker: value => { statusPick.worker = value } })
assert.deepEqual(globalThis.__foremanAttendanceState.statusArgs, ["project", "2026-01-02"])
const statusTable = UI.DailyAttendanceTable(find(node => node.type === UI.DailyAttendanceTable).props)
assert.equal(all(statusTable).find(node => node.type === "table").props["aria-label"], "Daily attendance")
assert.deepEqual(all(statusTable).filter(node => node.type === "th").map(text), ["Worker", "Time in", "Time out", "Status", "Undertime"])
assert.match(text(statusTable), /Late 12 min/); assert.match(text(statusTable), /Absent/); assert.match(text(statusTable), /Early out 30 min/)
assert.match(text(tree), /On time 0 · Late 1 · Absent 1/); assert.doesNotMatch(text(tree), /Not in yet/, "Only for today")
assert.doesNotMatch(text(tree), /Clock in|Clock out/)
all(statusTable).find(node => node.type === "button" && text(node).startsWith(b.full_name)).props.onClick()
assert.equal(statusPick.worker.id, b.id, "A status row opens that worker")
assert.ok(!all(tree).some(node => node.type === UI.WorkerAttendanceDetails))

reset()
let selectedWorker, searchTerm, directoryPage
const directoryProps = { projectId: "project", search: "", page: 0, onSearch: value => { searchTerm = value }, onPage: value => { directoryPage = value }, onWorker: value => { selectedWorker = value } }
render(UI.WorkerDirectory, directoryProps)
find(node => node.type === "input").props.onChange({ target: { value: "Anna" } })
assert.equal(searchTerm, "Anna")
assert.equal(find(node => node.type === "table").props["aria-label"], "Worker details list")
assert.deepEqual(all(tree).filter(node => node.type === "th").map(text), ["Worker", "Trade / position", "Contact", "Status", "Fingerprint", "Details"])
assert.match(text(tree), /09123456789/); assert.match(text(tree), /worker@example.com/)
find(node => node.type === "button" && node.props["aria-label"] === "View details for Anna Worker").props.onClick({ stopPropagation() {} })
assert.equal(selectedWorker.id, a.id)
find(node => node.type === "tr" && text(node).includes("Ben Worker")).props.onClick()
assert.equal(selectedWorker.id, b.id, "Clicking anywhere on a detailed row opens that worker")
globalThis.__foremanAttendanceState.directory = { data: { workers: [], total: 0 }, error: "", loading: false }
render(UI.WorkerDirectory, { ...directoryProps, search: "missing" }); assert.match(text(tree), /No matching workers/)
globalThis.__foremanAttendanceState.directory = { data: null, error: "Database offline", loading: false }
render(UI.WorkerDirectory, directoryProps); assert.match(text(tree), /Database offline/)

reset()
const detailProps = { projectId: "project", worker: a, initialDay: "2026-01-02", onClose() {} }
render(UI.WorkerAttendanceDetails, detailProps)
assert.match(text(tree), /Attendance summary/)
assert.match(text(tree), /09123456789/); assert.match(text(tree), /worker@example.com/)
assert.match(text(tree), /Time in/); assert.match(text(tree), /StatusLate 12 min/); assert.match(text(tree), /UndertimeEarly out 30 min/)
assert.doesNotMatch(text(tree), /Clock/, "Time in / Time out wording only")
assert.equal(find(node => node.type === ReportButton).props.workerId, a.id)
assert.equal(find(node => node.type === ReportButton).props.anchorDay, "2026-01-02")
assert.equal(all(tree).filter(node => node.type === "input" || node.type === "form").length, 0, "Profile fields are not editable")
assert.ok(!all(tree).some(node => node.type === "button" && text(node) === "Edit profile"), "Foreman has no edit action")
let editSelection
render(UI.WorkerAttendanceDetails, { ...detailProps, worker: { ...a, contact_number: "stale" }, onEdit: value => { editSelection = value } })
find(node => node.type === "button" && text(node) === "Edit profile").props.onClick()
assert.equal(editSelection, detail.worker, "Admin edit uses the freshly loaded profile, not the directory snapshot")
globalThis.__foremanAttendanceState.detail = { data: null, error: "Unable to load profile", loading: false }
render(UI.WorkerAttendanceDetails, { ...detailProps, onEdit() { throw new Error("Unavailable profile cannot be edited") } })
assert.ok(!all(tree).some(node => node.type === "button" && text(node) === "Edit profile"))
globalThis.__foremanAttendanceState.detail = { data: detail, error: "", loading: false }
render(UI.WorkerAttendanceDetails, detailProps)
find(node => node.type === UI.AttendancePager).props.onChange(1)
render(UI.WorkerAttendanceDetails, detailProps)
assert.equal(globalThis.__foremanAttendanceState.detailArgs[3], 1)
find(node => node.type === UI.AttendanceCalendar).props.onChange("2026-01-01")
render(UI.WorkerAttendanceDetails, detailProps)
assert.deepEqual(globalThis.__foremanAttendanceState.detailArgs, ["project", a.id, "2026-01-01", 0])

reset()
let picked
const calendarProps = { day: "2026-01-02", today: "2026-10-20", onChange: value => { picked = value } }
render(UI.AttendanceCalendar, calendarProps)
find(node => node.type === "input").props.onChange({ target: { value: "2026-10-21" } }); render(UI.AttendanceCalendar, calendarProps)
assert.equal(picked, undefined); assert.match(text(tree), /valid past date/)
find(node => node.type === "input").props.onChange({ target: { value: "2026-02-29" } }); assert.equal(picked, undefined)
find(node => node.type === "input").props.onChange({ target: { value: "2026-01-01" } }); assert.equal(picked, "2026-01-01")

// Foreman route guards stale project results and mounts only the new directory, never the standalone board.
globalThis.__attendanceSelected = { id: "project", project: { id: "project", code: "SITE", name: "Test project" }, loading: false }
const { exports: Route } = await compile("../src/pages/Foreman/ForemanBiometricAttendance.tsx", { "../../components/attendance/ForemanWorkerAttendance": uiModule, "../../lib/projects": url("export const getSelectedProjectId=()=>globalThis.__attendanceSelected.id;export const useProject=()=>globalThis.__attendanceSelected;") })
reset(); render(Route.default, {})
assert.ok(all(tree).some(node => node.type === UI.default))
globalThis.__attendanceSelected.id = "different"; render(Route.default, {})
assert.ok(!all(tree).some(node => node.type === UI.default))
globalThis.__attendanceSelected.loading = true; render(Route.default, {}); assert.match(text(tree), /Loading workforce management/)
reset()

// Real resource hook: stale project/day results, push updates, polling and unmount cleanup.
globalThis.__foremanAttendanceHooks.useCallback = (fn, deps) => {
  const n = cursor++, before = values[n]
  if (!before || deps.some((value, i) => value !== before.deps[i])) values[n] = { fn, deps }
  return values[n].fn
}
const resourceHooks = url("export const useState=(...a)=>globalThis.__foremanAttendanceHooks.useState(...a);export const useEffect=(...a)=>globalThis.__foremanAttendanceHooks.useEffect(...a);export const useCallback=(...a)=>globalThis.__foremanAttendanceHooks.useCallback(...a);")
const originalDocument = globalThis.document
let requests = [], channels = [], removed = [], timers = new Map(), timerId = 0
globalThis.window = { setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} }
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
globalThis.__attendanceResource = {
  load(...args) { return new Promise((resolve, reject) => requests.push({ args, resolve, reject })) },
  channel() {
    const channel = { handlers: [], on(name, spec, changed) { this.handlers.push({ spec, changed }); return this }, subscribe() { return this } }
    channels.push(channel); return channel
  },
  removeChannel: channel => removed.push(channel),
}
const resource = await compile("../src/lib/foremanAttendance.ts", {
  react: resourceHooks,
  "./supabase": url("export const supabase=globalThis.__attendanceResource"),
  "./foremanAttendanceData": url("export const loadAttendanceWorkers=(...a)=>globalThis.__attendanceResource.load(...a);export const loadDailyAttendance=(...a)=>globalThis.__attendanceResource.load(...a);export const loadWorkerAttendance=(...a)=>globalThis.__attendanceResource.load(...a);export const loadDailyStatus=(...a)=>globalThis.__attendanceResource.load(...a);"),
})
let resourceValue
function renderResource(project) {
  cursor = 0; resourceValue = resource.exports.useAttendanceWorkers(project, "Anna", 0)
  const jobs = pending; pending = []; jobs.forEach(fn => fn())
}
renderResource("project-a")
assert.equal(resourceValue.loading, true)
renderResource("project-b")
assert.equal(requests.length, 2); assert.ok(removed.includes(channels[0]))
requests[0].resolve({ workers: [outsider], total: 1 }); await new Promise(resolve => setImmediate(resolve)); renderResource("project-b")
assert.equal(resourceValue.data, null, "A late response cannot reveal another project's workers")
requests[1].resolve({ workers: [b], total: 1 }); await new Promise(resolve => setImmediate(resolve)); renderResource("project-b")
assert.equal(resourceValue.data.workers[0].id, b.id)
assert.ok(channels.at(-1).handlers.every(handler => handler.spec.filter === "project_id=eq.project-b"))
channels.at(-1).handlers[0].changed(); for (const fn of timers.values()) fn(); timers.clear()
assert.equal(requests.length, 3)
requests[2].reject(new Error("Connection lost")); await new Promise(resolve => setImmediate(resolve)); renderResource("project-b")
assert.match(resourceValue.error, /Connection lost/); assert.equal(resourceValue.data, null)
channels.at(-1).handlers[1].changed(); for (const fn of timers.values()) fn(); timers.clear()
requests[3].resolve({ workers: [a, b], total: 2 }); await new Promise(resolve => setImmediate(resolve)); renderResource("project-b")
assert.equal(resourceValue.data.total, 2)
reset(); assert.ok(removed.includes(channels.at(-1)), "Unmount removes the database subscription")
globalThis.document = originalDocument
globalThis.window = originalWindow
delete globalThis.__attendanceResource
delete globalThis.__foremanAttendanceDB; delete globalThis.__foremanAttendanceHooks; delete globalThis.__foremanAttendanceState; delete globalThis.__attendanceSelected
console.log("Foreman worker search/detail, separate records tab/calendar, full-day summary beyond pagination, Manila bounds/project scope, icon-only link and read-only controls passed")
