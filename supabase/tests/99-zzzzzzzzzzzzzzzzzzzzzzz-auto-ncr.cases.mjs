import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

export default async function({ db, ids, as, asOwner, addUser, test, expectFail }) {
  await asOwner()
  for (const [key, role] of [["autoEng","engineer"],["autoFore","foreman"],["autoOut","engineer"]]) await addUser(key,role)
  const project=(await db.query("insert into public.projects(code,name) values('AUTO-NCR','Automatic NCR closure tests') returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3)",[project,ids.autoEng,ids.autoFore])
  await as("autoEng")
  const sheet=(await db.query("insert into public.blueprints(project_id,title) values($1,'Automatic closure plan') returning id",[project])).rows[0].id
  const pin=(await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,30,30,'Test wall',$3) returning id",[project,sheet,ids.autoFore])).rows[0].id
  const wall=(await db.query("select public.save_work_checklist_item($1,null,'WALL',$2::jsonb) id",[pin,JSON.stringify([
    {text:"Finding A",acceptance_criteria:"Synthetic acceptance A",severity:"major",requires_photo:true},
    {text:"Finding B",acceptance_criteria:"Synthetic acceptance B",severity:"major"},
  ])])).rows[0].id
  const checks=async ir=>(await db.query("select * from public.qa_inspection_items where inspection_id=$1 order by position",[ir])).rows
  const ncr=async id=>(await db.query("select * from public.qa_defects where id=$1",[id])).rows[0]
  const photo=async(ir,item)=>db.query("insert into public.qa_photos(project_id,inspection_id,item_id,path) values($1,$2,$3,$4)",[project,ir,item,`${project}/${ir}/${randomUUID()}.jpg`])
  const pinPhoto=async attempt=>db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path) values($1,$2,$3,$4,$5)",[project,pin,wall,attempt,`${project}/${pin}/${randomUUID()}.jpg`])
  const request=async findings=>{
    await as("autoFore")
    const attempt=(await db.query("select public.begin_checklist_resubmission($1) id",[wall])).rows[0].id
    await db.query("select public.save_checklist_attempt($1,'Synthetic corrected wall with fresh evidence')",[attempt])
    await pinPhoto(attempt)
    return (await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id",[[wall],findings])).rows[0].id
  }
  let first, repair, final, a, b, original, submission
  await test("Auto NCR: requesting/starting and an unsigned Pass never close a finding; missing evidence rolls back sign-off",async()=>{
    await as("autoFore"); await pinPhoto(null)
    first=(await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id",[pin,[wall]])).rows[0].id
    await as("autoEng"); await db.query("select public.start_inspection($1)",[first])
    for(const row of await checks(first)) {
      await db.query("select public.save_inspection_item($1,'fail',null,'Synthetic initial defect needs repair')",[row.id])
      if(row.requires_photo) await photo(first,row.id)
    }
    await db.query("select public.complete_inspection($1,'Initial defects')",[first])
    ;[a,b]=(await db.query("select id from public.qa_defects where inspection_id=$1 order by number",[first])).rows.map(row=>row.id)
    original=await checks(first)
    submission=(await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[first])).rows[0]
    repair=await request([a,b])
    assert.equal((await ncr(a)).status,"for_verification")
    await as("autoEng"); await db.query("select public.start_inspection($1)",[repair])
    for(const row of await checks(repair)) await db.query("select public.save_inspection_item($1,$2,null,$3)",[row.id,row.text==="Finding A"?"pass":"na",row.text==="Finding A"?null:"Unable to verify finding B today"])
    assert.equal((await ncr(a)).status,"for_verification")
    await expectFail("select public.complete_inspection($1,'Do not close without required evidence')",[repair],/photo/i)
    assert.equal((await ncr(a)).closed_at,null)
    assert.equal((await ncr(b)).status,"for_verification")
  })
  await test("Auto NCR: only the assigned inspector signs off; trigger helper is private",async()=>{
    for(const who of ["autoFore","autoOut"]) {
      await as(who)
      await expectFail("select public.complete_inspection($1,'Unauthorized sign-off')",[repair],/not allowed|not found|inspector/)
      await expectFail("select public.auto_close_reinspection_ncrs()",[],/permission denied/)
    }
    await as("autoEng")
    await expectFail("select public.auto_close_reinspection_ncrs()",[],/permission denied/)
  })
  await test("Auto NCR: closure, remarks, actor, events and notifications commit atomically; N/A returns for correction",async()=>{
    const firstCheck=(await checks(repair))[0]
    await photo(repair,firstCheck.id)
    await db.exec("begin")
    await db.query("select public.complete_inspection($1,'Measured and checked on site')",[repair])
    assert.equal((await ncr(a)).status,"closed")
    await db.exec("rollback")
    assert.equal((await ncr(a)).status,"for_verification", "Rollback restores inspection and NCR together")
    await db.query("select public.complete_inspection($1,'Measured and checked on site')",[repair])
    const saved=await ncr(a)
    assert.equal(saved.closed_by,ids.autoEng); assert.ok(saved.closed_at)
    assert.match(saved.closing_note,/Automatically closed.*Remarks: Measured and checked on site/)
    assert.equal((await ncr(b)).status,"in_progress", "N/A is not a Pass and cannot strand the correction")
    assert.equal((await ncr(b)).closed_at,null)
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1",[wall])).rows[0].review_status,"returned")
    await asOwner()
    assert.equal(Number((await db.query("select count(*) n from public.notifications where kind='qa.defect_closed' and entity_id=$1",[a])).rows[0].n),1)
    await as("autoEng")
    assert.deepEqual(await checks(first),original)
    assert.deepEqual((await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[first])).rows[0],submission)
  })
  await test("Auto NCR: approved historical backfill only closes valid linked findings, preserves records, and is idempotent",async()=>{
    await db.exec("begin")
    await asOwner()
    await db.query("update public.qa_defects set status='for_verification',closed_at=null,closed_by=null,closing_note=null where id=$1",[a])
    const oldInspection=(await db.query("select * from public.qa_inspections where id=$1",[repair])).rows[0]
    const backfill=readFileSync(new URL("../migrations/20261028081533_close_existing_passed_reinspection_ncrs.sql",import.meta.url),"utf8")
    await db.exec(backfill)
    assert.equal((await ncr(a)).status,"closed")
    assert.match((await ncr(a)).closing_note,/Automatically closed from the finding-specific Pass/)
    assert.equal((await ncr(a)).closed_by,ids.autoEng)
    assert.equal((await ncr(b)).status,"in_progress")
    assert.deepEqual((await db.query("select * from public.qa_inspections where id=$1",[repair])).rows[0],oldInspection)
    const countEvents=async()=>Number((await db.query("select count(*) n from public.qa_defect_events where defect_id=$1 and kind='closed'",[a])).rows[0].n)
    const before=await countEvents()
    await db.exec(backfill); assert.equal(await countEvents(),before)
    assert.equal((await db.query("select actor_id from public.qa_defect_events where defect_id=$1 and note like 'Automatically closed from%'",[a])).rows[0].actor_id,null)
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1",[wall])).rows[0].review_status,"returned")
    await db.exec("rollback"); await as("autoEng")
  })
  await test("Correction inspection: Engineer starts exact reinspection, cancellation keeps its NCR open and allows a fresh request",async()=>{
    const cancelled=await request([b])
    const aBefore=await ncr(a)
    const snapshot=(await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[cancelled])).rows[0]
    for(const who of ["autoFore","autoOut"]) {
      await as(who)
      await expectFail("select public.start_inspection($1)",[cancelled],/not allowed|not found/)
      await expectFail("select public.cancel_inspection($1,'Cannot cancel this package')",[cancelled],/Only the project Engineer|not allowed|not found/)
      await expectFail("select public.return_cancelled_reinspection_ncrs()",[],/permission denied/)
    }
    await as("autoEng")
    await db.query("select public.start_inspection($1)",[cancelled])
    const started=(await db.query("select status,inspector_id,started_at from public.qa_inspections where id=$1",[cancelled])).rows[0]
    assert.equal(started.status,"in_progress"); assert.equal(started.inspector_id,ids.autoEng); assert.ok(started.started_at)
    await expectFail("select public.start_inspection($1)",[cancelled],/requested/)
    await expectFail("select public.cancel_inspection($1,'no')",[cancelled],/reason/)
    assert.equal((await ncr(b)).status,"for_verification")
    const recorded=await checks(cancelled)
    await db.query("select public.cancel_inspection($1,'Fresh measurements need to be supplied')",[cancelled])
    assert.equal((await db.query("select status from public.qa_inspections where id=$1",[cancelled])).rows[0].status,"cancelled")
    assert.equal((await ncr(b)).status,"in_progress")
    assert.equal((await ncr(b)).fixed_at,null); assert.equal((await ncr(b)).closed_at,null)
    assert.deepEqual(await ncr(a),aBefore,"A closed or unrelated finding is untouched")
    assert.deepEqual(await checks(cancelled),recorded)
    assert.deepEqual((await db.query("select * from public.pin_qa_submissions where inspection_id=$1",[cancelled])).rows[0],snapshot)
    const rejection=(await db.query("select note from public.qa_defect_events where defect_id=$1 and note like 'Reinspection IR-% cancelled.%'",[b])).rows
    assert.equal(rejection.length,1); assert.match(rejection[0].note,/Fresh measurements need to be supplied/)
    await expectFail("select public.cancel_inspection($1,'Do not cancel twice')",[cancelled],/cannot be cancelled/)
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1",[wall])).rows[0].review_status,"returned")
  })
  await test("Correction inspection: cancellation before Start also returns the exact package for another correction",async()=>{
    const cancelled=await request([b])
    await as("autoEng")
    await db.query("select public.cancel_inspection($1,'Not ready for the scheduled inspection')",[cancelled])
    assert.equal((await ncr(b)).status,"in_progress")
    assert.equal((await ncr(b)).closed_at,null)
  })
  await test("Auto NCR: a later passing correction closes once without mandatory remarks, but checklist completion is manual",async()=>{
    final=await request([b])
    await as("autoEng"); await db.query("select public.start_inspection($1)",[final])
    for(const row of await checks(final)) {
      await db.query("select public.save_inspection_item($1,'pass')",[row.id])
      if(row.requires_photo) await photo(final,row.id)
    }
    await db.query("select public.complete_inspection($1)",[final])
    assert.equal((await ncr(b)).status,"closed")
    assert.match((await ncr(b)).closing_note,/Automatically closed.*IR-/)
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1",[wall])).rows[0].review_status,"for_review")
    await expectFail("select public.complete_inspection($1)",[final],/in progress/)
    for(const finding of [a,b]) assert.equal(Number((await db.query("select count(*) n from public.qa_defect_events where defect_id=$1 and kind='closed'",[finding])).rows[0].n),1)
    await db.query("select public.review_checklist_item($1,true)",[wall])
    assert.equal((await db.query("select status from public.pins where id=$1",[pin])).rows[0].status,"verified")
  })
}
