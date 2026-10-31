import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

// Exercise the real paginated progress read with a local Data API double; no production data or credentials.
const tasks = Array.from({ length: 1005 }, (_, i) => ({ id: String(i).padStart(4, "0"), project_id: "P", pin_id: "pin", text: `Task ${i}`, done: i < 750, review_status: i < 750 ? "verified" : "for_review", verified_at: null }))
tasks.push({ ...tasks[0], id: "foreign", project_id: "Q", pin_id: "other" })
const queries = []
let failAt = -1, throwQuery = false
globalThis.__progressDb = {
  from(table) {
    assert.equal(table, "pin_checklist_items")
    const request = { fields: "", filters: [] }
    return {
      select(fields) { request.fields = fields; return this },
      eq(key, value) { request.filters.push([key, value]); return this },
      order(key) { assert.equal(key, "id"); return this },
      async range(from, to) {
        queries.push({ ...request, from, to })
        if (throwQuery) throw new Error("Disconnected")
        if (from === failAt) return { data: null, error: { message: "Unavailable" } }
        return { data: tasks.filter(task => request.filters.every(([key, value]) => task[key] === value)).slice(from, to + 1), error: null }
      },
    }
  },
}
let source = ts.transpileModule(readFileSync(new URL("../src/lib/progressData.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
source = source.replace('from "./paging"', `from ${JSON.stringify(new URL("../src/lib/paging.ts", import.meta.url).href)}`)
source = source.replace('import { supabase } from "./supabase";', "const supabase = globalThis.__progressDb;")
const { fetchProgressPins } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))
const pins = [{ id: "pin" }, { id: "empty" }]
const page = async (from, to) => ({ data: pins.slice(from, to + 1), error: null })
const result = await fetchProgressPins(page, "P")
assert.equal(result.error, false)
assert.equal(result.data[0].tasks.length, 1005, "Tasks beyond the first Data API page remain in the denominator")
assert.deepEqual(result.data[1].tasks, [], "A pin without tasks earns no task progress")
assert.deepEqual(queries.map(query => [query.from, query.to]), [[0, 999], [1000, 1999]])
assert.ok(queries.every(query => query.fields === "id,pin_id,text,done,review_status,verified_at,created_at" && query.filters.some(([key, value]) => key === "project_id" && value === "P")))
failAt = 1000
assert.deepEqual(await fetchProgressPins(page, "P"), { data: [], error: true }, "Partial task reads must not produce plausible but incorrect percentages")
failAt = -1; throwQuery = true
assert.deepEqual(await fetchProgressPins(page, "P"), { data: [], error: true }, "Connection failures surface as unavailable progress")
throwQuery = false
const portfolio = await fetchProgressPins(async () => ({ data: [{ id: "pin" }, { id: "other" }], error: null }), null)
assert.equal(portfolio.data[0].tasks.length, 1005)
assert.deepEqual(portfolio.data[1].tasks.map(task => task.id), ["foreign"], "Admin portfolio tasks stay attached to their own pin")
for (let i = tasks.length; i < 50002; i++) tasks.push({ ...tasks[0], id: `extra-${i}`, project_id: "P" })
assert.deepEqual(await fetchProgressPins(page, "P"), { data: [], error: true }, "Exceeding the row cap must not silently report a partial denominator")
console.log("Progress data: project scope, separate task pagination past 1,000 rows, empty pins, failures, row-cap guard and portfolio pin isolation passed")
