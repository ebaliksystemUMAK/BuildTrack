import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import {
  REASON_LIMITS, binError, cleanReason, describeContents, emptyContents, inScope, isEmptyProject, parseContents, parsePreview, parseRecycleBin, parseRestore, removalProblem,
  restoreCodeProblem, restoreNotes, scopeCounts, scopeLabels, parsePurgePreview, purgePhrase, purgeProblem,
} from "../src/lib/recycleBinModel.ts"
import { MAX_PURGE_FILES, PURGE_BUCKET, authorizePurge, chunk, isUuid, purgePhrase as serverPhrase, splitEntries } from "../supabase/functions/_shared/purgeModel.ts"

// Everything here runs against fakes: no database, no network, nothing is removed or restored anywhere.
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
const fileUrl = (path) => new URL(path, import.meta.url).href
const settle = () => new Promise((resolve) => setImmediate(resolve))
const transpile = (path, replacements) => {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return source
}
// The only child component rendered by the tests is the stateless list of what a project contains.
const expand = (node) => (node && typeof node.type === "function" && node.type.name === "Inside" ? node.type(node.props) : node)
const text = (raw) => { const node = expand(raw); return Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node) }
const all = (raw, predicate) => { const node = expand(raw); return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => all(child, predicate)) : [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate), ...all(node.props?.footer, predicate), ...all(node.props?.action, predicate)] }
const contents = (patch = {}) => ({ ...emptyContents, ...patch })

// ---------------------------------------------------------------- the pure rules
{
  assert.deepEqual(parseContents(null), emptyContents); assert.deepEqual(parseContents({ pins: 3, plans: "x", team: -2, photos: 2.9 }), contents({ pins: 3, photos: 2 }))
  assert.deepEqual(describeContents(emptyContents), []); assert.equal(isEmptyProject(emptyContents), true)
  assert.deepEqual(describeContents(contents({ plans: 1, pins: 12, evidence_pins: 2, team: 1, daily_reports: 3, scans: 40, photos: 1 })),
    ["1 plan", "12 pins (2 with review or verification evidence)", "1 team member", "3 daily reports", "1 photo", "40 biometric scans"])
  assert.equal(isEmptyProject(contents({ devices: 2 })), true, "an active device alone is not a record")

  const row = { id: "p1", code: "VCB-1", name: "Tower", removed_at: "2026-11-01T01:00:00Z", removed_by: "Ana", reason: "Created twice", archived_at: "2026-10-30T01:00:00Z", contents: { pins: 4 } }
  const parsed = parseRecycleBin({ projects: [row, { id: 5 }, null, "x", { ...row, id: "p2", removed_by: undefined, reason: 3, name: undefined }] })
  assert.equal(parsed.length, 2); assert.deepEqual(parsed[0].contents, contents({ pins: 4 })); assert.deepEqual([parsed[1].removed_by, parsed[1].reason, parsed[1].name], [null, null, "VCB-1"])
  for (const bad of [null, undefined, "x", {}, { projects: "x" }]) assert.equal(parseRecycleBin(bad), null)
  assert.deepEqual(parseRecycleBin({ projects: [] }), [])

  assert.deepEqual(parsePreview({ id: "p1", code: "VCB-1", name: "Tower", archived: true, removed: false, contents: { pins: 1 } }), { id: "p1", code: "VCB-1", name: "Tower", archived: true, removed: false, contents: contents({ pins: 1 }) })
  for (const bad of [null, "x", {}, { id: "p1" }]) assert.equal(parsePreview(bad), null)

  const preview = { id: "p1", code: "VCB-1", name: "Tower", archived: true, removed: false, contents: emptyContents }
  const ok = { preview, reason: "Created twice by mistake", typedCode: "VCB-1" }
  assert.equal(removalProblem(ok), null)
  assert.match(removalProblem({ ...ok, preview: null }), /Check what is inside first/); assert.match(removalProblem({ ...ok, preview: { ...preview, removed: true } }), /already in the recycle bin/)
  assert.match(removalProblem({ ...ok, preview: { ...preview, archived: false } }), /Archive the project first/)
  assert.match(removalProblem({ ...ok, reason: "no" }), /5 to 300/); assert.match(removalProblem({ ...ok, reason: "x".repeat(301) }), /5 to 300/); assert.match(removalProblem({ ...ok, reason: "     " }), /5 to 300/)
  for (const wrong of ["vcb-1", "VCB-1 ", " VCB-1", "VCB1", "", "VCB-2"]) assert.match(removalProblem({ ...ok, typedCode: wrong }), /Type VCB-1 exactly/, JSON.stringify(wrong))
  assert.equal(cleanReason("  Created\u0007   twice \n by mistake "), "Created twice by mistake"); assert.deepEqual(REASON_LIMITS, { min: 5, max: 300 })

  assert.equal(restoreCodeProblem(""), null); assert.equal(restoreCodeProblem("  "), null); assert.equal(restoreCodeProblem("vcb-024"), null, "lower case is accepted and upper-cased")
  for (const bad of ["a", "-AB", "AB CD", "AB_CD", "x".repeat(31)]) assert.match(restoreCodeProblem(bad), /2-30 characters/, bad)

  const projects = [{ archived_at: null }, { archived_at: "2026-10-01" }, { archived_at: "2026-10-02" }, { archived_at: null, deleted_at: "2026-11-01" }]
  assert.deepEqual(scopeCounts(projects, 7), { open: 1, archived: 2, all: 3, bin: 7 })
  assert.deepEqual(projects.map((p) => inScope(p, "open")), [true, false, false, false]); assert.deepEqual(projects.map((p) => inScope(p, "archived")), [false, true, true, false])
  assert.deepEqual(projects.map((p) => inScope(p, "all")), [true, true, true, false]); assert.deepEqual(projects.map((p) => inScope(p, "bin")), [false, false, false, false])
  assert.equal(scopeLabels.bin, "Recycle bin")

  const result = parseRestore({ restored: true, code: "VCB-1", code_changed: false, still_archived: true, inactive_members: 2, has_primary_manager: false })
  assert.deepEqual(result, { restored: true, code: "VCB-1", code_changed: false, still_archived: true, inactive_members: 2, has_primary_manager: false })
  for (const bad of [null, "x", {}, { restored: false, code: "A" }, { restored: true }]) assert.equal(parseRestore(bad), null)
  const notes = restoreNotes(result)
  assert.equal(notes.length, 3); assert.match(notes[0], /archived project \(read-only\)/); assert.match(notes[1], /2 team members are no longer active/); assert.match(notes[2], /no active primary Project Manager/)
  assert.deepEqual(restoreNotes({ ...result, still_archived: false, inactive_members: 0, has_primary_manager: true }), [])
  assert.match(restoreNotes({ ...result, code_changed: true, code: "VCB-1A", inactive_members: 1, has_primary_manager: true }).join(" "), /Its code is now VCB-1A\. .*1 team member is no longer active/)

  assert.equal(binError({ code: "PGRST202" }).setup, true); assert.equal(binError({ message: "function public.get_recycle_bin() does not exist" }).setup, true)
  assert.match(binError({ message: "Only an Admin with the Projects permission can manage the recycle bin", code: "42501" }).message, /authenticator app/)
  assert.match(binError({ message: "Failed to fetch" }).message, /Network problem/)
  assert.equal(binError({ message: "Type the project code exactly to confirm" }).message, "Type the project code exactly to confirm", "database messages are written to be read")
  assert.equal(binError(null).message, "That did not work. Try again.")
}

