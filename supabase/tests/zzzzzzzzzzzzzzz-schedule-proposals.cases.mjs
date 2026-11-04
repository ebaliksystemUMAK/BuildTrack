import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  const owner=async()=>{await asOwner();await db.query("select set_config('request.jwt.claims','{}',false)")}
  await owner()
  for(const[key,role]of [["spEng","engineer"],["spPM","project_manager"],["spOtherPM","project_manager"],["spFore","foreman"],["spClient","client"],["spAdmin","admin"]])await addUser(key,role)
  const project=(await db.query("insert into public.projects(code,name) values('SP-1','Schedule approval workflow') returning id")).rows[0].id
  await db.query("insert into public.project_managers(project_id,user_id,designation) values($1,$2,'primary')",[project,ids.spPM])
  for(const key of ["spEng","spFore","spClient"])await db.query("insert into public.project_members(project_id,user_id) values($1,$2)",[project,ids[key]])
  await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','assigned') on conflict(project_id,user_id,blueprint_type) do update set access_level='assigned'",[project,ids.spEng])
  const sheet=(await db.query("insert into public.blueprints(project_id,title,blueprint_type) values($1,'Approval plan','architectural') returning id",[project])).rows[0].id
  const read=async()=> (await db.query("select public.get_project_timeline($1) data",[project])).rows[0].data
  let pin,a,b,requestA,requestB
  const plan=(start,end,extra={})=>({title:"Work task",phase:"Foundation",planned_start:start,planned_end:end,actual_start:null,actual_end:null,predecessors:[],...extra})

  await test("Schedule proposals: Engineer creates a pin and private date draft atomically, without official dates",async()=>{
    await as("spEng")
    pin=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,20,20,'Foundation work','progress','2026-12-01','2026-12-10','Foundation','Sequenced after excavation')",[sheet])).rows[0]
    assert.equal(pin.planned_start,null);assert.equal(pin.due_date,null)
    const proposal=(await db.query("select public.get_pin_schedule_proposal($1) data",[pin.id])).rows[0].data
    assert.equal(proposal.draft.expected_revision,1);assert.equal(proposal.draft.proposal.planned_start,"2026-12-01")
    assert.equal((await read()).requests.length,0,"An unsent draft is not in the schedule review inbox")
    await expectFail("update public.pins set due_date='2026-12-10' where id=$1",[pin.id],/Official dates/)
    await as("spClient");await expectFail("select public.get_pin_schedule_proposal($1)",[pin.id],/unavailable/)
    const client=await read();assert.equal(client.items.length,0)
  })
  await test("Schedule proposals: creation failure rolls back the pin; draft revisions prevent overwrites",async()=>{
    await as("spEng")
    await expectFail("select public.create_pin_with_schedule_proposal($1,null,20,20,'Invalid schedule pin','progress','2026-12-10','2026-12-01','Foundation','Invalid ordering')",[sheet],/valid proposed/)
    assert.equal((await db.query("select count(*)::int n from public.pins where blueprint_id=$1",[sheet])).rows[0].n,1)
    await expectFail("select public.save_pin_schedule_draft($1,'2026-12-01','2026-12-10','Foundation','A changed proposal',0)",[pin.id],/proposal changed/)
    a=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'Excavate') returning id",[pin.id,project])).rows[0].id
    b=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'Pour concrete') returning id",[pin.id,project])).rows[0].id
  })
  await test("Schedule proposals: submit covers current tasks; no official date or QA state changes before approval",async()=>{
    await as("spEng")
    const count=(await db.query("select public.submit_pin_schedule_proposal($1,'2026-12-01','2026-12-10','Foundation','Sequenced after excavation',1) n",[pin.id])).rows[0].n
    assert.equal(count,2)
    const data=await read();assert.equal(data.requests.length,2)
    requestA=data.requests.find(row=>row.work_key===`task:${a}`)
    requestB=data.requests.find(row=>row.work_key===`task:${b}`)
    assert.ok(data.items.every(row=>row.planned_start===null&&!row.verified))
    await expectFail("update public.pin_checklist_items set planned_start='2026-12-01',due_date='2026-12-10' where id=$1",[a],/Official dates|permission denied/)
    await as("spAdmin","aal2");assert.equal((await read()).can_edit,false)
    await expectFail("select public.decide_timeline_request($1,true,'Approved planned dates')",[requestA.id],/unavailable/)
    await as("spOtherPM");await expectFail("select public.decide_timeline_request($1,true,'Approved planned dates')",[requestA.id],/unavailable/)
  })
  await test("Schedule proposals: PM adjusts and approves; task, pin and timeline share dates while original proposal is retained",async()=>{
    await as("spPM")
    await db.query("select public.decide_timeline_request($1,true,'Adjusted after resource review',$2::jsonb)",[requestA.id,JSON.stringify(plan("2026-12-02","2026-12-05",{phase:"Structural"}))])
    const data=await read(),row=data.items.find(item=>item.key===`task:${a}`),req=data.requests.find(req=>req.id===requestA.id)
    assert.equal(row.planned_start,"2026-12-02");assert.equal(row.phase,"Structural");assert.equal(row.verified,false)
    assert.equal(req.proposal.planned_start,"2026-12-01");assert.equal(req.approved_plan.planned_start,"2026-12-02")
    await owner()
    const task=(await db.query("select planned_start::text,due_date::text,done,review_status from public.pin_checklist_items where id=$1",[a])).rows[0]
    assert.equal(task.planned_start,row.planned_start);assert.equal(task.due_date,row.planned_end);assert.equal(task.done,false)
    const parent=(await db.query("select planned_start::text,due_date::text from public.pins where id=$1",[pin.id])).rows[0]
    assert.deepEqual(parent,{planned_start:"2026-12-02",due_date:"2026-12-05"})
  })
  await test("Schedule proposals: later task approval updates aggregate pin range and dependencies; Client waits for publication",async()=>{
    await as("spPM")
    await db.query("select public.decide_timeline_request($1,true,'Concrete follows accepted excavation',$2::jsonb)",[requestB.id,JSON.stringify(plan("2026-12-06","2026-12-10",{predecessors:[`task:${a}`]}))])
    await as("spClient");assert.equal((await read()).items.length,0)
    await as("spPM");await db.query("select public.publish_project_timeline($1,'Initial coordinated construction schedule')",[project])
    await as("spClient");const published=await read();assert.equal(published.items.length,2);assert.equal(published.items.find(row=>row.key===`task:${b}`).planned_start,"2026-12-06")
    assert.ok(!JSON.stringify(published).includes("approved_plan"))
    await owner();assert.deepEqual((await db.query("select planned_start::text,due_date::text from public.pins where id=$1",[pin.id])).rows[0],{planned_start:"2026-12-02",due_date:"2026-12-10"})
  })
  await test("Schedule proposals: new requests need fresh PM approval, publication remains stable, archived proposals are blocked",async()=>{
    await as("spEng")
    await db.query("select public.request_timeline_change($1,$2,$3::jsonb,1,'Excavation needs an earlier start')",[project,`task:${a}`,JSON.stringify(plan("2026-12-01","2026-12-05"))])
    let data=await read();const req=data.requests.find(row=>row.status==='pending')
    await as("spPM");await db.query("select public.review_timeline_change($1,false,'Keep the approved coordinated dates')",[req.id])
    await as("spClient");assert.equal((await read()).items.find(row=>row.key===`task:${a}`).planned_start,"2026-12-02")
    await owner();await db.query("update public.projects set archived_at=now() where id=$1",[project])
    await as("spEng");await expectFail("select public.submit_pin_schedule_proposal($1,'2026-12-01','2026-12-10','Foundation','Sequenced after excavation',2)",[pin.id],/open project work/)
  })
  await test("Schedule proposals: PM date updates preserve verified task evidence and QA locks",async()=>{
    await owner();await db.query("update public.projects set archived_at=null where id=$1",[project])
    await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','assigned') on conflict(project_id,user_id,blueprint_type) do update set access_level='assigned'",[project,ids.spFore])
    // Trusted historical fixture, as in the load suite: exercise the existing verified-state lock,
    // without manufacturing a new inspection/approval workflow. Nothing here reaches the hosted DB.
    await db.exec("set session_replication_role=replica")
    try { await db.query("update public.pin_checklist_items set done=true,review_status='verified',verified_by=$2,verified_at=now() where id=$1",[a,ids.spEng]) }
    finally { await db.exec("set session_replication_role=origin") }
    await as("spEng")
    const before=(await db.query("select text,done,review_status,review_inspection_id,verified_by,verified_at,remark from public.pin_checklist_items where id=$1",[a])).rows[0]
    assert.equal(before.review_status,"verified")
    await as("spPM");await db.query("select public.save_timeline_item($1,$2,$3::jsonb,1,'Align accepted work with the approved schedule')",[project,`task:${a}`,JSON.stringify(plan("2026-12-01","2026-12-05"))])
    await owner();const after=(await db.query("select text,done,review_status,review_inspection_id,verified_by,verified_at,remark from public.pin_checklist_items where id=$1",[a])).rows[0]
    assert.deepEqual(after,before,"Only schedule metadata may change on verified work")
    await as("spEng");await expectFail("update public.pin_checklist_items set text='Changed verified evidence' where id=$1",[a],/Reopen|locked/)
  })
}
