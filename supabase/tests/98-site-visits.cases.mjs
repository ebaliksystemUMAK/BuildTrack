import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, test, expectFail, addUser }) {
  await asOwner()
  for (const [key, role] of [["visitclient", "client"], ["visitother", "client"], ["visitengineer", "engineer"], ["visitoutsider", "engineer"], ["visitforeman", "foreman"]]) await addUser(key, role)
  const project = (await db.query("insert into public.projects(code,name) values ('VISIT-TEST','Site visit tests') returning id")).rows[0].id
  for (const key of ["visitclient", "visitother", "visitengineer", "visitforeman"]) await db.query("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids[key]])
  let visit
  const insert = "insert into public.site_visit_requests(project_id,preferred_at,purpose,visitors) values ($1,now() + interval '2 days','Review ground floor finishes',2) returning *"

  await test("Visit request stores the caller and notifies only assigned Engineers", async () => {
    await as("visitclient")
    visit = (await db.query(insert, [project])).rows[0]
    assert.equal(visit.client_id, ids.visitclient); assert.equal(visit.status, "requested"); assert.equal(visit.responded_at, null)
    await as("visitengineer")
    const notes = (await db.query("select * from public.notifications where entity_id=$1 and kind='visit.requested'", [visit.id])).rows
    assert.equal(notes.length, 1); assert.match(notes[0].link, /tab=visits&visit=/)
    await as("visitoutsider")
    assert.equal((await db.query("select * from public.notifications where entity_id=$1", [visit.id])).rows.length, 0)
  })
  await test("Clients cannot forge request identity, decisions, timestamps or requested slots", async () => {
    await as("visitclient")
    await expectFail("insert into public.site_visit_requests(project_id,preferred_at,purpose,client_id) values ($1,now()+interval '3 days','Forged author',$2)", [project, ids.visitother], /permission denied/)
    await expectFail("insert into public.site_visit_requests(project_id,preferred_at,purpose,status) values ($1,now()+interval '3 days','Forged confirmation','confirmed')", [project], /permission denied/)
    await expectFail("insert into public.site_visit_requests(project_id,preferred_at,purpose) values ($1,now()-interval '1 day','Past request')", [project], /future/)
    await expectFail("insert into public.site_visit_requests(project_id,preferred_at,purpose,visitors) values ($1,now()+interval '1 day','Valid purpose',0)", [project], /check constraint/)
    await expectFail("insert into public.site_visit_requests(project_id,preferred_at,purpose) values ($1,now()+interval '1 day','x')", [project], /check constraint/)
    await expectFail("insert into public.site_visit_requests(project_id,preferred_at,purpose) values ($1,$2,'Duplicate time')", [project, visit.preferred_at], /duplicate|unique/)
    await expectFail("update public.site_visit_requests set preferred_at=now()+interval '4 days' where id=$1", [visit.id], /permission denied/)
    await expectFail("update public.site_visit_requests set status='confirmed' where id=$1", [visit.id], /only cancel/)
    await expectFail("update public.site_visit_requests set status='cancelled',engineer_note='Forged response' where id=$1", [visit.id], /only cancel/)
  })
  await test("Visits are private to their client and assigned active Engineers", async () => {
    for (const key of ["visitother", "visitoutsider", "visitforeman"]) {
      await as(key)
      assert.equal((await db.query("select * from public.site_visit_requests where project_id=$1", [project])).rows.length, 0, key)
      if (key !== "visitother") await expectFail(insert, [project], /assigned clients|row-level security/)
      assert.equal((await db.query("update public.site_visit_requests set status='confirmed' where id=$1 returning id", [visit.id])).rows.length, 0)
    }
    await as("visitother")
    const own = (await db.query(insert, [project])).rows[0]
    assert.equal(own.client_id, ids.visitother, "Another assigned client may request their own private visit")
    assert.equal((await db.query("select * from public.site_visit_requests where project_id=$1", [project])).rows.length, 1)
    await as(null)
    await expectFail("select * from public.site_visit_requests", [], /permission denied/)
  })
  await test("Engineer confirms once, stamps the decision and notifies the client", async () => {
    await as("visitengineer")
    await expectFail("update public.site_visit_requests set status='declined' where id=$1", [visit.id], /Explain why/)
    const changed = (await db.query("update public.site_visit_requests set status='confirmed',engineer_note='Meet at the main gate' where id=$1 and status='requested' returning *", [visit.id])).rows[0]
    assert.equal(changed.responded_by, ids.visitengineer); assert.ok(changed.responded_at)
    assert.equal((await db.query("update public.site_visit_requests set status='declined',engineer_note='Stale decision' where id=$1 and status='requested' returning id", [visit.id])).rows.length, 0)
    await expectFail("update public.site_visit_requests set status='declined' where id=$1", [visit.id], /already been decided/)
    await as("visitclient")
    const notes = (await db.query("select * from public.notifications where entity_id=$1 and kind='visit.confirmed'", [visit.id])).rows
    assert.equal(notes.length, 1); assert.match(notes[0].link, /client\/communication.*tab=visits/)
    assert.equal((await db.query("select engineer_note from public.site_visit_requests where id=$1", [visit.id])).rows[0].engineer_note, "Meet at the main gate")
  })
  await test("Client cancellation preserves Engineer response and notifies the Engineer", async () => {
    await as("visitclient")
    const cancelled = (await db.query("update public.site_visit_requests set status='cancelled' where id=$1 returning *", [visit.id])).rows[0]
    assert.equal(cancelled.engineer_note, "Meet at the main gate"); assert.equal(cancelled.responded_by, ids.visitengineer)
    await expectFail("delete from public.site_visit_requests where id=$1", [visit.id], /permission denied/)
    await as("visitengineer")
    await expectFail("update public.site_visit_requests set status='confirmed' where id=$1", [visit.id], /already been decided/)
    assert.equal((await db.query("select * from public.notifications where entity_id=$1 and kind='visit.cancelled'", [visit.id])).rows.length, 1)
  })
  await test("Declines require a message, preserve request history and notify their client", async () => {
    await as("visitclient")
    const next = (await db.query(insert, [project])).rows[0]
    await as("visitengineer")
    await db.query("update public.site_visit_requests set status='declined',engineer_note='Please request next Monday instead' where id=$1", [next.id])
    await as("visitclient")
    assert.equal((await db.query("select status from public.site_visit_requests where id=$1", [next.id])).rows[0].status, "declined")
    assert.equal((await db.query("select * from public.notifications where entity_id=$1 and kind='visit.declined'", [next.id])).rows.length, 1)
  })
  await test("Disabled or unassigned clients lose visit access immediately", async () => {
    await asOwner()
    await db.query("update public.profiles set status='disabled' where id=$1", [ids.visitclient])
    await as("visitclient")
    assert.equal((await db.query("select * from public.site_visit_requests where project_id=$1", [project])).rows.length, 0)
    await expectFail(insert, [project], /Active account/)
    await asOwner(); await db.query("update public.profiles set status='active' where id=$1", [ids.visitclient])
    await db.query("delete from public.project_members where project_id=$1 and user_id=$2", [project, ids.visitclient])
    await as("visitclient")
    assert.equal((await db.query("select * from public.site_visit_requests where project_id=$1", [project])).rows.length, 0)
    await expectFail(insert, [project], /assigned clients|row-level security/)
  })
}