// ---------------------------------------------------------------- permanent deletion: pure rules (browser and Edge Function agree)
{
  assert.equal(purgePhrase("VCB-1"), "DELETE FOREVER VCB-1"); assert.equal(serverPhrase("VCB-1"), purgePhrase("VCB-1"), "the screen and the function type the same phrase")
  const ready = { ok: true, reasons: [], code: "VCB-1", name: "Tower", removed_at: "2026-09-01T00:00:00Z", removed_by: "Ana", removal_reason: "Created twice", days_in_bin: 40, min_days: 30, contents: { plans: 1, pins: 2 } }
  const parsed = parsePurgePreview(ready); assert.deepEqual([parsed.ok, parsed.days_in_bin, parsed.min_days, parsed.contents.plans, parsed.removed_by], [true, 40, 30, 1, "Ana"])
  for (const bad of [null, "x", {}, { ok: "yes", reasons: [] }, { ok: true }]) assert.equal(parsePurgePreview(bad), null)
  assert.deepEqual(parsePurgePreview({ ok: false, reasons: ["a", 5, "b"] }).reasons, ["a", "b"]); assert.equal(parsePurgePreview({ ok: false, reasons: [] }).min_days, 30)
  assert.match(purgeProblem({ preview: null, typed: "" }), /Check the project first/)
  assert.equal(purgeProblem({ preview: parsed, typed: "DELETE FOREVER VCB-1" }), null)
  for (const wrong of ["delete forever vcb-1", "DELETE FOREVER VCB-1 ", " DELETE FOREVER VCB-1", "DELETE VCB-1", "", "VCB-1"]) assert.match(purgeProblem({ preview: parsed, typed: wrong }), /Type DELETE FOREVER VCB-1 exactly/, JSON.stringify(wrong))
  assert.match(purgeProblem({ preview: { ...parsed, ok: false, reasons: ["It must stay in the recycle bin for at least 30 days (5 more)"] }, typed: "DELETE FOREVER VCB-1" }), /at least 30 days \(5 more\)/, "a blocked project is never confirmable, whatever is typed")
  assert.match(binError({ message: "Only a Super Admin can permanently delete a project", code: "42501" }).message, /Only a Super Admin, signed in with the authenticator/)

  // the Edge Function's rules
  const id = "0afd429e-3ffa-4a57-a9eb-408041917802"
  assert.equal(isUuid(id), true); for (const bad of ["x", "", null, 5, id + "x", "../" + id]) assert.equal(isUuid(bad), false)
  assert.deepEqual(authorizePurge("super_admin", { project_id: id, confirm: "DELETE FOREVER VCB-1" }), { ok: true, projectId: id, confirm: "DELETE FOREVER VCB-1" })
  for (const role of ["admin", "project_manager", "engineer", "foreman", "client", "user", null, undefined]) assert.deepEqual(authorizePurge(role, { project_id: id, confirm: "x" }), { ok: false, status: 403, message: "Only a Super Admin can permanently delete a project" }, String(role))
  assert.equal(authorizePurge("super_admin", { project_id: "nope", confirm: "x" }).status, 400); assert.equal(authorizePurge("super_admin", { project_id: id }).status, 400)
  assert.equal(authorizePurge("super_admin", { project_id: id, confirm: "x".repeat(101) }).status, 400); assert.equal(authorizePurge("super_admin", null).status, 400)
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]); assert.deepEqual(chunk([], 100), [])
  assert.deepEqual(splitEntries(id, [{ name: "a.png", id: "1" }, { name: "sheet", id: null }, { name: "../x", id: "2" }, { name: "b/c", id: "3" }, { name: "", id: "4" }, { name: "p.jpg", id: "5" }]), { files: [`${id}/a.png`, `${id}/p.jpg`], folders: [`${id}/sheet`] }, "only entries inside the project's own folder are ever returned")
  assert.equal(PURGE_BUCKET, "blueprints"); assert.ok(MAX_PURGE_FILES >= 1000)

  // the function itself: guarded, checks first, lists files before the rows go and removes them only afterwards
  const fn = readFileSync(new URL("../supabase/functions/purge-project/index.ts", import.meta.url), "utf8")
  assert.ok(fn.indexOf("requireCaller") < fn.indexOf("authorizePurge") && fn.indexOf("authorizePurge") < fn.indexOf("project_purge_check") && fn.indexOf("project_purge_check") < fn.indexOf("listFiles(caller, decision") && fn.indexOf("listFiles(caller, decision") < fn.indexOf("purge_project_rows") && fn.indexOf("purge_project_rows") < fn.indexOf(".remove(part)"), "order: caller, authorise, check, list files, delete rows, remove files")
  assert.doesNotMatch(fn.replace(/\/\/.*$/gm, ""), /verify_jwt|\.from\("projects"\)\.delete|\.delete\(\)/, "no direct delete and no weakened auth in the function")
  const sql = readFileSync(new URL("../supabase/migrations/20261101190000_delete_protection_and_purge.sql", import.meta.url), "utf8")
  assert.match(sql, /revoke execute on function public\.purge_project_rows\(uuid, uuid\) from public, anon, authenticated;\s+grant execute on function public\.purge_project_rows\(uuid, uuid\) to service_role;/)
  assert.match(sql, /revoke execute on function public\.project_purge_check\(uuid\) from public, anon, authenticated;\s+grant execute on function public\.project_purge_check\(uuid\) to service_role;/)
  assert.match(sql, /v_min constant integer := 30/); assert.doesNotMatch(sql, /^\s*(truncate|drop table)/mi)
  const confirmSource = readFileSync(new URL("../src/lib/confirm.tsx", import.meta.url), "utf8")
  assert.match(confirmSource, /typeToConfirm\?: string/); assert.match(confirmSource, /disabled=\{Boolean\(pending\.typeToConfirm\) && typed !== pending\.typeToConfirm\}/, "the confirm button stays off until the exact text is typed")
  const editor = readFileSync(new URL("../src/components/editor/BlueprintEditor.tsx", import.meta.url), "utf8")
  assert.match(editor, /confirmLabel: "Delete sheet",\s+tone: "danger",\s+typeToConfirm: "DELETE"/, "deleting a sheet needs the typed word")
  const parts = readFileSync(new URL("../src/components/editor/PinParts.tsx", import.meta.url), "utf8")
  assert.match(parts, /title: "Remove this task\?"/, "removing a checklist item asks first now")
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

