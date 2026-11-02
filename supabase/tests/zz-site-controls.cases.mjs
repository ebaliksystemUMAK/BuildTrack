import assert from "node:assert/strict"

// Tests for 20261101150000_site_controls: read-only maintenance, feature isolation and forced logout. Everything starts OFF.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  for (const [key, role, status] of [["scSuper", "super_admin"], ["scSuper2", "super_admin"], ["scAdmin", "admin"], ["scPm", "project_manager"], ["scEng", "engineer"], ["scFore", "foreman"], ["scFore2", "foreman"], ["scClient", "client"], ["scBasic", "user"], ["scGone", "foreman", "disabled"]]) await addUser(key, role, status ?? "active")
  const project = (await db.query("insert into public.projects(code, name, status) values ('SC-1', 'Site controls project', 'active') returning id")).rows[0].id
  const other = (await db.query("insert into public.projects(code, name, status) values ('SC-2', 'Other project', 'active') returning id")).rows[0].id
  const sheet = (await db.query("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Plan', 'architectural') returning id", [project])).rows[0].id
  for (const key of ["scEng", "scFore", "scClient"]) await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [project, ids[key]])
  await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [other, ids.scFore2])
  for (const key of ["scEng", "scFore"]) await db.query("insert into public.project_blueprint_access(project_id, user_id, blueprint_type, access_level) values ($1, $2, 'architectural', 'assigned')", [project, ids[key]])
  const pin = (await db.query("insert into public.pins(project_id, blueprint_id, title, x, y, assigned_to) values ($1, $2, 'Guarded task', 10, 10, $3) returning id", [project, sheet, ids.scFore])).rows[0].id
  const visitor = async () => { await owner(); await db.exec("set role anon") }
  const status = async () => (await db.query("select public.get_site_status() s")).rows[0].s
  const decide = async (who, feature = null) => { await owner(); await db.query("select set_config('request.jwt.claims', $1, false)", [who ? JSON.stringify({ sub: ids[who], aal: "aal2", role: "authenticated" }) : "{}"]); const r = (await db.query("select public.site_write_block($1) m", [feature])).rows[0].m; await db.query("select set_config('request.jwt.claims', '{}', false)"); return r }
  const attempt = async (who, sql, params = []) => { await as(who); try { await db.query(sql, params); return { ok: true } } catch (error) { return { ok: false, code: error.code, message: error.message } } }
  const maintenance = async (on, message = "Upgrading the database.", returnsAt = null) => { await as("scSuper", "aal2"); return (await db.query("select public.set_maintenance($1, $2, $3) r", [on, message, returnsAt])).rows[0].r }
  const lock = async (feature, locked, audiences = null, message = "Switched off while we fix a problem.") => { await as("scSuper", "aal2"); return (await db.query("select public.set_feature_lock($1, $2, $3, $4) r", [feature, locked, audiences, message])).rows[0].r }
  const foremanWrites = () => attempt("scFore", "select public.report_pin_progress($1, 'in_progress', 'working')", [pin])
  const reportInsert = () => attempt("scFore", "insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date, 'Floor tiles')", [project])
  const questionInsert = () => attempt("scClient", "insert into public.project_questions(project_id, question) values ($1, 'When will the floor be done?')", [project])

  await test("Defaults: everything is off, the tables are not reachable directly, and the guard is on the work tables only", async () => {
    await owner()
    assert.equal((await db.query("select maintenance_on from public.site_controls")).rows[0].maintenance_on, false)
    assert.equal(await count("select count(*) n from public.feature_locks"), 7); assert.equal(await count("select count(*) n from public.feature_locks where locked"), 0)
    const guarded = (await db.query("select event_object_table t from information_schema.triggers where trigger_schema = 'public' and trigger_name = 'zz_site_guard' group by 1")).rows.map((r) => r.t)
    for (const table of ["pins", "pin_photos", "daily_reports", "qa_defects", "qa_inspections", "blueprint_annotations", "client_snags", "project_questions", "site_issue_reports", "site_visit_requests", "attendance_concerns", "projects", "project_members"]) assert.ok(guarded.includes(table), table + " is guarded")
    for (const table of ["profiles", "notifications", "notification_prefs", "privacy_consents", "data_requests", "access_requests", "identity_verifications", "audit_log", "email_log", "system_settings", "invite_codes", "whitelisted_emails", "biometric_attendance_events", "attendance_devices", "attendance_workers", "message_batches"]) assert.ok(!guarded.includes(table), table + " stays writable during a pause")
    assert.ok(guarded.length >= 30)
    for (const who of ["scSuper", "scFore", "scAdmin"]) { await as(who, "aal2"); for (const table of ["site_controls", "feature_locks"]) await expectFail(`select * from public.${table}`, [], /permission denied/); await expectFail("update public.site_controls set maintenance_on = true", [], /permission denied/) }
    await visitor(); await expectFail("select * from public.site_controls", [], /permission denied/)
    await owner(); const s = await status(); assert.deepEqual({ on: s.maintenance.on, restricted: s.restricted, locks: s.locks }, { on: false, restricted: false, locks: [] })
  })

  await test("Off: nothing is refused for anybody (the guard changes nothing while the controls are off)", async () => {
    assert.equal((await foremanWrites()).ok, true); assert.equal((await reportInsert()).ok, true); assert.equal((await questionInsert()).ok, true)
    assert.equal((await attempt("scEng", "update public.pins set title = 'Renamed by the engineer' where id = $1", [pin])).ok, true)
    for (const who of [null, "scSuper", "scAdmin", "scPm", "scEng", "scFore", "scClient", "scBasic", "scGone"]) assert.equal(await decide(who), null, String(who))
    for (const feature of ["quality", "daily_reports", "attendance"]) assert.equal(await decide("scFore", feature), null)
  })

  await test("Switches: only a Super Admin with MFA can read or change the controls; nobody else, not even an Admin with every permission", async () => {
    for (const who of ["scAdmin", "scPm", "scEng", "scFore", "scClient"]) {
      await as(who, "aal2")
      for (const sql of ["select public.get_site_controls()", "select public.set_maintenance(true, 'Maintenance message', null)", "select public.set_feature_lock('quality', true, null, 'A message here')", "select public.preview_force_logout('{foreman}', null)", "select public.force_logout('{foreman}', null, 1, 'LOG OUT 1', 'A good reason')"])
        await expectFail(sql, [], /Only a Super Admin/)
    }
    await as("scSuper", "aal1"); await expectFail("select public.set_maintenance(true, 'Maintenance message', null)", [], /Only a Super Admin/); await expectFail("select public.get_site_controls()", [], /Only a Super Admin/)
    await visitor(); await expectFail("select public.set_maintenance(true, 'Maintenance message', null)", [], /permission denied/); await expectFail("select public.get_site_controls()", [], /permission denied/)
    await as("scSuper", "aal2"); const controls = (await db.query("select public.get_site_controls() c")).rows[0].c
    assert.equal(controls.maintenance.on, false); assert.equal(controls.features.length, 7); assert.equal(controls.last_forced_logout, null)
  })

  await test("Maintenance: the message, return time and text are validated; a save that changes nothing does nothing", async () => {
    await as("scSuper", "aal2")
    await expectFail("select public.set_maintenance(true, 'abc', null)", [], /at least 5 characters/)
    await expectFail("select public.set_maintenance(true, $1, null)", ["x".repeat(501)], /at most 500/)
    await expectFail("select public.set_maintenance(true, 'Upgrading the database.', now() - interval '1 hour')", [], /in the future and within 14 days/)
    await expectFail("select public.set_maintenance(true, 'Upgrading the database.', now() + interval '15 days')", [], /in the future and within 14 days/)
    assert.equal((await maintenance(false)).changed, false, "switching off what is off changes nothing")
    await owner(); assert.equal(await count("select count(*) n from public.audit_log where action like 'maintenance.%'"), 0)
  })

  await test("Maintenance ON: non-admin accounts cannot change work, whether by an RPC or by a direct write; the message says why and when it ends", async () => {
    const returns = new Date(Date.now() + 3 * 3600_000).toISOString()
    assert.deepEqual({ ...(await maintenance(true, "Upgrading the database.\u0007", returns)) }, { changed: true, on: true })
    for (const outcome of [await foremanWrites(), await reportInsert(), await questionInsert(), await attempt("scEng", "update public.pins set title = 'Edited' where id = $1", [pin])]) {
      assert.equal(outcome.ok, false); assert.equal(outcome.code, "BT503", "the code the offline queue recognises"); assert.match(outcome.message, /^Maintenance: Upgrading the database\. You can still look at everything; saving changes is paused\. Expected back around \d{2} \w{3} \d{2}:\d{2} \(Manila time\)\.$/)
    }
    await owner()
    assert.equal(await count("select count(*) n from public.pins where title = 'Edited'"), 0, "nothing was changed"); assert.equal((await db.query("select maintenance_message m from public.site_controls")).rows[0].m, "Upgrading the database.", "control characters are removed")
    for (const who of ["scPm", "scBasic"]) assert.equal(typeof (await decide(who)), "string", who + " is paused too")
    assert.equal(typeof (await decide("scGone")), "string", "a suspended foreman is still treated as a foreman (they cannot write anyway)")
  })

  await test("Maintenance ON: reading, sign-in related rows, notifications, privacy, profile and preferences keep working for everyone", async () => {
    for (const who of ["scFore", "scClient", "scBasic"]) {
      await as(who)
      assert.ok((await db.query("select count(*) n from public.profiles where id = auth.uid()")).rows[0].n >= 1)
    }
    await as("scFore"); assert.ok((await db.query("select count(*) n from public.pins where id = $1", [pin])).rows[0].n >= 1, "reading the plan still works")
    assert.equal((await attempt("scFore", "select public.mark_all_notifications_read()")).ok, true)
    assert.equal((await attempt("scFore", "insert into public.notification_prefs(user_id, email_reminders) values (auth.uid(), false)")).ok, true)
    assert.equal((await attempt("scFore", "update public.profiles set phone = '0917 000 0000' where id = auth.uid()")).ok, true, "a person can still edit their own details")
    assert.equal((await attempt("scBasic", "select public.request_data_erasure('Please erase my data')")).ok, true, "the right to erasure is never paused")
    await owner(); assert.ok((await db.query("select count(*) n from public.data_requests")).rows[0].n >= 1)
  })

  await test("Maintenance ON: Admins and Super Admins (with MFA) and the backend (devices, jobs, Edge Functions) are never refused", async () => {
    for (const who of ["scSuper", "scSuper2", "scAdmin"]) assert.equal(await decide(who), null, who)
    assert.equal(await decide(null), null, "the backend has no signed-in user")
    await as("scSuper", "aal2"); await db.query("update public.pins set title = 'Fixed by the Super Admin' where id = $1", [pin])
    await db.query("insert into public.project_members(project_id, user_id) values ($1, $2) on conflict do nothing", [other, ids.scEng])
    await service()
    await db.query("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, 'Written by a device or a job', 1, 1)", [project, sheet])
    await db.query("update public.pins set title = 'Updated by the backend' where title = 'Written by a device or a job'")
    await owner(); assert.equal(await count("select count(*) n from public.pins where title = 'Updated by the backend'"), 1)
    await db.query("update public.pins set title = 'Guarded task' where id = $1", [pin])
  })

  await test("Maintenance: the status the app shows says who is restricted; switching off restores everything and is recorded", async () => {
    await as("scFore"); const foreman = await status(); assert.equal(foreman.maintenance.on, true); assert.equal(foreman.restricted, true); assert.equal(foreman.role, "foreman"); assert.equal(foreman.maintenance.message, "Upgrading the database.")
    await as("scAdmin"); const admin = await status(); assert.equal(admin.maintenance.on, true); assert.equal(admin.restricted, false)
    await visitor(); const seen = await status(); assert.deepEqual({ on: seen.maintenance.on, restricted: seen.restricted, role: seen.role, locks: seen.locks }, { on: true, restricted: false, role: null, locks: [] }); assert.ok(!JSON.stringify(seen).includes("scFore"))
    assert.equal((await maintenance(true, "Upgrading the database.", null)).changed, true, "dropping the return time is a change")
    assert.deepEqual({ ...(await maintenance(false)) }, { changed: true, on: false })
    assert.equal((await foremanWrites()).ok, true)
    await as("scFore"); assert.equal((await status()).maintenance.on, false)
    await owner(); const actions = (await db.query("select action from public.audit_log where action like 'maintenance.%' order by id")).rows.map((r) => r.action)
    assert.deepEqual(actions, ["maintenance.on", "maintenance.update", "maintenance.off"])
  })

  await test("Decision matrix: a feature lock refuses only the chosen roles, only for that feature's own tables, and never an Admin", async () => {
    assert.deepEqual({ ...(await lock("daily_reports", true, ["foreman", "engineer"], "Daily reports are being corrected.")) }, { changed: true, locked: true })
    assert.equal(await decide("scFore", "daily_reports"), "Paused: Daily reports is switched off for your role. Daily reports are being corrected.")
    assert.equal(typeof (await decide("scEng", "daily_reports")), "string")
    for (const who of ["scClient", "scBasic", "scPm"]) assert.equal(await decide(who, "daily_reports"), null, who + " is not in the audience")
    for (const who of ["scSuper", "scAdmin", null]) assert.equal(await decide(who, "daily_reports"), null, String(who))
    for (const feature of ["quality", "client_reports", "attendance", "site_issues", "site_visits", "blueprint_editor", null]) assert.equal(await decide("scFore", feature), null, "an unrelated feature is untouched: " + feature)
  })

  await test("Feature isolation: the locked feature is refused for its audience while the shared work, other features and other roles carry on", async () => {
    const refused = await reportInsert()
    assert.equal(refused.ok, false); assert.equal(refused.code, "BT503"); assert.match(refused.message, /^Paused: Daily reports is switched off for your role\./)
    assert.equal((await foremanWrites()).ok, true, "pins (shared with every feature) are not locked by a feature switch")
    assert.equal((await questionInsert()).ok, true, "client questions (another feature) are untouched")
    assert.equal((await attempt("scEng", "update public.pins set title = 'Engineer edit' where id = $1", [pin])).ok, true)
    await as("scFore"); const s = await status(); assert.deepEqual(s.locks.map((l) => l.feature), ["daily_reports"]); assert.equal(s.restricted, false)
    await as("scClient"); assert.deepEqual((await status()).locks, [], "a role outside the audience is told nothing about it")
    await as("scAdmin"); assert.deepEqual((await status()).locks, [])
    await owner(); assert.equal(await count("select count(*) n from public.daily_reports where work_done = 'Floor tiles' and project_id = $1", [project]), 1, "only the first (earlier) report exists")
  })

  await test("Feature isolation: Super Admin recovery works, the audience can be changed, and unlocking restores the feature and is recorded", async () => {
    assert.equal((await lock("daily_reports", true, ["foreman", "engineer"], "Daily reports are being corrected.")).changed, false, "the same lock again changes nothing")
    assert.equal((await lock("daily_reports", true, ["foreman"], "Daily reports are being corrected.")).changed, true)
    assert.equal(await decide("scEng", "daily_reports"), null, "the engineer was taken out of the audience")
    await as("scSuper", "aal2"); assert.equal((await db.query("select public.get_site_controls() c")).rows[0].c.features.find((f) => f.feature === "daily_reports").locked, true, "the Super Admin can always see and change the locks")
    assert.deepEqual({ ...(await lock("daily_reports", false, null, "")) }, { changed: true, locked: false })
    assert.equal((await lock("quality", false, null, "")).changed, false, "unlocking what is unlocked changes nothing, with no audit noise")
    assert.equal(await decide("scFore", "daily_reports"), null)
    await owner(); assert.deepEqual((await db.query("select action from public.audit_log where action like 'feature.%' order by id")).rows.map((r) => r.action), ["feature.lock", "feature.update", "feature.unlock"])
    assert.equal((await db.query("select details from public.audit_log where action = 'feature.lock'")).rows[0].details.label, "Daily reports")
  })

  await test("Feature switches are validated: unknown features, empty or admin audiences and missing messages are refused", async () => {
    await as("scSuper", "aal2")
    await expectFail("select public.set_feature_lock('payroll', true, null, 'A message here')", [], /Unknown feature/)
    await expectFail("select public.set_feature_lock('quality', true, '{admin}', 'A message here')", [], /never Admins/)
    await expectFail("select public.set_feature_lock('quality', true, '{super_admin,foreman}', 'A message here')", [], /never Admins/)
    await expectFail("select public.set_feature_lock('quality', true, '{}', 'A message here')", [], /Choose who is affected/)
    await expectFail("select public.set_feature_lock('quality', true, '{foreman}', 'no')", [], /at least 5 characters/)
    await expectFail("select public.set_feature_lock('quality', true, '{foreman}', $1)", ["x".repeat(501)], /at most 500/)
    await owner(); assert.equal(await count("select count(*) n from public.feature_locks where locked"), 0)
  })

  await test("Both controls together: maintenance wins for everyone it covers, and each control can be turned off on its own", async () => {
    await lock("quality", true, ["foreman"], "Inspections are paused for training.")
    assert.equal(await decide("scFore", "quality"), "Paused: Quality inspections and defect reports is switched off for your role. Inspections are paused for training.")
    await maintenance(true, "Upgrading the database.")
    assert.match(await decide("scFore", "quality"), /^Maintenance:/); assert.match(await decide("scClient", "quality"), /^Maintenance:/, "maintenance covers roles the feature lock does not")
    await maintenance(false)
    assert.match(await decide("scFore", "quality"), /^Paused:/, "the feature lock is still there"); assert.equal(await decide("scClient", "quality"), null)
    await lock("quality", false, null, "")
    assert.equal(await decide("scFore", "quality"), null)
  })

  // ---------------------------------------------------------------- forced logout
  const sign = async (...keys) => { await owner(); for (const key of keys) { await db.query("insert into auth.sessions(user_id) values ($1), ($1)", [ids[key]]); await db.query("insert into auth.refresh_tokens(user_id) values ($1)", [ids[key]]); await db.query("update auth.users set last_sign_in_at = now() - interval '2 hours' where id = $1", [ids[key]]) } }
  await sign("scFore", "scFore2", "scClient", "scEng", "scAdmin", "scSuper", "scSuper2", "scBasic", "scPm")

  await test("Forced logout preview: only active non-admin accounts in the chosen roles (and project) are counted, never an Admin, yourself or a suspended account", async () => {
    await as("scSuper", "aal2")
    const preview = async (roles, projectId = null) => (await db.query("select public.preview_force_logout($1, $2) p", [roles, projectId])).rows[0].p
    const foremen = await preview(["foreman"]); assert.deepEqual({ total: foremen.total, by_role: foremen.by_role, phrase: foremen.confirm_phrase }, { total: 2 + (await count("select count(*) n from public.profiles where role = 'foreman' and status = 'active' and id not in ($1, $2)", [ids.scFore, ids.scFore2])), by_role: { foreman: foremen.total }, phrase: `LOG OUT ${foremen.total}` })
    assert.ok(foremen.signed_in_last_24h >= 2)
    assert.equal((await preview(["foreman"], project)).total, 1, "scoped to the project: only the member"); assert.equal((await preview(["foreman", "client", "engineer"], project)).total, 3)
    assert.equal((await preview(["project_manager"], project)).total, 0, "a Project Manager not on the project is outside the scope")
    for (const bad of [["admin"], ["super_admin"], ["foreman", "admin"], [], null]) await expectFail("select public.preview_force_logout($1, null)", [bad], /Choose the roles to sign out \(never Admins\)/)
    await expectFail("select public.preview_force_logout('{foreman}', gen_random_uuid())", [], /project does not exist/)
    const none = await preview(["client"], other); assert.equal(none.total, 0)
    await owner(); await db.query("update public.profiles set status = 'active' where id = $1", [ids.scGone])
    await as("scSuper", "aal2"); const withGone = await preview(["foreman"], null); await owner(); await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.scGone])
    await as("scSuper", "aal2"); assert.equal((await preview(["foreman"], null)).total, withGone.total - 1, "a suspended account is not counted")
  })

  await test("Forced logout: strong confirmation is enforced by the database (fresh count, exact phrase, a reason) and nothing happens on a mismatch", async () => {
    await as("scSuper", "aal2")
    const total = (await db.query("select (public.preview_force_logout('{foreman}', $1)->>'total')::int t", [project])).rows[0].t
    const call = (expected, phrase, reason = "Security review of the site phones") => db.query("select public.force_logout('{foreman}', $1, $2, $3, $4) r", [project, expected, phrase, reason])
    await expectFail("select public.force_logout('{foreman}', $1, $2, $3, 'Security review of the site phones')", [project, total + 1, `LOG OUT ${total + 1}`], /number of affected accounts is now 1\. Preview again/)
    await expectFail("select public.force_logout('{foreman}', $1, $2, $3, 'Security review of the site phones')", [project, total, "log out 1"], /Type the confirmation exactly: LOG OUT 1/)
    await expectFail("select public.force_logout('{foreman}', $1, $2, $3, 'Security review of the site phones')", [project, total, null], /Type the confirmation exactly/)
    await expectFail("select public.force_logout('{foreman}', $1, $2, $3, 'no')", [project, total, `LOG OUT ${total}`], /reason of 5 to 300/)
    await expectFail("select public.force_logout('{foreman}', $1, $2, $3, $4)", [project, total, `LOG OUT ${total}`, "x".repeat(301)], /reason of 5 to 300/)
    await expectFail("select public.force_logout('{foreman,admin}', $1, 1, 'LOG OUT 1', 'Security review of the site phones')", [project], /never Admins/)
    await expectFail("select public.force_logout('{client}', $1, 0, 'LOG OUT 0', 'Security review of the site phones')", [other], /No active account matches/)
    await owner()
    assert.equal(await count("select count(*) n from auth.sessions where user_id = $1", [ids.scFore]), 2, "nothing was signed out by the refused attempts"); assert.equal(await count("select count(*) n from public.audit_log where action = 'user.force_logout'"), 0)
    assert.equal(await count("select count(*) n from public.profiles where force_logout_at is not null"), 0)
  })

  await test("Forced logout: it signs out exactly the previewed accounts, leaves Admins, other roles and other projects alone, and is recorded", async () => {
    await as("scSuper", "aal2")
    const result = (await db.query("select public.force_logout('{foreman}', $1, 1, 'LOG OUT 1', 'Security review of the site phones') r", [project])).rows[0].r
    assert.deepEqual({ ...result }, { accounts: 1, sessions_removed: 2 })
    await owner()
    assert.equal(await count("select count(*) n from auth.sessions where user_id = $1", [ids.scFore]), 0); assert.equal(await count("select count(*) n from auth.refresh_tokens where user_id = $1", [ids.scFore]), 0)
    for (const key of ["scFore2", "scClient", "scEng", "scAdmin", "scSuper", "scSuper2", "scBasic", "scPm"]) assert.equal(await count("select count(*) n from auth.sessions where user_id = $1", [ids[key]]), 2, key + " keeps the session")
    assert.deepEqual((await db.query("select id from public.profiles where force_logout_at is not null")).rows.map((r) => r.id), [ids.scFore], "only the signed-out account is stamped (the app uses it to sign the person out)")
    const log = (await db.query("select actor_id, details from public.audit_log where action = 'user.force_logout'")).rows[0]
    assert.equal(log.actor_id, ids.scSuper); assert.deepEqual(log.details, { roles: ["foreman"], project, accounts: 1, sessions_removed: 2, reason: "Security review of the site phones" })
    assert.ok(!JSON.stringify(log).match(/token|password|jwt/i))
    assert.equal((await db.query("select role, status from public.profiles where id = $1", [ids.scFore])).rows[0].status, "active", "the account is not suspended: the person can sign in again at once")
  })

  await test("Forced logout: a second one within 10 minutes is refused, and a stale confirmation cannot be replayed", async () => {
    await as("scSuper", "aal2")
    await expectFail("select public.force_logout('{client}', $1, 1, 'LOG OUT 1', 'Another security review')", [project], /done in the last 10 minutes/)
    assert.ok((await db.query("select (public.preview_force_logout('{client}', $1)->>'cooldown_seconds')::int c", [project])).rows[0].c > 0)
    await owner(); await db.query("update public.audit_log set created_at = now() - interval '11 minutes' where action = 'user.force_logout'")
    await as("scSuper", "aal2")
    assert.equal((await db.query("select (public.preview_force_logout('{client}', $1)->>'cooldown_seconds')::int c", [project])).rows[0].c, 0)
    const again = (await db.query("select public.force_logout('{client}', $1, 1, 'LOG OUT 1', 'Another security review') r", [project])).rows[0].r
    assert.equal(again.accounts, 1)
    const info = (await db.query("select public.get_site_controls()->'last_forced_logout' l")).rows[0].l
    assert.equal(info.details.accounts, 1); assert.equal(info.details.roles[0], "client")
  })

  await test("Forced logout does not touch queued offline evidence on the server side either: it only removes sessions", async () => {
    await owner()
    assert.equal(await count("select count(*) n from public.pins where id = $1", [pin]), 1); assert.equal(await count("select count(*) n from public.project_members where project_id = $1", [project]), 3)
    assert.equal(await count("select count(*) n from public.profiles where id = any ($1::uuid[]) and status = 'active'", [[ids.scFore, ids.scClient]]), 2)
  })
}
