import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

export default async function ({
  db,
  ids,
  as,
  asOwner,
  addUser,
  test,
  expectFail,
}) {
  await asOwner()
  await addUser("attendanceFore", "foreman")
  await addUser("attendanceEng", "engineer")
  await addUser("attendanceClient", "client")
  const project = (
    await db.query(
      "insert into public.projects(code,name) values('BIO-TEST','Attendance test project') returning id",
    )
  ).rows[0].id
  const other = (
    await db.query(
      "insert into public.projects(code,name) values('BIO-OTHER','Other attendance project') returning id",
    )
  ).rows[0].id
  await db.query(
    "insert into public.project_members(project_id,user_id) values($1,$2),($1,$3),($1,$4)",
    [project, ids.attendanceFore, ids.attendanceEng, ids.attendanceClient],
  )
  const worker = randomUUID(),
    second = randomUUID()
  const record =
    "select public.record_biometric_attendance($1,$2,$3,$4,$5,$6) id"
  const scan = [
    project,
    "device-worker-1",
    "in",
    "2026-01-02T00:00:00Z",
    "gate-1",
    "scan-1",
  ]
  const service = async () => {
    await asOwner()
    await db.exec("set role service_role")
  }

  await test("Attendance: only authorized biometric managers can create/edit worker profiles", async () => {
    await as("super", "aal2")
    await db.query(
      "insert into public.attendance_workers(id,project_id,worker_code,biometric_uid,full_name,trade) values($1,$2,'W-001','device-worker-1','Test Worker','Mason'),($3,$2,'W-002','device-worker-2','Second Worker','Carpenter')",
      [worker, project, second],
    )
    await expectFail(
      "insert into public.attendance_workers(project_id,worker_code,biometric_uid,full_name) values($1,'W-001','duplicate','Duplicate Worker')",
      [project],
      /unique/,
    )
    for (const who of [
      "attendanceFore",
      "attendanceEng",
      "attendanceClient",
      "noperm",
    ]) {
      await as(who, "aal2")
      await expectFail(
        "insert into public.attendance_workers(project_id,worker_code,biometric_uid,full_name) values($1,'BAD','bad','Bad Writer')",
        [project],
        /row-level security/,
      )
      assert.equal(
        (
          await db.query(
            "update public.attendance_workers set full_name='Tampered' where id=$1 returning id",
            [worker],
          )
        ).rows.length,
        0,
      )
    }
  })

  await test("Attendance: trusted device events are idempotent; conflicting retries and unknown/wrong-project workers fail", async () => {
    await service()
    const id = (await db.query(record, scan)).rows[0].id
    assert.equal((await db.query(record, scan)).rows[0].id, id)
    assert.equal(
      (
        await db.query(
          "select count(*) n from public.biometric_attendance_events where project_id=$1",
          [project],
        )
      ).rows[0].n,
      1,
    )
    await expectFail(
      record,
      [project, "device-worker-2", ...scan.slice(2)],
      /different scan details/,
    )
    // Since 20261027130000 the database decides IN/OUT: a retry carrying another switch value is still the same scan.
    assert.equal((await db.query(record, [project, "device-worker-1", "out", ...scan.slice(3)])).rows[0].id, id)
    await expectFail(record, [other, ...scan.slice(1)], /not linked/)
    await expectFail(
      record,
      [project, "unknown", ...scan.slice(2)],
      /not linked/,
    )
    await expectFail(
      record,
      [project, "device-worker-1", "toggle", scan[3], "gate-1", "invalid"],
      /Direction/,
    )
    await expectFail(
      record,
      [project, "device-worker-1", "in", "infinity", "gate-1", "invalid"],
      /timestamp/,
    )
    await expectFail(
      record,
      [
        project,
        "device-worker-1",
        "in",
        "2099-01-01T00:00:00Z",
        "gate-1",
        "future",
      ],
      /timestamp/,
    )
  })

  await test("Attendance: Foreman/Engineer see the same scans; clients, outsiders, disabled and anonymous callers cannot", async () => {
    for (const who of ["attendanceFore", "attendanceEng"]) {
      await as(who)
      assert.equal(
        (
          await db.query(
            "select count(*) n from public.attendance_workers where project_id=$1",
            [project],
          )
        ).rows[0].n,
        2,
      )
      assert.equal(
        (
          await db.query(
            "select count(*) n from public.biometric_attendance_events where project_id=$1",
            [project],
          )
        ).rows[0].n,
        1,
      )
      await expectFail(record, scan, /permission denied/)
      await expectFail(
        "insert into public.biometric_attendance_events(project_id,worker_id,direction,occurred_at,device_id,external_event_id) values($1,$2,'in',now(),'fake','fake')",
        [project, worker],
        /permission denied/,
      )
      await expectFail(
        "delete from public.biometric_attendance_events where project_id=$1",
        [project],
        /permission denied/,
      )
    }
    for (const who of ["attendanceClient", "eng2"]) {
      await as(who)
      assert.equal(
        (
          await db.query(
            "select count(*) n from public.attendance_workers where project_id=$1",
            [project],
          )
        ).rows[0].n,
        0,
      )
      assert.equal(
        (
          await db.query(
            "select count(*) n from public.biometric_attendance_events where project_id=$1",
            [project],
          )
        ).rows[0].n,
        0,
      )
    }
    await asOwner()
    await db.query("update public.profiles set status='disabled' where id=$1", [
      ids.attendanceFore,
    ])
    await as("attendanceFore")
    assert.equal(
      (
        await db.query(
          "select count(*) n from public.biometric_attendance_events where project_id=$1",
          [project],
        )
      ).rows[0].n,
      0,
    )
    await asOwner()
    await db.query("update public.profiles set status='active' where id=$1", [
      ids.attendanceFore,
    ])
    await as(null)
    await expectFail(
      "select * from public.biometric_attendance_events",
      [],
      /permission denied/,
    )
    await expectFail(record, scan, /permission denied/)
  })

  await test("Attendance: Manila day summary includes all scans and latest chronological IN/OUT, including late imports", async () => {
    await service()
    for (const args of [
      [
        project,
        "device-worker-1",
        "out",
        "2026-01-02T09:00:00Z",
        "gate-1",
        "scan-2",
      ],
      [
        project,
        "device-worker-1",
        "in",
        "2026-01-02T01:00:00Z",
        "gate-1",
        "late-import",
      ],
      [
        project,
        "device-worker-2",
        "in",
        "2026-01-01T16:00:00Z",
        "gate-1",
        "manila-midnight",
      ],
      [
        project,
        "device-worker-2",
        "out",
        "2026-01-02T16:00:00Z",
        "gate-1",
        "next-day",
      ],
    ])
      await db.query(record, args)
    await as("attendanceFore")
    assert.deepEqual(
      (
        await db.query(
          "select public.attendance_day_summary($1,'2026-01-02') summary",
          [project],
        )
      ).rows[0].summary,
      // The late import (older than the worker's latest scan that day) is logged as ignored, not counted (20261027130000).
      { scans: 3, workers: 2, clocked_in: 1, clocked_out: 1, on_time: 0, late: 0, absent: 0, not_in_yet: 0, ignored: 1 },
    )
    assert.deepEqual(
      (
        await db.query(
          "select public.attendance_day_summary($1,'2026-01-02') summary",
          [other],
        )
      ).rows[0].summary,
      { scans: 0, workers: 0, clocked_in: 0, clocked_out: 0, on_time: 0, late: 0, absent: 0, not_in_yet: 0, ignored: 0 },
    )
    await as("attendanceClient")
    assert.equal(
      (
        await db.query(
          "select public.attendance_day_summary($1,'2026-01-02') summary",
          [project],
        )
      ).rows[0].summary.scans,
      0,
    )
  })

  await test("Attendance: private worker photos obey staff/project scope and biometric-manager upload restrictions", async () => {
    const path = `${project}/${worker}/portrait.jpg`
    await as("super", "aal2")
    await db.query(
      "insert into storage.objects(bucket_id,name) values('worker-photos',$1)",
      [path],
    )
    await db.query(
      "update public.attendance_workers set photo_path=$2 where id=$1",
      [worker, path],
    )
    await expectFail(
      "update public.attendance_workers set photo_path=$2 where id=$1",
      [worker, `${other}/${worker}/portrait.jpg`],
      /check constraint/,
    )
    await expectFail(
      "insert into storage.objects(bucket_id,name) values('worker-photos',$1)",
      [`${project}/${randomUUID()}/wrong.jpg`],
      /row-level security/,
    )
    for (const who of ["attendanceFore", "attendanceEng"]) {
      await as(who)
      assert.equal(
        (
          await db.query(
            "select count(*) n from storage.objects where bucket_id='worker-photos' and name=$1",
            [path],
          )
        ).rows[0].n,
        1,
      )
      await expectFail(
        "insert into storage.objects(bucket_id,name) values('worker-photos',$1)",
        [`${project}/${worker}/fake.jpg`],
        /row-level security/,
      )
    }
    for (const who of ["attendanceClient", "eng2", null]) {
      await as(who)
      assert.equal(
        (
          await db.query(
            "select count(*) n from storage.objects where bucket_id='worker-photos' and name=$1",
            [path],
          )
        ).rows[0].n,
        0,
      )
    }
    await asOwner()
    assert.equal(
      (
        await db.query(
          "select public from storage.buckets where id='worker-photos'",
        )
      ).rows[0].public,
      false,
    )
  })

  await test("Attendance: inactive workers reject new scans, immutable history survives, RPC privileges are restricted", async () => {
    await as("super", "aal2")
    await db.query(
      "update public.attendance_workers set active=false where id=$1",
      [worker],
    )
    await service()
    await expectFail(
      record,
      [project, "device-worker-1", "in", scan[3], "gate-1", "inactive-new"],
      /inactive/,
    )
    assert.ok(
      (await db.query(record, scan)).rows[0].id,
      "Previously recorded retries still return the same event",
    )
    await asOwner()
    assert.equal(
      (
        await db.query(
          "select count(*) n from public.biometric_attendance_events where worker_id=$1",
          [worker],
        )
      ).rows[0].n,
      2,
      "The out-of-order late import was ignored, not stored as attendance",
    )
    const fn =
      "public.record_biometric_attendance(uuid,text,text,timestamptz,text,text)"
    for (const role of ["anon", "authenticated"])
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'execute') ok", [
            role,
            fn,
          ])
        ).rows[0].ok,
        false,
      )
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('service_role',$1,'execute') ok",
          [fn],
        )
      ).rows[0].ok,
      true,
    )
  })
}
