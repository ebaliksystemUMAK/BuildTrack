import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import {
  emptyWorkerRegistration,
  workerFullName,
  workerRegistrationProblem,
} from "../src/lib/workerRegistrationModel.ts"
import { receiveEnrollment } from "../supabase/functions/biometric-enrollment/handler.ts"
import { deviceStatus, enrollmentView } from "../src/lib/enrollmentModel.ts"

const details = {
  ...emptyWorkerRegistration,
  first_name: " Juan ",
  last_name: " Cruz ",
  middle_initial: "a.",
  contact_number: "09123456789",
  worker_code: "W-001",
  email: "juan@example.com",
}
assert.equal(workerFullName(details), "Juan A. Cruz")
assert.equal(workerFullName({ ...details, middle_initial: "" }), "Juan Cruz")
assert.equal(workerRegistrationProblem(details), "")
for (const patch of [
  { first_name: "" },
  { last_name: "" },
  { middle_initial: "AB" },
  { contact_number: "bad" },
  { email: "bad" },
  { worker_code: "" },
])
  assert.ok(workerRegistrationProblem({ ...details, ...patch }))

const device = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002"
const token = "a".repeat(64)
const request = (body, headers = {}) =>
  new Request("https://test.invalid/enrollment", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-token": token,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
let calls = []
const rpc = async (args) => {
  calls.push(args)
  return { data: { job: { id, slot: 1 } }, error: null }
}
assert.equal(
  (await receiveEnrollment(new Request("https://test.invalid"), rpc)).status,
  405,
)
assert.equal(
  (
    await receiveEnrollment(
      request({ device_id: device, action: "poll", capacity: 162 }, {
        "x-device-token": "bad",
      }),
      rpc,
    )
  ).status,
  401,
)
assert.equal(
  (await receiveEnrollment(request({}, { "content-type": "text/plain" }), rpc))
    .status,
  415,
)
for (const body of [
  null,
  [],
  "{",
  {},
  { device_id: device, action: "poll", capacity: 0 },
  { device_id: device, action: "poll", capacity: 1.5 },
  { device_id: device, action: "poll", capacity: 162, project_id: "forged" },
  { device_id: device, action: "completed", request_id: "bad" },
  { device_id: device, action: "completed", request_id: id, slot: 99 },
  { device_id: device, action: "progress", request_id: id },
  { device_id: device, action: "progress", request_id: id, stage: "done" },
  { device_id: device, action: "progress", stage: "lift" },
  { device_id: device, action: "progress", request_id: id, stage: "lift", error: "x" },
  { device_id: device, action: "poll", capacity: 162, stage: "lift" },
  { device_id: device, action: "completed", request_id: id, stage: "confirm" },
])
  assert.equal((await receiveEnrollment(request(body), rpc)).status, 400)
assert.equal(
  (await receiveEnrollment(request("x".repeat(2049)), rpc)).status,
  413,
)
assert.equal(calls.length, 0)
assert.equal(
  (
    await receiveEnrollment(
      request({ device_id: device, action: "poll", capacity: 162 }),
      rpc,
    )
  ).status,
  200,
)
assert.equal(calls[0].p_device, device)
assert.equal(calls[0].p_capacity, 162)
assert.match(calls[0].p_token_hash, /^[a-f0-9]{64}$/)
assert.notEqual(calls[0].p_token_hash, token)
assert.equal(Object.hasOwn(calls[0], "p_project"), false)
for (const action of ["completed", "failed"]) {
  await receiveEnrollment(
    request({
      device_id: device,
      action,
      request_id: id,
      error: action === "failed" ? "Finger did not match" : "",
    }),
    rpc,
  )
  assert.equal(calls.at(-1).p_action, action)
  assert.equal(calls.at(-1).p_request, id)
}
for (const stage of ["place_first", "lift", "place_second", "storing", "confirm"]) {
  await receiveEnrollment(request({ device_id: device, action: "progress", request_id: id, stage }), rpc)
  assert.equal(calls.at(-1).p_action, "progress"); assert.equal(calls.at(-1).p_stage, stage); assert.equal(calls.at(-1).p_request, id)
}
assert.equal(Object.hasOwn(calls[0], "p_stage"), false, "Other actions send no step, so they also work before 20261027110000")

// Registration steps as the Admin sees them (lib/enrollmentModel.ts).
const t0 = Date.parse("2026-10-27T10:00:00Z")
const job = (patch) => ({ id, status: "capturing", stage: "", error_message: "", expires_at: "2026-10-27T10:02:00Z", slot: 4, ...patch })
const states = (view) => view.steps.map((step) => step.state[0]).join("")
assert.equal(enrollmentView(null, false, t0).tone, "idle")
assert.equal(states(enrollmentView(null, false, t0)), "tttttttt")
assert.equal(states(enrollmentView(job({ status: "queued", slot: null }), false, t0)), "cttttttt")
assert.match(enrollmentView(job({ status: "queued", slot: null }), false, t0).instruction, /Waiting for the ESP32/)
assert.equal(states(enrollmentView(job({}), false, t0)), "dctttttt")
const second = enrollmentView(job({ stage: "place_second" }), false, t0)
assert.equal(states(second), "ddddcttt"); assert.match(second.instruction, /same finger on the scanner again/); assert.equal(second.tone, "active")
const confirmView = enrollmentView(job({ stage: "confirm" }), false, t0)
assert.equal(states(confirmView), "ddddddct"); assert.match(confirmView.instruction, /once more to confirm/)
const late = enrollmentView(job({ stage: "lift" }), false, Date.parse("2026-10-27T10:05:00Z"))
assert.equal(late.expired, true); assert.equal(late.headline, "Registration timed out"); assert.equal(states(late), "dddftttt", "A timed-out capture shows where it stopped")
const failed = enrollmentView(job({ status: "failed", stage: "confirm", error_message: "Confirmation scan did not match the saved finger." }), false, t0)
assert.equal(states(failed), "ddddddft", "Stopped at the confirmation scan"); assert.equal(failed.tone, "problem"); assert.match(failed.instruction, /did not match/)
assert.equal(states(enrollmentView(job({ status: "cancelled", stage: "", slot: null }), false, t0)), "fttttttt")
const success = enrollmentView(job({ status: "completed", stage: "confirm" }), true, t0)
assert.equal(states(success), "dddddddd"); assert.equal(success.headline, "Fingerprint registered and confirmed")
assert.equal(enrollmentView(job({ stage: "confirm" }), false, t0).steps.at(-1).state, "todo", "Never shown as registered before the database links the worker")
assert.deepEqual(deviceStatus(null, t0), { online: false, label: "Never connected" })
assert.equal(deviceStatus("2026-10-27T09:59:30Z", t0).online, true)
assert.equal(deviceStatus("2026-10-27T09:50:00Z", t0).label, "Offline (last seen 10 min ago)")

for (const [code, status] of [
  ["28000", 401],
  ["P0001", 422],
  ["XX000", 503],
]) {
  const result = await receiveEnrollment(
    request({ device_id: device, action: "poll", capacity: 162 }),
    async () => ({ data: null, error: { code, message: "SECRET" } }),
  )
  assert.equal(result.status, status)
  assert.doesNotMatch(await result.text(), /SECRET/)
}

const url = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let state = [],
  effects = [],
  queued = [],
  cursor = 0
let confirmAnswer = true,
  confirmCalls = []
globalThis.__enrollConfirm = async (options) => {
  confirmCalls.push(options)
  return confirmAnswer
}
globalThis.__enrollHooks = {
  useState(initial) {
    const n = cursor++
    if (!(n in state)) state[n] = initial
    return [
      state[n],
      (value) => {
        state[n] = typeof value === "function" ? value(state[n]) : value
      },
    ]
  },
  useEffect(fn, deps) {
    const n = cursor++,
      old = effects[n]
    if (!old || deps.some((value, i) => value !== old.deps[i]))
      queued.push(() => {
        old?.cleanup?.()
        effects[n] = { deps, cleanup: fn() }
      })
  },
}
const hooks = url(
  "export const useState=(...a)=>globalThis.__enrollHooks.useState(...a);export const useEffect=(...a)=>globalThis.__enrollHooks.useEffect(...a);",
)
async function compile(path, replacements) {
  let source = ts.transpileModule(
    readFileSync(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  for (const [name, replacement] of Object.entries({
    react: hooks,
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    ...replacements,
  }))
    source = source.replaceAll(
      `from "${name}"`,
      `from ${JSON.stringify(replacement)}`,
    )
  return (await import(url(source))).default
}
const noOp = url("export default function Stub(){return null}")
const Worker = await import(noOp)
const Page = await compile("../src/pages/Admin/BiometricsRegistration.tsx", {
  "../../components/AdminProjectSelect": url(
    "export const useAdminProject=()=>({projects:[],project:{id:'project'},projectId:'project',error:'',choose(){}});export default function Picker(){return null}",
  ),
  "../../components/attendance/WorkerManagement": noOp,
  "../../components/attendance/AttendanceSchedule": url(
    "export default function Schedule(){return 'SCHEDULE-PANEL'}",
  ),
  "../../components/attendance/DeviceManagement": url(
    "export default function Devices(){return null}",
  ),
  "../../components/attendance/BiometricAdminGuard": url(
    "export default function Guard({children}){return children}",
  ),
  "./AdminShell": url("export const PageIntro=()=>null"),
})
const all = (node) =>
  Array.isArray(node)
    ? node.flatMap(all)
    : node && typeof node === "object"
      ? [node, ...all(node.props?.children)]
      : []
const text = (node) =>
  Array.isArray(node)
    ? node.map(text).join("")
    : node?.props
      ? text(node.props.children)
      : typeof node === "string"
        ? node
        : ""
let tree
const find = (predicate) => {
  const found = all(tree).find(predicate)
  assert.ok(found, "Expected enrollment control")
  return found
}
const tab = (label) =>
  find((node) => node.props?.role === "tab" && text(node) === label)
function renderPage() {
  cursor = 0
  tree = Page({})
  while (typeof tree.type === "function") tree = tree.type(tree.props)
}
renderPage()
assert.equal(all(tree).filter((node) => node.props?.role === "tab").length, 4)
assert.equal(
  find((node) => node.type === Worker.default).props.view,
  "register",
)
tab("Worker profiles").props.onClick()
renderPage()
assert.equal(
  find((node) => node.type === Worker.default).props.view,
  "profiles",
)
find((node) => node.type === Worker.default).props.onRegister()
renderPage()
assert.equal(tab("Register worker").props["aria-selected"], true)
tab("Attendance schedule").props.onClick()
renderPage()
assert.equal(find((node) => node.props?.role === "tabpanel").props.children.props.projectId, "project", "The schedule tab belongs to the selected project")
tab("Devices").props.onClick()
renderPage()
assert.ok(!all(tree).some((node) => node.type === Worker.default))
assert.doesNotMatch(text(tree), /Choose an unused|AS608 sensor enrollment ID/)

state = []
effects = []
queued = []
const originalWindow = globalThis.window
let tick,
  rpcCalls = [],
  data = {
    devices: [],
    job: null,
    worker: { biometric_uid: null },
    error: null,
  },
  rpcError = null
globalThis.window = {
  setInterval: (fn) => {
    tick = fn
    return 1
  },
  clearInterval() {},
}
globalThis.__enrollDB = {
  from(table) {
    const chain = {
      select() {
        return chain
      },
      eq() {
        return chain
      },
      order() {
        return chain
      },
      limit() {
        return chain
      },
      single: async () => result(),
      maybeSingle: async () => result(),
      then(resolve) {
        return Promise.resolve(result()).then(resolve)
      },
    }
    const result = () => ({
      data:
        table === "attendance_devices"
          ? data.devices
          : table === "attendance_workers"
            ? data.worker
            : data.job,
      error: data.error,
    })
    return chain
  },
  rpc: async (name, args) => {
    rpcCalls.push({ name, args })
    return { data: id, error: rpcError }
  },
}
const Fingerprint = await compile(
  "../src/components/attendance/WorkerFingerprint.tsx",
  {
    "../../lib/supabase": url("export const supabase=globalThis.__enrollDB"),
    "../../lib/confirm": url("export const useConfirm=()=>globalThis.__enrollConfirm"),
    "../../lib/enrollmentModel": new URL("../src/lib/enrollmentModel.ts", import.meta.url).href,
  },
)
const worker = { id: "worker", full_name: "Juan A. Cruz", active: true, biometric_uid: null }
async function renderFingerprint() {
  for (let pass = 0; pass < 2; pass++) {
    cursor = 0
    tree = Fingerprint({ worker, projectId: "project" })
    const tasks = queued
    queued = []
    tasks.forEach((fn) => fn())
    await new Promise((resolve) => setImmediate(resolve))
  }
}
const button = (label) =>
  find((node) => node.type === "button" && text(node) === label)
await renderFingerprint()
assert.equal(button("Register fingerprint").props.disabled, true)
assert.match(text(tree), /No active device registered/)
data.devices = [{ id: device, label: "Main gate", last_seen_at: new Date().toISOString() }]
tick()
await renderFingerprint()
assert.match(text(tree), /Scanner online/)
assert.equal(button("Register fingerprint").props.disabled, false)
confirmAnswer = false
await button("Register fingerprint").props.onClick()
await renderFingerprint()
assert.equal(rpcCalls.length, 0, "Nothing starts until the Admin confirms the worker is at the scanner")
assert.equal(confirmCalls[0].title, "Start fingerprint registration?")
assert.match(text(confirmCalls[0].message), /Juan A\. Cruz.*Main gate.*standing at the scanner/)
confirmAnswer = true
await button("Register fingerprint").props.onClick()
await renderFingerprint()
assert.equal(rpcCalls[0].name, "request_worker_enrollment")
assert.deepEqual(rpcCalls[0].args, { p_worker: "worker", p_device: device })
data.job = {
  id,
  status: "queued",
  error_message: "",
  expires_at: "2099-01-01T00:00:00Z",
}
tick()
await renderFingerprint()
assert.match(text(tree), /Waiting for the ESP32/)
assert.ok(
  !all(tree).some(
    (node) => node.type === "button" && text(node) === "Register fingerprint",
  ),
)
data.job.status = "capturing"
data.job.stage = "place_second"
tick()
await renderFingerprint()
assert.match(text(tree), /Place the same finger on the scanner again/)
const current = find((node) => node.type === "li" && node.props["aria-current"] === "step")
assert.match(text(current), /Second scan/)
assert.ok(!all(tree).some((node) => node.type === "button" && text(node) === "Register fingerprint"), "No second request while capturing")
await button("Cancel enrollment").props.onClick()
await renderFingerprint()
assert.equal(rpcCalls.at(-1).name, "cancel_worker_enrollment")
data.job.status = "failed"
data.job.error_message = "Finger mismatch"
tick()
await renderFingerprint()
assert.match(text(tree), /Finger mismatch/)
rpcError = { message: "Another worker is using this device" }
await button("Try again").props.onClick()
await renderFingerprint()
assert.match(text(tree), /Another worker is using this device/)
rpcError = null
data.worker.biometric_uid = "1"
data.job.status = "completed"
tick()
await renderFingerprint()
assert.match(text(tree), /Fingerprint registered and confirmed/)
assert.equal(
  all(tree).filter((node) => node.type === "select" || node.type === "button")
    .length,
  0,
)
effects.forEach((value) => value?.cleanup?.())

// Admin > Attendance schedule: loads the project's row, validates, saves only through set_attendance_schedule.
state = []
effects = []
queued = []
let scheduleRow = null,
  scheduleError = null,
  toasts = []
rpcCalls = []
rpcError = null
globalThis.__scheduleDB = {
  from(table) {
    assert.equal(table, "attendance_schedules")
    const chain = { select: () => chain, eq: (column, value) => (assert.deepEqual([column, value], ["project_id", "project"]), chain), maybeSingle: async () => ({ data: scheduleRow, error: scheduleError }) }
    return chain
  },
  rpc: async (name, args) => {
    rpcCalls.push({ name, args })
    return { data: null, error: rpcError }
  },
}
globalThis.__enrollToast = { success: (title, detail) => toasts.push(["success", title, detail]), error: (title, detail) => toasts.push(["error", title, detail]), info() {} }
const Schedule = await compile("../src/components/attendance/AttendanceSchedule.tsx", {
  "../../lib/supabase": url("export const supabase=globalThis.__scheduleDB"),
  "../../lib/toast": url("export const useToast=()=>globalThis.__enrollToast;export const errorText=(e,f='Something went wrong.')=>e instanceof Error&&e.message?e.message:f"),
  "../ui/Skeleton": url("export const SkeletonText=()=>'LOADING'"),
  "../../lib/attendanceScheduleModel": new URL("../src/lib/attendanceScheduleModel.ts", import.meta.url).href,
})
async function renderSchedule() {
  for (let pass = 0; pass < 3; pass++) {
    cursor = 0
    tree = Schedule({ projectId: "project" })
    const tasks = queued
    queued = []
    tasks.forEach((fn) => fn())
    await new Promise((resolve) => setImmediate(resolve))
  }
}
const input = (labelText) => find((node) => node.type === "label" && text(node).startsWith(labelText)).props.children.find((child) => child?.type === "input")
await renderSchedule()
assert.match(text(tree), /No schedule set yet/)
assert.equal(input("Time in").props.value, "08:00", "Sensible defaults to start from")
input("Time out").props.onChange({ target: { value: "07:00" } })
await renderSchedule()
assert.match(text(tree), /later than time in/)
assert.equal(find((node) => node.type === "button" && node.props.type === "submit").props.disabled, true)
input("Time in").props.onChange({ target: { value: "06:30" } })
input("Grace period").props.onChange({ target: { value: "10" } })
await renderSchedule()
await find((node) => node.type === "form").props.onSubmit({ preventDefault() {} })
assert.deepEqual(rpcCalls.at(-1), { name: "set_attendance_schedule", args: { p_project: "project", p_time_in: "06:30", p_time_out: "07:00", p_grace: 10, p_repeat: 15, p_work_days: [1, 2, 3, 4, 5, 6] } })
assert.equal(toasts.at(-1)[0], "success")
scheduleRow = { project_id: "project", time_in: "06:30:00", time_out: "15:30:00", grace_minutes: 10, repeat_guard_minutes: 15, updated_at: "2026-10-27T01:00:00Z" }
state = []
effects = []
queued = []
await renderSchedule()
assert.match(text(tree), /Current: Mon–Sat · Time in 06:30 \(late after 06:40\) · Time out 15:30/)
// Working days: unticking every day blocks saving; the chosen days are sent.
const dayBox = (name) => find((node) => node.type === "label" && text(node) === name).props.children.find((child) => child?.type === "input")
for (const name of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) { dayBox(name).props.onChange(); await renderSchedule() }
assert.match(text(tree), /Choose at least one working day/)
dayBox("Sun").props.onChange(); await renderSchedule()
assert.equal(find((node) => node.type === "button" && node.props.type === "submit").props.disabled, false)
dayBox("Sun").props.onChange(); for (const name of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) { dayBox(name).props.onChange(); await renderSchedule() }
assert.equal(find((node) => node.type === "button" && node.props.type === "submit").props.disabled, true, "Nothing to save until something changes")
rpcError = { message: "Admin biometric permission and MFA required" }
input("Ignore repeat scans").props.onChange({ target: { value: "5" } })
await renderSchedule()
await find((node) => node.type === "form").props.onSubmit({ preventDefault() {} })
assert.deepEqual(toasts.at(-1), ["error", "Schedule not saved", "Admin biometric permission and MFA required"])
scheduleError = { message: "relation does not exist" }
state = []
effects = []
queued = []
await renderSchedule()
assert.match(text(find((node) => node.props?.role === "alert")), /could not be loaded/)
assert.ok(!all(tree).some((node) => node.type === "form"), "No form when the schedule cannot be read")
effects.forEach((value) => value?.cleanup?.())
delete globalThis.__enrollToast
delete globalThis.__scheduleDB
globalThis.window = originalWindow
delete globalThis.__enrollHooks
delete globalThis.__enrollDB
delete globalThis.__enrollConfirm
console.log(
  "Worker names/contact validation, separate registration/profile/device tabs, fingerprint UI confirm-before-start/live steps/cancel/failure/success, attendance schedule form (defaults, validation, save, unchanged, refused, load failure), step model and authenticated device handler (incl. progress) tests passed",
)
