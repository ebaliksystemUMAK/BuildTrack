import assert from "node:assert/strict"
import { addedToProject, citedStandards, clauseReferences, isWorkItemCriteria, libraryChecklists, pickableChecklists, projectChecklists, sourceHost, WORK_ITEM_CRITERIA_NOTE } from "../src/lib/qaChecklists.ts"
import { parseSettings } from "../src/lib/settingsModel.ts"

// Pure rules behind Checklist configuration, the checklist pickers and the cited-standard documentation (20261028150000).
// The database side is proven in supabase/tests/99-…-project-checklists.cases.mjs.
const item = (reference = null) => ({ id: crypto.randomUUID(), reference })
const template = (name, project_id, extra = {}) => ({ id: name, name, project_id, archived: false, description: null, work_item_criteria: false, standards: [], qa_template_items: [item()], ...extra })
const P = "project-1"
const templates = [
  template("Concrete masonry (CHB) wall", null, { is_system: true }),
  template("Old library list", null, { archived: true }),
  template("WATER PROOFING", P),
  template("Painting", P, { archived: true }),
  template("Empty draft", P, { qa_template_items: [] }),
  template("LIVING ROOM / PAINT", P, { work_item_criteria: true, description: WORK_ITEM_CRITERIA_NOTE }),
  template("DINING AREA / FLOOR", P, { work_item_criteria: undefined, description: WORK_ITEM_CRITERIA_NOTE }), // loaded before the column existed
  template("Other project list", "project-2"),
]
let passed = 0
const test = (name, fn) => { fn(); passed++; console.log(`  ok   ${name}`) }

test("work item criteria are recognised by the flag, or by their description before the flag existed", () => {
  assert.equal(isWorkItemCriteria(templates[5]), true)
  assert.equal(isWorkItemCriteria(templates[6]), true)
  assert.equal(isWorkItemCriteria(templates[2]), false)
  assert.equal(isWorkItemCriteria({ project_id: null, description: WORK_ITEM_CRITERIA_NOTE }), false, "library lists are never work item copies")
})

test("Checklist configuration lists only this project's added checklists (archived on request), never the library or work item copies", () => {
  assert.deepEqual(projectChecklists(templates, P).map((t) => t.name), ["WATER PROOFING", "Empty draft"])
  assert.deepEqual(projectChecklists(templates, P, true).map((t) => t.name), ["WATER PROOFING", "Painting", "Empty draft"])
  assert.deepEqual(projectChecklists(templates, null), [], "no project, no list")
})

test("pickers on a pin offer only this project's live checklists that have criteria", () => {
  assert.deepEqual(pickableChecklists(templates, P).map((t) => t.name), ["WATER PROOFING"])
  assert.deepEqual(pickableChecklists(templates, "project-2").map((t) => t.name), ["Other project list"])
})

test("the library picker shows live library lists and marks the ones already added (also older '(copy)' names)", () => {
  assert.deepEqual(libraryChecklists(templates).map((t) => t.name), ["Concrete masonry (CHB) wall"])
  const project = [template("concrete masonry (CHB) wall", P)]
  assert.equal(addedToProject(templates[0], project), true)
  assert.equal(addedToProject(templates[0], [template("Concrete masonry (CHB) wall (copy)", P)]), true)
  assert.equal(addedToProject(templates[0], [template("Concrete masonry (CHB) wall", P, { archived: true })]), false, "an archived copy does not count")
  assert.equal(addedToProject(templates[0], []), false)
})

test("documentation: cited standards keep their order, get catalog titles and official sources, and are never invented", () => {
  const catalog = [{ code: "PGBC 2015", title: "Philippine Green Building Code", source: "https://www.dpwh.gov.ph/x.pdf" }, { code: "NSCP 2015", title: "National Structural Code of the Philippines, 7th Edition" }]
  assert.deepEqual(citedStandards(["nscp 2015", " PGBC 2015 ", "OLD CODE", "NSCP 2015", ""], catalog), [
    { code: "nscp 2015", title: "National Structural Code of the Philippines, 7th Edition", source: null },
    { code: "PGBC 2015", title: "Philippine Green Building Code", source: "https://www.dpwh.gov.ph/x.pdf" },
    { code: "OLD CODE", title: null, source: null },
  ])
  assert.deepEqual(clauseReferences([item("NSCP 2015 Sec. 407"), item(" "), item("NSCP 2015 Sec. 407"), item("PEC 2017 Art. 3.0")]), ["NSCP 2015 Sec. 407", "PEC 2017 Art. 3.0"])
  assert.equal(sourceHost("https://www.dpwh.gov.ph/x.pdf"), "dpwh.gov.ph")
  assert.equal(sourceHost("not a link"), "not a link")
})

test("settings keep an official https source per standard and drop anything else", () => {
  const parsed = parseSettings([{ key: "standards", value: [{ code: "A 1", title: "With link", source: "https://example.test/a" }, { code: "B 2", title: "Bad link", source: "javascript:alert(1)" }, { code: "C 3", title: "No link" }] }])
  assert.deepEqual(parsed.standards, [{ code: "A 1", title: "With link", source: "https://example.test/a" }, { code: "B 2", title: "Bad link" }, { code: "C 3", title: "No link" }])
})

console.log(`\n${passed} passed`)
