// Tests for 20261028150000: project checklists vs work item criteria, and documented sources for cited standards.
import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count }) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  const criteria = (text) => JSON.stringify([{ text, acceptance_criteria: `${text} meets the synthetic passing requirement` }])
  const P = {}

  await test("Project checklists: setup — a project, its Engineer, a plan and a work pin", async () => {
    await as("admin", "aal2")
    P.project = (await one("insert into public.projects (code, name) values ('CHK-1', 'Checklist project') returning id")).id
    await as("super", "aal2")
    await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.project, ids.eng1])
    await as("eng1", "aal2")
    P.sheet = (await one("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Ground floor', 'architectural') returning id", [P.project])).id
    P.pin = (await one("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 10, 10, 'LIVING ROOM') returning id", [P.project, P.sheet])).id
    P.checklist = (await one("select public.save_qa_template(null, $1, 'Painting', 'general', 'Engineer checklist', array['PGBC 2015'], $2::jsonb) id", [P.project, criteria("Paint coverage")])).id
  })

  await test("Project checklists: a work item's criteria copy is flagged and never counted as a project checklist", async () => {
    await as("eng1", "aal2")
    P.item = (await one("select public.save_work_checklist_item($1, null, 'PAINT', $2::jsonb) id", [P.pin, criteria("Paint finish")])).id
    await asOwner()
    const copy = await one("select t.* from public.qa_templates t join public.pin_checklist_items c on c.qa_template_id = t.id where c.id = $1", [P.item])
    assert.equal(copy.work_item_criteria, true)
    assert.equal(copy.name, "LIVING ROOM / PAINT")
    assert.deepEqual(copy.standards, [], "an item without a source checklist cites nothing")
    assert.equal(await count("select count(*) n from public.qa_templates where project_id = $1 and not work_item_criteria", [P.project]), 1, "only the Engineer's checklist")
    assert.equal((await one("select work_item_criteria from public.qa_templates where id = $1", [P.checklist])).work_item_criteria, false)
  })

  await test("Project checklists: saving a work item again removes the copy it replaced; cited standards come with the source checklist", async () => {
    await asOwner()
    const before = (await one("select qa_template_id from public.pin_checklist_items where id = $1", [P.item])).qa_template_id
    await as("eng1", "aal2")
    await expectOk("select public.save_work_checklist_item($1, $2, 'PAINT', $3::jsonb, array['PGBC 2015', ' PNS 07:2018 '])", [P.pin, P.item, criteria("Paint coverage")])
    await asOwner()
    const after = await one("select t.id, t.standards, t.work_item_criteria from public.qa_templates t join public.pin_checklist_items c on c.qa_template_id = t.id where c.id = $1", [P.item])
    assert.notEqual(after.id, before)
    assert.deepEqual(after.standards, ["PGBC 2015", "PNS 07:2018"], "trimmed, in order")
    assert.equal(after.work_item_criteria, true)
    assert.equal(await count("select count(*) n from public.qa_templates where id = $1", [before]), 0, "the unused copy is gone")
    assert.equal(await count("select count(*) n from public.qa_templates where project_id = $1 and work_item_criteria", [P.project]), 1, "one copy per work item")
    await as("eng1", "aal2")
    await expectFail("select public.save_work_checklist_item($1, $2, 'PAINT', $3::jsonb, $4::text[])", [P.pin, P.item, criteria("Paint coverage"), Array.from({ length: 11 }, (_, i) => `STD ${i + 1}`)], /at most 10/)
    await expectFail("select public.save_work_checklist_item($1, $2, 'PAINT', $3::jsonb, array['X'])", [P.pin, P.item, criteria("Paint coverage")], /2 to 40/)
  })

  await test("Project checklists: a work item's copy cannot be edited or archived as a checklist; real project checklists still can", async () => {
    await asOwner()
    const copy = (await one("select qa_template_id id from public.pin_checklist_items where id = $1", [P.item])).id
    await as("eng1", "aal2")
    await expectFail("select public.save_qa_template($1, null, 'Renamed', 'general', null, '{}', $2::jsonb)", [copy, criteria("Changed behind the work item")], /belong to a work item/)
    await expectFail("select public.archive_qa_template($1, true)", [copy], /belong to a work item/)
    await expectOk("select public.save_qa_template($1, null, 'Painting (interior)', 'general', 'Engineer checklist', array['PGBC 2015'], $2::jsonb)", [P.checklist, criteria("Paint coverage")])
    await expectOk("select public.archive_qa_template($1, true)", [P.checklist])
    await expectOk("select public.archive_qa_template($1, false)", [P.checklist])
    await asOwner()
    assert.equal((await one("select name from public.qa_templates where id = $1", [copy])).name, "LIVING ROOM / PAINT", "unchanged")
  })

  await test("Project checklists: copies used by a submission stay after the work moves on (history is never deleted)", async () => {
    await asOwner()
    const used = await count("select count(*) n from public.qa_templates t where t.work_item_criteria and exists (select 1 from public.pin_qa_submissions s where s.template_id = t.id)")
    const orphans = await count(`select count(*) n from public.qa_templates t where t.work_item_criteria
      and not exists (select 1 from public.pin_checklist_items c where c.qa_template_id = t.id)
      and not exists (select 1 from public.qa_inspections i where i.template_id = t.id)
      and not exists (select 1 from public.pin_qa_submissions s where s.template_id = t.id)
      and not exists (select 1 from public.pins p where p.qa_template_id = t.id)`)
    assert.ok(used > 0, "earlier suites submitted work items: their copies are still here")
    assert.equal(orphans, 0, "no unused copy is left behind")
  })

  await test("Cited standards: documented official sources are filled in only where missing; nothing is invented or renamed", async () => {
    await asOwner()
    const saved = (await one("select value from public.system_settings where key = 'standards'")).value
    const synthetic = [
      { code: "PNS 07:2018", title: "Portland cement - Specification" },
      { code: "pgbc 2015", title: "Philippine Green Building Code", source: "https://custom.example/pgbc.pdf" },
      { code: "NSCP 2015", title: "National Structural Code of the Philippines, 7th Edition" },
    ]
    await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify(synthetic)])
    assert.equal((await one("select public.fill_documented_standard_sources() n")).n, 1)
    const filled = (await one("select value from public.system_settings where key = 'standards'")).value
    assert.match(filled[0].source, /^https:\/\/bps\.dti\.gov\.ph\//)
    assert.equal(filled[1].source, "https://custom.example/pgbc.pdf", "an existing link is kept")
    assert.equal(filled[2].source, undefined, "no invented link for a code without a documented source")
    assert.deepEqual(filled.map((s) => [s.code, s.title]), synthetic.map((s) => [s.code, s.title]), "codes, titles and order unchanged")
    assert.equal((await one("select public.fill_documented_standard_sources() n")).n, 0, "running it again changes nothing")
    await as("client1")
    await expectFail("select public.fill_documented_standard_sources()", [], /permission denied/)
    await asOwner()
    await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify(saved)])
  })

  await test("Cited standards: a Super Admin may store an https official source per standard; anything else is refused", async () => {
    await asOwner()
    const saved = (await one("select value from public.system_settings where key = 'standards'")).value
    await as("super", "aal2")
    await expectOk("select public.set_setting('standards', $1::jsonb)", [JSON.stringify([{ code: "TEST 1", title: "Synthetic reference", source: "https://example.test/reference.pdf" }, { code: "TEST 3", title: "No link yet" }])])
    for (const source of ["http://example.test/a", "javascript:alert(1)", "https://", 42, "https://example.test/" + "x".repeat(300)])
      await expectFail("select public.set_setting('standards', $1::jsonb)", [JSON.stringify([{ code: "TEST 2", title: "Synthetic", source }])], /https:\/\/ link/)
    await as("eng1", "aal2")
    await expectFail("select public.set_setting('standards', $1::jsonb)", [JSON.stringify([{ code: "TEST 4", title: "Engineer edit" }])], /Super Admin/)
    await asOwner()
    await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify(saved)])
  })
}
