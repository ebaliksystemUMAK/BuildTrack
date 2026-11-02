import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { MAX_ATTEMPTS, PAUSE_RETRY_SECONDS, SITE_PAUSE_CODE, isNetworkProblem, isSitePause, verdictFor } from "../src/lib/offlineModel.ts"
import { createPollingStore } from "../src/lib/pollingStore.ts"
import {
  AUDIENCE_ROLES, FEATURE_KEYS, FORCED_LOGOUT_NOTICE, FORCE_LOGOUT_LIMITS, MAINTENANCE_KEEPS, MAINTENANCE_PAUSES, confirmPhrase, featureForPage, featureLabels, forceLogoutProblem, lockFor,
  maintenanceProblem, manilaLocalToIso, parseForcePreview, parseSiteStatus, shouldForceSignOut, stripsFor,
} from "../src/lib/siteStatusModel.ts"

// Everything here runs against fakes: no database, no network, nobody is signed out and nothing is paused anywhere.
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
const fileUrl = (path) => new URL(path, import.meta.url).href
const settle = () => new Promise((resolve) => setImmediate(resolve))
const transpile = (path, replacements) => {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return source
}
const text = (node) => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node)
const all = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => all(child, predicate)) : [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate), ...all(node.props?.footer, predicate), ...all(node.props?.action, predicate)]

// ---------------------------------------------------------------- the offline queue learns "paused" (it is not a failure)
{
  assert.equal(SITE_PAUSE_CODE, "BT503"); assert.equal(PAUSE_RETRY_SECONDS, 300)
  assert.equal(isSitePause({ code: "BT503", message: "Maintenance: x" }), true)
  for (const other of [{ code: "42501" }, { code: "PGRST301" }, { code: "BT001" }, { message: "Maintenance: x" }, null, undefined, "BT503", 503, {}]) assert.equal(isSitePause(other), false, JSON.stringify(other))
  assert.equal(isNetworkProblem({ code: "BT503", message: "network error while saving" }), false, "a pause is not a lost connection either")
  const pause = { code: "BT503", message: "Maintenance: Upgrading the database." }
  for (const attempts of [1, 4, MAX_ATTEMPTS, MAX_ATTEMPTS + 5]) assert.equal(verdictFor(pause, attempts), "paused", "a pause never runs out of attempts: " + attempts)
  assert.equal(verdictFor(null, 3), "sent"); assert.equal(verdictFor({ message: "Failed to fetch" }, 2), "retry"); assert.equal(verdictFor({ message: "Failed to fetch" }, MAX_ATTEMPTS), "failed")
  assert.equal(verdictFor({ message: "permission denied", code: "42501" }, 1), "failed", "every other refusal still fails the item, as before")
  assert.equal(verdictFor({ message: "already submitted", code: "BT001" }, 1), "failed")
}

