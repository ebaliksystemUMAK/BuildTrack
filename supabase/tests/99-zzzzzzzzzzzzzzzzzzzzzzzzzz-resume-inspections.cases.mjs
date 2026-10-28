import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

export default async function({db,ids,as,asOwner,addUser,test,expectFail}) {
  await asOwner()
  for(const [key,role] of [["resumeEng","engineer"],["resumeFore","foreman"],["resumeOut","engineer"]]) await addUser(key,role)
  const project=(await db.query("insert into public.projects(code,name) values('RESUME-QA','Resume cancelled QA') returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3)",[project,ids.resumeEng,ids.resumeFore])
  await as("resumeEng")
  const sheet=(await db.query("insert into public.blueprints(project_id,title) values($1,'Resume QA plan') returning id",[project])).rows[0].id
  const makeWork=async()=>{
    await as("resumeEng")
    const pin=(await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,20,20,'Resume wall',$3) returning id",[project,sheet,ids.resumeFore])).rows[0].id
    const item=(await db.query("select public.save_work_checklist_item($1,null,'Wall',$2::jsonb) id",[pin,JSON.stringify([{text:"Wall alignment",acceptance_criteria:"Synthetic straight wall",severity:"major"}])])).rows[0].id
    await as("resumeFore")
    await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,path) values($1,$2,$3,$4)",[project,pin,item,`${project}/${pin}/${randomUUID()}.jpg`])
    const ir=(await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id",[pin,[item]])).rows[0].id
    await as("resumeEng")
    return {pin,item,ir}
  }
  const get=async(table,id)=>(await db.query(`select * from public.${table} where id=$1`,[id])).rows[0]
  const checks=async ir=>(await db.query("select * from public.qa_inspection_items where inspection_id=$1 order by position",[ir])).rows
  const snapshot=async ir=>(await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[ir])).rows[0]
  const cancel=async ir=>{await as("resumeEng");await db.query("select public.cancel_inspection($1,'Synthetic cancellation for continuation')",[ir])}
  const start=ir=>db.query("select public.start_inspection($1)",[ir])
  const correction=async(work,defect)=>{
    await as("resumeFore")
    const attempt=(await db.query("select public.begin_checklist_resubmission($1) id",[work.item])).rows[0].id
    await db.query("select public.save_checklist_attempt($1,'Synthetic corrected wall with new evidence')",[attempt])
    await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path) values($1,$2,$3,$4,$5)",[project,work.pin,work.item,attempt,`${project}/${work.pin}/${randomUUID()}.jpg`])
    const ir=(await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id",[[work.item],defect?[defect]:[]])).rows[0].id
    await as("resumeEng");return ir
  }
  let work,repair,defect
  await test("Resume QA: cancelled initial request restarts with original evidence and manual checklist completion",async()=>{
    work=await makeWork();const before=await snapshot(work.ir)
    await cancel(work.ir)
    for(const who of ["resumeFore","resumeOut"]) {
      await as(who);await expectFail("select public.start_inspection($1)",[work.ir],/not found|not allowed/)
    }
    await as("resumeEng");await start(work.ir)
    const inspection=await get("qa_inspections",work.ir)
    assert.equal(inspection.status,"in_progress");assert.equal(inspection.completed_at,null);assert.equal(inspection.summary,null)
    assert.equal(inspection.inspector_id,ids.resumeEng);assert.ok(inspection.started_at)
    assert.equal((await get("pin_checklist_items",work.item)).review_status,"for_review")
    assert.equal((await get("pins",work.pin)).status,"for_review")
    assert.deepEqual(await snapshot(work.ir),before)
    for(const row of await checks(work.ir)) await db.query("select public.save_inspection_item($1,'fail',null,'Needs correction')",[row.id])
    await db.query("select public.complete_inspection($1)",[work.ir])
    defect=(await db.query("select id from public.qa_defects where inspection_id=$1",[work.ir])).rows[0].id
    await expectFail("select public.start_inspection($1)",[work.ir],/requested or cancelled/)
  })
  await test("Resume QA: recorded reinspection results survive; NCR restoration and cancellation history are atomic",async()=>{
    repair=await correction(work,defect);await start(repair)
    const started=(await get("qa_inspections",repair)).started_at
    for(const row of await checks(repair)) await db.query("select public.save_inspection_item($1,'pass',null,'Already verified on site')",[row.id])
    const recorded=await checks(repair),submitted=await snapshot(repair)
    await cancel(repair)
    assert.equal((await get("qa_defects",defect)).status,"in_progress")
    await db.exec("begin")
    try {
      await asOwner();await db.query("update public.qa_defects set status='open' where id=$1",[defect])
      await as("resumeEng");await db.exec("savepoint changed_ncr")
      await expectFail("select public.start_inspection($1)",[repair],/linked NCR changed/)
      await db.exec("rollback to savepoint changed_ncr")
      assert.equal((await get("qa_inspections",repair)).status,"cancelled")
    } finally { await db.exec("rollback");await as("resumeEng") }
    await db.exec("begin")
    await start(repair)
    assert.equal((await get("qa_defects",defect)).status,"for_verification")
    await db.exec("rollback")
    assert.equal((await get("qa_inspections",repair)).status,"cancelled")
    assert.equal((await get("qa_defects",defect)).status,"in_progress")
    await start(repair)
    assert.equal((await get("qa_inspections",repair)).started_at.getTime(),started.getTime())
    assert.deepEqual(await checks(repair),recorded);assert.deepEqual(await snapshot(repair),submitted)
    const ncr=await get("qa_defects",defect)
    assert.equal(ncr.fixed_by,ids.resumeFore);assert.equal(ncr.fixed_at.getTime(),submitted.submitted_at.getTime())
    const events=(await db.query("select * from public.qa_inspection_events where inspection_id=$1 and kind in ('cancelled','resumed') order by id",[repair])).rows
    assert.deepEqual(events.map(e=>e.kind),["cancelled","resumed"])
    assert.equal(events[1].actor_id,ids.resumeEng);assert.match(events[1].note,/Synthetic cancellation/)
    await db.query("select public.complete_inspection($1,'Continued reinspection passed')",[repair])
    assert.equal((await get("qa_defects",defect)).status,"closed")
    assert.equal((await get("pin_checklist_items",work.item)).review_status,"for_review")
    await db.query("select public.review_checklist_item($1,true)",[work.item])
    assert.equal((await get("pin_checklist_items",work.item)).review_status,"verified")
  })
  await test("Resume QA: repeated cancellations can resume without duplicating closures or changing evidence",async()=>{
    const fresh=await makeWork(),before=await snapshot(fresh.ir)
    for(let n=0;n<2;n++) {await cancel(fresh.ir);await start(fresh.ir)}
    assert.deepEqual(await snapshot(fresh.ir),before)
    assert.equal(Number((await db.query("select count(*) n from public.qa_inspection_events where inspection_id=$1 and kind='resumed'",[fresh.ir])).rows[0].n),2)
    await cancel(fresh.ir)
  })
  await test("Resume QA: correction drafts and changed checklist/work cannot be overwritten",async()=>{
    const fresh=await makeWork();await cancel(fresh.ir)
    await as("resumeFore");await db.query("select public.begin_checklist_resubmission($1)",[fresh.item])
    await as("resumeEng");await expectFail("select public.start_inspection($1)",[fresh.ir],/newer correction draft/)
    assert.equal((await get("qa_inspections",fresh.ir)).status,"cancelled")
    const changed=await makeWork();await cancel(changed.ir)
    await as("resumeFore");await db.query("update public.pin_checklist_items set remark='Changed after cancellation' where id=$1",[changed.item])
    await as("resumeEng");await expectFail("select public.start_inspection($1)",[changed.ir],/Checklist changed/)
    const moved=await makeWork();await cancel(moved.ir)
    await db.query("update public.pins set title='Changed work' where id=$1",[moved.pin])
    await expectFail("select public.start_inspection($1)",[moved.ir],/Work changed/)
  })
  await test("Resume QA: newer submitted work remains the current request",async()=>{
    const fresh=await makeWork();await cancel(fresh.ir)
    const newer=await correction(fresh)
    await expectFail("select public.start_inspection($1)",[fresh.ir],/newer submission/)
    assert.equal((await get("qa_inspections",newer)).status,"requested")
    assert.equal((await get("pin_checklist_items",fresh.item)).review_inspection_id,newer)
  })
  await test("Resume QA: pinless stage can continue, but not after a newer replacement",async()=>{
    await as("resumeEng")
    const template=(await db.query("select qa_template_id id from public.pin_checklist_items where id=$1",[work.item])).rows[0].id
    const request=async()=> (await db.query("select public.request_inspection($1,$2,'Resume stage',null,'Synthetic location') id",[project,template])).rows[0].id
    const stage=await request();await cancel(stage);await start(stage)
    assert.equal((await get("qa_inspections",stage)).status,"in_progress")
    await cancel(stage);const newer=await request()
    await expectFail("select public.start_inspection($1)",[stage],/newer inspection/)
    assert.equal((await get("qa_inspections",newer)).status,"requested")
  })
  await test("Resume QA: pinned stage cannot bypass another pending request; RPC remains authenticated-only",async()=>{
    const fresh=await makeWork();await cancel(fresh.ir)
    const template=(await get("pin_checklist_items",fresh.item)).qa_template_id
    const stage=(await db.query("select public.request_inspection($1,$2,'Pinned stage',$3) id",[project,template,fresh.pin])).rows[0].id
    await cancel(stage);await start(stage)
    assert.equal((await get("qa_inspections",stage)).status,"in_progress")
    await cancel(stage)
    const newer=(await db.query("select public.request_inspection($1,$2,'Other pending stage',$3) id",[project,template,fresh.pin])).rows[0].id
    await expectFail("select public.start_inspection($1)",[stage],/newer inspection/)
    assert.equal((await get("qa_inspections",newer)).status,"requested")
    await asOwner()
    const grants=(await db.query("select has_function_privilege('anon','public.start_inspection(uuid)','execute') anon,has_function_privilege('authenticated','public.start_inspection(uuid)','execute') authenticated")).rows[0]
    assert.deepEqual(grants,{anon:false,authenticated:true})
  })
}
