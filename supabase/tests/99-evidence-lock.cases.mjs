// Tests for 0033 (evidence lock) and 0034 (live-update publication).
import { passWorkFixture } from "./qa-fixtures.mjs"
export default async function ({ db, ids, as, asOwner, test, expectFail, count }) {
  const P1 = ids.p1

  await as("eng1", "aal2")
  const sheet = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Evidence test plan') returning id", [P1])).rows[0].id
  const newPin = async (title) => {
    await as("eng1", "aal2")
    return (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 20, 30, $3, $4) returning id", [P1, sheet, title, ids.fore1])).rows[0].id
  }
  const setStatus = async (pin, status) => {
    if (status === "verified") await passWorkFixture({db,ids,as,asOwner},pin)
    await as("eng1", "aal2")
    await db.query("update public.pins set status = $2 where id = $1", [pin, status])
  }
  const addPhoto = async (pin, name) => {
    const path = `${P1}/${pin}/${name}.jpg`
    await asOwner()
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('pin-photos', $1, $2)", [path, ids.fore1])
    await as("fore1")
    const id = (await db.query("insert into public.pin_photos (pin_id, project_id, path, caption) values ($1, $2, $3, $4) returning id", [pin, P1, path, name])).rows[0].id
    return { id, path }
  }
  const photoCount = async (pin) => {
    await asOwner()
    return count("select count(*) n from public.pin_photos where pin_id = $1", [pin])
  }
  const fileCount = async (path) => {
    await asOwner()
    return count("select count(*) n from storage.objects where bucket_id = 'pin-photos' and name = $1", [path])
  }

  await test("Before the work is submitted, the uploader can remove a photo; the removal is on the timeline and the file can go", async () => {
    const pin = await newPin("Fresh work")
    const photo = await addPhoto(pin, "first-try")
    await as("fore1")
    await db.query("delete from public.pin_photos where id = $1", [photo.id])
    if ((await photoCount(pin)) !== 0) throw new Error("photo should be removed")
    await asOwner()
    if ((await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'photo_removed'", [pin])) !== 1) throw new Error("removal not on the timeline")
    await as("fore1")
    await db.query("delete from storage.objects where bucket_id = 'pin-photos' and name = $1", [photo.path])
    if ((await fileCount(photo.path)) !== 0) throw new Error("the unused file should be removable")
  })

  await test("The sheet history names the removal (0035) instead of calling it a checklist change", async () => {
    await as("eng1", "aal2")
    const summaries = (await db.query("select summary from public.get_sheet_history($1, 50)", [sheet])).rows.map((row) => row.summary)
    if (!summaries.some((text) => text === 'Removed a photo from pin "Fresh work"')) throw new Error("history: " + summaries.join(" | "))
    if (summaries.some((text) => /^Checklist of pin "Fresh work"/.test(text))) throw new Error("removal filed under checklist")
  })

  await test("While a photo record exists, its file cannot be deleted from storage (not even by the uploader)", async () => {
    const pin = await newPin("File guard")
    const photo = await addPhoto(pin, "kept")
    await as("fore1")
    await db.query("delete from storage.objects where bucket_id = 'pin-photos' and name = $1", [photo.path])
    if ((await fileCount(photo.path)) !== 1) throw new Error("file of a recorded photo was deleted")
  })

  await test("Once sent for review, the pin and its photos are evidence: nobody can delete them, admins included", async () => {
    const pin = await newPin("Column C4 pour")
    const photo = await addPhoto(pin, "poured")
    await setStatus(pin, "for_review")
    await as("fore1")
    await expectFail("delete from public.pin_photos where id = $1", [photo.id], /evidence/)
    await as("admin", "aal2")
    await expectFail("delete from public.pin_photos where id = $1", [photo.id], /evidence/)
    await as("eng1", "aal2")
    await expectFail("delete from public.pins where id = $1", [pin], /evidence/)
    if ((await photoCount(pin)) !== 1) throw new Error("photo must still exist")
    ids.evidencePin = pin
  })

  await test("The evidence check only answers about pins the caller may see (0037)", async () => {
    await as("fore1")
    if ((await db.query("select public.pin_has_evidence($1) e", [ids.evidencePin])).rows[0].e !== true) throw new Error("member should see true")
    await as("eng2")
    if ((await db.query("select public.pin_has_evidence($1) e", [ids.evidencePin])).rows[0].e !== false) throw new Error("outsider learned about another project")
    await asOwner()
    await db.query("select set_config('request.jwt.claims', '', false)") // an internal call (service role) has no signed-in user
    if ((await db.query("select public.pin_has_evidence($1) e", [ids.evidencePin])).rows[0].e !== true) throw new Error("internal check must still see it")
  })

  await test("Sending the work back does not unlock it: it was submitted once, so it stays evidence", async () => {
    await setStatus(ids.evidencePin, "in_progress")
    await as("fore1")
    await expectFail("delete from public.pin_photos where pin_id = $1", [ids.evidencePin], /evidence/)
  })

  await test("Verified then un-verified work stays locked (verified_at is cleared, the timeline is not)", async () => {
    const pin = await newPin("Beam B2")
    await addPhoto(pin, "beam")
    await setStatus(pin, "verified")
    await setStatus(pin, "issue")
    await asOwner()
    if ((await db.query("select verified_at from public.pins where id = $1", [pin])).rows[0].verified_at !== null) throw new Error("verified_at should be cleared")
    await as("eng1", "aal2")
    await expectFail("delete from public.pins where id = $1", [pin], /evidence/)
  })

  await test("New photos can still be added to evidence work, and each one is on the timeline", async () => {
    await addPhoto(ids.evidencePin, "after-fix")
    await asOwner()
    if ((await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'photo'", [ids.evidencePin])) !== 2) throw new Error("photo events missing")
  })

  await test("A sheet (or project) holding evidence cannot be deleted; a sheet with only fresh pins can", async () => {
    await as("admin", "aal2")
    await expectFail("delete from public.blueprints where id = $1", [sheet], /evidence/)
    await as("eng1", "aal2")
    const spare = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Spare plan') returning id", [P1])).rows[0].id
    const fresh = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 5, 5, 'Not started yet', $3) returning id", [P1, spare, ids.fore1])).rows[0].id
    await addPhoto(fresh, "draft")
    await as("admin", "aal2")
    await db.query("delete from public.blueprints where id = $1", [spare])
    await asOwner()
    if ((await count("select count(*) n from public.pins where id = $1", [fresh])) !== 0) throw new Error("the fresh sheet should be deleted with its pins")
  })

  await test("Live updates publish work/attendance only; account profiles, identity and audit are never published", async () => {
    await asOwner()
    const rows = (await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename")).rows.map((row) => row.tablename)
    // attendance_ignored_scans / attendance_unregistered_scans: live scan pop-ups on the attendance screen (20261027150000).
    const expected = ["attendance_ignored_scans", "attendance_unregistered_scans", "attendance_workers", "biometric_attendance_events", "biometric_daily_totals", "blueprint_revisions", "blueprints", "client_snags", "daily_report_photos", "daily_report_revisions", "daily_reports", "notifications", "pin_checklist_items", "pin_events", "pin_photos", "pins", "project_questions", "qa_defect_events", "qa_defects", "qa_inspection_events", "qa_inspection_items", "qa_inspections", "qa_photos", "qa_work_attempts", "site_issue_photo_revisions", "site_issue_photos", "site_issue_reports", "site_visit_requests"]
    if (JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error("published: " + rows.join(", "))
  })
}
