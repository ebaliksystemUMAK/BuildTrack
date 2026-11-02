import assert from "node:assert/strict"
import { AUDIT_CSV_HEADER, AUDIT_EXPORT_MAX, auditActionLabel, auditCsvRows, auditDetails, auditDetailsText, auditExportName, auditExportRecords, auditJson, collectAuditPages } from "../src/lib/auditLogModel.ts"
import { toCsv } from "../src/lib/progress.ts"
import { readFileSync } from "node:fs"
import ts from "typescript"

const foreman = "11111111-1111-1111-1111-111111111111", engineer = "22222222-2222-2222-2222-222222222222"
const entry = (details, context = {}, action = "pins.update") => ({ action, target_name: null, summary: JSON.stringify({ version: 1, details, context }) })
const context = { subject: "DINING AREA", project: "TST-002 · Testing BuildTrack", pin: "DINING AREA", references: { [foreman]: "Gilbert Armillo Jr.", [engineer]: "Armillo Armillo" } }
const change = entry({ before: { title: "DINING AREA", x: 12, assigned_to: foreman, updated_at: "2026-10-31T00:00:00Z" }, row: { title: "DINING AREA", x: 22, assigned_to: engineer, updated_at: "2026-11-01T00:00:00Z" } }, context)
assert.deepEqual(auditDetails(change).fields, [{ label: "Position X (%)", before: "12", value: "22" }, { label: "Assigned to", before: "Gilbert Armillo Jr.", value: "Armillo Armillo" }])
assert.equal(auditDetails(change).changes, true)
assert.match(auditDetails(change).summary, /Gilbert Armillo Jr. → Armillo Armillo/)

const remarks = 'Actual remark with "quotes", commas\nand lines. '.repeat(40) + "FINAL RECORDED SENTENCE"
const snapshot = entry({ row: { title: "DINING AREA", status: "in_progress", remarks, submitted_by: foreman, checklist_snapshot: [{ text: "Floor finish", done: true, review_status: "approved" }] } }, context, "pin_qa_submissions.insert")
assert.equal(auditDetails(snapshot).about, "DINING AREA")
assert.equal(auditDetails(snapshot).changes, false)
assert.ok(auditDetailsText(snapshot).includes(remarks))
assert.match(auditDetailsText(snapshot), /Task: Floor finish; QC complete: Yes; QA status: Approved/)
assert.ok(!auditDetailsText(snapshot).includes('{"'))
const csv = toCsv(["Details"], [[auditDetailsText(snapshot)]])
assert.ok(csv.includes('""quotes""')); assert.ok(csv.includes("FINAL RECORDED SENTENCE"))

const photo = entry({ before: "company", after: "allow" }, {}, "photos.account_rule")
photo.target_name = "TESTING FOREMAN"
assert.equal(auditDetails(photo).summary, "Photo rule: Both → Allow uploads")
assert.equal(auditDetails(photo).about, "TESTING FOREMAN")
const legacy = { action: "pins.update", target_name: null, summary: JSON.stringify({ row: { title: "Original pin name", status: "verified", remarks: "Actual old remark" } }) }
assert.equal(auditDetails(legacy).changes, false)
assert.equal(auditDetails(legacy).about, "Original pin name")
assert.match(auditDetails(legacy).summary, /Status: Completed/)
assert.match(auditDetails({ ...legacy, summary: '{"row":{"id":' }).summary, /incomplete/)
assert.equal(auditDetails({ ...legacy, summary: "Saved plain-text detail" }).summary, "Saved plain-text detail")
assert.match(auditDetailsText(entry({ row: { assigned_to: foreman } })), /name unavailable/)
assert.ok(!auditDetailsText(entry({ row: { password: "hidden", extra: { access_token: "hidden", note: "Visible" } } })).includes("hidden"))
assert.equal(auditActionLabel("pins.update"), "Updated pin")
assert.equal(auditActionLabel("qa_work_attempts.update"), "Updated task correction")
assert.equal(auditActionLabel("photos.account_rule"), "Changed account photo rule")
assert.equal(auditActionLabel("new_entity.new_action"), "New entity · new action")
assert.deepEqual(auditDetails(entry({ before: false, after: true, key: "photos.allow_device_upload" }, {}, "settings.update")).fields[0], { label: "photos.allow_device_upload", before: "No", value: "Yes" })

