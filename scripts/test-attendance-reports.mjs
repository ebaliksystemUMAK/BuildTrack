import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { attendanceReportRange, attendanceReportSummary } from "../src/lib/attendanceReportModel.ts"
import { attendanceReportHtml, attendanceReportCsv, attendanceReportFilename } from "../src/lib/attendanceReportPrint.ts"
import { defaultScheduleDraft, scheduleDraft, scheduleFlagLabel, scheduleProblem, scheduleSummary, workDaysText } from "../src/lib/attendanceScheduleModel.ts"
import { dailyStatusCounts, dailyStatusLabel, dailyStatusTone, directionLabel, undertimeLabel } from "../src/lib/attendanceStatusModel.ts"

// Attendance schedule form rules (same limits as set_attendance_schedule) and labels for the database's flags.
assert.equal(scheduleProblem(defaultScheduleDraft), "")
for (const [patch, pattern] of [
  [{ timeIn: "" }, /time in/], [{ timeOut: "25:00" }, /time out/], [{ timeOut: "08:00" }, /later than time in/], [{ timeOut: "07:30" }, /later than time in/],
  [{ grace: "121" }, /Grace/], [{ grace: "-1" }, /Grace/], [{ grace: "2.5" }, /Grace/], [{ repeat: "0" }, /Repeat/], [{ repeat: "" }, /Repeat/], [{ workDays: [] }, /working day/],
]) assert.match(scheduleProblem({ ...defaultScheduleDraft, ...patch }), pattern)
assert.deepEqual(scheduleDraft({ project_id: "p", time_in: "07:30:00", time_out: "16:30:00", grace_minutes: 10, repeat_guard_minutes: 5 }), { timeIn: "07:30", timeOut: "16:30", grace: "10", repeat: "5", workDays: [1, 2, 3, 4, 5, 6] }, "Schedules from before working days: Monday to Saturday")
assert.deepEqual(scheduleDraft({ project_id: "p", time_in: "07:30:00", time_out: "16:30:00", grace_minutes: 10, repeat_guard_minutes: 5, work_days: [5, 1, 2] }).workDays, [1, 2, 5])
assert.equal(scheduleSummary({ timeIn: "07:30", timeOut: "16:30", grace: "40", repeat: "5", workDays: [1, 2, 3, 4, 5] }), "Mon–Fri · Time in 07:30 (late after 08:10) · Time out 16:30 · repeat scans within 5 min ignored")
assert.deepEqual([[1, 2, 3, 4, 5, 6, 7], [1, 2, 3, 4, 5, 7], [1, 3], [6, 7]].map(workDaysText), ["Every day", "Mon–Fri, Sun", "Mon, Wed", "Sat, Sun"])
// Daily time record labels (status computed by attendance_daily_status).
const st = (status, late = null, early = null) => ({ status, late_minutes: late, early_minutes: early })
assert.deepEqual(["on_time", "late", "present", "absent", "not_in_yet", "rest_day", "no_schedule", "not_enrolled"].map((s) => dailyStatusLabel(st(s))), ["On time", "Late", "Present", "Absent", "Not in yet", "Rest day", "No schedule", "No fingerprint"])
assert.equal(dailyStatusLabel(st("late", 75)), "Late 1 h 15 min"); assert.equal(undertimeLabel(st("on_time", null, 30)), "Early out 30 min"); assert.equal(undertimeLabel(st("on_time")), "")
assert.deepEqual(["on_time", "late", "absent", "rest_day"].map(dailyStatusTone), ["ok", "warn", "bad", "muted"])
assert.deepEqual(dailyStatusCounts([st("on_time"), st("late"), st("late"), st("absent"), st("rest_day")]), { on_time: 1, late: 2, absent: 1, not_in_yet: 0, present: 0 })
assert.deepEqual([directionLabel("in"), directionLabel("out")], ["Time in", "Time out"])
assert.equal(scheduleFlagLabel("late", 75), "Late 1 h 15 min"); assert.equal(scheduleFlagLabel("early_out", 60), "Early out 1 h")
assert.equal(scheduleFlagLabel("on_time", null), "On time"); assert.equal(scheduleFlagLabel("returned", null), "Back on site")
assert.equal(scheduleFlagLabel("no_schedule", null), ""); assert.equal(scheduleFlagLabel(null, null), "", "Scans from before schedules show nothing")
{
  const person = { id: "w", full_name: "Ana", worker_code: "A-1", trade: "Mason" }
  const ev = (id, direction, at, schedule_flag, minutes_off) => ({ id, project_id: "p", worker_id: "w", direction, occurred_at: at, received_at: at, device_id: "gate", schedule_flag, minutes_off, worker: person })
  const day = attendanceReportSummary([
    ev("1", "in", "2026-03-02T00:20:00Z", "late", 20), ev("2", "out", "2026-03-02T04:00:00Z", "early_out", 300),
    ev("3", "in", "2026-03-02T05:00:00Z", "returned", null), ev("4", "out", "2026-03-02T09:05:00Z", "on_time", null),
  ])
  assert.deepEqual([day.rows[0].arrival, day.rows[0].departure, day.late], ["Late 20 min", "On time", 1], "Arrival = first IN, departure = last OUT")
}

