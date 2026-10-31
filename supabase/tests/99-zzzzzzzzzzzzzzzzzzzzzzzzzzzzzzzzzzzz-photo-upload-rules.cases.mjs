import assert from "node:assert/strict"

// 20261031123546: per-account photo choices (allow / camera_only) and the photos.manage Admin permission, both managed in
// System settings. A person's own choice wins over the company switch photos.allow_device_upload.
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, addUser }) {
  await asOwner()
  await db.query("select set_config('request.jwt.claims', '{}', false)")
  for (const [key, role] of [["ruleFore", "foreman"], ["ruleFore2", "foreman"], ["ruleEng", "engineer"], ["ruleClient", "client"], ["photoAdmin", "admin"], ["plainAdmin", "admin"]]) await addUser(key, role)
  await db.query("delete from public.admin_permissions where user_id in ($1, $2)", [ids.photoAdmin, ids.plainAdmin])
  const project = (await db.query("insert into public.projects (code, name, status, site_lat, site_lng, site_radius_m) values ('RULES-1', 'Rules tower', 'active', 14.676, 120.983, 150) returning id")).rows[0].id
  for (const key of ["ruleFore", "ruleEng"]) await db.query("insert into public.project_members (project_id, user_id) values ($1, $2)", [project, ids[key]])
  await as("super", "aal2")
  const everyType = JSON.stringify(Object.fromEntries(["architectural", "civil_structural", "electrical", "mechanical", "plumbing_sanitary"].map((type) => [type, "assigned"])))
  for (const key of ["ruleFore", "ruleEng"]) await db.query("select public.set_blueprint_access($1, $2, $3::jsonb)", [project, ids[key], everyType])
  await asOwner()
  await db.query("select set_config('request.jwt.claims', '{}', false)")
  const sheet = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Rules plan') returning id", [project])).rows[0].id
  const pin = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to) values ($1, $2, 5, 5, 'Rules pin', $3) returning id", [project, sheet, ids.ruleFore])).rows[0].id
  const day = (await db.query("select to_char((now() at time zone 'Asia/Manila')::date, 'YYYY-MM-DD') d")).rows[0].d
  await as("ruleFore")
  const report = (await db.query("insert into public.daily_reports (project_id, report_date, work_done, workers_count) values ($1, $2, 'Rules slab work', 0) returning id", [project, day])).rows[0].id
  const tpl = (await db.query("select id from public.qa_templates where is_system order by name limit 1")).rows[0].id
  await as("ruleEng")
  const ir = (await db.query("select public.request_inspection($1, $2, 'Rules inspection') id", [project, tpl])).rows[0].id
  await db.query("select public.start_inspection($1)", [ir])

  let n = 0
  const atSite = [14.676, 120.983, 8]
  const pinPhoto = (source, where = atSite) => db.query("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, $4, now(), $5, $6, $7) returning id", [pin, project, `${project}/${pin}/rule-${++n}.jpg`, source, ...where])
  const dailyPhoto = (source, where = atSite) => db.query("insert into public.daily_report_photos (project_id, report_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, $4, now(), $5, $6, $7) returning id", [project, report, `${project}/${report}/rule-${++n}.jpg`, source, ...where])
  const qaPhoto = (source, where = atSite) => db.query("insert into public.qa_photos (project_id, inspection_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, $4, now(), $5, $6, $7) returning id", [project, ir, `${project}/ir-${ir}/rule-${++n}.jpg`, source, ...where])
  const company = async (allowed) => { await asOwner(); await db.query("update public.system_settings set value = $1::jsonb where key = 'photos.allow_device_upload'", [JSON.stringify(allowed)]) }
  const rule = async (key, mode) => { await as("super", "aal2"); await db.query("select public.set_photo_upload_rule($1, $2)", [ids[key], mode]) }

  await test("Photo rules: photos.manage is a valid Admin permission; unknown permissions stay refused", async () => {
    await asOwner()
    await expectOk("insert into public.admin_permissions (user_id, permission) values ($1, 'photos.manage')", [ids.photoAdmin])
    await expectFail("insert into public.admin_permissions (user_id, permission) values ($1, 'photos.view')", [ids.plainAdmin], /check constraint/)
  })

  await test("Photo rules: an Admin with photos.manage + MFA changes the company switch, but no other system setting", async () => {
    await as("photoAdmin", "aal2")
    await expectOk("select public.set_setting('photos.allow_device_upload', 'false'::jsonb)")
    await expectOk("select public.set_setting('photos.allow_device_upload', 'true'::jsonb)")
    await expectFail("select public.set_setting('qa.acceptance_threshold', '80'::jsonb)", [], /Only a Super Admin \(with MFA\) can change settings/)
    await as("photoAdmin", "aal1")
    await expectFail("select public.set_setting('photos.allow_device_upload', 'false'::jsonb)", [], /Site photos permission/)
    for (const who of ["plainAdmin", "admin", "ruleEng"]) {
      await as(who, "aal2")
      await expectFail("select public.set_setting('photos.allow_device_upload', 'false'::jsonb)", [], /Site photos permission/)
    }
    await asOwner()
    const audit = (await db.query("select actor_id from public.audit_log where action = 'settings.update' and details->>'key' = 'photos.allow_device_upload' order by id desc limit 1")).rows[0]
    assert.equal(audit.actor_id, ids.photoAdmin)
  })

  await test("Photo rules: only photos.manage sets a person's choice, only for Foremen / Engineers, with the three choices, audited", async () => {
    await as("photoAdmin", "aal2")
    await expectOk("select public.set_photo_upload_rule($1, 'allow')", [ids.ruleFore])
    await expectOk("select public.set_photo_upload_rule($1, 'allow')", [ids.ruleFore]) // unchanged: no second audit row
    await expectOk("select public.set_photo_upload_rule($1, 'camera_only')", [ids.ruleEng])
    await expectFail("select public.set_photo_upload_rule($1, 'gallery')", [ids.ruleFore], /Choose Follow company setting/)
    for (const key of ["ruleClient", "plainAdmin", "super"]) await expectFail("select public.set_photo_upload_rule($1, 'allow')", [ids[key]], /Foreman and Engineer accounts only/)
    for (const [who, aal] of [["photoAdmin", "aal1"], ["admin", "aal2"], ["plainAdmin", "aal2"], ["ruleFore", "aal1"]]) {
      await as(who, aal)
      await expectFail("select public.set_photo_upload_rule($1, null)", [ids.ruleFore], /Site photos permission/)
    }
    await asOwner()
    const rows = (await db.query("select target_id, details from public.audit_log where action = 'photos.account_rule' and target_id in ($1, $2) order by id", [ids.ruleFore, ids.ruleEng])).rows
    assert.deepEqual(rows.map((row) => [row.target_id, row.details.before, row.details.after]), [[ids.ruleFore, "company", "allow"], [ids.ruleEng, "company", "camera_only"]])
  })

  await test("Photo rules: people read only their own choice; the list is for photos.manage / users.view Admins; no direct writes", async () => {
    await as("ruleFore")
    assert.deepEqual((await db.query("select user_id, mode from public.photo_upload_overrides")).rows, [{ user_id: ids.ruleFore, mode: "allow" }])
    await expectFail("insert into public.photo_upload_overrides (user_id, mode) values ($1, 'allow')", [ids.ruleFore2], /permission denied/)
    await expectFail("select public.get_photo_upload_accounts()", [], /Site photos or View users permission/)
    await as("ruleFore2")
    assert.equal((await db.query("select count(*)::int n from public.photo_upload_overrides")).rows[0].n, 0)
    await as("photoAdmin", "aal2")
    await expectFail("update public.photo_upload_overrides set mode = 'camera_only' where user_id = $1", [ids.ruleFore], /permission denied/)
    await as("admin", "aal2") // users.view only: reads the list, cannot change it
    const list = (await db.query("select user_id, role, mode from public.get_photo_upload_accounts()")).rows
    assert.deepEqual(list.find((row) => row.user_id === ids.ruleFore), { user_id: ids.ruleFore, role: "foreman", mode: "allow" })
    assert.deepEqual(list.find((row) => row.user_id === ids.ruleEng), { user_id: ids.ruleEng, role: "engineer", mode: "camera_only" })
    assert.ok(!list.some((row) => row.user_id === ids.ruleClient || row.user_id === ids.photoAdmin), "only Foremen and Engineers are listed")
    await as("plainAdmin", "aal2")
    await expectFail("select public.get_photo_upload_accounts()", [], /Site photos or View users permission/)
  })

  await test("Photo rules: Allow uploads lets that Foreman upload while the company switch is off; others still need the camera at the site", async () => {
    await company(false)
    await rule("ruleFore", "allow")
    await as("ruleFore")
    await expectOk("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at) values ($1, $2, $3, 'upload', now())", [pin, project, `${project}/${pin}/allowed-upload.jpg`])
    assert.ok((await dailyPhoto("upload", [null, null, null])).rows[0].id)
    assert.ok((await qaPhoto("upload")).rows[0].id, "the Foreman's QA photos follow their own choice too")
    await rule("ruleFore", null)
    await as("ruleFore")
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'upload', now(), 14.676, 120.983, 8)", [pin, project, `${project}/${pin}/company-again.jpg`], /Photo uploads are turned off/)
  })

  await test("Photo rules: Camera only applies while the company switch is on, including an Engineer's own inspection photos", async () => {
    await company(true)
    await rule("ruleFore", "camera_only")
    await as("ruleFore")
    await expectFail("insert into public.pin_photos (pin_id, project_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'upload', now(), 14.676, 120.983, 8)", [pin, project, `${project}/${pin}/fore-camera-only.jpg`], /Photo uploads are turned off/)
    await expectFail("insert into public.daily_report_photos (project_id, report_id, path, capture_source, taken_at) values ($1, $2, $3, 'camera', now())", [project, report, `${project}/${report}/fore-no-location.jpg`], /Turn on location/)
    assert.ok((await pinPhoto("camera")).rows[0].id, "a camera photo at the site is accepted")
    await rule("ruleEng", "camera_only")
    await as("ruleEng")
    await expectFail("insert into public.qa_photos (project_id, inspection_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'upload', now(), 14.676, 120.983, 8)", [project, ir, `${project}/ir-${ir}/eng-upload.jpg`], /Photo uploads are turned off/)
    await expectFail("insert into public.qa_photos (project_id, inspection_id, path, capture_source, taken_at, lat, lng, accuracy_m) values ($1, $2, $3, 'camera', now(), 14.7, 120.983, 8)", [project, ir, `${project}/ir-${ir}/eng-away.jpg`], /from the project site/)
    assert.ok((await qaPhoto("camera")).rows[0].id)
  })

  await test("Photo rules: without a choice an Engineer's inspection photos ignore the company switch, as before", async () => {
    await rule("ruleEng", null)
    await company(false)
    await as("ruleEng")
    assert.ok((await qaPhoto("upload", [14.7, 120.983, 8])).rows[0].id)
    await rule("ruleFore", null)
    await company(true)
    await asOwner()
    assert.equal((await db.query("select count(*)::int n from public.photo_upload_overrides where user_id in ($1, $2)", [ids.ruleFore, ids.ruleEng])).rows[0].n, 0)
  })
}
