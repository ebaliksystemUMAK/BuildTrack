import assert from "node:assert/strict"

import { readFileSync } from "node:fs"

import ts from "typescript"

import {
  attendanceDay,
  emptyAttendanceSummary,
} from "../src/lib/attendanceModel.ts"

// Exercise real component controls with isolated hooks; no credentials, device simulation or production data.

const moduleUrl = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")

let state = [],
  cursor = 0,
  effectState = [],
  effects = [],
  effectCursor = 0

globalThis.__attendanceHooks = {
  useState(initial) {
    const id = cursor++

    if (!(id in state))
      state[id] = typeof initial === "function" ? initial() : initial

    return [
      state[id],

      (value) => {
        state[id] = typeof value === "function" ? value(state[id]) : value
      },
    ]
  },

  useEffect(effect, deps) {
    const id = effectCursor++

    if (
      !effectState[id] ||
      deps.some((value, index) => value !== effectState[id][index])
    ) {
      effectState[id] = deps

      effects.push(effect)
    }
  },

  useMemo(fn) {
    return fn()
  },
}

globalThis.window = { setInterval: () => 1, clearInterval: () => {} }

const hooks = moduleUrl(
  "export const useState=(...args)=>globalThis.__attendanceHooks.useState(...args); export const useEffect=(...args)=>globalThis.__attendanceHooks.useEffect(...args); export const useMemo=(...args)=>globalThis.__attendanceHooks.useMemo(...args);",
)

const data = moduleUrl(
  "export const useAttendance=(...args)=>{globalThis.__attendanceLastArgs=args;return globalThis.__attendanceData};",
)

const portrait = moduleUrl(
  "export default function WorkerPortrait(){return null}",
)

async function compile(file, replacements) {
  let compiled = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), "utf8"),

    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,

        module: ts.ModuleKind.ESNext,

        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText

  for (const [path, replacement] of Object.entries({
    react: hooks,

    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),

    ...replacements,
  }))
    compiled = compiled.replaceAll(
      `from "${path}"`,

      `from ${JSON.stringify(replacement)}`,
    )

  return import(moduleUrl(compiled))
}

const { default: Board } = await compile(
  "../src/components/attendance/AttendanceBoard.tsx",

  {
    "../../lib/attendance": data,

    "../../lib/attendanceModel": new URL(
      "../src/lib/attendanceModel.ts",

      import.meta.url,
    ).href,

    "./WorkerPortrait": portrait,

    "./ScanNoticePopup": moduleUrl("export default function ScanNoticePopup(){return null}"),
  },
)

const all = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(all)
      : [node, ...all(node.props?.children)]

const text = (node) =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(text).join("")
      : node?.props
        ? text(node.props.children)
        : ""

let tree,
  refreshes = 0,
  displayOnly = false

const render = () => {
  for (let i = 0; i < 2; i++) {
    cursor = 0

    effectCursor = 0

    tree = Board({
      projectId: "project",
      projectName: "Test project",
      displayOnly,
    })

    const pending = effects

    effects = []

    pending.forEach((fn) => fn())
  }

  return tree
}

const find = (predicate) => {
  const found = all(tree).find(predicate)

  assert.ok(found, "Attendance control not found")

  return found
}

const button = (label) =>
  find((node) => node.type === "button" && text(node) === label)

const row = (id, name, direction = "in") => ({
  id,

  worker_id: id,

  project_id: "project",

  direction,

  occurred_at: "2026-01-02T00:00:00Z",

  received_at: "2026-01-02T00:00:02Z",

  device_id: "gate-1",

  worker: {
    id,

    full_name: name,

    worker_code: id,

    trade: "Mason",

    photo_path: `project/${id}/photo.jpg`,
  },
})

globalThis.__attendanceData = {
  events: [],

  summary: emptyAttendanceSummary,

  error: "",

  loading: false,

  updated: null,

  connection: "Live database updates",

  reload: async () => refreshes++,
}

render()

assert.match(text(tree), /No attendance recorded yet/)

