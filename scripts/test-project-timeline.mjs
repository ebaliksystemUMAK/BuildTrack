import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as timeline from "../src/lib/projectTimelineModel.ts"
import * as calendar from "../src/lib/projectCalendarModel.ts"

const item = (key, extra = {}) => ({
  key,
  kind: "work",
  title: key,
  phase: "Foundation",
  planned_start: "2026-11-01",
  planned_end: "2026-11-05",
  actual_start: null,
  actual_end: null,
  predecessors: [],
  pin_id: "P1",
  blueprint_id: "B1",
  owner: "Site foreman",
  assigned_to: "F",
  revision: 1,
  verified: false,
  ...extra,
})
const first = item("task:A", {
  reported_percent: 100,
  reported_start: "2026-11-01",
})
const second = item("task:B", {
  planned_start: "2026-11-06",
  planned_end: "2026-11-09",
  predecessors: [first.key],
})
const undated = item("task:C", {
  planned_start: null,
  planned_end: null,
  pin_id: "P2",
})
const props = {
  projectId: "P",
  projectName: "Test project",
  projectCode: "PRJ-1",
  role: "project_manager",
  today: "2026-11-07",
}
const data = {
  items: [first, second, undated],
  baseline: [first],
  requests: [],
  can_edit: true,
  can_request: false,
  version: 1,
  published_at: "2026-11-01T01:00:00Z",
}
assert.equal(
  timeline.timelineStatus(first, props.today),
  "Overdue",
  "a reported 100% never counts as verified",
)
assert.equal(
  timeline.timelineStatus({ ...first, verified: true }, props.today),
  "Verified",
)
assert.equal(timeline.timelineStatus(undated, props.today), "Unscheduled")
assert.equal(timeline.timelineViewFromSearch('?project=P&tab=gantt&ganttview=requests'),'requests')
assert.equal(timeline.timelineViewFromSearch('?ganttview=history'),'history')
assert.equal(timeline.timelineViewFromSearch('?ganttview=https://invalid.example'),'timeline')
assert.equal(timeline.timelineDays("2024-02-28", "2024-03-01"), 2)
assert.equal(
  timeline.timelinePlanProblem(
    { ...timeline.timelinePlan(first), predecessors: [second.key] },
    first.key,
    data.items,
  ),
  "Each predecessor must finish before this task starts.",
)
assert.match(
  timeline.timelinePlanProblem(
    { ...timeline.timelinePlan(first), planned_end: "2026-11-08" },
    first.key,
    data.items,
  ),
  /dependent task/,
)
assert.match(
  timeline.timelinePlanProblem(
    { ...timeline.timelinePlan(first), actual_end: "2026-11-05" },
    first.key,
    data.items,
  ),
  /actual start/,
)
const geometry = timeline.timelineGeometry(data.items, props.today, "week")
assert.ok(geometry.from < first.planned_start)
assert.ok(geometry.to > second.planned_end)
const leapAxis = timeline.timelineDateAxis({ from: "2028-02-27", days: 6, width: 200 })
assert.deepEqual(leapAxis.dates.map(day => day.date), ["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02", "2028-03-03"])
assert.deepEqual(leapAxis.months.map(month => [month.date.slice(0, 7), month.days]), [["2028-02", 3], ["2028-03", 3]])
const yearAxis = timeline.timelineDateAxis({ from: "2026-12-30", days: 4, width: 200 })
assert.deepEqual(yearAxis.months.map(month => month.date.slice(0, 7)), ["2026-12", "2027-01"])
for (const zoom of ["day", "week", "month"]) {
  const view = timeline.timelineGeometry(data.items, props.today, zoom)
  assert.ok(view.width / view.days >= 20, "Two-digit day numbers remain readable at every zoom")
}
assert.equal(
  timeline.timelineBar(null, null, geometry.from, geometry.days),
  null,
)
assert.deepEqual(
  timeline.timelineBar("2026-11-01", "2026-11-01", "2026-11-01", 10),
  { left: "0%", width: "10%" },
)
const oldEvents = [
  { id: "work:P1", kind: "work" },
  { id: "work:P2", kind: "work" },
  { id: "inspection:I", kind: "inspection" },
]
const combined = timeline.timelineCalendarEvents(
  oldEvents,
  data.items,
  "P",
  "client",
)
assert.ok(!combined.some((row) => row.id === "work:P1"))
assert.ok(combined.some((row) => row.id === "work:P2"))
assert.ok(combined.some((row) => row.id === "inspection:I"))
assert.equal(
  combined.find((row) => row.id === "timeline:task:B").date,
  "2026-11-09",
)
assert.ok(
  combined
    .filter((row) => row.id.startsWith("timeline:"))
    .every((row) => row.owner === null),
)

