import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

// 20261028010000_attendance_daily_status: one Time IN + one Time OUT per day, working days, and daily status
// (on time / late / absent / not in yet / rest day / not enrolled). 2026-03-02 is a Monday.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  await asOwner()
  await addUser("dtrAdmin", "admin")
  await addUser("dtrFore", "foreman")
  await addUser("dtrClient", "client")
  await db.query("insert into public.admin_permissions(user_id,permission) values($1,'biometrics.manage') on conflict do nothing", [ids.dtrAdmin])
  const project = (await db.query("insert into public.projects(code,name) values('DTR-1','Daily record test') returning id")).rows[0].id
  for (const who of ["dtrFore", "dtrClient"]) await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [project, ids[who]])
  const device = randomUUID(), hash = "7".repeat(64)
  await db.query("insert into public.attendance_devices(id,project_id,label,token_sha256) values($1,$2,'Gate',$3)", [device, project, hash])
  const ana = randomUUID(), ben = randomUUID(), cy = randomUUID(), dee = randomUUID()
  for (const [id, uid, code, name, created, active] of [
    [ana, "31", "D-1", "Ana", "2026-03-01T00:00:00+08:00", true],
    [ben, null, "D-2", "Ben", "2026-03-01T00:00:00+08:00", true],
    [cy, "33", "D-3", "Cy", "2026-03-04T10:00:00+08:00", true],
    [dee, "34", "D-4", "Dee", "2026-03-01T00:00:00+08:00", false],
  ]) await db.query("insert into public.attendance_workers(id,project_id,worker_code,biometric_uid,full_name,created_at,active) values($1,$2,$3,$4,$5,$6,$7)", [id, project, code, uid, name, created, active])
  const admin = () => as("dtrAdmin", "aal2")
  const at = (day, hhmm) => `2026-03-${day}T${hhmm}:00+08:00`
  let n = 0
  const scan = async (uid, time) => { await asOwner(); await db.exec("set role service_role"); return (await db.query("select public.ingest_biometric_scan($1,$2,$3,$4,$5) r", [device, hash, uid, time, `dtr-${++n}`])).rows[0].r }
  const status = async (from, to, who = "dtrFore") => { await as(who); return (await db.query("select * from public.attendance_daily_status($1,$2,$3)", [project, from, to])).rows }

  await test("Daily record: Admin sets working days; empty or invalid days are refused; older 5-argument calls keep Monday to Saturday", async () => {
    await admin()
    const saved = (await db.query("select * from public.set_attendance_schedule($1,'08:00','17:00',15,10,'{5,1,2,3,4,1}')", [project])).rows[0]
    assert.deepEqual(saved.work_days, [1, 2, 3, 4, 5], "Sorted, without duplicates")
    await expectFail("select public.set_attendance_schedule($1,'08:00','17:00',15,10,'{}')", [project], /working day/)
    await expectFail("select public.set_attendance_schedule($1,'08:00','17:00',15,10,'{0,8}')", [project], /working day/)
    await expectFail("select public.set_attendance_schedule($1,'08:00','17:00',15,10,null)", [project], /working day/)
    const other = (await db.query("insert into public.projects(code,name) values('DTR-2','Five-argument call') returning id")).rows[0].id
    await admin()
    assert.deepEqual((await db.query("select work_days from public.set_attendance_schedule($1,'07:00','16:00',5,5)", [other])).rows[0].work_days, [1, 2, 3, 4, 5, 6])
    await as("dtrFore", "aal2")
    await expectFail("select public.set_attendance_schedule($1,'08:00','17:00',15,10,'{1}')", [project], /Admin biometric/)
  })

  await test("Daily record: one Time IN and one Time OUT per day; any later scan is 'already timed out'; the next day starts with IN", async () => {
    assert.equal((await scan("31", at("02", "07:58"))).direction, "in")
    assert.equal((await scan("31", at("02", "08:03"))).status, "repeat", "Inside the 10-minute window")
    const out = await scan("31", at("02", "16:30"))
    assert.deepEqual([out.direction, out.schedule_flag, out.minutes_off], ["out", "early_out", 30])
    const after = await scan("31", at("02", "17:10"))
    assert.deepEqual([after.status, after.direction, after.event_id], ["repeat", "out", out.event_id], "Already timed out: nothing new")
    const late = await scan("31", at("03", "08:40"))
    assert.deepEqual([late.direction, late.schedule_flag, late.minutes_off], ["in", "late", 40])
    await asOwner()
    assert.equal((await db.query("select count(*)::int n from public.biometric_attendance_events where worker_id=$1", [ana])).rows[0].n, 3)
  })

  await test("Daily record: on time / late / absent / rest day / not enrolled per worker and day; inactive and not-yet-registered workers are left out", async () => {
    await scan("33", at("05", "07:50"))
    const rows = await status("2026-03-02", "2026-03-08")
    const of = (name) => rows.filter((r) => r.full_name === name).map((r) => [r.day.toISOString?.().slice(0, 10) ?? String(r.day).slice(0, 10), r.status, r.late_minutes, r.early_minutes])
    assert.deepEqual(of("Ana"), [
      ["2026-03-02", "on_time", null, 30], ["2026-03-03", "late", 40, null], ["2026-03-04", "absent", null, null], ["2026-03-05", "absent", null, null],
      ["2026-03-06", "absent", null, null], ["2026-03-07", "rest_day", null, null], ["2026-03-08", "rest_day", null, null],
    ])
    assert.ok(of("Ben").every(([, s]) => s === "not_enrolled"), "No fingerprint: never absent")
    assert.deepEqual(of("Cy").map(([d, s]) => [d, s]), [["2026-03-04", "absent"], ["2026-03-05", "on_time"], ["2026-03-06", "absent"], ["2026-03-07", "rest_day"], ["2026-03-08", "rest_day"]], "Nothing before the worker was registered")
    assert.deepEqual(of("Dee"), [], "Inactive workers without scans are not marked absent")
    const ana2 = rows.find((r) => r.full_name === "Ana")
    assert.ok(ana2.time_in && ana2.time_out, "Time in and time out of the day")
  })

  await test("Daily record: today is 'not in yet' until time out; future days and ranges over 63 days are refused or cut", async () => {
    const manila = new Date(Date.now() + 8 * 3600_000).toISOString()
    const today = manila.slice(0, 10), minutes = Number(manila.slice(11, 13)) * 60 + Number(manila.slice(14, 16))
    await admin(); await db.query("select public.set_attendance_schedule($1,'00:00','23:59',15,10,'{1,2,3,4,5,6,7}')", [project])
    const todays = (await status(today, today)).filter((r) => r.full_name === "Cy")
    assert.equal(todays.length, 1)
    assert.equal(todays[0].status, minutes < 23 * 60 + 59 ? "not_in_yet" : "absent")
    const future = new Date(Date.parse(today) + 3 * 86400_000).toISOString().slice(0, 10)
    assert.ok((await status(today, future)).every((r) => String(r.day.toISOString?.() ?? r.day).slice(0, 10) <= today), "Never after today")
    await as("dtrFore")
    await expectFail("select * from public.attendance_daily_status($1,'2026-01-01','2026-03-31')", [project], /63 days/)
    await expectFail("select * from public.attendance_daily_status($1,'2026-03-05','2026-03-01')", [project], /63 days/)
  })

  await test("Daily record: day summary counts on time, late and absent; clients and outsiders see no daily status", async () => {
    await admin(); await db.query("select public.set_attendance_schedule($1,'08:00','17:00',15,10,'{1,2,3,4,5}')", [project])
    await as("dtrFore")
    assert.deepEqual((await db.query("select public.attendance_day_summary($1,'2026-03-03') s", [project])).rows[0].s,
      { scans: 1, workers: 1, clocked_in: 1, clocked_out: 0, on_time: 0, late: 1, absent: 0, not_in_yet: 0, ignored: 0 })
    assert.equal((await db.query("select public.attendance_day_summary($1,'2026-03-04') s", [project])).rows[0].s.absent, 2, "Ana and Cy")
    for (const who of ["dtrClient", "eng2"]) assert.deepEqual(await status("2026-03-02", "2026-03-08", who), [])
  })
}
