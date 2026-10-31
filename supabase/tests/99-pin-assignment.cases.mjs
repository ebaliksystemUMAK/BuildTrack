// Tests for 0040: project membership is separate from pin-level work assignment; admins upload and read, engineers do the
// engineering work and assign, foremen work only on pins assigned to them; per-item checklist evidence.
import { passWorkFixture } from "./qa-fixtures.mjs"
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count, addUser }) {
  await addUser("asgEng", "engineer")
  await addUser("asgF1", "foreman")
  await addUser("asgF2", "foreman")
  await addUser("asgOut", "foreman") // a Foreman who is not on the project
  await addUser("asgOff", "foreman") // on the project, later disabled
  await asOwner()
  // Earlier files strip the shared admin's permissions; this file needs the two an Admin gets by default.
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'projects.manage'), ($1, 'blueprints.manage') on conflict do nothing", [ids.admin])
  const P = (await db.query("insert into public.projects (code, name, status) values ('ASG-1', 'Assignment tower', 'active') returning id")).rows[0].id
  await as("super", "aal2") // Team fixture; Admins retain project/blueprint administration below.
  await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2), ($1, $3), ($1, $4), ($1, $5), ($1, $6)",
    [P, ids.asgEng, ids.asgF1, ids.asgF2, ids.asgOff, ids.client1])

  const pinSql = "insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 10, 10, $3, $4) returning id"
  const pinField = async (pin, column) => {
    await asOwner()
    return (await db.query(`select ${column} as v from public.pins where id = $1`, [pin])).rows[0].v
  }
  const assign = (pin, who) => db.query("update public.pins set assigned_to = $2 where id = $1 returning id", [pin, who])
  let sheet

  await test("Admin uploads sheets and revisions to a project", async () => {
    await as("admin", "aal2")
    sheet = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Level 2') returning id", [P])).rows[0].id
    await expectOk(
      `insert into public.blueprint_revisions (blueprint_id, project_id, revision, file_path, file_name, mime_type, size_bytes, preview_path, preview_width, preview_height)
       values ($1, $2, 1, $3, 'l2.png', 'image/png', 500, $3, 1000, 800)`, [sheet, P, `${P}/${sheet}/l2.png`])
    await expectOk("insert into storage.objects (bucket_id, name, owner) values ('blueprints', $1, $2)", [`${P}/${sheet}/l2-original.png`, ids.admin])
    await expectOk("update public.blueprints set title = 'Level 2 (structural)' where id = $1", [sheet])
  })

  await test("Admin cannot create or edit pins, annotations, checklists, the sheet scale or the base lock", async () => {
    await as("admin", "aal2")
    await expectFail(pinSql, [P, sheet, "Admin pin", null], /row-level security/)
    await expectFail("insert into public.blueprint_annotations (project_id, blueprint_id, kind, x, y, text) values ($1, $2, 'note', 5, 5, 'Admin note')", [P, sheet], /row-level security/)
    await expectFail("update public.blueprints set scale_width_m = 30 where id = $1", [sheet], /Only an Engineer/)
    await expectFail("update public.blueprints set base_locked = true where id = $1", [sheet], /Only an Engineer/)
    await as("asgEng", "aal2")
    ids.asgPin = (await db.query(pinSql, [P, sheet, "Wall W1 blockwork", null])).rows[0].id
    await expectOk("insert into public.pin_checklist_items (pin_id, project_id, text) values ($1, $2, 'Mortar joints 10 mm')", [ids.asgPin, P])
    await as("admin", "aal2")
    if ((await db.query("update public.pins set title = 'Admin edit', status = 'verified' where id = $1 returning id", [ids.asgPin])).rows.length) throw new Error("admin edited / verified a pin")
    if ((await assign(ids.asgPin, ids.asgF1)).rows.length) throw new Error("admin assigned a pin")
    await expectFail("insert into public.pin_checklist_items (pin_id, project_id, text) values ($1, $2, 'Admin item')", [ids.asgPin, P], /row-level security/)
    if ((await db.query("update public.pin_checklist_items set done = true, remark = 'x' where pin_id = $1 returning id", [ids.asgPin])).rows.length) throw new Error("admin ticked an item")
    await expectFail("insert into public.pin_events (pin_id, project_id, kind, note) values ($1, $2, 'comment', 'Admin note')", [ids.asgPin, P], /row-level security/)
    if ((await count("select count(*) n from public.pins where id = $1", [ids.asgPin])) !== 1) throw new Error("admin cannot see the pin")
    if ((await count("select count(*) n from public.pin_checklist_items where pin_id = $1", [ids.asgPin])) !== 1) throw new Error("admin cannot see the checklist")
  })

  await test("Engineer assigns a pin: who and when are stored, the timeline holds previous and new assignee", async () => {
    await as("asgEng", "aal2")
    if ((await assign(ids.asgPin, ids.asgF1)).rows.length !== 1) throw new Error("engineer could not assign")
    if ((await pinField(ids.asgPin, "assigned_by")) !== ids.asgEng) throw new Error("assigned_by")
    if (!(await pinField(ids.asgPin, "assigned_at"))) throw new Error("assigned_at")
    const ev = (await db.query("select actor_id, from_user, to_user from public.pin_events where pin_id = $1 and kind = 'assigned' order by id", [ids.asgPin])).rows
    if (ev.length !== 1 || ev[0].actor_id !== ids.asgEng || ev[0].from_user !== null || ev[0].to_user !== ids.asgF1) throw new Error("assignment event wrong")
    if ((await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'edited'", [ids.asgPin])) !== 0) throw new Error("assignment also logged as a plain edit")
  })

  await test("A pin created with an assignee records the assignment too", async () => {
    await as("asgEng", "aal2")
    const pin = (await db.query(pinSql, [P, sheet, "Door D3 frame", ids.asgF2])).rows[0].id
    if ((await pinField(pin, "assigned_by")) !== ids.asgEng) throw new Error("assigned_by on insert")
    if ((await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'assigned' and to_user = $2", [pin, ids.asgF2])) !== 1) throw new Error("insert assignment event")
  })

  await test("Assignee must be an active Foreman of the same project", async () => {
    await as("asgEng", "aal2")
    for (const who of [ids.asgOut, ids.asgEng, ids.client1]) {
      await expectFail("update public.pins set assigned_to = $2 where id = $1", [ids.asgPin, who], /active Foreman on this project/)
    }
    await asOwner()
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.asgOff])
    await as("asgEng", "aal2")
    await expectFail("update public.pins set assigned_to = $2 where id = $1", [ids.asgPin, ids.asgOff], /active Foreman on this project/)
  })

  await test("Only an Engineer of the project assigns: outsiders, foremen, clients and admins cannot, not even through the API", async () => {
    for (const [who, aal] of [["eng2", "aal1"], ["asgF1", "aal1"], ["asgF2", "aal1"], ["client1", "aal1"], ["admin", "aal2"], ["super", "aal2"]]) {
      await as(who, aal)
      if ((await assign(ids.asgPin, ids.asgF2)).rows.length) throw new Error(`${who} reassigned the pin`)
    }
    if ((await pinField(ids.asgPin, "assigned_to")) !== ids.asgF1) throw new Error("assignee changed")
    await as("asgEng", "aal2")
    await expectFail("insert into public.pin_events (pin_id, project_id, kind, to_user) values ($1, $2, 'assigned', $3)", [ids.asgPin, P, ids.asgF2], /row-level security/)
    await expectFail("insert into public.pin_events (pin_id, project_id, kind, note, to_user) values ($1, $2, 'comment', 'sneaky', $3)", [ids.asgPin, P, ids.asgF2], /pin_events_users_only_on_assign/)
  })

  await test("Engineers cannot change project membership", async () => {
    await as("asgEng", "aal2")
    await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [P, ids.asgOut], /row-level security/)
    if ((await db.query("delete from public.project_members where project_id = $1 and user_id = $2 returning user_id", [P, ids.asgF2])).rows.length) throw new Error("engineer removed a member")
  })

  await test("Only the assigned Foreman reports, ticks and adds photos; an unassigned pin is closed to every Foreman", async () => {
    await as("asgEng", "aal2")
    const loose = (await db.query(pinSql, [P, sheet, "Unassigned work", null])).rows[0].id
    await as("asgF1")
    await expectFail("select public.report_pin_progress($1, 'in_progress')", [loose], /not assigned to you/)
    await as("asgF2")
    await expectFail("select public.report_pin_progress($1, 'in_progress')", [ids.asgPin], /not assigned to you/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path) values ($1, $2, $3)", [ids.asgPin, P, `${P}/${ids.asgPin}/f2.jpg`], /row-level security/)
    if ((await db.query("update public.pin_checklist_items set remark = 'not mine' where pin_id = $1 returning id", [ids.asgPin])).rows.length) throw new Error("another foreman wrote a remark")
    await as("asgF1")
    await expectOk("select public.report_pin_progress($1, 'in_progress', 'Started course 1')", [ids.asgPin])
    ids.asgPhoto = (await db.query("insert into public.pin_photos (pin_id, project_id, path) values ($1, $2, $3) returning id", [ids.asgPin, P, `${P}/${ids.asgPin}/f1.jpg`])).rows[0].id
  })

  await test("Checklist evidence: an item is done only once the Foreman uploaded a photo for it (a remark alone is not enough)", async () => {
    await asOwner()
    const item = (await db.query("select id from public.pin_checklist_items where pin_id = $1", [ids.asgPin])).rows[0].id
    ids.asgItem = item
    await as("asgF1")
    await expectFail("update public.pin_checklist_items set done = true where id = $1", [item], /Upload a photo for this checklist item/)
    await expectFail("update public.pin_checklist_items set done = true, remark = 'Joints look fine' where id = $1", [item], /Upload a photo for this checklist item/)
    await expectFail("select public.report_pin_progress($1, 'for_review')", [ids.asgPin], /Submit for QA inspection/)
    // A photo of the pin in general does not count for the item; a photo linked to the item does.
    await expectOk("insert into public.pin_photos (pin_id, project_id, path, checklist_item_id) values ($1, $2, $3, $4)", [ids.asgPin, P, `${P}/${ids.asgPin}/joints.jpg`, item])
    const done = (await db.query("update public.pin_checklist_items set done = true where id = $1 returning done_by", [item])).rows[0]
    if (done.done_by !== ids.asgF1) throw new Error("done_by")
    await expectOk("update public.pin_checklist_items set remark = 'Joints 10 mm, checked with gauge' where id = $1", [item])
    await asOwner()
    if ((await count("select count(*) n from public.pin_checklist_items where id = $1 and remark_by = $2", [item, ids.asgF1])) !== 1) throw new Error("remark_by")
  })

  await test("A photo can only be linked to a checklist item of the same pin", async () => {
    await as("asgEng", "aal2")
    const other = (await db.query(pinSql, [P, sheet, "Other pin", ids.asgF1])).rows[0].id
    await as("asgF1")
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, checklist_item_id) values ($1, $2, $3, $4)", [other, P, `${P}/${other}/x.jpg`, ids.asgItem], /belongs to another pin/)
  })

  await test("Reassignment keeps earlier reports, ticks and photos; the previous Foreman loses access, the new one gains it", async () => {
    await as("asgEng", "aal2")
    if ((await assign(ids.asgPin, ids.asgF2)).rows.length !== 1) throw new Error("reassign failed")
    await asOwner()
    const ev = (await db.query("select from_user, to_user from public.pin_events where pin_id = $1 and kind = 'assigned' order by id desc limit 1", [ids.asgPin])).rows[0]
    if (ev.from_user !== ids.asgF1 || ev.to_user !== ids.asgF2) throw new Error("reassignment event wrong")
    if ((await count("select count(*) n from public.pin_photos where pin_id = $1 and uploaded_by = $2", [ids.asgPin, ids.asgF1])) !== 2) throw new Error("earlier photos lost")
    if ((await count("select count(*) n from public.pin_checklist_items where pin_id = $1 and done and done_by = $2", [ids.asgPin, ids.asgF1])) !== 1) throw new Error("earlier tick lost")
    if ((await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'comment' and actor_id = $2", [ids.asgPin, ids.asgF1])) !== 1) throw new Error("earlier report lost")
    await as("asgF1")
    await expectFail("select public.report_pin_progress($1, 'for_review')", [ids.asgPin], /not assigned to you/)
    await as("asgF2")
    await expectFail("select public.report_pin_progress($1, 'for_review', 'Wall finished')", [ids.asgPin], /Submit for QA inspection/)
  })

  await test("Verification is the Engineer's: admins cannot verify; verified work cannot be reassigned", async () => {
    await as("admin", "aal2")
    if ((await db.query("update public.pins set status = 'verified' where id = $1 returning id", [ids.asgPin])).rows.length) throw new Error("admin verified")
    await as("asgEng", "aal2")
    await passWorkFixture({db,ids,as,asOwner},ids.asgPin,"asgEng","asgF2")
    await expectOk("update public.pins set status = 'verified' where id = $1", [ids.asgPin])
    if ((await pinField(ids.asgPin, "verified_by")) !== ids.asgEng) throw new Error("verified_by")
    await expectFail("update public.pins set assigned_to = $2 where id = $1", [ids.asgPin, ids.asgF1], /reopen the pin before reassigning/)
  })

  await test("Admins cannot run inspections", async () => {
    await as("admin", "aal2")
    await expectFail("select public.raise_defect($1, 'Admin NCR', null, 'workmanship', 'minor', 'general')", [P], /not allowed/)
  })

  await test("A Foreman removed from the project hands back unfinished pins; verified work keeps its Foreman", async () => {
    await as("asgEng", "aal2")
    const open = (await db.query(pinSql, [P, sheet, "Open work for F2", ids.asgF2])).rows[0].id
    await as("admin", "aal2")
    await as("super", "aal2")
    await expectOk("delete from public.project_members where project_id = $1 and user_id = $2", [P, ids.asgF2])
    if ((await pinField(open, "assigned_to")) !== null) throw new Error("open pin still assigned")
    if ((await pinField(ids.asgPin, "assigned_to")) !== ids.asgF2) throw new Error("verified pin lost its foreman")
    await asOwner()
    const ev = (await db.query("select actor_id, from_user, to_user from public.pin_events where pin_id = $1 and kind = 'assigned' order by id desc limit 1", [open])).rows[0]
    if (ev.from_user !== ids.asgF2 || ev.to_user !== null || ev.actor_id !== ids.super) throw new Error("unassignment not recorded")
    await as("asgEng", "aal2")
    await expectFail("update public.pins set assigned_to = $2 where id = $1", [open, ids.asgF2], /active Foreman on this project/)
  })

  await test("Engineers build the checklist but never fill it in: no ticks, remarks or evidence photos", async () => {
    await as("asgEng", "aal2")
    const pin = (await db.query(pinSql, [P, sheet, "Ceiling C2 boards", ids.asgF1])).rows[0].id
    ids.asgPin2 = pin
    const item = (await db.query("insert into public.pin_checklist_items (pin_id, project_id, text) values ($1, $2, 'Screws every 200 mm') returning id", [pin, P])).rows[0].id
    ids.asgItem2 = item
    await expectFail("update public.pin_checklist_items set remark = 'Looks fine' where id = $1", [item], /Only the Foreman assigned/)
    await expectFail("update public.pin_checklist_items set done = true, remark = 'Looks fine' where id = $1", [item], /Only the Foreman assigned/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, checklist_item_id) values ($1, $2, $3, $4)", [pin, P, `${P}/${pin}/eng.jpg`, item], /row-level security/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path) values ($1, $2, $3)", [pin, P, `${P}/${pin}/eng2.jpg`], /row-level security/)
    await expectOk("update public.pin_checklist_items set text = 'Screws every 200 mm (max)' where id = $1", [item])
  })

  await test("Verification gate: the checklist must be complete", async () => {
    await as("asgEng", "aal2")
    await expectFail("update public.pins set status = 'verified' where id = $1", [ids.asgPin2], /Every checklist item must be completed/)
    await as("asgF1")
    await expectOk("insert into public.pin_photos (pin_id, project_id, path, checklist_item_id) values ($1, $2, $3, $4)", [ids.asgPin2, P, `${P}/${ids.asgPin2}/screws.jpg`, ids.asgItem2])
    await expectOk("update public.pin_checklist_items set done = true, remark = 'Checked with tape' where id = $1", [ids.asgItem2])
    await expectFail("select public.report_pin_progress($1, 'for_review')", [ids.asgPin2], /Submit for QA inspection/)
  })

  await test("Verification gate: QA must be clear (no open NCR on the pin)", async () => {
    await as("asgEng", "aal2")
    const ncr = (await db.query("select public.raise_defect($1, 'Board gap', 'Gap over 3 mm', 'workmanship', 'minor', 'architectural', null, $2) id", [P, ids.asgPin2])).rows[0].id
    await expectFail("update public.pins set status = 'verified' where id = $1", [ids.asgPin2], /open defects/)
    await asOwner()
    await db.query("update public.qa_defects set status = 'closed' where id = $1", [ncr])
    await as("asgEng", "aal2")
    await passWorkFixture({db,ids,as,asOwner},ids.asgPin2,"asgEng","asgF1")
    await expectOk("update public.pins set status = 'verified' where id = $1", [ids.asgPin2])
  })

  await test("Verification gate: a failed or still-open inspection blocks; a new pin cannot start verified", async () => {
    await as("asgEng", "aal2")
    const pin = (await db.query(pinSql, [P, sheet, "Stair S1 handrail", ids.asgF1])).rows[0].id
    await asOwner()
    const insp = (await db.query("insert into public.qa_inspections (project_id, number, pin_id, title, trade, status) values ($1, 9001, $2, 'Handrail check', 'architectural', 'in_progress') returning id", [P, pin])).rows[0].id
    await as("asgEng", "aal2")
    await expectFail("update public.pins set status = 'verified' where id = $1", [pin], /Every checklist item must be completed/)
    await asOwner()
    await db.query("update public.qa_inspections set status = 'failed', completed_at = now() where id = $1", [insp])
    await as("asgEng", "aal2")
    await expectFail("update public.pins set status = 'verified' where id = $1", [pin], /Every checklist item must be completed/)
    await expectFail("insert into public.pins (project_id, blueprint_id, x, y, title, status) values ($1, $2, 5, 5, 'Born verified', 'verified')", [P, sheet], /cannot start as verified/)
  })

  await test("QA: a Foreman uploads a photo on each checklist item of a requested inspection; engineers and clients cannot yet", async () => {
    await asOwner()
    const tpl = (await db.query("select id from public.qa_templates where project_id is null and is_system and not archived order by name limit 1")).rows[0].id
    await as("asgF1")
    const insp = (await db.query("select public.request_inspection($1, $2, 'Blockwork level 2 check') id", [P, tpl])).rows[0].id
    await asOwner()
    const item = (await db.query("select id from public.qa_inspection_items where inspection_id = $1 order by position limit 1", [insp])).rows[0].id
    await as("asgF1")
    await expectOk("insert into public.qa_photos (project_id, item_id, path) values ($1, $2, $3)", [P, item, `${P}/ir/self-check.jpg`])
    await as("asgEng", "aal2")
    await expectFail("insert into public.qa_photos (project_id, item_id, path) values ($1, $2, $3)", [P, item, `${P}/ir/eng.jpg`], /requested \(Foremen\) or in progress/)
    await as("client1")
    await expectFail("insert into public.qa_photos (project_id, item_id, path) values ($1, $2, $3)", [P, item, `${P}/ir/client.jpg`], /row-level security|requested \(Foremen\)/)
    await asOwner()
    if ((await count("select count(*) n from public.qa_photos where item_id = $1 and uploaded_by = $2", [item, ids.asgF1])) !== 1) throw new Error("foreman photo missing")
  })

  await test("Internal functions cannot be called through the API", async () => {
    await as("asgEng", "aal2")
    for (const fn of ["guard_pin_assignment", "unassign_departed_foreman", "guard_blueprint_editor_fields", "check_pin_photo_item", "guard_pin_verification"]) {
      await expectFail(`select public.${fn}()`, [], /permission denied/)
    }
  })
}