// Render the actual component with simulated hooks. Exercise the UI's event handlers, not a copy of its logic.
const url = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [],
  cursor = 0,
  tree,
  followed,
  reloads = 0,
  rpcCalls = []
let captureEffects = false
const effectsToRun = []
globalThis.__ganttHooks = {
  useEffect(fn) { if (captureEffects) effectsToRun.push(fn) },
  useState(initial) {
    const n = cursor++
    if (!(n in slots))
      slots[n] = typeof initial === "function" ? initial() : initial
    return [
      slots[n],
      (value) => {
        slots[n] = typeof value === "function" ? value(slots[n]) : value
      },
    ]
  },
  useMemo: (fn) => fn(),
  useRef: () => ({ current: null }),
}
globalThis.__ganttDeps = {
  useAuth: () => ({ profile: { id: "F" } }),
  useToast: () => ({ success() {} }),
  followLink: (path, project) => {
    followed = { path, project }
  },
  buttonPrimary: "primary",
  buttonSecondary: "secondary",
  supabase: {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      return { error: null }
    },
  },
}
const source = readFileSync(
  new URL("../src/components/calendar/ProjectTimeline.tsx", import.meta.url),
  "utf8",
)
const ast = ts.createSourceFile(
  "ProjectTimeline.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
let output = ts.transpileModule(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const replacements = {
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "../../lib/projectTimelineModel": new URL(
    "../src/lib/projectTimelineModel.ts",
    import.meta.url,
  ).href,
  "../../lib/projectCalendarModel": new URL(
    "../src/lib/projectCalendarModel.ts",
    import.meta.url,
  ).href,
  "../../lib/pinRecordsModel": new URL(
    "../src/lib/pinRecordsModel.ts",
    import.meta.url,
  ).href,
}
for (const node of ast.statements.filter(ts.isImportDeclaration)) {
  const name = node.moduleSpecifier.text
  if (!node.importClause) {
    output = output.replace(`import "${name}";`, "")
    continue
  }
  if (node.importClause.isTypeOnly || name in replacements) continue
  const exports = []
  if (node.importClause.name)
    exports.push(
      `export default function ${node.importClause.name.text}(){return null}`,
    )
  for (const binding of node.importClause.namedBindings?.elements ?? []) {
    if (binding.isTypeOnly) continue
    const key = binding.name.text
    exports.push(
      `export const ${key}=globalThis.${
        name === "react" ? "__ganttHooks" : "__ganttDeps"
      }.${key}`,
    )
  }
  replacements[name] = url(exports.join(";"))
}
for (const [name, value] of Object.entries(replacements))
  output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(value)}`)
const Component = (await import(url(output))).default
const render = (changes = {}) => {
  cursor = 0
  tree = Component({
    ...props,
    timeline: {
      data,
      loading: false,
      error: "",
      reload: async () => {
        reloads++
      },
    },
    ...changes,
  })
  return tree
}
const all = (node) =>
  Array.isArray(node)
    ? node.flatMap(all)
    : node && typeof node === "object"
      ? [node, ...all(node.props?.children), ...all(node.props?.footer)]
      : []
const text = (node) =>
  Array.isArray(node)
    ? node.map(text).join("")
    : node?.props
      ? text(node.props.children)
      : typeof node === "string" || typeof node === "number"
        ? String(node)
        : ""
const find = (predicate) => {
  const result = all(tree).find(predicate)
  assert.ok(result, "Expected a timeline control")
  return result
}
const reset = () => {
  slots = []
  cursor = 0
}
render()
assert.match(text(tree), /Gantt Timeline/)
assert.match(text(tree), /Unscheduled tasks/)
const dayLabels = () => all(tree).filter(node => node.props?.className === "bt-gantt-day")
assert.deepEqual(dayLabels().map(node => node.props["data-date"]), timeline.timelineDateAxis(geometry).dates.map(day => day.date), "The axis includes every date in its visible range")
assert.ok(dayLabels().every(node => text(node) === String(Number(node.props["data-date"].slice(8)))))
assert.equal(dayLabels().find(node => node.props["data-date"] === props.today).props["aria-current"], "date")
const longItems = [item("task:long", { planned_start: "2026-01-01", planned_end: "2027-12-31", predecessors: [] })]
const longProps = { timeline: { data: { ...data, items: longItems, baseline: [] }, loading: false, error: "", reload: async () => {} } }
const longGeometry = timeline.timelineGeometry(longItems, props.today, "week")
render(longProps)
assert.ok(dayLabels().length < 70, "Long projects render only visible date labels with a small buffer")
find(node => node.props?.className === "bt-gantt-scroll").props.onScroll({ currentTarget: { scrollLeft: 7000, clientWidth: 900 } })
render(longProps)
assert.deepEqual(dayLabels().map(node => node.props["data-date"]), timeline.timelineDateAxis(longGeometry, 7000, 900).dates.map(day => day.date), "Scrolling reveals each later date without gaps")
reset(); render()
assert.ok(all(tree).some((node) => node.type === "svg"))
assert.ok(
  all(tree).some((node) => node.type === "path" && node.props.markerEnd),
)
find(
  (node) => node.type === "input" && node.props.type === "search",
).props.onChange({ target: { value: "task:B" } })
render()
assert.ok(
  !all(tree).some(
    (node) =>
      node.type === "button" && node.props["aria-label"]?.startsWith("task:A,"),
  ),
)
reset()
render()
find(
  (node) =>
    node.type === "select" && node.props["aria-label"] === "Timeline zoom",
).props.onChange({ target: { value: "month" } })
render()
assert.equal(
  find(
    (node) =>
      node.type === "select" && node.props["aria-label"] === "Timeline zoom",
  ).props.value,
  "month",
)
find(
  (node) =>
    node.type === "button" && node.props["aria-label"]?.startsWith("task:A,"),
).props.onClick()
render()
assert.ok(all(tree).some((node) => node.type?.name === "Modal"))
find(
  (node) => node.type === "button" && text(node) === "Open task & blueprint",
).props.onClick()
assert.match(followed.path, /pin=P1&pintab=checklist/)
assert.equal(followed.project, "P")
find(
  (node) => node.type === "button" && text(node) === "Edit schedule",
).props.onClick()
render()
const editor = find((node) => node.type?.name === "ScheduleForm")
const savedEditorSlots = slots
slots = []; cursor = 0
const approvalSaves = []
const approvalProps = { ...editor.props, approval: true, onSave: async (plan, reason) => { approvalSaves.push({ plan, reason }); return null } }
const approvalForm = editor.type(approvalProps)
assert.equal(all(approvalForm).filter(node => node.type === "input" && node.props.type === "date").length, 2, "Proposal approval reviews planned dates only")
assert.doesNotMatch(text(approvalForm), /Actual start|Actual finish|Actual dates record/)
assert.equal(all(approvalForm).find(node => node.type === 'textarea').props.required, false)
assert.equal(all(approvalForm).find(node => node.type === 'textarea').props.minLength, undefined)
assert.equal(all(approvalForm).find(node => node.type === 'button' && text(node) === 'Approve schedule').props.disabled, false)
await all(approvalForm).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(approvalSaves.at(-1).reason, '', 'The actual approval form accepts a blank reason')
all(approvalForm).find(node => node.type === 'textarea').props.onChange({ target: { value: 'a' } })
cursor = 0
const shortApproval = editor.type(approvalProps)
await all(shortApproval).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
assert.equal(approvalSaves.at(-1).reason, 'a', 'An optional reason has no minimum length')
slots = savedEditorSlots
await editor.props.onSave(
  timeline.timelinePlan(first),
  "Coordinated site schedule",
)
assert.equal(rpcCalls.at(-1).name, "save_timeline_item")
assert.equal(rpcCalls.at(-1).args.p_expected, 1)
assert.equal(reloads, 1)
reset()
render({
  role: "foreman",
  timeline: {
    data: { ...data, can_edit: false, can_request: true },
    loading: false,
    error: "",
    reload: async () => {},
  },
})
assert.ok(
  !all(tree).some(
    (node) => node.type === "button" && text(node) === "Publish schedule",
  ),
)
find(
  (node) =>
    node.type === "button" && node.props["aria-label"]?.startsWith("task:A,"),
).props.onClick()
render({
  role: "foreman",
  timeline: {
    data: { ...data, can_edit: false, can_request: true },
    loading: false,
    error: "",
    reload: async () => {},
  },
})
assert.ok(
  all(tree).some(
    (node) => node.type === "button" && text(node) === "Request date change",
  ),
)
reset()
render({
  role: "client",
  timeline: {
    data: {
      ...data,
      can_edit: false,
      can_request: false,
      items: data.items.map(
        ({ owner, reported_percent, assigned_to, ...row }) => row,
      ),
    },
    loading: false,
    error: "",
    reload: async () => {},
  },
})
assert.doesNotMatch(
  text(tree),
  /Reported progress|My tasks|Publish schedule|Site foreman/,
)
reset()
render({
  timeline: { data: null, loading: true, error: "", reload: async () => {} },
})
assert.match(text(tree), /Loading project timeline/)
assert.ok(!all(tree).some((node) => node.type === "svg"))
reset()
render({
  timeline: {
    data: null,
    loading: false,
    error: "Offline",
    reload: async () => {
      reloads++
    },
  },
})
assert.match(text(tree), /Offline/)
await find(
  (node) => node.type === "button" && text(node) === "Retry",
).props.onClick()
assert.equal(reloads, 2)
reset()
const pendingProposal = { ...timeline.timelinePlan(undated), planned_start: '2026-11-10', planned_end: '2026-11-14', phase: 'Structural' }
const requests = [
  { id: 'REQ-PENDING', work_key: undated.key, status: 'pending', proposal: pendingProposal, expected_revision: 0, reason: 'Coordinate the concrete crew', created_at: '2026-11-06T18:00:00Z', review_note: null },
  { id: 'REQ-APPROVED', work_key: second.key, status: 'approved', proposal: timeline.timelinePlan(second), approved_plan: timeline.timelinePlan(second), reason: 'Earlier request explanation', created_at: '2026-11-05T01:00:00Z', review_note: 'Reviewed and approved separately' },
  { id: 'REQ-DRAFT', work_key: first.key, status: 'draft', proposal: timeline.timelinePlan(first), reason: 'Private unsent explanation' },
]
const detailedData = { ...data, items: [first, second, { ...undated, title: 'Undated wall', pin_title: 'Bedroom', location: 'First floor plan' }], requests }
const detailProps = { timeline: { data: detailedData, loading: false, error: '', reload: async () => {} } }
const sectionTab = label => find(node => node.props?.role === 'tab' && text(node).startsWith(label))
render(detailProps)
assert.equal(sectionTab('Pending requests').props.children[1].props.children, 1)
assert.equal(sectionTab('Request history').props.children[1].props.children, 1)
assert.equal(sectionTab('Unscheduled tasks').props.children[1].props.children, 1)
assert.ok(!all(tree).some(node => node.type === 'table'), 'Task and request lists are separate from the timeline')
assert.doesNotMatch(text(tree), /Coordinate the concrete crew|Earlier request explanation|Private unsent explanation/)
sectionTab('Pending requests').props.onClick();render(detailProps)
assert.equal(sectionTab('Pending requests').props['aria-selected'], true)
assert.match(text(tree), /Coordinate the concrete crew|Undated wall/)
assert.doesNotMatch(text(tree), /Earlier request explanation|Private unsent explanation/)
assert.ok(all(tree).some(node => node.type === 'table'))
assert.ok(all(tree).some(node => node.type === 'td' && text(node).includes(calendar.calendarDateLabel('2026-11-07', { day: 'numeric', month: 'short', year: 'numeric' }))), 'Submitted dates use the Philippine day across UTC midnight boundaries')
assert.ok(!all(tree).some(node => node.type === 'svg'), 'Pending requests do not show the Gantt chart underneath')
find(node => node.type === 'button' && text(node) === 'Review & approve').props.onClick();render(detailProps)
await find(node => node.type?.name === 'ScheduleForm').props.onSave(pendingProposal, 'Dates reviewed by the Project Manager')
assert.equal(rpcCalls.at(-1).name, 'decide_timeline_request')
assert.equal(rpcCalls.at(-1).args.p_request, 'REQ-PENDING')
render(detailProps)
sectionTab('Request history').props.onClick();render(detailProps)
assert.match(text(tree), /Earlier request explanation|Reviewed and approved separately/)
assert.doesNotMatch(text(tree), /Coordinate the concrete crew|Private unsent explanation/)
assert.ok(!all(tree).some(node => node.type === 'button' && text(node) === 'Review & approve'))
sectionTab('Unscheduled tasks').props.onClick();render(detailProps)
assert.match(text(tree), /Undated wall|Bedroom|First floor plan|Assigned Foreman|Current dates/)
assert.ok(!all(tree).some(node => node.props?.['aria-label'] === 'Timeline zoom'))
find(node => node.props?.['aria-label'] === 'View Undated wall details').props.onClick();render(detailProps)
assert.ok(all(tree).some(node => node.type?.name === 'Modal' && node.props.title === 'Undated wall'))
find(node => node.type?.name === 'Modal').props.onClose();render(detailProps)
find(node => node.props?.['aria-label'] === 'Search timeline tasks').props.onChange({ target: { value: 'No matching wall' } });render(detailProps)
assert.match(text(tree), /No unscheduled tasks match your filters/)
sectionTab('Unscheduled tasks').props.onKeyDown({ key: 'ArrowLeft', preventDefault() {}, currentTarget: {} });render(detailProps)
assert.equal(sectionTab('Pending requests').props['aria-selected'], true, 'Arrow keys move between the tabs')
sectionTab('Pending requests').props.onKeyDown({ key: 'Home', preventDefault() {}, currentTarget: {} });render(detailProps)
assert.equal(sectionTab('Timeline').props['aria-selected'], true)
assert.equal(find(node => node.props?.['aria-label'] === 'Search timeline tasks').props.value, 'No matching wall', 'Search survives tab changes')
sectionTab('Pending requests').props.onClick()
render({ ...detailProps, role: 'foreman', timeline: { ...detailProps.timeline, data: { ...detailedData, can_edit: false, can_request: true } } })
assert.match(text(tree), /Coordinate the concrete crew/)
assert.ok(!all(tree).some(node => node.type === 'button' && ['Review & approve', 'Reject'].includes(text(node))), 'Read-only request viewers cannot make PM decisions')
render({ ...detailProps, role: 'client', timeline: { ...detailProps.timeline, data: { ...detailedData, can_edit: false, can_request: false } } })
assert.ok(!all(tree).some(node => node.props?.role === 'tab'), 'Client publication view has no internal request or unscheduled tabs')
assert.doesNotMatch(text(tree), /Coordinate the concrete crew|Earlier request explanation|Private unsent explanation/)
reset();render({ timeline: { ...detailProps.timeline, data } })
sectionTab('Pending requests').props.onClick();render({ timeline: { ...detailProps.timeline, data } })
assert.match(text(tree), /No schedule requests are awaiting review/)
find(node => node.type === 'button' && text(node) === 'Publish schedule').props.onClick()
render({ timeline: { ...detailProps.timeline, data } })
const publicationDialog = find(node => node.type?.name === 'Modal' && node.props.title === 'Publish schedule & save baseline')
assert.equal(all(publicationDialog).find(node => node.type === 'textarea').props.required, false)
assert.equal(all(publicationDialog).find(node => node.type === 'textarea').props.minLength, undefined)
assert.equal(all(publicationDialog).find(node => node.type === 'button' && node.props.type === 'submit').props.disabled, false)
all(publicationDialog).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
for (let tick = 0; tick < 6; tick++) await Promise.resolve()
assert.equal(rpcCalls.at(-1).name, 'publish_project_timeline')
assert.equal(rpcCalls.at(-1).args.p_reason, '', 'Publishing sends an absent reason without placeholder text')
const previousWindow=globalThis.window
const linkListeners={}
globalThis.window={location:{search:'?project=P&tab=gantt&ganttview=requests'},addEventListener:(name,fn)=>{linkListeners[name]=fn},removeEventListener:name=>{delete linkListeners[name]}}
captureEffects=true
reset();render(detailProps)
assert.equal(sectionTab('Pending requests').props['aria-selected'],true,'Email links open the PM request queue')
const cleanups=effectsToRun.splice(0).map(fn=>fn())
window.location.search='?project=P&tab=gantt&ganttview=history';linkListeners.popstate();render(detailProps)
assert.equal(sectionTab('Request history').props['aria-selected'],true,'An already open Gantt follows notification navigation')
cleanups.forEach(fn=>fn?.())
captureEffects=false;effectsToRun.length=0
if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow
console.log(
  "Gantt model and component: date geometry, dependency guards, unverified reported progress, calendar synchronization, zoom, search, task links, editing, separate timeline/request/unscheduled/history tabs, detail tables, PM review, keyboard controls, client privacy, and loading/error states passed",
)
