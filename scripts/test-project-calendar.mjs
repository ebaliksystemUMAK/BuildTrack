import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as calendar from "../src/lib/projectCalendarModel.ts"
import { projectPath, readProjectRoute } from "../src/lib/projectRoutes.ts"

const project = { id: "P", code: "PRJ", name: "Test project", location: "Test site", start_date: "2026-10-01", end_date: "2026-12-31", status: "active" }
const pin = (id, assigned_to = "F", extra = {}) => ({ id, title: id, project_id: "P", blueprint_id: "B", due_date: "2026-10-24", category: "progress", status: "in_progress", assigned_to, ...extra })
const pins = [pin("my-work"), pin("other-work", "G"), pin("undated", "F", { due_date: null }), pin("note", "F", { category: "note" }), pin("foreign", "F", { project_id: "Q" }), pin("finished", "F", { status: "verified" })]
const inspection = (id, extra = {}) => ({ id, project_id: "P", number: 1, title: "Internal inspection", target_at: "2026-10-23T17:30:00Z", status: "requested", pin_id: "my-work", requested_by: "F", inspector_id: "E", reinspection_of: null, ...extra })
const inspections = [inspection("my-ir"), inspection("other-ir", { pin_id: "other-work", requested_by: "G" }), inspection("redo", { reinspection_of: "old-ir" }), inspection("no-target", { target_at: null }), inspection("foreign", { project_id: "Q" }), inspection("cancel", { status: "cancelled" }), inspection("finished-ir", { status: "passed" })]
const defect = (id, extra = {}) => ({ id, project_id: "P", number: 1, title: "INTERNAL NCR SECRET", due_date: "2026-10-25", assigned_to: "F", pin_id: "my-work", status: "open", ...extra })
const defects = [defect("my-ncr"), defect("other-ncr", { assigned_to: "G" }), defect("undated-ncr", { due_date: null }), defect("foreign", { project_id: "Q" }), defect("closed", { status: "closed" })]
const data = { project, pins, blueprints: [{ id: "B", project_id: "P", title: "Ground floor" }], inspections, defects, userId: "F", nameOf: id => id ? `Private staff ${id}` : "Unassigned" }
const engineer = calendar.projectCalendarEvents({ ...data, role: "engineer" })
assert.equal(engineer.undated, 3)
assert.equal(engineer.events.find(row => row.id === "inspection:my-ir").date, "2026-10-24", "targets use Philippine calendar dates")
assert.ok(engineer.events.some(row => row.kind === "reinspection"))
assert.ok(!engineer.events.some(row => /foreign|cancel|note|no-target/.test(row.id)))
assert.equal(engineer.events.find(row => row.id === "work:my-work").location, "Ground floor · my-work")
assert.match(engineer.events.find(row => row.id === "inspection:my-ir").recordHref, /^\/engineer\/qa\?project=P&tab=inspections&inspection=my-ir$/)
assert.match(engineer.events.find(row => row.id === "inspection:my-ir").pinHref, /sheet=B&pin=my-work&pintab=issues/)
assert.ok(engineer.events.every(row => row.projectId === "P"))
const foreman = calendar.projectCalendarEvents({ ...data, role: "foreman" })
assert.ok(!foreman.events.some(row => row.id.includes("other")), "Foreman sees only assigned/requested relevant records")
assert.match(foreman.events.find(row => row.kind === "ncr").recordHref, /^\/foreman\/issues/)
assert.equal(calendar.projectCalendarEvents({ ...data, userId: null, role: "foreman" }).events.filter(row => row.kind !== "milestone").length, 0, "null identity never matches unassigned work")
for (const role of ["admin", "client"]) {
  const rows = calendar.projectCalendarEvents({ ...data, role }).events
  assert.ok(rows.every(row => row.kind === "work" || row.kind === "milestone"))
  assert.doesNotMatch(JSON.stringify(rows), /INTERNAL NCR SECRET|Internal inspection/)
  if (role === "client") { assert.doesNotMatch(JSON.stringify(rows), /Private staff/); assert.match(rows.find(row => row.kind === "work").pinHref, /^\/client\/blueprint/) }
}
assert.equal(calendar.calendarRoleMatches("admin", "super_admin"), true)
assert.equal(calendar.calendarRoleMatches("engineer", "client"), false)
assert.equal(calendar.calendarRoleMatches("client", null), false)
assert.equal(calendar.calendarMoveMonth("2026-01-31", 1), "2026-02-28")
assert.equal(calendar.calendarMoveMonth("2024-01-31", 1), "2024-02-29")
assert.equal(calendar.calendarMoveMonth("2026-01-01", -1), "2025-12-01")
const monthDays = calendar.calendarMonthDays("2026-10-24")
assert.equal(monthDays.length, 42); assert.equal(monthDays[0], "2026-09-27"); assert.equal(monthDays.at(-1), "2026-11-07")
assert.deepEqual(calendar.calendarRange("2026-10-24", "week"), { from: "2026-10-18", to: "2026-10-24" })
assert.deepEqual(calendar.calendarRange("2026-10-24", "schedule"), { from: "2026-10-01", to: "2026-10-31" })
assert.deepEqual(calendar.readCalendar("?date=2026-02-30&view=bad", "2026-10-24"), { date: "2026-10-24", view: "month" })
assert.deepEqual(calendar.readCalendar("?date=2026-10-03&view=day", "2026-10-24"), { date: "2026-10-03", view: "day" })
assert.equal(calendar.calendarSearch("?project=P&pin=old", "2026-10-24", "week"), "?project=P&pin=old&date=2026-10-24&view=week")
const filters = { from: "2026-10-01", to: "2026-10-31", kinds: calendar.calendarKinds, query: "", completed: false }
assert.ok(!calendar.calendarFilter(engineer.events, filters).some(row => row.completed))
assert.ok(calendar.calendarFilter(engineer.events, { ...filters, completed: true }).some(row => row.completed))
assert.equal(calendar.calendarFilter(engineer.events, { ...filters, kinds: ["ncr"], query: "Private staff F" }).length, 1)
assert.equal(calendar.calendarFilter(engineer.events, { ...filters, kinds: [] }).length, 0)
const projectId = "12345678-1234-1234-1234-123456789abc"
assert.equal(projectPath(projectId, "calendar"), `/admin/projects/${projectId}/calendar`)
assert.deepEqual(readProjectRoute(projectPath(projectId, "calendar")), { projectId, section: "calendar" })

