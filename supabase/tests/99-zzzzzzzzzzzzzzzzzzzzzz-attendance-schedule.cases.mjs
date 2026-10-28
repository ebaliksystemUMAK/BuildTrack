import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

// 20261027130000_attendance_schedule_scans: Admin schedule per project; the database decides IN/OUT, ignores repeat and
// out-of-order scans, and flags late / early out against the schedule.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  await asOwner()
  await addUser("schedAdmin", "admin")
  await addUser("schedFore", "foreman")
  await addUser("schedClient", "client")
  await db.query("insert into public.admin_permissions(user_id,permission) values($1,'biometrics.manage') on conflict do nothing", [ids.schedAdmin])
  const project = (await db.query("insert into public.projects(code,name) values('SCHED-1','Schedule test') returning id")).rows[0].id
  const bare = (await db.query("insert into public.projects(code,name) values('SCHED-2','No schedule test') returning id")).rows[0].id
  for (const who of ["schedFore", "schedClient"]) await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [project, ids[who]])
  const device = randomUUID(), otherDevice = randomUUID(), bareDevice = randomUUID(), hash = "e".repeat(64)
  for (const [id, site] of [[device, project], [otherDevice, project], [bareDevice, bare]]) await db.query("insert into public.attendance_devices(id,project_id,label,token_sha256) values($1,$2,'Gate',$3)", [id, site, hash])
  const ana = randomUUID(), ben = randomUUID(), cy = randomUUID()
  for (const [id, site, uid, code] of [[ana, project, "11", "S-1"], [ben, project, "12", "S-2"], [cy, bare, "11", "S-3"]])
    await db.query("insert into public.attendance_workers(id,project_id,worker_code,biometric_uid,full_name) values($1,$2,$3,$4,'Site Worker')", [id, site, code, uid])

  const admin = () => as("schedAdmin", "aal2")
  const service = async () => { await asOwner(); await db.exec("set role service_role") }
  // Manila time on 2026-03-02 (UTC+8).
  const at = (hhmm, day = "2026-03-02") => `${day}T${hhmm}:00+08:00`
  let n = 0
  const scan = async (time, { uid = "11", reader = device, event = `ev-${++n}` } = {}) => {
    await service()
    return { event, ...(await db.query("select public.ingest_biometric_scan($1,$2,$3,$4,$5) r", [reader, hash, uid, time, event])).rows[0].r }
  }
  const rows = async (worker) => { await asOwner(); return (await db.query("select direction,schedule_flag,minutes_off,occurred_at from public.biometric_attendance_events where worker_id=$1 order by occurred_at", [worker])).rows }

  await test("Attendance schedule: only Admins with biometrics.manage + MFA set it; values are checked; staff on the project read it", async () => {
    await admin()
    const saved = (await db.query("select * from public.set_attendance_schedule($1,'08:00:45','17:00',15,15)", [project])).rows[0]
    assert.equal(saved.time_in, "08:00:00", "Seconds are dropped"); assert.equal(saved.updated_by, ids.schedAdmin)
    await expectFail("select public.set_attendance_schedule($1,'17:00','08:00',15,15)", [project], /later than time in/)
    await expectFail("select public.set_attendance_schedule($1,'08:00','08:00:30',15,15)", [project], /later than time in/)
    await expectFail("select public.set_attendance_schedule($1,'08:00','17:00',121,15)", [project], /Grace/)
    await expectFail("select public.set_attendance_schedule($1,'08:00','17:00',15,0)", [project], /Repeat-scan/)
    await expectFail("insert into public.attendance_schedules(project_id,time_in,time_out) values($1,'06:00','07:00')", [bare], /permission denied/)
    for (const [who, aal] of [["schedFore", "aal2"], ["schedClient", "aal2"], ["eng1", "aal2"], ["schedAdmin", "aal1"]]) {
      await as(who, aal)
      await expectFail("select public.set_attendance_schedule($1,'07:00','16:00',10,10)", [project], /Admin biometric/)
    }
    await as("schedFore")
    assert.equal((await db.query("select time_out from public.attendance_schedules where project_id=$1", [project])).rows[0].time_out, "17:00:00")
    await as("schedClient")
    assert.equal((await db.query("select 1 from public.attendance_schedules")).rows.length, 0, "Clients never read schedules")
    await asOwner()
    assert.equal((await db.query("select count(*)::int n from public.audit_log where action like 'attendance_schedules.%'")).rows[0].n, 1, "Changes are audited")
  })

  await test("Attendance scans: the database decides IN/OUT; repeat scans inside the window are ignored, never a second IN", async () => {
    const first = await scan(at("07:55"))
    assert.equal(first.status, "recorded"); assert.equal(first.direction, "in"); assert.equal(first.schedule_flag, "on_time")
    const repeat = await scan(at("07:56"))
    assert.equal(repeat.status, "repeat"); assert.equal(repeat.event_id, first.event_id, "Points at the scan that counted"); assert.equal(repeat.direction, "in")
    assert.equal((await scan(at("08:09"))).status, "repeat", "Still inside 15 minutes")
    assert.deepEqual((await rows(ana)).map((r) => r.direction), ["in"])
    await asOwner()
    assert.deepEqual((await db.query("select reason from public.attendance_ignored_scans where worker_id=$1 order by occurred_at", [ana])).rows.map((r) => r.reason), ["repeat", "repeat"])

    const lunchOut = await scan(at("12:00"))
    assert.equal(lunchOut.direction, "out"); assert.equal(lunchOut.schedule_flag, "early_out"); assert.equal(lunchOut.minutes_off, 300)
    // Since 20261028010000: one Time IN and one Time OUT per day; later scans are "already timed out".
    const back = await scan(at("13:00"))
    assert.equal(back.status, "repeat"); assert.equal(back.direction, "out"); assert.equal(back.event_id, lunchOut.event_id)
    assert.equal((await scan(at("17:05"))).status, "repeat")
    const older = await scan(at("11:00"))
    assert.equal(older.status, "out_of_order"); assert.equal(older.event_id, lunchOut.event_id)
    assert.deepEqual((await rows(ana)).map((r) => r.direction), ["in", "out"])
  })

  await test("Attendance scans: retries of the same event get the same answer; reused event IDs with other details fail", async () => {
    const first = await scan(at("08:20", "2026-03-03"), { uid: "12", event: "retry-1" })
    assert.equal(first.schedule_flag, "late"); assert.equal(first.minutes_off, 20, "Late counts from 08:00, past the 15-minute grace")
    assert.deepEqual(await scan(at("08:20", "2026-03-03"), { uid: "12", event: "retry-1" }), first)
    const ignored = await scan(at("08:21", "2026-03-03"), { uid: "12", event: "retry-2" })
    assert.deepEqual(await scan(at("08:21", "2026-03-03"), { uid: "12", event: "retry-2" }), ignored)
    await service()
    await expectFail("select public.ingest_biometric_scan($1,$2,'12',$3,'retry-1')", [device, hash, at("09:00", "2026-03-03")], /different scan details/)
    await expectFail("select public.ingest_biometric_scan($1,$2,'12',$3,'retry-2')", [device, hash, at("09:00", "2026-03-03")], /different scan details/)
    const onTime = await scan(at("08:15", "2026-03-04"), { uid: "12" })
    assert.equal(onTime.schedule_flag, "on_time", "Exactly at the end of the grace period is on time")
    const nextDay = await scan(at("06:00", "2026-03-05"), { uid: "12" })
    assert.equal(nextDay.direction, "in", "Each Manila day starts with IN even without a clock-out"); assert.equal(nextDay.schedule_flag, "on_time")
  })

  await test("Attendance scans: the old switch value is ignored; no schedule means no late flag; the window is the Admin's", async () => {
    await service()
    const legacy = (await db.query("select public.record_biometric_attendance($1,'11','out',$2,'old-gate','legacy-1') id", [bare, at("09:00")])).rows[0].id
    await asOwner()
    const row = (await db.query("select direction,schedule_flag from public.biometric_attendance_events where id=$1", [legacy])).rows[0]
    assert.deepEqual(row, { direction: "in", schedule_flag: "no_schedule" }, "A scanner switch left on OUT cannot record the first scan as OUT")
    await service()
    await expectFail("select public.record_biometric_attendance($1,'11','toggle',$2,'old-gate','legacy-2')", [bare, at("09:30")], /Direction/)
    assert.equal((await db.query("select public.record_biometric_attendance($1,'11','in',$2,'old-gate','legacy-3') id", [bare, at("09:05")])).rows[0].id, legacy, "Repeat via the old entry point returns the counted scan")

    await admin(); await db.query("select public.set_attendance_schedule($1,'08:00','17:00',5,2)", [bare])
    assert.equal((await scan(at("09:08"), { reader: bareDevice })).direction, "out", "A 2-minute window lets an OUT through after 8 minutes")
  })

  await test("Attendance scans: device credentials, enrolled device, rate limit and access to the new entry point", async () => {
    await service()
    await expectFail("select public.ingest_biometric_scan($1,$2,'11',$3,'bad-token')", [device, "f".repeat(64), at("10:00", "2026-03-06")], /Invalid or revoked/)
    // Since 20261027150000 an unlinked slot is answered (and logged), not refused: see the scan-notices cases.
    assert.equal((await db.query("select public.ingest_biometric_scan($1,$2,'99',$3,'not-linked') r", [device, hash, at("10:00", "2026-03-06")])).rows[0].r.reason, "not_linked")
    await asOwner(); await db.query("update public.attendance_workers set enrolled_device_id=$1 where id=$2", [device, ben])
    await service()
    assert.equal((await db.query("select public.ingest_biometric_scan($1,$2,'12',$3,'wrong-gate') r", [otherDevice, hash, at("10:00", "2026-03-06")])).rows[0].r.reason, "other_device", "Never counted on a scanner that does not hold the template")
    await asOwner()
    await db.query("insert into public.attendance_ignored_scans(project_id,worker_id,device_id,external_event_id,occurred_at,reason,kept_event_id,received_at) select $1,$2,$3,'flood-'||g,now()-interval '1 day','repeat',(select id from public.biometric_attendance_events where worker_id=$2 limit 1),clock_timestamp() from generate_series(1,120) g", [project, ana, otherDevice])
    await service()
    await expectFail("select public.ingest_biometric_scan($1,$2,'11',$3,'one-more')", [otherDevice, hash, at("10:00", "2026-03-06")], /rate limit/)
    for (const who of ["schedAdmin", "schedFore"]) {
      await as(who, "aal2")
      await expectFail("select public.ingest_biometric_scan($1,$2,'11',$3,'web')", [device, hash, at("10:00", "2026-03-06")], /permission denied/)
      await expectFail("select public.record_biometric_scan($1,'11',$2,'web','web')", [project, at("10:00", "2026-03-06")], /permission denied/)
      await expectFail("insert into public.attendance_ignored_scans(project_id,worker_id,device_id,external_event_id,occurred_at,reason,kept_event_id) select $1,$2,'x','x',now(),'repeat',id from public.biometric_attendance_events limit 1", [project, ana], /permission denied/)
    }
  })

  await test("Attendance scans: day summary counts late arrivals and ignored scans; ignored scans are visible to project staff only", async () => {
    await as("schedFore")
    const summary = (await db.query("select public.attendance_day_summary($1,'2026-03-02') s", [project])).rows[0].s
    assert.deepEqual(summary, { scans: 2, workers: 1, clocked_in: 0, clocked_out: 1, on_time: 1, late: 0, absent: 0, not_in_yet: 0, ignored: 5 })
    assert.equal((await db.query("select public.attendance_day_summary($1,'2026-03-03') s", [project])).rows[0].s.late, 1)
    assert.ok((await db.query("select 1 from public.attendance_ignored_scans where project_id=$1", [project])).rows.length >= 3)
    await as("schedClient")
    assert.equal((await db.query("select 1 from public.attendance_ignored_scans")).rows.length, 0)
  })
}
