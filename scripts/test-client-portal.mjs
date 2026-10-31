import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import ts from "typescript"
import { clientPinStatus, reportsForPin, clientActionPath, clientPinPath } from "../src/lib/clientPortalModel.ts"
import { issuePhotoProblem, markupProblem } from "../src/lib/issueMarkup.ts"
import { pinSectionsFor, readPinSection, sectionLabel } from "../src/lib/pinRecordsModel.ts"
import { pinLinkProblem, startPinLink } from "../src/lib/pinPickerModel.ts"
import { inRange, isFiltered, rangeText } from "../src/lib/dateRangeModel.ts"

const report = (id, project_id = "A", status = "submitted", links = [{ pin_id: "pin", item_id: "floor" }]) => ({ id, project_id, status, linked_work: links, report_date: "2026-10-21", work_done: id, author_id: "foreman", workers_count: 4, weather: "sunny" })
const records = [report("visible"), report("draft", "A", "draft"), report("foreign", "B"), report("unlinked", "A", "submitted", [])]
assert.deepEqual(reportsForPin(records, "A", "pin").map(row => row.id), ["visible"])
assert.equal(clientPinStatus("for_review"), "in_progress")
assert.equal(clientPinStatus("verified"), "verified")
assert.equal(clientActionPath("ticket", "A", "pin"), "/client/ticket?project=A&pin=pin")
assert.equal(clientPinPath("A", "sheet", "pin"), "/client/blueprint?project=A&sheet=sheet&pin=pin")