const today = "2026-10-20"
assert.deepEqual(attendanceReportRange("daily", today, today), { period: "daily", startDay: today, endDay: today, throughDay: today, start: "2026-10-19T16:00:00.000Z", endExclusive: "2026-10-20T16:00:00.000Z" })
assert.equal(attendanceReportRange("weekly", "2026-01-01", today).startDay, "2025-12-29")
assert.equal(attendanceReportRange("weekly", "2026-01-04", today).endDay, "2026-01-04")
assert.equal(attendanceReportRange("weekly", today, today).throughDay, today)
assert.equal(attendanceReportRange("weekly", today, today).endDay, "2026-10-25")
assert.equal(attendanceReportRange("monthly", "2024-02-10", today).endDay, "2024-02-29")
assert.equal(attendanceReportRange("monthly", today, today).startDay, "2026-10-01")
assert.equal(attendanceReportRange("monthly", today, today).endDay, "2026-10-31")
assert.equal(attendanceReportRange("monthly", today, today).throughDay, today)
for (const [period, day] of [["daily", "2026-02-29"], ["weekly", "2099-01-01"], ["monthly", ""], ["bad", today]]) assert.throws(() => attendanceReportRange(period, day, today))

const worker = (id, name = "Same Name") => ({ id, project_id: "project", full_name: name, worker_code: id, trade: "Mason" })
const a = worker("worker-a"), b = worker("worker-b"), outsider = { ...worker("outsider"), project_id: "other" }
const event = (id, who, stamp, direction = "in") => ({ id, project_id: who.project_id, worker_id: who.id, worker: who, occurred_at: stamp, received_at: stamp, direction, device_id: "Gate 1" })
const events = [event("late", a, "2026-01-02T09:00:00Z", "out"), event("early", a, "2026-01-01T16:00:00Z"), event("second-worker", b, "2026-01-02T01:00:00Z", "out")]
const summary = attendanceReportSummary(events)
assert.equal(summary.workers, 2); assert.equal(summary.rows.length, 2, "Same names never merge different workers")
assert.equal(summary.days, 1); assert.equal(summary.clockIns, 1); assert.equal(summary.clockOuts, 2)
assert.equal(summary.rows[0].firstIn, "2026-01-01T16:00:00Z")
assert.equal(summary.rows[0].lastOut, "2026-01-02T09:00:00Z")
assert.equal(summary.rows[1].firstIn, null)

