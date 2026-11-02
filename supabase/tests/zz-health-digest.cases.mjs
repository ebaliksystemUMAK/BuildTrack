import assert from "node:assert/strict"

// Tests for 20261101120000_system_health_and_admin_digest: the read-only health report, the email test limits and the daily admin digest.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role") }
  await owner()
  await addUser("hSuper", "super_admin")
  await addUser("hSuper2", "super_admin")
  await addUser("hAdminAll", "admin") // approve + projects permissions
  await addUser("hAdminNone", "admin") // nothing to act on
  await addUser("hAdminOut", "admin") // opted out of the digest
  await addUser("hEng", "engineer")
  await addUser("hGone", "admin", "disabled")
  for (const [who, perms] of [["hAdminAll", ["users.approve", "projects.manage"]], ["hAdminNone", ["users.view"]], ["hAdminOut", ["users.approve", "projects.manage"]]]) {
    await db.query("delete from public.admin_permissions where user_id = $1", [ids[who]])
    for (const permission of perms) await db.query("insert into public.admin_permissions(user_id, permission) values ($1, $2)", [ids[who], permission])
  }
  await db.query("insert into public.notification_prefs(user_id, email_admin_digest) values ($1, false)", [ids.hAdminOut])
  await db.query("update public.notifications set emailed_at = now() where emailed_at is null")

  // ---------------------------------------------------------------- health report
  await test("Health: only a Super Admin with MFA can run it; admins, project roles, visitors and an Admin without MFA cannot", async () => {
    for (const who of ["hAdminAll", "hEng"]) { await as(who, "aal2"); await expectFail("select public.get_system_health('[]')", [], /Only a Super Admin/) }
    await as("hSuper", "aal1"); await expectFail("select public.get_system_health('[]')", [], /Only a Super Admin/)
    await as(null); await expectFail("select public.get_system_health('[]')", [], /permission denied/)
    await as("hSuper", "aal2")
    const report = (await db.query("select public.get_system_health('[]') r")).rows[0].r
    assert.equal(report.database.ok, true); assert.ok(report.database.version >= 14)
    for (const key of ["checked_at", "migrations", "objects", "buckets", "cron", "email_queue", "digest", "email_tests"]) assert.ok(key in report, key)
  })

  await test("Health: required objects are reported present or missing without error; a missing table, function, column or bucket is simply 'false'", async () => {
    await owner()
    await db.query("insert into storage.buckets(id, name, public) values ('hbucket-private', 'hbucket-private', false), ('hbucket-public', 'hbucket-public', true)")
    await db.query("insert into storage.objects(bucket_id, name) values ('hbucket-private', 'a.txt'), ('hbucket-private', 'b.txt')")
    await as("hSuper", "aal2")
    const manifest = [{ kind: "table", name: "profiles" }, { kind: "table", name: "no_such_table" }, { kind: "function", name: "has_permission" }, { kind: "function", name: "no_such_function" },
      { kind: "column", name: "notification_prefs.email_admin_digest" }, { kind: "column", name: "notification_prefs.nope" }, { kind: "column", name: "nodot" },
      { kind: "bucket", name: "hbucket-private" }, { kind: "bucket", name: "hbucket-public" }, { kind: "bucket", name: "no-such-bucket" }]
    const report = (await db.query("select public.get_system_health($1::jsonb) r", [JSON.stringify(manifest)])).rows[0].r
    const found = Object.fromEntries(report.objects.map((o) => [o.kind + ":" + o.name, o]))
    assert.deepEqual(Object.entries(found).map(([key, o]) => [key, o.exists]), [["table:profiles", true], ["table:no_such_table", false], ["function:has_permission", true], ["function:no_such_function", false],
      ["column:notification_prefs.email_admin_digest", true], ["column:notification_prefs.nope", false], ["column:nodot", false], ["bucket:hbucket-private", true], ["bucket:hbucket-public", true], ["bucket:no-such-bucket", false]])
    assert.equal(found["bucket:hbucket-private"].public, false); assert.equal(found["bucket:hbucket-public"].public, true)
    const buckets = Object.fromEntries(report.buckets.map((b) => [b.id, b]))
    assert.equal(buckets["hbucket-private"].objects, 2); assert.equal(buckets["hbucket-private"].public, false); assert.equal(buckets["hbucket-public"].objects, 0)
  })

  await test("Health: the checklist is validated (names cannot carry code), limited in size, and nothing is changed by running it", async () => {
    await as("hSuper", "aal2")
    for (const bad of [[{ kind: "table", name: "x; drop table public.profiles" }], [{ kind: "table", name: "Profiles" }], [{ kind: "view", name: "x" }], [{ kind: "table" }], [{ kind: "table", name: "a".repeat(81) }], [{ kind: "table", name: "public.profiles" }, { kind: "column", name: "a.b.c" }]])
      await expectFail("select public.get_system_health($1::jsonb)", [JSON.stringify(bad)], /Invalid checklist item/)
    await expectFail("select public.get_system_health('{}'::jsonb)", [], /list of at most 400/)
    await expectFail("select public.get_system_health($1::jsonb)", [JSON.stringify(Array.from({ length: 401 }, () => ({ kind: "table", name: "profiles" })))], /at most 400/)
    await owner()
    assert.equal(await count("select count(*) n from public.profiles where id = $1", [ids.hSuper]), 1)
  })

  await test("Health: migration history and scheduled jobs say 'not available' when their tables are not there (nothing is guessed)", async () => {
    await as("hSuper", "aal2")
    const report = (await db.query("select public.get_system_health('[]') r")).rows[0].r
    assert.deepEqual({ ...report.migrations }, { available: false }); assert.equal(report.cron.installed, false); assert.deepEqual(report.cron.jobs, [])
  })

  await test("Health: reads the migration history and the scheduled jobs when present, without ever returning a job command", async () => {
    await owner()
    await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[])")
    await db.query("insert into supabase_migrations.schema_migrations(version, name) values ('20261010000000', 'older'), ('20261101000000', 'newest')")
    await db.exec("create schema cron; create table cron.job (jobid bigint primary key, schedule text, command text, active boolean, jobname text); create table cron.job_run_details (runid bigint generated always as identity primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz)")
    await db.query("insert into cron.job values (1, '*/5 * * * *', 'select net.http_post(headers := jsonb_build_object(''Authorization'', ''Bearer SECRET-SERVICE-KEY''))', true, 'send-notifications'), (2, '0 0 * * *', 'select 1', false, null)")
    await db.query("insert into cron.job_run_details(jobid, status, return_message, start_time) values (1, 'succeeded', 'ok', now() - interval '2 minutes'), (1, 'failed', E'boom\\u0007 bad', now() - interval '1 minute'), (2, 'succeeded', null, now() - interval '1 day')")
    await as("hSuper", "aal2")
    const report = (await db.query("select public.get_system_health('[]') r")).rows[0].r
    assert.equal(report.migrations.available, true); assert.equal(report.migrations.recorded, 2); assert.equal(report.migrations.latest_name, "newest"); assert.deepEqual(report.migrations.names, ["older", "newest"])
    assert.equal(report.cron.installed, true); assert.equal(report.cron.jobs.length, 2)
    const first = report.cron.jobs[0]
    assert.deepEqual([first.name, first.schedule, first.active, first.last_status, first.last_message], ["send-notifications", "*/5 * * * *", true, "failed", "boom  bad"], "the latest run is reported, control characters removed")
    assert.equal(report.cron.jobs[1].name, "job 2", "an unnamed job gets a neutral name")
    assert.ok(!JSON.stringify(report).includes("SECRET-SERVICE-KEY") && !JSON.stringify(report).includes("Bearer"), "no job command or secret is ever returned")
    await owner(); await db.exec("drop schema cron cascade; drop schema supabase_migrations cascade")
  })

  await test("Health: the email queue and digest figures are counts only", async () => {
    await owner()
    const base = { waiting: await count("select count(*) n from public.notifications where emailed_at is null"), over: await count("select count(*) n from public.notifications where emailed_at is null and created_at < now() - interval '1 day'"),
      sent: await count("select count(*) n from public.email_log where status = 'sent' and created_at > now() - interval '24 hours'"), failed: await count("select count(*) n from public.email_log where status = 'failed' and created_at > now() - interval '24 hours'"),
      skipped: await count("select count(*) n from public.email_log where status = 'skipped' and created_at > now() - interval '24 hours'") }
    await db.query("insert into public.notifications(user_id, kind, title, created_at) values ($1, 'pin.assigned', 'Old waiting', now() - interval '2 days'), ($1, 'pin.assigned', 'New waiting', now())", [ids.hEng])
    await db.query("insert into public.email_log(user_id, status) values ($1, 'sent'), ($1, 'failed'), ($1, 'skipped')", [ids.hEng])
    await as("hSuper", "aal2")
    const queue = (await db.query("select public.get_system_health('[]')->'email_queue' q")).rows[0].q
    assert.deepEqual({ waiting: queue.waiting, over: queue.waiting_over_1d, sent: queue.sent_24h, failed: queue.failed_24h, skipped: queue.skipped_24h }, { waiting: base.waiting + 2, over: base.over + 1, sent: base.sent + 1, failed: base.failed + 1, skipped: base.skipped + 1 })
    await owner(); await db.query("delete from public.notifications where title in ('Old waiting', 'New waiting')"); await db.query("delete from public.email_log where user_id = $1", [ids.hEng])
  })

  // ---------------------------------------------------------------- email test limits
  await test("Email test: only the backend can start one, only for an active Super Admin, and the limits hold (3 an hour, 10 a day)", async () => {
    for (const who of ["hSuper", "hAdminAll", "hEng"]) { await as(who, "aal2"); await expectFail("select public.begin_email_test($1)", [ids[who]], /permission denied/) }
    await as(null); await expectFail("select public.begin_email_test($1)", [ids.hSuper], /permission denied/)
    await service()
    for (const who of ["hAdminAll", "hEng", "hGone"]) await expectFail("select public.begin_email_test($1)", [ids[who]], /Only an active Super Admin/)
    await expectFail("select public.begin_email_test(null)", [], /Only an active Super Admin/)
    const first = Number((await db.query("select public.begin_email_test($1) id", [ids.hSuper])).rows[0].id)
    await db.query("select public.begin_email_test($1)", [ids.hSuper]); await db.query("select public.begin_email_test($1)", [ids.hSuper])
    await expectFail("select public.begin_email_test($1)", [ids.hSuper], /Too many test emails in the last hour/)
    await db.query("select public.finish_email_test($1, 'accepted', 201, '<abc@example.test>', 'accepted by the provider')", [first])
    await expectFail("select public.finish_email_test($1, 'maybe', 0, null, null)", [first], /Invalid status/)
    await owner()
    const row = (await db.query("select status, provider_status, message_id, detail from public.email_test_log where id = $1", [first])).rows[0]
    assert.deepEqual({ ...row }, { status: "accepted", provider_status: 201, message_id: "<abc@example.test>", detail: "accepted by the provider" })
    // the hour counter forgets older tests; the day counter does not: 10 within 24 hours stops the next one
    await owner()
    await db.query("update public.email_test_log set created_at = now() - interval '3 hours' where user_id = $1", [ids.hSuper])
    await service()
    await db.query("select public.begin_email_test($1)", [ids.hSuper]) // allowed again: only one in the last hour
    await owner()
    await db.query("insert into public.email_test_log(user_id, created_at) select $1, now() - interval '5 hours' from generate_series(1, 6)", [ids.hSuper])
    await service()
    await expectFail("select public.begin_email_test($1)", [ids.hSuper], /Daily limit of 10/)
    await as("hSuper", "aal2"); await expectFail("select * from public.email_test_log", [], /permission denied/)
  })

  // ---------------------------------------------------------------- daily admin digest
  // The shared test database holds admins and pending people from earlier test files, so expectations are computed from the data, and the checks that
  // matter most (who gets what, opt-out, duplicates) are made on this file's own people.
  await owner()
  await addUser("pendingOne", "user", "pending")
  await addUser("pendingTwo", "user", "pending")
  await db.query("update public.profiles set registration_completed_at = now() where id in ($1, $2)", [ids.pendingOne, ids.pendingTwo])
  const project = (await db.query("insert into public.projects(code, name, status) values ('DIGEST-1', 'Digest tower', 'active') returning id")).rows[0].id
  await db.query("insert into public.projects(code, name, status) values ('DIGEST-DONE', 'Finished tower', 'completed')")
  await db.query("insert into public.email_log(user_id, status, created_at) values ($1, 'failed', now() - interval '1 hour')", [ids.hEng])
  const content = async (who) => { await owner(); return (await db.query("select public.admin_digest_content($1) c", [ids[who]])).rows[0].c }
  const mine = ["hSuper", "hSuper2", "hAdminAll", "hAdminNone", "hAdminOut"]
  const digestRows = async (key) => { await owner(); return (await db.query("select u.email, n.title from public.notifications n join public.profiles u on u.id = n.user_id where n.kind = 'digest.admin' and n.dedupe_key = $1 order by u.email", [key])).rows }

  await test("Digest content: each person is told only what they may act on", async () => {
    const pending = await count("select count(*) n from public.profiles where status = 'pending' and registration_completed_at is not null")
    const all = await content("hAdminAll")
    const keys = all.sections.map((s) => s.key)
    assert.ok(keys.includes("registrations") && keys.includes("projects_without_manager"), JSON.stringify(all))
    assert.ok(!keys.includes("email_failed") && !keys.includes("email_waiting"), "delivery problems are for Super Admin only")
    assert.equal(all.sections.find((s) => s.key === "registrations").count, pending)
    assert.match(all.body, new RegExp(`${pending} registrations to approve`)); assert.match(all.body, /no primary Project Manager/)
    const none = await content("hAdminNone"); assert.equal(none.total, 0); assert.equal(none.body, "")
    const superContent = await content("hSuper"); assert.ok(superContent.sections.some((s) => s.key === "email_failed" && s.count >= 1), "a Super Admin also sees delivery problems")
    for (const who of ["hEng", "hGone"]) assert.equal((await content(who)).total, 0, who + " is not a recipient")
    assert.ok(all.body.length <= 480)
  })

  await test("Digest content: a project with an active primary Project Manager, and closed projects, do not count", async () => {
    await owner()
    await addUser("hPm", "project_manager")
    const without = async () => (await content("hAdminAll")).sections.find((s) => s.key === "projects_without_manager")?.count ?? 0
    const before = await without()
    await db.query("insert into public.project_managers(project_id, user_id, designation) values ($1, $2, 'primary')", [project, ids.hPm])
    assert.equal(await without(), before - 1, "an active primary Project Manager covers the project")
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.hPm])
    assert.equal(await without(), before, "a suspended Project Manager no longer covers it")
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.hPm])
    assert.equal(await without(), before - 1)
    await db.query("update public.projects set status = 'completed' where id = $1", [project])
    assert.equal(await without(), before - 1, "a closed project never counts")
    await db.query("update public.projects set status = 'active' where id = $1", [project])
  })

  await test("Digest: only the backend can generate it; the Super Admin dry run creates nothing", async () => {
    for (const who of ["hSuper", "hAdminAll", "hEng"]) { await as(who, "aal2"); await expectFail("select public.generate_admin_digest()", [], /permission denied/); await expectFail("select public.admin_digest_content($1)", [ids[who]], /permission denied/) }
    await as(null); await expectFail("select public.generate_admin_digest()", [], /permission denied/)
    await owner()
    const before = await count("select count(*) n from public.notifications where kind = 'digest.admin'")
    await as("hAdminAll", "aal2"); await expectFail("select public.preview_admin_digest()", [], /Only a Super Admin/)
    await as("hSuper", "aal2")
    const preview = (await db.query("select public.preview_admin_digest() p")).rows[0].p
    const byName = Object.fromEntries(preview.recipients.map((r) => [r.name, r]))
    assert.equal(byName.hAdminOut.opted_out, true); assert.equal(byName.hAdminNone.total, 0); assert.ok(byName.hAdminAll.total >= 3); assert.ok(!("hGone" in byName), "a suspended admin is not a recipient")
    assert.ok(preview.recipients.every((r) => ["super_admin", "admin"].includes(r.role)), "Super Admins and Admins only")
    await owner(); assert.equal(await count("select count(*) n from public.notifications where kind = 'digest.admin'"), before, "a preview creates nothing")
    assert.equal(await count("select count(*) n from public.digest_runs"), 0, "and logs no run")
  })

  await test("Digest: it creates one notification per person with something to act on, skips opt-outs and empty digests, and logs the run", async () => {
    await as("hSuper", "aal2")
    const preview = (await db.query("select public.preview_admin_digest() p")).rows[0].p.recipients
    const expected = { recipients: preview.length, created: preview.filter((r) => !r.opted_out && r.total > 0).length, empty: preview.filter((r) => !r.opted_out && r.total === 0).length, optOut: preview.filter((r) => r.opted_out).length }
    await service()
    const result = (await db.query("select public.generate_admin_digest('2026-11-02') r")).rows[0].r
    await owner()
    assert.equal(result.ok, true)
    assert.deepEqual({ recipients: result.recipients, created: result.created, empty: result.skipped_empty, optOut: result.skipped_opt_out }, expected, "the run does exactly what the dry run showed")
    const got = (await digestRows("digest:20261102")).map((r) => r.email)
    for (const who of ["hSuper", "hSuper2", "hAdminAll"]) assert.ok(got.includes(who.toLowerCase() + "@test.local"), who + " is told")
    for (const who of ["hAdminNone", "hAdminOut", "hGone", "hEng"]) assert.ok(!got.includes(who.toLowerCase() + "@test.local"), who + " is not")
    const row = (await db.query("select n.title, n.body, n.link, n.emailed_at from public.notifications n where n.kind = 'digest.admin' and n.user_id = $1", [ids.hAdminAll])).rows[0]
    assert.match(row.title, /^Admin summary: \d+ items? needs? your attention$|^Admin summary: \d+ items need your attention$/); assert.equal(row.link, "/admin/dashboard"); assert.equal(row.emailed_at, null, "queued for the normal email queue")
    assert.match(row.body, /registrations? to approve/)
    const run = (await db.query("select run_date::text d, status, recipients, created, skipped_empty, skipped_opt_out, finished_at is not null done from public.digest_runs order by id desc limit 1")).rows[0]
    assert.deepEqual({ ...run }, { d: "2026-11-02", status: "ok", recipients: expected.recipients, created: expected.created, skipped_empty: expected.empty, skipped_opt_out: expected.optOut, done: true })
  })

  await test("Digest: a retry or an overlapping run the same day creates nothing new (no duplicate delivery); the next day creates a new one", async () => {
    await owner()
    const total = await count("select count(*) n from public.notifications where kind = 'digest.admin'")
    const today = (await digestRows("digest:20261102")).length
    await service()
    const again = (await db.query("select public.generate_admin_digest('2026-11-02') r")).rows[0].r
    assert.equal(again.ok, true); assert.equal(again.created, 0)
    const both = await Promise.all([db.query("select public.generate_admin_digest('2026-11-02') r"), db.query("select public.generate_admin_digest('2026-11-02') r")])
    assert.deepEqual(both.map((r) => r.rows[0].r.created), [0, 0], "two runs started together: nothing is created twice")
    await owner(); assert.equal(await count("select count(*) n from public.notifications where kind = 'digest.admin'"), total)
    assert.equal(await count("select count(*) n from (select user_id, dedupe_key from public.notifications where kind = 'digest.admin' group by 1, 2 having count(*) > 1) d"), 0, "no person has two digests for one day")
    await service()
    const next = (await db.query("select public.generate_admin_digest('2026-11-03') r")).rows[0].r
    assert.equal(next.created, today, "the next day creates a fresh digest for the same people")
    await owner(); assert.equal(await count("select count(*) n from public.digest_runs where status = 'ok'"), 5, "every call is logged, including the retries that created nothing")
  })

  await test("Digest: a person who opts back in is included, and a suspended admin never is", async () => {
    await owner()
    await db.query("update public.notification_prefs set email_admin_digest = true where user_id = $1", [ids.hAdminOut])
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.hSuper2])
    await service()
    const result = (await db.query("select public.generate_admin_digest('2026-11-04') r")).rows[0].r
    await owner()
    assert.equal(result.ok, true)
    const got = (await digestRows("digest:20261104")).map((r) => r.email)
    assert.ok(got.includes("hadminout@test.local"), "opted back in"); assert.ok(!got.includes("hsuper2@test.local"), "a suspended admin gets no digest"); assert.ok(got.includes("hadminall@test.local"))
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.hSuper2])
  })

  await test("Digest: a failing run is logged with its message, undoes its partial work, and a later run succeeds", async () => {
    await owner(); await db.query("alter table public.data_requests rename to data_requests_hidden")
    await service()
    const failed = (await db.query("select public.generate_admin_digest('2026-11-05') r")).rows[0].r
    await owner(); await db.query("alter table public.data_requests_hidden rename to data_requests")
    assert.equal(failed.ok, false); assert.match(failed.error, /data_requests/)
    const run = (await db.query("select status, detail, finished_at is not null done from public.digest_runs where run_date = '2026-11-05'")).rows[0]
    assert.equal(run.status, "failed"); assert.match(run.detail, /data_requests/); assert.equal(run.done, true)
    assert.equal(await count("select count(*) n from public.notifications where dedupe_key = 'digest:20261105'"), 0, "nothing half-created")
    await service()
    const retry = (await db.query("select public.generate_admin_digest('2026-11-05') r")).rows[0].r
    assert.equal(retry.ok, true); assert.ok(retry.created >= 1)
  })

  await test("Digest: it rides the normal email queue: an admin who switched emails off is not emailed, and no secrets are in it", async () => {
    await owner()
    await db.query("insert into public.notification_prefs(user_id, email_enabled) values ($1, false) on conflict (user_id) do update set email_enabled = false", [ids.hSuper2])
    await db.query("update public.notifications set emailed_at = now() where emailed_at is null and kind <> 'digest.admin'") // a clear queue, so the digest rows are within the batch
    await service()
    const rows = (await db.query("select * from public.claim_email_batch(100)")).rows.filter((r) => r.kind === "digest.admin")
    await owner()
    assert.ok(rows.length >= 1 && rows.every((r) => r.user_id !== ids.hSuper2), "claimed: " + rows.length)
    assert.ok(rows.every((r) => !/key|token|secret|password/i.test(r.body ?? "")))
    assert.ok(await count("select count(*) n from public.email_log where status = 'skipped' and detail like 'opted out%' and user_id = $1", [ids.hSuper2]) >= 1)
  })

  await test("Digest opt-out: a person sets their own choice (and only that column), nobody else's", async () => {
    await as("hAdminAll", "aal2")
    await db.query("insert into public.notification_prefs(user_id, email_admin_digest) values ($1, false)", [ids.hAdminAll])
    await db.query("update public.notification_prefs set email_admin_digest = true")
    await expectFail("insert into public.notification_prefs(user_id, email_admin_digest) values ($1, false)", [ids.hEng], /row-level security/)
    await expectFail("update public.notification_prefs set updated_at = now()", [], /permission denied/)
    await as("hEng")
    assert.equal(await count("select count(*) n from public.notification_prefs where user_id = $1", [ids.hAdminAll]), 0)
    assert.equal((await db.query("update public.notification_prefs set email_admin_digest = false returning user_id")).rows.length, 0)
  })

  await test("The digest and health tables are not readable or writable through the API", async () => {
    for (const who of ["hSuper", "hAdminAll", "hEng"]) {
      await as(who, "aal2")
      for (const table of ["digest_runs", "email_test_log"]) await expectFail(`select * from public.${table}`, [], /permission denied/)
      await expectFail("insert into public.digest_runs(run_date) values (current_date)", [], /permission denied/)
    }
    await as(null); await expectFail("select * from public.digest_runs", [], /permission denied/)
  })
}
