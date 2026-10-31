import assert from "node:assert/strict"
import {
  recordLevel,
  accessChanges,
  accessColumns,
  accessSummary,
  canEditType,
  canUploadType,
  canWorkType,
  downgradeWarning,
  levelOf,
  readTypeParam,
  sheetType,
  typeCards,
  uploadTypes,
} from "../src/lib/blueprintTypes.ts"

// Pure rules of the blueprint type browser and access editor (20261028130000). The database enforces the same rules;
// supabase/tests/99-…-blueprint-type-access.cases.mjs proves them there.
const project = "p1"
const grant = (user_id, blueprint_type, access_level) => ({ project_id: project, user_id, blueprint_type, access_level })
const grants = [grant("eng", "architectural", "assigned"), grant("eng", "electrical", "view"), grant("fore", "electrical", "assigned"), { ...grant("eng", "mechanical", "assigned"), project_id: "p2" }]
const sheets = [{ blueprint_type: "architectural" }, { blueprint_type: "architectural" }, { blueprint_type: "electrical" }, { blueprint_type: "civil_structural" }]
let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`) }

test("levels: the same person holds different levels per type; nothing crosses projects", () => {
  assert.equal(levelOf(grants, "eng", project, "architectural"), "assigned")
  assert.equal(levelOf(grants, "eng", project, "electrical"), "view")
  assert.equal(levelOf(grants, "eng", project, "plumbing_sanitary"), "none")
  assert.equal(levelOf(grants, "eng", project, "mechanical"), "none", "a grant on another project")
  assert.equal(levelOf(grants, null, project, "architectural"), "none")
})

test("type cards: Engineers / Foremen see only types they hold, with counts and their level; No access is hidden", () => {
  const eng = typeCards({ role: "engineer", sheets, grants, userId: "eng", projectId: project })
  assert.deepEqual(eng.map((c) => [c.type, c.count, c.badge]), [["architectural", 2, "Assigned work access"], ["electrical", 1, "View only"]])
  const fore = typeCards({ role: "foreman", sheets, grants, userId: "fore", projectId: project })
  assert.deepEqual(fore.map((c) => c.type), ["electrical"])
  assert.deepEqual(typeCards({ role: "foreman", sheets, grants, userId: "nobody", projectId: project }), [], "membership alone shows nothing")
})

test("type cards: a type appears only once it has a plan (Admins and Clients alike); sheets without a type file like the migration", () => {
  const admin = typeCards({ role: "admin", sheets, grants: [], userId: "a", projectId: project, canManage: true })
  assert.deepEqual(admin.map((c) => [c.type, c.count]), [["architectural", 2], ["civil_structural", 1], ["electrical", 1]])
  assert.equal(admin[0].badge, "Upload and manage")
  const client = typeCards({ role: "client", sheets, grants: [], userId: "c", projectId: project })
  assert.deepEqual(client.map((c) => [c.type, c.badge]), [["architectural", "View only"], ["civil_structural", "View only"], ["electrical", "View only"]])
  assert.deepEqual(typeCards({ role: "admin", sheets: [], grants: [], userId: "a", projectId: project, canManage: true }), [], "no empty cards")
  assert.equal(sheetType({ discipline: null }), "civil_structural")
  assert.equal(sheetType({ discipline: "mep" }), "civil_structural")
  assert.equal(sheetType({ discipline: "architectural" }), "architectural")
  assert.equal(sheetType({ blueprint_type: "electrical", discipline: null }), "electrical")
})

test("authority: Engineers edit / upload only with Assigned work; Foremen work but never edit; Admin uploads need blueprints.manage", () => {
  assert.equal(canEditType("engineer", "assigned"), true)
  assert.equal(canEditType("engineer", "view"), false)
  assert.equal(canEditType("foreman", "assigned"), false, "Foremen never get Engineer editing")
  assert.equal(canWorkType("foreman", "assigned"), true)
  assert.equal(canWorkType("foreman", "view"), false)
  assert.equal(canWorkType("client", "assigned"), false)
  assert.equal(canUploadType("admin", "none", true), true)
  assert.equal(canUploadType("admin", "none", false), false)
  assert.deepEqual(uploadTypes("engineer", (t) => levelOf(grants, "eng", project, t)), ["architectural"], "never View only")
  assert.equal(uploadTypes("admin", () => "none", true).length, 5)
})

test("access editor: only the types this project uses (plans or remaining grants); summaries; confirmations", () => {
  assert.deepEqual(accessColumns(sheets, []), ["architectural", "civil_structural", "electrical"])
  assert.deepEqual(accessColumns([{ discipline: null }], []), ["civil_structural"], "untyped sheets count as Civil / Structural")
  assert.deepEqual(accessColumns([], [grant("eng", "mechanical", "view")]), ["mechanical"], "a remaining grant keeps its column so it can be removed")
  assert.deepEqual(accessColumns([], []), [])
  assert.equal(accessSummary({ architectural: "assigned", electrical: "view" }), "Assigned work: Architectural · View only: Electrical")
  assert.equal(accessSummary({}), "No blueprint access yet")
  assert.match(downgradeWarning("foreman", "electrical", "assigned", "view"), /open Electrical work pins are unassigned/)
  assert.match(downgradeWarning("engineer", "architectural", "assigned", "none"), /inspect or verify.*hidden/s)
  assert.match(downgradeWarning("engineer", "architectural", "view", "none"), /hidden/)
  assert.equal(downgradeWarning("engineer", "architectural", "none", "assigned"), null)
  assert.equal(downgradeWarning("foreman", "architectural", "view", "assigned"), null)
})

test("unsaved access edits: only real differences count, per person and type", () => {
  const draft = { eng: { architectural: "assigned", electrical: "assigned", mechanical: "none" }, fore: { electrical: "view" } }
  assert.deepEqual(accessChanges(grants, draft, project), [
    { userId: "eng", type: "electrical", from: "view", to: "assigned" },
    { userId: "fore", type: "electrical", from: "assigned", to: "view" },
  ], "unchanged picks (architectural already assigned, mechanical already none) are not changes")
  assert.deepEqual(accessChanges(grants, {}, project), [])
})

test("QA records: the level of a record's plan type decides; project-wide records take the best level; hidden pins give none", () => {
  const pins = [{ id: "pinA", blueprint_id: "arch" }, { id: "pinE", blueprint_id: "elec" }]
  const sheets = [{ id: "arch", blueprint_type: "architectural" }, { id: "elec", blueprint_type: "electrical" }]
  const eng = (t) => levelOf(grants, "eng", project, t)
  assert.equal(recordLevel("pinA", pins, sheets, eng), "assigned")
  assert.equal(recordLevel("pinE", pins, sheets, eng), "view", "View only: readable, no actions")
  assert.equal(canWorkType("engineer", recordLevel("pinE", pins, sheets, eng)), false)
  assert.equal(recordLevel("missing", pins, sheets, eng), "none")
  assert.equal(recordLevel(null, pins, sheets, eng), "assigned", "project-wide: best level held")
  assert.equal(recordLevel(null, pins, sheets, (t) => levelOf(grants, "fore", project, t)), "assigned")
  assert.equal(recordLevel(null, pins, sheets, () => "view"), "view")
  assert.equal(recordLevel(null, pins, sheets, () => "none"), "none")
  assert.equal(recordLevel("pinA", pins, [{ id: "arch", discipline: null }], (t) => (t === "civil_structural" ? "view" : "none")), "view", "untyped sheet counts as Civil / Structural")
})

test("links: ?btype= opens a known type only", () => {
  assert.equal(readTypeParam("?project=x&btype=electrical"), "electrical")
  assert.equal(readTypeParam("?btype=mep"), null)
  assert.equal(readTypeParam(""), null)
})

console.log(`\n${passed} passed`)