assert.match(text(tree), /Waiting for a scan/)

globalThis.__attendanceData.loading = true

render()

assert.match(text(tree), /Loading attendance/)

globalThis.__attendanceData.loading = false

const first = row("worker-1", "First Worker"),
  second = row("worker-2", "Second Worker", "out")

globalThis.__attendanceData = {
  ...globalThis.__attendanceData,

  events: [second, first],

  summary: { scans: 2, workers: 2, clocked_in: 1, clocked_out: 1 },
}

render()

const panel = () => find((node) => node.type === "aside")

assert.match(text(panel()), /Second Worker/)

assert.match(text(panel()), /Time out recorded/)

find(
  (node) => node.type === "button" && text(node).startsWith("First Worker"),
).props.onClick()

render()

assert.match(text(panel()), /First Worker/)

assert.match(text(panel()), /Selected attendance record/)

const third = row("worker-3", "New Scan Worker")

globalThis.__attendanceData.events = [third, second, first]

render()

assert.match(text(panel()), /New Scan Worker/)

assert.match(text(panel()), /Latest recorded scan/)

find(
  (node) =>
    node.type === "input" &&
    node.props.placeholder === "Worker name, ID or device",
).props.onChange({ target: { value: "First" } })

render()

assert.equal(
  all(tree).filter((node) => node.type === "tbody")[0].props.children.length,

  1,
)

assert.match(
  text(panel()),

  /New Scan Worker/,

  "Search does not hide the incoming scan profile",
)

find((node) => node.type === "select").props.onChange({
  target: { value: "out" },
})

render()

assert.match(text(tree), /No matching scans/)

find(
  (node) => node.type === "input" && node.props.type === "date",
).props.onChange({ target: { value: "2026-01-01" } })

render()

assert.equal(
  find((node) => node.type === "input" && node.props.type === "date").props
    .value,

  "2026-01-01",
)

assert.equal(
  find((node) => node.type === "input" && node.props.type === "date").props.max,

  attendanceDay(),
)

await button("Refresh").props.onClick()

assert.equal(refreshes, 1)

globalThis.__attendanceData = {
  ...globalThis.__attendanceData,

  events: [],

  error: "Database unavailable",

  summary: emptyAttendanceSummary,
}

render()

assert.ok(all(tree).some((node) => node.props?.role === "alert"))

assert.doesNotMatch(text(panel()), /New Scan Worker/)

await button("Retry").props.onClick()

assert.equal(refreshes, 2)

// Display-only mode ignores leftover history/search state and always follows the latest scan.

displayOnly = true

globalThis.__attendanceData = {
  ...globalThis.__attendanceData,
  events: [third, second, first],
  error: "",
}

render()

assert.equal(
  all(tree).filter((node) => ["input", "select", "button"].includes(node.type))
    .length,
  0,
)

assert.equal(
  all(tree).find((node) => node.type === "tbody").props.children.length,
  3,
)

assert.deepEqual(globalThis.__attendanceLastArgs, ["project", attendanceDay()])

assert.match(text(panel()), /New Scan Worker/)

assert.match(text(tree), /Updates appear automatically/)

assert.doesNotMatch(text(tree), /Search recent scans|All scans|Refresh/)

globalThis.__attendanceData.events = [
  row("worker-4", "Newest Worker", "out"),
  third,
  second,
  first,
]

render()
assert.match(text(panel()), /Newest Worker/)
assert.match(text(panel()), /Time out recorded/)

globalThis.__attendanceData.error = "Connection lost"

globalThis.__attendanceData.events = []

render()
assert.equal(all(tree).filter((node) => node.type === "button").length, 0)
assert.match(text(tree), /Updates retry automatically/)

assert.equal(refreshes, 2, "The display has no manual reload actions")

console.log(
  "Display-only attendance hides search/date/status filters, refresh/retry and row actions; uses today and follows new scans automatically",
)

// The standalone page is pinned to the Foreman's selected project, not an arbitrary first project.

