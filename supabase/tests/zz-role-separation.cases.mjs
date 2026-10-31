import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  const system = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await system()
  for (const [key, role] of [["splitAdmin", "admin"], ["splitPrimary", "project_manager"], ["splitBackup", "project_manager"], ["splitOther", "project_manager"], ["splitEng", "engineer"], ["splitFore", "foreman"], ["splitClient", "client"], ["splitNew", "foreman"]]) await addUser(key, role)
  await db.query("insert into public.admin_permissions(user_id, permission) values ($1, 'biometrics.manage') on conflict do nothing", [ids.splitAdmin])
  const project = (await db.query("insert into public.projects(code,name) values ('ROLE-SPLIT', 'Role separation project') returning id")).rows[0].id
  const other = (await db.query("insert into public.projects(code,name) values ('ROLE-OTHER', 'Other separation project') returning id")).rows[0].id
  const sheet = (await db.query("insert into public.blueprints(project_id,title,blueprint_type) values ($1,'Separation plan','architectural') returning id", [project])).rows[0].id
  for (const key of ["splitEng", "splitFore", "splitClient"]) await db.query("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids[key]])
  for (const key of ["splitEng", "splitFore"]) await db.query("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values ($1,$2,'architectural','assigned')", [project, ids[key]])
  const pin = (await db.query("insert into public.pins(project_id,blueprint_id,title,x,y,assigned_to) values ($1,$2,'Separation task',20,20,$3) returning id", [project, sheet, ids.splitFore])).rows[0].id

  await test("Role separation: Admin still creates projects and assigns, replaces and removes primary/backup managers", async () => {
    await as("splitAdmin", "aal2")
    await db.query("insert into public.projects(code,name) values ('ADMIN-NEW','Admin still creates projects')")
    await db.query("select public.assign_project_manager($1,$2,'primary')", [project, ids.splitPrimary])
    await db.query("select public.assign_project_manager($1,$2,'backup')", [project, ids.splitBackup])
    await db.query("select public.assign_project_manager($1,$2,'backup')", [project, ids.splitOther])
    await db.query("select public.remove_project_manager($1,$2)", [project, ids.splitOther])
    await db.query("select public.assign_project_manager($1,$2,'backup')", [project, ids.splitBackup])
    assert.equal((await db.query("select * from public.get_project_managers($1)", [project])).rows.length, 2)
  })

  await test("Role separation: Admin reads teams/access but cannot add, remove or rewrite project memberships", async () => {
    await as("splitAdmin", "aal2")
    assert.equal((await db.query("select * from public.get_project_team($1)", [project])).rows.length, 3)
    assert.equal((await db.query("select * from public.project_blueprint_access where project_id=$1", [project])).rows.length, 2)
    await expectFail("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids.splitNew], /row-level security/)
    assert.equal((await db.query("delete from public.project_members where project_id=$1 and user_id=$2 returning user_id", [project, ids.splitFore])).rows.length, 0)
    assert.equal((await db.query("update public.project_members set user_id=$3 where project_id=$1 and user_id=$2 returning user_id", [project, ids.splitFore, ids.splitNew])).rows.length, 0)
  })

  await test("Role separation: Admin cannot change blueprint grants or work assignment through RPCs", async () => {
    await as("splitAdmin", "aal2")
    await expectFail("select public.set_blueprint_access($1,$2,'{\"architectural\":\"view\"}')", [project, ids.splitEng], /Project Managers/)
    await expectFail("select public.assign_work_item($1,null)", [pin], /Project Managers/)
    await expectFail("insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values ($1,$2,'electrical','assigned')", [project, ids.splitFore], /row-level security|permission denied/)
  })

  await test("Role separation: lead fields cannot bypass Admin team restrictions; ordinary project edits still save", async () => {
    await as("splitAdmin", "aal2")
    await expectFail("insert into public.projects(code,name,lead_engineer_id) values ('LEAD-BYPASS','Blocked lead bypass',$1)", [ids.splitEng], /Project Managers/)
    await expectFail("update public.projects set lead_engineer_id=$2 where id=$1", [project, ids.splitEng], /Project Managers/)
    await expectFail("update public.projects set lead_foreman_id=$2 where id=$1", [project, ids.splitNew], /Project Managers/)
    assert.equal((await db.query("update public.projects set name='Admin project edit', location='Saved location' where id=$1 returning id", [project])).rows.length, 1)
  })

  await test("Role separation: primary and backup PMs manage their own team, blueprint access and leads", async () => {
    await as("splitPrimary")
    await db.query("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids.splitNew])
    await db.query("select public.set_blueprint_access($1,$2,'{\"architectural\":\"assigned\"}')", [project, ids.splitNew])
    await db.query("update public.projects set lead_engineer_id=$2,lead_foreman_id=$3 where id=$1", [project, ids.splitEng, ids.splitNew])
    await as("splitBackup")
    await db.query("select public.assign_work_item($1,$2)", [pin, ids.splitNew])
    await db.query("select public.set_blueprint_access($1,$2,'{\"architectural\":\"view\"}')", [project, ids.splitFore])
    assert.equal((await db.query("delete from public.project_members where project_id=$1 and user_id=$2 returning user_id", [project, ids.splitClient])).rows.length, 1)
    await expectFail("select public.assign_project_manager($1,$2,'primary')", [project, ids.splitOther], /Only an Admin/)
  })

  await test("Role separation: another PM and archived-project PMs cannot change the team or grants", async () => {
    await as("splitOther")
    await expectFail("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids.splitClient], /row-level security/)
    await expectFail("select public.set_blueprint_access($1,$2,'{\"architectural\":\"view\"}')", [project, ids.splitNew], /Project Managers/)
    await as("splitAdmin", "aal2"); await db.query("select public.set_project_archived($1,true)", [project])
    await as("splitPrimary")
    await expectFail("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids.splitClient], /row-level security/)
    await expectFail("select public.set_blueprint_access($1,$2,'{\"architectural\":\"view\"}')", [project, ids.splitNew], /Project Managers/)
    await as("splitAdmin", "aal2"); await db.query("select public.set_project_archived($1,false)", [project])
    assert.equal((await db.query("select * from public.project_members where project_id=$1", [other])).rows.length, 0)
  })

  await test("Role separation: Super Admin recovery and Admin biometrics retain active-account/MFA requirements", async () => {
    await as("super", "aal2")
    await db.query("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids.splitClient])
    await db.query("select public.set_blueprint_access($1,$2,'{\"architectural\":\"assigned\"}')", [project, ids.splitEng])
    await as("super", "aal1")
    await expectFail("select public.set_blueprint_access($1,$2,'{\"architectural\":\"view\"}')", [project, ids.splitEng], /Project Managers/)
    await as("splitAdmin", "aal2")
    assert.equal((await db.query("select public.has_permission('biometrics.manage') ok")).rows[0].ok, true)
    await as("splitAdmin", "aal1")
    assert.equal((await db.query("select public.has_permission('biometrics.manage') ok")).rows[0].ok, false)
    await expectFail("select public.assign_project_manager($1,$2,'primary')", [project, ids.splitOther], /Only an Admin/)
  })

  await test("Role separation: disabling a lead still clears it safely through the internal cleanup trigger", async () => {
    await as("splitAdmin", "aal2")
    await asOwner() // The account-management backend writes profiles on behalf of this Admin.
    await db.query("update public.profiles set status='disabled' where id=$1", [ids.splitNew])
    assert.equal((await db.query("select lead_foreman_id from public.projects where id=$1", [project])).rows[0].lead_foreman_id, null)
    await as("splitNew")
    assert.equal((await db.query("select public.can_report_on_project($1) ok", [project])).rows[0].ok, false)
  })
}
