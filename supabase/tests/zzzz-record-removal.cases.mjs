import assert from "node:assert/strict"

// Tests for 20261101200000_record_removal: a Super Admin removes daily reports, site issues and client reports reversibly; nobody else can; nothing is deleted.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  for (const [key, role] of [["rrSuper", "super_admin"], ["rrAdmin", "admin"], ["rrPm", "project_manager"], ["rrEng", "engineer"], ["rrFore", "foreman"], ["rrClient", "client"]]) await addUser(key, role)
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'projects.manage'), ($1, 'blueprints.manage'), ($1, 'users.view') on conflict do nothing", [ids.rrAdmin])
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
  const P = {}
  const attempt = async (who, sql, params = [], aal = "aal2") => { await as(who, aal); try { const r = await db.query(sql, params); return { ok: true, rows: r.rows } } catch (error) { return { ok: false, message: error.message } } }
  const seen = async (who, table, where = "true") => { await as(who, "aal2"); return await count(`select count(*) n from public.${table} where project_id = '${P.one}' and ${where}`) }
  const phrase = (info) => "REMOVE " + info.label

  await test("Setup: a project with a daily report, a site issue and a client report", async () => {
    await owner()
    P.one = (await one("insert into public.projects(code, name, status) values ('RR-1', 'Record removal', 'active') returning id")).id
    P.two = (await one("insert into public.projects(code, name, status) values ('RR-2', 'Other', 'active') returning id")).id
    for (const key of ["rrEng", "rrFore", "rrClient"]) await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [P.one, ids[key]])
    for (const key of ["rrEng", "rrFore"]) await db.query("insert into public.project_blueprint_access(project_id, user_id, blueprint_type, access_level) values ($1, $2, 'architectural', 'assigned')", [P.one, ids[key]])
    P.sheet = (await one("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Plan', 'architectural') returning id", [P.one])).id
    P.pin = (await one("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, 'Wall', 10, 10) returning id", [P.one, P.sheet])).id
    await as("rrFore"); P.report = (await one("insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date, 'Laid the floor tiles') returning id", [P.one])).id
    await owner(); P.issue = (await one("insert into public.site_issue_reports(pin_id, project_id, description, severity, raised_by) values ($1, $2, 'Cracked beam near gridline B', 'high', $3) returning id", [P.pin, P.one, ids.rrEng])).id
    await as("rrClient"); P.snag = (await one("select public.submit_snag($1, 'Crack above the door', 'Hairline', 'Level 2', 'urgent') id", [P.one])).id
    await owner()
    assert.equal(await count("select count(*) n from public.daily_reports where removed_at is not null or project_id <> project_id"), 0)
  })

  await test("Before anything is removed: the people see their records exactly as before", async () => {
    for (const [who, table, expected] of [["rrFore", "daily_reports", 1], ["rrEng", "site_issue_reports", 1], ["rrClient", "client_snags", 1], ["rrAdmin", "daily_reports", 0], ["rrSuper", "client_snags", 1]])
      assert.equal(await seen(who, table), expected, `${who} reads ${table}`)
    assert.equal((await attempt("rrSuper", "select public.get_removed_records() r")).rows[0].r.length, 0)
  })

  await test("Only a Super Admin with the authenticator can search, preview, remove, restore or list removed records", async () => {
    const calls = ["select public.search_removable_records('daily_report', '')", "select public.preview_record_removal('daily_report', $1)", "select public.remove_record('daily_report', $1, 'Entered by mistake', 'REMOVE x')", "select public.restore_record('daily_report', $1)", "select public.get_removed_records()"]
    for (const [who, aal] of [["rrAdmin", "aal2"], ["rrPm", "aal2"], ["rrEng", "aal2"], ["rrFore", "aal2"], ["rrClient", "aal2"], ["rrSuper", "aal1"]]) for (const sql of calls) { const r = await attempt(who, sql, sql.includes("$1") ? [P.report] : [], aal); assert.equal(r.ok, false, who + aal + sql); assert.match(r.message, /Only a Super Admin/) }
    const found = (await attempt("rrSuper", "select public.search_removable_records('site_issue', 'record removal') r")).rows[0].r
    assert.equal(found.length, 1); assert.deepEqual({ id: found[0].id, project: found[0].project_code, status: found[0].status }, { id: P.issue, project: "RR-1", status: "high" })
    assert.equal((await attempt("rrSuper", "select public.search_removable_records('client_report', 'record removal') r")).rows[0].r.length, 1)
    assert.equal((await attempt("rrSuper", "select public.search_removable_records('daily_report', 'no such text') r")).rows[0].r.length, 0)
    assert.equal((await attempt("rrSuper", "select public.search_removable_records('daily_report', 'record removal') r")).rows[0].r.length, 1, "the search finds the report through its project name")
    assert.equal((await attempt("rrSuper", "select public.search_removable_records('nope', '')")).ok, false)
  })

  await test("Removal needs the exact confirmation, a reason and a visible project; each refusal changes nothing", async () => {
    await as("rrSuper", "aal2")
    const preview = (await db.query("select public.preview_record_removal('daily_report', $1) p", [P.report])).rows[0].p
    assert.deepEqual({ label: preview.label, code: preview.project_code, phrase: preview.confirm_phrase, removed: preview.project_removed }, { label: new Date().toISOString().slice(0, 10), code: "RR-1", phrase: "REMOVE " + new Date().toISOString().slice(0, 10), removed: false })
    const remove = (kind, id, reason, confirm) => attempt("rrSuper", "select public.remove_record($1, $2, $3, $4)", [kind, id, reason, confirm])
    for (const [args, pattern] of [[["daily_report", P.report, "abc", preview.confirm_phrase], /reason of 5 to 300/], [["daily_report", P.report, "x".repeat(301), preview.confirm_phrase], /reason of 5 to 300/],
      [["daily_report", P.report, "Entered by mistake", "remove " + preview.label], /Type the confirmation exactly/], [["daily_report", P.report, "Entered by mistake", null], /Type the confirmation exactly/],
      [["daily_report", "00000000-0000-0000-0000-000000000000", "Entered by mistake", "REMOVE x"], /Record not found/], [["site_issue", P.report, "Entered by mistake", "REMOVE x"], /Record not found/]]) {
      const r = await remove(...args); assert.equal(r.ok, false); assert.match(r.message, pattern)
    }
    await owner(); assert.equal(await count("select count(*) n from public.daily_reports where removed_at is not null"), 0)
  })

  await test("Removed: hidden from every role, nothing deleted, audited; the pin still counts the record as attached", async () => {
    await owner()
    const before = { reports: await count("select count(*) n from public.daily_reports"), issues: await count("select count(*) n from public.site_issue_reports"), snags: await count("select count(*) n from public.client_snags") }
    const day = new Date().toISOString().slice(0, 10)
    await as("rrSuper", "aal2")
    assert.deepEqual((await db.query("select public.remove_record('daily_report', $1, E'Entered by mistake\\u0007', $2) r", [P.report, "REMOVE " + day])).rows[0].r, { removed: true, label: day })
    assert.equal((await db.query("select public.remove_record('site_issue', $1, 'Duplicate of another issue', $2) r", [P.issue, "REMOVE " + P.issue.slice(0, 8).toUpperCase()])).rows[0].r.removed, true)
    assert.equal((await db.query("select public.remove_record('client_report', $1, 'Sent to the wrong project', 'REMOVE SR-0001') r", [P.snag])).rows[0].r.removed, true)
    await owner()
    assert.deepEqual({ reports: await count("select count(*) n from public.daily_reports"), issues: await count("select count(*) n from public.site_issue_reports"), snags: await count("select count(*) n from public.client_snags") }, before, "nothing was deleted")
    assert.equal((await one("select removed_reason from public.daily_reports where id = $1", [P.report])).removed_reason, "Entered by mistake", "control characters are removed")
    for (const [who, table] of [["rrSuper", "daily_reports"], ["rrAdmin", "daily_reports"], ["rrFore", "daily_reports"], ["rrEng", "daily_reports"], ["rrSuper", "site_issue_reports"], ["rrAdmin", "site_issue_reports"], ["rrEng", "site_issue_reports"], ["rrSuper", "client_snags"], ["rrAdmin", "client_snags"], ["rrClient", "client_snags"], ["rrEng", "client_snags"]])
      assert.equal(await seen(who, table), 0, `${who} sees no ${table}`)
    await owner() // the loop above ran as other people; the audit log is read as the owner
    const log = await one("select actor_id, details from public.audit_log where action = 'record.removed' and details ->> 'kind' = 'site_issue'")
    assert.equal(log.actor_id, ids.rrSuper); assert.deepEqual({ reason: log.details.reason, label: log.details.label, title: log.details.title }, { reason: "Duplicate of another issue", label: P.issue.slice(0, 8).toUpperCase(), title: "Cracked beam near gridline B" })
    assert.equal(await count("select count(*) n from public.audit_log where action = 'record.removed'"), 3)
    assert.equal((await one("select public.pin_has_records($1) r", [P.pin])).r, true, "a removed record still protects its pin from deletion")
    const bin = (await attempt("rrSuper", "select public.get_removed_records() r")).rows[0].r
    assert.deepEqual(bin.map((r) => r.kind).sort(), ["client_report", "daily_report", "site_issue"]); assert.ok(bin.every((r) => r.removed_by === "rrSuper" && r.project_code === "RR-1" && r.reason))
    assert.equal((await attempt("rrSuper", "select public.search_removable_records('daily_report', 'record removal') r")).rows[0].r.length, 0, "removed records are not offered for removal again")
    const again = await attempt("rrSuper", "select public.remove_record('site_issue', $1, 'Second time here', $2)", [P.issue, "REMOVE " + P.issue.slice(0, 8).toUpperCase()]); assert.equal(again.ok, false); assert.match(again.message, /already removed/)
  })

  await test("The removed state cannot be changed or bypassed by a signed-in account", async () => {
    const hidden = await attempt("rrAdmin", "update public.daily_reports set removed_at = null where id = $1 returning id", [P.report]); assert.equal(hidden.rows?.length ?? 0, 0, "a hidden record cannot be updated")
    await as("rrFore")
    const live = await attempt("rrFore", "update public.daily_reports set removed_at = now(), removed_reason = 'Sneaky removal' where project_id = $1 returning id", [P.one], "aal1"); assert.ok(!live.ok || (live.rows?.length ?? 0) === 0)
    const born = await attempt("rrFore", "insert into public.daily_reports(project_id, report_date, work_done, removed_at, removed_reason) values ($1, current_date - 5, 'x', now(), 'Sneaky removal')", [P.one], "aal1"); assert.equal(born.ok, false); assert.match(born.message, /cannot be created in the recycle bin|permission denied/)
    await owner(); assert.equal(await count("select count(*) n from public.daily_reports where removed_at is not null"), 1)
    await db.query("update public.daily_reports set removed_at = removed_at where id = $1", [P.report]) // the backend is not restricted
  })

  await test("A record cannot be removed or restored while its project is in the recycle bin", async () => {
    await owner(); await db.query("update public.projects set archived_at = now() where id = $1", [P.two])
    await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [P.two, ids.rrFore])
    await as("rrFore"); const other = (await one("insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date - 2, 'Other site work') returning id", [P.two])).id
    await owner()
    await as("rrAdmin", "aal2"); await db.query("select public.remove_project($1, 'Created by mistake', 'RR-2')", [P.two])
    const r = await attempt("rrSuper", "select public.remove_record('daily_report', $1, 'Entered by mistake', $2)", [other, "REMOVE " + new Date().toISOString().slice(0, 10)]); assert.equal(r.ok, false); assert.match(r.message, /project is in the recycle bin/)
    assert.equal((await attempt("rrSuper", "select public.search_removable_records('daily_report', 'other') r")).rows[0].r.length, 0, "records of a removed project are not offered")
    await as("rrAdmin", "aal2"); await db.query("select public.restore_removed_project($1, null)", [P.two])
  })

  await test("Restore: only a removed record, back exactly as it was, audited", async () => {
    await as("rrSuper", "aal2")
    const r = (await db.query("select public.restore_record('daily_report', $1) r", [P.report])).rows[0].r; assert.equal(r.restored, true)
    await expectFail("select public.restore_record('daily_report', $1)", [P.report], /not removed/)
    for (const [kind, id] of [["site_issue", P.issue], ["client_report", P.snag]]) assert.equal((await db.query("select public.restore_record($1, $2) r", [kind, id])).rows[0].r.restored, true)
    assert.equal(await seen("rrFore", "daily_reports"), 1); assert.equal(await seen("rrEng", "site_issue_reports"), 1); assert.equal(await seen("rrClient", "client_snags"), 1)
    await owner()
    const row = await one("select removed_at, removed_by, removed_reason, work_done from public.daily_reports where id = $1", [P.report]); assert.deepEqual([row.removed_at, row.removed_by, row.removed_reason, row.work_done], [null, null, null, "Laid the floor tiles"])
    assert.equal(await count("select count(*) n from public.audit_log where action = 'record.restored'"), 3)
    assert.equal((await attempt("rrSuper", "select public.get_removed_records() r")).rows[0].r.length, 0)
  })
}
