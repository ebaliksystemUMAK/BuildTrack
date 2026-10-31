// Tests for 0010 (pins, timeline, photos, foreman progress reports, pin-photo storage).
import { passWorkFixture } from "./qa-fixtures.mjs"
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count, addUser }) {
  const P1 = ids.p1
  const OTHER = ids.other

  // Fixtures: foreman fore1 joins P1; fore2 is a foreman on P1 too (for "assigned to someone else"); fore3 is not on P1.
  await addUser("fore2", "foreman")
  await addUser("fore3", "foreman")
  await as("super", "aal2") // Team fixture; regular Admins appoint Project Managers.
  await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2), ($1, $3)", [P1, ids.fore1, ids.fore2])

  await as("eng1", "aal2")
  const bpId = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Pin test plan') returning id", [P1])).rows[0].id
  const revId = (
    await db.query(
      `insert into public.blueprint_revisions (blueprint_id, project_id, revision, file_path, file_name, mime_type, size_bytes, preview_path, preview_width, preview_height)
       values ($1, $2, 1, $3, 'p.png', 'image/png', 500, $3, 1000, 800) returning id`,
      [bpId, P1, `${P1}/${bpId}/p.png`],
    )
  ).rows[0].id

  const pinSql = "insert into public.pins (project_id, blueprint_id, revision_id, x, y, title) values ($1, $2, $3, $4, $5, $6) returning id"
  const newPin = async (who = "eng1", title = "Column C4 rebar") => {
    await as(who, "aal2")
    return (await db.query(pinSql, [P1, bpId, revId, 40.5, 60.25, title])).rows[0].id
  }
  const field = async (pin, column) => {
    await asOwner()
    return (await db.query(`select ${column} as v from public.pins where id = $1`, [pin])).rows[0].v
  }
  const events = async (pin, kind) => {
    await asOwner()
    return count("select count(*) n from public.pin_events where pin_id = $1 and kind = $2", [pin, kind])
  }

  await test("Assigned Engineer creates a pin: defaults, creator and 'created' event set by the database", async () => {
    ids.pin1 = await newPin()
    if ((await field(ids.pin1, "status")) !== "not_started") throw new Error("default status")
    if ((await field(ids.pin1, "created_by")) !== ids.eng1) throw new Error("created_by")
    if ((await events(ids.pin1, "created")) !== 1) throw new Error("created event missing")
  })

  await test("A pin cannot be placed in another project by lying about project_id", async () => {
    await as("eng1", "aal2")
    const { rows } = await db.query(pinSql.replace("returning id", "returning id, project_id"), [OTHER, bpId, revId, 10, 10, "Lying pin"]).catch((e) => ({ error: e }))
    if (rows && rows[0].project_id !== P1) throw new Error("pin landed in another project")
  })

  await test("Invalid pin data is rejected (coordinates outside 0-100, short title, foreign revision)", async () => {
    await as("eng1", "aal2")
    await expectFail(pinSql, [P1, bpId, revId, 100.5, 10, "Valid title"], /pins_x_check/)
    await expectFail(pinSql, [P1, bpId, revId, 10, -1, "Valid title"], /pins_y_check/)
    await expectFail(pinSql, [P1, bpId, revId, 10, 10, "x"], /pins_title_check/)
    await expectFail(pinSql, [P1, bpId, crypto.randomUUID(), 10, 10, "Valid title"], /revision|foreign key/i)
  })

  await test("People outside the project, pending users and anonymous cannot create pins or see them", async () => {
    for (const who of ["eng2", "fore3", "pending1"]) {
      await as(who, "aal2")
      await expectFail(pinSql, [P1, bpId, revId, 10, 10, "Intruder pin"], /row-level security|Blueprint not found/)
      if ((await count("select count(*) n from public.pins where project_id = $1", [P1])) !== 0) throw new Error(`${who} can see pins`)
    }
    await as(null)
    await expectFail(pinSql, [P1, bpId, revId, 10, 10, "Anon pin"], /permission denied|row-level security/)
  })

  await test("Client sees pins read-only; Foreman cannot edit or delete pins directly", async () => {
    await as("client1")
    if ((await count("select count(*) n from public.pins where project_id = $1", [P1])) < 1) throw new Error("client cannot see pins")
    for (const who of ["client1", "fore1"]) {
      await as(who, "aal2")
      await expectFail(pinSql, [P1, bpId, revId, 10, 10, "Not allowed pin"], /row-level security/)
      const upd = await db.query("update public.pins set title = 'hacked title' where id = $1 returning id", [ids.pin1])
      if (upd.rows.length) throw new Error(`${who} edited a pin`)
      const del = await db.query("delete from public.pins where id = $1 returning id", [ids.pin1])
      if (del.rows.length) throw new Error(`${who} deleted a pin`)
    }
  })

  await test("Engineer moves and edits a pin: 'moved' and 'edited' events are written", async () => {
    await as("eng1", "aal2")
    await expectOk("update public.pins set x = 55, y = 45 where id = $1", [ids.pin1])
    await expectOk("update public.pins set description = 'Check cover and spacing', category = 'quality' where id = $1", [ids.pin1])
    if ((await events(ids.pin1, "moved")) !== 1) throw new Error("moved event")
    if ((await events(ids.pin1, "edited")) !== 1) throw new Error("edited event")
  })

  await test("A pin cannot be moved to another plan or project", async () => {
    await as("eng1", "aal2")
    const other = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Second plan') returning id", [P1])).rows[0].id
    await expectFail("update public.pins set blueprint_id = $2 where id = $1", [ids.pin1, other], /another plan/)
  })

  await test("Assignment: only an active Foreman on the project", async () => {
    await as("eng1", "aal2")
    await expectOk("update public.pins set assigned_to = $2 where id = $1", [ids.pin1, ids.fore1])
    for (const who of [ids.client1, ids.fore3, ids.eng1]) {
      await expectFail("update public.pins set assigned_to = $2 where id = $1", [ids.pin1, who], /assigned to an active Foreman/)
    }
  })

  await test("Foreman reports progress through report_pin_progress (In progress, For review) and may add a note", async () => {
    await as("fore1", "aal2")
    await expectOk("select public.report_pin_progress($1, 'in_progress', 'Rebar tied, waiting for inspection')", [ids.pin1])
    if ((await field(ids.pin1, "status")) !== "in_progress") throw new Error("status not updated")
    await expectFail("select public.report_pin_progress($1, 'for_review')", [ids.pin1], /Submit for QA inspection/)
    await asOwner()
    if ((await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'comment' and note like 'Rebar tied%'", [ids.pin1])) !== 1) throw new Error("note not recorded as a comment")
    if ((await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'status'", [ids.pin1])) < 1) throw new Error("status events missing")
  })

  await test("Foreman cannot set Verified / Issue / Not started, cannot report on pins of others or when not on the project", async () => {
    await as("fore1", "aal2")
    for (const status of ["verified", "issue", "not_started"]) {
      await expectFail("select public.report_pin_progress($1, $2)", [ids.pin1, status], /Submit for QA inspection/)
    }
    await as("fore2", "aal2")
    await expectFail("select public.report_pin_progress($1, 'in_progress')", [ids.pin1], /not assigned to you/)
    await as("fore3", "aal2")
    await expectFail("select public.report_pin_progress($1, 'in_progress')", [ids.pin1], /Only a Foreman assigned/)
    for (const who of ["eng1", "client1"]) {
      await as(who, "aal2")
      await expectFail("select public.report_pin_progress($1, 'in_progress')", [ids.pin1], /Only a Foreman assigned/)
    }
    await as(null)
    await expectFail("select public.report_pin_progress($1, 'in_progress')", [ids.pin1], /permission denied/)
  })

  await test("Verification: Engineer verifies (who/when recorded); Foreman can no longer change it; un-verifying clears it", async () => {
    await as("eng1", "aal2")
    await passWorkFixture({db,ids,as,asOwner},ids.pin1)
    await expectOk("update public.pins set status = 'verified' where id = $1", [ids.pin1])
    if ((await field(ids.pin1, "verified_by")) !== ids.eng1) throw new Error("verified_by")
    if (!(await field(ids.pin1, "verified_at"))) throw new Error("verified_at")
    await as("fore1", "aal2")
    await expectFail("select public.report_pin_progress($1, 'in_progress')", [ids.pin1], /verified pin can only be changed by an Engineer/)
    await as("eng1", "aal2")
    await expectOk("update public.pins set status = 'in_progress' where id = $1", [ids.pin1])
    if ((await field(ids.pin1, "verified_by")) !== null) throw new Error("verified_by not cleared")
  })

  await test("Verified pins are evidence: the Engineer cannot delete them; admins cannot delete pins at all (0033, 0040)", async () => {
    const pin = await newPin("eng1", "Slab pour check")
    await as("eng1", "aal2")
    await passWorkFixture({db,ids,as,asOwner},pin)
    await expectOk("update public.pins set status = 'verified' where id = $1", [pin])
    const del = await db.query("delete from public.pins where id = $1 returning id", [pin])
    if (del.rows.length) throw new Error("engineer deleted a verified pin")
    await as("admin", "aal2")
    if ((await db.query("delete from public.pins where id = $1 returning id", [pin])).rows.length) throw new Error("admin deleted a pin")
  })

  await test("Engineer can delete an unverified pin", async () => {
    const pin = await newPin("eng1", "Temporary pin")
    await as("eng1", "aal2")
    const del = await db.query("delete from public.pins where id = $1 returning id", [pin])
    if (del.rows.length !== 1) throw new Error("engineer could not delete own unverified pin")
  })

  // ---- Timeline ----
  await test("Timeline: visible to Engineer, Foreman and project managers; hidden from Client and outsiders", async () => {
    const see = async (who, aal = "aal1") => {
      await as(who, aal)
      return count("select count(*) n from public.pin_events where pin_id = $1", [ids.pin1])
    }
    if ((await see("eng1")) < 3) throw new Error("engineer cannot see timeline")
    if ((await see("fore1")) < 3) throw new Error("foreman cannot see timeline")
    if ((await see("projonly", "aal2")) < 3) throw new Error("project manager cannot see timeline")
    if ((await see("client1")) !== 0) throw new Error("client sees the internal timeline")
    if ((await see("eng2")) !== 0) throw new Error("outsider sees the timeline")
  })

  await test("Comments: Engineer and Foreman can; Client, outsiders and empty text cannot; actor cannot be spoofed", async () => {
    const add = (note, kind = "comment", actor = ids.client1) =>
      db.query("insert into public.pin_events (pin_id, project_id, actor_id, kind, note) values ($1, $2, $3, $4, $5) returning actor_id", [ids.pin1, P1, actor, kind, note])
    await as("fore1", "aal2")
    const r = await add("Concrete delivered at 9:00")
    if (r.rows[0].actor_id !== ids.fore1) throw new Error("actor was spoofed")
    await as("eng1", "aal2")
    await expectOk("insert into public.pin_events (pin_id, project_id, kind, note) values ($1, $2, 'comment', 'Looks fine')", [ids.pin1, P1])
    for (const who of ["client1", "eng2", "fore3"]) {
      await as(who, "aal2")
      await expectFail("insert into public.pin_events (pin_id, project_id, kind, note) values ($1, $2, 'comment', 'Let me in')", [ids.pin1, P1], /row-level security/)
    }
    await as("eng1", "aal2")
    await expectFail("insert into public.pin_events (pin_id, project_id, kind, note) values ($1, $2, 'comment', '   ')", [ids.pin1, P1], /pin_events_check|check constraint/)
    await expectFail("insert into public.pin_events (pin_id, project_id, kind, to_status) values ($1, $2, 'status', 'verified')", [ids.pin1, P1], /row-level security/)
  })

  await test("Timeline entries are immutable (no edit, no delete)", async () => {
    await as("eng1", "aal2")
    const upd = await db.query("update public.pin_events set note = 'rewritten' where pin_id = $1 returning id", [ids.pin1])
    if (upd.rows.length) throw new Error("event edited")
    const del = await db.query("delete from public.pin_events where pin_id = $1 returning id", [ids.pin1])
    if (del.rows.length) throw new Error("event deleted")
    await asOwner()
    await expectFail("update public.pin_events set note = 'rewritten' where pin_id = $1", [ids.pin1], /cannot be edited/)
  })

  // ---- Photos ----
  const photoSql = "insert into public.pin_photos (pin_id, project_id, path, caption) values ($1, $2, $3, 'Rebar after tying') returning id"
  await test("Photos: Foreman adds one (a timeline entry is written); wrong project folder is rejected", async () => {
    const before = await events(ids.pin1, "photo")
    await as("fore1", "aal2")
    ids.photo1 = (await db.query(photoSql, [ids.pin1, P1, `${P1}/${ids.pin1}/a.jpg`])).rows[0].id
    await expectFail(photoSql, [ids.pin1, P1, `${OTHER}/${ids.pin1}/b.jpg`], /inside the project folder/)
    if ((await events(ids.pin1, "photo")) !== before + 1) throw new Error("photo event missing")
  })

  await test("Photos: Client sees them, cannot add; outsiders see nothing; evidence photos cannot be deleted by anyone", async () => {
    await as("client1")
    if ((await count("select count(*) n from public.pin_photos where id = $1", [ids.photo1])) !== 1) throw new Error("client cannot see photo")
    await as("client1", "aal2")
    await expectFail(photoSql, [ids.pin1, P1, `${P1}/${ids.pin1}/c.jpg`], /row-level security/)
    await as("eng2")
    if ((await count("select count(*) n from public.pin_photos where pin_id = $1", [ids.pin1])) !== 0) throw new Error("outsider sees photo")
    await as("fore2", "aal2")
    const bad = await db.query("delete from public.pin_photos where id = $1 returning id", [ids.photo1])
    if (bad.rows.length) throw new Error("another foreman deleted the photo")
    // pin1 was verified earlier, so its photo is evidence: even the uploader and an admin cannot delete it (0033).
    await as("fore1", "aal2")
    await expectFail("delete from public.pin_photos where id = $1", [ids.photo1], /evidence/)
    await as("admin", "aal2")
    await expectFail("delete from public.pin_photos where id = $1", [ids.photo1], /evidence/)
  })

  await test("pin-photos bucket: private, images only, 8 MB; project folder rules for upload, view and delete", async () => {
    await asOwner()
    const { rows } = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'pin-photos'")
    if (rows[0].public !== false || Number(rows[0].file_size_limit) !== 8388608) throw new Error("bucket settings")
    if (rows[0].allowed_mime_types.join() !== "image/jpeg,image/png,image/webp") throw new Error("mime list")

    await as("fore1", "aal2")
    await expectOk("insert into storage.objects (bucket_id, name, owner) values ('pin-photos', $1, $2)", [`${P1}/${ids.pin1}/p.jpg`, ids.fore1])
    await expectFail("insert into storage.objects (bucket_id, name, owner) values ('pin-photos', $1, $2)", [`${OTHER}/x/p.jpg`, ids.fore1], /row-level security/)
    await as("client1", "aal2")
    await expectFail("insert into storage.objects (bucket_id, name, owner) values ('pin-photos', $1, $2)", [`${P1}/x/c.jpg`, ids.client1], /row-level security/)
    if ((await count("select count(*) n from storage.objects where bucket_id = 'pin-photos'")) !== 1) throw new Error("client cannot view the photo file")
    await as("eng2")
    if ((await count("select count(*) n from storage.objects where bucket_id = 'pin-photos'")) !== 0) throw new Error("outsider views the photo file")
    await as("fore2", "aal2")
    if ((await db.query("delete from storage.objects where bucket_id = 'pin-photos' returning id")).rows.length) throw new Error("non-owner deleted the file")
    await as("fore1", "aal2")
    if ((await db.query("delete from storage.objects where bucket_id = 'pin-photos' returning id")).rows.length !== 1) throw new Error("owner could not delete the file")
  })

  // ---- Cascades and audit ----
  await test("Deleting a blueprint removes its pins, events and photos; a blueprint holding evidence cannot be deleted", async () => {
    await as("admin", "aal2")
    await expectFail("delete from public.blueprints where id = $1", [bpId], /evidence/)
    await as("eng1", "aal2")
    const spare = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Spare plan') returning id", [P1])).rows[0].id
    const pin = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 10, 10, 'Cascade pin', $3) returning id", [P1, spare, ids.fore1])).rows[0].id
    await as("fore1", "aal2")
    await expectOk(photoSql, [pin, P1, `${P1}/${pin}/draft.jpg`])
    await as("admin", "aal2")
    await db.query("delete from public.blueprints where id = $1", [spare])
    await asOwner()
    if ((await count("select count(*) n from public.pins where blueprint_id = $1", [spare])) !== 0) throw new Error("pins remain")
    if ((await count("select count(*) n from public.pin_events where pin_id = $1", [pin])) !== 0) throw new Error("events remain")
    if ((await count("select count(*) n from public.pin_photos where pin_id = $1", [pin])) !== 0) throw new Error("photos remain")
  })

  await test("Pin changes are audited", async () => {
    await asOwner()
    if ((await count("select count(*) n from public.audit_log where action like 'pins.%'")) < 4) throw new Error("pin audit rows missing")
  })
}