{
  // The real queue code, with a tiny in-memory IndexedDB and a fake server.
  const store = new Map()
  const later = (fn) => setTimeout(fn, 0)
  globalThis.indexedDB = { open() {
    const request = {}
    later(() => {
      request.result = { createObjectStore() {}, close() {}, transaction() {
        const tx = {}
        const finish = () => later(() => tx.oncomplete?.())
        tx.objectStore = () => ({
          put(item) { const r = { result: item.id }; store.set(item.id, structuredClone(item)); finish(); return r },
          getAll() { const r = { result: [...store.values()].map((item) => structuredClone(item)) }; finish(); return r },
          delete(id) { const r = { result: undefined }; store.delete(id); finish(); return r },
        })
        return tx
      } }
      request.onupgradeneeded?.(); request.onsuccess?.()
    })
    return request
  } }
  const savedWindow = globalThis.window, savedEvent = globalThis.Event
  globalThis.window = { dispatchEvent() {}, addEventListener() {}, removeEventListener() {}, setInterval() { return 1 }, clearInterval() {} }; globalThis.Event = class {}
  let answer = { error: null }; const sent = []
  globalThis.__qSupabase = { rpc: async (name, args) => { sent.push([name, args.p_note]); return typeof answer === "function" ? answer() : answer } }
  const source = transpile("../src/lib/offlineQueue.ts", { react: url("export const useCallback=(f)=>f,useEffect=()=>{},useState=(v)=>[v,()=>{}];"), "./photoStamp": url("export const stampFields=()=>({});"), "./offlineModel": fileUrl("../src/lib/offlineModel.ts"), "./supabase": url("export const supabase=globalThis.__qSupabase;") })
  const queue = await import(url(source))
  const progress = (note) => ({ userId: "u1", kind: "pin_progress", label: note, payload: { pinId: "p1", status: "in_progress", note } })
  const clearWait = () => { for (const [id, item] of store) store.set(id, { ...item, nextAt: undefined }) }
  const items = () => [...store.values()].sort((a, b) => a.createdAt - b.createdAt)

  await queue.enqueue(progress("first")); await new Promise((r) => setTimeout(r, 2)); await queue.enqueue(progress("second"))
  await queue.enqueue({ ...progress("someone else's"), userId: "u2" })
  answer = { error: { message: "Maintenance: Upgrading the database. You can still look at everything; saving changes is paused.", code: "BT503" } }
  let result = await queue.flushQueue("u1")
  assert.deepEqual(result, { sent: 0, failed: 0, left: 2 }); assert.deepEqual(sent.map((s) => s[1]), ["first"], "the first item waits and the second is not tried: order is kept")
  let mine = items().filter((item) => item.userId === "u1")
  assert.deepEqual(mine.map((item) => [item.label, item.status, item.attempts]), [["first", "pending", 0], ["second", "pending", 0]], "kept exactly as saved, no attempt used")
  assert.match(mine[0].error, /^Maintenance:/); assert.ok(mine[0].nextAt > Date.now() + (PAUSE_RETRY_SECONDS - 5) * 1000 && mine[0].nextAt < Date.now() + (PAUSE_RETRY_SECONDS + 5) * 1000, "tried again in about five minutes")
  result = await queue.flushQueue("u1"); assert.equal(sent.length, 1, "nothing is sent again before the wait is over")
  for (let i = 0; i < MAX_ATTEMPTS + 4; i++) { clearWait(); await queue.flushQueue("u1") }
  mine = items().filter((item) => item.userId === "u1")
  assert.deepEqual(mine.map((item) => [item.status, item.attempts]), [["pending", 0], ["pending", 0]], "hours of pauses never turn saved work into a failure")
  assert.equal(items().filter((item) => item.userId === "u2").length, 1, "another person's items are never touched")

  // the pause ends: both items are sent, in order
  sent.length = 0; answer = { error: null }; clearWait()
  result = await queue.flushQueue("u1")
  assert.deepEqual(result, { sent: 2, failed: 0, left: 0 }); assert.deepEqual(sent.map((s) => s[1]), ["first", "second"]); assert.equal(items().filter((item) => item.userId === "u1").length, 0)

  // every other kind of refusal still fails the item (unchanged behaviour), and a dropped connection still retries with a growing wait
  await queue.enqueue(progress("refused")); answer = { error: { message: "permission denied", code: "42501" } }
  result = await queue.flushQueue("u1"); assert.deepEqual(result, { sent: 0, failed: 1, left: 0 }); assert.equal(items().find((item) => item.label === "refused").status, "failed")
  await queue.enqueue(progress("offline")); answer = { error: { message: "Failed to fetch" } }
  await queue.flushQueue("u1"); const offline = items().find((item) => item.label === "offline"); assert.deepEqual([offline.status, offline.attempts], ["pending", 1])
  globalThis.window = savedWindow; globalThis.Event = savedEvent; delete globalThis.indexedDB; delete globalThis.__qSupabase; if (savedWindow === undefined) delete globalThis.window; if (savedEvent === undefined) delete globalThis.Event
}

// ---------------------------------------------------------------- the polling store
{
  const timers = new Map(); let next = 0
  let calls = 0, answer = { n: 1 }, visible = true
  const store = createPollingStore(async () => { calls++; return typeof answer === "function" ? answer() : answer }, { setTimer: (run) => { timers.set(++next, run); return next }, clearTimer: (id) => timers.delete(id), isVisible: () => visible })
  let heard = 0
  const off1 = store.subscribe(() => heard++), off2 = store.subscribe(() => heard++)
  await settle(); assert.equal(calls, 1, "one request for two components"); assert.deepEqual(store.get(), { n: 1 }); assert.equal(heard, 2); assert.equal(timers.size, 1)
  answer = null; timers.forEach((run) => run()); await settle(); assert.deepEqual(store.get(), { n: 1 }, "an unreadable answer keeps what was showing")
  answer = async () => { throw new Error("offline") }; timers.forEach((run) => run()); await settle(); assert.deepEqual(store.get(), { n: 1 }, "so does a failure")
  visible = false; const before = calls; timers.forEach((run) => run()); await settle(); assert.equal(calls, before, "no request while the page is hidden")
  off1(); assert.equal(timers.size, 1); off2(); assert.equal(timers.size, 0, "the timer stops with the last subscriber")
}