// Export: allow-listed columns, no secrets, spreadsheet formulas stay text, JSON states its scope, paging is capped and de-duplicated.
const hostile = { id: 1, created_at: "2026-11-01T00:00:00Z", actor_name: "=HYPERLINK(\"http://evil.test\",\"x\")", actor_email: "+cmd@example.test", action: "pins.update", target_name: "@SUM(A1)", summary: JSON.stringify({ details: { before: { title: "-1+1" }, row: { title: "\t=1+1", password: "hidden", access_token: "hidden", id_number: "hidden-id", note: "ok" } }, context: { subject: "-2+3" } }), internal_only: "must not be exported" }
const records = auditExportRecords([hostile], auditActionLabel)
assert.deepEqual(Object.keys(records[0]), ["when_utc", "who", "email", "action", "action_code", "about", "details"])
assert.ok(!JSON.stringify(records).includes("must not be exported") && !JSON.stringify(records).includes("hidden"))
const hostileCsv = toCsv(AUDIT_CSV_HEADER, auditCsvRows(records))
assert.equal(hostileCsv.split("\r\n")[0], "When (UTC),Who,Email,Action,About,Details")
assert.ok(hostileCsv.includes('"\'=HYPERLINK(""'), "formula in the name stays text"); assert.ok(hostileCsv.includes("'+cmd@example.test")); assert.ok(hostileCsv.includes("'@SUM(A1)"))
for (const lead of ["=", "+", "-", "@", "\t", "\r"]) assert.ok(toCsv(["x"], [[lead + "1+1"]]).split("\r\n")[1].replace(/^"/, "").startsWith("'" + lead), "leading " + JSON.stringify(lead))
assert.equal(toCsv(["x"], [["plain, text"]]).split("\r\n")[1], '"plain, text"')
assert.equal(auditExportRecords([{ ...hostile, summary: "x".repeat(40000) }], auditActionLabel)[0].details.length < 30100, true, "very long details are shortened")
assert.equal(auditExportRecords([{ ...hostile, actor_email: null }], auditActionLabel)[0].email, "")
const json = JSON.parse(auditJson(records, { scope: "filtered", filters: { search: " bob ", action: "", from: "2026-10-01", to: "" }, truncated: true, exportedAt: "2026-11-01T01:00:00Z" }))
assert.equal(json.count, 1); assert.equal(json.truncated, true); assert.equal(json.max_rows, AUDIT_EXPORT_MAX); assert.match(json.scope, /matching the filters/)
assert.deepEqual(json.filters, { search: "bob", action: null, from_date_manila: "2026-10-01", to_date_manila: null })
assert.equal(JSON.parse(auditJson([], { scope: "loaded", filters: { search: "", action: "", from: "", to: "" }, truncated: false, exportedAt: "x" })).max_rows, null)
assert.equal(auditExportName("loaded", "csv", "2026-11-01"), "audit-log-loaded-2026-11-01.csv")
assert.equal(auditExportName("filtered", "json", "2026-11-01", true), "audit-log-filtered-newest-5000-2026-11-01.json")
const pageCalls = []
const fakePage = total => async (offset, limit) => { pageCalls.push([offset, limit]); return Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: offset + i })) }
assert.deepEqual(await collectAuditPages(fakePage(0), { pageSize: 10, max: 30 }), { rows: [], truncated: false })
assert.equal((await collectAuditPages(fakePage(25), { pageSize: 10, max: 30 })).rows.length, 25)
const capped = await collectAuditPages(fakePage(100), { pageSize: 10, max: 30 })
assert.equal(capped.rows.length, 30); assert.equal(capped.truncated, true)
assert.equal((await collectAuditPages(fakePage(30), { pageSize: 10, max: 30 })).truncated, true, "a full last page may hide more, so it is reported as capped")
const shifting = await collectAuditPages(async offset => offset === 0 ? [{ id: 1 }, { id: 2 }] : offset === 2 ? [{ id: 2 }, { id: 3 }] : [], { pageSize: 2, max: 10 }) // a new entry moved row 2 to the next page
assert.deepEqual(shifting.rows.map(row => row.id), [1, 2, 3])
await assert.rejects(collectAuditPages(async () => { throw new Error("rpc failed") }), /rpc failed/)

