import assert from "node:assert/strict"

// A suspended account is refused by the database itself (no migration involved): the rows and permissions stop at once, whatever the browser sends.
// What these cases do NOT prove: that the auth sessions / tokens are removed (admin-users does that through the Auth service, outside this harness).
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const system = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await system()
  await addUser("susAdmin", "admin")
  await addUser("susEng", "engineer")
  await addUser("susFore", "foreman")
  await addUser("susClient", "client")
  await db.query("insert into public.admin_permissions(user_id, permission) values ($1, 'users.view'), ($1, 'users.disable') on conflict do nothing", [ids.susAdmin])
  const project = (await db.query("insert into public.projects(code, name) values ('SUSPEND-1', 'Suspension project') returning id")).rows[0].id
  const sheet = (await db.query("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Suspension plan', 'architectural') returning id", [project])).rows[0].id
  for (const key of ["susEng", "susFore", "susClient"]) await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [project, ids[key]])
  for (const key of ["susEng", "susFore"]) await db.query("insert into public.project_blueprint_access(project_id, user_id, blueprint_type, access_level) values ($1, $2, 'architectural', 'assigned')", [project, ids[key]])
  const pin = (await db.query("insert into public.pins(project_id, blueprint_id, title, x, y, assigned_to) values ($1, $2, 'Suspension task', 10, 10, $3) returning id", [project, sheet, ids.susFore])).rows[0].id
  await db.query("insert into public.notifications(user_id, kind, title, body) values ($1, 'pin.assigned', 'Before the suspension', 'x')", [ids.susFore])
  const suspend = async (...keys) => { await system(); for (const key of keys) await db.query("update public.profiles set status = 'disabled' where id = $1", [ids[key]]) }
  const enable = async (...keys) => { await system(); for (const key of keys) await db.query("update public.profiles set status = 'active' where id = $1", [ids[key]]) }

  await test("Before the suspension the foreman, engineer and client see their project and the admin may read users", async () => {
    await as("susFore")
    assert.equal(await count("select count(*) n from public.projects where id = $1", [project]), 1)
    assert.equal(await count("select count(*) n from public.pins where id = $1", [pin]), 1)
    await as("susClient")
    assert.equal(await count("select count(*) n from public.projects where id = $1", [project]), 1)
    await as("susAdmin", "aal2")
    assert.equal((await db.query("select public.has_permission('users.view') ok")).rows[0].ok, true)
  })

  await suspend("susAdmin", "susEng", "susFore", "susClient")

  await test("A suspended person is no longer an active account and holds no permission, even an Admin with MFA", async () => {
    await as("susFore")
    assert.equal((await db.query("select public.is_active() ok")).rows[0].ok, false)
    await as("susAdmin", "aal2")
    assert.equal((await db.query("select public.is_active() ok")).rows[0].ok, false)
    assert.equal((await db.query("select public.has_permission('users.view') ok")).rows[0].ok, false)
    assert.equal((await db.query("select public.has_permission('users.disable') ok")).rows[0].ok, false)
  })

  await test("A suspended Admin cannot read the audit log or other people's profiles", async () => {
    await as("susAdmin", "aal2")
    await expectFail("select * from public.get_audit_log(null, null, null, null, 10, 0)", [], /Missing permission/)
    assert.equal(await count("select count(*) n from public.profiles where id <> auth.uid()"), 0)
  })

  await test("A suspended foreman, engineer and client read no project work", async () => {
    for (const key of ["susFore", "susEng", "susClient"]) {
      await as(key)
      assert.equal(await count("select count(*) n from public.projects where id = $1", [project]), 0, key + " still sees the project")
      assert.equal(await count("select count(*) n from public.pins where project_id = $1", [project]), 0, key + " still sees pins")
      assert.equal(await count("select count(*) n from public.blueprints where project_id = $1", [project]), 0, key + " still sees sheets")
      assert.equal(await count("select count(*) n from public.project_members where project_id = $1 and user_id <> auth.uid()", [project]), 0, key + " still sees the rest of the team")
    }
  })

  await test("A suspended foreman and engineer cannot write: no progress report, no pin, no daily report", async () => {
    await as("susFore")
    await expectFail("select public.report_pin_progress($1, 'in_progress', 'still working', null)", [pin], /./)
    await expectFail("insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date, 'work')", [project], /./)
    await as("susEng")
    await expectFail("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, 'Sneaky', 5, 5)", [project, sheet], /./)
    await system()
    assert.equal(await count("select count(*) n from public.pins where project_id = $1 and title = 'Sneaky'", [project]), 0)
    assert.equal(await count("select count(*) n from public.daily_reports where project_id = $1", [project]), 0)
  })

  await test("A suspended person cannot forge a notification (the table is read-only to every signed-in account)", async () => {
    await as("susClient")
    await expectFail("insert into public.notifications(user_id, kind, title) values ($1, 'x', 'forged')", [ids.susClient], /permission denied/)
  })

  await test("Enabling the account again restores access without changing the role or the work", async () => {
    await enable("susFore", "susClient", "susAdmin")
    await as("susFore")
    assert.equal((await db.query("select public.is_active() ok")).rows[0].ok, true)
    assert.equal(await count("select count(*) n from public.pins where id = $1", [pin]), 1)
    await as("susAdmin", "aal2")
    assert.equal((await db.query("select public.has_permission('users.view') ok")).rows[0].ok, true)
    await system()
    const row = (await db.query("select role, status from public.profiles where id = $1", [ids.susFore])).rows[0]
    assert.deepEqual({ ...row }, { role: "foreman", status: "active" })
  })

  await test("A notification written while the account was suspended is there after it is enabled (the notice for the person)", async () => {
    await system()
    await db.query("insert into public.notifications(user_id, kind, title, body) values ($1, 'account.suspended', 'Your account was suspended', 'Reason: test')", [ids.susFore])
    await as("susFore")
    assert.equal(await count("select count(*) n from public.notifications where kind = 'account.suspended'"), 1)
  })
}