// ---------------------------------------------------------------- reading the status and telling people
{
  const on = { maintenance: { on: true, message: "Upgrading the database.", returns_at: "2026-11-02T09:00:00Z" }, restricted: true, role: "foreman", locks: [{ feature: "quality", label: "Quality inspections and defect reports", message: "Paused for training." }] }
  const parsed = parseSiteStatus(on)
  assert.deepEqual(parsed, on)
  for (const bad of [null, undefined, "x", 5, {}, { maintenance: {} }, { maintenance: { on: "yes" } }]) assert.equal(parseSiteStatus(bad), null, JSON.stringify(bad))
  assert.deepEqual(parseSiteStatus({ maintenance: { on: false }, restricted: "x", role: 5, locks: [{ feature: "a" }, null, { feature: "b", label: "B", message: 5 }] }), { maintenance: { on: false, message: "", returns_at: null }, restricted: false, role: null, locks: [{ feature: "b", label: "B", message: "" }] })

  const now = new Date("2026-11-02T06:00:00Z")
  const restricted = stripsFor(parsed, now)
  assert.deepEqual(restricted.map((s) => [s.key, s.kind]), [["maintenance", "maintenance"], ["lock:quality", "lock"]])
  assert.match(restricted[0].text, /Upgrading the database\. You can still look at everything; saving changes is paused\. Anything you saved offline is kept and is sent afterwards\. Expected back around .* \(Manila time\)\./)
  assert.equal(restricted[1].title, "Quality inspections and defect reports is paused"); assert.equal(restricted[1].text, "Paused for training.")
  const late = stripsFor(parsed, new Date("2026-11-02T12:00:00Z"))[0].text; assert.match(late, /has passed; it is still on\./); assert.doesNotMatch(late, /Expected back/)
  const admin = stripsFor({ ...on, restricted: false, role: "admin", locks: [] }, now); assert.equal(admin.length, 1); assert.match(admin[0].text, /You are not restricted/); assert.equal(admin[0].title, "Maintenance is on")
  const visitor = stripsFor({ ...on, restricted: false, role: null, locks: [] }, now); assert.match(visitor[0].text, /Signing in works; saving changes is paused for now\./)
  assert.deepEqual(stripsFor({ ...on, maintenance: { on: false, message: "", returns_at: null }, locks: [] }, now), []); assert.deepEqual(stripsFor(null), [])
  assert.match(stripsFor({ ...on, maintenance: { on: true, message: "  ", returns_at: null } }, now)[0].text, /^BuildTrack is being updated\./)
  assert.match(stripsFor({ ...on, maintenance: { on: false, message: "", returns_at: null }, locks: [{ feature: "x", label: "X", message: " " }] })[0].text, /switched off for your role for now/)

  assert.equal(lockFor(parsed, "quality").message, "Paused for training."); assert.equal(lockFor(parsed, "daily_reports"), null); assert.equal(lockFor(parsed, null), null); assert.equal(lockFor(null, "quality"), null)
  assert.equal(featureForPage("foreman", "daily-report"), "daily_reports"); assert.equal(featureForPage("foreman", "quality-control"), "quality"); assert.equal(featureForPage("client", "ticket"), "client_reports")
  assert.equal(featureForPage("manager", "quality"), "quality"); assert.equal(featureForPage("engineer", "annotation"), "blueprint_editor"); assert.equal(featureForPage("engineer", "dashboard"), null); assert.equal(featureForPage("admin", "quality"), null); assert.equal(featureForPage("nobody", "x"), null)
  for (const feature of FEATURE_KEYS) assert.ok(featureLabels[feature]); assert.deepEqual([...AUDIENCE_ROLES], ["engineer", "foreman", "client", "project_manager", "user"])
  const sql = readFileSync(new URL("../supabase/migrations/20261101150000_site_controls.sql", import.meta.url), "utf8")
  for (const feature of FEATURE_KEYS) assert.ok(sql.includes(`'${feature}'`), "the database knows the feature " + feature)
  assert.ok(MAINTENANCE_PAUSES.length >= 1 && MAINTENANCE_KEEPS.some((line) => /Signing in/.test(line)) && MAINTENANCE_KEEPS.some((line) => /Biometric devices/.test(line)) && MAINTENANCE_KEEPS.some((line) => /privacy requests/.test(line)))
}

