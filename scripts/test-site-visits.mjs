import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { visitDraftProblem, visitStamp, visitStatusLabels, visitStatusTone } from "../src/lib/siteVisitsModel.ts"
import { manilaToday, addDays } from "../src/lib/progress.ts"
import { fetchAll } from "../src/lib/paging.ts"

const fixedNow = Date.parse("2026-10-28T02:00:00Z")
const valid = { date: "2026-10-28", time: "11:00", purpose: "Review the floor finishes", visitors: 2 }
assert.equal(visitDraftProblem(valid, fixedNow), "")
assert.match(visitDraftProblem({ ...valid, time: "09:00" }, fixedNow), /future/)
assert.match(visitDraftProblem({ ...valid, date: "2026-02-30" }, fixedNow), /valid visit date/)
assert.match(visitDraftProblem({ ...valid, time: "24:00" }, fixedNow), /date and time/)
assert.match(visitDraftProblem({ ...valid, visitors: 1.5 }, fixedNow), /visitors/)
assert.match(visitDraftProblem({ ...valid, purpose: "    " }, fixedNow), /purpose/)
assert.match(visitStamp("2026-10-28T02:00:00Z"), /10:00/)

const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], effects = [], jobs = [], cursor = 0, tree
globalThis.__visitHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useRef(initial) { return slots[cursor++] ??= { current: initial } },
  useCallback(fn, deps) { const n = cursor++, old = slots[n]; if (!old || deps.some((value, i) => value !== old.deps[i])) slots[n] = { deps, fn }; return slots[n].fn },
  useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) jobs.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
}
const deps = globalThis.__visitDeps = {}
async function compile(file) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (declaration.importClause.name) exports.push(`export default function ${declaration.importClause.name.text}(){return null}`)
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      const dependency = `globalThis.${name === "react" ? "__visitHooks" : "__visitDeps"}.${key}`
      exports.push(`export const ${key}=typeof ${dependency} === "function" ? (...args)=>${dependency}(...args) : ${dependency}`)
    }
    output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(url(exports.join(";")))}`)
  }
  output = output.replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
  return import(url(output))
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected site visit control"); return node }
const reset = () => { effects.forEach(effect => effect?.cleanup?.()); slots = []; effects = []; jobs = [] }
const render = (Component, props) => { cursor = 0; tree = Component(props); const pending = jobs; jobs = []; pending.forEach(fn => fn()); return tree }
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const oldWindow = globalThis.window, oldDocument = globalThis.document
globalThis.window = { location: { search: "" }, addEventListener() {}, removeEventListener() {} }
globalThis.document = { getElementById: () => null }
let visits = [], writes = [], decisions = [], reloads = 0, confirmCancel = true, decisionResult = { data: [{ id: "visit" }], error: null }, finishRequest
const future = `${addDays(manilaToday(), 2)}T10:00:00+08:00`
const record = { id: "visit", project_id: "A", client_id: "client", preferred_at: future, created_at: new Date().toISOString(), visitors: 2, purpose: "Review lobby finishes", status: "requested", engineer_note: null }
Object.assign(deps, {
  visitDraftProblem, visitStamp, manilaToday,
  visitStatusLabels, visitStatusTone,
  useAuth: () => ({ profile: { id: "client" } }), useToast: () => ({ success() {} }), useConfirm: () => async () => confirmCancel,
  useSiteVisits: () => ({ visits, loading: false, error: "", reload: async () => { reloads++ } }),
  requestSiteVisit: async (project, draft) => { writes.push({ project, draft }); return new Promise(resolve => { finishRequest = resolve }) },
  decideSiteVisit: async (...args) => { decisions.push(args); return decisionResult },
})
const Panel = (await compile("../src/components/SiteVisitsPanel.tsx")).default
const clientProps = { projectId: "A", mode: "client" }, engineerProps = { projectId: "A", mode: "engineer", nameOf: () => "Client name" }
render(Panel, clientProps)
const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
submit(); render(Panel, clientProps); assert.match(text(tree), /Choose a visit date and time/); assert.equal(writes.length, 0)
for (const [label, value] of [["Preferred visit date", addDays(manilaToday(), 2)], ["Preferred visit time", "10:00"], ["Purpose of visit", "Review lobby finishes"], ["Number of visitors", "2"]]) {
  find(node => node.props?.["aria-label"] === label).props.onChange({ target: { value } }); render(Panel, clientProps)
}
submit(); submit(); assert.equal(writes.length, 1, "Repeated click cannot duplicate the request")
assert.equal(writes[0].project, "A"); assert.equal(writes[0].draft.visitors, 2)
finishRequest({ data: { id: "visit" }, error: null }); await settle(); render(Panel, clientProps)
assert.equal(reloads, 1); assert.equal(find(node => node.props?.["aria-label"] === "Purpose of visit").props.value, "")
visits = [record, { ...record, id: "someone-else", client_id: "another-client", purpose: "Private other client visit" }, { ...record, id: "foreign", project_id: "B", purpose: "Foreign project visit" }]
reset(); render(Panel, clientProps)
assert.match(text(tree), /Review lobby finishes/); assert.doesNotMatch(text(tree), /Private other client visit|Foreign project visit/)
confirmCancel = false
find(node => node.type === "button" && text(node) === "Cancel visit").props.onClick(); await settle()
assert.equal(decisions.length, 0)
confirmCancel = true
find(node => node.type === "button" && text(node) === "Cancel visit").props.onClick(); await settle()
assert.equal(decisions[0][1], "cancelled")
visits = [record]
reset(); render(Panel, engineerProps)
assert.ok(!all(tree).some(node => node.type === "form"), "Engineer responds instead of creating a client request")
find(node => node.type === "button" && text(node) === "Decline").props.onClick(); await settle(); render(Panel, engineerProps)
assert.match(text(tree), /Add a message/); assert.equal(decisions.length, 1)
find(node => node.type === "textarea").props.onChange({ target: { value: "Please meet at the main gate" } }); render(Panel, engineerProps)
find(node => node.type === "button" && text(node) === "Confirm visit").props.onClick(); await settle()
assert.equal(decisions[1][0].id, record.id); assert.equal(decisions[1][1], "confirmed")
decisionResult = { data: [], error: null }
render(Panel, engineerProps); find(node => node.type === "button" && text(node) === "Confirm visit").props.onClick(); await settle(); render(Panel, engineerProps)
assert.match(text(tree), /request changed or is no longer available/)

// Canonical writes preserve timezone, project/record IDs and expected status for concurrent decisions.
let mutation
const query = {
  insert(payload) { mutation = { payload }; return query }, update(payload) { mutation = { payload, filters: [] }; return query },
  eq(...filter) { mutation.filters.push(filter); return query }, select() { return query }, single: async () => ({ data: { id: "saved" }, error: null }),
}
Object.assign(deps, { fetchAll, supabase: { from(table) { assert.equal(table, "site_visit_requests"); return query } }, byProject: () => [], useLiveReload() {}, usePeriodicReload() {} })
const api = await compile("../src/lib/siteVisits.ts")
await api.requestSiteVisit("A", valid)
assert.equal(mutation.payload.preferred_at, "2026-10-28T11:00:00+08:00")
assert.ok(!("client_id" in mutation.payload) && !("status" in mutation.payload))
await api.decideSiteVisit(record, "confirmed", " Meet at gate ")
assert.deepEqual(mutation.filters, [["project_id", "A"], ["id", "visit"], ["status", "requested"]])
await api.decideSiteVisit(record, "cancelled")
assert.deepEqual(mutation.payload, { status: "cancelled" }, "Cancellation never overwrites the engineer response")

// Reads are project-scoped, paged and immune to late results from a previous project.
let pages = [], reads = [], resolveOld
deps.fetchAll = fetchAll
deps.supabase.from = () => {
  let project
  const read = { select: () => read, eq(_column, value) { project = value; return read }, order: () => read,
    range(from, to) { reads.push({ project, from, to }); return pages.shift() ?? Promise.resolve({ data: [], error: null }) } }
  return read
}
reset()
pages = [Promise.resolve({ data: Array.from({ length: 1000 }, () => record), error: null }), Promise.resolve({ data: [{ ...record, id: "last" }], error: null })]
render(api.useSiteVisits, "A"); await settle(); render(api.useSiteVisits, "A")
assert.equal(tree.visits.length, 1001); assert.deepEqual(reads.map(read => read.project), ["A", "A"])
pages = [new Promise(resolve => { resolveOld = resolve })]
const oldRead = tree.reload()
pages = [Promise.resolve({ data: [{ ...record, project_id: "B", id: "project-b" }], error: null })]
render(api.useSiteVisits, "B"); assert.deepEqual(tree.visits, []); assert.equal(tree.loading, true)
await settle(); render(api.useSiteVisits, "B"); assert.equal(tree.visits[0].id, "project-b")
resolveOld({ data: [record], error: null }); await oldRead; render(api.useSiteVisits, "B")
assert.equal(tree.visits[0].project_id, "B", "Late A response never replaces B")
pages = [Promise.resolve({ data: null, error: { message: "offline" } })]
await tree.reload(); render(api.useSiteVisits, "B"); assert.deepEqual(tree.visits, []); assert.match(tree.error, /Could not load/)
const beforeNull = reads.length
render(api.useSiteVisits, null); await settle(); render(api.useSiteVisits, null)
assert.deepEqual(tree.visits, []); assert.equal(tree.loading, false); assert.equal(reads.length, beforeNull)
reset(); globalThis.window = oldWindow; globalThis.document = oldDocument
delete globalThis.__visitHooks; delete globalThis.__visitDeps
console.log("Site visits: Manila dates/validation, scoped request history, duplicate-click prevention, canonical writes, Engineer response, cancellation, stale decisions and existing Communication tab integration passed")