globalThis.__attendanceProject = {
  selected: "selected-project",
  project: { id: "selected-project", code: "SITE", name: "Selected site" },
  loading: false,
}

const projectModule = moduleUrl(
  "export const getSelectedProjectId=()=>globalThis.__attendanceProject.selected;export const useProject=id=>{globalThis.__attendanceProject.requested=id;return {project:globalThis.__attendanceProject.project,loading:globalThis.__attendanceProject.loading}};",
)

const boardModule = moduleUrl("export default function TestBoard(){}")

const headerModule = moduleUrl("export default function TestHeader(){}")

const { default: Standalone } = await compile(
  "../src/pages/Attendance/BiometricAttendancePage.tsx",
  {
    "../../lib/projects": projectModule,
    "../../components/attendance/AttendanceBoard": boardModule,
    "../../components/Header": headerModule,
  },
)

const { default: TestBoard } = await import(boardModule)

let fullscreenListener,
  entered = 0,
  exited = 0

const originalDocument = globalThis.document

globalThis.document = {
  fullscreenElement: null,
  documentElement: {
    requestFullscreen: async () => {
      entered++
      globalThis.document.fullscreenElement = {}
      fullscreenListener?.()
    },
  },
  exitFullscreen: async () => {
    exited++
    globalThis.document.fullscreenElement = null
    fullscreenListener?.()
  },
  addEventListener: (type, fn) => {
    if (type === "fullscreenchange") fullscreenListener = fn
  },
  removeEventListener: () => {},
}

state = []
effectState = []
effects = []

const renderStandalone = () => {
  for (let i = 0; i < 2; i++) {
    cursor = 0
    effectCursor = 0
    tree = Standalone({
      navigate: () => {
        throw new Error("Display should not navigate")
      },
    })
    const pending = effects
    effects = []
    pending.forEach((fn) => fn())
  }
}

renderStandalone()

assert.equal(globalThis.__attendanceProject.requested, "selected-project")
assert.match(text(find(node => node.props?.["aria-label"] === "Selected attendance project")), /Selected projectSelected siteSITE/)

assert.equal(
  find((node) => node.type === TestBoard).props.projectId,
  "selected-project",
)

assert.equal(find((node) => node.type === TestBoard).props.displayOnly, true)

assert.equal(
  all(tree).filter((node) => ["input", "select"].includes(node.type)).length,
  0,
)

assert.equal(all(tree).filter((node) => node.type === "button").length, 1)

let icon = find(
  (node) =>
    node.type === "button" && node.props["aria-label"] === "Enter fullscreen",
)

assert.equal(text(icon), "")
assert.ok(all(icon).some((node) => node.type === "svg"))
assert.equal(icon.props.title, "Enter fullscreen")

icon.props.onClick()
await new Promise((resolve) => setImmediate(resolve))
renderStandalone()

assert.equal(entered, 1)
assert.equal(
  find((node) => node.type === "button").props["aria-label"],
  "Exit fullscreen",
)

find((node) => node.type === "button").props.onClick()
await new Promise((resolve) => setImmediate(resolve))
renderStandalone()

assert.equal(exited, 1)
assert.equal(
  find((node) => node.type === "button").props["aria-label"],
  "Enter fullscreen",
)

globalThis.document.documentElement.requestFullscreen = async () => {
  throw new Error("Unsupported")
}

find((node) => node.type === "button").props.onClick()
await new Promise((resolve) => setImmediate(resolve))
renderStandalone()

assert.match(
  text(find((node) => node.props?.role === "status")),
  /Fullscreen is unavailable/,
)

globalThis.__attendanceProject.selected = null
renderStandalone()

assert.ok(!all(tree).some((node) => node.type === TestBoard))
assert.match(text(tree), /No selected attendance project/)
assert.doesNotMatch(text(tree), /Selected site/)

globalThis.__attendanceProject.selected = "different-project"
renderStandalone()

