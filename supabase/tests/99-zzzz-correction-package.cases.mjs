import assert from "node:assert/strict"

// Work item QA (20261018170000): one correction package answers the item's QA return and its NCRs together; acceptance waits for
// the item's own NCRs; a rejected correction returns the item; work completes when the last blocker clears. Synthetic criteria only.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  await asOwner()
  for (const [key, role] of [["pkgEng","engineer"],["pkgFore","foreman"],["pkgFore2","foreman"],["pkgOut","engineer"]]) await addUser(key,role)
  const project=(await db.query("insert into public.projects(code,name,site_lat,site_lng) values('PKG-QA','Correction package test',14.5,121) returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id,user_id) values($1,$2),($1,$3),($1,$4)",[project,ids.pkgEng,ids.pkgFore,ids.pkgFore2])
  const sheet=(await db.query("insert into public.blueprints(project_id,title) values($1,'Package plan') returning id",[project])).rows[0].id
  await as("pkgEng")
  const pin=(await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,30,30,'LAUNDRY',$3) returning id",[project,sheet,ids.pkgFore])).rows[0].id
  const floor=(await db.query("insert into public.pin_checklist_items(project_id,pin_id,text) values($1,$2,'FLOOR') returning id",[project,pin])).rows[0].id
  const wall=(await db.query("insert into public.pin_checklist_items(project_id,pin_id,text) values($1,$2,'WALL') returning id",[project,pin])).rows[0].id
  const template=(await db.query("select public.save_qa_template(null,$1,'Synthetic package criteria','general',null,'{}',$2::jsonb) id",[project,JSON.stringify([
    { text:"Synthetic level observation", severity:"major" }, { text:"Synthetic finish observation", severity:"minor" },
  ])])).rows[0].id
  await db.query("select public.approve_pin_qa_checklist($1,$2)",[pin,template])

  const photo=async(item,name,attempt=null)=>{
    await as("pkgFore")
    return (await db.query("insert into public.pin_photos(project_id,pin_id,checklist_item_id,qa_attempt_id,path,lat,lng,taken_at) values($1,$2,$3,$4,$5,14.5,121,now()) returning id",[project,pin,item,attempt,`${project}/${pin}/${name}.jpg`])).rows[0].id
  }
  const finish=async(ir,results)=>{
    await as("pkgEng")
    await db.query("select public.start_inspection($1)",[ir])
    for (const row of (await db.query("select id,text from public.qa_inspection_items where inspection_id=$1",[ir])).rows) {
      const result=results[row.text] ?? "pass"
      await db.query("select public.save_inspection_item($1,$2,null,$3)",[row.id,result,result==="fail"?"Synthetic observation out of tolerance":null])
    }
    await db.query("select public.complete_inspection($1,'Synthetic inspection findings')",[ir])
  }
  const draftFor=async(item,remarks)=>{
    await as("pkgFore")
    const id=(await db.query("select public.begin_checklist_resubmission($1) id",[item])).rows[0].id
    await db.query("select public.save_checklist_attempt($1,$2)",[id,remarks])
    return id
  }
  const pkg=(items,defects,extra=[])=>db.query("select public.submit_correction_package($1::uuid[],$2::uuid[],$3,$4) id",[items,defects,extra[0]??null,extra[1]??null])
  const status=async(table,id)=>(await db.query(`select status from public.${table} where id=$1`,[id])).rows[0].status
  const reviewOf=async(item)=>(await db.query("select review_status from public.pin_checklist_items where id=$1",[item])).rows[0].review_status

  let firstIr, floorNcr, siteNcr, floorDraft, packageIr, wallNcr
  await test("Correction package: refused before a correction is started, and for the Engineer or another Foreman",async()=>{
    await photo(floor,"floor-initial")
    await db.query("update public.pin_checklist_items set done=true where id=$1",[floor])
    firstIr=(await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id",[pin,[floor]])).rows[0].id
    await finish(firstIr,{ "Synthetic level observation":"fail" })
    floorNcr=(await db.query("select id from public.qa_defects where inspection_id=$1",[firstIr])).rows[0].id
    assert.equal(await reviewOf(floor),"returned")
    await as("pkgFore")
    await expectFail("select public.submit_correction_package($1::uuid[],$2::uuid[])",[[floor],[floorNcr]],/Start the correction/)
    for (const who of ["pkgEng","pkgFore2"]) {
      await as(who)
      await expectFail("select public.submit_correction_package($1::uuid[],$2::uuid[])",[[floor],[floorNcr]],/active Foreman assigned/)
    }
  })

  await test("Correction package: only open NCRs linked to the item; the corrective action must be described",async()=>{
    await as("pkgEng")
    siteNcr=(await db.query("select public.raise_defect($1,'Synthetic site finding','Debris left at the doorway','workmanship','minor','general',null,$2,$3,null) id",[project,pin,ids.pkgFore])).rows[0].id
    floorDraft=await draftFor(floor,"Fixed!")
    await photo(floor,"floor-correction-1",floorDraft)
    await as("pkgFore")
    await expectFail("select public.submit_correction_package($1::uuid[],$2::uuid[])",[[floor],[siteNcr]],/not linked/)
    await expectFail("select public.submit_correction_package($1::uuid[],$2::uuid[])",[[floor],[floorNcr]],/at least 10 characters/)
    assert.equal(await status("qa_defects",floorNcr),"open")
    assert.equal(await count("select count(*) n from public.qa_inspections where pin_id=$1 and status in ('requested','in_progress')",[pin]),0)
  })

  await test("Correction package: one submission re-inspects the item and sends the chosen NCR for verification with the same evidence",async()=>{
    await db.query("select public.save_checklist_attempt($1,'Re-levelled the slab and ground the high spots')",[floorDraft])
    await as("pkgFore")
    packageIr=(await pkg([floor],[floorNcr],["Screed level not checked before pour","Check level with a straightedge before handover"])).rows[0].id
    const ir=(await db.query("select status,reinspection_of from public.qa_inspections where id=$1",[packageIr])).rows[0]
    assert.equal(ir.status,"requested"); assert.equal(ir.reinspection_of,firstIr)
    const ncr=(await db.query("select status,corrective_action,root_cause,preventive_action,correction_attempt_id,fixed_by from public.qa_defects where id=$1",[floorNcr])).rows[0]
    assert.equal(ncr.status,"for_verification")
    assert.equal(ncr.corrective_action,"Re-levelled the slab and ground the high spots")
    assert.equal(ncr.root_cause,"Screed level not checked before pour")
    assert.equal(ncr.correction_attempt_id,floorDraft)
    assert.equal(ncr.fixed_by,ids.pkgFore)
    assert.equal(await reviewOf(floor),"for_review")
    assert.equal(await status("pins",pin),"for_review")
    assert.equal((await db.query("select submitted_inspection_id from public.qa_work_attempts where id=$1",[floorDraft])).rows[0].submitted_inspection_id,packageIr)
    assert.equal(await count("select count(*) n from public.qa_defect_events where defect_id=$1 and to_status='for_verification'",[floorNcr]),1)
    await asOwner()
    assert.equal(await count("select count(*) n from public.notifications where user_id=$1 and title like 'Correction package:%'",[ids.pkgEng]),1)
    await as("pkgFore")
    await expectFail("select public.submit_correction_package($1::uuid[],$2::uuid[])",[[floor],[]],/Start the correction|pending/)
  })

  await test("Correction package: acceptance waits for the item's own NCR, not for unrelated pin NCRs",async()=>{
    await finish(packageIr,{})
    assert.equal(await reviewOf(floor),"for_review")
    assert.equal(await status("qa_defects",floorNcr),"closed", "Passing reinspection automatically closes its linked NCR")
    assert.equal(await status("qa_defects",siteNcr),"open")
    await db.query("select public.review_checklist_item($1,true)",[floor])
    assert.equal(await reviewOf(floor),"verified")
    assert.notEqual(await status("pins",pin),"verified")
  })

  await test("Correction package: an NCR correction sent back returns its work item to the correction form",async()=>{
    await photo(wall,"wall-initial")
    await db.query("update public.pin_checklist_items set done=true where id=$1",[wall])
    const wallIr=(await db.query("select public.submit_checklist_qa($1,$2::uuid[]) id",[pin,[wall]])).rows[0].id
    await finish(wallIr,{ "Synthetic finish observation":"fail" })
    wallNcr=(await db.query("select id from public.qa_defects where inspection_id=$1",[wallIr])).rows[0].id
    const draft=await draftFor(wall,"Repainted the wall with two coats")
    await photo(wall,"wall-correction-1",draft)
    await as("pkgFore")
    const ir=(await pkg([wall],[wallNcr])).rows[0].id
    await finish(ir,{ "Synthetic finish observation":"fail" })
    assert.equal(await status("qa_defects",wallNcr),"in_progress")
    assert.equal(await reviewOf(wall),"returned")
    assert.equal(await reviewOf(floor),"verified")
    assert.equal(await status("pins",pin),"in_progress")
    const again=await draftFor(wall,"Third coat applied and corner sanded")
    await photo(wall,"wall-correction-2",again)
    await as("pkgFore")
    const retry=(await pkg([wall],[wallNcr])).rows[0].id
    assert.equal((await db.query("select correction_attempt_id from public.qa_defects where id=$1",[wallNcr])).rows[0].correction_attempt_id,again)
    await finish(retry,{})
  })

  await test("Correction package: work completes when the last blocker clears, never before",async()=>{
    await as("pkgEng")
    assert.equal(await status("qa_defects",wallNcr),"closed")
    await db.query("select public.review_checklist_item($1,true)",[wall])
    assert.notEqual(await status("pins",pin),"verified")
    await as("pkgFore")
    await db.query("select public.update_defect($1,'in_progress')",[siteNcr])
    await db.query("select public.update_defect($1,'for_verification','Removed the debris and swept the doorway')",[siteNcr])
    assert.notEqual(await status("pins",pin),"verified")
    await as("pkgEng")
    await db.query("select public.verify_defect($1,true,'Doorway checked clean')",[siteNcr])
    assert.equal(await status("pins",pin),"verified")
  })

  await test("Correction package: outsiders and anonymous callers cannot use it; internal helpers are not callable",async()=>{
    await as("pkgOut")
    await expectFail("select public.submit_correction_package($1::uuid[],$2::uuid[])",[[floor],[]],/active Foreman assigned/)
    for (const sql of ["select public.item_defect_ids($1)","select public.try_complete_work($1)"]) {
      await as("pkgFore")
      await expectFail(sql,[sql.includes("item") ? floor : pin],/permission denied/)
    }
    await as(null)
    await expectFail("select public.submit_correction_package($1::uuid[],$2::uuid[])",[[floor],[]],/permission denied/)
  })
}
