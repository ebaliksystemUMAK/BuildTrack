import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  await asOwner()
  for (const [key, role] of [["attemptEng","engineer"],["attemptFore","foreman"],["attemptOther","engineer"]]) await addUser(key,role)
  const project=(await db.query("insert into public.projects(code,name,site_lat,site_lng) values('ATTEMPT-QA','QA evidence attempts',14.5,121) returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3)",[project,ids.attemptEng,ids.attemptFore])
  const sheet=(await db.query("insert into public.blueprints(project_id,title) values($1,'QA attempt plan') returning id",[project])).rows[0].id
  await as("attemptEng")
  const pin=(await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,20,20,'Correction test work',$3) returning id",[project,sheet,ids.attemptFore])).rows[0].id
  const item=(await db.query("insert into public.pin_checklist_items(project_id,pin_id,text) values($1,$2,'Correct test step') returning id",[project,pin])).rows[0].id
  const template=(await db.query("select public.save_qa_template(null,$1,'Synthetic attempt criteria','general',null,'{}',$2::jsonb) id",[project,JSON.stringify([{ text:"Synthetic test observation", severity:"minor" }])])).rows[0].id
  await db.query("select public.approve_pin_qa_checklist($1,$2)",[pin,template])
  const photo=async(name,attempt=null)=> (await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path,lat,lng,taken_at) values($1,$2,$3,$4,$5,14.5,121,now()) returning *",[project,pin,item,attempt,`${project}/${pin}/${name}.jpg`])).rows[0]
  const submit=async()=> (await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id",[pin,[item]])).rows[0].id
  const finish=async(ir,result)=>{
    await as("attemptEng")
    await db.query("select public.start_inspection($1)",[ir])
    const qi=(await db.query("select id from public.qa_inspection_items where inspection_id=$1",[ir])).rows[0].id
    await db.query("select public.save_inspection_item($1,$2,null,$3)",[qi,result,result==='fail'?'Test observation needs correction':null])
    await db.query("select public.complete_inspection($1,'Synthetic inspection findings')",[ir])
  }
  let first,second,third,original,draft,originalPhoto,correctionPhoto
  await test("QA attempts: original request captures its own photos and remarks; failure records an immutable timeline",async()=>{
    await as("attemptFore")
    originalPhoto=await photo('initial')
    await db.query("update public.pin_checklist_items set done=true,remark='Original work remark' where id=$1",[item])
    first=await submit()
    original=(await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[first])).rows[0]
    assert.equal(original.photos_snapshot.length,1)
    await finish(first,'fail')
    const events=(await db.query("select kind,created_at,actor_id from public.qa_inspection_events where inspection_id=$1 order by id",[first])).rows
    for(const kind of ['requested','in_progress','item_result','failed']) assert.ok(events.some(e=>e.kind===kind))
    assert.ok(events.every(e=>e.created_at && e.actor_id))
  })
  await test("QA attempts: existing inspected criteria count as approval even when old approval metadata is absent",async()=>{
    await asOwner()
    await db.exec("alter table public.pins disable trigger pins_work_qa_config")
    try { await db.query("update public.pins set qa_approved_by=null where id=$1",[pin]) }
    finally { await db.exec("alter table public.pins enable trigger pins_work_qa_config") }
    await as("attemptFore")
    assert.equal((await db.query("select public.pin_qa_template_approved($1) approved",[pin])).rows[0].approved,true)
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])",[pin,[item]],/separate resubmission/)
  })
  await test("QA attempts: preparing is idempotent and private to the assigned active Foreman; old remarks stay unchanged",async()=>{
    await as("attemptEng")
    await expectFail("select public.begin_checklist_resubmission($1)",[item],/assigned active Foreman/)
    await as("attemptFore")
    draft=(await db.query("select public.begin_checklist_resubmission($1) id",[item])).rows[0].id
    assert.equal((await db.query("select public.begin_checklist_resubmission($1) id",[item])).rows[0].id,draft)
    await db.query("select public.save_checklist_attempt($1,'New correction remarks, separate from original')",[draft])
    assert.equal((await db.query("select remark from public.pin_checklist_items where id=$1",[item])).rows[0].remark,'Original work remark')
    await as("attemptOther")
    assert.equal(await count("select count(*) n from public.qa_work_attempts where id=$1",[draft]),0)
    await expectFail("select public.save_checklist_attempt($1,'Forged correction')",[draft],/assigned active Foreman/)
    await as("attemptFore")
    await expectFail("update public.qa_work_attempts set remarks='Forged' where id=$1",[draft],/permission denied/)
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])",[pin,[item]],/new eligible photos/)
  })
  await test("QA attempts: new draft photos are separate; only unsubmitted draft photos can be removed",async()=>{
    await as("attemptFore")
    const disposable=await photo('unused-correction',draft)
    await db.query("delete from public.pin_photos where id=$1",[disposable.id])
    await expectFail("delete from public.pin_photos where id=$1",[originalPhoto.id],/evidence/)
    correctionPhoto=await photo('correction-1',draft)
    assert.equal(correctionPhoto.qa_attempt_id,draft)
    await db.query("select public.save_checklist_attempt($1,'bad')",[draft])
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])",[pin,[item]],/correction.*remarks/)
    await db.query("select public.save_checklist_attempt($1,'New correction remarks, separate from original')",[draft])
    second=await submit()
    const fresh=(await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[second])).rows[0]
    assert.deepEqual(fresh.photos_snapshot.map(p=>p.id),[correctionPhoto.id])
    assert.equal(fresh.checklist_snapshot[0].remark,'New correction remarks, separate from original')
    assert.equal((await db.query("select reinspection_of from public.qa_inspections where id=$1",[second])).rows[0].reinspection_of,first)
    assert.deepEqual((await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[first])).rows[0],original)
    await expectFail("select public.save_checklist_attempt($1,'Try to overwrite submitted remarks')",[draft],/immutable/)
    await expectFail("select public.begin_checklist_resubmission($1)",[item],/pending/)
    await expectFail("select public.submit_checklist_qa($1,$2::uuid[])",[pin,[item]],/already pending/)
  })
  await test("QA attempts: repeated failure creates a third distinct holder, request, timeline and linked inspection",async()=>{
    await finish(second,'fail')
    await as("attemptFore")
    const thirdDraft=(await db.query("select public.begin_checklist_resubmission($1) id",[item])).rows[0].id
    assert.notEqual(thirdDraft,draft)
    await db.query("select public.save_checklist_attempt($1,'Second correction, fresh evidence for third request')",[thirdDraft])
    const ph=await photo('correction-2',thirdDraft)
    const finding=(await db.query("select id from public.qa_defects where inspection_id=$1",[first])).rows[0].id
    third=(await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id",[[item],[finding]])).rows[0].id
    assert.equal((await db.query("select reinspection_of from public.qa_inspections where id=$1",[third])).rows[0].reinspection_of,second)
    const fresh=(await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[third])).rows[0]
    assert.deepEqual(fresh.photos_snapshot.map(p=>p.id),[ph.id])
    assert.equal(await count("select count(*) n from public.qa_work_attempts where pin_id=$1",[pin]),2)
    await finish(third,'pass')
    assert.equal((await db.query("select status from public.qa_defects where id=$1",[finding])).rows[0].status,'closed')
    assert.equal(await count("select count(*) n from public.qa_defects where inspection_id=$1",[second]),0,"A repeated failed finding reuses its original NCR")
    await db.query("select public.review_checklist_item($1,true)",[item])
    assert.equal((await db.query("select status from public.pins where id=$1",[pin])).rows[0].status,'verified')
    assert.deepEqual((await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[first])).rows[0],original)
    await expectFail("delete from public.qa_inspection_events where inspection_id=$1",[first],/permission denied/)
    await as("attemptOther")
    assert.equal(await count("select count(*) n from public.qa_inspection_events where project_id=$1",[project]),0)
  })
}