const malicious = { ...a, full_name: '<script>alert("x")</script>', worker_code: "=HYPERLINK(1)" }
const report = { project: { id: "project", name: "<img src=x onerror=alert(1)>", code: "P-1" }, worker: malicious, range: attendanceReportRange("monthly", "2026-01-02", today), events: [event("bad", malicious, "2026-01-02T01:00:00Z")], generatedAt: "2026-10-20T00:00:00Z" }
const html = attendanceReportHtml(report), csv = attendanceReportCsv(report)
assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<script>")); assert.ok(!html.includes("<img src=x"))
assert.ok(html.includes("Daily attendance summary")); assert.ok(html.includes("Attendance scan records")); assert.ok(html.includes("A4 landscape"))
assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("Project code")); assert.ok(csv.includes("Report period"))
assert.ok(!attendanceReportFilename({ ...report, project: { ...report.project, code: "../../bad:name" } }).includes("/"))
assert.match(attendanceReportHtml({ ...report, events: [] }), /No attendance recorded/)
// Daily time record from the database: absent workers appear even without scans; wording is Time in / Time out.
{
  const days = [
    { day: "2026-01-02", worker_id: "w1", full_name: "Ana Worker", worker_code: "A-1", trade: "Mason", time_in: "2026-01-02T00:20:00Z", time_out: "2026-01-02T08:30:00Z", status: "late", late_minutes: 20, early_minutes: 30 },
    { day: "2026-01-02", worker_id: "w2", full_name: "Ben Worker", worker_code: "B-1", trade: "Mason", time_in: null, time_out: null, status: "absent", late_minutes: null, early_minutes: null },
  ]
  const withDays = attendanceReportHtml({ ...report, days })
  assert.match(withDays, /Daily time record/); assert.match(withDays, /Ben Worker/); assert.match(withDays, /Absent/)
  assert.match(withDays, /Late 20 min/); assert.match(withDays, /Early out 30 min/); assert.ok(withDays.includes("0 / 1 / 1"), "On time / late / absent worker-days")
  assert.doesNotMatch(withDays, /Daily attendance summary/, "The time record replaces the scan summary")
  assert.doesNotMatch(withDays + attendanceReportCsv(report), /Clock in|Clock out/)
  assert.match(attendanceReportHtml(report), /Daily attendance summary/, "Without the database status the scan summary stays")
}