assert.ok(
  !all(tree).some((node) => node.type === TestBoard),
  "Stale project results must never display another project",
)
assert.doesNotMatch(text(tree), /Selected site/)

if (originalDocument === undefined) delete globalThis.document
else globalThis.document = originalDocument

delete globalThis.__attendanceProject
delete globalThis.__attendanceLastArgs

console.log(
  "Standalone selected-project lock, no project picker/fallback, icon-only fullscreen enter/exit and failure checks passed",
)

const brand = moduleUrl(
  "export default function Brand(){return 'Landing page brand'}",
)

const { default: Header } = await compile("../src/components/Header.tsx", {
  "./Brand": brand,
  "../lib/publicNavigation": moduleUrl("export function handlePublicNavigation(){throw new Error('Rendering the attendance header must not navigate')}"),
})

tree = Header({ navigate: () => {}, brandingOnly: true })

assert.equal(
  all(tree).filter((node) => ["nav", "a", "button"].includes(node.type)).length,

  0,

  "Kiosk header has no navigation or login/register buttons",
)

tree = Header({ navigate: () => {} })

assert.equal(
  all(tree).filter((node) => node.type === "nav").length,

  1,

  "Landing page navigation remains unchanged",
)

console.log(
  "Attendance empty/loading/error states, scan-to-profile updates, manual selection/new-scan reset, filters, date, refresh/retry and branding-only header checks passed",
)

delete globalThis.__attendanceHooks

delete globalThis.__attendanceData

const { receiveAttendance, scanPayloadProblem } = await import(
  "../supabase/functions/biometric-attendance/handler.ts"
)

const scan = {
  device_id: "00000000-0000-4000-8000-000000000001",
  biometric_uid: "1",
  direction: "in",
  occurred_at: "2026-01-02T01:00:00Z",
  event_id: "stable-source-id",
}

const token = "a".repeat(64)

