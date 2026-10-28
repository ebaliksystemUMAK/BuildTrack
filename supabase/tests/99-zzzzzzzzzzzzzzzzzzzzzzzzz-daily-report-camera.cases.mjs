import assert from "node:assert/strict"

export default async function ({ db, ids, as, asOwner, test, expectFail, addUser }) {
  await asOwner()
  for (const [key, role] of [["cameraFore", "foreman"], ["cameraEng", "engineer"], ["cameraClient", "client"], ["cameraOther", "foreman"]]) await addUser(key, role)
  const project = (await db.query("insert into public.projects(code,name) values ('REPORT-CAMERA','Camera report test') returning id")).rows[0].id
  const other = (await db.query("insert into public.projects(code,name) values ('REPORT-OTHER','Other headcount project') returning id")).rows[0].id
  for (const key of ["cameraFore", "cameraEng", "cameraClient"]) await db.query("insert into public.project_members(project_id,user_id) values ($1,$2)", [project, ids[key]])
  const workers = []
  for (let i = 0; i < 4; i++) workers.push((await db.query("insert into public.attendance_workers(project_id,worker_code,biometric_uid,full_name) values ($1,$2,$2,$3) returning id", [project, `CAM-${i}`, `Camera Worker ${i}`])).rows[0].id)
  const foreign = (await db.query("insert into public.attendance_workers(project_id,worker_code,biometric_uid,full_name) values ($1,'OTHER','other-camera','Other Worker') returning id", [other])).rows[0].id
  const day = (await db.query("select to_char((now() at time zone 'Asia/Manila')::date - 1,'YYYY-MM-DD') as report_day")).rows[0].report_day
  let sequence = 0
  const scan = (pid, worker, direction, time) => db.query("insert into public.biometric_attendance_events(project_id,worker_id,direction,occurred_at,device_id,external_event_id) values ($1,$2,$3,$4,'camera-test',$5)", [pid, worker, direction, time, `camera-event-${++sequence}`])
  await scan(project, workers[0], "in", `${day}T00:00:00+08:00`)
  await scan(project, workers[0], "out", `${day}T17:00:00+08:00`)
  await scan(project, workers[1], "in", `${day}T23:59:59+08:00`)
  await scan(project, workers[2], "out", `${day}T17:30:00+08:00`)
  await scan(other, foreign, "in", `${day}T08:00:00+08:00`)
  const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  await scan(project, workers[3], "in", `${nextDay}T00:00:00+08:00`)
  let report, photo
  const annotations = [{ id: "mark-1", kind: "arrow", x: 10, y: 10, x2: 60, y2: 60, color: "#ff0000", stroke: 4, fontSize: 30, text: "", points: [] }]

  await test("Report headcount: one accepted Time IN per worker and Manila day; Time OUT does not subtract", async () => {
    await as("cameraFore")
    const count = (await db.query("select public.daily_report_biometric_headcount($1,$2) n", [project, day])).rows[0].n
    assert.equal(count, 2, "Exclude other project, OUT-only and next-midnight events; include both day edges")
    report = (await db.query("insert into public.daily_reports(project_id,report_date,work_done,workers_count) values ($1,$2,'Completed north slab work',4999) returning *", [project, day])).rows[0]
    assert.equal(report.workers_count, 2); assert.equal(report.workers_source, "biometrics"); assert.ok(report.workers_synced_at)
  })
  await test("Report headcount: manual edits cannot forge count or biometric source metadata", async () => {
    await as("cameraFore")
    const row = (await db.query("update public.daily_reports set workers_count=40 where id=$1 returning workers_count", [report.id])).rows[0]
    assert.equal(row.workers_count, 2)
    await expectFail("update public.daily_reports set workers_source='manual' where id=$1", [report.id], /permission denied/)
    await expectFail("update public.daily_reports set workers_synced_at=null where id=$1", [report.id], /permission denied/)
    for (const who of ["cameraClient", "cameraOther"]) { await as(who); await expectFail("select public.daily_report_biometric_headcount($1,$2)", [project, day], /unavailable/) }
    await as(null); await expectFail("select public.daily_report_biometric_headcount($1,$2)", [project, day], /permission denied/)
  })
  await test("Report camera: new photos require camera metadata and a shutter timestamp", async () => {
    await as("cameraFore")
    const path = `${project}/${report.id}/capture.jpg`
    await expectFail("insert into public.daily_report_photos(project_id,report_id,path) values ($1,$2,$3)", [project, report.id, path], /camera/)
    await expectFail("insert into public.daily_report_photos(project_id,report_id,path,capture_source) values ($1,$2,$3,'camera')", [project, report.id, path], /camera/)
    await expectFail("insert into public.daily_report_photos(project_id,report_id,path,capture_source,taken_at,annotations) values ($1,$2,$3,'camera',now(),'[{\"kind\":\"script\"}]')", [project, report.id, path], /check/)
    photo = (await db.query("insert into public.daily_report_photos(project_id,report_id,path,capture_source,taken_at,annotations,caption) values ($1,$2,$3,'camera',now(),$4,'North slab') returning *", [project, report.id, path, JSON.stringify(annotations)])).rows[0]
    assert.deepEqual(photo.annotations, annotations); assert.equal(photo.capture_source, "camera"); assert.equal(photo.caption, "North slab")
    await expectFail("update public.daily_report_photos set annotations='[]' where id=$1", [photo.id], /permission denied/)
  })
  await test("Report submission snapshots current biometrics and annotated photo metadata together", async () => {
    await asOwner(); await scan(project, workers[2], "in", `${day}T09:00:00+08:00`)
    await as("cameraFore")
    const row = (await db.query("update public.daily_reports set status='submitted' where id=$1 returning *", [report.id])).rows[0]
    assert.equal(row.workers_count, 3)
    const revision = (await db.query("select snapshot,photos_snapshot from public.daily_report_revisions where report_id=$1 and revision=1", [report.id])).rows[0]
    assert.equal(revision.snapshot.workers_count, 3); assert.equal(revision.snapshot.workers_source, "biometrics")
    assert.deepEqual(revision.photos_snapshot[0].annotations, annotations); assert.equal(revision.photos_snapshot[0].capture_source, "camera")
  })
  await test("Submitted report headcount and evidence stay fixed across later scans and Engineer review", async () => {
    await asOwner(); await scan(project, workers[3], "in", `${day}T10:00:00+08:00`)
    await as("cameraEng")
    await db.query("select public.review_daily_report($1,true,'Reviewed this daily report')", [report.id])
    const row = (await db.query("select workers_count from public.daily_reports where id=$1", [report.id])).rows[0]
    assert.equal(row.workers_count, 3)
    assert.equal((await db.query("select public.daily_report_biometric_headcount($1,$2) n", [project, day])).rows[0].n, 4)
    await as("cameraFore")
    await expectFail("delete from public.daily_report_photos where id=$1", [photo.id], /submitted/)
  })
  await test("Returned report refreshes biometrics only when Foreman saves/resubmits; original revision retained", async () => {
    await as("cameraEng"); await db.query("select public.review_daily_report($1,false,'Please clarify north slab work')", [report.id])
    assert.equal((await db.query("select workers_count from public.daily_reports where id=$1", [report.id])).rows[0].workers_count, 3)
    await as("cameraFore")
    const row = (await db.query("update public.daily_reports set work_done='Clarified north slab work',status='submitted' where id=$1 returning *", [report.id])).rows[0]
    assert.equal(row.workers_count, 4)
    assert.equal((await db.query("select snapshot from public.daily_report_revisions where report_id=$1 and revision=1", [report.id])).rows[0].snapshot.workers_count, 3)
  })
}
