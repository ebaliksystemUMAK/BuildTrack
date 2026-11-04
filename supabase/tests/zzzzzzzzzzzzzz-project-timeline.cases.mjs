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
  const owner = async () => {
    await asOwner()
    await db.query("select set_config('request.jwt.claims','{}',false)")
  }
  await owner()
  for (const [key, role] of [
    ["gtPM", "project_manager"],
    ["gtPM2", "project_manager"],
    ["gtAdmin", "admin"],
    ["gtReadAdmin", "admin"],
    ["gtSuper", "super_admin"],
    ["gtEngineer", "engineer"],
    ["gtForeman", "foreman"],
    ["gtOther", "foreman"],
    ["gtClient", "client"],
    ["gtBasic", "user"],
  ])
    await addUser(key, role)
  await db.query("delete from public.admin_permissions where user_id=$1", [
    ids.gtReadAdmin,
  ])
  await db.query(
    "insert into public.admin_permissions(user_id,permission) values($1,'blueprints.manage')",
    [ids.gtReadAdmin],
  )
  const project = (
    await db.query(
      "insert into public.projects(code,name) values('GANTT-1','Timeline tests') returning id",
    )
  ).rows[0].id
  const other = (
    await db.query(
      "insert into public.projects(code,name) values('GANTT-2','Other timeline') returning id",
    )
  ).rows[0].id
  await db.query(
    "insert into public.project_managers(project_id,user_id,designation) values($1,$2,'primary'),($3,$4,'primary')",
    [project, ids.gtPM, other, ids.gtPM2],
  )
  for (const key of ["gtEngineer", "gtForeman", "gtOther", "gtClient"])
    await db.query(
      "insert into public.project_members(project_id,user_id) values($1,$2)",
      [project, ids[key]],
    )
  for (const key of ["gtEngineer", "gtForeman", "gtOther"])
    await db.query(
      "insert into public.project_blueprint_access(project_id,user_id,blueprint_type,access_level) values($1,$2,'architectural','assigned') on conflict(project_id,user_id,blueprint_type) do update set access_level='assigned'",
      [project, ids[key]],
    )
  const sheet = (
    await db.query(
      "insert into public.blueprints(project_id,title,blueprint_type) values($1,'Ground floor','architectural') returning id",
      [project],
    )
  ).rows[0].id
  const pin = (
    await db.query(
      "insert into public.pins(project_id,blueprint_id,x,y,title,assigned_to,due_date) values($1,$2,10,10,'Foundation pin',$3,'2026-12-10') returning id",
      [project, sheet, ids.gtForeman],
    )
  ).rows[0].id
  const c1 = (
    await db.query(
      "insert into public.pin_checklist_items(project_id,pin_id,text) values($1,$2,'Excavation') returning id",
      [project, pin],
    )
  ).rows[0].id
  const c2 = (
    await db.query(
      "insert into public.pin_checklist_items(project_id,pin_id,text) values($1,$2,'Concrete') returning id",
      [project, pin],
    )
  ).rows[0].id
  const key1 = `task:${c1}`,
    key2 = `task:${c2}`,
    milestone = `milestone:${randomUUID()}`
  const plan = (start = "2026-12-01", end = "2026-12-03", extra = {}) => ({
    title: "Canonical title is retained",
    phase: "Foundation",
    planned_start: start,
    planned_end: end,
    actual_start: null,
    actual_end: null,
    predecessors: [],
    ...extra,
  })
  const read = async () =>
    (await db.query("select public.get_project_timeline($1) data", [project]))
      .rows[0].data
  const save = (key, value, revision = 0) =>
    db.query(
      "select public.save_timeline_item($1,$2,$3::jsonb,$4,'Coordinated work sequence')",
      [project, key, JSON.stringify(value), revision],
    )
  const request = (key, value, revision) =>
    db.query(
      "select public.request_timeline_change($1,$2,$3::jsonb,$4,'Site conditions changed')",
      [project, key, JSON.stringify(value), revision],
    )

  await test("Gantt: canonical tasks, undated starts, project scope and private tables", async () => {
    await as("gtEngineer")
    const data = await read()
    assert.equal(data.items.length, 2)
    assert.equal(data.items[0].planned_start, null)
    assert.ok(
      data.items.some(
        (row) =>
          row.title === "Excavation" &&
          row.pin_id === pin &&
          row.planned_end === null,
      ),
    )
    assert.equal(data.can_edit, false)
    assert.equal(data.can_request, true)
    await expectFail(
      "select * from public.project_timeline_items",
      [],
      /permission denied/,
    )
    await expectFail(
      "select public.timeline_rows($1)",
      [project],
      /permission denied/,
    )
    await as("gtPM2")
    await expectFail(
      "select public.get_project_timeline($1)",
      [project],
      /unavailable/,
    )
    await as("gtBasic")
    await expectFail(
      "select public.get_project_timeline($1)",
      [project],
      /unavailable/,
    )
    await as(null)
    await expectFail(
      "select public.get_project_timeline($1)",
      [project],
      /permission denied/,
    )
  })
  await test("Gantt: only assigned PMs and MFA-verified Super Admin recovery can edit; ordinary Admin is read-only", async () => {
    for (const who of [
      "gtEngineer",
      "gtForeman",
      "gtClient",
      "gtReadAdmin",
      "gtPM2",
    ]) {
      await as(who, "aal2")
      await expectFail(
        "select public.save_timeline_item($1,$2,$3::jsonb,0,'A legitimate reason')",
        [project, key1, JSON.stringify(plan())],
        /schedule managers/,
      )
    }
    await as("gtAdmin")
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,0,'A legitimate reason')",
      [project, key1, JSON.stringify(plan())],
      /schedule managers/,
    )
    await as("gtPM")
    await save(key1, plan())
    let data = await read()
    assert.equal(data.can_edit, true)
    assert.equal(data.items.find((row) => row.key === key1).title, "Excavation")
    await as("gtAdmin", "aal2")
    await expectFail("select public.save_timeline_item($1,$2,$3::jsonb,0,'A legitimate reason')", [project,key2,JSON.stringify(plan())], /schedule managers/)
    await as("gtPM")
    await save(key2, plan("2026-12-04", "2026-12-05", { predecessors: [key1] }))
    await as("gtSuper", "aal2")
    assert.equal((await read()).can_edit, true)
  })
  await test("Gantt: stale or null revisions, cross-project keys, reversed dates and dependency cycles fail atomically", async () => {
    await as("gtPM")
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,$4,'A legitimate reason')",
      [project, key1, JSON.stringify(plan()), 0],
      /changed/,
    )
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,null,'A legitimate reason')",
      [project, key1, JSON.stringify(plan())],
      /changed/,
    )
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,0,'A legitimate reason')",
      [other, key1, JSON.stringify(plan())],
      /schedule managers/,
    )
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,1,'A legitimate reason')",
      [project, key1, JSON.stringify(plan("2026-12-07", "2026-12-01"))],
      /check constraint/,
    )
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,1,'A legitimate reason')",
      [project, key1, JSON.stringify(plan("2026-12-01", "2026-12-08"))],
      /dependent task/,
    )
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,1,'A legitimate reason')",
      [
        project,
        key1,
        JSON.stringify(
          plan("2026-12-01", "2026-12-03", { predecessors: [key2] }),
        ),
      ],
      /Dependencies/,
    )
    await expectFail(
      "select public.save_timeline_item($1,$2,$3::jsonb,1,'A legitimate reason')",
      [
        project,
        key1,
        JSON.stringify(
          plan("2026-12-01", "2026-12-03", {
            predecessors: [`task:${randomUUID()}`],
          }),
        ),
      ],
      /Dependencies/,
    )
    assert.equal(
      (await read()).items.find((row) => row.key === key1).revision,
      1,
    )
  })
  await test("Gantt: Clients only receive publication allow-list; drafts and staff identities stay private", async () => {
    await as("gtClient")
    assert.equal((await read()).items.length, 0)
    await as("gtPM")
    await save(
      milestone,
      plan("2026-12-06", "2026-12-06", {
        title: "Foundation handover",
        predecessors: [key2],
      }),
    )
    assert.equal(
      (
        await db.query(
          "select public.publish_project_timeline($1,'Initial approved baseline') version",
          [project],
        )
      ).rows[0].version,
      1,
    )
    await as("gtClient")
    const data = await read()
    assert.equal(data.items.length, 3)
    const raw = JSON.stringify(data)
    for (const privateKey of [
      "reported_percent",
      "assigned_to",
      "owner",
      "report_id",
      "actual_start",
      "reason",
      "requested_by",
    ])
      assert.ok(!raw.includes(privateKey), privateKey)
    assert.equal(data.can_edit, false)
    assert.equal(data.can_request, false)
    await expectFail(
      "select * from public.project_timeline_publications",
      [],
      /permission denied/,
    )
    await as("gtPM")
    await save(key1, plan("2026-11-30", "2026-12-02"), 1)
    const changed = await read()
    assert.equal(
      changed.items.find((row) => row.key === key1).planned_start,
      "2026-11-30",
    )
    assert.equal(
      changed.baseline.find((row) => row.key === key1).planned_start,
      "2026-12-01",
    )
    await as("gtClient")
    assert.equal(
      (await read()).items.find((row) => row.key === key1).planned_start,
      "2026-12-01",
    )
  })
  let requestId
  await test("Gantt: assigned Foreman requests, unrelated Foreman cannot, approval saves without verifying QA", async () => {
    await as("gtOther")
    assert.equal(
      (await read()).items.filter((row) => row.kind === "work").length,
      0,
    )
    await expectFail(
      "select public.request_timeline_change($1,$2,$3::jsonb,2,'Site conditions changed')",
      [project, key1, JSON.stringify(plan())],
      /work you can access/,
    )
    await as("gtForeman")
    await request(key1, plan("2026-11-29", "2026-12-02"), 2)
    requestId = (await read()).requests[0].id
    await expectFail(
      "select public.request_timeline_change($1,$2,$3::jsonb,2,'Site conditions changed')",
      [project, key1, JSON.stringify(plan())],
      /pending request/,
    )
    await expectFail(
      "select public.review_timeline_change($1,true,'Reviewed site conditions')",
      [requestId],
      /unavailable/,
    )
    await as("gtPM")
    await db.query(
      "select public.review_timeline_change($1,true,'Reviewed site conditions')",
      [requestId],
    )
    const data = await read()
    assert.equal(data.requests[0].status, "approved")
    assert.equal(
      data.items.find((row) => row.key === key1).planned_start,
      "2026-11-29",
    )
    assert.equal(data.items.find((row) => row.key === key1).verified, false)
    await expectFail(
      "select public.review_timeline_change($1,true,'Reviewed site conditions')",
      [requestId],
      /already been reviewed/,
    )
  })
  await test("Gantt: stale approval fails; rejection remains available and baselines are immutable", async () => {
    await as("gtEngineer")
    await request(key1, plan("2026-11-28", "2026-12-02"), 3)
    requestId = (await read()).requests.find(
      (row) => row.status === "pending",
    ).id
    await as("gtPM")
    await save(key1, plan("2026-11-27", "2026-12-02"), 3)
    await expectFail(
      "select public.review_timeline_change($1,true,'Reviewed site conditions')",
      [requestId],
      /changed/,
    )
    await db.query(
      "select public.review_timeline_change($1,false,'Replaced by coordinated schedule')",
      [requestId],
    )
    assert.equal(
      (
        await db.query(
          "select public.publish_project_timeline($1,'Revised coordinated baseline') version",
          [project],
        )
      ).rows[0].version,
      2,
    )
    await owner()
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.project_timeline_publications where project_id=$1",
          [project],
        )
      ).rows[0].n,
      2,
    )
    assert.ok(
      (
        await db.query(
          "select count(*)::int n from public.audit_log where action like 'project_timeline.%' and details->>'project_id'=$1",
          [project],
        )
      ).rows[0].n >= 8,
    )
  })
  await test("Gantt: reported 100% is not Engineer verification; drafts and returned reports do not contribute", async () => {
    await as("gtForeman")
    const payload = [
      {
        id: randomUUID(),
        pin_id: pin,
        item_id: c1,
        work_done: "Completed site work",
        percent: 100,
        notes: "Reported completion",
        issues: "",
        manpower: null,
        materials: "",
      },
    ]
    await db.query(
      "select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Completed site work','draft',$2::jsonb)",
      [project, JSON.stringify(payload)],
    )
    assert.equal(
      (await read()).items.find((row) => row.key === key1).reported_percent,
      null,
    )
    await db.query(
      "select public.save_daily_report($1,(now() at time zone 'Asia/Manila')::date,'sunny','Completed site work','submitted',$2::jsonb)",
      [project, JSON.stringify(payload)],
    )
    const row = (await read()).items.find((row) => row.key === key1)
    assert.equal(row.reported_percent, 100)
    assert.equal(row.verified, false)
    assert.ok(row.reported_start)
    await as("gtEngineer")
    await db.query(
      "select public.review_daily_report($1,false,'Correct the reported work progress')",
      [row.report_id],
    )
    await as("gtForeman")
    assert.equal(
      (await read()).items.find((row) => row.key === key1).reported_percent,
      null,
    )
  })
  await test("Gantt: works without the optional task-entry report table", async () => {
    await owner()
    await db.exec(
      "begin; alter table public.daily_report_entries rename to timeline_test_report_entries",
    )
    try {
      await as("gtPM")
      assert.equal(
        (await read()).items.find((row) => row.key === key1).reported_percent,
        null,
      )
    } finally {
      await db.exec("reset role; rollback")
    }
  })
  await test("Gantt: revoked blueprint access hides work; archived projects reject all edits", async () => {
    await owner()
    await db.query(
      "delete from public.project_blueprint_access where project_id=$1 and user_id=$2",
      [project, ids.gtForeman],
    )
    await as("gtForeman")
    assert.equal(
      (await read()).items.filter((row) => row.kind === "work").length,
      0,
    )
    await owner()
    await db.query("update public.projects set archived_at=now() where id=$1", [
      project,
    ])
    await as("gtPM")
    assert.equal((await read()).can_edit, false)
    await expectFail(
      "select public.publish_project_timeline($1,'Revised archived baseline')",
      [project],
      /schedule managers/,
    )
    await as("gtEngineer")
    await expectFail(
      "select public.request_timeline_change($1,$2,$3::jsonb,4,'Site conditions changed')",
      [project, key1, JSON.stringify(plan())],
      /unavailable/,
    )
  })
}
