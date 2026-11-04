import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

// 20261104120000: task progress entries on the daily report. All data is local to the SQL harness.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  for (const [key, role] of [["dreFore", "foreman"], ["dreOther", "foreman"], ["dreEng", "engineer"], ["dreClient", "client"], ["dreOut", "foreman"], ["dreSuper", "super_admin"]]) await addUser(key, role)
  const project = (await db.query("insert into public.projects(code,name) values('DRE-1','Task entries') returning id")).rows[0].id
  const other = (await db.query("insert into public.projects(code,name) values('DRE-2','Other project') returning id")).rows[0].id
  for (const key of ["dreFore", "dreOther", "dreEng", "dreClient"]) await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [project, ids[key]])
  for (const key of ["dreFore", "dreEng"]) await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [other, ids[key]])
  const sheet = (await db.query("insert into public.blueprints(project_id,title,blueprint_type) values($1,'Ground floor','architectural') returning id", [project])).rows[0].id
  const otherSheet = (await db.query("insert into public.blueprints(project_id,title,blueprint_type) values($1,'Other plan','architectural') returning id", [other])).rows[0].id
  const addPin = async (title, foreman, pinProject = project, pinSheet = sheet) => (await db.query("insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to) values($1,$2,10,10,$3,$4) returning id", [pinProject, pinSheet, title, foreman])).rows[0].id
  const addItem = async (pin, text, itemProject = project) => (await db.query("insert into public.pin_checklist_items(project_id,pin_id,text) values($1,$2,$3) returning id", [itemProject, pin, text])).rows[0].id
  const laundry = await addPin("LAUNDRY", ids.dreFore)
  const floor = await addItem(laundry, "FLOOR")
  const wall = await addItem(laundry, "WALL")
  const bare = await addPin("No tasks yet", ids.dreFore)
  const elsewhere = await addPin("Someone else's", ids.dreOther)
  const elsewhereItem = await addItem(elsewhere, "ROOF")
  const foreign = await addPin("Other project", ids.dreFore, other, otherSheet)
  const foreignItem = await addItem(foreign, "DOOR", other)
  const entry = (pin_id, item_id, extra = {}) => ({ id: randomUUID(), pin_id, item_id, work_done: "Worked on this task", percent: 40, notes: "", issues: "", manpower: null, materials: "", ...extra })
  const save = async (status, entries, savedProject = project, work = "Tiling and formwork on site") =>
    (await db.query("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny',$2,$3,$4::jsonb) id", [savedProject, work, status, JSON.stringify(entries)])).rows[0].id
  const entriesOf = async (id) => (await db.query("select * from public.daily_report_entries where report_id=$1 order by position", [id])).rows
  const owned = async (id) => { await owner(); return entriesOf(id) }

  const first = entry(laundry, floor, { work_done: " Tiled the north side ", percent: 60, notes: "Poured the north side ", issues: "Short of grout", manpower: 5, materials: "12 bags cement" })
  const second = entry(bare, null, { percent: 25 })
  let report

  await test("Task entries: a Foreman saves several assigned tasks under one draft report; linked_work follows them", async () => {
    await as("dreFore")
    report = await save("draft", [first, second])
    assert.equal(await save("draft", [first, second]), report, "saving again keeps the same report")
    const rows = await entriesOf(report)
    assert.deepEqual(rows.map(row => [row.id, row.pin_id, row.item_id, row.percent, row.position]), [[first.id, laundry, floor, 60, 0], [second.id, bare, null, 25, 1]])
    assert.deepEqual([rows[0].work_done, rows[0].notes, rows[0].issues, rows[0].manpower, rows[0].materials], ["Tiled the north side", "Poured the north side", "Short of grout", 5, "12 bags cement"])
    const saved = (await db.query("select linked_work, status, author_id, work_done from public.daily_reports where id=$1", [report])).rows[0]
    assert.equal(saved.work_done, "LAUNDRY → FLOOR: Tiled the north side\nNo tasks yet: Worked on this task", "The report's summary is built from each task's work completed")
    assert.deepEqual(saved.linked_work, [{ pin_id: laundry, item_id: floor }, { pin_id: bare, item_id: null }])
    assert.equal(saved.status, "draft"); assert.equal(saved.author_id, ids.dreFore)
  })

  await test("Task entries: work must be assigned to the Foreman and belong to the project; the task must belong to its pin", async () => {
    await as("dreFore")
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify([entry(elsewhere, elsewhereItem)])], /assigned to you/)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify([entry(foreign, foreignItem)])], /belong to this project/)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify([entry(laundry, elsewhereItem)])], /checklist item of the linked/)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify([entry(laundry, null)])], /Choose the checklist item/)
    assert.equal((await entriesOf(report)).length, 2, "a refused save changes nothing")
  })

  await test("Task entries: percentage, manpower, duplicates, list size and unknown fields are checked", async () => {
    await as("dreFore")
    const refuse = (entries, pattern) => expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify(entries)], pattern)
    for (const percent of [-1, 101, 12.5]) await refuse([entry(laundry, floor, { percent })], /whole number from 0 to 100/)
    for (const manpower of [-1, 5001, 1.5]) await refuse([entry(laundry, floor, { manpower })], /whole number from 0 to 5000/)
    await refuse([entry(laundry, floor), entry(laundry, floor)], /already has an entry/)
    const twice = entry(laundry, floor); await refuse([twice, twice], /sent twice/)
    await refuse([entry(laundry, floor, { planned: 10 })], /keeps only/)
    await refuse(Array.from({ length: 101 }, () => entry(laundry, floor)), /at most 100/)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','published','[]'::jsonb)", [project], /draft or submit/)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny',$2,'draft','[]'::jsonb)", [project, "x".repeat(4001)], /work_done/)
  })

  await test("Task entries: an entry id of someone else's report cannot be taken over", async () => {
    await as("dreOther")
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify([{ ...entry(elsewhere, elsewhereItem), id: first.id }])], /another report/)
    assert.equal((await owned(report))[0].pin_id, laundry)
  })

  await test("Task entries: a draft may leave the percentage blank, but no route submits it blank", async () => {
    await as("dreFore")
    await save("draft", [{ ...first, percent: null }, second])
    assert.equal((await entriesOf(report))[0].percent, null)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','submitted',$2::jsonb)", [project, JSON.stringify([{ ...first, percent: null }, second])], /percentage completed for every task/)
    await expectFail("update public.daily_reports set status='submitted' where id=$1", [report], /percentage completed for every task/)
    assert.equal((await db.query("select status from public.daily_reports where id=$1", [report])).rows[0].status, "draft")
    await save("draft", [first, second])
  })

  await test("Task entries: every task needs its work completed before any route submits it, and the summary stays within its limit", async () => {
    await as("dreFore")
    await save("draft", [{ ...first, work_done: "" }, { ...second, work_done: "Done" }])
    assert.equal((await db.query("select work_done from public.daily_reports where id=$1", [report])).rows[0].work_done, "No tasks yet: Done", "A draft may leave a task's work for later")
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','submitted',$2::jsonb)", [project, JSON.stringify([{ ...first, work_done: "" }, second])], /work completed on every task/)
    await expectFail("update public.daily_reports set status='submitted' where id=$1", [report], /work completed on every task/)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify([{ ...first, work_done: "x".repeat(2001) }])], /work_done/)
    const long = "x".repeat(2000)
    await save("draft", [{ ...first, work_done: long }, { ...second, work_done: long }, entry(laundry, wall, { work_done: long })])
    assert.equal((await db.query("select char_length(work_done) n from public.daily_reports where id=$1", [report])).rows[0].n, 4000, "The report's summary is cut to fit")
    assert.equal((await entriesOf(report))[2].work_done.length, 2000, "Each entry keeps its full text")
    await save("draft", [first, second])
  })

  await test("Task entries: a report with no task text keeps the summary it was given", async () => {
    await as("dreOther")
    const plain = await save("draft", [], project, "A rain day, no work on site")
    assert.equal((await db.query("select work_done from public.daily_reports where id=$1", [plain])).rows[0].work_done, "A rain day, no work on site")
    const { work_done: _, ...queuedBeforeThisField } = entry(elsewhere, elsewhereItem)
    await save("draft", [queuedBeforeThisField], project, "Saved offline before tasks had their own box")
    assert.equal((await db.query("select work_done from public.daily_reports where id=$1", [plain])).rows[0].work_done, "Saved offline before tasks had their own box")
    await save("draft", [])
  })

  await test("Task entries: a draft's entries are private to the author", async () => {
    for (const key of ["dreOther", "dreEng", "dreClient", "dreOut"]) {
      await as(key)
      assert.equal(await count("select count(*) n from public.daily_report_entries where report_id=$1", [report]), 0, `${key} must not read a draft's entries`)
    }
  })

  await test("Task entries: entries are only written by save_daily_report", async () => {
    await as("dreFore")
    await expectFail("insert into public.daily_report_entries(report_id,project_id,pin_id,percent) values($1,$2,$3,50)", [report, project, laundry], /permission denied/)
    await expectFail("update public.daily_report_entries set percent=100 where id=$1", [first.id], /permission denied/)
    await expectFail("delete from public.daily_report_entries where id=$1", [first.id], /permission denied/)
  })

  await test("Task entries: Clients and outsiders cannot save reports or entries", async () => {
    for (const key of ["dreClient", "dreOut"]) {
      await as(key)
      await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft','[]'::jsonb)", [project], /not allowed/)
    }
    await as(null)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft','[]'::jsonb)", [project], /permission denied/)
  })

  let photo
  await test("Task entries: a photo attaches to an entry of its own report only", async () => {
    await as("dreOther")
    const otherReport = await save("draft", [entry(elsewhere, elsewhereItem)])
    const otherEntry = (await entriesOf(otherReport))[0].id
    await as("dreFore")
    const insert = "insert into public.daily_report_photos(report_id,project_id,path,taken_at,capture_source,entry_id) values($1,$2,$3,now(),'camera',$4) returning *"
    const path = name => `${project}/${report}/${name}.jpg`
    await expectFail(insert, [report, project, path("foreign"), otherEntry], /task entry of this report/)
    photo = (await db.query(insert, [report, project, path("task"), second.id])).rows[0]
    assert.equal(photo.entry_id, second.id)
    await owner(); await db.query("insert into storage.objects(bucket_id,name,owner) values('daily-photos',$1,$2)", [path("task"), ids.dreFore])
  })

  await test("Task entries: removing an entry keeps its photo on the report and drops the link to the task", async () => {
    await as("dreFore")
    await save("draft", [first])
    assert.deepEqual((await entriesOf(report)).map(row => row.id), [first.id])
    const kept = (await db.query("select report_id, entry_id from public.daily_report_photos where id=$1", [photo.id])).rows[0]
    assert.equal(kept.report_id, report); assert.equal(kept.entry_id, null)
    assert.deepEqual((await db.query("select linked_work from public.daily_reports where id=$1", [report])).rows[0].linked_work, [{ pin_id: laundry, item_id: floor }])
    await save("draft", [first, second])
  })

  await test("Task entries: submitting saves the entries, snapshots them and leaves task QA and official progress untouched", async () => {
    await as("dreFore")
    assert.equal(await save("submitted", [{ ...first, percent: 100 }, second]), report)
    await owner()
    const saved = (await db.query("select status, revision, submitted_at from public.daily_reports where id=$1", [report])).rows[0]
    assert.equal(saved.status, "submitted"); assert.equal(saved.revision, 1); assert.ok(saved.submitted_at)
    const revision = (await db.query("select snapshot, event from public.daily_report_revisions where report_id=$1", [report])).rows[0]
    assert.equal(revision.event, "submitted")
    assert.deepEqual(revision.snapshot.task_entries.map(row => [row.id, row.percent]), [[first.id, 100], [second.id, 25]])
    const task = (await db.query("select done, review_status from public.pin_checklist_items where id=$1", [floor])).rows[0]
    assert.deepEqual([task.done, task.review_status], [false, "not_submitted"], "a reported 100% does not complete the task")
    assert.notEqual((await db.query("select status from public.pins where id=$1", [laundry])).rows[0].status, "verified")
  })

  await test("Task entries: a submitted report cannot be saved again", async () => {
    await as("dreFore")
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft','[]'::jsonb)", [project], /submitted report cannot be edited/)
    assert.equal((await entriesOf(report)).length, 2)
  })

  await test("Task entries: the project team reads submitted entries; a Client reads the report but never its entries, by any route", async () => {
    for (const key of ["dreOther", "dreEng"]) {
      await as(key)
      assert.equal(await count("select count(*) n from public.daily_report_entries where report_id=$1", [report]), 2, `${key} reads the team's entries`)
    }
    await as("dreClient")
    assert.equal(await count("select count(*) n from public.daily_reports where id=$1", [report]), 1, "the client still reads the site log")
    assert.equal(await count("select count(*) n from public.daily_report_photos where report_id=$1", [report]), 1, "report photos stay as they were for clients")
    assert.equal(await count("select count(*) n from public.daily_report_entries"), 0)
    assert.equal(await count("select count(*) n from public.daily_report_revisions where report_id=$1", [report]), 0)
    const row = (await db.query("select to_jsonb(r) r from public.daily_reports r where id=$1", [report])).rows[0].r
    assert.deepEqual(row.linked_work, [{ pin_id: laundry, item_id: floor }, { pin_id: bare, item_id: null }], "the report row holds links only")
    assert.ok(!JSON.stringify(row).includes("Short of grout"), "issues never reach the report row")
    assert.match(row.work_done, /LAUNDRY → FLOOR: Tiled the north side/, "the client reads the work completed in the site log")
    await as("dreOut")
    assert.equal(await count("select count(*) n from public.daily_report_entries"), 0)
  })

  await test("Task entries: a returned report can be corrected even after its work was reassigned, without adding other unassigned work", async () => {
    await as("dreEng")
    await db.query("select public.review_daily_report($1,false,'Please correct the percentage')", [report])
    await owner(); await db.query("update public.pins set assigned_to=$1 where id=$2", [ids.dreOther, laundry])
    await as("dreEng")
    assert.equal(await count("select count(*) n from public.daily_report_entries where report_id=$1", [report]), 2, "staff follow a returned report")
    await as("dreFore")
    await save("draft", [{ ...first, percent: 80 }, second])
    assert.equal((await entriesOf(report))[0].percent, 80)
    await expectFail("select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Work today','draft',$2::jsonb)", [project, JSON.stringify([first, second, entry(elsewhere, elsewhereItem)])], /assigned to you/)
    await save("submitted", [{ ...first, percent: 80 }, second])
    await owner()
    assert.deepEqual((await db.query("select revision, event from public.daily_report_revisions where report_id=$1 order by created_at, revision", [report])).rows.map(row => [row.revision, row.event]), [[1, "submitted"], [1, "returned"], [2, "submitted"]])
    await db.query("update public.pins set assigned_to=$1 where id=$2", [ids.dreFore, laundry])
  })

  let older
  await test("Task entries: older links keep working, and a link already on a draft can become an entry", async () => {
    await owner(); await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [project, ids.dreOut])
    await as("dreOut")
    older = (await db.query("insert into public.daily_reports(project_id,report_date,work_done,linked_work) values($1,(now() at time zone 'Asia/Manila')::date,'Older draft',$2::jsonb) returning id", [project, JSON.stringify([{ pin_id: elsewhere, item_id: elsewhereItem }])])).rows[0].id
    assert.equal(await save("draft", [entry(elsewhere, elsewhereItem, { percent: null })]), older)
    await db.query("update public.daily_reports set linked_work=$2::jsonb where id=$1", [older, JSON.stringify([{ pin_id: elsewhere, item_id: elsewhereItem }])])
    assert.equal((await entriesOf(older)).length, 1)
  })

  await test("Task entries: a removed report hides its entries and a pin with an entry stays protected", async () => {
    await as("dreSuper", "aal2")
    const { label } = (await db.query("select public.preview_record_removal('daily_report', $1) p", [older])).rows[0].p
    await db.query("select public.remove_record('daily_report', $1, 'Entered by mistake', $2)", [older, "REMOVE " + label])
    await as("dreOut")
    assert.equal(await count("select count(*) n from public.daily_report_entries where report_id=$1", [older]), 0)
    await as("dreSuper", "aal2")
    await db.query("select public.restore_record('daily_report', $1)", [older])
    await as("dreOut")
    assert.equal(await count("select count(*) n from public.daily_report_entries where report_id=$1", [older]), 1)
    await owner()
    await expectFail("delete from public.pins where id=$1", [bare], /violates foreign key|cannot be deleted|records/i)
  })

  await test("Task entries: deleting a draft takes its entries and photos with it", async () => {
    await as("dreOut")
    const [{ id: entryId }] = await entriesOf(older)
    await db.query("insert into public.daily_report_photos(report_id,project_id,path,taken_at,capture_source,entry_id) values($1,$2,$3,now(),'camera',$4)", [older, project, `${project}/${older}/draft.jpg`, entryId])
    assert.equal((await db.query("delete from public.daily_reports where id=$1 returning id", [older])).rows.length, 1)
    await owner()
    assert.equal(await count("select count(*) n from public.daily_report_entries where report_id=$1", [older]), 0)
    assert.equal(await count("select count(*) n from public.daily_report_photos where report_id=$1", [older]), 0)
  })

  await test("Task entries: maintenance pauses the save and guards the table itself", async () => {
    await owner()
    assert.equal(await count("select count(*) n from pg_trigger where tgrelid='public.daily_report_entries'::regclass and tgname='zz_site_guard'"), 1)
    await as("dreSuper", "aal2"); await db.query("select public.set_maintenance(true, 'Upgrading the database.', null)")
    await as("dreOther")
    await assert.rejects(save("draft", []), error => error.code === "BT503", "the code the offline queue recognises")
    await as("dreSuper", "aal2"); await db.query("select public.set_maintenance(false, 'Upgrading the database.', null)")
  })

  await test("Task entries: deleting a project with only draft reports clears its entries despite the pin reference", async () => {
    await as("dreFore")
    await save("draft", [entry(foreign, foreignItem)], other)
    await owner()
    assert.equal(await count("select count(*) n from public.daily_report_entries where project_id=$1", [other]), 1)
    await db.query("delete from public.projects where id=$1", [other])
    assert.equal(await count("select count(*) n from public.daily_report_entries where project_id=$1", [other]), 0)
  })
}
