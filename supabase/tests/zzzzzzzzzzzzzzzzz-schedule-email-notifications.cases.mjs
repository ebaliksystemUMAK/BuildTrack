import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  const owner=async()=>{await asOwner();await db.query("select set_config('request.jwt.claims','{}',false)")}
  await owner()
  for(const[key,role]of [['seEng','engineer'],['seFore','foreman'],['seOtherFore','foreman'],['sePM','project_manager'],['seBackup','project_manager'],['seOtherPM','project_manager'],['seClient','client'],['seOutside','client'],['seDisabled','client'],['seSuper','super_admin']])await addUser(key,role)
  const project=(await db.query("insert into public.projects(code,name) values('SE-1','Schedule email fixture') returning id")).rows[0].id
  await db.query("insert into public.project_managers(project_id,user_id,designation) values($1,$2,'primary'),($1,$3,'backup')",[project,ids.sePM,ids.seBackup])
  for(const key of ['seEng','seFore','seOtherFore','seClient','seDisabled'])await db.query("insert into public.project_members(project_id,user_id) values($1,$2)",[project,ids[key]])
  const sheet=(await db.query("insert into public.blueprints(project_id,title,blueprint_type) values($1,'Schedule plan','architectural') returning id",[project])).rows[0].id
  for(const key of ['seEng','seFore','seOtherFore'])await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','assigned') on conflict(project_id,user_id,blueprint_type) do update set access_level='assigned'",[project,ids[key]])
  await db.query("update public.profiles set status='disabled' where id=$1",[ids.seDisabled])
  const notices=async(kind,entity)=>{await owner();return(await db.query("select * from public.notifications where project_id=$1 and kind=$2 and ($3::uuid is null or entity_id=$3) order by user_id",[project,kind,entity??null])).rows}
  const recipients=rows=>rows.map(row=>row.user_id).sort()
  const claim=async()=>{
    await owner()
    // Isolate this in-memory queue fixture from earlier suites. Never executed against hosted data.
    await db.query("update public.notifications set emailed_at=now() where project_id is distinct from $1 and emailed_at is null",[project])
    return(await db.query("select * from public.claim_email_batch(100)")).rows.filter(row=>row.kind.startsWith('timeline.'))
  }
  const create=async(title='Schedule email work')=>{
    await as('seEng')
    const pin=(await db.query("select * from public.create_pin_with_foreman($1,null,20,20,$2,'progress',$3,'2026-12-01','2026-12-10','Foundation','PRIVATE ENGINEER REASON')",[sheet,title,ids.seFore])).rows[0]
    await owner();const req=(await db.query("select * from public.project_timeline_requests where project_id=$1 and work_key=$2 and status='pending'",[project,`pin:${pin.id}`])).rows[0]
    return {pin,req}
  }
  let first,child,childReq
  await test('Schedule emails: requests notify only active assigned PMs, never private drafts or duplicate resubmissions',async()=>{
    first=await create()
    assert.deepEqual(recipients(await notices('timeline.requested',first.req.id)),[ids.sePM,ids.seBackup].sort())
    const pending=await notices('timeline.requested',first.req.id)
    assert.ok(pending.every(row=>row.link===`/pm/calendar?project=${project}&tab=gantt&ganttview=requests`&&!row.body.includes('PRIVATE')))
    await as('seEng');await db.query("select public.save_pin_schedule_draft($1,'2027-01-01','2027-01-10','Structural','PRIVATE UNSENT CHANGES',1)",[first.pin.id])
    assert.equal((await notices('timeline.requested',first.req.id)).length,2)
    await as('seEng');await db.query("select public.submit_pin_schedule_proposal($1,'2026-12-01','2026-12-10','Foundation','PRIVATE ENGINEER REASON',2)",[first.pin.id])
    assert.equal((await notices('timeline.requested',first.req.id)).length,2,'Same pending request is emailed once per PM')
    await as('seEng');await expectFail("select public.schedule_notice_allowed($1,'timeline.requested',$2,$3,$4)",[ids.sePM,project,first.req.id,`timeline.requested:${first.req.id}`],/permission denied/)
    await expectFail("select public.notify_schedule_request()",[],/permission denied/)
  })
  await test('Schedule emails: new-task requests replace stale parent emails and the claim lease prevents duplicate dispatch',async()=>{
    await as('seEng');child=(await db.query("insert into public.pin_checklist_items(pin_id,project_id,text) values($1,$2,'Concrete task') returning id",[first.pin.id,project])).rows[0].id
    await owner();childReq=(await db.query("select * from public.project_timeline_requests where project_id=$1 and work_key=$2 and status='pending'",[project,`task:${child}`])).rows[0]
    const jobs=await claim()
    assert.deepEqual(jobs.map(row=>row.id).sort(),(await notices('timeline.requested',childReq.id)).map(row=>row.id).sort())
    await owner();assert.equal((await db.query("select count(*)::int n from public.email_log where notification_id=any($1::uuid[]) and status='skipped'",[(await notices('timeline.requested',first.req.id)).map(row=>row.id)])).rows[0].n,2)
    assert.equal((await claim()).length,0,'A claimed message is not handed out again during its lease')
  })
  await test('Schedule emails: approval reaches the requesting Engineer and assigned Foreman without QA completion or Client disclosure',async()=>{
    await as('sePM');await db.query("select public.decide_timeline_request($1,true,'')",[childReq.id])
    const decision=await notices('timeline.approved',childReq.id)
    assert.deepEqual(recipients(decision),[ids.seEng,ids.seFore].sort())
    assert.ok(decision.every(row=>!row.body.includes('PRIVATE')))
    assert.match(decision.find(row=>row.user_id===ids.seEng).link,/ganttview=history/)
    assert.match(decision.find(row=>row.user_id===ids.seFore).link,/^\/foreman\/calendar\?/)
    assert.equal((await claim()).filter(row=>row.kind==='timeline.approved').length,2)
    await owner();assert.equal((await db.query("select review_status from public.pin_checklist_items where id=$1",[child])).rows[0].review_status,'not_submitted')
    assert.equal((await notices('timeline.published')).length,0)
  })
  await test('Schedule emails: rejection excludes private review notes and overlapping requester/Foreman recipients are deduplicated',async()=>{
    const work=await create('Rejected work')
    await as('sePM');await db.query("select public.decide_timeline_request($1,false,'PRIVATE PM REVIEW')",[work.req.id])
    const rows=await notices('timeline.rejected',work.req.id)
    assert.deepEqual(recipients(rows),[ids.seEng,ids.seFore].sort());assert.ok(rows.every(row=>!row.body.includes('PRIVATE')&&!row.body.includes('2026-12-01')))
    await as('seFore');await db.query("select public.request_timeline_change($1,$2,$3::jsonb,0,'Foreman date proposal')",[project,`pin:${work.pin.id}`,JSON.stringify(work.req.proposal)])
    await owner();const req=(await db.query("select * from public.project_timeline_requests where project_id=$1 and work_key=$2 and requested_by=$3 and status='pending'",[project,`pin:${work.pin.id}`,ids.seFore])).rows[0]
    await as('sePM');await db.query("select public.decide_timeline_request($1,false,'Revise the work dates')",[req.id])
    assert.deepEqual(recipients(await notices('timeline.rejected',req.id)),[ids.seFore])
  })
  await test('Schedule emails: only publication notifies Clients, with safe content and latest-version dispatch',async()=>{
    await as('sePM');await db.query("select public.publish_project_timeline($1,'PRIVATE PUBLICATION REASON')",[project])
    let rows=await notices('timeline.published');assert.deepEqual(recipients(rows),[ids.seClient])
    await owner();assert.equal((await db.query("select public.schedule_notice_allowed($1,'timeline.published',$2,null,$3) allowed",[ids.seClient,project,rows[0].dedupe_key])).rows[0].allowed,false)
    assert.ok(rows.every(row=>!row.body.includes('PRIVATE')&&!row.body.includes('Foreman')&&row.link===`/client/calendar?project=${project}&tab=gantt`))
    await as('sePM');await db.query("select public.publish_project_timeline($1,'')",[project])
    rows=await notices('timeline.published');assert.equal(rows.length,2)
    const jobs=(await claim()).filter(row=>row.kind==='timeline.published')
    assert.equal(jobs.length,1);assert.match(jobs[0].body,/version 2/)
    await as('seClient');assert.deepEqual((await db.query("select public.get_project_timeline($1) data",[project])).rows[0].data.requests,[])
  })
  await test('Schedule emails: permission loss, reassignment and removed Client membership are rechecked before dispatch',async()=>{
    const work=await create('Access changed before send')
    await owner();await db.query("delete from public.project_managers where project_id=$1 and user_id=$2",[project,ids.sePM])
    await as('seBackup');await db.query("select public.decide_timeline_request($1,true,'')",[work.req.id])
    const before=await notices('timeline.approved',work.req.id);assert.equal(before.length,2)
    await as('seBackup');await db.query("select public.assign_work_item($1,$2)",[work.pin.id,ids.seOtherFore])
    await owner();await db.query("delete from public.project_blueprint_access where project_id=$1 and user_id=$2",[project,ids.seEng])
    await as('seBackup');await db.query("select public.publish_project_timeline($1,'')",[project])
    await owner();await db.query("delete from public.project_members where project_id=$1 and user_id=$2",[project,ids.seClient])
    const jobs=await claim();assert.ok(!jobs.some(row=>before.some(notice=>notice.id===row.id)))
    assert.ok(!jobs.some(row=>row.kind==='timeline.published'))
    await owner();assert.equal((await db.query("select count(*)::int n from public.notifications where project_id=$1 and kind='timeline.requested' and user_id=$2 and emailed_at is null and email_claimed_at is null",[project,ids.sePM])).rows[0].n,0)
    await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','assigned')",[project,ids.seEng])
  })
  await test('Schedule emails: email pause and user opt-out preserve the bell and do not bypass existing preferences',async()=>{
    const work=await create('Email preferences')
    await owner();await db.query("insert into public.notification_prefs(user_id,email_enabled) values($1,false) on conflict(user_id) do update set email_enabled=false",[ids.seBackup])
    const rows=await notices('timeline.requested',work.req.id);assert.deepEqual(recipients(rows),[ids.seBackup])
    await as('seSuper','aal2');await db.query("select public.set_system_switch('email_paused',true,'Local schedule email test')")
    try { assert.equal((await claim()).length,0);assert.equal((await notices('timeline.requested',work.req.id))[0].email_attempts,0) }
    finally { await as('seSuper','aal2');await db.query("select public.set_system_switch('email_paused',false,'Local schedule email test complete')") }
    assert.equal((await claim()).filter(row=>rows.some(n=>n.id===row.id)).length,0)
    assert.equal((await notices('timeline.requested',work.req.id)).length,1,'Opt-out never removes the in-app notice')
  })
}
