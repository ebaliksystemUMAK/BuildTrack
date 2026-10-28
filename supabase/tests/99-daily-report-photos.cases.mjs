// 0041: daily-report evidence and storage policies. All data is local to the SQL harness.
export default async function ({ db, ids, as, asOwner, test, expectFail, count, addUser }) {
  await asOwner()
  for (const [key, role] of [["dailyF", "foreman"], ["dailyOther", "foreman"], ["dailyEng", "engineer"], ["dailyClient", "client"], ["dailyOut", "foreman"]]) await addUser(key, role)
  const project = (await db.query("insert into public.projects(code,name) values ('DAILY-PHOTO','Daily photo test') returning id")).rows[0].id
  for (const key of ["dailyF", "dailyOther", "dailyEng", "dailyClient"]) await db.query("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids[key]])
  await as("dailyF")
  const report = (await db.query("insert into public.daily_reports(project_id,report_date,work_done) values ($1,(now() at time zone 'Asia/Manila')::date,'Site work complete') returning id", [project])).rows[0].id
  const path = (name) => `${project}/${report}/${name}.jpg`
  const insert = "insert into public.daily_report_photos(report_id,project_id,path,taken_at,capture_source) values ($1,$2,$3,now(),'camera') returning *"
  let photo
  await test("Daily photos: author uploads into draft folder and DB stamps/derives identity", async () => {
    await as("dailyF")
    await db.query("insert into storage.objects(bucket_id,name,owner) values ('daily-photos',$1,$2)", [path("first"), ids.dailyF])
    // Supplied project is not trusted; the trigger derives the real project.
    photo = (await db.query(insert, [report, ids.p1, path("first")])).rows[0]
    if (photo.project_id !== project || photo.uploaded_by !== ids.dailyF || photo.stamp_flag !== "no_location") throw new Error("bad derived fields")
    await asOwner()
    if (!(await count("select count(*) n from public.audit_log where action = 'daily_report_photos.insert' and details->'row'->>'id' = $1", [photo.id]))) throw new Error("missing audit")
  })
  await test("Daily photos: other foreman, engineer, client and outsider cannot add to this report or its storage folder", async () => {
    for (const key of ["dailyOther", "dailyEng", "dailyClient", "dailyOut"]) {
      await as(key)
      await expectFail(insert, [report, project, path(key)], /author/)
      await expectFail("insert into storage.objects(bucket_id,name,owner) values ('daily-photos',$1,$2)", [path(key), ids[key]], /row-level security/)
    }
  })
  await test("Daily photos: draft photo rows and files are private to the author", async () => {
    for (const key of ["dailyOther", "dailyEng", "dailyClient", "dailyOut"]) {
      await as(key)
      if (await count("select count(*) n from public.daily_report_photos where report_id=$1", [report])) throw new Error("draft leaked")
      if (await count("select count(*) n from storage.objects where bucket_id='daily-photos' and name=$1", [path("first")])) throw new Error("draft file leaked")
    }
  })
  await test("Daily photos: wrong folder, nested path and incomplete GPS are rejected", async () => {
    await as("dailyF")
    for (const wrong of [`${ids.p1}/${report}/wrong.jpg`, `${project}/${ids.p1}/wrong.jpg`, `${project}/${report}/nested/wrong.jpg`, `${project}/${report}/..`]) await expectFail(insert, [report, project, wrong], /folder/)
    await expectFail("insert into public.daily_report_photos(report_id,path,lat,taken_at,capture_source) values ($1,$2,10,now(),'camera')", [report, path("gps")], /position_both/)
    await expectFail("insert into storage.objects(bucket_id,name,owner) values ('daily-photos',$1,$2)", [`${project}/${ids.p1}/bad.jpg`, ids.dailyF], /row-level security/)
  })
  await test("Daily photos: browser cannot spoof stamps, uploader, timestamps or update a photo", async () => {
    await as("dailyF")
    for (const field of ["stamp_flag", "distance_m", "uploaded_by", "created_at"]) await expectFail(`insert into public.daily_report_photos(report_id,path,${field}) values ($1,$2,null)`, [report, path(field)], /permission denied/)
    await expectFail("update public.daily_report_photos set caption='edited' where id=$1", [photo.id], /permission denied/)
  })
  await test("Daily photos: storage file cannot be removed while its row exists", async () => {
    await as("dailyF")
    await db.query("delete from storage.objects where bucket_id='daily-photos' and name=$1", [path("first")])
    if ((await count("select count(*) n from storage.objects where bucket_id='daily-photos' and name=$1", [path("first")])) !== 1) throw new Error("file deleted while referenced")
  })
  await test("Daily photos: submitted photos are readable by project readers, not outsiders", async () => {
    await as("dailyF")
    await db.query("update public.daily_reports set status='submitted' where id=$1", [report])
    for (const key of ["dailyOther", "dailyEng", "dailyClient"]) {
      await as(key)
      if ((await count("select count(*) n from public.daily_report_photos where report_id=$1", [report])) !== 1) throw new Error("submitted photo unreadable")
      if ((await count("select count(*) n from storage.objects where bucket_id='daily-photos' and name=$1", [path("first")])) !== 1) throw new Error("submitted file unreadable")
    }
    await as("dailyOut")
    if (await count("select count(*) n from public.daily_report_photos where report_id=$1", [report])) throw new Error("project leaked")
  })
  await test("Daily photos: submitted report refuses upload and direct deletion, even owner deletion", async () => {
    await as("dailyF")
    await expectFail(insert, [report, project, path("submitted")], /draft report/)
    await expectFail("delete from public.daily_report_photos where id=$1", [photo.id], /submitted report/)
    await expectFail("insert into storage.objects(bucket_id,name,owner) values ('daily-photos',$1,$2)", [path("submitted"), ids.dailyF], /row-level security/)
    await asOwner()
    await expectFail("delete from public.daily_report_photos where id=$1", [photo.id], /submitted report/)
  })
  await test("Daily photos: reopening preserves submitted evidence; newly added draft photos can be removed", async () => {
    await as("dailyEng")
    await db.query("select public.reopen_daily_report($1)", [report])
    await as("dailyClient")
    if (await count("select count(*) n from public.daily_report_photos where report_id=$1", [report])) throw new Error("reopened draft leaked")
    await as("dailyF")
    await db.query(insert, [report, project, path("reopened")])
    await expectFail("delete from public.daily_report_photos where id=$1", [photo.id], /submitted report revisions/)
    await db.query("delete from public.daily_report_photos where path=$1", [path("reopened")])
    await db.query("delete from storage.objects where bucket_id='daily-photos' and name=$1", [path("first")])
    if (!(await count("select count(*) n from storage.objects where bucket_id='daily-photos' and name=$1", [path("first")]))) throw new Error("submitted revision file was removed")
  })
  await test("Daily photos: fifty allowed, fifty-first refused (also within a multi-row statement)", async () => {
    await as("dailyF")
    for (let i = 1; i < 50; i++) await db.query(insert, [report, project, path(`limit-${i}`)])
    await expectFail(insert, [report, project, path("fifty-one")], /at most 50/)
    await db.query("delete from public.daily_report_photos where path=$1", [path("limit-49")])
    await expectFail("insert into public.daily_report_photos(report_id,path,taken_at,capture_source) values ($1,$2,now(),'camera'),($1,$3,now(),'camera')", [report, path("bulk-a"), path("bulk-b")], /at most 50/)
    if ((await count("select count(*) n from public.daily_report_photos where report_id=$1", [report])) !== 49) throw new Error("multi-insert not rolled back")
  })
  await test("Daily photos: deleting a whole draft cascades its photos", async () => {
    await as("dailyF")
    await expectFail("delete from public.daily_reports where id=$1", [report], /submitted revisions/)
    const fresh = (await db.query("insert into public.daily_reports(project_id,report_date) values($1,(now() at time zone 'Asia/Manila')::date - 1) returning id", [project])).rows[0].id
    await db.query(insert, [fresh, project, `${project}/${fresh}/draft.jpg`])
    await db.query("delete from public.daily_reports where id=$1", [fresh])
    await asOwner()
    if (await count("select count(*) n from public.daily_report_photos where report_id=$1", [fresh])) throw new Error("draft cascade failed")
  })
  await test("Daily photos: private bucket limits and definer privileges are locked down", async () => {
    await asOwner()
    const b = (await db.query("select * from storage.buckets where id='daily-photos'")).rows[0]
    if (b.public || Number(b.file_size_limit) !== 8388608 || b.allowed_mime_types.length !== 3) throw new Error("bucket settings wrong")
    const p = (await db.query("select has_function_privilege('authenticated','public.prepare_daily_report_photo()','execute') a, has_function_privilege('anon','public.daily_photo_in_use(text)','execute') b")).rows[0]
    if (p.a || p.b) throw new Error("definer exposed")
  })
}
