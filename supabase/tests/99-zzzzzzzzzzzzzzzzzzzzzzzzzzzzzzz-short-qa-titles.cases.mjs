import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, test, expectFail }) {
  await asOwner()
  const project = (await db.query("insert into public.projects(code,name,site_lat,site_lng) values('SHORT-QA','Synthetic short area QA',14.5,121) returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3)", [project, ids.eng1, ids.fore1])
  const sheet = (await db.query("insert into public.blueprints(project_id,title) values($1,'Short area QA plan') returning id", [project])).rows[0].id
  const criteria = JSON.stringify([{ text: "Synthetic site check", acceptance_criteria: "Synthetic passing requirement", severity: "major" }])
  const prepare = async title => {
    await as("eng1")
    const pin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,20,20,$3,$4) returning id", [project, sheet, title, ids.fore1])).rows[0].id
    const item = (await db.query("select public.save_work_checklist_item($1,null,'CR-FLOOR',$2::jsonb) id", [pin, criteria])).rows[0].id
    return { pin, item }
  }
  const photo = async ({ pin, item }, attempt = null) => {
    await as("fore1")
    return db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path,lat,lng,taken_at) values($1,$2,$3,$4,$5,14.5,121,now())", [project, pin, item, attempt, `${project}/${pin}/${attempt ?? "initial"}.jpg`])
  }
  const submit = ({ pin, item }) => db.query("select public.submit_checklist_qa($1,$2::uuid[]) id", [pin, [item]])
  const record = async id => (await db.query("select title,status,reinspection_of,work_item_ids from public.qa_inspections where id=$1", [id])).rows[0]

  await test("Short area QA: CR submits with evidence, notifies the Engineer and supports correction reinspection", async () => {
    const work = await prepare("CR")
    await as("fore1")
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [work.pin, [work.item]], /eligible photo/)
    await photo(work)
    await as("eng1")
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])", [work.pin, [work.item]], /Foreman/)
    await as("fore1")
    assert.equal((await db.query("select public.checklist_qa_submission_problem($1) problem", [work.item])).rows[0].problem, null)
    const first = (await submit(work)).rows[0].id
    assert.deepEqual(await record(first), { title: "QA inspection: CR", status: "requested", reinspection_of: null, work_item_ids: [work.item] })
    await as("eng1")
    assert.ok((await db.query("select id from public.notifications where user_id=$1 and title='Inspection requested: QA inspection: CR'", [ids.eng1])).rows.length)
    await db.query("select public.start_inspection($1)", [first])
    for (const check of (await db.query("select id from public.qa_inspection_items where inspection_id=$1", [first])).rows)
      await db.query("select public.save_inspection_item($1,'fail',null,'Synthetic failed observation')", [check.id])
    await db.query("select public.complete_inspection($1,'Synthetic inspection failure')", [first])
    const defect = (await db.query("select id from public.qa_defects where inspection_id=$1", [first])).rows[0].id
    await as("fore1")
    const attempt = (await db.query("select public.begin_checklist_resubmission($1) id", [work.item])).rows[0].id
    await db.query("select public.save_checklist_attempt($1,'Synthetic correction completed with new evidence')", [attempt])
    await photo(work, attempt)
    const retry = (await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id", [[work.item], [defect]])).rows[0].id
    assert.deepEqual(await record(retry), { title: "QA inspection: CR", status: "requested", reinspection_of: first, work_item_ids: [work.item] })
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1", [work.item])).rows[0].review_status, "for_review")
  })

  await test("Short area QA: trimmed short labels get readable titles; ordinary and maximum-length labels stay intact", async () => {
    for (const [label, expected] of [[" A", "QA inspection: A"], ["  ", "QA inspection"], [" CR ", "QA inspection: CR"], ["CR1", "CR1"], ["X".repeat(120), "X".repeat(120)]]) {
      const work = await prepare(label)
      await photo(work)
      const inspection = (await submit(work)).rows[0].id
      assert.equal((await record(inspection)).title, expected)
      assert.equal((await db.query("select title from public.pins where id=$1", [work.pin])).rows[0].title, label)
    }
  })

  await test("Short area QA: internal creator stays invoker-only and inaccessible to API roles", async () => {
    await asOwner()
    const functionName = "public.request_work_item_inspection(uuid,uuid,text,uuid,uuid[],text)"
    const privileges = (await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,(select prosecdef from pg_proc where oid=$1::regprocedure) definer", [functionName])).rows[0]
    assert.deepEqual(privileges, { anon: false, authenticated: false, definer: false })
  })
}