const request = (body = scan, headers = {}) =>
  new Request("https://test.invalid/attendance", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-token": token,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })

let receiverCalls = 0,
  receivedArgs

let receivedFn
const successfulRpc = async (fn, args) => {
  receiverCalls++
  receivedFn = fn
  receivedArgs = args
  return { data: { event_id: "database-event-id", status: "recorded", direction: "in", occurred_at: scan.occurred_at, schedule_flag: "late", minutes_off: 12 }, error: null }
}

assert.equal(scanPayloadProblem(scan), "")

assert.ok(scanPayloadProblem({ ...scan, project_id: "foreign-project" }))

assert.ok(scanPayloadProblem({ ...scan, direction: "toggle" }))
assert.equal(scanPayloadProblem({ ...scan, direction: "auto" }), "")
const { direction: _ignored, ...withoutDirection } = scan
assert.equal(scanPayloadProblem(withoutDirection), "", "Direction is optional: the database decides IN/OUT")

assert.ok(scanPayloadProblem({ ...scan, occurred_at: "2026-01-02 09:00:00" }))

assert.ok(scanPayloadProblem({ ...scan, biometric_uid: "" }))

assert.equal(
  (await receiveAttendance(new Request("https://test.invalid"), successfulRpc))
    .status,
  405,
)

assert.equal(
  (
    await receiveAttendance(
      request(scan, { "x-device-token": "wrong" }),
      successfulRpc,
    )
  ).status,
  401,
)

assert.equal(
  (
    await receiveAttendance(
      request(scan, { "content-type": "text/plain" }),
      successfulRpc,
    )
  ).status,
  415,
)

assert.equal((await receiveAttendance(request("{"), successfulRpc)).status, 400)

assert.equal(
  (await receiveAttendance(request("a".repeat(4097)), successfulRpc)).status,
  413,
)

assert.equal(
  (
    await receiveAttendance(
      request({ ...scan, project_id: "spoof" }),
      successfulRpc,
    )
  ).status,
  400,
)

assert.equal(
  receiverCalls,
  0,
  "Rejected requests never reach database ingestion",
)

const accepted = await receiveAttendance(request(), successfulRpc)

assert.equal(accepted.status, 200)
const acceptedText = await accepted.clone().text()
assert.ok(acceptedText.startsWith('{"recorded":true,"event_id":"database-event-id"'), "Older firmware checks this prefix")
assert.deepEqual(await accepted.json(), {
  recorded: true,
  event_id: "database-event-id",
  status: "recorded",
  direction: "in",
  occurred_at: scan.occurred_at,
  schedule_flag: "late",
  minutes_off: 12,
})
assert.equal(Object.hasOwn(receivedArgs, "p_direction"), false, "A switch value never reaches the database decision")
assert.equal(receivedFn, "ingest_biometric_scan")
// Unknown finger: reported without a biometric ID, answered as handled but not attendance.
const savedArgs = receivedArgs
const { biometric_uid: _uid, ...unmatchedScan } = { ...scan, result: "no_match", event_id: "unmatched-1" }
assert.equal(scanPayloadProblem(unmatchedScan), "")
assert.ok(scanPayloadProblem({ ...unmatchedScan, biometric_uid: "3" }), "An unmatched scan never names a slot")
assert.ok(scanPayloadProblem({ ...scan, result: "maybe" }))
const unmatchedReply = await receiveAttendance(request(unmatchedScan), async (fn, args) => {
  receivedFn = fn; receivedArgs = args
  return { data: { event_id: null, status: "unregistered", reason: "no_match", occurred_at: scan.occurred_at }, error: null }
})
assert.equal(receivedFn, "report_unregistered_scan"); assert.equal(Object.hasOwn(receivedArgs, "p_biometric_uid"), false)
assert.deepEqual(await unmatchedReply.json(), { recorded: false, event_id: null, status: "unregistered", reason: "no_match", occurred_at: scan.occurred_at })
for (const reason of ["not_linked", "inactive", "other_device"])
  assert.equal((await (await receiveAttendance(request(), async () => ({ data: { event_id: null, status: "unregistered", reason, occurred_at: scan.occurred_at }, error: null }))).json()).reason, reason)
assert.equal((await receiveAttendance(request(), async () => ({ data: { event_id: null, status: "unregistered", reason: "mystery", occurred_at: scan.occurred_at }, error: null }))).status, 503)
receivedArgs = savedArgs
const repeat = await receiveAttendance(request({ ...scan, direction: "auto", event_id: "second" }), async () => ({ data: { event_id: "database-event-id", status: "repeat", direction: "in", occurred_at: scan.occurred_at, schedule_flag: null, minutes_off: null }, error: null }))
assert.equal((await repeat.json()).status, "repeat")
for (const data of ["database-event-id", null, { event_id: "x", status: "maybe", direction: "in" }, { event_id: "x", status: "recorded", direction: "sideways" }])
  assert.equal((await receiveAttendance(request(), async () => ({ data, error: null }))).status, 503, "An unexpected database answer is never reported as recorded")

assert.equal(receivedArgs.p_device, scan.device_id)
assert.equal(receivedArgs.p_event, scan.event_id)

assert.equal(Object.hasOwn(receivedArgs, "p_project"), false)

assert.notEqual(receivedArgs.p_token_hash, token)

assert.match(receivedArgs.p_token_hash, /^[a-f0-9]{64}$/)

for (const [code, status] of [
  ["28000", 401],
  ["P0429", 429],
  ["P0001", 422],
  ["XX000", 503],
]) {
  const result = await receiveAttendance(request(), async () => ({
    data: null,
    error: { code, message: "SECRET database internals" },
  }))

  assert.equal(result.status, status)
  assert.doesNotMatch(await result.text(), /SECRET/)
}

assert.equal(
  (
    await receiveAttendance(request(), async () => {
      throw new Error("internal")
    })
  ).status,
  503,
)

console.log(
  "ESP32 receiver method/token/size/JSON/scope validation, hashed credential forwarding, server-decided IN/OUT (repeat / out-of-order / unregistered answers, unknown-finger reports), success and safe error/rate-limit responses passed",
)
