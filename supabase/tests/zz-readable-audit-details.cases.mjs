import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  await asOwner()
  await db.query("select set_config('request.jwt.claims', '{}', false)")
  await addUser("auditReader", "admin")
  await addUser("auditForeman", "foreman")
  await addUser("auditForeman2", "foreman")
  await addUser("auditEngineer", "engineer")
  const project = (await db.query("insert into public.projects(code, name) values ('AUDIT-REAL', 'Actual audit project') returning id")).rows[0].id
  await db.query("insert into public.project_members(project_id, user_id) values ($1, $2), ($1, $3), ($1, $4)", [project, ids.auditForeman, ids.auditForeman2, ids.auditEngineer])
  const sheet = (await db.query("insert into public.blueprints(project_id, title) values ($1, 'Actual dining plan') returning id", [project])).rows[0].id
  const pin = (await db.query("insert into public.pins(project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 12, 34, 'Actual dining area', $3) returning id", [project, sheet, ids.auditForeman])).rows[0].id
  const item = (await db.query("insert into public.pin_checklist_items(project_id, pin_id, text) values ($1, $2, 'Actual dining floor') returning id", [project, pin])).rows[0].id
  let snapshot, update
  const remarks = "Recorded correction. ".repeat(80) + "Complete final sentence."
  const read = async id => (await db.query("select * from public.get_audit_log('AUDIT-REAL', null, null, null, 500, 0)")).rows.find(row => Number(row.id) === Number(id))

  await test("Audit details return complete historic values with real task, pin, project and person labels", async () => {
    await asOwner()
    snapshot = (await db.query("insert into public.audit_log(actor_id, action, details) values ($1, 'qa_work_attempts.update', $2) returning id", [ids.auditForeman, JSON.stringify({ row: { id: "00000000-0000-0000-0000-000000000001", project_id: project, pin_id: pin, item_id: item, remarks, created_by: ids.auditForeman } })])).rows[0].id
    await as("auditReader", "aal2")
    const entry = await read(snapshot)
    assert.ok(entry.summary.length > 400)
    const value = JSON.parse(entry.summary)
    assert.equal(value.details.row.remarks, remarks)
    assert.equal(value.context.task, "Actual dining floor")
    assert.equal(value.context.pin, "Actual dining area")
    assert.equal(value.context.project, "AUDIT-REAL · Actual audit project")
    assert.equal(value.context.references[ids.auditForeman], "auditForeman")
    assert.equal(entry.target_name, "Actual dining floor")
    assert.equal(value.details.before, undefined, "must not invent historical previous values")
  })

  await test("Future pin and project edits record genuine before and after values; older entries remain intact", async () => {
    await asOwner()
    await db.query("select set_config('request.jwt.claims', '{}', false)")
    await db.query("update public.pins set x = 22, assigned_to = $2 where id = $1", [pin, ids.auditForeman2])
    update = (await db.query("select id from public.audit_log where action = 'pins.update' and details->'row'->>'id' = $1 order by id desc limit 1", [pin])).rows[0].id
    await db.query("update public.projects set location = 'Actual new location' where id = $1", [project])
    const projectEdit = (await db.query("select details from public.audit_log where action = 'projects.update' and details->'row'->>'id' = $1 order by id desc limit 1", [project])).rows[0].details
    assert.equal(projectEdit.row.location, "Actual new location")
    assert.notEqual(projectEdit.before.location, projectEdit.row.location)
    await as("auditReader", "aal2")
    const value = JSON.parse((await read(update)).summary)
    assert.equal(Number(value.details.before.x), 12)
    assert.equal(Number(value.details.row.x), 22)
    assert.equal(value.context.references[ids.auditForeman], "auditForeman")
    assert.equal(value.context.references[ids.auditForeman2], "auditForeman2")
    assert.equal(JSON.parse((await read(snapshot)).summary).details.before, undefined)
  })

  await test("Audit search matches related names; action, dates and pagination remain accurate", async () => {
    await as("auditReader", "aal2")
    const all = (await db.query("select * from public.get_audit_log('Actual dining floor', 'qa_work_attempts.update')")).rows
    assert.ok(all.some(row => Number(row.id) === Number(snapshot)))
    const p1 = (await db.query("select id from public.get_audit_log('AUDIT-REAL', null, null, null, 1, 0)")).rows
    const p2 = (await db.query("select id from public.get_audit_log('AUDIT-REAL', null, null, null, 1, 1)")).rows
    assert.equal(p1.length, 1); assert.equal(p2.length, 1); assert.notEqual(p1[0].id, p2[0].id)
    assert.equal((await db.query("select * from public.get_audit_log('AUDIT-REAL', null, now() + interval '1 day')")).rows.length, 0)
  })

  await test("Audit details tolerate missing records and malformed historic references", async () => {
    await asOwner()
    await db.query("insert into public.audit_log(action, details) values ('pins.delete', '{\"row\":{\"id\":\"bad-id\",\"project_id\":\"bad-id\",\"title\":\"Deleted real pin\"}}')")
    await db.query("insert into public.audit_log(action, details) values ('legacy.update', '[1,2]')")
    await as("auditReader", "aal2")
    const rows = (await db.query("select * from public.get_audit_log('Deleted real pin')")).rows
    assert.equal(rows[0].target_name, "Deleted real pin")
    assert.ok((await db.query("select * from public.get_audit_log(null, 'legacy.update')")).rows.length)
  })

  await test("Expanded audit details and search exclude credentials and biometric identifiers recursively", async () => {
    await asOwner()
    const details = { row: { title: "Sanitized audit", password: "hidden-audit-password", biometric_uid: "hidden-audit-biometric", metadata: { access_token: "hidden-audit-token", note: "Actual public note" }, files: [{ secret: "hidden-audit-secret", caption: "Actual caption" }] } }
    await db.query("insert into public.audit_log(action, details) values ('legacy.update', $1)", [JSON.stringify(details)])
    await as("auditReader", "aal2")
    const entry = (await db.query("select * from public.get_audit_log('Sanitized audit')")).rows[0]
    assert.ok(!entry.summary.includes("hidden-audit")); assert.ok(entry.summary.includes("Actual public note"))
    assert.equal((await db.query("select * from public.get_audit_log('hidden-audit')")).rows.length, 0)
  })

  await test("Readable audit RPC retains users.view, active status, MFA and private helper guards", async () => {
    for (const role of ["auditForeman", "auditEngineer"]) {
      await as(role, "aal2")
      await expectFail("select * from public.get_audit_log()", [], /Missing permission/)
      await expectFail("select public.audit_log_context('pins.update', '{}')", [], /permission denied/)
    }
    await as("auditReader", "aal1")
    await expectFail("select * from public.get_audit_log()", [], /Missing permission/)
    await asOwner(); await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.auditReader])
    await as("auditReader", "aal2")
    await expectFail("select * from public.get_audit_log()", [], /Missing permission/)
    await as(null)
    await expectFail("select * from public.get_audit_log()", [], /permission denied/)
  })
}
