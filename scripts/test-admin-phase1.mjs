import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

// Error isolation: a failing panel shows a small inline message, the page-level fallback is unchanged, and the Admin pages wrap their independent sections.
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
let source = ts.transpileModule(readFileSync(new URL("../src/components/ErrorBoundary.tsx", import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
source = source.replaceAll('from "react"', `from ${JSON.stringify(import.meta.resolve("react"))}`).replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}`)
const ErrorBoundary = (await import(url(source))).default

const text = (node) => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node)
const find = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)]
const mounted = (props) => { const boundary = new ErrorBoundary(props); boundary.setState = (next) => { boundary.state = { ...boundary.state, ...next } }; return boundary }

{
  const boundary = mounted({ children: "panel content", compact: true, label: "Project health" })
  assert.equal(boundary.render(), "panel content", "children show while nothing failed")
  boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("boom"))
  const tree = boundary.render()
  assert.equal(tree.props.role, "alert")
  assert.match(text(tree), /Project health could not be shown\./)
  assert.match(text(tree), /rest of the page still works/)
  assert.doesNotMatch(text(tree), /Something went wrong|Start page/, "the compact message is not the full-page screen")
  assert.equal(find(tree, (node) => node.type === "h1").length, 0, "a panel never adds a second page heading")
  find(tree, (node) => node.type === "button")[0].props.onClick()
  assert.equal(boundary.render(), "panel content", "Try again shows the panel again")
}
{
  const boundary = mounted({ children: "x", compact: true })
  boundary.state = { error: new Error("boom") }
  assert.match(text(boundary.render()), /^This section could not be shown\./)
}
{
  // The page-level fallback keeps its text and actions.
  const page = mounted({ children: "x" })
  page.state = { error: new Error("boom") }
  assert.match(text(page.render()), /Something went wrong/)
  assert.equal(find(page.render(), (node) => node.type === "h1").length, 1)
  page.state = { error: new Error("Failed to fetch dynamically imported module: /assets/x.js") }
  assert.match(text(page.render()), /A newer version is available/)
  // Moving to another screen clears an old error (resetKey), for compact boundaries too.
  const keyed = mounted({ children: "x", compact: true, resetKey: "b" })
  keyed.state = { error: new Error("boom") }
  keyed.componentDidUpdate({ resetKey: "a" })
  assert.equal(keyed.state.error, null)
  keyed.state = { error: new Error("boom") }
  keyed.componentDidUpdate({ resetKey: "b" })
  assert.ok(keyed.state.error, "no reset while the key is unchanged")
}
{
  // The error is still reported to the hook, whichever mode is used.
  const events = []
  const originalError = console.error, originalWindow = globalThis.window
  console.error = () => {}
  globalThis.window = { dispatchEvent: (event) => events.push(event) }
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail } }
  mounted({ children: "x", compact: true }).componentDidCatch(new Error("boom"), { componentStack: "stack" })
  console.error = originalError; globalThis.window = originalWindow; delete globalThis.CustomEvent
  assert.equal(events[0].type, "buildtrack:error"); assert.equal(events[0].detail.message, "boom")
}

// Independent sections of the Admin pages are wrapped, the whole page is not replaced.
const dashboard = readFileSync(new URL("../src/pages/Admin/AdminDashboard.tsx", import.meta.url), "utf8")
const users = readFileSync(new URL("../src/pages/Admin/UserManagement.tsx", import.meta.url), "utf8")
assert.match(dashboard, /<ErrorBoundary compact label="Project health"><ProjectHealth /s)
for (const section of ["PermissionMatrix", "DataRequestsPanel", "ReviewQueue"]) assert.match(users, new RegExp(`<ErrorBoundary compact label="[^"]+"><${section} `), section + " is isolated")

console.log("Admin phase 1: compact error boundary, unchanged page fallback, reset on navigation, error reporting and wrapped admin sections passed")