// ---------------------------------------------------------------- forms, the strong confirmation and the sign-out rule
{
  assert.equal(manilaLocalToIso("2026-11-02T14:30"), "2026-11-02T06:30:00.000Z", "typed in Manila time"); assert.equal(manilaLocalToIso("2026-11-02"), null); assert.equal(manilaLocalToIso("garbage"), null); assert.equal(manilaLocalToIso("2026-13-45T99:99"), null)
  const now = new Date("2026-11-02T00:00:00Z")
  assert.equal(maintenanceProblem({ message: "Upgrading the database.", returnsLocal: "" }, now), null)
  assert.match(maintenanceProblem({ message: "abc", returnsLocal: "" }, now), /at least 5 characters/); assert.match(maintenanceProblem({ message: "x".repeat(501), returnsLocal: "" }, now), /at most 500/)
  assert.match(maintenanceProblem({ message: "Upgrading the database.", returnsLocal: "2026-11-01T08:00" }, now), /in the future/); assert.match(maintenanceProblem({ message: "Upgrading the database.", returnsLocal: "2026-12-30T08:00" }, now), /at most 14 days/)
  assert.match(maintenanceProblem({ message: "Upgrading the database.", returnsLocal: "soon" }, now), /date and time/); assert.equal(maintenanceProblem({ message: "Upgrading the database.", returnsLocal: "2026-11-02T20:00" }, now), null)

  assert.equal(confirmPhrase(12), "LOG OUT 12")
  const raw = { total: 3, by_role: { foreman: 2, client: 1, bad: "x" }, signed_in_last_24h: 2, confirm_phrase: "LOG OUT 3", cooldown_seconds: 0 }
  const preview = parseForcePreview(raw); assert.deepEqual(preview, { total: 3, by_role: { foreman: 2, client: 1 }, signed_in_last_24h: 2, confirm_phrase: "LOG OUT 3", cooldown_seconds: 0 })
  for (const bad of [null, "x", {}, { ...raw, total: "3" }, { ...raw, confirm_phrase: 5 }, { ...raw, cooldown_seconds: null }]) assert.equal(parseForcePreview(bad), null)
  const ok = { preview, phrase: "LOG OUT 3", reason: "Lost phones during the audit" }
  assert.equal(forceLogoutProblem(ok), null)
  assert.match(forceLogoutProblem({ ...ok, preview: null }), /Preview who is affected first/); assert.match(forceLogoutProblem({ ...ok, preview: { ...preview, total: 0 } }), /No active account matches/)
  assert.match(forceLogoutProblem({ ...ok, preview: { ...preview, total: 1001 } }), /more than 1,000/); assert.match(forceLogoutProblem({ ...ok, preview: { ...preview, cooldown_seconds: 90 } }), /Wait 2 minutes/)
  assert.match(forceLogoutProblem({ ...ok, reason: "no" }), /reason of 5 to 300/); assert.match(forceLogoutProblem({ ...ok, reason: "x".repeat(301) }), /reason of 5 to 300/)
  for (const wrong of ["log out 3", "LOG OUT 3 ", " LOG OUT 3", "LOG  OUT 3", "LOG OUT 4", "", "yes"]) assert.match(forceLogoutProblem({ ...ok, phrase: wrong }), /Type LOG OUT 3 exactly/, JSON.stringify(wrong))

  assert.equal(shouldForceSignOut("2026-11-02T10:00:00Z", "2026-11-02T08:00:00Z"), true, "forced after this sign-in began")
  assert.equal(shouldForceSignOut("2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z"), false, "the person signed in again afterwards")
  assert.equal(shouldForceSignOut(null, "2026-11-02T08:00:00Z"), false); assert.equal(shouldForceSignOut(undefined, undefined), false); assert.equal(shouldForceSignOut("garbage", "2026-11-02T08:00:00Z"), false)
  assert.equal(shouldForceSignOut("2026-11-02T10:00:00Z", null), false, "without a known sign-in time nothing is forced, so nobody is signed out twice")
  assert.match(FORCED_LOGOUT_NOTICE, /saved offline on this device is kept/); assert.ok(FORCE_LOGOUT_LIMITS.some((line) => /already issued/.test(line)) && FORCE_LOGOUT_LIMITS.some((line) => /suspend/.test(line)) && FORCE_LOGOUT_LIMITS.some((line) => /offline/.test(line)))

  // the sign-out in the app erases nothing on the device (the offline queue lives there) and only touches the forced account's own session
  const auth = readFileSync(new URL("../src/lib/auth.tsx", import.meta.url), "utf8")
  assert.match(auth, /signOut\(\{ scope: "local" \}\)/); assert.match(auth, /shouldForceSignOut\(profile\.force_logout_at, session\.user\.last_sign_in_at\)/)
  assert.doesNotMatch(auth, /deleteDatabase|indexedDB|localStorage\.clear|sessionStorage\.clear|caches\.delete/, "no device data is erased")
}

