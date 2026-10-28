// Tests for 20261028130000: blueprint types and per-type access (No access / View only / Assigned work access).
// Runs with the harness's legacy fixture switched OFF: membership grants nothing and sheets need a type, as in production.
import assert from "node:assert/strict"
import { submitWorkFixture } from "./qa-fixtures.mjs"

export default async function (ctx) {
  const { db, ids, as, asOwner, test, expectOk, expectFail, count, addUser } = ctx
  const system = async () => {
    await asOwner()
    await db.query("select set_config('request.jwt.claims', '', false)") // no signed-in person: service role / migration
  }
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  const setAccess = (project, user, levels) => db.query("select public.set_blueprint_access($1, $2, $3)", [project, user, JSON.stringify(levels)])
  const sheetFile = (project, sheet, name = "plan.pdf") => `${project}/${sheet}/${name}`
  const revisionSql = `insert into public.blueprint_revisions
    (blueprint_id, project_id, revision, file_path, file_name, mime_type, size_bytes, preview_path, preview_width, preview_height)
    values ($1, $2, 1, $3, 'plan.pdf', 'application/pdf', 1000, $3, 800, 600) returning id`

  await asOwner()
  await db.query("select set_config('buildtrack.test_type_access', 'strict', false)")
  for (const [key, role] of [["btEngA", "engineer"], ["btEngB", "engineer"], ["btForeA", "foreman"], ["btForeB", "foreman"], ["btClient", "client"]]) await addUser(key, role)

  const P = {}
  const S = {}
  await test("Type access: setup — two projects; Admin uploads one sheet per type; membership alone grants no type", async () => {
    await as("admin", "aal2")
    P.one = (await one("insert into public.projects (code, name) values ('TYPE-1', 'Type access project') returning id")).id
    P.two = (await one("insert into public.projects (code, name) values ('TYPE-2', 'Other type project') returning id")).id
    for (const who of ["btEngA", "btEngB", "btForeA", "btForeB", "btClient"]) await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.one, ids[who]])
    await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [P.two, ids.btEngA])
    for (const [key, type] of [["arch", "architectural"], ["elec", "electrical"], ["plumb", "plumbing_sanitary"]])
      S[key] = (await one("insert into public.blueprints (project_id, title, blueprint_type) values ($1, $2, $3) returning id", [P.one, `${type} sheet`, type])).id
    S.otherArch = (await one("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Other project plan', 'architectural') returning id", [P.two])).id
    for (const key of ["arch", "elec", "plumb"]) await expectOk(revisionSql, [S[key], P.one, sheetFile(P.one, S[key])])
    await asOwner()
    assert.equal(await count("select count(*) n from public.project_blueprint_access where project_id in ($1, $2)", [P.one, P.two]), 0)
    await as("btEngA")
    assert.equal(await count("select count(*) n from public.projects where id = $1", [P.one]), 1, "the project itself stays visible")
    assert.equal(await count("select count(*) n from public.blueprints where project_id = $1", [P.one]), 0, "no type granted yet")
  })

  await test("Type access: only the five types; a sheet sent without one (older app) is filed from its discipline; discipline is filled, never overwritten", async () => {
    await as("admin", "aal2")
    const legacy = (await db.query("insert into public.blueprints (project_id, title, discipline) values ($1, 'No type', null), ($1, 'Old MEP', 'mep') returning id", [P.two])).rows.map((r) => r.id)
    const arch = (await one("insert into public.blueprints (project_id, title, discipline) values ($1, 'Old architectural', 'architectural') returning id", [P.two])).id
    await asOwner()
    const filed = Object.fromEntries((await db.query("select title, blueprint_type, discipline from public.blueprints where id = any($1)", [[...legacy, arch]])).rows.map((r) => [r.title, `${r.blueprint_type}/${r.discipline}`]))
    assert.deepEqual(filed, { "No type": "civil_structural/civil_structural", "Old MEP": "civil_structural/mep", "Old architectural": "architectural/architectural" })
    await as("admin", "aal2")
    await expectOk("delete from public.blueprints where id = any($1)", [[...legacy, arch]])
    await expectFail("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Unclassified', 'unclassified')", [P.one], /check constraint/)
    await expectFail("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Combined', 'mep')", [P.one], /check constraint/)
    await asOwner()
    const rows = (await db.query("select blueprint_type, discipline from public.blueprints where id = any($1) order by blueprint_type", [[S.arch, S.elec, S.plumb]])).rows
    assert.deepEqual(rows.map((r) => `${r.blueprint_type}:${r.discipline}`), ["architectural:architectural", "electrical:mep", "plumbing_sanitary:mep"])
  })

  await test("Type access: only an Admin with Projects permission + MFA sets it, only for Engineer / Foreman members, only known values", async () => {
    await as("btEngA")
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.one, ids.btEngA, '{"architectural":"assigned"}'], /Only an Admin/)
    await as("admin", "aal1")
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.one, ids.btEngA, '{"architectural":"assigned"}'], /Only an Admin/)
    await as("noperm", "aal2")
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.one, ids.btEngA, '{"architectural":"assigned"}'], /Only an Admin/)
    await as("admin", "aal2")
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.one, ids.btClient, '{"architectural":"view"}'], /Add this Engineer or Foreman/)
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.two, ids.btEngB, '{"architectural":"view"}'], /Add this Engineer or Foreman/)
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.one, ids.btEngA, '{"civil":"view"}'], /Unknown blueprint type/)
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.one, ids.btEngA, '{"architectural":"edit"}'], /No access, View only or Assigned/)
    await expectFail("select public.set_blueprint_access($1, $2, $3)", [P.one, ids.btEngA, "{}"], /at least one/)
    await as("btEngA")
    await expectFail("insert into public.project_blueprint_access (project_id, user_id, blueprint_type, access_level) values ($1, $2, 'electrical', 'assigned')", [P.one, ids.btEngA], /row-level security/)
    // The same person gets different levels on different types, in one call.
    await as("admin", "aal2")
    await setAccess(P.one, ids.btEngA, { architectural: "assigned", electrical: "view" })
    await setAccess(P.one, ids.btEngB, { electrical: "assigned", plumbing_sanitary: "assigned" })
    await setAccess(P.one, ids.btForeA, { architectural: "assigned", electrical: "view" })
    await setAccess(P.one, ids.btForeB, { electrical: "assigned" })
    await asOwner()
    assert.equal(await count("select count(*) n from public.project_blueprint_access where project_id = $1", [P.one]), 7)
    assert.equal(await count("select count(*) n from public.audit_log where action = 'project_blueprint_access.insert' and details -> 'row' ->> 'project_id' = $1", [P.one]), 7, "every grant is audited")
  })

  await test("Type access: hidden types stay hidden — sheets, revisions, pins, timeline, sheet history — across direct reads", async () => {
    await as("btEngB")
    const plumbPin = (await one("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 10, 10, 'Drain line') returning id", [P.one, S.plumb])).id
    ids.plumbPin = plumbPin
    await as("btEngA")
    assert.deepEqual((await db.query("select blueprint_type from public.blueprints where project_id = $1 order by 1", [P.one])).rows.map((r) => r.blueprint_type), ["architectural", "electrical"])
    assert.equal(await count("select count(*) n from public.blueprints where id = $1", [S.plumb]), 0, "direct read by id")
    assert.equal(await count("select count(*) n from public.blueprint_revisions where blueprint_id = $1", [S.plumb]), 0)
    assert.equal(await count("select count(*) n from public.pins where id = $1", [plumbPin]), 0)
    assert.equal(await count("select count(*) n from public.get_pin_timeline($1)", [plumbPin]), 0, "timeline RPC")
    assert.equal(await count("select count(*) n from public.get_sheet_history($1)", [S.plumb]), 0, "history RPC")
    await as("btEngB")
    assert.ok(await count("select count(*) n from public.get_pin_timeline($1)", [plumbPin]) > 0, "the assigned Engineer still reads it")
    // Clients and Admins keep their whole-project view.
    await as("btClient")
    assert.equal(await count("select count(*) n from public.blueprints where project_id = $1", [P.one]), 3)
    await as("admin", "aal2")
    assert.equal(await count("select count(*) n from public.blueprints where project_id = $1", [P.one]), 3)
  })

  await test("Type access: View only reads but never writes — pins, sheet details, annotations, uploads (direct API)", async () => {
    await as("btEngA")
    ids.archPin = (await one("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 20, 20, 'Partition wall') returning id", [P.one, S.arch])).id
    await expectFail("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 20, 20, 'Cable tray')", [P.one, S.elec], /Assigned work access to Electrical/)
    await expectOk("update public.blueprints set scale_width_m = 12 where id = $1", [S.arch])
    await expectFail("update public.blueprints set scale_width_m = 12 where id = $1", [S.elec], /Assigned work access to Electrical/)
    await expectOk("insert into public.blueprint_annotations (project_id, blueprint_id, kind, x, y, text, color) values ($1, $2, 'note', 5, 5, 'Check', 'blue')", [P.one, S.arch])
    await expectFail("insert into public.blueprint_annotations (project_id, blueprint_id, kind, x, y, text, color) values ($1, $2, 'note', 5, 5, 'Check', 'blue')", [P.one, S.elec], /Assigned work access/)
    await expectFail("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Lighting', 'electrical')", [P.one], /Assigned work access to Electrical/)
    await expectFail(revisionSql, [S.elec, P.one, sheetFile(P.one, S.elec, "r2.pdf")], /Assigned work access/)
    await as("btEngB")
    ids.elecPin = (await one("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 30, 30, 'Panel board') returning id", [P.one, S.elec])).id
    await as("btEngA")
    assert.equal(await count("select count(*) n from public.pins where id = $1", [ids.elecPin]), 1, "View only still reads the pin")
    const moved = await db.query("update public.pins set title = 'Hijack' where id = $1 returning id", [ids.elecPin]).catch((error) => error)
    assert.ok(moved instanceof Error && /Assigned work access/.test(moved.message), "update refused")
  })

  await test("Type access: private files follow the sheet / pin type (blueprints, pin photos, QA evidence)", async () => {
    await as("btEngA")
    await expectOk("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [sheetFile(P.one, S.arch, "a.pdf")])
    await expectFail("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [sheetFile(P.one, S.elec, "a.pdf")], /row-level security/)
    await expectFail("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [`${P.one}/not-a-sheet/a.pdf`], /row-level security/)
    // Files of hidden types cannot be read, even by guessing the path.
    assert.equal(await count("select count(*) n from storage.objects where bucket_id = 'blueprints' and name like $1", [`${P.one}/${S.plumb}/%`]), 0)
    await asOwner()
    await db.query("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [sheetFile(P.one, S.plumb, "p.pdf")])
    await as("btEngA")
    assert.equal(await count("select count(*) n from storage.objects where bucket_id = 'blueprints' and name = $1", [sheetFile(P.one, S.plumb, "p.pdf")]), 0)
    await as("btEngB")
    assert.equal(await count("select count(*) n from storage.objects where bucket_id = 'blueprints' and name = $1", [sheetFile(P.one, S.plumb, "p.pdf")]), 1)
    await as("btClient")
    assert.equal(await count("select count(*) n from storage.objects where bucket_id = 'blueprints' and name = $1", [sheetFile(P.one, S.plumb, "p.pdf")]), 1, "clients keep reading plans")
    // A view-only Foreman cannot add evidence files to an Electrical pin.
    await as("btForeA")
    await expectFail("insert into storage.objects (bucket_id, name) values ('pin-photos', $1)", [`${P.one}/${ids.elecPin}/x.jpg`], /row-level security/)
  })

  await test("Type access: new sheets and revisions inherit their type's access", async () => {
    await as("btEngA")
    const newSheet = (await one("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Second floor', 'architectural') returning id, created_by", [P.one]))
    assert.equal(newSheet.created_by, ids.btEngA)
    await expectOk(revisionSql, [newSheet.id, P.one, sheetFile(P.one, newSheet.id)])
    await expectOk(revisionSql, [S.arch, P.one, sheetFile(P.one, S.arch, "rev2.pdf")])
    await asOwner()
    assert.equal((await one("select blueprint_type from public.blueprints where id = $1", [S.arch])).blueprint_type, "architectural", "a revision keeps the type")
    await as("btForeA")
    assert.equal(await count("select count(*) n from public.blueprints where id = $1", [newSheet.id]), 1)
    assert.equal(await count("select count(*) n from public.blueprint_revisions where blueprint_id = $1", [S.arch]), 2)
    await as("btEngB")
    assert.equal(await count("select count(*) n from public.blueprints where id = $1", [newSheet.id]), 0)
    assert.equal(await count("select count(*) n from public.blueprint_revisions where blueprint_id = $1", [S.arch]), 0)
  })

  await test("Type access: only Admins with Blueprints permission change a plan's type; only the five types exist", async () => {
    await as("btEngA")
    await expectFail("update public.blueprints set blueprint_type = 'electrical' where id = $1", [S.arch], /Only an Admin/)
    await as("admin", "aal2")
    const legacy = (await one("select id from public.blueprints where project_id = $1 and blueprint_type = 'architectural' and title = 'Second floor'", [P.one])).id
    await expectOk("update public.blueprints set blueprint_type = 'mechanical' where id = $1", [legacy])
    await expectFail("update public.blueprints set blueprint_type = 'unclassified' where id = $1", [legacy], /check constraint/)
    await as("btForeA")
    assert.equal(await count("select count(*) n from public.blueprints where id = $1", [legacy]), 0, "moved out of Architectural: hidden now")
  })

  await test("Type access: Foremen need Assigned work on the type; Engineers cannot hand work to a Foreman without it", async () => {
    await as("btEngA")
    await expectFail("update public.pins set assigned_to = $2 where id = $1", [ids.archPin, ids.btForeB], /does not have Assigned work access to Architectural/)
    await expectOk("update public.pins set assigned_to = $2 where id = $1", [ids.archPin, ids.btForeA])
    await as("btEngB")
    await expectFail("update public.pins set assigned_to = $2 where id = $1", [ids.elecPin, ids.btForeA], /does not have Assigned work access to Electrical/)
    await expectOk("update public.pins set assigned_to = $2 where id = $1", [ids.elecPin, ids.btForeB])
    await as("btForeA")
    await expectOk("select public.report_pin_progress($1, 'in_progress', 'Started')", [ids.archPin])
    await expectFail("select public.report_pin_progress($1, 'in_progress', 'Not mine')", [ids.elecPin], /./)
    await expectFail("insert into public.pin_events (pin_id, project_id, kind, note) values ($1, $2, 'comment', 'View only comment')", [ids.elecPin, P.one], /Assigned work access|row-level security/)
    // No Engineer approval rights for Foremen, even with Assigned work access.
    const edit = await db.query("update public.pins set status = 'verified' where id = $1 returning id", [ids.archPin]).catch((error) => error)
    assert.ok(edit instanceof Error || edit.rows.length === 0, "foreman verified work")
    await as("btForeB")
    assert.equal(await count("select count(*) n from public.pins where id = $1", [ids.archPin]), 0, "another Foreman's type stays hidden")
  })

  await test("Type access: QA request goes only to Engineers with Assigned work on the type; others cannot see or act", async () => {
    const ir = await submitWorkFixture(ctx, ids.archPin, "btEngA", "btForeA")
    ids.archIr = ir
    await asOwner()
    assert.equal(await count("select count(*) n from public.notifications where user_id = $1 and entity_id = $2", [ids.btEngA, ir]), 1, "authorized Engineer notified")
    assert.equal(await count("select count(*) n from public.notifications where user_id = $1 and entity_id = $2", [ids.btEngB, ir]), 0, "unrelated Engineer not notified")
    assert.equal((await one("select escalation_owner from public.qa_inspections where id = $1", [ir])).escalation_owner, ids.btEngA, "routed to the authorized Engineer")
    await as("btEngB")
    assert.equal(await count("select count(*) n from public.qa_inspections where id = $1", [ir]), 0)
    await expectFail("select public.start_inspection($1)", [ir], /not found|not allowed|Assigned work/)
    await expectFail("select public.qa_reinspection_context($1)", [ir], /access denied/)
    assert.equal((await one("select public.get_qa_summary($1) s", [P.one])).s.inspections.total, 0, "summary narrowed to the types held")
    await as("btEngA", "aal2")
    assert.equal((await one("select public.get_qa_summary($1) s", [P.one])).s.inspections.total, 1)
    await expectOk("select public.start_inspection($1)", [ir])
    const items = (await db.query("select id from public.qa_inspection_items where inspection_id = $1 order by position", [ir])).rows
    await expectOk("select public.save_inspection_item($1, 'fail', null, 'Joint not sealed')", [items[0].id])
    for (const item of items.slice(1)) await expectOk("select public.save_inspection_item($1, 'pass', null, null)", [item.id])
    await expectOk("select public.complete_inspection($1, 'Failed item raises an NCR')", [ir])
    await asOwner()
    const ncr = (await one("select id, assigned_to from public.qa_defects where inspection_id = $1", [ir]))
    ids.archNcr = ncr.id
    assert.equal(ncr.assigned_to, ids.btForeA)
    for (const [who, n] of [["btEngA", 1], ["btForeA", 1], ["btEngB", 0], ["btForeB", 0]]) {
      await as(who)
      assert.equal(await count("select count(*) n from public.qa_defects where id = $1", [ncr.id]), n, `${who} NCR visibility`)
      assert.equal(await count("select count(*) n from public.qa_inspection_items where inspection_id = $1", [ir]), n ? items.length : 0, `${who} checklist visibility`)
    }
    await as("btEngB")
    await expectFail("select public.qa_ncr_reinspection_state($1)", [ncr.id], /access denied/)
  })

  await test("Type access: a View only Engineer reads the type but cannot inspect, verify or raise NCRs on it", async () => {
    await as("admin", "aal2")
    await setAccess(P.one, ids.btEngB, { architectural: "view" })
    await asOwner()
    const ncr = await one("select title, category, severity, assigned_to from public.qa_defects where id = $1", [ids.archNcr])
    await as("btEngB")
    assert.equal(await count("select count(*) n from public.qa_inspections where id = $1", [ids.archIr]), 1, "now readable")
    assert.equal(await count("select count(*) n from public.qa_defects where id = $1", [ids.archNcr]), 1)
    await expectFail("select public.edit_defect($1, $2, 'Edited', $3, $4, null, $5, null)", [ids.archNcr, ncr.title, ncr.category, ncr.severity, ncr.assigned_to], /Assigned work access to Architectural/)
    await expectFail("select public.raise_defect($1, 'Crack', 'Hairline crack', 'workmanship', 'minor', 'general', null, $2, null, null, null)", [P.one, ids.archPin], /Assigned work access|not allowed|access/)
    await asOwner()
    assert.equal(await count("select count(*) n from public.notifications where user_id = $1 and entity_id = $2", [ids.btEngB, ids.archNcr]), 0)
  })

  await test("Type access: revoking keeps records and sign-offs; a Foreman's open work of that type is handed back", async () => {
    await asOwner()
    const before = await one("select inspector_id, requested_by from public.qa_inspections where id = $1", [ids.archIr])
    const events = await count("select count(*) n from public.pin_events where pin_id = $1", [ids.archPin])
    await as("admin", "aal2")
    await setAccess(P.one, ids.btForeA, { architectural: "view" })
    await asOwner()
    assert.equal((await one("select assigned_to from public.pins where id = $1", [ids.archPin])).assigned_to, null, "open work released")
    const audit = await one("select details from public.audit_log where action = 'project_blueprint_access.update' and target_id = $1 order by id desc limit 1", [ids.btForeA])
    assert.equal(audit.details.before.access_level, "assigned")
    assert.equal(audit.details.row.access_level, "view")
    await as("btForeA")
    assert.equal(await count("select count(*) n from public.pins where id = $1", [ids.archPin]), 1, "still readable as View only")
    await expectFail("select public.report_pin_progress($1, 'in_progress', 'After revoke')", [ids.archPin], /./)
    await as("admin", "aal2")
    await setAccess(P.one, ids.btEngA, { architectural: "none" })
    await as("btEngA")
    assert.equal(await count("select count(*) n from public.qa_inspections where id = $1", [ids.archIr]), 0, "No access hides it")
    await asOwner()
    const after = await one("select inspector_id, requested_by from public.qa_inspections where id = $1", [ids.archIr])
    assert.deepEqual(after, before, "inspection attribution unchanged")
    assert.equal(after.inspector_id, ids.btEngA)
    assert.ok(await count("select count(*) n from public.pin_events where pin_id = $1", [ids.archPin]) > events, "timeline kept and extended")
    assert.equal(await count("select count(*) n from public.qa_defects where id = $1 and raised_by is not null", [ids.archNcr]), 1)
  })

  await test("Type access: grants never cross projects; leaving the project removes them (audited)", async () => {
    await as("btEngA")
    assert.equal(await count("select count(*) n from public.blueprints where project_id = $1", [P.two]), 0, "member of TYPE-2 without grants")
    assert.equal(await count("select count(*) n from public.blueprints where id = $1", [S.otherArch]), 0)
    await as("admin", "aal2")
    await setAccess(P.two, ids.btEngA, { architectural: "view" })
    await as("btEngA")
    assert.equal(await count("select count(*) n from public.blueprints where id = $1", [S.otherArch]), 1)
    await expectFail("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 1, 1, 'X')", [P.two, S.otherArch], /Assigned work access/)
    await as("admin", "aal2")
    await expectOk("delete from public.project_members where project_id = $1 and user_id = $2", [P.two, ids.btEngA])
    await asOwner()
    assert.equal(await count("select count(*) n from public.project_blueprint_access where project_id = $1", [P.two]), 0)
    assert.equal(await count("select count(*) n from public.audit_log where action = 'project_blueprint_access.delete' and target_id = $1 and details -> 'row' ->> 'project_id' = $2", [ids.btEngA, P.two]), 1)
  })

  await test("Type access: transition keeps today's access — current members get Assigned work on the types their project has", async () => {
    await as("admin", "aal2")
    const p = (await one("insert into public.projects (code, name) values ('TYPE-3', 'Transition project') returning id")).id
    for (const who of ["btEngA", "btForeB", "btClient"]) await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [p, ids[who]])
    await expectOk("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Structural', 'civil_structural')", [p])
    await system()
    await db.query("insert into public.blueprints (project_id, title, blueprint_type) values ($1, 'Lighting', 'electrical')", [p])
    await db.query("select public.backfill_blueprint_access()")
    const rows = (await db.query("select user_id, blueprint_type, access_level from public.project_blueprint_access where project_id = $1 order by 1, 2", [p])).rows
    const got = rows.map((r) => `${r.user_id === ids.btEngA ? "eng" : r.user_id === ids.btForeB ? "fore" : "other"}:${r.blueprint_type}:${r.access_level}`).sort()
    assert.deepEqual(got, ["eng:civil_structural:assigned", "eng:electrical:assigned", "fore:civil_structural:assigned", "fore:electrical:assigned"])
    await as("btClient")
    await expectFail("select public.backfill_blueprint_access()", [], /permission denied/)
  })

  await test("Type access: helper functions are internal or read-only for signed-in users; anon gets nothing", async () => {
    await as("btEngA")
    await expectFail("select public.blueprint_access_level($1, $2, 'architectural')", [ids.btEngB, P.one], /permission denied/)
    await expectFail("select * from public.record_blueprint_scope('pins', '{}'::jsonb)", [], /permission denied/)
    await as(null)
    await expectFail("select public.set_blueprint_access($1, $2, '{}')", [P.one, ids.btEngA], /permission denied/)
    await expectFail("select count(*) from public.project_blueprint_access", [], /permission denied|row-level/).catch(async () => {
      assert.equal(await count("select count(*) n from public.project_blueprint_access"), 0)
    })
  })

  // Back to the legacy fixture for any suite that runs after this one.
  await asOwner()
  await db.query("select set_config('buildtrack.test_type_access', '', false)")
}
