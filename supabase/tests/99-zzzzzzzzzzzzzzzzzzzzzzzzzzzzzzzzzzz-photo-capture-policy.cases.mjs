import assert from "node:assert/strict"

// 20261031120532: the Super Admin switch photos.allow_device_upload. While it is off, daily report photos, work item evidence
// and the QA / NCR evidence a Foreman adds must be in-app camera photos taken at the project site (checked here, not in the browser).
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, addUser }) {
  await asOwner()
  await db.query("select set_config('request.jwt.claims', '{}', false)") // setup runs as the backend, not the previous suite's user
  await addUser("policyFore", "foreman")
  await addUser("policyEng", "engineer")
  const site = (await db.query("insert into public.projects (code, name, status, site_lat, site_lng, site_radius_m) values ('POLICY-1', 'Policy tower', 'active', 14.676, 120.983, 150) returning id")).rows[0].id
  const bare = (await db.query("insert into public.projects (code, name, status) values ('POLICY-2', 'Policy without a site', 'active') returning id")).rows[0].id
  for (const project of [site, bare]) for (const key of ["policyFore", "policyEng"]) await db.query("insert into public.project_members (project_id, user_id) values ($1, $2)", [project, ids[key]])
  // Strict plan-type mode (left on by earlier suites): grant every type explicitly, as an Admin does in Team & access.
  await as("super", "aal2")
  const everyType = JSON.stringify(Object.fromEntries(["architectural", "civil_structural", "electrical", "mechanical", "plumbing_sanitary"].map((type) => [type, "assigned"])))
  for (const project of [site, bare]) for (const key of ["policyFore", "policyEng"]) await db.query("select public.set_blueprint_access($1, $2, $3::jsonb)", [project, ids[key], everyType])
  await asOwner()
  await db.query("select set_config('request.jwt.claims', '{}', false)")
  const sheet = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Policy plan') returning id", [site])).rows[0].id
  const bareSheet = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Bare plan') returning id", [bare])).rows[0].id
  const pin = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 5, 5, 'Policy pin', $3) returning id", [site, sheet, ids.policyFore])).rows[0].id
  const barePin = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 5, 5, 'Bare pin', $3) returning id", [bare, bareSheet, ids.policyFore])).rows[0].id
  const day = (await db.query("select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') d")).rows[0].d
  await as("policyFore")
  const report = (await db.query("insert into public.daily_reports (project_id, report_date, work_done, workers_count) values ($1, $2, 'Policy slab work', 0) returning id", [site, day])).rows[0].id
  const tpl = (await db.query("select id from public.qa_templates where is_system order by name limit 1")).rows[0].id
  await as("policyEng")
  const ir = (await db.query("select public.request_inspection($1, $2, 'Policy inspection') id", [site, tpl])).rows[0].id

  let n = 0
  const atSite = [14.676, 120.983, 8]
  const away = [14.7, 120.983, 8]
  const pinPhoto = (source, where, forPin = pin, project = site) =>
    db.query("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, $4, now(), $5, $6, $7) returning capture_source, stamp_flag",
      [forPin, project, `${project}/${forPin}/policy-${++n}.jpg`, source, ...(where ?? [null, null, null])])
  const dailyPhoto = (source, where) =>
    db.query("insert into public.daily_report_photos (project_id, report_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, $4, now(), $5, $6, $7) returning capture_source, stamp_flag",
      [site, report, `${site}/${report}/policy-${++n}.jpg`, source, ...(where ?? [null, null, null])])
  const qaPhoto = (source, where) =>
    db.query("insert into public.qa_photos (project_id, inspection_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, $4, now(), $5, $6, $7) returning capture_source, stamp_flag",
      [site, ir, `${site}/ir-${ir}/policy-${++n}.jpg`, source, ...(where ?? [null, null, null])])
  const setPolicy = async (allowed) => { await asOwner(); await db.query("update public.system_settings set value = $1::jsonb where key = 'photos.allow_device_upload'", [JSON.stringify(allowed)]) }

  await test("Photo policy: the setting exists and allows device uploads by default", async () => {
    await as("policyFore")
    const row = (await db.query("select value from public.system_settings where key = 'photos.allow_device_upload'")).rows[0]
    assert.equal(row.value, true)
  })

  await test("Photo policy: while uploads are allowed, uploaded and camera photos are kept on all three tables with their real stamp", async () => {
    await as("policyFore")
    assert.deepEqual((await pinPhoto("upload", away)).rows[0], { capture_source: "upload", stamp_flag: "away_from_site" })
    assert.deepEqual((await pinPhoto("camera", null)).rows[0], { capture_source: "camera", stamp_flag: "no_location" })
    assert.deepEqual((await dailyPhoto("upload", null)).rows[0], { capture_source: "upload", stamp_flag: "no_location" })
    assert.deepEqual((await qaPhoto("upload", away)).rows[0], { capture_source: "upload", stamp_flag: "away_from_site" })
    await expectFail("insert into public.daily_report_photos (project_id, report_id, path, capture_source) values ($1, $2, $3, 'upload')", [site, report, `${site}/${report}/no-time.jpg`], /camera/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source) values ($1, $2, $3, 'gallery')", [pin, site, `${site}/${pin}/bad-source.jpg`], /check constraint/)
  })

  await test("Photo policy: only a Super Admin with MFA changes it, only to true or false, and the change is audited", async () => {
    for (const [who, aal] of [["policyFore", "aal2"], ["policyEng", "aal2"], ["admin", "aal2"], ["super", "aal1"]]) {
      await as(who, aal)
      await expectFail("select public.set_setting('photos.allow_device_upload', 'false'::jsonb)", [], /Only a Super Admin/)
    }
    await as("super", "aal2")
    for (const bad of ['"false"', "0", "null", '{"allowed":false}']) await expectFail("select public.set_setting('photos.allow_device_upload', $1::jsonb)", [bad], /allowed \(true\) or not \(false\)/)
    await expectOk("select public.set_setting('photos.allow_device_upload', 'false'::jsonb)")
    await asOwner()
    assert.equal((await db.query("select value from public.system_settings where key = 'photos.allow_device_upload'")).rows[0].value, false)
    const audit = (await db.query("select details from public.audit_log where action = 'settings.update' and details->>'key' = 'photos.allow_device_upload' order by id desc limit 1")).rows[0]
    assert.equal(audit.details.value, false)
  })

  await test("Photo policy off: device uploads and legacy rows are refused for daily reports and work item evidence", async () => {
    await setPolicy(false)
    await as("policyFore")
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'upload', now(), 14.676, 120.983, 8)", [pin, site, `${site}/${pin}/off-upload.jpg`], /Photo uploads are turned off/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, lat, lng, accuracy_m) values ($1, $2, $3, 14.676, 120.983, 8)", [pin, site, `${site}/${pin}/off-legacy.jpg`], /Photo uploads are turned off/)
    await expectFail("insert into public.daily_report_photos (project_id, report_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'upload', now(), 14.676, 120.983, 8)", [site, report, `${site}/${report}/off-upload.jpg`], /Photo uploads are turned off/)
  })

  await test("Photo policy off: a camera photo must be at the site (no position, away, no site location and wrong time are refused)", async () => {
    await setPolicy(false)
    await as("policyFore")
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at) values ($1, $2, $3, 'camera', now())", [pin, site, `${site}/${pin}/off-none.jpg`], /Turn on location/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'camera', now(), 14.7, 120.983, 8)", [pin, site, `${site}/${pin}/off-away.jpg`], /taken 2\.\d km from the project site/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'camera', now(), 14.678, 120.983, 10)", [pin, site, `${site}/${pin}/off-near.jpg`], /taken 2\d\d m from the project site/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'camera', now(), 14.676, 120.983, 8)", [barePin, bare, `${bare}/${barePin}/off-bare.jpg`], /no site location yet/)
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'camera', now() + interval '1 hour', 14.676, 120.983, 8)", [pin, site, `${site}/${pin}/off-ahead.jpg`], /phone time cannot be trusted/)
    await expectFail("insert into public.daily_report_photos (project_id, report_id, path, capture_source, taken_at) values ($1, $2, $3, 'camera', now())", [site, report, `${site}/${report}/off-none.jpg`], /Turn on location/)
  })

  await test("Photo policy off: camera photos at the site are accepted, including a poor GPS reading forgiven up to 100 m", async () => {
    await setPolicy(false)
    await as("policyFore")
    assert.deepEqual((await pinPhoto("camera", atSite)).rows[0], { capture_source: "camera", stamp_flag: "at_site" })
    assert.deepEqual((await pinPhoto("camera", [14.678, 120.983, 100])).rows[0], { capture_source: "camera", stamp_flag: "at_site" })
    assert.deepEqual((await dailyPhoto("camera", atSite)).rows[0], { capture_source: "camera", stamp_flag: "at_site" })
  })

  await test("Photo policy off: a Foreman's QA evidence follows the rule; the Engineer's own inspection photos do not", async () => {
    await setPolicy(false)
    await as("policyFore")
    await expectFail("insert into public.qa_photos (project_id, inspection_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'upload', now(), 14.676, 120.983, 8)", [site, ir, `${site}/ir-${ir}/off-upload.jpg`], /Photo uploads are turned off/)
    await expectFail("insert into public.qa_photos (project_id, inspection_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'camera', now(), 14.7, 120.983, 8)", [site, ir, `${site}/ir-${ir}/off-away.jpg`], /from the project site/)
    assert.deepEqual((await qaPhoto("camera", atSite)).rows[0], { capture_source: "camera", stamp_flag: "at_site" })
    await as("policyEng")
    await db.query("select public.start_inspection($1)", [ir])
    assert.deepEqual((await qaPhoto("upload", away)).rows[0], { capture_source: "upload", stamp_flag: "away_from_site" })
  })

  await test("Photo policy: the policy functions are internal; back on, uploads are accepted again", async () => {
    for (const who of ["policyFore", "policyEng"]) {
      await as(who)
      await expectFail("select public.photo_uploads_allowed()", [], /permission denied/)
    }
    await as("super", "aal2")
    await expectOk("select public.set_setting('photos.allow_device_upload', 'true'::jsonb)")
    await as("policyFore")
    assert.deepEqual((await pinPhoto("upload", away)).rows[0], { capture_source: "upload", stamp_flag: "away_from_site" })
    await setPolicy(true)
  })
}
