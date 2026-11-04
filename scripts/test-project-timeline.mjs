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
globalThis.__ganttHooks = {
  useEffect() {},
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
const approvalForm = editor.type({ ...editor.props, approval: true })
assert.equal(all(approvalForm).filter(node => node.type === "input" && node.props.type === "date").length, 2, "Proposal approval reviews planned dates only")
assert.doesNotMatch(text(approvalForm), /Actual start|Actual finish|Actual dates record/)
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
console.log(
  "Gantt model and component: date geometry, dependency guards, unverified reported progress, calendar synchronization, zoom, search, task links, editing, role controls, client privacy, and loading/error states passed",
)
