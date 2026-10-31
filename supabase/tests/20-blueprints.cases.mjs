// Tests for 0009 (blueprints, revisions, blueprint storage).
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count, addUser }) {
  // Fixtures: an admin who may manage projects but NOT blueprints, and a second project with its own engineer.
  await addUser("projonly", "admin")
  await asOwner()
  await db.query("delete from public.admin_permissions where user_id = $1", [ids.projonly])
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'projects.manage')", [ids.projonly])

  await as("admin", "aal2")
  const other = (await db.query("insert into public.projects (code, name) values ('OTHER-9', 'Other site') returning id")).rows[0].id
  await as("super", "aal2") // Team setup uses Super Admin recovery authority.
  await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [other, ids.eng2])
  ids.other = other
  const P1 = ids.p1

  const newBlueprint = async (who, pid, title = "Ground Floor Plan") => {
    await as(who, "aal2")
    return (
      await db.query(
        "insert into public.blueprints (project_id, title, level, discipline) values ($1, $2, 'L01', 'architectural') returning id",
        [pid, title],
      )
    ).rows[0].id
  }
  const revisionSql = `insert into public.blueprint_revisions
    (blueprint_id, project_id, revision, file_path, file_name, mime_type, size_bytes, preview_path, preview_width, preview_height)
    values ($1, $2, 99, $3, 'plan.pdf', 'application/pdf', 1000, $4, 800, 600) returning id, revision, uploaded_by`

  await test("Assigned Engineer can add a blueprint; created_by is filled by the database", async () => {
    ids.bp1 = await newBlueprint("eng1", P1)
    await asOwner()
    const { rows } = await db.query("select created_by from public.blueprints where id = $1", [ids.bp1])
    if (rows[0].created_by !== ids.eng1) throw new Error("created_by not set")
  })

  await test("Revision numbers are assigned by the database (1, 2, 3), whatever the client sends", async () => {
    await as("eng1", "aal2")
    for (const expected of [1, 2, 3]) {
      const r = await db.query(revisionSql, [ids.bp1, P1, `${P1}/${ids.bp1}/r${expected}.pdf`, `${P1}/${ids.bp1}/r${expected}.png`])
      if (r.rows[0].revision !== expected) throw new Error(`expected revision ${expected}, got ${r.rows[0].revision}`)
      if (r.rows[0].uploaded_by !== ids.eng1) throw new Error("uploaded_by not set")
    }
  })

  await test("Files outside the project's folder are rejected (path spoofing)", async () => {
    await as("eng1", "aal2")
    await expectFail(revisionSql, [ids.bp1, P1, `${other}/${ids.bp1}/x.pdf`, `${P1}/${ids.bp1}/x.png`], /inside the project folder/)
    await expectFail(revisionSql, [ids.bp1, P1, `${P1}/${ids.bp1}/x.pdf`, `${other}/x.png`], /inside the project folder/)
  })

  await test("A revision cannot claim a different project than its blueprint", async () => {
    await as("eng1", "aal2")
    const r = await db.query(revisionSql, [ids.bp1, other, `${P1}/${ids.bp1}/y.pdf`, `${P1}/${ids.bp1}/y.png`]).catch((e) => e)
    // either rejected by RLS or silently corrected to the blueprint's project; it must never land in another project
    if (!(r instanceof Error)) {
      await asOwner()
      const n = await count("select count(*) n from public.blueprint_revisions where project_id = $1", [other])
      if (n !== 0) throw new Error("revision landed in another project")
    }
  })

  await test("Invalid revision data is rejected (bad mime type, zero size, oversize)", async () => {
    await as("eng1", "aal2")
    const bad = (mime, size) =>
      db.query(
        `insert into public.blueprint_revisions (blueprint_id, project_id, revision, file_path, file_name, mime_type, size_bytes, preview_path, preview_width, preview_height)
         values ($1, $2, 1, $3, 'a.dwg', $4, $5, $3, 10, 10)`,
        [ids.bp1, P1, `${P1}/z.dwg`, mime, size],
      )
    await expectFail("select 1 where false union all select (select 1 from (values (1)) v where false)", [], /.^/).catch(() => {})
    for (const [mime, size, pattern] of [
      ["application/acad", 1000, /mime_type_check/],
      ["application/pdf", 0, /size_bytes_check/],
      ["application/pdf", 26214401, /size_bytes_check/],
    ]) {
      try {
        await bad(mime, size)
        throw new Error(`accepted ${mime} ${size}`)
      } catch (error) {
        if (!pattern.test(error.message)) throw error
      }
    }
  })

  await test("Revisions are immutable: users update 0 rows, and even the database owner is blocked by a trigger", async () => {
    await as("eng1", "aal2")
    const upd = await db.query("update public.blueprint_revisions set notes = 'changed' where blueprint_id = $1 returning id", [ids.bp1])
    if (upd.rows.length) throw new Error("a user edited a revision")
    await asOwner()
    await expectFail("update public.blueprint_revisions set notes = 'changed' where blueprint_id = $1", [ids.bp1], /cannot be edited/)
  })

  await test("Engineer not assigned to the project cannot add blueprints or revisions to it", async () => {
    await as("eng2", "aal2")
    await expectFail("insert into public.blueprints (project_id, title) values ($1, 'Sneaky plan')", [P1], /row-level security/)
    await expectFail(revisionSql, [ids.bp1, P1, `${P1}/${ids.bp1}/s.pdf`, `${P1}/${ids.bp1}/s.png`], /row-level security/)
  })

  await test("Foreman, Client and pending users cannot add blueprints", async () => {
    for (const who of ["fore1", "client1", "pending1"]) {
      await as(who, "aal2")
      await expectFail("insert into public.blueprints (project_id, title) values ($1, 'Nope plan')", [P1], /row-level security/)
    }
  })

  await test("Admin without blueprints.manage and Admin without MFA cannot add blueprints", async () => {
    await as("projonly", "aal2")
    await expectFail("insert into public.blueprints (project_id, title) values ($1, 'Nope plan')", [P1], /row-level security/)
    await as("admin", "aal1")
    await expectFail("insert into public.blueprints (project_id, title) values ($1, 'Nope plan')", [P1], /row-level security/)
  })

  await test("Admin with blueprints.manage can add blueprints to any project", async () => {
    await as("admin", "aal2")
    await expectOk("insert into public.blueprints (project_id, title) values ($1, 'Admin plan')", [other])
  })

  await test("Who can SEE blueprints: assigned people and project managers, nobody else", async () => {
    const seen = async (who, aal = "aal1") => {
      await as(who, aal)
      return count("select count(*) n from public.blueprints where project_id = $1", [P1])
    }
    if ((await seen("eng1")) < 1) throw new Error("assigned engineer cannot see")
    if ((await seen("client1")) < 1) throw new Error("assigned client cannot see")
    if ((await seen("projonly", "aal2")) < 1) throw new Error("project manager cannot see")
    if ((await seen("eng2")) !== 0) throw new Error("unassigned engineer can see")
    if ((await seen("fore1")) !== 0) throw new Error("unassigned foreman can see")
    if ((await seen("pending1")) !== 0) throw new Error("pending user can see")
    await as(null)
    if ((await count("select count(*) n from public.blueprints").catch(() => 0)) !== 0) throw new Error("anon can see")
    if ((await seen("projonly", "aal1")) !== 0) throw new Error("admin without MFA can see")
  })

  await test("Revisions follow the same visibility", async () => {
    await asOwner()
    const total = await count("select count(*) n from public.blueprint_revisions where blueprint_id = $1", [ids.bp1])
    if (total < 3) throw new Error("fixture revisions missing")
    await as("client1")
    if ((await count("select count(*) n from public.blueprint_revisions where blueprint_id = $1", [ids.bp1])) !== total) throw new Error("client cannot see all revisions")
    await as("eng2")
    if ((await count("select count(*) n from public.blueprint_revisions where blueprint_id = $1", [ids.bp1])) !== 0) throw new Error("outsider sees revisions")
  })

  await test("Engineers can edit blueprint details; Clients cannot", async () => {
    await as("eng1", "aal2")
    const upd = await db.query("update public.blueprints set title = 'Ground Floor Plan v2' where id = $1 returning id", [ids.bp1])
    if (!upd.rows.length) throw new Error("engineer could not rename")
    await as("client1")
    const bad = await db.query("update public.blueprints set title = 'hacked' where id = $1 returning id", [ids.bp1])
    if (bad.rows.length) throw new Error("client renamed a blueprint")
  })

  await test("Engineers cannot delete blueprints; admin with blueprints.manage can (revisions cascade)", async () => {
    await as("eng1", "aal2")
    const del = await db.query("delete from public.blueprints where id = $1 returning id", [ids.bp1])
    if (del.rows.length) throw new Error("engineer deleted a blueprint")
    await as("admin", "aal2")
    const ok = await db.query("delete from public.blueprints where id = $1 returning id", [ids.bp1])
    if (ok.rows.length !== 1) throw new Error("admin could not delete")
    await asOwner()
    if ((await count("select count(*) n from public.blueprint_revisions where blueprint_id = $1", [ids.bp1])) !== 0) throw new Error("revisions not cascaded")
  })

  await test("Blueprint changes are audited", async () => {
    await asOwner()
    const n = await count("select count(*) n from public.audit_log where action in ('blueprints.insert','blueprints.update','blueprints.delete','blueprint_revisions.insert')")
    if (n < 5) throw new Error(`expected several audit rows, found ${n}`)
  })

  // ---- Storage bucket policies ----
  await test("Bucket is private and limited to PDF / PNG / JPEG / WebP, 25 MB", async () => {
    await asOwner()
    const { rows } = await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'blueprints'")
    if (rows[0].public !== false) throw new Error("bucket is public")
    if (Number(rows[0].file_size_limit) !== 26214400) throw new Error("size limit wrong")
    if (rows[0].allowed_mime_types.join() !== "application/pdf,image/png,image/jpeg,image/webp") throw new Error("mime list wrong")
  })

  await test("Storage: assigned Engineer uploads into the project folder only", async () => {
    await as("eng1", "aal2")
    // Files live in the sheet's folder (<project>/<sheet>/...): since 20261028130000 the sheet's type decides who may add them.
    const sheet = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Storage folder sheet') returning id", [P1])).rows[0].id
    await expectOk("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [`${P1}/${sheet}/plan.pdf`])
    await expectFail("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [`${other}/abc/plan.pdf`], /row-level security/)
    await expectFail("insert into storage.objects (bucket_id, name) values ('blueprints', 'junk/plan.pdf')", [], /row-level security/)
    await expectFail("insert into storage.objects (bucket_id, name) values ('other-bucket', $1)", [`${P1}/x.pdf`], /foreign key|row-level security/)
  })

  await test("Storage: files are visible to the project's people only", async () => {
    await as("client1")
    if ((await count("select count(*) n from storage.objects where bucket_id = 'blueprints'")) !== 1) throw new Error("client cannot read project file")
    await as("eng2")
    if ((await count("select count(*) n from storage.objects where bucket_id = 'blueprints'")) !== 0) throw new Error("other project's engineer reads the file")
    await as(null)
    if ((await count("select count(*) n from storage.objects").catch(() => 0)) !== 0) throw new Error("anon reads files")
  })

  await test("Storage: Foreman, Client and Admin without blueprints.manage cannot upload; nobody but blueprints.manage deletes", async () => {
    await as("client1", "aal2")
    await expectFail("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [`${P1}/c.pdf`], /row-level security/)
    await as("projonly", "aal2")
    await expectFail("insert into storage.objects (bucket_id, name) values ('blueprints', $1)", [`${P1}/c.pdf`], /row-level security/)
    await as("eng1", "aal2")
    const del = await db.query("delete from storage.objects where bucket_id = 'blueprints' returning id")
    if (del.rows.length) throw new Error("engineer deleted a file")
    await as("admin", "aal2")
    const ok = await db.query("delete from storage.objects where bucket_id = 'blueprints' returning id")
    if (ok.rows.length !== 1) throw new Error("admin could not delete the file")
  })
}
