import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims','{}',false)") }
  await owner()
  for (const [key, role] of [["snapEng", "engineer"], ["snapFore", "foreman"], ["snapPM", "project_manager"], ["snapClient", "client"]]) await addUser(key, role)
  const project = (await db.query("insert into public.projects(code,name,site_lat,site_lng) values('QA-SCHEDULE','Synthetic QA schedule compatibility',14.5,121) returning id")).rows[0].id
  for (const key of ["snapEng", "snapFore", "snapClient"]) await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [project, ids[key]])
  for (const key of ["snapEng", "snapFore"]) await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'civil_structural','assigned') on conflict(project_id,user_id,blueprint_type) do update set access_level='assigned'", [project, ids[key]])
  await db.query("insert into public.project_managers(project_id,user_id,designation) values($1,$2,'primary')", [project, ids.snapPM])
  const sheet = (await db.query("insert into public.blueprints(project_id,title) values($1,'Synthetic QA dates') returning id", [project])).rows[0].id
  await as("snapEng")
  const pin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,25,25,'Synthetic work',$3) returning id", [project, sheet, ids.snapFore])).rows[0].id
  const fixtures = []
  for (const name of ["LEGACY", "MODERN", "GUARDED"]) {
    const criteria = [{ text: `Synthetic ${name} check`, acceptance_criteria: "Synthetic passing condition", reference: "TEST ONLY" }]
    const item = (await db.query("select public.save_work_checklist_item($1,null,$2,$3::jsonb) id", [pin, name, JSON.stringify(criteria)])).rows[0].id
    fixtures.push({ item, name })
  }
  for (const fixture of fixtures) {
    await as("snapFore")
    await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,path,lat,lng,taken_at,capture_source) values($1,$2,$3,$4,14.5,121,now(),'camera')", [project, pin, fixture.item, `${project}/${pin}/${fixture.name}.jpg`])
    fixture.inspection = (await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id", [pin, [fixture.item]])).rows[0].id
    await as("snapEng")
    await db.query("select public.start_inspection($1)", [fixture.inspection])
    for (const check of (await db.query("select id from public.qa_inspection_items where inspection_id=$1", [fixture.inspection])).rows) await db.query("select public.save_inspection_item($1,'pass',null,null)", [check.id])
    await db.query("select public.complete_inspection($1,'Synthetic passing inspection')", [fixture.inspection])
  }
  const [legacy, modern, guarded] = fixtures
  const snapshot = async fixture => (await db.query("select checklist_snapshot,photos_snapshot,work_snapshot from public.pin_qa_submissions where inspection_id=$1", [fixture.inspection])).rows[0]
  const schedule = async (fixture, expected = 0, end = "2026-12-10") => {
    await as("snapPM")
    await db.query("select public.save_timeline_item($1,$2,$3::jsonb,$4,'PM approved schedule dates')", [project, `task:${fixture.item}`, JSON.stringify({ title: fixture.name, phase: "Preparation", planned_start: "2026-12-01", planned_end: end, actual_start: null, actual_end: null, predecessors: [] }), expected])
  }

  await test("QA schedule snapshots: historical passed inspection survives added date columns and inherited deadline", async () => {
    await owner()
    // Reproduce a genuine historical schema in this local fixture only; production snapshots are never rewritten.
    await db.exec("alter table public.pin_qa_submissions disable trigger user")
    try { await db.query("update public.pin_qa_submissions set checklist_snapshot=(select jsonb_agg(x-array['planned_start','due_date']) from jsonb_array_elements(checklist_snapshot) x) where inspection_id=$1", [legacy.inspection]) }
    finally { await db.exec("alter table public.pin_qa_submissions enable trigger user") }
    await db.query("update public.pin_checklist_items set due_date='2026-11-14' where id=$1", [legacy.item])
    const before = await snapshot(legacy)
    assert.ok(!('planned_start' in before.checklist_snapshot[0]))
    await as("snapEng"); await db.query("select public.review_checklist_item($1,true)", [legacy.item])
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1", [legacy.item])).rows[0].review_status, "verified")
    assert.deepEqual(await snapshot(legacy), before, "Compatibility never rewrites inspected evidence")
  })

  await test("QA schedule snapshots: PM date changes preserve modern passed inspection and explicit Engineer completion", async () => {
    await schedule(modern)
    await schedule(modern, 1, "2026-12-12")
    await as("snapEng")
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1", [modern.item])).rows[0].review_status, "for_review", "Scheduling never approves QA")
    const before = await snapshot(modern)
    await db.query("select public.review_checklist_item($1,true)", [modern.item])
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1", [modern.item])).rows[0].review_status, "verified")
    assert.deepEqual(await snapshot(modern), before)
  })

  await test("QA schedule snapshots: PM, Foreman, Client and anonymous cannot complete a passed task", async () => {
    for (const key of ["snapPM", "snapFore", "snapClient", null]) {
      await as(key)
      await expectFail("select public.review_checklist_item($1,true)", [guarded.item], /Engineer|permission denied/)
    }
  })

  await test("QA schedule snapshots: evidence/criteria/identity changes still invalidate the passed snapshot", async () => {
    await owner()
    const original = (await db.query("select to_jsonb(c) row from public.pin_checklist_items c where id=$1", [guarded.item])).rows[0].row
    // Trusted tampering fixtures exercise the completion comparison independently of the ordinary evidence-edit locks.
    for (const [field, value] of [["text", "Changed inspected task"], ["remark", "Changed inspected remarks"], ["qa_template_id", modern && (await db.query("select qa_template_id from public.pin_checklist_items where id=$1", [modern.item])).rows[0].qa_template_id], ["position", original.position + 1]]) {
      await owner(); await db.exec("alter table public.pin_checklist_items disable trigger user")
      try { await db.query(`update public.pin_checklist_items set ${field}=$2 where id=$1`, [guarded.item, value]) }
      finally { await db.exec("alter table public.pin_checklist_items enable trigger user") }
      await as("snapEng"); await expectFail("select public.review_checklist_item($1,true)", [guarded.item], /Work changed after inspection/)
      await owner(); await db.exec("alter table public.pin_checklist_items disable trigger user")
      try { await db.query(`update public.pin_checklist_items set ${field}=$2 where id=$1`, [guarded.item, original[field]]) }
      finally { await db.exec("alter table public.pin_checklist_items enable trigger user") }
    }
    await as("snapFore"); await expectFail("update public.pin_checklist_items set remark='Forged evidence' where id=$1", [guarded.item], /locked|inspection|Reopen/)
    await as("snapEng"); await db.query("select public.review_checklist_item($1,true)", [guarded.item])
  })

  await test("QA schedule snapshots: legacy whole-pin gate ignores only schedule metadata, with private helper ACLs retained", async () => {
    await owner()
    // Use a passed real local submission as the historical whole-pin holder, preserving all other checks.
    const last = (await db.query("select inspection_id from public.pin_qa_submissions s join public.qa_inspections i on i.id=s.inspection_id where s.pin_id=$1 order by i.number desc limit 1", [pin])).rows[0].inspection_id
    const before = (await db.query("select checklist_snapshot,all_complete from public.pin_qa_submissions where inspection_id=$1", [last])).rows[0]
    await db.exec("alter table public.pin_qa_submissions disable trigger user")
    try { await db.query("update public.pin_qa_submissions set all_complete=true,checklist_snapshot=(select jsonb_agg(x-array['planned_start','due_date']) from jsonb_array_elements(public.pin_qa_checklist($2)) x) where inspection_id=$1", [last, pin]) }
    finally { await db.exec("alter table public.pin_qa_submissions enable trigger user") }
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids.snapEng, role: "authenticated" })])
    assert.equal((await db.query("select public.legacy_pin_qa_verification_problem($1) problem", [pin])).rows[0].problem, null)
    await db.exec("alter table public.pin_checklist_items disable trigger user")
    try { await db.query("update public.pin_checklist_items set remark='Changed legacy evidence' where id=$1", [legacy.item]) }
    finally { await db.exec("alter table public.pin_checklist_items enable trigger user") }
    assert.match((await db.query("select public.legacy_pin_qa_verification_problem($1) problem", [pin])).rows[0].problem, /Work changed after inspection/)
    await as("snapEng"); await expectFail("select public.legacy_pin_qa_verification_problem($1)", [pin], /permission denied/)
    await owner()
    assert.equal((await db.query("select has_function_privilege('anon','public.review_checklist_item(uuid,boolean,text)','execute') allowed")).rows[0].allowed, false)
    await db.exec("alter table public.pin_qa_submissions disable trigger user")
    try { await db.query("update public.pin_qa_submissions set checklist_snapshot=$2::jsonb,all_complete=$3 where inspection_id=$1", [last, JSON.stringify(before.checklist_snapshot), before.all_complete]) }
    finally { await db.exec("alter table public.pin_qa_submissions enable trigger user") }
  })
}