// Exercise actual React component handlers without a browser or production credentials.
const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], cursor = 0, effects = [], pending = [], tree, listeners = {}, replaced = []
const deps = globalThis.__calendarDeps = {}
globalThis.__calendarHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useMemo: fn => fn(), useCallback: fn => fn,
  useEffect(fn, values) { const n = cursor++, old = effects[n]; if (!old || !values || values.some((value, i) => value !== old.values?.[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { values, cleanup: fn() } }) },
}
const reset = () => { effects.forEach(row => row?.cleanup?.()); slots = []; cursor = 0; effects = []; pending = [] }
const render = (Component, props) => { cursor = 0; tree = Component(props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
async function compile(file, overrides = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const replacements = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...overrides }
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    if (!node.importClause) { output = output.replace(`import "${node.moduleSpecifier.text}";`, ""); continue }
    if (node.importClause.isTypeOnly) continue
    const name = node.moduleSpecifier.text, exports = []
    if (name in replacements) continue
    if (node.importClause.name) exports.push(`export default function ${node.importClause.name.text}(){return null}`)
    for (const binding of node.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__calendarHooks" : "__calendarDeps"}.${key} ?? function ${key}(){return null}`)
    }
    replacements[name] = url(exports.join(";") + `\n//${file}`)
  }
  for (const [name, replacement] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return import(url(output))
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected a calendar element"); return node }
const byName = name => node => node.type?.name === name
function location(search = "?project=P") {
  listeners = {}; globalThis.window = { location: { pathname: "/engineer/calendar", search, hash: "" }, history: { state: null, replaceState(_state, _title, path) { replaced.push(path); const next = new URL(path, "https://buildtrack.test"); Object.assign(window.location, { pathname: next.pathname, search: next.search }) } }, addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: name => { delete listeners[name] } }
}
let followed, reloaded = 0
Object.assign(deps, { followLink: (path, project) => { followed = { path, project } }, buttonPrimary: "primary", buttonSecondary: "secondary" })
const Calendar = (await compile("../src/components/calendar/ProjectCalendar.tsx", { "../../lib/projectCalendarModel": new URL("../src/lib/projectCalendarModel.ts", import.meta.url).href })).default
const props = { role: "engineer", projectId: "P", projectCode: "PRJ", projectName: "Test project", today: "2026-10-24", events: engineer.events, undated: 3, loading: false, error: "", onReload: () => { reloaded++ } }
location(); reset(); render(Calendar, props)
assert.equal(find(node => node.type === "select").props.value, "month")
assert.equal(all(tree).filter(node => node.props?.role === "cell").length, 42)
find(node => byName("IconButton")(node) && node.props.label === "Next period").props.onClick(); render(Calendar, props)
assert.match(replaced.at(-1), /project=P&date=2026-11-24&view=month/)
find(node => node.type === "button" && text(node) === "Today").props.onClick(); render(Calendar, props)
assert.match(replaced.at(-1), /date=2026-10-24/)
find(node => node.type === "select").props.onChange({ target: { value: "week" } }); render(Calendar, props)
assert.equal(all(tree).filter(node => node.props?.role === "cell").length, 7)
find(node => node.type === "select").props.onChange({ target: { value: "day" } }); render(Calendar, props)
assert.match(text(tree), /All day/)
find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "no-such-event" } }); render(Calendar, props)
assert.match(text(tree), /No events in this period/)
find(node => node.type === "input" && node.props.type === "search").props.onChange({ target: { value: "" } }); render(Calendar, props)
find(byName("EventButton")).props.onOpen("inspection:my-ir"); render(Calendar, props)
const dialog = find(byName("Modal")); assert.match(dialog.props.title, /Internal inspection/)
find(node => node.type === "button" && text(node) === "Open record").props.onClick(); assert.match(followed.path, /inspection=my-ir/); assert.equal(followed.project, "P")
find(node => node.type === "button" && text(node) === "Open on blueprint").props.onClick(); assert.match(followed.path, /pin=my-work&pintab=issues/)
dialog.props.onClose(); render(Calendar, props); assert.ok(!all(tree).some(byName("Modal")))
find(node => node.type === "button" && text(node) === "Filters").props.onClick(); render(Calendar, props)
assert.equal(find(node => node.type === "button" && text(node) === "Filters").props["aria-expanded"], true)
window.location.search = "?project=P&date=2026-09-01&view=schedule"; listeners.popstate(); render(Calendar, props)
assert.equal(find(node => node.type === "select").props.value, "schedule"); assert.match(text(tree), /September 2026/)
reset(); location(); render(Calendar, props)
find(node => node.type === "button" && /Show all \d+ events/.test(node.props["aria-label"] ?? "")).props.onClick(); render(Calendar, props)
assert.equal(find(node => node.type === "select").props.value, "day", "crowded days expand without hiding events")
find(node => byName("IconButton")(node) && node.props.label === "Previous mini calendar month").props.onClick(); render(Calendar, props)
find(node => node.type === "button" && node.props["aria-label"] === `Go to ${calendar.calendarDateLabel("2026-09-03")}`).props.onClick(); render(Calendar, props)
assert.match(replaced.at(-1), /date=2026-09-03&view=day/)
reset(); location(); render(Calendar, props)
find(node => node.type === "input" && node.props.type === "checkbox" && all(tree).some(parent => parent.type === "label" && text(parent) === "Work deadlines" && all(parent).includes(node))).props.onChange({ target: { checked: false } }); render(Calendar, props)
assert.ok(!all(tree).some(node => byName("EventButton")(node) && node.props.event.kind === "work"), "category checkboxes filter the real events")
find(node => node.type === "input" && node.props.type === "checkbox" && all(tree).some(parent => parent.type === "label" && text(parent) === "Show completed records" && all(parent).includes(node))).props.onChange({ target: { checked: true } }); render(Calendar, props)
assert.ok(all(tree).some(node => byName("EventButton")(node) && node.props.event.id === "inspection:finished-ir"), "completed checkbox reveals canonical completed records")
reset(); location(); render(Calendar, { ...props, role: "client", events: calendar.projectCalendarEvents({ ...data, role: "client" }).events })
assert.doesNotMatch(text(tree), /QA inspections|Reinspections|NCR deadlines/)
assert.match(text(tree), /Internal QA, NCRs and private staff information are not included/)
reset(); render(Calendar, { ...props, loading: true }); assert.ok(!all(tree).some(byName("EventButton"))); assert.match(text(tree), /Loading project schedules/)
reset(); render(Calendar, { ...props, error: "Offline" }); assert.ok(!all(tree).some(byName("EventButton"))); find(node => node.type === "button" && text(node) === "Retry").props.onClick(); assert.equal(reloaded, 1)

