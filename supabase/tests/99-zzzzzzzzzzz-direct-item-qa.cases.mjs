import assert from "node:assert/strict"

// Synthetic limits/instructions only; nothing here is an engineering standard.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  await asOwner()
  for (const [key, role] of [["directEng", "engineer"], ["directFore", "foreman"], ["directOther", "foreman"]]) await addUser(key, role)
  const project = (await db.query("insert into public.projects(code,name,site_lat,site_lng) values('DIRECT-QA','Direct submission test',14.5,121) returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3),($1,$4)", [project, ids.directEng, ids.directFore, ids.directOther])
  const sheet = (await db.query("insert into public.blueprints(project_id,title) values($1,'Direct QA plan') returning id", [project])).rows[0].id
  await as("directEng")
  const pin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,30,30,'KITCHEN',$3) returning id", [project, sheet, ids.directFore])).rows[0].id
  const otherPin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,50,50,'BATHROOM',$3) returning id", [project, sheet, ids.directFore])).rows[0].id
  const criteria = text => [{ text, acceptance_criteria: "Synthetic project-specific passing condition", evidence_requirement: "Synthetic test observation", reference: "TEST clause only" }]
  const save = (item, text, checks, p = pin) => db.query("select public.save_work_checklist_item($1,$2,$3,$4::jsonb) id", [p, item, text, JSON.stringify(checks)])
  const submit = item => db.query("select public.submit_checklist_qa($1,$2::uuid[]) id", [pin, [item]])
  const photo = async (item, label, attempt = null, lat = 14.5, clockAhead = false) => {
    await as("directFore")
    return (await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path,lat,lng,taken_at) values($1,$2,$3,$4,$5,$6,121,now()+$7::interval) returning id", [project, pin, item, attempt, `${project}/${pin}/${label}.jpg`, lat, clockAhead ? "1 hour" : "0"])).rows[0].id
  }
  const finish = async (inspection, fail = false) => {
    await as("directEng")
    await db.query("select public.start_inspection($1)", [inspection])
    for (const row of (await db.query("select id from public.qa_inspection_items where inspection_id=$1", [inspection])).rows) await db.query("select public.save_inspection_item($1,$2,null,$3)", [row.id, fail ? "fail" : "pass", fail ? "Synthetic failed observation" : null])
    await db.query("select public.complete_inspection($1,'Synthetic inspection completed')", [inspection])
  }
  let floor, wall, other, template, first, wallIr, correction, originalPhoto, newPhoto

  await test("Direct QA: Engineer creates each item with its own criteria in one save, no pin approval", async () => {
    await as("directEng")
    await expectFail("select public.save_work_checklist_item($1,null,'FLOOR','[]')", [pin], /inspection criteria/)
    await expectFail("select public.save_work_checklist_item($1,null,'FLOOR',$2::jsonb)", [pin, JSON.stringify([{ text: "Missing pass condition" }])], /passing requirement/)
    floor = (await save(null, "FLOOR", criteria("Synthetic floor-specific check"))).rows[0].id
    wall = (await save(null, "WALL", criteria("Synthetic wall-specific check"))).rows[0].id
    other = (await save(null, "CEILING", criteria("Synthetic ceiling check"), otherPin)).rows[0].id
    const row = (await db.query("select done,qa_template_id from public.pin_checklist_items where id=$1", [floor])).rows[0]
    template = row.qa_template_id
    assert.equal(row.done, false)
    assert.ok(template)
    assert.equal((await db.query("select qa_template_id from public.pins where id=$1", [pin])).rows[0].qa_template_id, null)
    assert.equal((await db.query("select text from public.qa_template_items where template_id=$1", [template])).rows[0].text, "Synthetic floor-specific check")
    await save(floor, "FLOOR", criteria("Synthetic revised floor check"))
    template = (await db.query("select qa_template_id from public.pin_checklist_items where id=$1", [floor])).rows[0].qa_template_id
  })

  await test("Direct QA: Foreman, outsider and anonymous cannot author/forge criteria; wrong-pin edits fail", async () => {
    for (const who of ["directFore", "directOther", "noperm", null]) {
      await as(who)
      await expectFail("select public.save_work_checklist_item($1,$2,'FORGED',$3::jsonb)", [pin, floor, JSON.stringify(criteria("Synthetic forged check"))], /Engineer|permission denied/)
    }
    await as("directFore")
    await expectFail("update public.pin_checklist_items set qa_template_id=$1 where id=$2", [template, wall], /permission denied/)
    await as("directEng")
    await expectFail("select public.save_work_checklist_item($1,$2,'WRONG',$3::jsonb)", [otherPin, floor, JSON.stringify(criteria("Synthetic wrong pin"))], /not found/)
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [pin, [floor]], /Foreman/)
  })

  await test("Direct QA: eligible evidence still required; a separate Ready tick is never required", async () => {
    await as("directFore")
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [pin, [floor]], /eligible photo/)
    await photo(floor, "rejected", null, 14.5, true)
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [pin, [floor]], /eligible photo/)
    originalPhoto = await photo(floor, "original")
    assert.equal((await db.query("select done from public.pin_checklist_items where id=$1", [floor])).rows[0].done, false)
    first = (await submit(floor)).rows[0].id
    const row = (await db.query("select done,review_status,review_inspection_id from public.pin_checklist_items where id=$1", [floor])).rows[0]
    assert.equal(row.done, true); assert.equal(row.review_status, "for_review"); assert.equal(row.review_inspection_id, first)
    assert.equal((await db.query("select text from public.qa_inspection_items where inspection_id=$1", [first])).rows[0].text, "Synthetic revised floor check")
  })

  await test("Direct QA: another item can proceed during review; submitted criteria cannot change", async () => {
    await as("directFore")
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [pin, [wall]], /eligible photo/)
    assert.equal((await db.query("select public.checklist_qa_submission_problem($1) reason", [wall])).rows[0].reason,null)
    assert.equal((await db.query("select public.pin_qa_submission_problem($1) reason", [otherPin])).rows[0].reason, null)
    await as("directEng")
    await expectFail("select public.save_work_checklist_item($1,$2,'FLOOR',$3::jsonb)", [pin, floor, JSON.stringify(criteria("Synthetic changed check"))], /preserved/)
    await finish(first)
    await expectFail("select public.save_work_checklist_item($1,$2,'FLOOR',$3::jsonb)", [pin, floor, JSON.stringify(criteria("Synthetic changed check"))], /preserved/)
    // Simulate an actual pre-migration snapshot, which has no new column key.
    await asOwner()
    await db.exec("alter table public.pin_qa_submissions disable trigger user")
    await db.query("update public.pin_qa_submissions set checklist_snapshot=(select jsonb_agg(x-'qa_template_id') from jsonb_array_elements(checklist_snapshot) x) where inspection_id=$1", [first])
    await db.exec("alter table public.pin_qa_submissions enable trigger user")
    // Historical requests had no per-item template. Keep the current row consistent with that old state.
    await db.exec("alter table public.pin_checklist_items disable trigger user")
    await db.query("update public.pin_checklist_items set qa_template_id=null where id=$1", [floor])
    await db.exec("alter table public.pin_checklist_items enable trigger user")
    await as("directEng")
    await db.query("select public.review_checklist_item($1,true)", [floor])
    assert.notEqual((await db.query("select status from public.pins where id=$1", [pin])).rows[0].status, "verified")
  })

  await test("Direct QA: another item's own criteria are inspected; failed work keeps separate correction evidence", async () => {
    await photo(wall, "wall-original")
    wallIr = (await submit(wall)).rows[0].id
    assert.equal((await db.query("select text from public.qa_inspection_items where inspection_id=$1", [wallIr])).rows[0].text, "Synthetic wall-specific check")
    await finish(wallIr, true)
    await as("directFore")
    correction = (await db.query("select public.begin_checklist_resubmission($1) id", [wall])).rows[0].id
    await db.query("select public.save_checklist_attempt($1,'Synthetic corrective work performed')", [correction])
    newPhoto = await photo(wall, "wall-correction", correction)
    await as("directEng")
    const wallTemplate = (await db.query("select qa_template_id from public.pin_checklist_items where id=$1", [wall])).rows[0].qa_template_id
    // Since 20261028150000 a work item's criteria copy cannot be edited as a checklist at all (stronger than "edits are ignored").
    await expectFail("select public.save_qa_template($1,$2,'Changed future library','general',null,'{}',$3::jsonb)", [wallTemplate, project, JSON.stringify(criteria("Later library check must not replace the failed request"))], /belong to a work item/)
    await as("directFore")
    const finding = (await db.query("select id from public.qa_defects where inspection_id=$1", [wallIr])).rows[0].id
    const next = (await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id", [[wall],[finding]])).rows[0].id
    assert.equal((await db.query("select text from public.qa_inspection_items where inspection_id=$1", [next])).rows[0].text, "Synthetic wall-specific check")
    assert.equal((await db.query("select reinspection_of from public.qa_inspections where id=$1", [next])).rows[0].reinspection_of, wallIr)
    const snap = (await db.query("select photos_snapshot from public.pin_qa_submissions where inspection_id=$1", [next])).rows[0].photos_snapshot
    assert.deepEqual(snap.map(row => row.id), [newPhoto])
    assert.ok((await db.query("select id from public.qa_inspection_events where inspection_id=$1", [next])).rows.length)
  })
}