const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
async function compile(path, replacements = {}) {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries({ "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...replacements })) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return import(url(source))
}
const scans = Array.from({ length: 2505 }, (_, index) => event(`scan-${String(index).padStart(4, "0")}`, a, new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString(), index % 2 ? "out" : "in"))
scans.push(event("b", b, "2026-01-02T00:00:00Z"), event("midnight", b, "2026-01-01T16:00:00Z"), event("before", a, "2026-01-01T15:59:59Z"), event("after", a, "2026-01-02T16:00:00Z"), event("outsider", outsider, "2026-01-02T00:00:00Z"))
let queryLog = [], fault = ""
globalThis.__reportDB = { from(table) {
  const spec = { table, filters: [], orders: [], from: 0, to: Infinity, single: false }; queryLog.push(spec)
  function result() {
    let rows = table === "projects" ? [{ id: "project", name: "Project", code: "P-1" }] : table === "attendance_workers" ? [a, b] : [...scans]
    for (const [kind, column, value] of spec.filters) rows = rows.filter(row => kind === "eq" ? row[column] === value : kind === "gte" ? row[column] >= value : row[column] < value)
    rows.sort((x, y) => { for (const column of spec.orders) { const cmp = String(x[column]).localeCompare(String(y[column])); if (cmp) return cmp } return 0 })
    let count = rows.length
    rows = rows.slice(spec.from, spec.to + 1)
    if (table === "biometric_attendance_events") {
      if (fault === "cap") count = 50001
      if (fault === "short") rows = rows.slice(0, 10)
      if (fault === "changed" && spec.from) count++
      if (fault === "duplicate" && spec.from) rows[0] = scans[0]
      if (fault === "offline" && spec.from) return { data: null, count: null, error: new Error("offline") }
    }
    return { data: spec.single ? rows[0] ?? null : rows, count, error: null }
  }
  const chain = {
    select(columns, options) { spec.columns = columns; spec.options = options; return chain },
    eq(column, value) { spec.filters.push(["eq", column, value]); return chain },
    gte(column, value) { spec.filters.push(["gte", column, value]); return chain },
    lt(column, value) { spec.filters.push(["lt", column, value]); return chain },
    order(column) { spec.orders.push(column); return chain },
    range(from, to) { spec.from = from; spec.to = to; return chain },
    single() { spec.single = true; return chain },
    then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
  }; return chain
} }
const reportModel = new URL("../src/lib/attendanceReportModel.ts", import.meta.url).href
const { loadAttendanceReport } = await compile("../src/lib/attendanceReportData.ts", { "./supabase": url("export const supabase=globalThis.__reportDB"), "./attendanceReportModel": reportModel })
const allReport = await loadAttendanceReport("project", "daily", "2026-01-02")
assert.equal(allReport.events.length, 2507)
assert.deepEqual(queryLog.filter(query => query.table === "biometric_attendance_events").map(query => query.from), [0, 1000, 2000])
assert.ok(allReport.events.some(scan => scan.id === "midnight"))
assert.ok(!allReport.events.some(scan => ["before", "after", "outsider"].includes(scan.id)))
queryLog = []
const personal = await loadAttendanceReport("project", "daily", "2026-01-02", a.id)
assert.equal(personal.events.length, 2505); assert.equal(personal.worker.id, a.id)
for (const query of queryLog.filter(query => query.table === "biometric_attendance_events")) {
  assert.ok(query.filters.some(([kind, column, value]) => kind === "eq" && column === "project_id" && value === "project"))
  assert.ok(query.filters.some(([kind, column, value]) => kind === "eq" && column === "worker_id" && value === a.id))
  assert.ok(!/email|contact_number/.test(query.columns), "Exports do not request unnecessary contact details")
}
assert.equal((await loadAttendanceReport("project", "daily", "2025-01-02", b.id)).events.length, 0)
await assert.rejects(() => loadAttendanceReport("other", "daily", "2026-01-02"), /not accessible/)
await assert.rejects(() => loadAttendanceReport("project", "daily", "2026-01-02", outsider.id), /not accessible/)
for (const [mode, pattern] of [["cap", /50,000/], ["short", /Not all/], ["changed", /changed/], ["duplicate", /changed/], ["offline", /full attendance report/]]) {
  fault = mode
  await assert.rejects(() => loadAttendanceReport("project", "daily", "2026-01-02"), pattern)
}
fault = ""

// Real report launcher/dialog controls, with mocked I/O only.
let state = [], effects = [], pending = [], cursor = 0, printed = [], downloaded = [], requests = [], response = allReport, fail = false, deferred
globalThis.__reportUI = {
  useState(initial) { const n = cursor++; if (!(n in state)) state[n] = initial; return [state[n], value => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
  useRef(initial) { const n = cursor++; if (!(n in state)) state[n] = { current: initial }; return state[n] },
  useEffect(fn, deps) { const n = cursor++, before = effects[n]; if (!before || deps.some((value, i) => value !== before.deps[i])) pending.push(() => { before?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  async load(...args) { requests.push(args); if (deferred) return new Promise(resolve => { deferred.resolve = resolve }); if (fail) throw new Error("No partial report generated"); return response },
  print: value => { printed.push(value); return true }, download: (...args) => downloaded.push(args),
}
const { default: Button, AttendanceReportDialog: Dialog } = await compile("../src/components/attendance/AttendanceReportButton.tsx", {
  react: url("export const useState=(...a)=>globalThis.__reportUI.useState(...a);export const useRef=(...a)=>globalThis.__reportUI.useRef(...a);export const useEffect=(...a)=>globalThis.__reportUI.useEffect(...a);"),
  "../Modal": url("export default function Modal(){return null}"),
  "../../lib/attendanceModel": new URL("../src/lib/attendanceModel.ts", import.meta.url).href,
  "../../lib/attendanceReportModel": reportModel,
  "../../lib/attendanceStatusModel": new URL("../src/lib/attendanceStatusModel.ts", import.meta.url).href,
  "../../lib/attendanceReportData": url("export const loadAttendanceReport=(...a)=>globalThis.__reportUI.load(...a)"),
  "../../lib/attendanceReportPrint": new URL("../src/lib/attendanceReportPrint.ts", import.meta.url).href,
  "../../lib/printReport": url("export const printHtml=(...a)=>globalThis.__reportUI.print(...a)"),
  "../../lib/progress": url("export const downloadCsv=(...a)=>globalThis.__reportUI.download(...a)"),
})
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
let tree
function render(Component, props) { for (let pass = 0; pass < 2; pass++) { cursor = 0; tree = Component(props); const work = pending; pending = []; work.forEach(fn => fn()) } }
const find = predicate => { const found = all(tree).find(predicate); assert.ok(found, "Expected attendance report control"); return found }
const button = label => find(node => node.type === "button" && text(node) === label)
const reset = () => { effects.forEach(effect => effect?.cleanup?.()); state = []; effects = []; pending = [] }
const props = { projectId: "project", anchorDay: "2026-01-02", onClose() {} }
render(Button, props)
assert.ok(!all(tree).some(node => node.type === Dialog))
button("Generate report").props.onClick(); render(Button, props)
assert.equal(find(node => node.type === Dialog).props.projectId, "project")
reset(); render(Dialog, props)
assert.deepEqual(all(tree).filter(node => node.type === "option").map(text), ["Daily", "Weekly", "Monthly"])
await button("Generate report").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render(Dialog, props)
assert.deepEqual(requests.at(-1), ["project", "daily", "2026-01-02", null])
assert.match(text(tree), /Report ready/)
button("Print / Save as PDF").props.onClick(); button("Download CSV").props.onClick()
assert.equal(printed.length, 1); assert.ok((printed[0].match(/<tr>/g) ?? []).length > 2507, "Print includes all scan rows plus daily summaries, not only the visible page")
assert.equal(downloaded.length, 1); assert.ok(downloaded[0][1].includes("scan-2504"), "CSV includes later pages")
find(node => node.type === "select").props.onChange({ target: { value: "weekly" } }); render(Dialog, props)
assert.ok(!all(tree).some(node => node.type === "button" && text(node) === "Download CSV"), "Changing a report period invalidates the previous export")
await button("Generate report").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render(Dialog, props)
assert.equal(requests.at(-1)[1], "weekly")
reset(); response = personal
const workerProps = { ...props, workerId: a.id, workerName: a.full_name }
render(Dialog, workerProps)
find(node => node.type === "select").props.onChange({ target: { value: "monthly" } }); render(Dialog, workerProps)
await button("Generate report").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render(Dialog, workerProps)
assert.deepEqual(requests.at(-1), ["project", "monthly", "2026-01-02", a.id])
find(node => node.type === "input").props.onChange({ target: { value: "2099-01-01" } }); render(Dialog, workerProps)
assert.equal(button("Generate report").props.disabled, true)
reset(); fail = true; render(Dialog, props)
await button("Generate report").props.onClick(); await new Promise(resolve => setImmediate(resolve)); render(Dialog, props)
assert.match(text(tree), /No partial report generated/)
assert.ok(!all(tree).some(node => node.type === "button" && text(node) === "Print / Save as PDF"))
reset(); fail = false; deferred = {}; render(Dialog, props)
const waiting = button("Generate report").props.onClick(); render(Dialog, props)
assert.equal(find(node => node.type === "select").props.disabled, true)
const reference = state.find(value => value && typeof value === "object" && "current" in value)
effects.forEach(effect => effect?.cleanup?.())
assert.ok(reference.current > 1, "Closing a report invalidates its pending request")
deferred.resolve(allReport); await waiting; await new Promise(resolve => setImmediate(resolve))
assert.ok(!state.some(value => value === allReport), "Late results never revive a closed report")
reset(); delete globalThis.__reportUI; delete globalThis.__reportDB
console.log("Daily/weekly/monthly report ranges, complete 2,500+ scan pagination, worker/project scope, safe print/CSV, truncation/error guards and report generation/export/cancel controls passed")
