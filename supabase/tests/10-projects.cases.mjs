// Tests for 0005 (fix + hardening) and 0006 (project leads, scope, team API). Called by run-sql-tests.mjs.
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count }) {
  const newProject = async (code, extra = "") => {
    await as(extra ? "super" : "admin", "aal2")
    const { rows } = await db.query(
      `insert into public.projects (code, name${extra ? ", " + extra.split("|")[0] : ""}) values ($1, 'Test ${code}'${extra ? ", " + extra.split("|")[1] : ""}) returning id`,
      [code],
    )
    return rows[0].id
  }

  await test("created_by is filled automatically with the signed-in admin", async () => {
    await asOwner()
    const { rows } = await db.query("select created_by from public.projects where code = 'VCB-001'")
    if (rows[0].created_by !== ids.admin) throw new Error(`created_by was ${rows[0].created_by}`)
  })

  await test("Deleting a user who approved / created things is allowed (history kept)", async () => {
    await asOwner()
    await db.query("insert into auth.users (id, email) values (gen_random_uuid(), 'temp@test.local')")
    const { rows } = await db.query("select id from auth.users where email = 'temp@test.local'")
    const tempId = rows[0].id
    await db.query("update public.profiles set role = 'admin', status = 'active' where id = $1", [tempId])
    await db.query("update public.profiles set approved_by = $1 where id = $2", [tempId, ids.eng1])
    await db.query("insert into public.audit_log (actor_id, target_id, action) values ($1, $1, 'test')", [tempId])
    await db.query("delete from auth.users where id = $1", [tempId])
    const n = await count("select count(*) n from public.audit_log where action = 'test' and actor_id is null")
    if (n !== 1) throw new Error("audit row should remain with actor_id null")
    await db.query("update public.profiles set approved_by = null where id = $1", [ids.eng1])
  })

  await test("Engineer in charge and Foreman in charge are saved and added to the team", async () => {
    const pid = await newProject("LEAD-1", `lead_engineer_id, lead_foreman_id, manager_name, disciplines|'${ids.eng1}', '${ids.fore1}', 'Mr. Valencia', array['mep','civil_structural']`)
    await asOwner()
    const members = await count("select count(*) n from public.project_members where project_id = $1", [pid])
    if (members !== 2) throw new Error(`expected 2 team members, got ${members}`)
    ids.lead1 = pid
  })

  await test("Wrong role as lead is rejected (foreman as engineer, client as foreman)", async () => {
    await as("super", "aal2")
    await expectFail(`insert into public.projects (code, name, lead_engineer_id) values ('BAD-1', 'Valid name', '${ids.fore1}')`, [], /engineer in charge/)
    await expectFail(`insert into public.projects (code, name, lead_foreman_id) values ('BAD-2', 'Valid name', '${ids.client1}')`, [], /foreman in charge/)
    await expectFail(`insert into public.projects (code, name, lead_engineer_id) values ('BAD-3', 'Valid name', '${ids.pending1}')`, [], /engineer in charge/)
  })

  await test("Invalid project data is rejected by the database (short name, bad code, duplicate code)", async () => {
    await as("admin", "aal2")
    await expectFail("insert into public.projects (code, name) values ('SHORT-1', 'x')", [], /projects_name_check/)
    await expectFail("insert into public.projects (code, name) values ('X', 'Valid name')", [], /projects_code_check/)
    await expectFail("insert into public.projects (code, name) values ('VCB-001', 'Valid name')", [], /duplicate key/)
  })

  await test("Invalid discipline values are rejected", async () => {
    await as("admin", "aal2")
    await expectFail("insert into public.projects (code, name, disciplines) values ('BAD-4', 'Valid name', array['plumbing'])", [], /projects_disciplines_check/)
  })

  await test("Changing the engineer in charge adds the new one to the team", async () => {
    await as("super", "aal2")
    await expectOk("update public.projects set lead_engineer_id = $1 where id = $2", [ids.eng2, ids.lead1])
    await asOwner()
    const n = await count("select count(*) n from public.project_members where project_id = $1 and user_id = $2", [ids.lead1, ids.eng2])
    if (n !== 1) throw new Error("new lead was not added to the team")
  })

  await test("Removing the lead from the team clears the lead field", async () => {
    await as("super", "aal2")
    await expectOk("delete from public.project_members where project_id = $1 and user_id = $2", [ids.lead1, ids.eng2])
    await asOwner()
    const { rows } = await db.query("select lead_engineer_id from public.projects where id = $1", [ids.lead1])
    if (rows[0].lead_engineer_id !== null) throw new Error("lead_engineer_id should be null")
  })

  await test("A disabled lead stops being lead", async () => {
    await asOwner()
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.fore1])
    const { rows } = await db.query("select lead_foreman_id from public.projects where id = $1", [ids.lead1])
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.fore1])
    if (rows[0].lead_foreman_id !== null) throw new Error("disabled foreman is still lead")
  })

  await test("get_project_team: members see names and roles, outsiders see nothing", async () => {
    await as("admin", "aal2")
    const pid = (await db.query("select id from public.projects where code = 'VCB-001'")).rows[0].id
    await as("eng1")
    const team = await db.query("select * from public.get_project_team($1)", [pid])
    if (team.rows.length !== 2) throw new Error(`member should see 2 people, saw ${team.rows.length}`)
    if (!team.rows.every((r) => r.full_name && r.role)) throw new Error("names/roles missing")
    if ("email" in team.rows[0]) throw new Error("team API must not expose emails")
    await as("eng2")
    const none = await db.query("select * from public.get_project_team($1)", [pid])
    if (none.rows.length !== 0) throw new Error("unassigned engineer can see a team")
    await as("admin", "aal1")
    const noMfa = await db.query("select * from public.get_project_team($1)", [pid])
    if (noMfa.rows.length !== 0) throw new Error("admin without MFA can see a team")
  })

  await test("Anonymous users cannot call get_project_team or read projects", async () => {
    await as(null)
    await expectFail("select * from public.get_project_team(gen_random_uuid())", [], /permission denied/)
    const n = await count("select count(*) n from public.projects").catch(() => 0)
    if (n !== 0) throw new Error("anon can read projects")
  })

  await test("Client cannot assign themselves to a project", async () => {
    await as("client1")
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [ids.lead1, ids.client1], /row-level security/)
  })

  await test("0007: trigger-only functions cannot be called through the API", async () => {
    for (const who of ["eng1", "admin"]) {
      await as(who, "aal2")
      await expectFail("select public.handle_new_user()", [], /permission denied/)
      await expectFail("select public.sync_project_leads()", [], /permission denied/)
      await expectFail("select public.log_project_change()", [], /permission denied/)
    }
    await as(null)
    await expectFail("select public.handle_new_user()", [], /permission denied/)
  })

  await test("0007: RLS helpers are closed to anonymous users but still work for signed-in users", async () => {
    await as(null)
    await expectFail("select public.has_permission('projects.manage')", [], /permission denied/)
    await expectFail("select public.is_super_admin()", [], /permission denied/)
    await expectFail("select public.is_project_member(gen_random_uuid())", [], /permission denied/)
    await as("eng1")
    await expectOk("select public.is_active(), public.is_aal2(), public.has_permission('x'), public.is_super_admin()")
  })

  await test("0007: triggers still fire after the revoke (create project with leads, assign member, disable lead)", async () => {
    const pid = await newProject("POST-7", `lead_engineer_id|'${ids.eng2}'`)
    await asOwner()
    if ((await count("select count(*) n from public.project_members where project_id = $1", [pid])) !== 1) throw new Error("lead was not synced")
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.eng2])
    const { rows } = await db.query("select lead_engineer_id from public.projects where id = $1", [pid])
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.eng2])
    if (rows[0].lead_engineer_id !== null) throw new Error("lead not cleared")
  })

  await test("0008: get_activity shows a safe summary to admins, filtered by project", async () => {
    await as("admin", "aal2")
    const pid = (await db.query("select id from public.projects where code = 'LEAD-1'")).rows[0].id
    const all = await db.query("select * from public.get_activity()")
    if (all.rows.length < 3) throw new Error(`expected several activity rows, got ${all.rows.length}`)
    if (!all.rows.some((r) => r.action === "projects.insert" && /LEAD-1/.test(r.subject ?? ""))) throw new Error("project creation not listed with its code")
    if (!all.rows.every((r) => r.actor_name)) throw new Error("actor name missing")
    if ("details" in all.rows[0]) throw new Error("raw audit details must not be exposed")
    const one = await db.query("select * from public.get_activity($1, 50)", [pid])
    if (!one.rows.length || !one.rows.every((r) => /LEAD-1|Valid|Test/.test(r.subject ?? "") || r.action.startsWith("project_members"))) throw new Error("project filter returned unrelated rows")
    const other = await db.query("select count(*) n from public.get_activity($1, 50) where subject ilike '%VCB-001%'", [pid])
    if (Number(other.rows[0].n) !== 0) throw new Error("another project's activity leaked into the filter")
  })

  await test("0008: get_activity is empty for engineers, admins without MFA or permission, and blocked for anon", async () => {
    await as("eng1")
    if ((await db.query("select * from public.get_activity()")).rows.length) throw new Error("engineer sees activity")
    await as("admin", "aal1")
    if ((await db.query("select * from public.get_activity()")).rows.length) throw new Error("admin without MFA sees activity")
    await as("noperm", "aal2")
    if ((await db.query("select * from public.get_activity()")).rows.length) throw new Error("admin without permissions sees activity")
    await as(null)
    await expectFail("select * from public.get_activity()", [], /permission denied/)
  })

  await test("0008: get_activity limit is capped at 50 and floored at 1", async () => {
    await as("admin", "aal2")
    if ((await db.query("select * from public.get_activity(null, 0)")).rows.length !== 1) throw new Error("lim 0 should return 1")
    if ((await db.query("select * from public.get_activity(null, 9999)")).rows.length > 50) throw new Error("limit not capped")
  })
}