// ---------------------------------------------------------------- the data layer, with a fake database
{
  const calls = []
  let answers = {}
  globalThis.__rbSupabase = { rpc: async (name, args) => { calls.push([name, args]); const a = answers[name]; return typeof a === "function" ? a(args) : a ?? { data: null, error: null } } }
  const harness = hooksHarness(); globalThis.__rbHooks = harness.hooks
  const source = transpile("../src/lib/recycleBin.ts", { react: url("export const useCallback=(...a)=>globalThis.__rbHooks.useCallback(...a),useEffect=(...a)=>globalThis.__rbHooks.useEffect(...a),useState=(...a)=>globalThis.__rbHooks.useState(...a);"), "./supabase": url("export const supabase=globalThis.__rbSupabase;"), "./functions": url("export const invokeFunction=(...a)=>globalThis.__rbFn(...a);"), "./recycleBinModel": fileUrl("../src/lib/recycleBinModel.ts") })
  const api = await import(url(source))

  answers.preview_project_removal = { data: { id: "p1", code: "VCB-1", name: "Tower", archived: true, removed: false, contents: { pins: 2 } }, error: null }
  let r = await api.previewRemoval("p1"); assert.equal(r.error, ""); assert.equal(r.data.contents.pins, 2); assert.deepEqual(calls.at(-1), ["preview_project_removal", { p_project: "p1" }])
  answers.preview_project_removal = { data: { nope: 1 }, error: null }; r = await api.previewRemoval("p1"); assert.equal(r.data, null); assert.match(r.error, /could not be read/)
  answers.preview_project_removal = { data: null, error: { code: "PGRST202", message: "x" } }; r = await api.previewRemoval("p1"); assert.equal(r.setup, true); assert.match(r.error, /not installed on the database yet/)

  answers.remove_project = { data: { removed: true, code: "VCB-1" }, error: null }
  r = await api.removeProject({ projectId: "p1", reason: "  Created \u0007 twice ", code: "VCB-1" }); assert.deepEqual(r.data, { removed: true, code: "VCB-1" })
  assert.deepEqual(calls.at(-1), ["remove_project", { p_project: "p1", p_reason: "Created twice", p_confirm: "VCB-1" }], "the reason is cleaned and the code is sent exactly as typed")
  answers.remove_project = { data: null, error: { message: "Archive the project first. Only an archived project can be moved to the recycle bin" } }; r = await api.removeProject({ projectId: "p1", reason: "Created twice", code: "VCB-1" }); assert.match(r.error, /^Archive the project first/)

  answers.restore_removed_project = { data: { restored: true, code: "VCB-1A", code_changed: true, still_archived: true, inactive_members: 0, has_primary_manager: true }, error: null }
  r = await api.restoreProject({ projectId: "p1", newCode: " vcb-1a " }); assert.equal(r.data.code, "VCB-1A"); assert.deepEqual(calls.at(-1), ["restore_removed_project", { p_project: "p1", p_new_code: "VCB-1A" }])
  await api.restoreProject({ projectId: "p1", newCode: "  " }); assert.deepEqual(calls.at(-1), ["restore_removed_project", { p_project: "p1", p_new_code: null }], "no new code: keep the code")
  answers.restore_removed_project = { data: { restored: false }, error: null }; r = await api.restoreProject({ projectId: "p1", newCode: "" }); assert.equal(r.data, null)

  // permanent deletion: the check is a database function, the deletion is the Edge Function
  answers.preview_project_purge = { data: { ok: true, reasons: [], code: "VCB-1", name: "Tower", days_in_bin: 40, min_days: 30, contents: { plans: 1 } }, error: null }
  r = await api.previewPurge("p1"); assert.equal(r.data.ok, true); assert.deepEqual(calls.at(-1), ["preview_project_purge", { p_project: "p1" }])
  answers.preview_project_purge = { data: { wrong: 1 }, error: null }; r = await api.previewPurge("p1"); assert.equal(r.data, null)
  answers.preview_project_purge = { data: null, error: { code: "42501", message: "Only a Super Admin can permanently delete a project" } }; r = await api.previewPurge("p1"); assert.match(r.error, /Only a Super Admin, signed in with the authenticator/)
  const invoked = []; let fnAnswer = { data: { purged: true, code: "VCB-1", files_removed: 3, files_failed: 0 }, error: null }
  globalThis.__rbFn = async (name, body) => { invoked.push([name, body]); return fnAnswer }
  r = await api.purgeProject({ projectId: "p1", phrase: "DELETE FOREVER VCB-1" }); assert.equal(r.data.files_removed, 3); assert.deepEqual(invoked[0], ["purge-project", { project_id: "p1", confirm: "DELETE FOREVER VCB-1" }])
  fnAnswer = { data: null, error: 'The "purge-project" function is not deployed yet.' }; r = await api.purgeProject({ projectId: "p1", phrase: "x" }); assert.equal(r.setup, true)
  fnAnswer = { data: null, error: "This project cannot be deleted forever: 2 daily report(s)" }; r = await api.purgeProject({ projectId: "p1", phrase: "x" }); assert.match(r.error, /2 daily report/); assert.equal(r.setup, false)
  delete globalThis.__rbFn

  // the list hook: loads once when allowed, never calls the database when not allowed
  answers.get_recycle_bin = { data: { projects: [{ id: "p1", code: "VCB-1", name: "Tower", removed_at: "2026-11-01T01:00:00Z", contents: { pins: 1 } }] }, error: null }
  const before = calls.length
  let view = harness.render(() => api.useRecycleBin(false)); await settle(); view = harness.render(() => api.useRecycleBin(false))
  assert.equal(calls.length, before, "an Admin without the permission never asks"); assert.deepEqual(view.projects, [])
  const allowed = hooksHarness(); globalThis.__rbHooks = allowed.hooks
  view = allowed.render(() => api.useRecycleBin(true)); await settle(); view = allowed.render(() => api.useRecycleBin(true))
  assert.equal(view.projects.length, 1); assert.equal(view.loading, false); assert.equal(view.error, ""); assert.equal(calls.filter((c) => c[0] === "get_recycle_bin").length, 1)
  answers.get_recycle_bin = { data: null, error: { code: "PGRST202", message: "x" } }; await view.reload(); view = allowed.render(() => api.useRecycleBin(true))
  assert.equal(view.setup, true); assert.equal(view.error, ""); assert.deepEqual(view.projects, [])
  answers.get_recycle_bin = { data: null, error: { message: "Failed to fetch" } }; await view.reload(); view = allowed.render(() => api.useRecycleBin(true)); assert.match(view.error, /Network problem/); assert.equal(view.setup, false)
  answers.get_recycle_bin = { data: { wrong: 1 }, error: null }; await view.reload(); view = allowed.render(() => api.useRecycleBin(true)); assert.match(view.error, /could not be read/)
  delete globalThis.__rbSupabase; delete globalThis.__rbHooks
}

