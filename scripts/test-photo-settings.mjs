import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import * as settingsModel from "../src/lib/settingsModel.ts"
import * as policyModel from "../src/lib/photoPolicyModel.ts"

const dataUrl = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
const hooksUrl = dataUrl("export const useState=(...a)=>globalThis.__photoSettingsHooks.useState(...a);export const useEffect=(...a)=>globalThis.__photoSettingsHooks.useEffect(...a);export const useMemo=fn=>fn();export const useCallback=fn=>fn;")
const mounts = new Map()
let active
globalThis.__photoSettingsHooks = {
  useState(initial) {
    const owner = active, n = owner.cursor++
    if (!(n in owner.state)) owner.state[n] = typeof initial === "function" ? initial() : initial
    return [owner.state[n], value => { assert.ok(owner.live, "No updates after unmount"); owner.state[n] = typeof value === "function" ? value(owner.state[n]) : value }]
  },
  useEffect(fn, deps) {
    const owner = active, n = owner.cursor++, before = owner.effects[n]
    if (!before || deps.some((value, i) => value !== before.deps[i])) owner.pending.push(() => { before?.cleanup?.(); owner.effects[n] = { deps, cleanup: fn() } })
  },
}
function render(Component, name, props = {}) {
  if (!mounts.has(name)) mounts.set(name, { state: [], effects: [], pending: [], cursor: 0, live: true })
  let tree
  for (let pass = 0; pass < 2; pass++) {
    active = mounts.get(name); active.cursor = 0
    tree = Component(props)
    const pending = active.pending; active.pending = []; pending.forEach(fn => fn())
  }
  return tree
}
function unmount(name) {
  const owner = mounts.get(name)
  owner?.effects.forEach(effect => effect?.cleanup?.())
  if (owner) owner.live = false
  mounts.delete(name)
}
const settle = () => new Promise(resolve => setImmediate(resolve))
async function compile(path, replacements) {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries({ react: hooksUrl, "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...replacements })) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  const moduleUrl = dataUrl(source)
  return { moduleUrl, exports: await import(moduleUrl) }
}

// Exercise the actual policy hook: timer, resume events, shared reads, offline recovery and account/project races.
const originals = Object.fromEntries(["window", "document", "localStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const realNow = Date.now
let now = 1000, company = true, offline = false, hold = false, reads = [], waiting = [], nextTimer = 0
const rules = new Map(), storage = new Map(), timers = new Map()
function surface() {
  const handlers = new Map()
  return {
    handlers,
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn) },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn) },
    fire(type) { for (const fn of handlers.get(type) ?? []) fn() },
  }
}
globalThis.window = { ...surface(), setInterval(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id }, clearInterval(id) { timers.delete(id) } }
globalThis.document = { ...surface(), hidden: false }
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
Date.now = () => now
globalThis.__photoSettingsProfile = { id: "foreman-a", role: "foreman" }
globalThis.__photoSettingsDB = { from(table) {
  const filters = {}
  const query = {
    select() { return query }, eq(key, value) { filters[key] = value; return query },
    maybeSingle() {
      reads.push({ table, filters: { ...filters } })
      const result = offline ? { data: null, error: new Error("offline") } : { data: table === "system_settings" ? { value: company } : table === "photo_upload_overrides" ? (rules.has(filters.user_id) ? { mode: rules.get(filters.user_id) } : null) : { site_lat: 14.6, site_lng: 121, site_radius_m: 150 }, error: null }
      return hold ? new Promise(resolve => waiting.push(() => resolve(result))) : Promise.resolve(result)
    },
  }; return query
} }
const { exports: { usePhotoPolicy } } = await compile("../src/lib/photoPolicy.ts", {
  "./supabase": dataUrl("export const supabase=globalThis.__photoSettingsDB"),
  "./auth": dataUrl("export const useAuth=()=>({profile:globalThis.__photoSettingsProfile})"),
  "./paging": dataUrl("export const fetchAll=async()=>({data:[],error:null})"),
  "./photoStamp": new URL("../src/lib/photoStamp.ts", import.meta.url).href,
  "./photoPolicyModel": new URL("../src/lib/photoPolicyModel.ts", import.meta.url).href,
})
const Policy = ({ project = "project-a" }) => usePhotoPolicy(project)
try {
  render(Policy, "policy-a"); render(Policy, "policy-b"); await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, true)
  assert.equal(reads.length, 3, "Several photo buttons share one policy and site request")
  rules.set("foreman-a", "camera_only"); now += 60001
  for (const timer of timers.values()) { assert.equal(timer.ms, 60000); timer.fn() }
  await settle()
  assert.equal(reads.length, 6, "Periodic refresh deduplicates requests")
  assert.equal(render(Policy, "policy-a").allowUpload, false)
  assert.equal(render(Policy, "policy-b").qaCameraOnly, true)
  rules.set("foreman-a", "allow"); window.fire("focus"); await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, true, "Focus bypasses a fresh cached rule")
  rules.set("foreman-a", "camera_only"); document.hidden = true
  const beforeHidden = reads.length
  for (const timer of timers.values()) timer.fn()
  document.fire("visibilitychange"); await settle()
  assert.equal(reads.length, beforeHidden, "Background tabs do not poll")
  document.hidden = false; document.fire("visibilitychange"); await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, false, "Returning to a tab reloads the rule")
  offline = true; window.fire("online"); await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, false, "An unavailable server retains this user's remembered rule")
  offline = false; rules.set("foreman-a", "allow"); window.fire("online"); await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, true, "Reconnection reloads current policy")
  rules.delete("foreman-a"); company = false; window.fire("focus"); await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, false, "The company switch is refreshed too")
  unmount("policy-b")
  hold = true; company = true; window.fire("focus"); await settle()
  now += 60001; hold = false; rules.set("foreman-a", "camera_only")
  for (const timer of timers.values()) timer.fn()
  await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, false, "An expired in-flight request cannot prevent recovery")
  waiting.forEach(resolve => resolve()); waiting = []; await settle()
  assert.equal(render(Policy, "policy-a").allowUpload, false, "An older response cannot replace a newer rule")
  rules.set("foreman-a", "allow")
  hold = true; company = true; window.fire("focus"); await settle()
  globalThis.__photoSettingsProfile = { id: "engineer-b", role: "engineer" }
  rules.set("engineer-b", "camera_only"); hold = false
  assert.equal(render(Policy, "policy-a", { project: "project-b" }).allowUpload, null, "A new user never inherits another user's upload choice")
  await settle()
  assert.equal(render(Policy, "policy-a", { project: "project-b" }).qaCameraOnly, true)
  const late = waiting; waiting = []; late.forEach(resolve => resolve()); await settle()
  assert.equal(render(Policy, "policy-a", { project: "project-b" }).allowUpload, false, "Older requests cannot replace the new account's rule")
  assert.equal(JSON.parse(storage.get("buildtrack.photoUploads")).userId, "engineer-b")
  hold = true; window.fire("focus"); await settle(); unmount("policy-a")
  waiting.forEach(resolve => resolve()); waiting = []; await settle()
  assert.equal(timers.size, 0)
  for (const handlers of [window.handlers, document.handlers]) for (const listeners of handlers.values()) assert.equal(listeners.size, 0, "Unmount cleans up resume listeners")
} finally {
  for (const name of [...mounts.keys()]) unmount(name)
  Date.now = realNow
  for (const [key, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  delete globalThis.__photoSettingsDB; delete globalThis.__photoSettingsProfile
}

// Actual settings components: tabs preserve choices, the marker covers both cards, and partial saves retain failed drafts.
const accounts = [
  { user_id: "a", full_name: "Worker A", email: "a@example.test", role: "foreman", mode: null, updated_at: null },
  { user_id: "b", full_name: "Worker B", email: "b@example.test", role: "engineer", mode: null, updated_at: null },
]
let failUser = "", writes = [], confirmed = true
const settingRows = [], toasts = []
globalThis.__photoSettingsUI = {
  ...settingsModel, ...policyModel,
  useSettings: () => ({ settings: settingsModel.defaultSettings, rows: settingRows, loading: false, error: "", save: async () => null }),
  useAuth: () => ({ profile: { role: "super_admin" }, can: () => true }),
  usePhotoAccounts: () => ({ accounts, loading: false, error: "", reload: async () => {} }),
  setPhotoRule: async (id, mode) => { writes.push({ id, mode }); if (id === failUser) return "Connection unavailable"; accounts.find(account => account.user_id === id).mode = mode; return "" },
  useConfirm: () => async () => confirmed,
  useToast: () => ({ success: (...args) => toasts.push(["success", ...args]), error: (...args) => toasts.push(["error", ...args]) }),
}
async function compileUI(path, childUrl) {
  const original = readFileSync(new URL(path, import.meta.url), "utf8"), ast = ts.createSourceFile(path, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const replacements = {}
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text
    if (name === "react") continue
    const parts = []
    if (declaration.importClause.name) parts.push(name === "./PhotoAccountRules" ? `export { default } from ${JSON.stringify(childUrl)}` : "export default function Stub(){return null}")
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      parts.push(`export const ${key}=globalThis.__photoSettingsUI.${key} ?? function Stub(){return null}`)
    }
    replacements[name] = dataUrl(parts.join(";"))
  }
  return compile(path, replacements)
}
const { moduleUrl: childUrl, exports: { default: Child } } = await compileUI("../src/pages/Admin/PhotoAccountRules.tsx")
const { exports: { default: Parent } } = await compileUI("../src/pages/Admin/SystemSettings.tsx", childUrl)
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const tab = (tree, label) => all(tree).find(node => node.props?.role === "tab" && text(node).startsWith(label))
const rule = (tree, name) => all(tree).find(node => node.type === "select" && node.props["aria-label"] === `Photo rule for ${name}`)
const button = (tree, label) => all(tree).find(node => node.type === "button" && text(node) === label)
let parent = render(Parent, "parent")
assert.ok(!all(parent).some(node => node.type === Child), "Account choices load only after the Site photos tab is opened")
tab(parent, "Site photos").props.onClick(); parent = render(Parent, "parent")
const childProps = () => all(parent).find(node => node.type === Child).props
let child = render(Child, "child", childProps())
assert.deepEqual(all(rule(child, "Worker A")).filter(node => node.type === "option").map(text), ["Both", "Allow uploads", "Camera only (at site)"])
assert.ok(!all(parent).some(node => node.props?.title === "Company setting"), "Site photos contains only the account choices card")
rule(child, "Worker A").props.onChange({ target: { value: "camera_only" } }); child = render(Child, "child", childProps()); parent = render(Parent, "parent")
assert.match(text(tab(parent, "Site photos")), /unsaved changes/)
tab(parent, "Quality scoring").props.onClick(); parent = render(Parent, "parent")
assert.equal(all(parent).find(node => node.key === "photo-account-rules").props.hidden, true)
assert.ok(all(parent).some(node => node.type === Child), "Switching tabs retains the actual choices component")
tab(parent, "Site photos").props.onClick(); parent = render(Parent, "parent"); child = render(Child, "child", childProps())
assert.equal(rule(child, "Worker A").props.value, "camera_only")
button(child, "Reset").props.onClick(); child = render(Child, "child", childProps()); parent = render(Parent, "parent")
assert.equal(rule(child, "Worker A").props.value, "company"); assert.doesNotMatch(text(tab(parent, "Site photos")), /unsaved changes/)
rule(child, "Worker A").props.onChange({ target: { value: "camera_only" } }); rule(child, "Worker B").props.onChange({ target: { value: "allow" } }); child = render(Child, "child", childProps())
confirmed = false; button(child, "Save").props.onClick(); await settle(); assert.equal(writes.length, 0)
confirmed = true; failUser = "b"; button(child, "Save").props.onClick(); await settle(); child = render(Child, "child", childProps()); parent = render(Parent, "parent")
assert.deepEqual(writes, [{ id: "a", mode: "camera_only" }, { id: "b", mode: "allow" }])
assert.equal(accounts[0].mode, "camera_only"); assert.equal(accounts[1].mode, null)
assert.equal(rule(child, "Worker B").props.value, "allow"); assert.match(text(tab(parent, "Site photos")), /unsaved changes/)
assert.ok(toasts.some(([kind]) => kind === "error"))
failUser = ""; button(child, "Save").props.onClick(); await settle(); child = render(Child, "child", childProps()); parent = render(Parent, "parent")
assert.equal(accounts[1].mode, "allow"); assert.doesNotMatch(text(tab(parent, "Site photos")), /unsaved changes/)
assert.ok(!all(parent).some(node => node.type === "input" && node.props.type === "checkbox"), "The removed company switch is not rendered")
for (const name of [...mounts.keys()]) unmount(name)
delete globalThis.__photoSettingsHooks; delete globalThis.__photoSettingsUI
console.log("Photo settings: timed/focus/visibility/online refresh, shared reads, offline/account races and cleanup; tab draft retention, dirty indicators, confirmation and partial-save retry passed")