// Actual data composition: restricted roles never request QA/NCR data; stale other-project rows cannot produce events.
let qaCalls = [], periodicKey, currentProject = project
Object.assign(deps, {
  useProjectWork: () => ({ project: currentProject, pins, blueprints: data.blueprints, nameOf: data.nameOf, loading: false, error: "", notFound: false, today: props.today, reload: async () => {} }),
  useInspections: id => { qaCalls.push(["inspections", id]); return { inspections, loading: false, error: "", reload: async () => {} } },
  useDefects: id => { qaCalls.push(["defects", id]); return { defects, loading: false, error: "", reload: async () => {} } },
  usePeriodicReload: key => { periodicKey = key },
})
const Hook = (await compile("../src/lib/projectCalendar.ts", { "./projectCalendarModel": new URL("../src/lib/projectCalendarModel.ts", import.meta.url).href })).useProjectCalendar
for (const role of ["client", "admin"]) { qaCalls = []; const result = Hook("P", role, "F"); assert.deepEqual(qaCalls, [["inspections", null], ["defects", null]]); assert.ok(result.events.every(row => row.kind === "work" || row.kind === "milestone")) }
assert.match(periodicKey, /calendar:admin:P/)
qaCalls = []; assert.ok(Hook("P", "engineer", "E").events.some(row => row.kind === "ncr")); assert.deepEqual(qaCalls, [["inspections", "P"], ["defects", "P"]])
currentProject = { ...project, id: "Q" }; assert.deepEqual(Hook("P", "engineer", "E").events, [], "previous project's canonical object is masked")
reset()

