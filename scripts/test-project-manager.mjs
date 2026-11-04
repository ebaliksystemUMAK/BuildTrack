import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import ts from "typescript"
import {
  PM_EDITABLE_FIELDS,
  concernProblem,
  dashboardSummary,
  detailsForm,
  detailsPatch,
  myDesignation,
  pmAccess,
  slotChange,
  slotsOf,
  slotLabels,
  statusNeedsConfirm,
  validateDetails,
} from "../src/lib/projectManagerModel.ts"
import { PM_PAGES, PM_WORKSPACE_ROLES, adminToPmPath, fieldPagePath, fieldShellMode, isPmPage } from "../src/lib/projectRoutes.ts"
import { calendarKindsFor, calendarQaAllowed, calendarRoleMatches } from "../src/lib/projectCalendarModel.ts"
import { panelRole, pinPlanPath } from "../src/lib/pinRecordsModel.ts"
import { qaRecordPath } from "../src/lib/qaAttemptsModel.ts"

// Pure rules of the Project Manager workspace (20261029100000). The database enforces the same rules;
// supabase/tests/99-…-project-managers.cases.mjs proves them there.
let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`) }

const row = (project_id, user_id, designation, full_name = user_id) => ({ project_id, user_id, designation, full_name, email: null, active: true, assigned_at: "2026-10-29T00:00:00Z" })
const managers = [row("p1", "ana", "primary"), row("p1", "ben", "backup"), row("p2", "ana", "backup")]

test("slots: one primary and one backup per project; designations never cross projects", () => {
  const slots = slotsOf(managers, "p1")
  assert.equal(slots.primary?.user_id, "ana")
  assert.equal(slots.backup?.user_id, "ben")
  assert.deepEqual(slotsOf(managers, "p3"), { primary: null, backup: null })
  assert.equal(myDesignation(managers, "p2", "ana"), "backup")
  assert.equal(myDesignation(managers, "p2", "ben"), null)
})

test("slot changes mirror assign_project_manager: unchanged, assign, replace, swap, move", () => {
  assert.equal(slotChange(managers, "p1", "ana", "primary").kind, "unchanged")
  assert.equal(slotChange(managers, "p3", "ana", "primary").kind, "assign")
  const replace = slotChange(managers, "p1", "cara", "primary")
  assert.equal(replace.kind, "replace")
  assert.equal(replace.replaced?.user_id, "ana")
  assert.equal(slotChange(managers, "p1", "ben", "primary").kind, "swap")
  assert.equal(slotChange(managers, "p2", "ana", "primary").kind, "move")
})

test("editable fields are exactly the SQL guard's list (guard_project_manager_edit)", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url)
  const file = readdirSync(dir).filter((name) => name.endsWith("_project_manager_workspace.sql"))[0]
  const sql = readFileSync(new URL(file, dir), "utf8")
  const allowed = sql.match(/allowed text\[\] := array\[([^\]]+)\]/)[1].split(",").map((item) => item.trim().replace(/'/g, "")).filter((item) => item !== "updated_at")
  assert.deepEqual([...allowed].sort(), [...PM_EDITABLE_FIELDS].sort())
})

const project = {
  id: "p1", code: "VCB-1", name: "Tower", location: "Quezon City", client_name: "Acme", description: null, phase: "execution", status: "active",
  start_date: "2026-11-01", end_date: "2027-06-30", manager_name: "R. Valencia", lead_engineer_id: "eng", lead_foreman_id: null,
  disciplines: ["mep"], site_lat: 14.6, site_lng: 121, site_radius_m: 150, created_at: "2026-10-01T00:00:00Z",
}

test("details: the patch holds only editable columns that changed; numbers compare by value", () => {
  const form = detailsForm(project)
  assert.deepEqual(detailsPatch(form, project), {}, "untouched form changes nothing")
  const edited = { ...form, location: "  Pasig ", status: "on_hold", site_radius_m: "200", lead_foreman_id: "fore", site_lat: "14.600" }
  const patch = detailsPatch(edited, project)
  assert.deepEqual(patch, { location: "Pasig", status: "on_hold", site_radius_m: 200, lead_foreman_id: "fore" })
  for (const key of Object.keys(patch)) assert.ok(PM_EDITABLE_FIELDS.includes(key))
  assert.deepEqual(detailsPatch({ ...form, client_name: "" }, project), { client_name: null })
})

test("details: same limits as the Admin form", () => {
  const form = detailsForm(project)
  assert.deepEqual(validateDetails(form), {})
  assert.ok(validateDetails({ ...form, end_date: "2026-10-01" }).end_date)
  assert.ok(validateDetails({ ...form, site_lat: "14.6", site_lng: "" }).site_lat)
  assert.ok(validateDetails({ ...form, site_lat: "95", site_lng: "121" }).site_lat)
  assert.ok(validateDetails({ ...form, site_radius_m: "10" }).site_radius_m)
  assert.ok(validateDetails({ ...form, location: "x".repeat(201) }).location)
  assert.equal(statusNeedsConfirm("active", "on_hold"), true)
  assert.equal(statusNeedsConfirm("planning", "active"), false)
  assert.equal(statusNeedsConfirm("cancelled", "cancelled"), false)
})

test("access: only assigned Project Managers manage their open projects in the PM workspace", () => {
  for (const designation of ["primary", "backup"]) {
    assert.deepEqual(pmAccess({ role: "project_manager", designation, archived: false }), { manage: true, note: null })
    assert.equal(pmAccess({ role: "project_manager", designation, archived: true }).manage, false)
  }
  assert.equal(pmAccess({ role: "project_manager", designation: null, archived: false }).manage, false)
  for (const role of ["admin", "super_admin", "engineer", "foreman", "client", "user", null]) {
    assert.equal(pmAccess({ role, designation: "primary", archived: false }).manage, false)
  }
  assert.match(pmAccess({ role: "super_admin", designation: null, archived: false }).note, /Super Admin view/, "the Super Admin sees why it is view-only")
  assert.doesNotMatch(pmAccess({ role: "admin", designation: null, archived: false }).note, /Super Admin view/)
})

test("dashboard: progress, reviews waiting, open / late NCRs and deadlines (late first, then the next 14 days)", () => {
  const pins = [
    { id: "a", title: "Wall", status: "verified", category: "progress", due_date: "2026-10-20", blueprint_id: "s" },
    { id: "b", title: "Slab", status: "for_review", category: "progress", due_date: "2026-10-25", blueprint_id: "s" },
    { id: "c", title: "Beam", status: "in_progress", category: "progress", due_date: "2026-11-05", blueprint_id: "s" },
    { id: "d", title: "Far", status: "not_started", category: "progress", due_date: "2027-01-05", blueprint_id: "s" },
    { id: "n", title: "Note", status: "not_started", category: "note", due_date: "2026-10-01", blueprint_id: "s" },
  ]
  const inspections = [{ id: "i1", status: "requested", title: "IR", requested_at: "x" }, { id: "i2", status: "passed", title: "IR2", requested_at: "x" }]
  const defects = [
    { id: "d1", status: "open", severity: "critical", title: "Crack", due_date: "2026-10-27" },
    { id: "d2", status: "for_verification", severity: "minor", title: "Paint", due_date: "2026-11-02" },
    { id: "d3", status: "closed", severity: "major", title: "Done", due_date: "2026-10-01" },
  ]
  const taskPins = pins.map(pin => ({ ...pin, tasks: [{ id: pin.id, pin_id: pin.id, text: pin.title, done: pin.status === "verified", review_status: pin.status === "verified" ? "verified" : "not_submitted" }] }))
  const s = dashboardSummary({ pins: taskPins, inspections, defects, project: { start_date: "2026-10-01", end_date: "2026-11-10", status: "active" }, today: "2026-10-29" })
  assert.equal(s.totals.total, 4, "notes are not work")
  assert.equal(s.totals.percentVerified, 25)
  assert.equal(s.pendingReviews, 1)
  assert.equal(s.openInspections, 1)
  assert.equal(s.ncrForVerification, 1)
  assert.equal(s.reviewsWaiting, 3)
  assert.equal(s.openNcrs, 2)
  assert.equal(s.overdueNcrs, 1)
  assert.equal(s.correction, 1)
  assert.deepEqual(s.bySeverity, { critical: 1, major: 0, minor: 1 })
  assert.deepEqual(s.deadlines.map((row) => `${row.kind}:${row.title}:${row.late}`), ["work:Slab:true", "ncr:Crack:true", "ncr:Paint:false", "work:Beam:false", "milestone:Target completion:false"])
  assert.equal(s.lateDeadlines, 2)
})

test("attendance concerns: kind, day (today or up to 120 days back) and a 5-500 character note", () => {
  const ok = { day: "2026-10-28", today: "2026-10-29", note: "Absent three days", category: "absence" }
  assert.equal(concernProblem(ok), null)
  assert.match(concernProblem({ ...ok, category: "mood" }), /kind/)
  assert.match(concernProblem({ ...ok, day: "2026-10-30" }), /today or an earlier/)
  assert.match(concernProblem({ ...ok, day: "2026-01-01" }), /120 days/)
  assert.match(concernProblem({ ...ok, note: "late" }), /5 to 500/)
})

test("routes: Project Manager pages carry the project; Admin project links open the same place in the workspace", () => {
  assert.deepEqual(PM_WORKSPACE_ROLES, ["project_manager", "super_admin"], "Super Admin can open the Project Manager workspace; a regular Admin cannot")
  assert.equal(PM_PAGES.length, 10)
  assert.ok(isPmPage("audit") && !isPmPage("settings") && !isPmPage("biometrics"))
  assert.equal(fieldPagePath("pm", "dashboard", "p1"), "/pm/dashboard?project=p1")
  assert.equal(fieldPagePath("pm", "projects", "p1"), "/pm/projects")
  assert.equal(fieldShellMode({ page: "team", projectId: null, notFound: false }), "list")
  const id = "11111111-2222-4333-8444-555555555555"
  assert.equal(adminToPmPath(`/admin/projects/${id}/overview`, ""), `/pm/dashboard?project=${id}`)
  assert.equal(adminToPmPath(`/admin/projects/${id}/blueprints`, "?pin=x&sheet=y"), `/pm/blueprints?pin=x&sheet=y&project=${id}`)
  assert.equal(adminToPmPath(`/admin/projects/${id}/versions`, ""), `/pm/blueprints?project=${id}&tab=versions`)
  assert.equal(adminToPmPath("/admin/project-overview", `?project=${id}`), `/pm/dashboard?project=${id}`)
  assert.equal(adminToPmPath("/admin/settings", `?project=${id}`), null, "company pages have no Project Manager equivalent")
  assert.equal(adminToPmPath("/admin/project-overview", ""), null, "no project, no destination")
})

test("shared models: calendar, pin links and QA record links know the Project Manager", () => {
  assert.deepEqual(calendarKindsFor("project_manager"), ["work", "inspection", "reinspection", "ncr", "milestone"])
  assert.equal(calendarQaAllowed("project_manager"), true)
  assert.equal(calendarQaAllowed("admin"), false, "the Admin calendar is unchanged")
  assert.equal(calendarRoleMatches("project_manager", "project_manager"), true)
  assert.equal(calendarRoleMatches("project_manager", "admin"), true, "Admins in oversight")
  assert.equal(calendarRoleMatches("project_manager", "engineer"), false)
  assert.equal(calendarRoleMatches("admin", "project_manager"), false)
  assert.equal(pinPlanPath("project_manager", { projectId: "p1", pinId: "x", sheetId: "s" }), "/pm/blueprints?project=p1&sheet=s&pin=x")
  assert.equal(panelRole("project_manager"), "admin", "plans open read-only like the Admin view")
  assert.equal(qaRecordPath("project_manager", "p1", "defect", "d1"), "/pm/quality?project=p1&tab=defects&defect=d1")
  assert.equal(qaRecordPath("engineer", "p1", "defect", "d1"), "/engineer/qa?project=p1&tab=defects&defect=d1", "Engineer links unchanged")
})

// Render the actual PM dashboard with scoped data; each tab shows only its own contents.
let dashboardSlots=[], dashboardCursor=0, dashboardTree, dashboardNavigation=[], dashboardLinks=[], dashboardReloads=0
const dashboardProject={id:'p1',code:'PM-1',name:'Dashboard project',status:'active',phase:'preparation',start_date:'2026-11-01',end_date:'2026-11-20'}
let dashboardPm={projectId:'p1',canManage:true,loading:false,note:null,managers:[{designation:'primary',full_name:'Primary manager'}]}
let dashboardWork={project:dashboardProject,loading:false,error:'',today:'2026-11-05',pins:[{id:'PIN',blueprint_id:'PLAN',title:'Foundation wall',status:'in_progress',category:'progress',due_date:'2026-11-08',tasks:[{id:'TASK',done:false,review_status:'not_submitted'}]}],team:[{role:'engineer',is_lead:true,full_name:'Lead Engineer'},{role:'foreman',is_lead:true,full_name:'Lead Foreman'}],reload:async()=>{dashboardReloads++}}
let dashboardAudit={loading:false,error:'',entries:[{id:'AUDIT',action:'project.updated',subject:'Schedule adjusted',actor_name:'Recorded actor',actor_role:'project_manager',created_at:'2026-11-05T00:00:00Z'}]}
globalThis.__pmDashboardHooks={useMemo:fn=>fn(),useState(initial){const index=dashboardCursor++;if(!(index in dashboardSlots))dashboardSlots[index]=typeof initial==='function'?initial():initial;return[dashboardSlots[index],value=>{dashboardSlots[index]=typeof value==='function'?value(dashboardSlots[index]):value}]}}
globalThis.__pmDashboardDeps={
  usePmProject:()=>dashboardPm,useProjectWork:()=>dashboardWork,useProjectAudit:()=>dashboardAudit,
  useDefects:()=>({defects:[{id:'DEFECT',status:'open',severity:'major',title:'Repair opening',due_date:'2026-11-09'}],loading:false}),useInspections:()=>({inspections:[],loading:false}),
  dashboardSummary,slotLabels,scheduleElapsed:()=>25,statusLabels:{active:'Active'},phaseLabels:{preparation:'Preparation'},
  activityLabel:value=>value,formatDate:value=>value,formatTime:()=>'',roleLabel:{project_manager:'Project Manager'},
  pinPlanPath,qaRecordPath,followLink:(path,project)=>dashboardLinks.push({path,project}),buttonPrimary:'primary',buttonSecondary:'secondary',
}
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64')
const dashboardSource=readFileSync(new URL('../src/pages/ProjectManager/PmDashboard.tsx',import.meta.url),'utf8')
const dashboardAst=ts.createSourceFile('dashboard.tsx',dashboardSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
let dashboardOutput=ts.transpileModule(dashboardSource,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText
const dashboardImports={'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')}
for(const declaration of dashboardAst.statements.filter(ts.isImportDeclaration)){
  if(!declaration.importClause||declaration.importClause.isTypeOnly)continue
  const name=declaration.moduleSpecifier.text,exports=[]
  if(declaration.importClause.name)exports.push(`export default function ${declaration.importClause.name.text}(){return null}`)
  for(const binding of declaration.importClause.namedBindings?.elements??[]){if(binding.isTypeOnly)continue;const key=binding.name.text;exports.push(`export const ${key}=globalThis.${name==='react'?'__pmDashboardHooks':'__pmDashboardDeps'}.${key} ?? function ${key}(){return null}`)}
  dashboardImports[name]=moduleUrl(exports.join(';'))
}
for(const[name,value]of Object.entries(dashboardImports))dashboardOutput=dashboardOutput.replaceAll(`from "${name}"`,`from ${JSON.stringify(value)}`)
const Dashboard=(await import(moduleUrl(dashboardOutput))).default
const renderDashboard=()=>{dashboardCursor=0;dashboardTree=Dashboard({onNavigate:(...args)=>dashboardNavigation.push(args)})}
const nodes=node=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...nodes(node.props?.children),...nodes(node.props?.actions)]:[]
const nodeText=node=>Array.isArray(node)?node.map(nodeText).join(''):node?.props?nodeText(node.props.children):typeof node==='string'||typeof node==='number'?String(node):''
const control=predicate=>{const result=nodes(dashboardTree).find(predicate);assert.ok(result,'Expected PM dashboard control');return result}
const tab=label=>control(node=>node.props?.role==='tab'&&nodeText(node)===label)
const showTab=label=>{tab(label).props.onClick();renderDashboard()}
renderDashboard()
assert.deepEqual(nodes(dashboardTree).filter(node=>node.props?.role==='tab').map(nodeText),['Overview','Schedule & deadlines','QA','Team','Activity'])
assert.deepEqual(nodes(dashboardTree).filter(node=>node.type?.name==='Panel').map(node=>node.props.title),['Progress against the plan'])
assert.equal(nodes(dashboardTree).filter(node=>node.type?.name==='StatCard').length,5)
assert.ok(nodes(dashboardTree).some(node=>node.type?.name==='SCurveChart'))
showTab('Schedule & deadlines')
assert.match(nodeText(dashboardTree),/Foundation wall|Repair opening/)
assert.ok(!nodes(dashboardTree).some(node=>node.type?.name==='SCurveChart'))
control(node=>node.type==='button'&&nodeText(node)==='Open Gantt timeline').props.onClick();assert.deepEqual(dashboardNavigation.at(-1),['calendar','tab=gantt'])
control(node=>node.type==='button'&&nodeText(node).includes('Foundation wall')).props.onClick();assert.equal(dashboardLinks.at(-1).project,'p1');assert.match(dashboardLinks.at(-1).path,/pin=PIN/)
showTab('QA');assert.deepEqual(nodes(dashboardTree).filter(node=>node.type?.name==='Panel').map(node=>node.props.title),['Quality issues'])
assert.match(nodeText(dashboardTree),/Major|In correction/)
control(node=>node.type==='button'&&nodeText(node)==='Open Quality & QA').props.onClick();assert.deepEqual(dashboardNavigation.at(-1),['quality'])
showTab('Team');assert.match(nodeText(dashboardTree),/Primary manager|Lead Engineer|Lead Foreman/)
control(node=>node.type==='button'&&nodeText(node).startsWith('Team & work access')).props.onClick();assert.deepEqual(dashboardNavigation.at(-1),['team'])
showTab('Activity');assert.match(nodeText(dashboardTree),/Schedule adjusted|Recorded actor/);assert.doesNotMatch(nodeText(dashboardTree),/Lead Engineer/)
control(node=>node.type==='button'&&nodeText(node).startsWith('Project audit log')).props.onClick();assert.deepEqual(dashboardNavigation.at(-1),['audit'])
tab('Activity').props.onKeyDown({key:'ArrowRight',preventDefault(){},currentTarget:{}});renderDashboard();assert.equal(tab('Overview').props['aria-selected'],true)
tab('Overview').props.onKeyDown({key:'End',preventDefault(){},currentTarget:{}});renderDashboard();assert.equal(tab('Activity').props['aria-selected'],true)
dashboardAudit={loading:false,error:'Could not load activity',entries:[]};renderDashboard();assert.match(nodeText(dashboardTree),/Could not load activity/)
dashboardAudit={loading:false,error:'',entries:[]};renderDashboard();assert.match(nodeText(dashboardTree),/No activity recorded yet/)
showTab('Team');dashboardPm={...dashboardPm,loading:true};renderDashboard();assert.ok(nodes(dashboardTree).some(node=>node.type?.name==='SkeletonList'));assert.doesNotMatch(nodeText(dashboardTree),/Lead Engineer/)
dashboardPm={...dashboardPm,loading:false,projectId:'p2'};renderDashboard();assert.ok(nodes(dashboardTree).some(node=>node.props?.label==='Loading the project dashboard'),'Previous project data is masked during a project switch')
dashboardWork={...dashboardWork,project:{...dashboardProject,id:'p2',name:'Second project'}};renderDashboard();assert.equal(tab('Overview').props['aria-selected'],true,'A new project starts on Overview')
dashboardPm={...dashboardPm,canManage:false};renderDashboard();assert.ok(nodes(dashboardTree).some(node=>node.type==='button'&&nodeText(node)==='View details'))
console.log('  ok   PM dashboard: separate content tabs, figures/chart, project-safe links, keyboard controls, activity/team states and project-switch isolation')
console.log(`\n${passed} model checks plus dashboard component checks passed`)