// ---------------------------------------------------------------- a small harness that runs React hooks without a browser
function hooksHarness() {
  let state = [], effects = [], cursor = 0, pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial) { const n = cursor++; if (!(n in state)) state[n] = typeof initial === "function" ? initial() : initial; return [state[n], (value) => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
    useCallback(fn, deps) { const n = cursor++; if (!same(state[n]?.deps, deps)) state[n] = { deps, fn }; return state[n].fn },
    useEffect(fn, deps) { const n = cursor++; if (!same(effects[n]?.deps, deps)) pending.push(() => { effects[n]?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  }
  return { hooks, render(fn) { cursor = 0; const value = fn(); const work = pending; pending = []; work.forEach((run) => run()); return value }, unmount() { effects.forEach((effect) => effect?.cleanup?.()) } }
}

// ---------------------------------------------------------------- the notices
{
  const harness = hooksHarness()
  globalThis.__snHooks = harness.hooks; globalThis.__snStatus = null
  const source = transpile("../src/components/SiteStatusNotice.tsx", { "../lib/siteStatus": url("export const useSiteStatus=()=>globalThis.__snStatus;"), "../lib/siteStatusModel": fileUrl("../src/lib/siteStatusModel.ts"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") })
  const { default: Notice, FeatureLockNotice, StripView } = await import(url(source))
  assert.equal(Notice(), null, "nothing is drawn when there is no information")
  globalThis.__snStatus = { maintenance: { on: true, message: "Upgrading the database.", returns_at: null }, restricted: true, role: "foreman", locks: [{ feature: "daily_reports", label: "Daily reports", message: "Corrections in progress." }] }
  const strips = Notice(); assert.equal(strips.props.children.length, 2)
  const maintenanceStrip = StripView({ strip: strips.props.children[0].props.strip }); assert.equal(maintenanceStrip.props.role, "status"); assert.match(text(maintenanceStrip), /Maintenance\. Upgrading the database/)
  const onPage = FeatureLockNotice({ persona: "foreman", page: "daily-report" }); assert.ok(onPage); assert.match(text(onPage), /Daily reports is paused for you/); assert.match(text(onPage), /Corrections in progress\./); assert.match(text(onPage), /You can still look at the page/)
  assert.equal(FeatureLockNotice({ persona: "foreman", page: "dashboard" }), null, "a page of another feature shows nothing"); assert.equal(FeatureLockNotice({ persona: "client", page: "daily-report" }), null)
  globalThis.__snStatus = { ...globalThis.__snStatus, locks: [] }; assert.equal(FeatureLockNotice({ persona: "foreman", page: "daily-report" }), null)
  delete globalThis.__snHooks; delete globalThis.__snStatus
}

// ---------------------------------------------------------------- the Super Admin page
{
  const harnesses = { maintenance: hooksHarness(), feature: hooksHarness(), force: hooksHarness(), page: hooksHarness() } // one per component: they would otherwise share state slots
  const draws = (name, fn) => { globalThis.__scHooks = harnesses[name].hooks; return harnesses[name].render(fn) }
  const delegate = (name) => `${name}=(...a)=>globalThis.__scHooks.${name}(...a)`
  const calls = { save: [], feature: [], preview: [], force: [], confirm: [], toast: [], load: 0 }
  let confirmAnswer = true, role = "super_admin"
  let previewAnswer = { data: { total: 3, by_role: { foreman: 2, client: 1 }, signed_in_last_24h: 2, confirm_phrase: "LOG OUT 3", cooldown_seconds: 0 }, error: "", setup: false }
  let forceAnswer = { data: { accounts: 3, sessions_removed: 5 }, error: "", setup: false }
  let saveAnswer = { data: { changed: true, on: true }, error: "", setup: false }
  const controls = { maintenance: { on: false, message: "", returns_at: null, updated_at: null, updated_by: null }, features: [{ feature: "quality", label: "Quality inspections and defect reports", locked: false, audiences: ["engineer", "foreman", "client", "project_manager", "user"], message: "", updated_at: null }], last_forced_logout: { at: "2026-11-01T01:00:00Z", by: "Ana", details: { accounts: 4, reason: "Lost phones" } } }
  globalThis.__scApi = {
    loadSiteControls: async () => { calls.load++; return { data: controls, error: "", setup: false } }, saveMaintenance: async (input) => { calls.save.push(input); return saveAnswer },
    saveFeatureLock: async (input) => { calls.feature.push(input); return { data: { changed: true, locked: input.locked }, error: "", setup: false } },
    previewForceLogout: async (roles, project) => { calls.preview.push([roles, project]); return previewAnswer }, forceLogout: async (input) => { calls.force.push(input); return forceAnswer },
  }
  globalThis.__scToast = { error: (...a) => calls.toast.push(["error", ...a]), success: (...a) => calls.toast.push(["success", ...a]) }
  globalThis.__scConfirm = async (options) => { calls.confirm.push(options); return confirmAnswer }
  globalThis.__scRole = () => role
  const source = transpile("../src/pages/Admin/SiteControls.tsx", {
    react: url(`export const ${delegate("useState")},${delegate("useEffect")},${delegate("useCallback")};`), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "../../components/Modal": url("export default function Modal(){return null}"), "../../components/ui/PageParts": url("export const buttonPrimary='primary',buttonSecondary='secondary',inputClass='input';"),
    "../../components/ui/Skeleton": url("export const Skeleton=function Skeleton(){return null};"), "../../lib/admin": url("export const formatDate=(x)=>x,formatTime=(x)=>x;"),
    "../../lib/auth": url("export const useAuth=()=>({profile:{role:globalThis.__scRole()}});"), "../../lib/confirm": url("export const useConfirm=()=>globalThis.__scConfirm;"),
    "../../lib/projects": url("export const useProjects=()=>({projects:[{id:'p1',code:'P-1',name:'Tower'}]});"), "../../lib/toast": url("export const useToast=()=>globalThis.__scToast;"),
    "../../lib/siteControls": url("export const loadSiteControls=(...a)=>globalThis.__scApi.loadSiteControls(...a),saveMaintenance=(...a)=>globalThis.__scApi.saveMaintenance(...a),saveFeatureLock=(...a)=>globalThis.__scApi.saveFeatureLock(...a),previewForceLogout=(...a)=>globalThis.__scApi.previewForceLogout(...a),forceLogout=(...a)=>globalThis.__scApi.forceLogout(...a);"),
    "../../lib/siteStatusModel": fileUrl("../src/lib/siteStatusModel.ts"), "./AdminShell": url("export const PageIntro=function PageIntro(){return null},Panel=function Panel(){return null};"),
  })
  const page = await import(url(source))
  const click = async (element) => { element.props.onClick(); await settle(); await settle() }
  const button = (tree, wording) => all(tree, (node) => node.type === "button" && text(node).includes(wording))[0]
  const field = (tree, predicate) => all(tree, (node) => (node.type === "input" || node.type === "textarea") && predicate(node.props))[0]

  // maintenance
  const returnsLocal = new Date(Date.now() + 2 * 86_400_000 + 8 * 3_600_000).toISOString().slice(0, 16) // two days ahead, typed as Manila time
  const drawM = () => draws("maintenance", () => page.MaintenancePanel({ state: controls.maintenance, onChanged: () => calls.changed = (calls.changed ?? 0) + 1 }))
  let tree = drawM()
  assert.match(text(tree), /What is paused/); assert.match(text(tree), /What keeps working/); assert.match(text(tree), /Biometric devices and scheduled jobs/); assert.match(text(tree), /stays on until you switch it off/)
  await click(button(tree, "Switch maintenance on")); assert.equal(calls.save.length, 0, "a short message is refused before anything is asked"); assert.equal(calls.toast.at(-1)[0], "error")
  field(tree, (p) => p.maxLength === 500).props.onChange({ target: { value: "Upgrading the database." } }); field(tree, (p) => p.type === "datetime-local").props.onChange({ target: { value: returnsLocal } }); tree = drawM()
  confirmAnswer = false; await click(button(tree, "Switch maintenance on")); assert.equal(calls.save.length, 0, "declining the confirmation changes nothing"); assert.match(calls.confirm.at(-1).message, /cannot save changes until you switch it off.*Admins, Super Admins, biometric devices and scheduled jobs are not affected.*Saved offline items wait/)
  confirmAnswer = true; await click(button(tree, "Switch maintenance on"))
  assert.deepEqual(calls.save[0], { on: true, message: "Upgrading the database.", returnsAt: new Date(returnsLocal + ":00+08:00").toISOString() }, "the return time typed in Manila time is sent as that moment"); assert.equal(calls.changed, 1)

  // feature isolation
  const drawF = () => draws("feature", () => page.FeatureRow({ feature: controls.features[0], onChanged: () => {} }))
  assert.match(text(page.FeaturePanel({ features: [], onChanged: () => {} })), /Admins and Super Admins are never affected, and neither are biometric devices/)
  tree = drawF()
  await click(button(tree, "Pause for these roles")); assert.equal(calls.feature.length, 0, "no message, no pause")
  field(tree, (p) => p.placeholder === "Why it is paused and when it returns").props.onChange({ target: { value: "Inspections are paused for training." } }); tree = drawF()
  all(tree, (n) => n.type === "input" && n.props.type === "checkbox").slice(2).forEach((box) => box.props.onChange()); tree = drawF() // only Engineers and Foremen stay
  await click(button(tree, "Pause for these roles"))
  assert.deepEqual(calls.feature.at(-1), { feature: "quality", locked: true, audiences: ["engineer", "foreman"], message: "Inspections are paused for training." }); assert.match(calls.confirm.at(-1).message, /Engineers, Foremen cannot save changes in this feature/)

  // forced logout
  const draw = () => draws("force", () => page.ForceLogoutPanel({ last: controls.last_forced_logout }))
  tree = draw()
  assert.match(text(tree), /A sign-in token that was already issued can still be used until it expires/); assert.match(text(tree), /Anything they saved offline stays on their device/); assert.match(text(tree), /Last forced logout: .* by Ana, 4 account\(s\), reason: Lost phones\./)
  await click(button(tree, "Preview who is affected")); assert.equal(calls.preview.length, 0, "no roles chosen, nothing is counted"); assert.equal(calls.toast.at(-1)[1], "Choose who to sign out")
  const boxes = () => all(tree, (n) => n.type === "input" && n.props.type === "checkbox")
  boxes()[1].props.onChange(); boxes()[2].props.onChange(); tree = draw() // Foremen and Clients
  await click(button(tree, "Preview who is affected")); tree = draw()
  assert.deepEqual(calls.preview[0], [["foreman", "client"], null]); assert.match(text(all(tree, (n) => n.props?.["aria-label"] === "Who is affected")[0]), /3 accounts would be signed out/)
  assert.ok(button(tree, "Sign them out...").props.disabled, "a reason is needed before the final step")
  field(tree, (p) => p.placeholder?.startsWith("For example: lost phone")).props.onChange({ target: { value: "Lost phones during the audit" } }); tree = draw()
  assert.equal(button(tree, "Sign them out...").props.disabled, false)
  await click(button(tree, "Sign them out...")); tree = draw()
  const dialog = () => all(tree, (n) => n.props?.title === "Sign out 3 accounts?")[0]
  assert.ok(dialog(), "the strong confirmation opens"); assert.match(text(dialog()), /LOG OUT 3/); assert.match(text(dialog()), /Lost phones during the audit/)
  const confirmButton = () => button(dialog(), "Sign out 3")
  assert.equal(confirmButton().props.disabled, true, "the confirm button is off until the phrase is typed")
  const phraseField = () => all(dialog(), (n) => n.type === "input" && n.props["aria-label"] === "Confirmation phrase")[0]
  for (const wrong of ["log out 3", "LOG OUT 2", "yes"]) { phraseField().props.onChange({ target: { value: wrong } }); tree = draw(); assert.equal(confirmButton().props.disabled, true, wrong) }
  await click(confirmButton()); assert.equal(calls.force.length, 0, "even a click on the disabled button sends nothing")
  phraseField().props.onChange({ target: { value: "LOG OUT 3" } }); tree = draw(); assert.equal(confirmButton().props.disabled, false)
  await click(confirmButton()); tree = draw()
  assert.deepEqual(calls.force[0], { roles: ["foreman", "client"], project: null, expected: 3, confirm: "LOG OUT 3", reason: "Lost phones during the audit" }, "the database gets the previewed count, the exact phrase and the reason")
  assert.equal(calls.toast.at(-1)[1], "Signed out 3 accounts"); assert.match(calls.toast.at(-1)[2], /5 saved sign-ins removed\. The app signs them out within about 30 seconds/)
  assert.equal(all(tree, (n) => n.props?.["aria-label"] === "Who is affected").length, 0, "the preview is cleared after a run so it cannot be replayed")
  // a refusal (the count changed) closes the preview and signs nobody out
  await click(button(tree, "Preview who is affected")); tree = draw(); field(tree, (p) => p.placeholder?.startsWith("For example: lost phone")).props.onChange({ target: { value: "Another review" } }); tree = draw()
  await click(button(tree, "Sign them out...")); tree = draw(); forceAnswer = { data: null, error: "The number of affected accounts is now 4. Preview again before confirming", setup: false }
  phraseField().props.onChange({ target: { value: "LOG OUT 3" } }); tree = draw(); await click(confirmButton()); tree = draw()
  assert.equal(calls.toast.at(-1)[1], "Nobody was signed out"); assert.match(calls.toast.at(-1)[2], /Preview again/); assert.equal(all(tree, (n) => n.props?.["aria-label"] === "Who is affected").length, 0)
  // a cooldown or nobody matching blocks the final step
  previewAnswer = { data: { total: 2, by_role: { foreman: 2 }, signed_in_last_24h: 1, confirm_phrase: "LOG OUT 2", cooldown_seconds: 240 }, error: "", setup: false }
  await click(button(tree, "Preview who is affected")); tree = draw(); assert.match(text(tree), /Wait 4 minute\(s\)/); field(tree, (p) => p.placeholder?.startsWith("For example: lost phone")).props.onChange({ target: { value: "A good reason" } }); tree = draw(); assert.equal(button(tree, "Sign them out...").props.disabled, true)
  previewAnswer = { data: null, error: "Site controls are not installed on the database yet (migration 20261101150000_site_controls). The owner reviews and runs it first.", setup: true }
  await click(button(tree, "Preview who is affected")); tree = draw(); assert.match(text(tree), /not installed on the database yet/)

  // the page: only a Super Admin gets anything
  role = "admin"; let shell = draws("page", () => page.default({ onNavigate() {} })); await settle(); assert.equal(calls.load, 0, "an Admin loads nothing"); assert.match(text(shell), /Only a Super Admin can open the site controls/)
  role = "super_admin"; shell = draws("page", () => page.default({ onNavigate() {} })); await settle(); await settle(); shell = draws("page", () => page.default({ onNavigate() {} })); assert.equal(calls.load, 1)
  assert.ok(all(shell, (n) => typeof n.type === "function" && ["MaintenancePanel", "FeaturePanel", "ForceLogoutPanel"].includes(n.type.name)).length === 3)
  Object.values(harnesses).forEach((h) => h.unmount())
  for (const key of ["__scHooks", "__scApi", "__scToast", "__scConfirm", "__scRole"]) delete globalThis[key]
}

console.log("Site controls: queue pause (kept, never failed), polling store, status and notices, forms, strong confirmation, sign-out rule, and the Super Admin page passed")
