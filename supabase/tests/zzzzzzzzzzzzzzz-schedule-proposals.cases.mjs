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

  await test("Schedule proposals: Engineer creates a pin and sends its proposed schedule atomically, without official dates",async()=>{
    await as("spEng")
    pin=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,20,20,'Foundation work','progress','2026-12-01','2026-12-10','Foundation','Sequenced after excavation')",[sheet])).rows[0]
    assert.equal(pin.planned_start,null);assert.equal(pin.due_date,null)
    const proposal=(await db.query("select public.get_pin_schedule_proposal($1) data",[pin.id])).rows[0].data
    assert.equal(proposal.draft.expected_revision,1);assert.equal(proposal.draft.proposal.planned_start,"2026-12-01")
    const sent=(await read()).requests
    assert.equal(sent.length,1,"Adding a dated pin immediately creates a PM approval request")
    assert.equal(sent[0].status,'pending');assert.equal(sent[0].proposal.phase,'Foundation')
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
    const automatic=(await read()).requests
    assert.equal(automatic.filter(row=>row.status==='pending').length,2,'Each new task gets a PM request without a separate send')
    assert.ok(automatic.every(row=>row.proposal.phase==='Foundation'&&row.proposal.planned_start==='2026-12-01'))
    await owner()
    const initial=(await db.query("select status,reviewed_by,reviewed_at from public.project_timeline_requests where work_key=$1 and status<>'draft'",[`pin:${pin.id}`])).rows[0]
    assert.deepEqual(initial,{status:'superseded',reviewed_by:null,reviewed_at:null},'Replacing the pin request with task requests does not fabricate a PM decision')
    await as('spEng')
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
  await test("Schedule proposals: optional technical reasons survive creation, submission and pending updates without approval",async()=>{
    await as("spEng")
    for(const reason of [null,"","  ","a"]){
      const created=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,30,30,'Optional explanation','progress','2026-12-01','2026-12-10','Foundation',$2)",[sheet,reason])).rows[0]
      let draft=(await db.query("select public.get_pin_schedule_proposal($1) data",[created.id])).rows[0].data.draft
      assert.equal(draft.reason,(reason??"").trim());assert.equal(created.planned_start,null)
      await db.query("select public.submit_pin_schedule_proposal($1,'2026-12-01','2026-12-10','Foundation',$2,1)",[created.id,reason])
      await db.query("select public.submit_pin_schedule_proposal($1,'2026-12-02','2026-12-10','Foundation',null,2)",[created.id])
      const data=await read(),request=data.requests.find(row=>row.work_key===`pin:${created.id}`&&row.status==='pending')
      assert.equal(request.reason,"");assert.equal(request.proposal.planned_start,"2026-12-02")
      assert.equal(data.items.find(row=>row.key===`pin:${created.id}`).planned_start,null)
      await expectFail("select public.save_pin_schedule_draft($1,'2026-12-01','2026-12-10','Foundation',$2,3)",[created.id,"x".repeat(501)],/500/)
      await as("spPM");await expectFail("select public.decide_timeline_request($1,false,'')",[request.id],/review note/)
      await as("spClient");await expectFail("select public.save_pin_schedule_draft($1,'2026-12-01','2026-12-10','Foundation','',3)",[created.id],/unavailable/)
      await as("spEng")
    }
  })
  await test("Automatic pin requests: PM can approve the bare pin; later task requests use adjusted dates without inheriting approval",async()=>{
    await as('spEng')
    const pn=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,40,40,'Approved parent schedule','progress','2026-12-01','2026-12-10','Foundation','')",[sheet])).rows[0]
    const initial=(await read()).requests.find(row=>row.work_key===`pin:${pn.id}`)
    await as('spPM');await db.query("select public.decide_timeline_request($1,true,'Adjusted to available crew',$2::jsonb)",[initial.id,JSON.stringify(plan('2026-12-03','2026-12-08',{phase:'Structural'}))])
    await as('spEng')
    const child=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'New task after pin approval') returning *",[pn.id,project])).rows[0]
    assert.equal(child.planned_start,null);assert.equal(child.due_date,null);assert.equal(child.done,false)
    const pending=(await read()).requests.find(row=>row.work_key===`task:${child.id}`)
    assert.equal(pending.status,'pending');assert.equal(pending.proposal.phase,'Structural');assert.equal(pending.proposal.planned_start,'2026-12-03')
    await as('spClient');assert.ok(!(await read()).items.some(row=>row.pin_id===pn.id),'New requests never change the Client publication')
    await as('spPM');await db.query("select public.decide_timeline_request($1,true,'Task schedule reviewed separately')",[pending.id])
    const official=(await read()).items.find(row=>row.key===`task:${child.id}`)
    assert.equal(official.planned_start,'2026-12-03');assert.equal(official.verified,false)
  })
  await test("Automatic pin requests: private draft changes stay private; rejected templates do not send new requests",async()=>{
    await as('spEng')
    const pn=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,50,50,'Sent vs draft schedule','progress','2026-12-01','2026-12-10','Foundation','')",[sheet])).rows[0]
    await db.query("select public.save_pin_schedule_draft($1,'2027-01-01','2027-01-10','Structural','Unsent private draft',1)",[pn.id])
    const child=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'Uses sent dates') returning id",[pn.id,project])).rows[0].id
    const req=(await read()).requests.find(row=>row.work_key===`task:${child}`)
    assert.equal(req.proposal.planned_start,'2026-12-01');assert.equal(req.reason,'')
    await owner();const old=(await db.query("select id,status from public.project_timeline_requests where work_key=$1 and status='superseded'",[`pin:${pn.id}`])).rows[0]
    await as('spPM');await expectFail("select public.decide_timeline_request($1,true,'An obsolete approval attempt')",[old.id],/already been reviewed/)
    await as('spEng')
    const rejected=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,50,50,'Rejected parent schedule','progress','2026-12-01','2026-12-10','Foundation','')",[sheet])).rows[0]
    const pending=(await read()).requests.find(row=>row.work_key===`pin:${rejected.id}`)
    await as('spPM');await db.query("select public.decide_timeline_request($1,false,'Revise the planned sequence')",[pending.id])
    await as('spEng');const next=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'Needs new proposal') returning id",[rejected.id,project])).rows[0].id
    assert.ok(!(await read()).requests.some(row=>row.work_key===`task:${next}`))
    const draftOnly=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,50,50,'Legacy undated pin','progress')",[sheet])).rows[0]
    await db.query("select public.save_pin_schedule_draft($1,'2026-12-01','2026-12-10','Foundation','Private unsent dates',0)",[draftOnly.id])
    const unsent=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'No automatic private draft') returning id",[draftOnly.id,project])).rows[0].id
    assert.ok(!(await read()).requests.some(row=>row.work_key===`task:${unsent}`))
  })
  await test("Automatic pin requests: another authorized Engineer can add tasks without receiving the proposer's private request",async()=>{
    await owner();await addUser('spEng2','engineer')
    await db.query("insert into public.project_members(project_id,user_id) values($1,$2)",[project,ids.spEng2])
    await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','assigned') on conflict(project_id,user_id,blueprint_type) do update set access_level='assigned'",[project,ids.spEng2])
    await as('spEng')
    const pn=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,60,60,'Shared Engineer work','progress','2026-12-01','2026-12-10','Foundation','Original confidential explanation')",[sheet])).rows[0]
    await as('spEng2');const child=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'Added by second Engineer') returning *",[pn.id,project])).rows[0]
    assert.equal(child.planned_start,null)
    assert.ok(!(await read()).requests.some(row=>row.work_key===`task:${child.id}`),'The sent request stays with its proposer and PM')
    await as('spEng');const req=(await read()).requests.find(row=>row.work_key===`task:${child.id}`)
    assert.equal(req.requested_by,ids.spEng);assert.equal(req.reason,'Original confidential explanation');assert.equal(req.status,'pending')
    await as('spPM');assert.ok((await read()).requests.some(row=>row.id===req.id))
    await owner();const event=(await db.query("select actor_id,details from public.audit_log where action='project_timeline.auto_task_requested' and details->>'item_id'=$1",[child.id])).rows[0]
    assert.equal(event.actor_id,ids.spEng2);assert.equal(event.details.requested_by,ids.spEng)
    await db.query("update public.project_blueprint_access set access_level='view' where project_id=$1 and user_id=$2",[project,ids.spEng])
    await as('spEng2');const fresh=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'Proposer lost work access') returning id",[pn.id,project])).rows[0].id
    await as('spPM');assert.ok(!(await read()).requests.some(row=>row.work_key===`task:${fresh}`),'Revoked work access prevents new inherited requests')
    await as('spEng2');await expectFail("select public.request_new_task_schedule()",[],/permission denied/)
    await owner();await db.query("update public.project_blueprint_access set access_level='assigned' where project_id=$1 and user_id=$2",[project,ids.spEng])
  })
  await test("Optional PM approval reason: null, blank and short explanations preserve explicit approval, actor and QA separation",async()=>{
    for(const note of [null,'','  ','a']){
      await as('spEng')
      const pn=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,70,70,'Optional approval reason','progress','2026-12-01','2026-12-10','Foundation','')",[sheet])).rows[0]
      const request=(await read()).requests.find(row=>row.work_key===`pin:${pn.id}`)
      await as('spPM');await db.query("select public.decide_timeline_request($1,true,$2)",[request.id,note])
      const approved=(await read()).items.find(row=>row.key===`pin:${pn.id}`)
      assert.equal(approved.planned_start,'2026-12-01');assert.equal(approved.verified,false)
      await owner();const record=(await db.query("select status,review_note,reviewed_by,reviewed_at is not null stamped from public.project_timeline_requests where id=$1",[request.id])).rows[0]
      assert.deepEqual(record,{status:'approved',review_note:(note??'').trim(),reviewed_by:ids.spPM,stamped:true})
      const event=(await db.query("select actor_id,details from public.audit_log where action='project_timeline.reviewed' and details->>'request_id'=$1",[request.id])).rows[0]
      assert.equal(event.actor_id,ids.spPM);assert.equal(event.details.note,(note??'').trim());assert.equal(event.details.approved,true)
      await as('spClient');assert.ok(!(await read()).items.some(row=>row.pin_id===pn.id),'Approval still requires a separate publication to reach Clients')
    }
  })
  await test("Optional publication reason: blank values publish sanitized versioned snapshots and retain earlier history",async()=>{
    await owner();const initial=(await db.query("select md5(snapshot::text) hash from public.project_timeline_publications where project_id=$1 and version=1",[project])).rows[0].hash
    for(const reason of [null,'','  ','a']){
      await as('spPM');const version=(await db.query("select public.publish_project_timeline($1,$2) v",[project,reason])).rows[0].v
      await owner();const publication=(await db.query("select reason,published_by from public.project_timeline_publications where project_id=$1 and version=$2",[project,version])).rows[0]
      assert.equal(publication.reason,(reason??'').trim());assert.equal(publication.published_by,ids.spPM)
      assert.equal((await db.query("select md5(snapshot::text) hash from public.project_timeline_publications where project_id=$1 and version=1",[project])).rows[0].hash,initial)
      await as('spClient');const client=await read()
      assert.equal(client.version,version);assert.ok(client.items.length>0);assert.equal(client.can_edit,false);assert.deepEqual(client.requests,[])
      assert.ok(client.items.every(row=>row.planned_start&&row.planned_end&&!('owner' in row)&&!('reported_percent' in row)))
    }
  })
  await test("Optional PM reasons: role denials, bounds, rejection notes, direct edit reasons and nonempty publication stay enforced",async()=>{
    await as('spEng');const pn=(await db.query("select * from public.create_pin_with_schedule_proposal($1,null,80,80,'Reason guard checks','progress','2026-12-01','2026-12-10','Foundation','')",[sheet])).rows[0]
    const req=(await read()).requests.find(row=>row.work_key===`pin:${pn.id}`)
    for(const key of ['spEng','spFore','spClient','spOtherPM']){
      await as(key);await expectFail("select public.decide_timeline_request($1,true,null)",[req.id],/unavailable/)
      await expectFail("select public.publish_project_timeline($1,null)",[project],/Only/)
    }
    await as('spPM')
    await expectFail("select public.decide_timeline_request($1,true,$2)",[req.id,'x'.repeat(501)],/500/)
    await expectFail("select public.decide_timeline_request($1,false,null)",[req.id],/rejection needs/)
    await expectFail("select public.save_timeline_item($1,$2,$3::jsonb,0,$4)",[project,`pin:${pn.id}`,JSON.stringify(plan('2026-12-01','2026-12-10')),'x'.repeat(501)],/500/)
    await expectFail("select public.publish_project_timeline($1,$2)",[project,'x'.repeat(501)],/500/)
    assert.equal((await read()).requests.find(row=>row.id===req.id).status,'pending')
    await as('spEng');await expectFail("select public.write_timeline_item($1,$2,$3::jsonb,0,'')",[project,`pin:${pn.id}`,JSON.stringify(plan('2026-12-01','2026-12-10'))],/permission denied/)
    await owner();const empty=(await db.query("insert into public.projects(code,name) values('SP-EMPTY','Empty publication guard') returning id")).rows[0].id
    await db.query("insert into public.project_managers(project_id,user_id,designation) values($1,$2,'primary')",[empty,ids.spPM])
    await as('spPM');await expectFail("select public.publish_project_timeline($1,null)",[empty],/Schedule at least one/)
  })
  await test("New Pin Foreman: creation, assignment stamps and automatic PM request save together without approving dates",async()=>{
    await owner();await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','assigned') on conflict(project_id,user_id,blueprint_type) do update set access_level='assigned'",[project,ids.spFore])
    await as('spEng')
    const pn=(await db.query("select * from public.create_pin_with_foreman($1,null,90,90,'Assigned at creation','progress',$2,'2026-12-01','2026-12-10','Foundation','')",[sheet,ids.spFore])).rows[0]
    assert.equal(pn.assigned_to,ids.spFore);assert.equal(pn.assigned_by,ids.spEng);assert.ok(pn.assigned_at)
    assert.equal(pn.planned_start,null);assert.equal(pn.due_date,null);assert.equal(pn.status,'not_started')
    const request=(await read()).requests.find(row=>row.work_key===`pin:${pn.id}`)
    assert.equal(request.status,'pending');assert.equal(request.proposal.phase,'Foundation')
    const assigned=(await db.query("select actor_id,from_user,to_user from public.pin_events where pin_id=$1 and kind='assigned'",[pn.id])).rows
    assert.equal(assigned.length,1);assert.deepEqual(assigned[0],{actor_id:ids.spEng,from_user:null,to_user:ids.spFore})
    await as('spFore');const work=(await read()).items.find(row=>row.pin_id===pn.id)
    assert.equal(work.assigned_to,ids.spFore);assert.equal(work.verified,false)
    await as('spClient');assert.ok(!(await read()).items.some(row=>row.pin_id===pn.id))
    await as('spEng');const unassigned=(await db.query("select * from public.create_pin_with_foreman($1,null,90,90,'Optional initial Foreman','progress',null,'2026-12-01','2026-12-10','Foundation','')",[sheet])).rows[0]
    assert.equal(unassigned.assigned_to,null);assert.equal(unassigned.assigned_at,null)
  })
  await test("New Pin Foreman: ineligible selections roll back the pin, proposal and assignment history atomically",async()=>{
    await owner();await addUser('pinOutsideFore','foreman');await addUser('pinViewFore','foreman');await addUser('pinInactiveFore','foreman')
    for(const key of ['pinViewFore','pinInactiveFore'])await db.query("insert into public.project_members(project_id,user_id) values($1,$2)",[project,ids[key]])
    await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','view') on conflict(project_id,user_id,blueprint_type) do update set access_level='view'",[project,ids.pinViewFore])
    await db.query("update public.profiles set status='disabled' where id=$1",[ids.pinInactiveFore])
    const counts=async()=>{await owner();return(await db.query("select (select count(*)::int from public.pins where project_id=$1) pins,(select count(*)::int from public.project_timeline_requests where project_id=$1) requests,(select count(*)::int from public.pin_events where project_id=$1) events",[project])).rows[0]}
    const before=await counts()
    for(const key of ['pinOutsideFore','pinViewFore','pinInactiveFore','spEng']){
      await as('spEng');await expectFail("select public.create_pin_with_foreman($1,null,90,90,'Invalid initial Foreman','progress',$2,'2026-12-01','2026-12-10','Foundation','')",[sheet,ids[key]])
      assert.deepEqual(await counts(),before)
    }
    await as('spEng');await expectFail("select public.create_pin_with_foreman($1,null,90,90,'Note assignment denied','note',$2)",[sheet,ids.spFore],/Notes are not assignable/)
    assert.deepEqual(await counts(),before)
  })
  await test("New Pin Foreman: callers retain existing role, archived-project and private schedule boundaries",async()=>{
    for(const key of ['spClient','spFore','spOtherPM']){
      await as(key);await expectFail("select public.create_pin_with_foreman($1,null,90,90,'Unauthorized initial assignment','progress',$2,'2026-12-01','2026-12-10','Foundation','')",[sheet,ids.spFore])
    }
    await as(null);await expectFail("select public.create_pin_with_foreman($1,null,90,90,'Anonymous initial assignment','progress',$2,'2026-12-01','2026-12-10','Foundation','')",[sheet,ids.spFore],/permission denied/)
    await owner();await db.query("update public.projects set archived_at=now() where id=$1",[project])
    try {
      await as('spEng');await expectFail("select public.create_pin_with_foreman($1,null,90,90,'Archived initial assignment','progress',$2,'2026-12-01','2026-12-10','Foundation','')",[sheet,ids.spFore],/read-only|Engineer|permission denied/)
    } finally { await owner();await db.query("update public.projects set archived_at=null where id=$1",[project]) }
  })
}
