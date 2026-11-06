import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"

// Exercise the actual form's create/assignment sequence without writing to a real project.
const source = readFileSync(new URL("../src/pages/Admin/ProjectManagement.tsx", import.meta.url), "utf8")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
const component = name => Object.defineProperty(() => null, "name", { value: name })
const manager = { id: "pm-1", full_name: "Ana Manager", email: "ana@example.test" }

async function scenario({ selectManager = true, failAssignment = false } = {}) {
  const states = [], effects = [], writes = [], assignments = [], successes = []
  let cursor = 0, mounted = false, tree, assignmentFails = failAssignment
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value }]
    },
    useEffect(fn) { if (!mounted) effects.push(fn) },
    useCallback: fn => fn,
    useMemo: fn => fn(),
  }
  const jsx = (type, props) => ({ type, props: props || {} })
  const reload = async () => {}
  const query = table => {
    let operation = "read", patch, role
    const builder = {
      select() { return builder },
      in() { return builder },
      eq(key, value) { if (key === "role") role = value; return builder },
      order() { return builder },
      insert(value) { operation = "insert"; patch = value; return builder },
      update(value) { operation = "update"; patch = value; return builder },
      then(resolve, reject) {
        if (table === "projects" && operation !== "read") {
          writes.push({ operation, patch })
          return Promise.resolve({ data: [{ id: "project-1" }], error: null }).then(resolve, reject)
        }
        return Promise.resolve({ data: table === "profiles" && role === "project_manager" ? [manager] : [], error: null }).then(resolve, reject)
      },
    }
    return builder
  }
  const modules = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "../../lib/auth": { useAuth: () => ({ profile: { role: "admin" }, can: () => true }) },
    "../../lib/projects": { useProjects: () => ({ projects: [], loading: false, error: "", reload }), disciplineLabels: {}, statusLabels: {}, rememberProject() {}, openProject() {} },
    "../../lib/projectManagers": {
      useProjectManagers: () => ({ managers: [], reload }),
      assignProjectManager: async (...args) => { assignments.push(args); if (assignmentFails) throw new Error("Connection interrupted") },
    },
    "../../lib/projectManagerModel": { slotsOf: () => ({ primary: null, backup: null }) },
    "../../lib/recycleBin": { useRecycleBin: () => ({ projects: [], reload }) },
    "../../lib/recycleBinModel": { scopeCounts: () => ({}), scopeLabels: {}, inScope: () => true },
    "../../lib/confirm": { useConfirm: () => async () => true },
    "../../lib/toast": { useToast: () => ({ success: message => successes.push(message), error() {} }) },
    "../../lib/supabase": { supabase: { from: query } },
    "./AdminShell": { AdminButton: component("AdminButton"), PageIntro: component("PageIntro") },
    "../../components/ui/PageParts": { buttonPrimary: "primary", buttonSecondary: "secondary" },
    "../../components/ui/Skeleton": { SkeletonCardGrid: component("SkeletonCardGrid") },
  }
  const output = { exports: {} }
  new Function("require", "exports", compiled)(name => modules[name] || { default: component(name) }, output.exports)
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : []
  const render = () => { cursor = 0; tree = output.exports.default({ onNavigate() {} }); mounted = true }
  const text = node => Array.isArray(node) ? node.map(text).join("") : node && typeof node === "object" ? text(node.props?.children) : String(node ?? "")
  const find = predicate => { const node = nodes(tree).find(predicate); assert.ok(node, "Expected control missing"); return node }
  const settle = () => new Promise(resolve => setImmediate(resolve))
  render()
  effects.forEach(fn => fn())
  await settle()
  render()
  find(node => node.type?.name === "PageIntro").props.action.props.onClick()
  render()
  for (const [placeholder, value] of [["VCB-024", "TEST-01"]]) {
    find(node => node.type === "input" && node.props.placeholder === placeholder).props.onChange({ target: { value } })
    render()
  }
  const nameLabel = find(node => node.type === "label" && text(node).includes("Project name *"))
  nodes(nameLabel).find(node => node.type === "input").props.onChange({ target: { value: "Test project" } })
  render()
  if (selectManager) {
    const select = find(node => node.type === "select" && nodes(node).some(child => child.type === "option" && child.props.value === manager.id))
    assert.equal(select.props.disabled, false)
    select.props.onChange({ target: { value: manager.id } })
    render()
  }
  const submit = async () => {
    find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
    await settle()
    render()
  }
  await submit()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].operation, "insert")
  if (selectManager) assert.deepEqual(assignments[0], ["project-1", "pm-1", "primary"])
  else assert.equal(assignments.length, 0)
  if (failAssignment) {
    assert.match(text(tree), /Project created, but its Project Manager could not be assigned/)
    assert.match(text(tree), /Retry save/)
    assert.equal(successes.length, 0)
    assignmentFails = false
    await submit()
    assert.deepEqual(writes.map(write => write.operation), ["insert", "update"], "Retry must not create a second project")
    assert.equal(assignments.length, 2)
  }
  assert.equal(successes.length, 1)
  assert.ok(!nodes(tree).some(node => node.type === "form"), "Successful save closes the form")
}

await scenario()
await scenario({ selectManager: false })
await scenario({ failAssignment: true })
console.log("Project creation: primary PM assignment, assign-later and retry without duplicate creation passed")