// Page-level identity and project gates exist in addition to the shared RouteGuard and database RLS.
let pageProfile = { id: "E", role: "client", status: "active" }, pageCalls = []
Object.assign(deps, { useAuth: () => ({ profile: pageProfile }), getSelectedProjectId: () => "P", useProjectCalendar: (id, role) => { pageCalls.push({ id, role }); return { project: id ? project : null, loading: false, notFound: false, error: "", today: props.today, events: [], undated: 0, reload: async () => {} } } })
let timelinePageCalls = [], timelinePageState = { data: null, loading: false, error: "Timeline needs setup", setupRequired: true, reload: async () => {} }
Object.assign(deps, { useProjectTimeline: id => { timelinePageCalls.push(id); return timelinePageState }, timelineCalendarEvents: events => events })
const CalendarPage = (await compile("../src/pages/ProjectCalendarPage.tsx", { "../lib/projectCalendarModel": new URL("../src/lib/projectCalendarModel.ts", import.meta.url).href })).default
render(CalendarPage, { role: "engineer" }); assert.equal(pageCalls.at(-1).id, null); assert.ok(!all(tree).some(byName("ProjectCalendar")), "mismatched role starts no project data request")
assert.equal(timelinePageCalls.at(-1), null, "mismatched role starts no timeline request either")
pageProfile = { ...pageProfile, role: "engineer", status: "disabled" }; render(CalendarPage, { role: "engineer" }); assert.equal(pageCalls.at(-1).id, null)
pageProfile = { ...pageProfile, status: "active" }; render(CalendarPage, { role: "engineer" }); assert.equal(pageCalls.at(-1).id, "P"); assert.ok(all(tree).some(byName("ProjectCalendar")))
assert.equal(timelinePageCalls.at(-1), "P"); assert.equal(find(byName("ProjectCalendar")).props.error, "", "existing calendar remains usable before the timeline migration is installed")
timelinePageState = { ...timelinePageState, setupRequired: false, error: "Access denied" }; render(CalendarPage, { role: "engineer" }); assert.equal(find(byName("ProjectCalendar")).props.error, "Access denied", "other timeline failures never silently fall back to stale dates")
reset()

// Every project workspace routes to the shared lazy calendar, not a global /calendar or external Google page.
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8")
for (const role of ["admin", "engineer", "foreman", "client"]) assert.ok(app.includes(`calendar: <ProjectCalendarPage role="${role}" />`))
for (const role of ["Engineer", "Foreman", "Client"]) assert.match(readFileSync(new URL(`../src/pages/${role}/${role}Shell.tsx`, import.meta.url), "utf8"), /item\("calendar"\)/)
assert.match(readFileSync(new URL("../src/pages/Admin/ProjectWorkspace.tsx", import.meta.url), "utf8"), /key: "calendar", label: "Project Calendar"/)
assert.match(readFileSync(new URL("../src/components/calendar/projectCalendar.css", import.meta.url), "utf8"), /@media \(max-width: 760px\)/)
console.log("Project calendar: project/role scoped canonical deadlines and targets, private Client/Admin projection, Foreman assignments, Manila dates, month/week/day/schedule geometry, filters/search/completion, URL history, detail/blueprint links, mini/mobile controls, loading/error guards, restricted reads, stale-project masking and all-role project navigation passed")
