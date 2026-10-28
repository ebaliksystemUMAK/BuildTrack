import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  await asOwner()
  for (const [key, role] of [["parallelEng", "engineer"], ["parallelFore", "foreman"], ["parallelOther", "foreman"]]) await addUser(key, role)
  const project = (await db.query("insert into public.projects(code,name,site_lat,site_lng) values('PARALLEL-QA','Synthetic independent-item QA',14.5,121) returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3),($1,$4)", [project, ids.parallelEng, ids.parallelFore, ids.parallelOther])
  const sheet = (await db.query("insert into public.blueprints(project_id,title) values($1,'Synthetic parallel plan') returning id", [project])).rows[0].id
  await as("parallelEng")
  const pin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,10,10,'Synthetic work',$3) returning id", [project, sheet, ids.parallelFore])).rows[0].id
  const criteria = name => JSON.stringify([{ text: `Synthetic ${name} test`, acceptance_criteria: `Synthetic ${name} pass condition`, severity: "major" }])
  const add = name => db.query("select public.save_work_checklist_item($1,null,$2,$3::jsonb) id", [pin, name, criteria(name)])
  const floor = (await add("FLOOR")).rows[0].id, wall = (await add("WALL")).rows[0].id
  let ceiling, floorIr, wallIr, ceilingIr, nextIr, correction, original, floorPhoto, wallPhoto, floorDefect
  const photo = async (item, label, attempt = null) => {
    await as("parallelFore")
    return (await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,path,qa_attempt_id,lat,lng,taken_at) values($1,$2,$3,$4,$5,14.5,121,now()) returning id", [project, pin, item, `${project}/${pin}/${label}.jpg`, attempt])).rows[0].id
  }
  const submit = item => db.query("select public.submit_checklist_qa($1,$2::uuid[]) id", [pin, [item]])
  const finish = async (inspection, result) => {
    await as("parallelEng")
    await db.query("select public.start_inspection($1)", [inspection])
    for (const row of (await db.query("select id from public.qa_inspection_items where inspection_id=$1", [inspection])).rows) await db.query("select public.save_inspection_item($1,$2,null,$3)", [row.id, result, result === "fail" ? "Synthetic failure observation" : null])
    await db.query("select public.complete_inspection($1,'Synthetic parallel inspection')", [inspection])
  }
  const open = () => count("select count(*) n from public.qa_inspections where pin_id=$1 and status in ('requested','in_progress')", [pin])

  await test("Parallel QA: Engineer adds and edits a fresh item while another item is pending", async () => {
    floorPhoto = await photo(floor, "floor-initial")
    floorIr = (await submit(floor)).rows[0].id
    original = (await db.query("select checklist_snapshot,photos_snapshot from public.pin_qa_submissions where inspection_id=$1", [floorIr])).rows[0]
    await as("parallelEng")
    ceiling = (await add("CEILING")).rows[0].id
    await db.query("select public.save_work_checklist_item($1,$2,'CEILING',$3::jsonb)", [pin, ceiling, criteria("CEILING revised")])
    await expectFail("select public.save_work_checklist_item($1,$2,'FLOOR',$3::jsonb)", [pin, floor, criteria("tamper")], /preserved/)
    assert.equal(await open(), 1)
  })

  await test("Parallel QA: Foreman prepares, removes fresh photos and submits WALL while FLOOR is pending", async () => {
    wallPhoto = await photo(wall, "wall-initial")
    const unused = await photo(wall, "wall-unused")
    await db.query("delete from public.pin_photos where id=$1", [unused])
    await db.query("update public.pin_checklist_items set remark='Synthetic wall preparation' where id=$1", [wall])
    assert.equal((await db.query("select public.checklist_qa_submission_problem($1) problem", [wall])).rows[0].problem, null)
    wallIr = (await submit(wall)).rows[0].id
    assert.notEqual(wallIr, floorIr); assert.equal(await open(), 2)
    assert.deepEqual((await db.query("select work_item_ids from public.qa_inspections where id=$1", [wallIr])).rows[0].work_item_ids, [wall])
    assert.deepEqual((await db.query("select photos_snapshot from public.pin_qa_submissions where inspection_id=$1", [wallIr])).rows[0].photos_snapshot.map(row => row.id), [wallPhoto])
  })

  await test("Parallel QA: same-item duplicates and pending evidence edits are blocked; outsiders cannot bypass scope", async () => {
    await as("parallelFore")
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [pin, [floor]], /already pending/)
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [pin, [wall]], /already pending/)
    await expectFail("update public.pin_checklist_items set remark='Tamper pending' where id=$1", [floor], /locked/)
    await expectFail("delete from public.pin_photos where id=$1", [floorPhoto], /immutable|locked/)
    await expectFail("select public.request_work_item_inspection($1,null,'Bypass',$2,$3::uuid[],null)", [project, pin, [ceiling]], /permission denied/)
    await as("parallelOther")
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [pin, [ceiling]], /active Foreman assigned/)
    await expectFail("select public.save_work_checklist_item($1,null,'FORGED',$2::jsonb)", [pin, criteria("forged")], /Engineer/)
    assert.equal(await open(), 2)
  })

  await test("Parallel QA: a failure returns only its own item and keeps the pin in review for the other request", async () => {
    await finish(floorIr, "fail")
    floorDefect = (await db.query("select id from public.qa_defects where inspection_id=$1", [floorIr])).rows[0].id
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1", [floor])).rows[0].review_status, "returned")
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1", [wall])).rows[0].review_status, "for_review")
    assert.equal((await db.query("select status from public.pins where id=$1", [pin])).rows[0].status, "for_review")
    await as("parallelFore")
    correction = (await db.query("select public.begin_checklist_resubmission($1) id", [floor])).rows[0].id
    await db.query("select public.save_checklist_attempt($1,'Synthetic corrected work and new evidence')", [correction])
    await photo(floor, "floor-correction", correction)
    nextIr = (await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id", [[floor], [floorDefect]])).rows[0].id
    assert.equal(await open(), 2)
    await photo(ceiling, "ceiling-initial")
    ceilingIr = (await submit(ceiling)).rows[0].id
    assert.equal(await open(), 3)
  })

  await test("Parallel QA: Engineer accepts a passed item independently, but work cannot complete with other requests open", async () => {
    await finish(wallIr, "pass")
    await db.query("select public.review_checklist_item($1,true)", [wall])
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1", [wall])).rows[0].review_status, "verified")
    assert.equal((await db.query("select status from public.pins where id=$1", [pin])).rows[0].status, "for_review")
    await expectFail("update public.pins set status='verified' where id=$1", [pin], /still open|Awaiting Engineer/)
    await finish(nextIr, "pass")
    assert.equal((await db.query("select status from public.qa_defects where id=$1", [floorDefect])).rows[0].status, "closed")
    assert.equal(await open(), 1)
    assert.deepEqual((await db.query("select checklist_snapshot,photos_snapshot from public.pin_qa_submissions where inspection_id=$1", [floorIr])).rows[0], original)
  })

  await test("Parallel QA: completion still requires all accepted items and clear NCRs; all request timelines remain distinct", async () => {
    await finish(ceilingIr, "pass")
    await db.query("select public.review_checklist_item($1,true)", [ceiling])
    assert.notEqual((await db.query("select status from public.pins where id=$1", [pin])).rows[0].status, "verified")
    assert.equal((await db.query("select status from public.qa_defects where id=$1", [floorDefect])).rows[0].status, "closed")
    await db.query("select public.review_checklist_item($1,true)", [floor])
    assert.equal((await db.query("select status from public.pins where id=$1", [pin])).rows[0].status, "verified")
    assert.equal(await open(), 0)
    for (const ir of [floorIr, wallIr, nextIr, ceilingIr]) assert.ok(await count("select count(*) n from public.qa_inspection_events where inspection_id=$1", [ir]) >= 3)
    assert.deepEqual((await db.query("select checklist_snapshot,photos_snapshot from public.pin_qa_submissions where inspection_id=$1", [floorIr])).rows[0], original)
  })

  await test("Parallel QA: work can be submitted alongside a stage inspection; either request can start and cancel independently", async () => {
    await as("parallelEng")
    const secondPin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,20,20,'Synthetic stage overlap',$3) returning id", [project, sheet, ids.parallelFore])).rows[0].id
    const template = (await db.query("select qa_template_id from public.pin_checklist_items where id=$1", [floor])).rows[0].qa_template_id
    await as("parallelFore")
    const stage = (await db.query("select public.request_inspection($1,$2,'Synthetic hold point',$3) id", [project, template, secondPin])).rows[0].id
    await as("parallelEng")
    const another = (await db.query("select public.save_work_checklist_item($1,null,'WALL',$2::jsonb) id", [secondPin, criteria("overlap")])).rows[0].id
    await as("parallelFore")
    await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,path,lat,lng,taken_at) values($1,$2,$3,$4,14.5,121,now())", [project, secondPin, another, `${project}/${secondPin}/overlap.jpg`])
    const itemIr = (await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id", [secondPin, [another]])).rows[0].id
    await as("parallelEng")
    await db.query("select public.start_inspection($1)", [stage])
    await db.query("select public.start_inspection($1)", [itemIr])
    await db.query("select public.cancel_inspection($1,'Synthetic cancellation')", [itemIr])
    assert.equal((await db.query("select status from public.pins where id=$1", [secondPin])).rows[0].status,"for_review")
    await db.query("select public.cancel_inspection($1,'Synthetic stage cancellation')", [stage])
    assert.equal((await db.query("select status from public.pins where id=$1", [secondPin])).rows[0].status,"in_progress")
  })
}
