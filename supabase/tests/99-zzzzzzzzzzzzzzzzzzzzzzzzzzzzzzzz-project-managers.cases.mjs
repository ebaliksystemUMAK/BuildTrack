// Tests for 20261029095839 / 20261029100000: the Project Manager role. Admins assign a primary and a backup Project Manager per
// project; a Project Manager runs the day-to-day operations of assigned projects only and never the company administration,
// the Engineer's technical sign-off, or another Project Manager's access.
import assert from "node:assert/strict"

export default async function (ctx) {
  const { db, ids, as, asOwner, test, expectOk, expectFail, count, addUser } = ctx
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  const system = async () => {
    await asOwner()
    await db.query("select set_config('request.jwt.claims', '', false)") // no signed-in person: service role / migration
  }
  const assignPm = (project, user, slot) => db.query("select public.assign_project_manager($1, $2, $3) r", [project, user, slot])
  const notes = (user, kind) => count("select count(*) n from public.notifications where user_id = $1 and kind = $2", [user, kind])
  const revisionSql = `insert into public.blueprint_revisions
    (blueprint_id, project_id, revision, file_path, file_name, mime_type, size_bytes, preview_path, preview_width, preview_height)
    values ($1, $2, 1, $3, 'plan.pdf', 'application/pdf', 1000, $3, 800, 600)`

  await asOwner()
  await db.query("select set_config('buildtrack.test_type_access', 'strict', false)")
  for (const [key, role] of [["pmA", "project_manager"], ["pmB", "project_manager"], ["pmC", "project_manager"], ["pmEng", "engineer"],
    ["pmFore", "foreman"], ["pmFore2", "foreman"], ["pmClient", "client"], ["pmBasic", "user"]]) await addUser(key, role)
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'projects.manage'), ($1, 'blueprints.manage'), ($1, 'users.view') on conflict do nothing", [ids.admin])

  const P = {}
  let sheet
  let pin

  await test("PM: setup — three projects; the Engineer is on P1", async () => {
    await as("admin", "aal2")
    P.one = (await one("insert into public.projects (code, name, status) values ('PM-1', 'Managed tower', 'active') returning id")).id
    P.two = (await one("insert into public.projects (code, name, status) values ('PM-2', 'Other site', 'active') returning id")).id
    P.three = (await one("insert into public.projects (code, name) values ('PM-3', 'Unmanaged site') returning id")).id
    await as("super", "aal2") // Initial team fixture; Admin manager assignment is tested separately.
    await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.one, ids.pmEng])
    await expectOk("select public.set_blueprint_access($1, $2, '{\"architectural\":\"assigned\"}')", [P.one, ids.pmEng])
  })

  await test("PM: only an Admin with the Projects permission + MFA assigns Project Managers; nobody writes the table directly", async () => {
    await as("pmA")
    await expectFail("select public.assign_project_manager($1, $2, 'primary')", [P.one, ids.pmA], /Only an Admin/)
    for (const [who, aal] of [["admin", "aal1"], ["noperm", "aal2"], ["pmEng", "aal1"], ["pmClient", "aal1"]]) {
      await as(who, aal)
      await expectFail("select public.assign_project_manager($1, $2, 'primary')", [P.one, ids.pmA], /Only an Admin/)
    }
    await as("admin", "aal2")
    await expectFail("insert into public.project_managers (project_id, user_id, designation) values ($1, $2, 'primary')", [P.one, ids.pmA], /permission denied/)
    await expectFail("select public.assign_project_manager($1, $2, 'primary')", [P.one, ids.pmEng], /active Project Manager/)
    await expectFail("select public.assign_project_manager($1, $2, 'deputy')", [P.one, ids.pmA], /primary or backup/)
    assert.equal((await assignPm(P.one, ids.pmA, "primary")).rows[0].r, "assigned")
    assert.equal((await assignPm(P.one, ids.pmB, "backup")).rows[0].r, "assigned")
    assert.equal((await assignPm(P.one, ids.pmA, "primary")).rows[0].r, "unchanged")
    assert.equal((await assignPm(P.two, ids.pmC, "primary")).rows[0].r, "assigned")
    assert.equal((await assignPm(P.two, ids.pmA, "backup")).rows[0].r, "assigned", "one Project Manager may manage several projects")
    await asOwner()
    assert.equal(await notes(ids.pmA, "project.manager_assigned"), 2)
    assert.equal(await count("select count(*) n from public.audit_log where action = 'project_managers.insert' and details ->> 'project_id' = $1", [P.one]), 2)
    await as("admin", "aal2")
    await expectOk("select public.remove_project_manager($1, $2)", [P.two, ids.pmA])
    await expectFail("select public.remove_project_manager($1, $2)", [P.two, ids.pmA], /does not manage/)
  })

  await test("PM: sees only assigned projects and their data; unassigned projects stay hidden, also through every RPC", async () => {
    await as("pmA")
    assert.deepEqual((await db.query("select code from public.projects order by code")).rows.map((r) => r.code), ["PM-1"])
    assert.equal(await count("select count(*) n from public.projects where id = any($1)", [[P.two, P.three]]), 0)
    assert.equal(await count("select count(*) n from public.get_project_team($1)", [P.two]), 0)
    assert.equal(await count("select count(*) n from public.get_assignable_people($1)", [P.two]), 0)
    assert.ok((await count("select count(*) n from public.get_assignable_people($1)", [P.one])) >= 4)
    assert.equal(await count("select count(*) n from public.get_project_managers($1)", [P.two]), 0)
    assert.equal(await count("select count(*) n from public.get_project_managers(null)"), 2, "own project's primary and backup")
    await expectFail("select * from public.get_project_audit_log($1)", [P.two], /cannot read the history/)
    await expectFail("select public.log_project_export($1, false, 1)", [P.two], /Missing permission/)
    await expectFail("select public.set_blueprint_access($1, $2, '{\"architectural\":\"view\"}')", [P.three, ids.pmEng], /Project Managers/)
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.two, ids.pmFore], /row-level security/)
    assert.equal((await db.query("update public.projects set location = 'x' where id = $1 returning id", [P.two])).rows.length, 0)
    await expectOk("select public.log_project_export($1, false, 1)", [P.one])
    assert.equal(await count("select count(*) n from public.project_members where project_id = $1", [P.one]), 1)
    await as("pmC")
    assert.deepEqual((await db.query("select code from public.projects order by code")).rows.map((r) => r.code), ["PM-2"])
  })

  await test("PM: edits dates, location, client, phase, status and leads only; code, name, scope and archive stay with Admins", async () => {
    await as("pmA")
    await expectOk(`update public.projects set location = 'Quezon City', client_name = 'Acme Holdings', status = 'on_hold', phase = 'mobilization',
      start_date = '2026-11-01', end_date = '2027-06-30', site_lat = 14.6, site_lng = 121.0, site_radius_m = 200, lead_engineer_id = $2 where id = $1`, [P.one, ids.pmEng])
    await expectOk("update public.projects set lead_foreman_id = $2 where id = $1", [P.one, ids.pmFore])
    await asOwner()
    assert.equal(await count("select count(*) n from public.project_members where project_id = $1 and user_id = $2", [P.one, ids.pmFore]), 1, "the Foreman in charge joins the team")
    await as("pmA")
    await expectFail("update public.projects set name = 'Renamed' where id = $1", [P.one], /Project Managers can change/)
    await expectFail("update public.projects set code = 'PM-9' where id = $1", [P.one], /Project Managers can change/)
    await expectFail("update public.projects set disciplines = '{mep}' where id = $1", [P.one], /Project Managers can change/)
    await expectFail("update public.projects set archived_at = now() where id = $1", [P.one], /Project Managers can change/)
    await expectFail("update public.projects set lead_engineer_id = $2 where id = $1", [P.one, ids.pmFore2], /engineer in charge must be/)
    await expectFail("insert into public.projects (code, name) values ('PM-X', 'Self made')", [], /row-level security/)
    assert.equal((await db.query("delete from public.projects where id = $1 returning id", [P.one])).rows.length, 0)
  })

  await test("PM: builds the team (Engineers, Foremen, Clients only) and sets blueprint-type access", async () => {
    await as("pmA")
    await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2), ($1, $3)", [P.one, ids.pmFore2, ids.pmClient])
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.one, ids.pmC], /Only active Engineers, Foremen and Clients/)
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.one, ids.admin], /Only active Engineers, Foremen and Clients/)
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.one, ids.pmA], /Only active Engineers, Foremen and Clients/)
    await expectOk("select public.set_blueprint_access($1, $2, '{\"architectural\":\"view\"}')", [P.one, ids.pmFore2])
    await expectFail("select public.set_blueprint_access($1, $2, '{\"architectural\":\"view\"}')", [P.one, ids.pmClient], /team first/)
    await expectOk("delete from public.project_members where project_id = $1 and user_id = $2", [P.one, ids.pmClient])
    await asOwner()
    assert.equal(await count("select count(*) n from public.audit_log where action = 'project_members.insert' and actor_id = $1 and target_id = any($2)", [ids.pmA, [ids.pmFore2, ids.pmClient]]), 2)
  })

  await test("PM: cannot change any Project Manager's access, approve accounts, change settings or templates, or run company exports", async () => {
    await as("pmA")
    await expectFail("select public.remove_project_manager($1, $2)", [P.one, ids.pmB], /Only an Admin/)
    await expectFail("select public.assign_project_manager($1, $2, 'primary')", [P.one, ids.pmB], /Only an Admin/)
    await expectFail("update public.project_managers set designation = 'backup' where project_id = $1", [P.one], /permission denied/)
    await expectFail("delete from public.project_managers where project_id = $1", [P.one], /permission denied/)
    await expectFail("select public.set_project_archived($1, true)", [P.one], /Only an Admin/)
    await expectFail("select public.create_invite('engineer')", [], /Missing permission/)
    await expectFail("select public.set_setting('qa.acceptance_threshold', '80')", [], /.+/)
    await expectFail("select * from public.get_audit_log()", [], /Missing permission/)
    await expectFail("select * from public.get_inactive_users()", [], /Missing permission/)
    assert.equal(await count("select count(*) n from public.audit_log"), 0, "no direct audit read")
    assert.equal(await count("select count(*) n from public.attendance_devices"), 0)
    assert.equal(await count("select count(*) n from public.profiles where role = 'project_manager' and id <> $1", [ids.pmA]), 0, "no other PM profiles")
    assert.equal((await db.query("update public.profiles set role = 'admin' where id = $1 returning id", [ids.pmA]).catch(() => ({ rows: [] }))).rows.length, 0)
    await expectFail("insert into public.qa_templates (name) values ('PM template')", [], /permission denied|row-level security|violates/)
  })

  await test("PM: uploads sheets and revisions and changes a sheet's type, but never deletes sheets or edits the Engineer's work", async () => {
    await as("pmA")
    sheet = (await one("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Ground floor', 'architectural') returning id", [P.one])).id
    await expectOk(revisionSql, [sheet, P.one, `${P.one}/${sheet}/plan.pdf`])
    await expectOk("insert into storage.objects (bucket_id, name, owner) values ('blueprints', $1, $2)", [`${P.one}/${sheet}/plan-original.pdf`, ids.pmA])
    await expectOk("update public.blueprints set blueprint_type = 'civil_structural' where id = $1", [sheet])
    await expectOk("update public.blueprints set blueprint_type = 'architectural' where id = $1", [sheet])
    assert.equal((await db.query("delete from public.blueprints where id = $1 returning id", [sheet])).rows.length, 0)
    await expectFail("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Elsewhere', 'architectural')", [P.two], /row-level security/)
    await expectFail("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 5, 5, 'PM pin')", [P.one, sheet], /row-level security/)
    await expectFail("update public.blueprints set scale_width_m = 30 where id = $1", [sheet], /Only an Engineer/)
    await as("pmEng")
    pin = (await one("insert into public.pins (project_id, blueprint_id, x, y, title, due_date) values ($1, $2, 10, 10, 'Wall W1', current_date - 9) returning id, updated_at", [P.one, sheet]))
    await as("pmA")
    assert.equal((await db.query("update public.pins set status = 'verified' where id = $1 returning id", [pin.id])).rows.length, 0, "no verification")
    assert.equal((await db.query("update public.pins set title = 'PM edit' where id = $1 returning id", [pin.id])).rows.length, 0)
    await expectFail("insert into public.pin_checklist_items (pin_id, project_id, text) values ($1, $2, 'PM item')", [pin.id, P.one], /row-level security/)
    const roles = await one("select public.can_edit_blueprints($1) e, public.can_report_on_project($1) r, public.is_staff() s", [P.one])
    assert.deepEqual(roles, { e: false, r: false, s: true })
    await expectFail("insert into public.daily_reports (project_id, report_date) values ($1, current_date)", [P.one], /.+/)
  })

  await test("PM: reassigns work only to Foremen with Assigned work access; locked, reviewed and other projects' work is refused", async () => {
    await as("pmA")
    await expectFail("select public.assign_work_item($1, $2)", [pin.id, ids.pmFore], /Assigned work access/)
    await expectOk("select public.set_blueprint_access($1, $2, '{\"architectural\":\"assigned\"}')", [P.one, ids.pmFore])
    await expectFail("select public.assign_work_item($1, $2, $3)", [pin.id, ids.pmFore, "2000-01-01T00:00:00Z"], /changed since you opened it/)
    await expectOk("select public.assign_work_item($1, $2)", [pin.id, ids.pmFore])
    await asOwner()
    const row = await one("select assigned_to, assigned_by from public.pins where id = $1", [pin.id])
    assert.deepEqual(row, { assigned_to: ids.pmFore, assigned_by: ids.pmA })
    assert.ok((await notes(ids.pmFore, "pin.assigned")) >= 1, "the Foreman is told")
    await as("pmA")
    await expectOk("select public.assign_work_item($1, null)", [pin.id])
    await expectFail("select public.assign_work_item($1, $2)", [pin.id, ids.pmEng], /active Foreman/)
    await system()
    await db.query("update public.pins set locked = true where id = $1", [pin.id])
    await as("pmA")
    await expectFail("select public.assign_work_item($1, $2)", [pin.id, ids.pmFore], /locked/)
    await system()
    await db.query("update public.pins set locked = false, status = 'for_review' where id = $1", [pin.id])
    await as("pmA")
    await expectFail("select public.assign_work_item($1, $2)", [pin.id, ids.pmFore], /awaiting Engineer review/)
    await system()
    await db.query("update public.pins set status = 'in_progress' where id = $1", [pin.id])
    await as("pmC")
    await expectFail("select public.assign_work_item($1, $2)", [pin.id, ids.pmFore], /Project Manager/)
    await as("pmFore")
    await expectFail("select public.assign_work_item($1, $2)", [pin.id, ids.pmFore], /Project Manager/)
    await as("pmEng")
    await expectOk("update public.pins set assigned_to = $2 where id = $1", [pin.id, ids.pmFore])
  })

  await test("PM: reads the project's QA, attendance and history read-only; the audit log holds only that project", async () => {
    await as("pmA")
    await expectOk("select count(*) from public.qa_inspections where project_id = $1", [P.one])
    await expectOk("select public.get_qa_summary($1)", [P.one])
    const log = (await db.query("select action, total from public.get_project_audit_log($1, null, 200, 0)", [P.one])).rows
    const actions = new Set(log.map((r) => r.action))
    for (const action of ["projects.update", "project_members.insert", "project_members.delete", "project_managers.insert", "project_blueprint_access.insert", "project.export"]) assert.ok(actions.has(action), `missing ${action}`)
    assert.equal(Number(log[0].total), log.length)
    const searched = (await db.query("select action from public.get_project_audit_log($1, 'export', 50, 0)", [P.one])).rows
    assert.ok(searched.length >= 1 && searched.every((r) => r.action === "project.export"))
    await asOwner()
    const foreign = await count("select count(*) n from public.audit_log where public.audit_project_key(action, details) = $1", [P.two])
    assert.ok(foreign > 0, "the other project has history of its own")
    await as("pmEng")
    await expectFail("select * from public.get_project_audit_log($1)", [P.one], /cannot read the history/)
    await as("admin", "aal2")
    assert.ok((await count("select count(*) n from public.get_project_audit_log($1)", [P.two])) > 0, "Admins read every project's history")
  })

  await test("PM: flags attendance concerns on their project; Admins with biometrics are told; other projects and field roles cannot read them", async () => {
    await system()
    const worker = (await one("insert into public.attendance_workers (project_id, worker_code, biometric_uid, full_name) values ($1, 'PM-W1', 'pm-dev-1', 'Juan Dela Cruz') returning id", [P.one])).id
    const otherWorker = (await one("insert into public.attendance_workers (project_id, worker_code, biometric_uid, full_name) values ($1, 'PM-W2', 'pm-dev-2', 'Other Worker') returning id", [P.two])).id
    await as("pmA")
    const id = (await one("select public.flag_attendance_concern($1, current_date, $2, 'absence', 'Absent three days without notice') id", [P.one, worker])).id
    await expectFail("select public.flag_attendance_concern($1, current_date + 2, null, 'late', 'Late every day')", [P.one], /up to today/)
    await expectFail("select public.flag_attendance_concern($1, current_date, $2, 'late', 'Worker from elsewhere')", [P.one, otherWorker], /not registered/)
    await expectFail("select public.flag_attendance_concern($1, current_date, null, 'mood', 'Unknown kind')", [P.one], /what kind/)
    await expectFail("select public.flag_attendance_concern($1, current_date, null, 'late', 'Not my project')", [P.two], /Project Manager/)
    assert.equal(await count("select count(*) n from public.attendance_concerns where id = $1", [id]), 1)
    await as("pmB")
    assert.equal(await count("select count(*) n from public.attendance_concerns where id = $1", [id]), 1, "the backup Project Manager sees it")
    for (const who of ["pmC", "pmEng", "pmFore", "client1"]) {
      await as(who)
      assert.equal(await count("select count(*) n from public.attendance_concerns"), 0, `${who} reads no concerns`)
    }
    await asOwner()
    assert.ok((await notes(ids.super, "attendance.concern")) >= 1)
    assert.ok((await notes(ids.pmB, "attendance.concern")) >= 1)
    await as("pmB")
    await expectOk("select public.resolve_attendance_concern($1, 'Talked to the Foreman')", [id])
    await asOwner()
    assert.equal((await one("select status from public.attendance_concerns where id = $1", [id])).status, "resolved")
    assert.equal(await notes(ids.pmA, "attendance.concern_resolved"), 1)
  })

  await test("PM: serious late work escalates to the project's Project Managers with a link into their workspace", async () => {
    await as("pmA")
    await expectOk("select public.generate_escalations()")
    await asOwner()
    const link = await one("select link from public.notifications where user_id = $1 and kind = 'alert.escalation' and project_id = $2", [ids.pmA, P.one])
    assert.equal(link.link, `/pm/dashboard?project=${P.one}`)
    await as("pmC")
    await expectOk("select public.generate_escalations()")
    await asOwner()
    assert.equal(await count("select count(*) n from public.notifications where user_id = $1 and kind = 'alert.escalation' and project_id = $2", [ids.pmC, P.one]), 0)
  })

  await test("PM: an archived project is read-only for its Project Managers until an Admin restores it", async () => {
    await as("admin", "aal2")
    await expectOk("select public.set_project_archived($1, true)", [P.one])
    await asOwner()
    assert.equal(await notes(ids.pmA, "project.archived"), 1)
    await as("pmA")
    assert.equal(await count("select count(*) n from public.projects where id = $1 and archived_at is not null", [P.one]), 1, "still readable")
    await expectFail("update public.projects set location = 'Pasig' where id = $1", [P.one], /archived/)
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.one, ids.pmClient], /row-level security/)
    await expectFail("select public.set_blueprint_access($1, $2, '{\"architectural\":\"view\"}')", [P.one, ids.pmFore2], /Project Managers/)
    await expectFail("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Archived upload', 'architectural')", [P.one], /row-level security/)
    await expectFail("select public.assign_work_item($1, null)", [pin.id], /Project Manager/)
    await expectOk("select public.log_project_export($1, false, 1)", [P.one])
    await as("pmEng")
    assert.equal(await count("select count(*) n from public.projects where id = $1", [P.one]), 1, "field roles keep their access")
    await as("admin", "aal2")
    await expectOk("select public.set_project_archived($1, false)", [P.one])
    await as("pmA")
    await expectOk("update public.projects set location = 'Pasig' where id = $1", [P.one])
  })

  await test("PM: Admins replace, swap and remove Project Managers; access follows at once", async () => {
    await as("admin", "aal2")
    assert.equal((await assignPm(P.one, ids.pmC, "primary")).rows[0].r, "replaced")
    await asOwner()
    assert.equal(await count("select count(*) n from public.notifications where user_id = $1 and kind = 'project.manager_removed' and project_id = $2", [ids.pmA, P.one]), 1)
    await as("pmA")
    assert.equal(await count("select count(*) n from public.projects where id = $1", [P.one]), 0, "the replaced Project Manager loses the project")
    await as("admin", "aal2")
    assert.equal((await assignPm(P.one, ids.pmB, "primary")).rows[0].r, "swapped")
    await asOwner()
    assert.deepEqual((await db.query("select user_id, designation from public.project_managers where project_id = $1 order by designation", [P.one])).rows,
      [{ user_id: ids.pmC, designation: "backup" }, { user_id: ids.pmB, designation: "primary" }])
    await as("admin", "aal2")
    await expectOk("select public.remove_project_manager($1, $2)", [P.one, ids.pmC])
    await as("pmC")
    assert.deepEqual((await db.query("select code from public.projects order by code")).rows.map((r) => r.code), ["PM-2"])
  })

  await test("PM: a disabled account loses access at once; a role change away from Project Manager ends every assignment", async () => {
    await asOwner()
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.pmB])
    await as("pmB")
    assert.equal(await count("select count(*) n from public.projects"), 0)
    await asOwner()
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.pmB])
    await as("pmB")
    assert.equal(await count("select count(*) n from public.projects"), 1)
    await asOwner()
    await db.query("update public.profiles set role = 'engineer' where id = $1", [ids.pmB])
    assert.equal(await count("select count(*) n from public.project_managers where user_id = $1", [ids.pmB]), 0)
    await db.query("update public.profiles set role = 'project_manager' where id = $1", [ids.pmB])
    await as("pmB")
    assert.equal(await count("select count(*) n from public.projects"), 0, "a returning Project Manager waits for a new assignment")
  })

  await test("PM: accounts — home page, granted notice, invitations, whitelist and access review include the role", async () => {
    await asOwner()
    assert.equal((await one("select public.role_home('project_manager') h")).h, "/pm/projects")
    await db.query("update public.profiles set role = 'project_manager' where id = $1", [ids.pmBasic])
    const granted = await one("select title, link from public.notifications where user_id = $1 and kind = 'access.granted'", [ids.pmBasic])
    assert.deepEqual(granted, { title: "You now have Project Manager access", link: "/pm/projects" })
    await as("super", "aal2")
    await expectOk("select public.create_invite('project_manager')")
    await expectFail("select public.create_invite('admin')", [], /Engineer, Foreman or Client/)
    await system()
    await expectOk("insert into public.whitelisted_emails (email, assigned_role) values ('future-pm@test.local', 'project_manager')")
    await as("admin", "aal2")
    await expectOk("select * from public.get_inactive_users(0)")
    assert.ok((await count("select count(*) n from public.profiles where role = 'project_manager'")) >= 3, "Admins with the Projects permission can pick Project Managers")
  })

  await test("PM: existing roles keep their rules — Engineers still assign their work, Clients and Engineers cannot manage projects", async () => {
    await as("pmEng")
    assert.equal((await db.query("update public.projects set location = 'Engineer edit' where id = $1 returning id", [P.one])).rows.length, 0)
    await expectFail("select public.set_blueprint_access($1, $2, '{\"architectural\":\"view\"}')", [P.one, ids.pmFore2], /Project Managers/)
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.one, ids.pmClient], /row-level security/)
    assert.equal(await count("select count(*) n from public.attendance_concerns"), 0)
    await as("client1")
    await expectFail("select public.assign_work_item($1, null)", [pin.id], /Project Manager/)
    await as("admin", "aal2")
    await expectFail("select public.assign_work_item($1, null)", [pin.id], /Project Manager/)
    await as("super", "aal2")
    await expectOk("select public.assign_work_item($1, null)", [pin.id])
    await as("admin", "aal2")
    await expectOk("update public.projects set name = 'Managed tower (renamed)' where id = $1", [P.one])
  })
}
