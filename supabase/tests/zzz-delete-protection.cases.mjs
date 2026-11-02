import assert from "node:assert/strict"

// Tests for 20261101190000_delete_protection_and_purge: work, QA and attendance records cannot be erased by a side effect, and permanent deletion of a removed
// project is Super Admin-only, delayed, and refused while the project holds real records.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  for (const [key, role] of [["dpSuper", "super_admin"], ["dpAdmin", "admin"], ["dpEng", "engineer"], ["dpFore", "foreman"], ["dpClient", "client"], ["dpGone", "foreman"], ["dpIdle", "user"]]) await addUser(key, role)
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'projects.manage'), ($1, 'blueprints.manage'), ($1, 'users.view') on conflict do nothing", [ids.dpAdmin])
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
  const P = {}
  const attempt = async (who, sql, params = [], aal = "aal2") => { await as(who, aal); try { const r = await db.query(sql, params); return { ok: true, rows: r.rows } } catch (error) { return { ok: false, message: error.message } } }
  const pin = async (title, sheet = P.sheet) => (await one("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, $3, 10, 10) returning id", [P.one, sheet, title])).id

  await test("Setup: a project with a team, a plan and a set of pins in different states", async () => {
    await owner()
    P.one = (await one("insert into public.projects(code, name, status) values ('DP-1', 'Delete protection', 'active') returning id")).id
    for (const key of ["dpEng", "dpFore", "dpClient"]) await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [P.one, ids[key]])
    for (const key of ["dpEng", "dpFore"]) await db.query("insert into public.project_blueprint_access(project_id, user_id, blueprint_type, access_level) values ($1, $2, 'architectural', 'assigned')", [P.one, ids[key]])
    P.sheet = (await one("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Plan', 'architectural') returning id", [P.one])).id
    P.sheet2 = (await one("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Second plan', 'architectural') returning id", [P.one])).id
    P.empty = await pin("Nothing happened here")
    P.empty2 = await pin("Nothing happened here either")
    P.worked = await pin("Foreman worked here", P.sheet2)
    P.questioned = await pin("Client asked about this")
    P.inspected = await pin("Has an inspection")
    await db.query("update public.pins set assigned_to = $2 where id = $1", [P.worked, ids.dpFore])
    await as("dpFore"); await db.query("select public.report_pin_progress($1, 'in_progress', 'started the wall')", [P.worked])
    await as("dpClient"); await db.query("insert into public.project_questions(project_id, question, pin_id) values ($1, 'Is this wall finished?', $2)", [P.one, P.questioned])
    await owner(); await db.query("insert into public.qa_inspections(project_id, number, pin_id, title, trade, status) values ($1, 9101, $2, 'Wall check', 'architectural', 'in_progress')", [P.one, P.inspected])
    assert.equal((await one("select public.pin_has_work($1) w, public.pin_has_records($1) r", [P.empty])).w, false)
  })

  await test("An untouched pin is still deleted by its Engineer exactly as before; an Admin has never had a direct pin delete (unchanged)", async () => {
    assert.equal((await attempt("dpAdmin", "delete from public.pins where id = $1 returning id", [P.empty2])).rows.length, 0)
    assert.equal((await attempt("dpEng", "delete from public.pins where id = $1 returning id", [P.empty], "aal1")).rows.length, 1)
    assert.equal((await attempt("dpEng", "delete from public.pins where id = $1 returning id", [P.empty2], "aal1")).rows.length, 1)
  })

  await test("A pin with recorded work: its Engineer is refused; an Admin cannot erase it by deleting its sheet; only a Super Admin can, and the audit log keeps it", async () => {
    const eng = await attempt("dpEng", "delete from public.pins where id = $1 returning id", [P.worked], "aal1"); assert.equal(eng.ok, false); assert.match(eng.message, /recorded work.*Only a Super Admin/)
    const admin = await attempt("dpAdmin", "delete from public.blueprints where id = $1 returning id", [P.sheet2]); assert.equal(admin.ok, false); assert.match(admin.message, /recorded work.*Only a Super Admin/)
    await owner(); assert.equal(await count("select count(*) n from public.pins where id = $1", [P.worked]), 1)
    assert.equal((await attempt("dpSuper", "delete from public.blueprints where id = $1 returning id", [P.sheet2])).rows.length, 1)
    await owner(); assert.equal(await count("select count(*) n from public.pins where id = $1", [P.worked]), 0)
    assert.ok(await count("select count(*) n from public.audit_log where action = 'pins.delete' and details -> 'row' ->> 'id' = $1", [P.worked]) >= 1, "the deletion and the pin's data are in the audit log")
  })

  await test("A pin with inspection, defect or client records cannot be deleted by anybody signed in, not even a Super Admin; they stay attached", async () => {
    for (const target of [P.inspected, P.questioned]) {
      const eng = await attempt("dpEng", "delete from public.pins where id = $1 returning id", [target], "aal1"); assert.equal(eng.ok, false); assert.match(eng.message, /inspection, defect, site issue or client records/)
    }
    for (const who of ["dpAdmin", "dpSuper"]) { const r = await attempt(who, "delete from public.blueprints where id = $1 returning id", [P.sheet]); assert.equal(r.ok, false, who); assert.match(r.message, /inspection, defect, site issue or client records/) }
    await owner(); assert.equal(await count("select count(*) n from public.qa_inspections where pin_id = $1", [P.inspected]), 1); assert.equal(await count("select count(*) n from public.project_questions where pin_id = $1", [P.questioned]), 1)
  })

  await test("The sheet that holds those pins survives every attempt, with its pins (the pin guard runs for the cascade)", async () => {
    await owner(); assert.equal(await count("select count(*) n from public.blueprints where id = $1", [P.sheet]), 1); assert.equal(await count("select count(*) n from public.pins where blueprint_id = $1", [P.sheet]), 2)
  })

  await test("Checklist items: an untouched item is removed as before; one with recorded work is refused", async () => {
    await owner()
    const plain = (await one("insert into public.pin_checklist_items(pin_id, project_id, text) values ($1, $2, 'Plain step') returning id", [P.questioned, P.one])).id
    const remarked = (await one("insert into public.pin_checklist_items(pin_id, project_id, text) values ($1, $2, 'Ticked step') returning id", [P.questioned, P.one])).id
    await db.query("insert into public.pin_photos(pin_id, project_id, checklist_item_id, path) values ($1, $2, $3, $4)", [P.questioned, P.one, remarked, `${P.one}/${P.questioned}/${remarked}.jpg`])
    await db.query("update public.pin_checklist_items set done = true, done_by = $2, done_at = now() where id = $1", [remarked, ids.dpFore])
    assert.equal((await one("select done from public.pin_checklist_items where id = $1", [remarked])).done, true)
    assert.equal((await attempt("dpEng", "delete from public.pin_checklist_items where id = $1 returning id", [plain], "aal1")).rows.length, 1)
    const eng = await attempt("dpEng", "delete from public.pin_checklist_items where id = $1 returning id", [remarked], "aal1"); assert.equal(eng.ok, false); assert.match(eng.message, /recorded work.*Only a Super Admin/)
    for (const who of ["dpAdmin", "dpSuper"]) assert.equal((await attempt(who, "delete from public.pin_checklist_items where id = $1 returning id", [remarked])).rows.length, 0, who + " has no direct checklist delete (unchanged)")
    await owner(); assert.equal(await count("select count(*) n from public.pin_checklist_items where id = $1", [remarked]), 1)
  })

  await test("QA evidence photos: removable while the inspection or defect is still open, locked once it is concluded or sent for verification", async () => {
    await owner()
    const open = (await one("select id from public.qa_inspections where pin_id = $1", [P.inspected])).id
    const done = (await one("insert into public.qa_inspections(project_id, number, title, trade, status) values ($1, 9102, 'Concluded check', 'architectural', 'in_progress') returning id", [P.one])).id
    const defectOpen = (await one("insert into public.qa_defects(project_id, number, title, severity, due_date, status) values ($1, 9103, 'Open NCR', 'minor', current_date + 5, 'open') returning id", [P.one])).id
    const defectSent = (await one("insert into public.qa_defects(project_id, number, title, severity, due_date, status) values ($1, 9104, 'Sent NCR', 'minor', current_date + 5, 'open') returning id", [P.one])).id
    const photo = async (column, id, name) => (await one(`insert into public.qa_photos(project_id, ${column}, path, uploaded_by) values ($1, $2, $3, $4) returning id`, [P.one, id, `${P.one}/qa/${name}.jpg`, ids.dpEng])).id
    const [a, b, c, d] = [await photo("inspection_id", open, "a"), await photo("inspection_id", done, "b"), await photo("defect_id", defectOpen, "c"), await photo("defect_id", defectSent, "d")]
    await db.query("update public.qa_inspections set status = 'passed' where id = $1", [done]); await db.query("update public.qa_defects set status = 'for_verification' where id = $1", [defectSent])
    // Row security already limits who can even try; whoever can (the uploader, or an Admin with blueprints.manage) is stopped by the trigger. Nothing is ever deleted.
    const messages = []
    for (const locked of [b, d]) for (const who of ["dpEng", "dpAdmin", "dpSuper"]) { const r = await attempt(who, "delete from public.qa_photos where id = $1 returning id", [locked]); if (r.ok) assert.equal(r.rows.length, 0, who + " deleted locked evidence"); else messages.push(r.message) }
    assert.ok(messages.length >= 2 && messages.every((m) => /cannot be removed/.test(m)), "the triggers refuse whoever row security lets through: " + messages.join(" | "))
    assert.ok(messages.some((m) => /inspection or defect evidence/.test(m)), "the new lock also covers a defect sent for verification")
    await owner(); assert.equal(await count("select count(*) n from public.qa_photos where id in ($1, $2)", [b, d]), 2)
    for (const free of [a, c]) assert.equal((await attempt("dpAdmin", "delete from public.qa_photos where id = $1 returning id", [free])).rows.length, 1, "an open inspection or defect keeps its draft-style removal")
  })

  await test("Deleting an account cannot erase that person's work; an account with no work still deletes (the sign-in gate for new Google logins)", async () => {
    await as("dpFore"); await db.query("insert into public.daily_reports(project_id, report_date, work_done) values ($1, current_date, 'Tiles')", [P.one])
    await as("dpClient"); await db.query("insert into public.project_questions(project_id, question) values ($1, 'Any news?')", [P.one])
    await owner()
    for (const who of ["dpFore", "dpClient"]) { await assert.rejects(() => db.query("delete from auth.users where id = $1", [ids[who]]), /violates foreign key|still referenced|restrict/i, who) }
    assert.equal(await count("select count(*) n from public.daily_reports where author_id = $1", [ids.dpFore]), 1)
    await db.query("delete from auth.users where id = $1", [ids.dpIdle]); assert.equal(await count("select count(*) n from public.profiles where id = $1", [ids.dpIdle]), 0)
  })

  await test("Delete grants anon never needed are gone; accounts keep only what row security decides; QA and attendance tables were never deletable", async () => {
    await owner()
    for (const table of ["pins", "blueprints", "pin_photos", "pin_events", "projects", "project_members", "pin_checklist_items", "blueprint_annotations", "blueprint_revisions", "project_blueprint_access"])
      assert.equal((await one("select has_table_privilege('anon', $1, 'delete') p", ["public." + table])).p, false, "anon " + table)
    for (const table of ["pins", "blueprints", "pin_photos", "pin_checklist_items", "blueprint_annotations"]) assert.equal((await one("select has_table_privilege('authenticated', $1, 'delete') p", ["public." + table])).p, true, "authenticated keeps " + table + " (RLS decides)")
    for (const table of ["qa_inspections", "qa_defects", "biometric_attendance_events", "attendance_workers", "audit_log"]) assert.equal((await one("select has_table_privilege('authenticated', $1, 'delete') p", ["public." + table])).p, false, table + " has never been deletable by an account")
  })

  // ---------------------------------------------------------------- permanent deletion
  const bin = async (code) => {
    await owner()
    const id = (await one("insert into public.projects(code, name, status) values ($1, 'Mistake', 'active') returning id", [code])).id
    await db.query("update public.projects set archived_at = now() where id = $1", [id])
    await as("dpAdmin", "aal2"); await db.query("select public.remove_project($1, 'Created by mistake', $2)", [id, code])
    return id
  }
  const aged = async (id, days) => { await owner(); await db.query("update public.projects set deleted_at = now() - ($2 || ' days')::interval where id = $1", [id, String(days)]) }

  await test("Permanent deletion: Super Admin only, for a removed project, after 30 days; everyone else is refused", async () => {
    P.mistake = await bin("DP-MISTAKE")
    for (const [who, aal] of [["dpAdmin", "aal2"], ["dpEng", "aal2"], ["dpFore", "aal1"], ["dpSuper", "aal1"]]) { const r = await attempt(who, "select public.preview_project_purge($1)", [P.mistake], aal); assert.equal(r.ok, false, who + aal); assert.match(r.message, /Only a Super Admin/) }
    for (const who of ["dpSuper", "dpAdmin", "dpEng"]) { const r = await attempt(who, "select public.purge_project_rows($1, $2)", [P.mistake, ids.dpSuper]); assert.equal(r.ok, false); assert.match(r.message, /permission denied/, "only the service role (the Edge Function) can call it") }
    const young = (await attempt("dpSuper", "select public.preview_project_purge($1) p", [P.mistake])).rows[0].p
    assert.equal(young.ok, false); assert.match(young.reasons[0], /at least 30 days \(30 more\)/); assert.equal(young.min_days, 30); assert.equal(young.code, "DP-MISTAKE")
    await service(); await assert.rejects(() => db.query("select public.purge_project_rows($1, $2)", [P.mistake, ids.dpSuper]), /cannot be deleted forever: It must stay in the recycle bin/)
    await aged(P.mistake, 29); assert.equal((await attempt("dpSuper", "select public.preview_project_purge($1) p", [P.mistake])).rows[0].p.ok, false)
    await owner(); assert.equal(await count("select count(*) n from public.projects where id = $1", [P.mistake]), 1, "nothing was deleted by the refusals")
  })

  await test("Permanent deletion is refused for a project that is not in the bin, or that holds real records", async () => {
    await owner()
    const openAttempt = await attempt("dpSuper", "select public.preview_project_purge($1) p", [P.one]); const open = openAttempt.rows[0].p
    assert.equal(open.ok, false); assert.match(open.reasons.join(" "), /not in the recycle bin/)
    P.busy = await bin("DP-BUSY"); await aged(P.busy, 40)
    const bp = (await one("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Plan', 'architectural') returning id", [P.busy])).id
    await db.query("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, 'Wall', 5, 5)", [P.busy, bp])
    await db.query("insert into public.pin_events(pin_id, project_id, actor_id, kind, note) select id, project_id, null, 'comment', 'working' from public.pins where project_id = $1 limit 1", [P.busy])
    await as("dpFore"); await owner()
    await db.query("insert into public.qa_defects(project_id, number, title, severity, due_date, status) values ($1, 9201, 'NCR', 'minor', current_date, 'open')", [P.busy])
    const check = (await attempt("dpSuper", "select public.preview_project_purge($1) p", [P.busy])).rows[0].p
    assert.equal(check.ok, false); assert.match(check.reasons.join(" | "), /1 pin\(s\) have recorded work/); assert.match(check.reasons.join(" | "), /1 defect report\(s\)/); assert.equal(check.days_in_bin, 40)
    await service(); await assert.rejects(() => db.query("select public.purge_project_rows($1, $2)", [P.busy, ids.dpSuper]), /cannot be deleted forever: .*defect report/)
    await owner(); assert.equal(await count("select count(*) n from public.projects where id = $1", [P.busy]), 1); assert.equal(await count("select count(*) n from public.qa_defects where project_id = $1", [P.busy]), 1)
    assert.equal(await count("select count(*) n from public.audit_log where action = 'project.purged'"), 0, "a refused purge writes nothing")
  })

  await test("Permanent deletion of a removed project with no real records: only an active Super Admin through the service role, audited with what it held", async () => {
    await aged(P.mistake, 31)
    await owner(); const bp = (await one("insert into public.blueprints(project_id, title, blueprint_type) values ($1, 'Plan', 'architectural') returning id", [P.mistake])).id
    await db.query("insert into public.pins(project_id, blueprint_id, title, x, y) values ($1, $2, 'Empty pin', 5, 5)", [P.mistake, bp])
    await db.query("insert into public.project_members(project_id, user_id) values ($1, $2)", [P.mistake, ids.dpEng])
    const ready = (await attempt("dpSuper", "select public.preview_project_purge($1) p", [P.mistake])).rows[0].p
    assert.deepEqual({ ok: ready.ok, reasons: ready.reasons, days: ready.days_in_bin, by: ready.removed_by, why: ready.removal_reason }, { ok: true, reasons: [], days: 31, by: "dpAdmin", why: "Created by mistake" })
    assert.deepEqual({ plans: ready.contents.plans, pins: ready.contents.pins, team: ready.contents.team }, { plans: 1, pins: 1, team: 1 })
    await service()
    await assert.rejects(() => db.query("select public.purge_project_rows($1, $2)", [P.mistake, ids.dpAdmin]), /Only a Super Admin/, "the actor must be an active Super Admin")
    await assert.rejects(() => db.query("select public.purge_project_rows($1, $2)", [P.mistake, null]), /Only a Super Admin/)
    const result = (await db.query("select public.purge_project_rows($1, $2) r", [P.mistake, ids.dpSuper])).rows[0].r
    assert.deepEqual(result, { purged: true, code: "DP-MISTAKE", project_id: P.mistake })
    await owner()
    for (const table of ["projects", "blueprints", "pins", "project_members"]) assert.equal(await count(`select count(*) n from public.${table} where ${table === "projects" ? "id" : "project_id"} = $1`, [P.mistake]), 0, table + " are gone")
    const log = await one("select actor_id, details from public.audit_log where action = 'project.purged'")
    assert.equal(log.actor_id, ids.dpSuper); assert.deepEqual({ code: log.details.code, why: log.details.removal_reason, by: log.details.removed_by, plans: log.details.contents.plans, pins: log.details.contents.pins }, { code: "DP-MISTAKE", why: "Created by mistake", by: "dpAdmin", plans: 1, pins: 1 })
    assert.ok(await count("select count(*) n from public.audit_log where action = 'projects.delete' and details -> 'row' ->> 'code' = 'DP-MISTAKE'") >= 1, "the generic audit also keeps the project row")
    assert.equal(await count("select count(*) n from public.projects where id = $1", [P.one]), 1, "other projects are untouched")
  })
}
