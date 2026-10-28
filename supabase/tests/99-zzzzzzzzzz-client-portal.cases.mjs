import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  await asOwner()
  for (const [name, role] of [["portalClient", "client"], ["portalOther", "client"], ["portalEng", "engineer"], ["portalFore", "foreman"]]) await addUser(name, role)
  const project = (await db.query("insert into public.projects(code,name) values('PORTAL-TEST','Client portal fixture') returning id")).rows[0].id
  const foreign = (await db.query("insert into public.projects(code,name) values('PORTAL-OTHER','Other project fixture') returning id")).rows[0].id
  for (const name of ["portalClient", "portalOther", "portalEng", "portalFore"]) await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [project, ids[name]])
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [foreign, ids.portalEng])
  await as("portalEng")
  const sheet = (await db.query("insert into public.blueprints(project_id,title) values($1,'Client plan') returning id", [project])).rows[0].id
  const otherSheet = (await db.query("insert into public.blueprints(project_id,title) values($1,'Other plan') returning id", [foreign])).rows[0].id
  const pin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,10,10,'Kitchen',$3) returning id", [project, sheet, ids.portalFore])).rows[0].id
  const otherPin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title) values($1,$2,10,10,'Other kitchen') returning id", [foreign, otherSheet])).rows[0].id
  const notePin = (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,category) values($1,$2,20,20,'Note only','note') returning id", [project, sheet])).rows[0].id
  let snag, photo, question, report
  const submit = "select public.submit_linked_snag($1,'Client crack report','Near the doorway','Kitchen','normal',$2) id"
  const markup = [{ id: "shape-1", kind: "rectangle", x: 10, y: 20, x2: 50, y2: 70, color: "#ff0000", stroke: 4, fontSize: 30, text: "", points: [] }]

  await test("Client portal: only assigned active clients link problems to work pins in the same project", async () => {
    await as("portalEng"); await expectFail(submit, [project, pin], /assigned active client/)
    await as("portalClient")
    await expectFail(submit, [project, otherPin], /work pin from this project/)
    await expectFail(submit, [project, notePin], /work pin from this project/)
    snag = (await db.query(submit, [project, pin])).rows[0].id
    assert.equal((await db.query("select pin_id from public.client_snags where id=$1", [snag])).rows[0].pin_id, pin)
    await expectFail("update public.client_snags set pin_id=$1 where id=$2", [otherPin, snag], /permission denied/)
    await as(null); await expectFail(submit, [project, pin], /permission denied/)
  })
  await test("Client portal: original path, caption and validated markup are saved separately and privately", async () => {
    await as("portalClient")
    const path = `${project}/${snag}/original.jpg`
    photo = (await db.query("insert into public.snag_photos(snag_id,project_id,path,caption,annotations) values($1,$2,$3,'Crack marked in red',$4::jsonb) returning id", [snag, project, path, JSON.stringify(markup)])).rows[0].id
    const row = (await db.query("select path,caption,annotations from public.snag_photos where id=$1", [photo])).rows[0]
    assert.equal(row.path, path); assert.equal(row.caption, "Crack marked in red"); assert.deepEqual(row.annotations, markup)
    await expectFail("insert into public.snag_photos(snag_id,project_id,path,annotations) values($1,$2,$3,'[{\"kind\":\"script\"}]')", [snag, project, `${project}/${snag}/bad.jpg`], /check/)
    await expectFail("update public.snag_photos set annotations='[]' where id=$1", [photo], /permission denied/)
    await as("portalOther")
    assert.equal((await db.query("select * from public.snag_photos where id=$1", [photo])).rows.length, 0)
    await expectFail("insert into public.snag_photos(snag_id,project_id,path) values($1,$2,$3)", [snag, project, `${project}/${snag}/other.jpg`], /own reports/)
  })
  await test("Client portal: Engineer reads the markup and resulting NCR inherits the reported pin", async () => {
    await as("portalEng")
    assert.deepEqual((await db.query("select annotations from public.snag_photos where id=$1", [photo])).rows[0].annotations, markup)
    const defect = (await db.query("select public.decide_snag($1,true,'We will repair the crack','minor','workmanship','general',$2) id", [snag, ids.portalFore])).rows[0].id
    assert.equal((await db.query("select pin_id from public.qa_defects where id=$1", [defect])).rows[0].pin_id, pin)
    await as("portalFore")
    assert.equal((await db.query("select id from public.qa_defects where id=$1", [defect])).rows.length, 1)
    await as("portalClient")
    await expectFail("delete from public.snag_photos where id=$1", [photo], /cannot be removed/)
    assert.equal((await db.query("select * from public.qa_defects where id=$1", [defect])).rows.length, 0)
  })
  await test("Client portal communication: pin-linked questions notify the Engineer and stay private from other clients", async () => {
    await as("portalClient")
    await expectFail("insert into public.project_questions(project_id,pin_id,question) values($1,$2,'When is this done?')", [project, otherPin], /not part of this project/)
    question = (await db.query("insert into public.project_questions(project_id,pin_id,question) values($1,$2,'When will the kitchen be finished?') returning id", [project, pin])).rows[0].id
    await as("portalOther"); assert.equal((await db.query("select * from public.project_questions where id=$1", [question])).rows.length, 0)
    await as("portalEng")
    assert.equal((await db.query("select pin_id from public.project_questions where id=$1", [question])).rows[0].pin_id, pin)
    const note = (await db.query("select link from public.notifications where user_id=$1 and entity_id=$2 and kind='question.new'", [ids.portalEng, question])).rows[0]
    assert.ok(note.link.endsWith(`&question=${question}`))
  })
  await test("Client portal communication: Engineer answers return to the exact client thread", async () => {
    await as("portalFore"); await expectFail("select public.answer_question($1,'Not my role')", [question], /not allowed/)
    await as("portalEng"); await db.query("select public.answer_question($1,'The team is scheduled for Friday.')", [question])
    await as("portalClient")
    const row = (await db.query("select answer,answered_by from public.project_questions where id=$1", [question])).rows[0]
    assert.equal(row.answer, "The team is scheduled for Friday."); assert.equal(row.answered_by, ids.portalEng)
    const note = (await db.query("select link from public.notifications where entity_id=$1 and kind='question.answered'", [question])).rows[0]
    assert.equal(note.link, `/client/communication?project=${project}&question=${question}`)
  })
  await test("Client portal: pin-linked daily reports and their photos become visible only after Foreman submission", async () => {
    await as("portalFore")
    report = (await db.query("insert into public.daily_reports(project_id,report_date,work_done,linked_work) values($1,(now() at time zone 'Asia/Manila')::date,'Kitchen progress',$2::jsonb) returning id", [project, JSON.stringify([{ pin_id: pin, item_id: null }])])).rows[0].id
    await db.query("insert into public.daily_report_photos(project_id,report_id,path,taken_at,capture_source) values($1,$2,$3,now(),'camera')", [project, report, `${project}/${report}/progress.jpg`])
    await as("portalClient")
    assert.equal((await db.query("select * from public.daily_reports where id=$1", [report])).rows.length, 0)
    assert.equal((await db.query("select * from public.daily_report_photos where report_id=$1", [report])).rows.length, 0)
    await as("portalFore"); await db.query("update public.daily_reports set status='submitted' where id=$1", [report])
    await as("portalClient")
    assert.equal((await db.query("select linked_work from public.daily_reports where id=$1", [report])).rows[0].linked_work[0].pin_id, pin)
    assert.equal((await db.query("select * from public.daily_report_photos where report_id=$1", [report])).rows.length, 1)
  })
  await test("Client portal: disabled client cannot submit linked problems or attach new photos", async () => {
    await asOwner(); await db.query("update public.profiles set status='disabled' where id=$1", [ids.portalClient])
    await as("portalClient"); await expectFail(submit, [project, pin], /assigned active client/)
    await expectFail("insert into public.snag_photos(snag_id,project_id,path) values($1,$2,$3)", [snag, project, `${project}/${snag}/disabled.jpg`], /own reports/)
    await asOwner(); await db.query("update public.profiles set status='active' where id=$1", [ids.portalClient])
  })
}