// Exercise the actual page with delayed RPC responses, pagination, filters, dialog and CSV.
const url = code => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
let state = [], effects = [], cursor = 0, pending = [], requests = [], timers = new Map(), nextTimer = 0, exports = []
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
globalThis.__auditHooks = {
  useState(initial) { const n = cursor++; if (!(n in state)) state[n] = initial; return [state[n], value => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
  useRef(initial) { const n = cursor++; return state[n] ??= { current: initial } },
  useCallback(fn, deps) { const n = cursor++; if (!same(state[n]?.deps, deps)) state[n] = { deps, fn }; return state[n].fn },
  useEffect(fn, deps) { const n = cursor++; if (!same(effects[n]?.deps, deps)) pending.push(() => { effects[n]?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
}
globalThis.__auditDB = { rpc(name, args) { assert.equal(name, "get_audit_log"); return new Promise(resolve => requests.push({ args, resolve })) } }
globalThis.__auditExport = (name, csv) => exports.push({ name, csv })
globalThis.__auditText = (name, text, type) => exports.push({ name, text, type })
const previousWindow = globalThis.window
globalThis.window = { setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) } }
const replacements = {
  react: url("export const {useState,useRef,useEffect,useCallback}=globalThis.__auditHooks;"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "../../components/Modal": url("export default function Modal(){}"),
  "../../components/ui/PageParts": url("export function EmptyState(){}; export const buttonSecondary='button',inputClass='input';"),
  "../../components/ui/Skeleton": url("export function SkeletonRows(){}"),
  "../../lib/admin": url(`import {auditActionLabel} from ${JSON.stringify(new URL("../src/lib/auditLogModel.ts", import.meta.url).href)}; export const activityLabel=auditActionLabel,formatDate=x=>x,formatTime=x=>x;`),
  "../../lib/auditLogModel": new URL("../src/lib/auditLogModel.ts", import.meta.url).href,
  "../../lib/progress": url(`export {toCsv} from ${JSON.stringify(new URL("../src/lib/progress.ts", import.meta.url).href)};export const downloadCsv=globalThis.__auditExport,downloadText=globalThis.__auditText;`),
  "../../lib/supabase": url("export const supabase=globalThis.__auditDB;"),
  "../../lib/toast": url("const toast={success(){},error(){}};export const useToast=()=>toast;"),
  "./AdminShell": url("export function PageIntro(){};export function Panel(){};"),
}
let source = ts.transpileModule(readFileSync(new URL("../src/pages/Admin/AuditLog.tsx", import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
const Page = (await import(url(source))).default
const render = () => { cursor = 0; const tree = Page({}); const work = pending; pending = []; work.forEach(fn => fn()); return tree }
const tick = async () => { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)) }
const nodes = node => !node ? [] : Array.isArray(node) ? node.flatMap(nodes) : typeof node === "object" ? [node, ...nodes(node.props?.children), ...nodes(node.props?.action), ...nodes(node.props?.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node)
const buttons = tree => nodes(tree).filter(node => node.type === "button")
const settle = () => new Promise(resolve => setImmediate(resolve))
let tree = render(); await tick()
assert.equal(requests[0].args.p_offset, 0)
const rows = Array.from({ length: 100 }, (_, i) => ({ ...snapshot, id: i + 1, created_at: "2026-11-01T00:00:00Z", actor_name: "Gilbert Armillo Jr.", actor_email: "gilbert@example.test" }))
requests.shift().resolve({ data: rows, error: null }); await settle(); tree = render()
assert.ok(text(tree).includes("Status: In progress"))
buttons(tree).find(button => button.props.children === "View details").props.onClick(); tree = render()
assert.ok(text(tree).includes(remarks), "dialog must contain the complete recorded remark")
assert.ok(text(tree).includes("Recorded values"))
buttons(tree).find(button => button.props.children === "Close").props.onClick(); tree = render()
buttons(tree).find(button => button.props.children === "Export loaded entries (CSV)").props.onClick()
assert.ok(exports[0].csv.includes("FINAL RECORDED SENTENCE"))
assert.ok(exports[0].csv.includes("TST-002 · Testing BuildTrack"))
assert.match(exports[0].name, /^audit-log-loaded-\d{4}-\d{2}-\d{2}\.csv$/)
// Export all matching: reads 500 at a time with a fixed end time, drops a repeated row and names the file as a filtered export.
buttons(tree).find(button => button.props.children === "Export all matching (CSV)").props.onClick()
assert.equal(requests[0].args.p_offset, 0); assert.equal(requests[0].args.p_limit, 500); assert.ok(requests[0].args.p_to, "the export has a fixed end time")
const endTime = requests[0].args.p_to
requests.shift().resolve({ data: Array.from({ length: 500 }, (_, i) => ({ ...rows[0], id: 1000 + i })), error: null }); await settle()
assert.equal(requests[0].args.p_offset, 500); assert.equal(requests[0].args.p_to, endTime)
requests.shift().resolve({ data: [{ ...rows[0], id: 1000 }, { ...rows[0], id: 2000 }], error: null }); await settle()
assert.equal(exports.length, 2); assert.match(exports[1].name, /^audit-log-filtered-\d{4}-\d{2}-\d{2}\.csv$/)
assert.equal(exports[1].csv.split("\r\n").length, 1 + 501, "header, 500 rows and one new row; the repeated id is dropped")
tree = render()
// JSON export of the loaded rows carries its scope and only the allow-listed fields.
nodes(tree).find(node => node.type === "select" && node.props["aria-label"] === "Export format").props.onChange({ target: { value: "json" } }); tree = render()
buttons(tree).find(button => button.props.children === "Export loaded entries (JSON)").props.onClick()
const jsonExport = JSON.parse(exports[2].text); assert.equal(exports[2].type, "application/json"); assert.match(exports[2].name, /^audit-log-loaded-.*\.json$/)
assert.equal(jsonExport.count, 100); assert.deepEqual(Object.keys(jsonExport.entries[0]), ["when_utc", "who", "email", "action", "action_code", "about", "details"])
nodes(tree).find(node => node.type === "select" && node.props["aria-label"] === "Export format").props.onChange({ target: { value: "csv" } }); tree = render()
buttons(tree).find(button => button.props.children === "Load older entries").props.onClick()
assert.equal(requests[0].args.p_offset, 100)
const oldPage = requests.shift()
nodes(tree).find(node => node.type === "input" && node.props.placeholder).props.onChange({ target: { value: "Changed filter" } })
render(); await tick()
oldPage.resolve({ data: [{ ...rows[0], id: 999, actor_name: "STALE ACCOUNT" }], error: null }); await settle()
requests.shift().resolve({ data: [{ ...rows[0], id: 200, actor_name: "MATCHED ACCOUNT" }], error: null }); await settle(); tree = render()
assert.ok(!text(tree).includes("STALE ACCOUNT")); assert.ok(text(tree).includes("MATCHED ACCOUNT"))
const dates = nodes(tree).filter(node => node.type === "input" && node.props.type === "date")
dates[0].props.onChange({ target: { value: "2026-10-31" } }); dates[1].props.onChange({ target: { value: "2026-11-01" } })
render(); await tick()
assert.equal(requests[0].args.p_from, "2026-10-30T16:00:00.000Z")
assert.equal(requests[0].args.p_to, "2026-11-01T16:00:00.000Z")
requests.shift().resolve({ data: null, error: { message: "Missing permission: users.view" } }); await settle(); tree = render()
assert.match(text(tree), /View users permission/)
effects.forEach(effect => effect?.cleanup?.())
globalThis.window = previousWindow
for (const key of ["__auditHooks", "__auditDB", "__auditExport", "__auditText"]) delete globalThis[key]
console.log("Audit log: actual changes, legacy history, full details, names, CSV, dialog, filters, pagination and stale responses passed")
