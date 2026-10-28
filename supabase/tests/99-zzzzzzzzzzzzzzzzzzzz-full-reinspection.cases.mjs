import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

export default async function(ctx) {
  const { db, ids, as, asOwner, addUser, test, expectFail } = ctx
  await asOwner()
  for (const [key, role] of [["targetEng","engineer"],["targetFore","foreman"],["targetClient","client"],["targetOut","engineer"]]) await addUser(key,role)
  const project=(await db.query("insert into public.projects(code,name,site_lat,site_lng) values('TARGET-QA','Synthetic full checklist QA',14.5,121) returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3),($1,$4)",[project,ids.targetEng,ids.targetFore,ids.targetClient])
  await as("targetEng")
  const sheet=(await db.query("insert into public.blueprints(project_id,title) values($1,'Full reinspection plan') returning id",[project])).rows[0].id
  const pin=(await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,20,20,'LAUNDRY',$3) returning id",[project,sheet,ids.targetFore])).rows[0].id
  const criteria=JSON.stringify([
    {text:"Synthetic alignment",acceptance_criteria:"Synthetic alignment passing requirement",severity:"major"},
    {text:"Synthetic opening",acceptance_criteria:"Synthetic opening passing requirement",severity:"major"},
    {text:"Synthetic finish",acceptance_criteria:"Synthetic finish passing requirement",severity:"minor",requires_photo:true},
  ])
  const wall=(await db.query("select public.save_work_checklist_item($1,null,'WALL',$2::jsonb) id",[pin,criteria])).rows[0].id
  const pinPhoto=async(attempt=null)=>{
    await as("targetFore")
    return db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path,lat,lng,taken_at) values($1,$2,$3,$4,$5,14.5,121,now()) returning id",[project,pin,wall,attempt,`${project}/${pin}/${randomUUID()}.jpg`])
  }
  const draft=async()=>{
    await as("targetFore")
    const id=(await db.query("select public.begin_checklist_resubmission($1) id",[wall])).rows[0].id
    await db.query("select public.save_checklist_attempt($1,'Synthetic repair completed and new measurements taken')",[id]); await pinPhoto(id)
    return id
  }
  const submit=async ncr=>{
    await draft()
    return (await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id",[[wall],[ncr]])).rows[0].id
  }
  const items=async ir=>(await db.query("select * from public.qa_inspection_items where inspection_id=$1 order by position",[ir])).rows
  const status=async(table,id)=>(await db.query(`select status from public.${table} where id=$1`,[id])).rows[0].status
  const finish=async(ir,failText=null)=>{
    await as("targetEng")
    if(await status("qa_inspections",ir)==="requested") await db.query("select public.start_inspection($1)",[ir])
    for(const row of await items(ir)) {
      if(row.requires_photo) await db.query("insert into public.qa_photos(project_id,inspection_id,item_id,path) values($1,$2,$3,$4)",[project,ir,row.id,`${project}/${ir}/${row.id}.jpg`])
      await db.query("select public.save_inspection_item($1,$2,null,$3)",[row.id,row.text===failText?"fail":"pass",row.text===failText?"Synthetic repaired finding still out of tolerance":null])
    }
    await db.query("select public.complete_inspection($1,'Synthetic full checklist verification')",[ir])
  }
  let initial, originals, snapshot, ncrA, ncrB, repair, retry, final
  await test("Full checklist QA: initial failure retains original evidence and raises findings, not a project-wide resubmission",async()=>{
    await pinPhoto()
    initial=(await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id",[pin,[wall]])).rows[0].id
    await as("targetEng"); await db.query("select public.start_inspection($1)",[initial])
    for(const row of await items(initial)) {
      if(row.requires_photo) await db.query("insert into public.qa_photos(project_id,inspection_id,item_id,path) values($1,$2,$3,$4)",[project,initial,row.id,`${project}/${initial}/finish.jpg`])
      await db.query("select public.save_inspection_item($1,$2,null,$3)",[row.id,row.text==="Synthetic finish"?"pass":"fail",row.text==="Synthetic finish"?null:"Synthetic original failed observation"])
    }
    await db.query("select public.complete_inspection($1,'Two isolated synthetic findings')",[initial])
    originals=await items(initial)
    snapshot=(await db.query("select checklist_snapshot,photos_snapshot from public.pin_qa_submissions where inspection_id=$1",[initial])).rows[0]
    const ncrs=(await db.query("select * from public.qa_defects where inspection_id=$1 order by number",[initial])).rows
    assert.equal(ncrs.length,2); [ncrA,ncrB]=ncrs.map(row=>row.id)
    assert.equal(await status("qa_inspections",initial),"failed")
  })
  await test("Full checklist QA: one selected NCR still creates every check as Pending, with frozen criteria and read-only history",async()=>{
    await draft()
    await expectFail("select public.submit_correction_package($1::uuid[],'{}'::uuid[])",[[wall]],/Select at least one NCR finding/)
    repair=await submit(ncrA)
    const checks=await items(repair)
    assert.deepEqual(checks.map(row=>[row.text,row.result,row.origin_item_id]),originals.map(row=>[row.text,"pending",row.id]))
    assert.equal(checks[0].acceptance_criteria,originals[0].acceptance_criteria)
    assert.equal((await db.query("select full_checklist_reinspection from public.qa_inspections where id=$1",[repair])).rows[0].full_checklist_reinspection,true)
    const context=(await db.query("select public.qa_reinspection_context($1) rows",[repair])).rows[0].rows
    assert.deepEqual(context.map(row=>[row.text,row.result]),[["Synthetic alignment","fail"],["Synthetic opening","fail"],["Synthetic finish","pass"]])
    assert.equal(await status("qa_defects",ncrB),"open")
    assert.deepEqual(await items(initial),originals)
  })
  await test("Full checklist QA: scope cannot be narrowed and only authorized staff read history/readiness",async()=>{
    for(const who of ["targetFore","targetClient","targetOut","admin"]) {
      await as(who,who==="admin"?"aal2":"aal1")
      await expectFail("select public.configure_full_qa_reinspection($1)",[repair],/permission denied/)
      await expectFail("delete from public.qa_inspection_items where inspection_id=$1",[repair],/permission denied|row-level security/)
    }
    for(const who of ["targetClient","targetOut"]) {
      await as(who); await expectFail("select public.qa_reinspection_context($1)",[repair],/access denied/)
      await expectFail("select public.qa_ncr_reinspection_state($1)",[ncrA],/access denied/)
    }
    await as("targetEng")
    await expectFail("select public.configure_full_qa_reinspection($1)",[repair],/permission denied/)
    await expectFail("select public.verify_defect($1,true,'Synthetic attempt to close early')",[ncrA],/Pass the linked reinspection|passed linked/)
    await db.query("select public.start_inspection($1)",[repair])
    assert.equal((await items(repair)).length,3)
  })
  await test("Full checklist QA: failed correction stays on the same NCR; previously passed checks need fresh results and evidence",async()=>{
    await expectFail("select public.complete_inspection($1,'Cannot skip the other Wall checks')",[repair],/Every item needs a result/)
    for(const row of await items(repair)) await db.query("select public.save_inspection_item($1,$2,null,$3)",[row.id,row.text==="Synthetic alignment"?"fail":"pass",row.text==="Synthetic alignment"?"Synthetic correction remains unsatisfactory":null])
    await expectFail("select public.complete_inspection($1,'Missing fresh finish evidence')",[repair],/photo/i)
    await finish(repair,"Synthetic alignment")
    assert.equal(await status("qa_defects",ncrA),"in_progress")
    assert.equal(Number((await db.query("select count(*) n from public.qa_defects where pin_id=$1",[pin])).rows[0].n),2)
    assert.match((await db.query("select note from public.qa_defect_events where defect_id=$1 and kind='rejected' order by id desc limit 1",[ncrA])).rows[0].note,/Reinspection IR-/)
    assert.deepEqual(await items(initial),originals)
  })
  await test("Full checklist QA: a full failed request permits the passed NCR to close, but other findings block WALL completion",async()=>{
    retry=await submit(ncrA)
    assert.deepEqual((await items(retry)).map(row=>row.text),originals.map(row=>row.text))
    await finish(retry,"Synthetic opening")
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1",[wall])).rows[0].review_status,"returned")
    assert.equal(await status("qa_defects",ncrA),"closed", "This finding's Pass closes its NCR even when another check failed")
    const closed=(await db.query("select closed_by,closing_note from public.qa_defects where id=$1",[ncrA])).rows[0]
    assert.equal(closed.closed_by,ids.targetEng)
    assert.match(closed.closing_note,/Automatically closed.*IR-.*Remarks: Synthetic full checklist verification/)
    assert.equal(Number((await db.query("select count(*) n from public.qa_defect_events where defect_id=$1 and kind='closed'",[ncrA])).rows[0].n),1)
    assert.equal(await status("qa_defects",ncrB),"in_progress")
    // Simulate an NCR submitted through an older direct-verification path. A's Pass must not close B.
    await asOwner()
    await db.query("update public.qa_defects set status='for_verification',corrective_action='Synthetic direct correction request' where id=$1",[ncrB])
    await as("targetEng")
    await expectFail("select public.verify_defect($1,true,'Try to use the other finding pass')",[ncrB],/this NCR finding/)
    await db.query("select public.verify_defect($1,false,'Opening still requires its own reinspection')",[ncrB])
    await expectFail("select public.review_checklist_item($1,true)",[wall],/submitted|NCR|pass QA/)
    assert.notEqual(await status("pins",pin),"verified")
  })
  await test("Full checklist QA: the next correction again checks all criteria; completion stays manual after NCR closure",async()=>{
    final=await submit(ncrB)
    assert.deepEqual((await items(final)).map(row=>[row.text,row.origin_item_id]),originals.map(row=>[row.text,row.id]))
    await finish(final)
    assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1",[wall])).rows[0].review_status,"for_review")
    assert.equal(await status("qa_defects",ncrB),"closed")
    assert.notEqual(await status("pins",pin),"verified")
    await db.query("select public.review_checklist_item($1,true)",[wall])
    assert.equal(await status("pins",pin),"verified")
    assert.deepEqual(await items(initial),originals)
    assert.deepEqual((await db.query("select checklist_snapshot,photos_snapshot from public.pin_qa_submissions where inspection_id=$1",[initial])).rows[0],snapshot)
  })
  await test("Full checklist QA: internal full-snapshot helpers are not callable by API roles and no narrow-scope RPC exists",async()=>{
    await as("targetFore")
    for(const fn of ["qa_prior_criteria","configure_full_qa_reinspection","qa_ncr_verified_inspection"]) await expectFail(`select public.${fn}($1)`,[final],/permission denied/)
    await as(null)
    await expectFail("select public.qa_reinspection_context($1)",[final],/permission denied/)
    await expectFail("select public.qa_ncr_reinspection_state($1)",[ncrA],/permission denied/)
    assert.equal((await db.query("select to_regprocedure('public.add_qa_reinspection_check(uuid,uuid,text)') id")).rows[0].id,null)
  })
  await test("Full checklist QA: full recheck discovers a new failure in previously passed work and invalidates superseded Passes",async()=>{
    await as("targetEng")
    const otherPin=(await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,40,40,'Independent wall',$3) returning id",[project,sheet,ids.targetFore])).rows[0].id
    const otherWall=(await db.query("select public.save_work_checklist_item($1,null,'WALL',$2::jsonb) id",[otherPin,JSON.stringify([
      {text:"Independent check A",acceptance_criteria:"Synthetic A pass condition",severity:"major"},
      {text:"Independent check B",acceptance_criteria:"Synthetic B pass condition",severity:"major"},
    ])])).rows[0].id
    const evidence=async(attempt=null)=>db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path) values($1,$2,$3,$4,$5)",[project,otherPin,otherWall,attempt,`${project}/${otherPin}/${randomUUID()}.jpg`])
    const inspect=async(ir,failures)=>{
      await as("targetEng");await db.query("select public.start_inspection($1)",[ir])
      for(const row of await items(ir))await db.query("select public.save_inspection_item($1,$2,null,$3)",[row.id,failures.includes(row.text)?"fail":"pass",failures.includes(row.text)?"Synthetic finding failed again":null])
      await db.query("select public.complete_inspection($1,'Independent findings verified')",[ir])
    }
    const request=async(ncrs)=>{
      await as("targetFore")
      const a=(await db.query("select public.begin_checklist_resubmission($1) id",[otherWall])).rows[0].id
      await db.query("select public.save_checklist_attempt($1,'Synthetic independent finding corrections')",[a]);await evidence(a)
      return (await db.query("select public.submit_correction_package($1::uuid[],$2::uuid[]) id",[[otherWall],ncrs])).rows[0].id
    }
    await as("targetFore");await evidence()
    const first=(await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id",[otherPin,[otherWall]])).rows[0].id
    await inspect(first,["Independent check A"])
    const firstFinding=(await db.query("select id from public.qa_defects where inspection_id=$1",[first])).rows[0].id
    const second=await request([firstFinding]);await inspect(second,["Independent check B"])
    const findings=(await db.query("select id from public.qa_defects where pin_id=$1 order by number",[otherPin])).rows.map(row=>row.id)
    assert.equal(findings.length,2,"A newly failed formerly passing criterion raises its own NCR")
    assert.equal(await status("qa_inspections",second),"failed")
    const a=(await db.query("select public.qa_ncr_reinspection_state($1) state",[findings[0]])).rows[0].state
    const b=(await db.query("select public.qa_ncr_reinspection_state($1) state",[findings[1]])).rows[0].state
    assert.equal(a.ready,true);assert.equal(a.status,"failed");assert.equal(b.ready,false)
    await db.exec("begin")
    await asOwner()
    await db.query("update public.qa_defects set fixed_at=now()+interval '1 minute' where id=$1",[findings[0]])
    await as("targetEng")
    assert.equal((await db.query("select public.qa_ncr_reinspection_state($1) state",[findings[0]])).rows[0].state.ready,false,"A Pass before the latest repair cannot authorize closure")
    await db.exec("rollback")
    await as("targetEng")
    assert.equal(await status("qa_defects",findings[0]),"closed")
    // Model a historical passed inspection whose NCR was never closed before this migration.
    await asOwner()
    await db.query("update public.qa_defects set status='for_verification',closed_at=null,closed_by=null,closing_note=null where id=$1",[findings[0]])
    await as("targetEng")
    assert.equal(await status("qa_defects",findings[1]),"open")
    assert.notEqual(await status("pins",otherPin),"verified")
    const third=await request([findings[1]]);assert.deepEqual((await items(third)).map(row=>row.text),["Independent check A","Independent check B"])
    await as("targetEng")
    assert.equal((await db.query("select public.qa_ncr_reinspection_state($1) state",[findings[0]])).rows[0].state.ready,false,"A pending recheck of A invalidates the previous A Pass")
    await inspect(third,["Independent check A"])
    assert.equal((await db.query("select public.qa_ncr_reinspection_state($1) state",[findings[0]])).rows[0].state.ready,false,"A failed later recheck cannot reuse an older Pass")
    await asOwner();await db.query("update public.qa_defects set status='for_verification' where id=$1",[findings[0]])
    await as("targetEng")
    await expectFail("select public.verify_defect($1,true,'Try the now superseded earlier Pass')",[findings[0]],/this NCR finding/)
    await db.query("select public.verify_defect($1,false,'A needs another corrected reinspection')",[findings[0]])
    assert.equal(await status("qa_defects",findings[1]),"closed")
    assert.notEqual(await status("pins",otherPin),"verified")
    const fourth=await request([findings[0]])
    assert.deepEqual((await items(fourth)).map(row=>row.text),["Independent check A","Independent check B"])
    await inspect(fourth,[])
    assert.equal(await status("qa_defects",findings[0]),"closed")
    await db.query("select public.review_checklist_item($1,true)",[otherWall])
    assert.equal(await status("pins",otherPin),"verified")
  })
}