const url = source => "data:text/javascript;base64," + Buffer.from(source).toString("base64")
let slots = [], effects = [], pending = [], cursor = 0, tree
globalThis.__portalHooks = {
  useState(initial) { const n = cursor++; if (!(n in slots)) slots[n] = typeof initial === "function" ? initial() : initial; return [slots[n], value => { slots[n] = typeof value === "function" ? value(slots[n]) : value }] },
  useRef(initial) { const n = cursor++; return slots[n] ??= { current: initial } },
  useMemo: fn => fn(),
  useCallback(fn) { cursor++; return fn },
  useEffect(fn, deps) { const n = cursor++, old = effects[n]; if (!old || !deps || deps.some((value, i) => value !== old.deps?.[i])) pending.push(() => { old?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
}
globalThis.__portalDeps = {}
async function compile(file, overrides = {}) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const replacements = { "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"), ...overrides }
  for (const declaration of ast.statements.filter(ts.isImportDeclaration)) {
    if (!declaration.importClause || declaration.importClause.isTypeOnly) continue
    const name = declaration.moduleSpecifier.text, exports = []
    if (name in replacements) continue
    if (declaration.importClause.name) exports.push(`export default function ${declaration.importClause.name.text}(){return null}`)
    for (const binding of declaration.importClause.namedBindings?.elements ?? []) {
      if (binding.isTypeOnly) continue
      const key = binding.propertyName?.text ?? binding.name.text
      exports.push(`export const ${key}=globalThis.${name === "react" ? "__portalHooks" : "__portalDeps"}.${key} ?? function ${key}(){return null}`)
    }
    replacements[name] = url(exports.join(";") + `\n// isolated dependency bindings for ${file}`)
  }
  for (const [name, replacement] of Object.entries(replacements)) output = output.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return import(url(output))
}
const all = node => Array.isArray(node) ? node.flatMap(all) : node && typeof node === "object" ? [node, ...all(node.props?.children), ...all(node.props?.footer)] : []
const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : ""
const render = (Component, props = {}) => { cursor = 0; tree = Component(props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
const reset = () => { effects.forEach(effect => effect?.cleanup?.()); slots = []; effects = []; pending = [] }
const find = predicate => { const node = all(tree).find(predicate); assert.ok(node, "Expected client portal control"); return node }
let selected = null, projects = [{ id: "A", code: "TEST-A", name: "Assigned project", phase: "plan_review" }], lastPath = ""
const originalWindow = globalThis.window, originalDocument = globalThis.document
globalThis.window = { location: { pathname: "/client/overview", search: "" }, history: { replaceState(_a, _b, path) { lastPath = path }, pushState(_a, _b, path) { lastPath = path } }, dispatchEvent() {}, addEventListener() {}, removeEventListener() {} }
globalThis.document = { getElementById: () => null, querySelectorAll: () => [] }
globalThis.PopStateEvent ??= class { constructor(type) { this.type = type } }
const pin = { id: "pin", project_id: "A", blueprint_id: "sheet", title: "Kitchen", status: "for_review", category: "progress" }
const deps = globalThis.__portalDeps
Object.assign(deps, {
  clientPinStatus, reportsForPin, clientActionPath, clientPinPath, openClientPath: path => { lastPath = path }, issuePhotoProblem, markupProblem, inRange, isFiltered, rangeText,
  getSelectedProjectId: () => selected, rememberProject: id => { selected = id },
  useProjects: () => ({ projects, loading: false, error: "", reload: async () => {} }), phaseLabels: { plan_review: "Plan review" },
  useProjectWork: () => ({ pins: [pin], loading: false, error: "", sheetOf: () => "Plan", nameOf: () => "Engineer", reload: async () => {} }),
  useAuth: () => ({ profile: { id: "client", role: "client" } }),
  useProjectTeam: () => ({ team: [{ user_id: "foreman", full_name: "Test Foreman" }] }),
  useProjectWorkItems: () => [{ id: "floor", pin_id: "pin", text: "FLOOR" }],
  useDailyReports: () => ({ reports: records, loading: false, error: "", reload: async () => {} }),
  useEvidencePhotos: () => ({ photos: [{ id: "one", path: "one.jpg", label: "One" }, { id: "two", path: "two.jpg", label: "Two" }], loading: false }),
  useSignedUrl: () => ({ url: "private-signed-url" }), photoPreviewBlocked: () => false,
  adjustPhotoZoom: (value, change) => Math.max(100, Math.min(300, value + change)), reportDateLong: date => date, weatherLabels: { sunny: "Sunny" },
  useToast: () => ({ success() {}, error() {} }), useConfirm: () => async () => true,
  pinSectionsFor, readPinSection, sectionLabel, pinLinkProblem, startPinLink,
})

const Shell = (await compile("../src/pages/Client/ClientShell.tsx")).default
render(Shell, { activePage: "overview", children: "Private project content", onNavigate() {} })
assert.equal(selected, "A", "First assigned project opens automatically without project cards")
assert.equal(lastPath, "/client/overview?project=A")
render(Shell, { activePage: "overview", children: "Private project content", onNavigate() {} })
assert.match(text(tree), /Assigned project.*Private project content/)
assert.ok(!all(tree).some(node => node.type === "select"), "One project needs no selection step")
projects.push({ id: "B", code: "TEST-B", name: "Second assigned", phase: "plan_review" })
render(Shell, { activePage: "overview", children: "Content", onNavigate() {} })
const switcher = find(node => node.props?.["aria-label"] === "Switch assigned project")
assert.deepEqual(all(switcher).filter(node => node.type === "option").map(node => node.props.value), ["A", "B"])
switcher.props.onChange({ target: { value: "B" } }); assert.equal(lastPath, "/client/overview?project=B")
reset(); selected = "A"; window.location.search = "?project=A&pin=pin"

const Reports = await compile("../src/components/client/PinDailyReports.tsx")
render(Reports.default, { pin })
assert.deepEqual(all(tree).filter(node => node.type === "li").map(node => node.key), ["visible"])
find(node => node.props?.["aria-label"] === "Report details for 2026-10-21").props.onClick()
render(Reports.default, { pin }); assert.match(text(tree), /FLOOR/)
const datedReports = [
  { ...report("today"), report_date: "2026-10-26", submitted_at: "2026-10-27T01:00:00Z" },
  report("earlier"),
  { ...report("today-draft", "A", "draft"), report_date: "2026-10-26" },
  { ...report("today-foreign", "B"), report_date: "2026-10-26" },
  { ...report("other-pin", "A", "submitted", [{ pin_id: "another-pin" }]), report_date: "2026-10-26" },
]
const todayReports = { pin, reports: datedReports, dates: { from: "2026-10-26", to: "2026-10-26" } }
const reportIds = () => all(tree).filter(node => node.type === "li").map(node => node.key)
reset(); render(Reports.default, todayReports)
assert.deepEqual(reportIds(), ["today"], "Calendar filters use report_date, not submitted/upload timestamps, and preserve client privacy")
find(node => node.props?.["aria-label"] === "Report details for 2026-10-26").props.onClick(); render(Reports.default, todayReports)
assert.ok(all(tree).some(node => node.props?.title?.includes("Daily progress")))
render(Reports.default, { ...todayReports, dates: { from: "2026-10-21", to: "2026-10-21" } })
assert.deepEqual(reportIds(), ["earlier"])
assert.ok(!all(tree).some(node => node.props?.title?.includes("Daily progress")), "A date change cannot leave the previous report's details open")
reset(); render(Reports.default, { ...todayReports, staff: true })
assert.deepEqual(reportIds(), ["today-draft", "today"], "Staff retain permitted drafts, still scoped to this pin, project and work date")
reset(); render(Reports.default, { ...todayReports, dates: { from: "2026-10-25", to: "2026-10-25" } })
assert.deepEqual(reportIds(), []); assert.match(text(tree), /No submitted daily report.*25 Oct 2026.*Choose another date/)
reset(); render(Reports.default, { ...todayReports, dates: { from: "", to: "" } })
assert.deepEqual(reportIds(), ["today", "earlier"], "All dates restores linked submitted history, newest report date first")
reset(); render(Reports.ReportSlideshow, { report: records[0], authorName: "Test Foreman" })
assert.match(text(tree), /1 \/ 2/)
find(node => node.props?.["aria-label"] === "Next report photo").props.onClick()
render(Reports.ReportSlideshow, { report: records[0], authorName: "Test Foreman" }); assert.match(text(tree), /2 \/ 2/)
find(node => node.props?.["aria-label"] === "Photo details").props.onClick()
render(Reports.ReportSlideshow, { report: records[0], authorName: "Test Foreman" })
const viewer = find(node => node.type?.name === "PhotoViewer")
assert.equal(viewer.props.photo.id, "two"); assert.equal(viewer.props.initialDetails, true); assert.equal(viewer.props.detailsToggle, true)
reset()
const Viewer = (await compile("../src/components/PhotoViewer.tsx")).default
render(Viewer, { photo: { id: "one", path: "one.jpg", label: "One" }, bucket: "daily-photos", detailsToggle: true, onClose() {} })
assert.ok(!all(tree).some(node => node.type?.name === "PhotoDetails"))
find(node => node.props?.["aria-label"] === "Photo details").props.onClick()
render(Viewer, { photo: { id: "one", path: "one.jpg", label: "One" }, bucket: "daily-photos", detailsToggle: true, onClose() {} })
assert.ok(all(tree).some(node => node.type?.name === "PhotoDetails"))

reset(); Object.assign(deps, {
  statusLabels: { not_started: "Not started", in_progress: "In progress", for_review: "For review", verified: "Completed", issue: "Issue" },
  statusDot: { in_progress: "#F18B00" }, statusChip: { in_progress: "progress-chip" },
})
deps.usePinPanelData = () => ({ counts: { issues: 1, reports: 1 }, records: { defects: [], snags: [], issues: [], reports: records, questions: [] }, loading: false, error: "", reload: async () => {} })
const Inspector = (await compile("../src/components/editor/Inspector.tsx")).default
const panelProps = { role: "client", selectedPin: pin, selectedAnnotation: null, selectedAnnotations: [], numberOf: () => 1, team: [] }
const panel = () => { render(Inspector, panelProps); const node = find(row => row.type?.name === "PinPanel"); cursor = 0; tree = node.type(node.props); const jobs = pending; pending = []; jobs.forEach(fn => fn()); return tree }
panel(); assert.match(text(tree), /In progress/); assert.doesNotMatch(text(tree), /For review/, "For review stays a checklist state, never the pin status")
const tabs = find(node => node.type?.name === "Tabs")
assert.deepEqual(tabs.props.tabs.map(tab => tab.label), ["Details", "Tasks & QC", "My reports", "Next actions", "Daily reports", "Communication"], "Clients never get staff photos or the timeline")
assert.equal(tabs.props.tabs.find(tab => tab.key === "issues").count, 1)
tree = tabs.type(tabs.props)
find(node => node.props?.role === "tab" && /^Daily reports/.test(text(node))).props.onClick()
panel(); const body = find(node => node.type?.name === "PinSectionBody"); assert.equal(body.props.section, "reports")
tree = body.type(body.props); assert.ok(all(tree).some(node => node.type?.name === "PinReportsSection"))
reset(); panelProps.pinLink = { pinId: "pin", search: "?pintab=issues" }
panel(); assert.equal(find(node => node.type?.name === "PinSectionBody").props.section, "issues", "A link opens the section it names")
reset(); panelProps.pinLink = { pinId: "pin", search: "?pintab=activity" }
panel(); assert.equal(find(node => node.type?.name === "PinSectionBody").props.section, "details", "A client link cannot open the staff timeline")

reset(); let inserted
Object.assign(deps, {
  useQuestions: () => ({ questions: [{ id: "mine", project_id: "A", author_id: "client", question: "My private question", created_at: "2026-10-21" }, { id: "other", project_id: "A", author_id: "someone-else", question: "Do not show me", created_at: "2026-10-21" }], loading: false, reload: async () => {} }),
  supabase: { from: () => ({ insert: async data => { inserted = data; return { error: null } } }) },
})
const Communication = (await compile("../src/pages/Client/ClientCommunication.tsx")).default
render(Communication)
assert.match(text(tree), /My private question/); assert.doesNotMatch(text(tree), /Do not show me/)
find(node => node.type === "textarea").props.onChange({ target: { value: "When will the floor be finished?" } })
render(Communication); await find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
assert.equal(inserted.pin_id, "pin"); assert.equal(inserted.project_id, "A")
find(node => node.props?.role === "tab" && text(node) === "Site visits").props.onClick()
render(Communication)
const visitPanel = find(node => node.type?.name === "SiteVisitsPanel")
assert.equal(visitPanel.props.projectId, "A"); assert.equal(visitPanel.props.mode, "client")
assert.ok(!all(tree).some(node => node.type === "form"), "Questions and visit requests occupy separate Communication tabs")
assert.match(lastPath, /tab=visits/)

reset(); let submissions = 0, attempts = [], failPhoto = true
Object.assign(deps, {
  useSnags: () => ({ snags: [], loading: false, error: "", reload: async () => {} }), urgencies: ["normal"], urgencyLabels: { normal: "Normal" }, errorText: error => error.message,
  snagActions: { submit: async data => { submissions++; assert.equal(data.pinId, "pin"); return { ok: true, data: "saved-snag" } } },
  uploadSnagPhoto: async (_project, snagId, file, annotations, caption) => { attempts.push({ snagId, name: file.name, annotations, caption }); if (file.name === "retry.jpg" && failPhoto) throw new Error("offline") },
})
const Submission = (await compile("../src/pages/Client/ClientSnagSubmission.tsx")).default
render(Submission)
find(node => node.props?.id === "snag-title").props.onChange({ target: { value: "Crack in wall" } })
const drafts = [{ id: "one", file: { name: "good.jpg" }, annotations: [], caption: "Good" }, { id: "two", file: { name: "retry.jpg" }, annotations: [], caption: "Retry" }]
find(node => node.type?.name === "IssuePhotoPicker").props.onChange(drafts)
render(Submission); find(node => node.type === "form").props.onSubmit({ preventDefault() {} })
render(Submission); await find(node => node.type?.name === "DataConfirmModal").props.onConfirm()
render(Submission); assert.match(text(tree), /report was saved/)
assert.equal(find(node => node.type?.name === "IssuePhotoPicker").props.limit, 3)
failPhoto = false
find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); render(Submission)
await find(node => node.type?.name === "DataConfirmModal").props.onConfirm()
assert.equal(submissions, 1, "Photo retries attach to the existing report, not a new client problem")
assert.deepEqual(attempts.map(row => row.name), ["good.jpg", "retry.jpg", "retry.jpg"])
assert.ok(attempts.every(row => row.snagId === "saved-snag"))

reset(); let storedFile, metadata, rpcCall
deps.supabase = { storage: { from: () => ({ upload: async (_path, file) => { storedFile = file; return {} }, remove: async () => ({}) }) }, from: () => ({ insert: async data => { metadata = data; return {} } }), rpc: async (name, args) => { rpcCall = { name, args }; return { data: "new", error: null } } }
const snags = await compile("../src/lib/snags.ts")
const original = new File(["original photo bytes"], "original.jpg", { type: "image/jpeg" })
await snags.uploadSnagPhoto("A", "saved", original, [], "Client caption")
assert.equal(storedFile, original, "The original bytes are uploaded without burning in annotations")
assert.equal(metadata.caption, "Client caption"); assert.deepEqual(metadata.annotations, [])
await snags.snagActions.submit({ projectId: "A", title: "Crack", description: "Details", location: "Kitchen", urgency: "normal", pinId: "pin" })
assert.equal(rpcCall.name, "submit_linked_snag"); assert.equal(rpcCall.args.p_pin, "pin")
reset(); Object.assign(deps, {
  useSnags: () => ({ snags: [{ id: "client-report", project_id: "A", defect_id: "defect", title: "Reported crack", created_at: "2026-10-21", description: "Client observation" }, { id: "other", project_id: "B", defect_id: "defect", title: "Foreign report" }], loading: false }),
  useSnagPhotos: id => ({ photos: id === "client-report" ? [{ id: "photo", annotations: [], caption: "Marked crack" }] : [], reload: async () => {} }),
})
const SnagParts = await compile("../src/components/qa/SnagParts.tsx")
render(SnagParts.LinkedClientReportEvidence, { projectId: "A", defectId: "defect" })
assert.match(text(tree), /Reported crack/); assert.doesNotMatch(text(tree), /Foreign report/)
assert.ok(all(tree).some(node => node.type?.name === "SnagPhotoStrip"))
reset(); globalThis.window = originalWindow; globalThis.document = originalDocument
delete globalThis.__portalHooks; delete globalThis.__portalDeps
console.log("Client automatic project scope/switcher, linked-report privacy, slideshow/details controls, private communication, pin-linked submission/photo retry and original/markup storage passed")
