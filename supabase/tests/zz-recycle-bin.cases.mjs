import assert from "node:assert/strict"

// Tests for 20261101180000_project_recycle_bin: a removed project is hidden (not deleted) for every role, keeps every row, and comes back as archived.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  for (const [key, role] of [["rbSuper", "super_admin"], ["rbAdmin", "admin"], ["rbNoPerm", "admin"], ["rbPm", "project_manager"], ["rbEng", "engineer"], ["rbFore", "foreman"], ["rbClient", "client"], ["rbEngB", "engineer"]]) await addUser(key, role)
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'projects.manage'), ($1, 'blueprints.manage'), ($1, 'users.view') on conflict do nothing", [ids.rbAdmin])
  await db.query("delete from public.admin_permissions where user_id = $1 and permission = 'projects.manage'", [ids.rbNoPerm])
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
  const P = {}
  const attempt = async (who, sql, params = [], aal = "aal1") => { await as(who, aal); try { const r = await db.query(sql, params); return { ok: true, rows: r.rows } } catch (error) { return { ok: false, message: error.message } } }
  const seen = async (who, table, where = "true", aal = "aal2") => { await as(who, aal); return await count(`select count(*) n from public.${table} where ${table === "projects" ? "code like 'RB-%' and " : ""}${where}`) }

  await test("Setup: a project with a team, a plan, work, evidence, reports and a notification; a second project beside it", async () => {
    await owner()
    P.one = (await one("insert into public.projects(code, name, status) values ('RB-1', 'Recycle tower', 'active') returning id")).id
    P.two = (await one("insert into public.projects(code, name, status) values ('RB-2', 'Other site', 'active') returning id")).id
    for (const key of ["rbEng", "rbFore", "rbClient"]) await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [P.one, ids[key]])
    await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [P.two, ids.rbEngB])
    await db.query("insert into public.project_managers(project_id, user_id, designation) values ($1, $2, 'primary')", [P.one, ids.rbPm])
    P.sheet = (await one("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Plan', 'architectural') returning id", [P.one])).id
    P.pin = (await one("insert into public.pins(project_id, blueprint_id, title, x, y, assigned_to) values ($1, $2, 'Wall', 10, 10, $3) returning id", [P.one, P.sheet, ids.rbFore])).id
    P.pin2 = (await one("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, 'Slab', 20, 20) returning id", [P.one, P.sheet])).id
    await db.query("update public.pins set status = 'for_review' where id = $1", [P.pin2])
    await as("rbFore"); await db.query("insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date, 'Tiles')", [P.one])
    await as("rbClient"); await db.query("insert into public.project_questions(project_id, question) values ($1, 'When is turnover?')", [P.one])
    await owner()
    await db.query("insert into public.notifications(user_id, kind, title, project_id) values ($1, 'pin.assigned', 'A task for you', $2)", [ids.rbFore, P.one])
    await db.query("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Other plan', 'architectural')", [P.two])
    for (const [project, key] of [[P.one, "rbEng"], [P.one, "rbFore"], [P.two, "rbEngB"]]) await db.query("insert into public.project_blueprint_access(project_id, user_id, blueprint_type, access_level) values ($1, $2, 'architectural', 'assigned')", [project, ids[key]])
    assert.equal(await count("select count(*) n from public.projects where deleted_at is not null"), 0)
  })

  await test("Before anything is removed: every role sees what it saw before (the access functions are unchanged for a project that is not in the bin)", async () => {
    assert.equal(await seen("rbSuper", "projects"), 2); assert.equal(await seen("rbAdmin", "projects"), 2)
    assert.equal(await seen("rbEng", "projects"), 1); assert.equal(await seen("rbFore", "projects"), 1); assert.equal(await seen("rbClient", "projects"), 1); assert.equal(await seen("rbPm", "projects"), 1); assert.equal(await seen("rbEngB", "projects"), 1)
    assert.equal(await seen("rbEng", "pins"), 2); assert.equal(await seen("rbFore", "daily_reports"), 1); assert.equal(await seen("rbClient", "project_questions"), 1); assert.equal(await seen("rbFore", "notifications", "project_id is not null"), 1)
    assert.equal((await attempt("rbAdmin", "select public.get_recycle_bin() b", [], "aal2")).rows[0].b.projects.length, 0)
  })

  await test("Who may use the bin: only Super Admin or an Admin with the Projects permission, with the authenticator", async () => {
    for (const [who, aal] of [["rbPm", "aal1"], ["rbEng", "aal1"], ["rbClient", "aal1"], ["rbNoPerm", "aal2"], ["rbAdmin", "aal1"]]) {
      for (const sql of ["select public.get_recycle_bin()", "select public.preview_project_removal($1)", "select public.remove_project($1, 'A good reason', 'RB-1')", "select public.restore_removed_project($1, null)"]) {
        const result = await attempt(who, sql, sql.includes("$1") ? [P.one] : [], aal)
        assert.equal(result.ok, false, `${who} ${aal}: ${sql}`); assert.match(result.message, /Only an Admin with the Projects permission/)
      }
    }
    const preview = (await attempt("rbAdmin", "select public.preview_project_removal($1) p", [P.one], "aal2")).rows[0].p
    assert.deepEqual({ code: preview.code, archived: preview.archived, removed: preview.removed }, { code: "RB-1", archived: false, removed: false })
    assert.deepEqual(preview.contents, { plans: 1, pins: 2, pins_with_work: 1, evidence_pins: 1, team: 3, daily_reports: 1, inspections: 0, defects: 0, site_issues: 0, client_reports: 0, questions: 1, photos: 0, devices: 0, scans: 0, attendance_workers: 0, devices_total: 0 })
  })

  await test("Removing needs an archived project, a reason, the typed code; each check is enforced by the database", async () => {
    await as("rbAdmin", "aal2")
    await expectFail("select public.remove_project($1, 'No longer needed', 'RB-1')", [P.one], /Archive the project first/)
    await as("rbAdmin", "aal2"); await db.query("select public.set_project_archived($1, true)", [P.one])
    await expectFail("select public.remove_project($1, 'abc', 'RB-1')", [P.one], /reason of 5 to 300/)
    await expectFail("select public.remove_project($1, $2, 'RB-1')", [P.one, "x".repeat(301)], /reason of 5 to 300/)
    await expectFail("select public.remove_project($1, 'No longer needed', 'rb-1')", [P.one], /Type the project code exactly/)
    await expectFail("select public.remove_project($1, 'No longer needed', null)", [P.one], /Type the project code exactly/)
    await expectFail("select public.remove_project('00000000-0000-0000-0000-000000000000', 'No longer needed', 'RB-1')", [], /Project not found/)
    await owner(); assert.equal(await count("select count(*) n from public.projects where deleted_at is not null"), 0, "every refusal left the project exactly as it was")
  })

  await test("Removed: hidden from every role and every list, nothing deleted, other projects untouched", async () => {
    const before = {}
    await owner()
    for (const table of ["blueprints", "pins", "pin_events", "daily_reports", "project_members", "project_questions", "notifications"]) before[table] = await count(`select count(*) n from public.${table}`)
    await as("rbAdmin", "aal2")
    const result = (await db.query("select public.remove_project($1, E'Duplicate of RB-2\\u0007', 'RB-1') r", [P.one])).rows[0].r
    assert.deepEqual(result, { removed: true, code: "RB-1" })
    await owner()
    for (const table of Object.keys(before)) assert.equal(await count(`select count(*) n from public.${table}`), before[table], table + ": every row is still there")
    const row = await one("select deleted_at, deleted_by, deleted_reason, archived_at from public.projects where id = $1", [P.one])
    assert.ok(row.deleted_at && row.archived_at); assert.equal(row.deleted_by, ids.rbAdmin); assert.equal(row.deleted_reason, "Duplicate of RB-2", "control characters are removed from the reason")
    const log = await one("select actor_id, details from public.audit_log where action = 'project.removed' order by id desc limit 1")
    assert.equal(log.actor_id, ids.rbAdmin); assert.equal(log.details.reason, "Duplicate of RB-2"); assert.equal(log.details.code, "RB-1"); assert.equal(log.details.contents.pins, 2)
    for (const [who, aal] of [["rbSuper", "aal2"], ["rbAdmin", "aal2"], ["rbNoPerm", "aal2"], ["rbPm", "aal1"], ["rbEng", "aal1"], ["rbFore", "aal1"], ["rbClient", "aal1"]]) {
      await as(who, aal)
      for (const [table, where] of [["projects", "id = '" + P.one + "'"], ["blueprints", "project_id = '" + P.one + "'"], ["pins", "project_id = '" + P.one + "'"], ["pin_events", "project_id = '" + P.one + "'"], ["daily_reports", "project_id = '" + P.one + "'"], ["project_questions", "project_id = '" + P.one + "'"], ["project_members", "project_id = '" + P.one + "'"], ["notifications", "project_id = '" + P.one + "'"]])
        assert.equal(await count(`select count(*) n from public.${table} where ${where}`), 0, `${who} sees no ${table} of the removed project`)
      assert.equal(await count("select count(*) n from public.viewable_project_ids() v where v = $1", [P.one]), 0)
    }
    assert.equal(await seen("rbAdmin", "projects"), 1); assert.equal(await seen("rbEngB", "projects"), 1, "the other project is untouched"); assert.equal(await seen("rbEngB", "blueprints", "project_id = '" + P.two + "'"), 1)
    assert.equal(await seen("rbEng", "projects"), 0)
    const bin = (await attempt("rbSuper", "select public.get_recycle_bin() b", [], "aal2")).rows[0].b.projects
    assert.equal(bin.length, 1); assert.deepEqual({ code: bin[0].code, reason: bin[0].reason, by: bin[0].removed_by, contents: bin[0].contents.pins }, { code: "RB-1", reason: "Duplicate of RB-2", by: "rbAdmin", contents: 2 })
    await expectFail("select public.remove_project($1, 'Second time here', 'RB-1')", [P.one], /already in the recycle bin/)
  })

  await test("Removed: its team can no longer write to it, the code stays reserved, no new reminders are made about it", async () => {
    assert.equal((await attempt("rbFore", "insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date, 'More tiles')", [P.one])).ok, false)
    assert.equal((await attempt("rbFore", "select public.report_pin_progress($1, 'in_progress', 'working')", [P.pin])).ok, false)
    assert.equal((await attempt("rbClient", "insert into public.project_questions(project_id, question) values ($1, 'Any news?')", [P.one])).ok, false)
    assert.equal((await attempt("rbEng", "update public.pins set title = 'Renamed' where id = $1 returning id", [P.pin])).rows?.length ?? 0, 0)
    await owner(); assert.equal((await one("select title from public.pins where id = $1", [P.pin])).title, "Wall")
    const dupe = await attempt("rbAdmin", "insert into public.projects(code, name) values ('RB-1', 'Looks the same')", [], "aal2"); assert.equal(dupe.ok, false); assert.match(dupe.message, /projects_code_key|duplicate key/)
    await owner(); const before = await count("select count(*) n from public.notifications")
    assert.equal((await one("select public.notify_user($1, 'pin.overdue', 'Late work', 'x', '/foreman/dashboard', $2, $3, 'rb-late') ok", [ids.rbFore, P.one, P.pin])).ok, false)
    assert.equal(await count("select count(*) n from public.notifications"), before, "nothing was created")
    assert.equal((await one("select public.notify_user($1, 'pin.overdue', 'Late work', 'x', '/foreman/dashboard', $2, $3, 'rb-late') ok", [ids.rbEngB, P.two, null])).ok, true, "other projects still notify")
  })

  await test("The backend keeps working for a removed project (devices, jobs, the SQL editor): their evidence is not lost", async () => {
    await owner()
    await db.query("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, 'Added by a job', 30, 30)", [P.one, P.sheet])
    const contents = (await one("select public.project_contents($1) c", [P.one])).c
    assert.equal(contents.pins, 3)
  })

  await test("The removed state cannot be changed or bypassed by a signed-in account", async () => {
    await as("rbAdmin", "aal2")
    const live = await attempt("rbAdmin", "update public.projects set deleted_at = now(), deleted_reason = 'Sneaky removal' where id = $1", [P.two], "aal2")
    assert.equal(live.ok, false); assert.match(live.message, /Use Remove project and Restore/)
    const clear = await attempt("rbAdmin", "update public.projects set deleted_at = null where id = $1 returning id", [P.one], "aal2"); assert.equal(clear.rows?.length ?? 0, 0, "a hidden project cannot be updated")
    const born = await attempt("rbAdmin", "insert into public.projects(code, name, deleted_at, deleted_reason) values ('RB-3', 'Born removed', now(), 'Sneaky removal')", [], "aal2"); assert.equal(born.ok, false); assert.match(born.message, /cannot be created in the recycle bin/)
    const hard = await attempt("rbAdmin", "delete from public.projects where id = $1", [P.two], "aal2"); assert.equal(hard.ok, false); assert.match(hard.message, /cannot be deleted directly/)
    const hardRemoved = await attempt("rbAdmin", "delete from public.projects where id = $1 returning id", [P.one], "aal2"); assert.equal(hardRemoved.rows?.length ?? 0, 0, "a removed project cannot be deleted by a signed-in account either")
    const pm = await attempt("rbPm", "delete from public.projects where id = $1 returning id", [P.two]); assert.equal(pm.rows?.length ?? 0, 0)
    await owner(); assert.equal(await count("select count(*) n from public.projects where code like 'RB-%'"), 2)
    assert.equal(await count("select count(*) n from public.projects where code like 'RB-%' and deleted_at is not null"), 1)
  })

  await test("Restoring: refused for others; a code in use is refused; a bad code is refused; the project returns ARCHIVED with a report of what needs attention", async () => {
    await owner(); await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.rbClient])
    await as("rbAdmin", "aal2")
    await expectFail("select public.restore_removed_project($1, null)", [P.two], /not in the recycle bin/)
    await expectFail("select public.restore_removed_project($1, 'RB-2')", [P.one], /now used by another project/)
    await expectFail("select public.restore_removed_project($1, 'not valid!')", [P.one], /2-30 characters/)
    await owner(); assert.equal(await count("select count(*) n from public.projects where deleted_at is not null"), 1, "refusals changed nothing")
    await as("rbAdmin", "aal2")
    const r = (await db.query("select public.restore_removed_project($1, null) r", [P.one])).rows[0].r
    assert.deepEqual(r, { restored: true, code: "RB-1", code_changed: false, still_archived: true, inactive_members: 1, has_primary_manager: true })
    await owner()
    const row = await one("select deleted_at, deleted_by, deleted_reason, archived_at, code from public.projects where id = $1", [P.one])
    assert.deepEqual({ removed: row.deleted_at, by: row.deleted_by, reason: row.deleted_reason, archived: Boolean(row.archived_at), code: row.code }, { removed: null, by: null, reason: null, archived: true, code: "RB-1" })
    const log = await one("select details from public.audit_log where action = 'project.recovered' order by id desc limit 1"); assert.equal(log.details.removed_reason, "Duplicate of RB-2")
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.rbClient])
  })

  await test("After the restore everything is visible again exactly as before; the project is read-only until it is un-archived", async () => {
    assert.equal(await seen("rbEng", "projects"), 1); assert.equal(await seen("rbEng", "pins"), 3); assert.equal(await seen("rbFore", "daily_reports"), 1); assert.equal(await seen("rbClient", "project_questions"), 1); assert.equal(await seen("rbFore", "notifications", "project_id is not null"), 1)
    assert.equal((await attempt("rbAdmin", "select public.get_recycle_bin() b", [], "aal2")).rows[0].b.projects.length, 0)
    assert.equal((await attempt("rbPm", "select public.manages_open_project($1) m", [P.one])).rows[0].m, false, "still archived")
    await as("rbAdmin", "aal2"); await db.query("select public.set_project_archived($1, false)", [P.one])
    assert.equal((await attempt("rbPm", "select public.manages_open_project($1) m", [P.one])).rows[0].m, true)
    assert.equal((await attempt("rbFore", "insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date - 3, 'Back at work')", [P.one])).ok, true)
  })

  await test("Restoring with a new code, and a removal by a Super Admin, are both audited", async () => {
    await as("rbSuper", "aal2"); await db.query("select public.set_project_archived($1, true)", [P.one]); await db.query("select public.remove_project($1, 'Created by mistake', 'RB-1')", [P.one])
    const r = (await db.query("select public.restore_removed_project($1, ' rb-1a ') r", [P.one])).rows[0].r
    assert.deepEqual({ code: r.code, changed: r.code_changed }, { code: "RB-1A", changed: true })
    await owner()
    const log = await one("select details from public.audit_log where action = 'project.recovered' order by id desc limit 1"); assert.deepEqual({ code: log.details.code, previous: log.details.previous_code }, { code: "RB-1A", previous: "RB-1" })
    assert.equal(await count("select count(*) n from public.audit_log where action = 'project.removed' and details ->> 'code' = 'RB-1'"), 2)
    assert.equal(await count("select count(*) n from public.audit_log where action = 'project.recovered' and details ->> 'previous_code' is not null and details ->> 'code' in ('RB-1', 'RB-1A')"), 2)
  })

  await test("The backend (SQL editor, service role) can still delete a project that is not in the bin; the signed-in guard does not reach it", async () => {
    await owner()
    const temp = (await one("insert into public.projects(code, name) values ('RB-TMP', 'Temporary') returning id")).id
    assert.equal((await db.query("delete from public.projects where id = $1 returning id", [temp])).rows.length, 1)
  })
}