// ---------------------------------------------------------------- the screens
{
  const harnesses = { remove: hooksHarness(), restore: hooksHarness(), list: hooksHarness(), purge: hooksHarness() }
  const draws = (name, fn) => { globalThis.__rbUiHooks = harnesses[name].hooks; return harnesses[name].render(fn) }
  const calls = { preview: [], remove: [], restore: [], purgePreview: [], purge: [], toast: [], done: 0, closed: 0, changed: 0 }
  let purgeAnswer = { data: { ok: true, reasons: [], code: "VCB-1", name: "Tower", removed_at: "2026-09-01T00:00:00Z", removed_by: "Ana", removal_reason: "Created twice", days_in_bin: 40, min_days: 30, contents: { plans: 1, pins: 2 } }, error: "", setup: false }
  let purgeDone = { data: { purged: true, code: "VCB-1", files_removed: 4, files_failed: 0 }, error: "", setup: false }
  let previewAnswer = { data: { id: "p1", code: "VCB-1", name: "Tower", archived: true, removed: false, contents: { plans: 2, pins: 5, evidence_pins: 1, team: 3, devices: 1, daily_reports: 4 } }, error: "", setup: false }
  let removeAnswer = { data: { removed: true, code: "VCB-1" }, error: "", setup: false }
  let restoreAnswer = { data: { restored: true, code: "VCB-1", code_changed: false, still_archived: true, inactive_members: 1, has_primary_manager: false }, error: "", setup: false }
  globalThis.__rbUiApi = {
    previewRemoval: async (id) => { calls.preview.push(id); return previewAnswer }, removeProject: async (input) => { calls.remove.push(input); return removeAnswer }, restoreProject: async (input) => { calls.restore.push(input); return restoreAnswer },
    previewPurge: async (id) => { calls.purgePreview.push(id); return purgeAnswer }, purgeProject: async (input) => { calls.purge.push(input); return purgeDone },
  }
  globalThis.__rbUiToast = { error: (...a) => calls.toast.push(["error", ...a]), success: (...a) => calls.toast.push(["success", ...a]) }
  const source = transpile("../src/pages/Admin/ProjectRecycleBin.tsx", {
    react: url("export const useState=(...a)=>globalThis.__rbUiHooks.useState(...a),useEffect=(...a)=>globalThis.__rbUiHooks.useEffect(...a);"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "../../components/Modal": url("export default function Modal(){return null}"), "../../components/ui/PageParts": url("export const buttonPrimary='primary',buttonSecondary='secondary',inputClass='input';"),
    "../../components/ui/Skeleton": url("export const Skeleton=function Skeleton(){return null};"), "../../lib/admin": url("export const formatDate=(x)=>x.slice(0,10),formatTime=(x)=>x.slice(11,16);"),
    "../../lib/recycleBin": url("export const previewRemoval=(...a)=>globalThis.__rbUiApi.previewRemoval(...a),removeProject=(...a)=>globalThis.__rbUiApi.removeProject(...a),restoreProject=(...a)=>globalThis.__rbUiApi.restoreProject(...a),previewPurge=(...a)=>globalThis.__rbUiApi.previewPurge(...a),purgeProject=(...a)=>globalThis.__rbUiApi.purgeProject(...a);"),
    "../../lib/recycleBinModel": fileUrl("../src/lib/recycleBinModel.ts"), "../../lib/toast": url("export const useToast=()=>globalThis.__rbUiToast;"),
  })
  const page = await import(url(source))
  const click = async (element) => { element.props.onClick(); await settle(); await settle() }
  const button = (tree, wording) => all(tree, (node) => node.type === "button" && text(node).includes(wording))[0]
  const input = (tree, label) => all(tree, (node) => (node.type === "input" || node.type === "textarea") && node.props["aria-label"] === label)[0]
  const textarea = (tree) => all(tree, (node) => node.type === "textarea")[0]

  // --- moving a project to the recycle bin
  const drawR = () => draws("remove", () => page.RemoveProjectModal({ project: { id: "p1", code: "VCB-1", name: "Tower" }, onClose: () => calls.closed++, onDone: () => calls.done++ }))
  let tree = drawR(); await settle(); tree = drawR()
  assert.deepEqual(calls.preview, ["p1"], "the contents are checked before anything is asked")
  assert.equal(tree.props.title, "Move VCB-1 to the recycle bin?"); assert.match(text(tree), /2 plans/); assert.match(text(tree), /5 pins \(1 with review or verification evidence\)/); assert.match(text(tree), /3 team members/)
  assert.match(text(tree), /Nothing is deleted|Every plan, pin, photo, report and audit entry is kept/); assert.match(text(tree), /Permanent deletion is not available here/); assert.match(text(tree), /Biometric devices on this project keep recording scans/)
  const confirmButton = () => button(tree, "Move to recycle bin")
  assert.equal(confirmButton().props.disabled, true, "off until a reason is given and the code is typed")
  textarea(tree).props.onChange({ target: { value: "no" } }); input(tree, "Project code").props.onChange({ target: { value: "VCB-1" } }); tree = drawR(); assert.equal(confirmButton().props.disabled, true, "a one-word reason is not enough")
  textarea(tree).props.onChange({ target: { value: "Created twice by mistake" } }); input(tree, "Project code").props.onChange({ target: { value: "vcb-1" } }); tree = drawR()
  assert.equal(confirmButton().props.disabled, true, "the code must match exactly"); assert.match(text(tree), /Type VCB-1 exactly/)
  await click(confirmButton()); assert.equal(calls.remove.length, 0, "even a click on the disabled button sends nothing")
  input(tree, "Project code").props.onChange({ target: { value: "VCB-1" } }); tree = drawR(); assert.equal(confirmButton().props.disabled, false)
  removeAnswer = { data: null, error: "Archive the project first. Only an archived project can be moved to the recycle bin", setup: false }
  await click(confirmButton()); tree = drawR(); assert.equal(calls.done, 0, "a refusal keeps the dialog open"); assert.deepEqual(calls.toast.at(-1), ["error", "Not removed", "Archive the project first. Only an archived project can be moved to the recycle bin"])
  removeAnswer = { data: { removed: true, code: "VCB-1" }, error: "", setup: false }
  await click(confirmButton())
  assert.deepEqual(calls.remove.at(-1), { projectId: "p1", reason: "Created twice by mistake", code: "VCB-1" }); assert.equal(calls.done, 1); assert.deepEqual(calls.toast.at(-1), ["success", "VCB-1 is in the recycle bin", "Nothing was deleted. You can restore it from the recycle bin."])

  // a project that is not archived is explained, and cannot be removed from here
  previewAnswer = { ...previewAnswer, data: { ...previewAnswer.data, archived: false } }
  harnesses.remove = hooksHarness(); tree = drawR(); await settle(); tree = drawR()
  assert.match(text(tree), /Archive the project first/); textarea(tree).props.onChange({ target: { value: "Created twice by mistake" } }); input(tree, "Project code").props.onChange({ target: { value: "VCB-1" } }); tree = drawR(); assert.equal(confirmButton().props.disabled, true)
  previewAnswer = { data: null, error: "Project not found", setup: false }
  harnesses.remove = hooksHarness(); tree = drawR(); await settle(); tree = drawR(); assert.match(text(tree), /Project not found/); assert.equal(confirmButton().props.disabled, true)

  // --- restoring
  const item = { id: "p1", code: "VCB-1", name: "Tower", removed_at: "2026-11-01T01:00:00Z", removed_by: "Ana", reason: "Created twice", archived_at: "2026-10-30T01:00:00Z", contents: parseContents({ pins: 5, plans: 1 }) }
  const drawS = () => draws("restore", () => page.RestoreProjectModal({ item, onClose: () => calls.closed++, onDone: () => calls.done++ }))
  tree = drawS()
  assert.equal(tree.props.title, "Restore VCB-1?"); assert.match(tree.props.description, /It comes back as an archived project/); assert.match(text(tree), /Removed 2026-11-01 01:00 by Ana/); assert.match(text(tree), /Reason: Created twice/); assert.match(text(tree), /5 pins/)
  assert.match(text(tree), /stays reserved while the project is in the recycle bin/)
  input(tree, "New project code").props.onChange({ target: { value: "bad code!" } }); tree = drawS(); assert.equal(button(tree, "Restore project").props.disabled, true); assert.match(text(tree), /2-30 characters/)
  input(tree, "New project code").props.onChange({ target: { value: "" } }); tree = drawS()
  restoreAnswer = { data: null, error: "The project code VCB-2 is now used by another project. Enter a new code to restore it", setup: false }
  input(tree, "New project code").props.onChange({ target: { value: "vcb-2" } }); tree = drawS(); const done = calls.done
  await click(button(tree, "Restore project")); assert.equal(calls.done, done); assert.deepEqual(calls.restore.at(-1), { projectId: "p1", newCode: "vcb-2" }); assert.match(calls.toast.at(-1)[2], /now used by another project/)
  restoreAnswer = { data: { restored: true, code: "VCB-1", code_changed: false, still_archived: true, inactive_members: 1, has_primary_manager: false }, error: "", setup: false }
  input(tree, "New project code").props.onChange({ target: { value: "" } }); tree = drawS()
  await click(button(tree, "Restore project"))
  assert.equal(calls.done, done + 1); assert.deepEqual(calls.restore.at(-1), { projectId: "p1", newCode: "" })
  assert.equal(calls.toast.at(-1)[1], "VCB-1 is restored"); assert.match(calls.toast.at(-1)[2], /archived project \(read-only\).*1 team member is no longer active.*no active primary Project Manager/)

  // --- the list
  const drawL = (props) => draws("list", () => page.default({ projects: [], loading: false, error: "", setup: false, onChanged: () => calls.changed++, ...props }))
  assert.match(text(drawL({ loading: true })), /^$/, "a skeleton while loading")
  assert.match(text(drawL({ setup: true })), /not installed on the database yet/)
  assert.match(text(drawL({ error: "Network problem." })), /Network problem\./)
  tree = drawL(); assert.match(text(tree), /The recycle bin is empty\./); assert.match(text(tree), /Nothing here expires, and nothing is deleted automatically/)
  tree = drawL({ projects: [item] })
  assert.match(text(tree), /VCB-1/); assert.match(text(tree), /Removed 2026-11-01 01:00 by Ana/); assert.match(text(tree), /Reason: Created twice/); assert.match(text(tree), /5 pins/)
  assert.equal(all(tree, (node) => node.type === "button" && node.props["aria-label"] === "Restore VCB-1").length, 1)
  assert.equal(all(tree, (node) => node.type === "button" && /forever/i.test(node.props["aria-label"] ?? "")).length, 0, "permanent deletion is not offered unless the person is a Super Admin")
  assert.ok(!/delete permanently|empty the bin/i.test(text(tree)))
  const superTree = drawL({ projects: [item], canPurge: true })
  assert.equal(all(superTree, (node) => node.type === "button" && node.props["aria-label"] === "Delete VCB-1 forever").length, 1, "a Super Admin gets the button"); assert.match(text(superTree), /once it has been here 30 days, but only if it holds no real records/)
  await click(all(tree, (node) => node.type === "button" && node.props["aria-label"] === "Restore VCB-1")[0]); tree = drawL({ projects: [item] })
  assert.equal(all(tree, (node) => typeof node.type === "function" && node.type.name === "RestoreProjectModal" && node.props.item.id === "p1").length, 1, "the restore dialog opens for that project")
  // --- deleting forever (Super Admin)
  const drawP = () => draws("purge", () => page.PurgeProjectModal({ item, onClose: () => calls.closed++, onDone: () => calls.done++ }))
  tree = drawP(); await settle(); tree = drawP()
  assert.deepEqual(calls.purgePreview, ["p1"], "the database is asked what blocks it before anything else"); assert.equal(tree.props.title, "Delete VCB-1 forever?")
  assert.match(text(tree), /40 days; the minimum is 30/); assert.match(text(tree), /It cannot be restored afterwards/); assert.match(text(tree), /audit log keeps who deleted it/)
  const purgeButton = () => button(tree, "Delete forever")
  assert.equal(purgeButton().props.disabled, true, "off until the phrase is typed")
  for (const wrong of ["delete forever vcb-1", "DELETE FOREVER", "VCB-1"]) { input(tree, "Confirmation phrase").props.onChange({ target: { value: wrong } }); tree = drawP(); assert.equal(purgeButton().props.disabled, true, wrong) }
  await click(purgeButton()); assert.equal(calls.purge.length, 0, "a click on the disabled button sends nothing")
  input(tree, "Confirmation phrase").props.onChange({ target: { value: "DELETE FOREVER VCB-1" } }); tree = drawP(); assert.equal(purgeButton().props.disabled, false)
  purgeDone = { data: null, error: "This project cannot be deleted forever: 1 daily report(s)", setup: false }
  const doneBefore = calls.done
  await click(purgeButton()); tree = drawP(); assert.equal(calls.done, doneBefore, "a refusal keeps the dialog open"); assert.deepEqual(calls.toast.at(-1), ["error", "Not deleted", "This project cannot be deleted forever: 1 daily report(s)"])
  purgeDone = { data: { purged: true, code: "VCB-1", files_removed: 4, files_failed: 0 }, error: "", setup: false }
  await click(purgeButton()); assert.deepEqual(calls.purge.at(-1), { projectId: "p1", phrase: "DELETE FOREVER VCB-1" }); assert.equal(calls.done, doneBefore + 1); assert.deepEqual(calls.toast.at(-1), ["success", "VCB-1 was deleted forever", "4 plan file(s) removed from storage."])
  // a project that cannot be deleted shows why and offers no phrase box
  purgeAnswer = { data: { ok: false, reasons: ["It must stay in the recycle bin for at least 30 days (12 more)", "2 daily report(s)"], code: "VCB-1", name: "Tower", removed_at: "2026-10-20T00:00:00Z", removed_by: "Ana", removal_reason: "Created twice", days_in_bin: 18, min_days: 30, contents: { daily_reports: 2 } }, error: "", setup: false }
  harnesses.purge = hooksHarness(); tree = drawP(); await settle(); tree = drawP()
  assert.match(text(tree), /It cannot be deleted forever/); assert.match(text(tree), /12 more/); assert.match(text(tree), /2 daily report\(s\)/); assert.match(text(tree), /still be restored/)
  assert.equal(all(tree, (node) => node.type === "input").length, 0, "no way to type past a block"); assert.equal(purgeButton().props.disabled, true)
  purgeAnswer = { data: null, error: "Only a Super Admin, signed in with the authenticator app, can delete a project forever.", setup: false }
  harnesses.purge = hooksHarness(); tree = drawP(); await settle(); tree = drawP(); assert.match(text(tree), /Only a Super Admin/); assert.equal(purgeButton().props.disabled, true)

  Object.values(harnesses).forEach((h) => h.unmount())
  for (const key of ["__rbUiHooks", "__rbUiApi", "__rbUiToast"]) delete globalThis[key]
}

// ---------------------------------------------------------------- the project page no longer deletes anything
{
  const page = readFileSync(new URL("../src/pages/Admin/ProjectManagement.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(page, /from\("projects"\)\.delete\(/, "no hard delete from the project page")
  assert.match(page, /RemoveProjectModal/); assert.match(page, /project\.archived_at && canUseBin/, "Remove is offered for archived projects only, and only to people who may use the bin")
  assert.match(page, /ProjectRecycleBin/); assert.match(page, /scopeLabels/)
  const everything = ["src/components/editor/BlueprintEditor.tsx", "src/pages/Admin/ProjectAccessDialog.tsx", "src/pages/Admin/ProjectManagement.tsx"].map((file) => readFileSync(new URL("../" + file, import.meta.url), "utf8")).join("\n")
  assert.doesNotMatch(everything, /from\("projects"\)\.delete/)
  const migration = readFileSync(new URL("../supabase/migrations/20261101180000_project_recycle_bin.sql", import.meta.url), "utf8")
  assert.doesNotMatch(migration, /^\s*(delete from|truncate|drop table)/mi, "the migration deletes nothing")
}

console.log("Recycle bin: rules, data layer, remove / restore / delete-forever dialogs with typed confirmation, the Edge Function's rules, the list and the project page passed")
