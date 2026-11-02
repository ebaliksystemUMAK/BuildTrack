import assert from "node:assert/strict"

// Tests for 20261102100000_system_control: the registration and email switches, the emergency switch-off and the read-only reports. Everything starts OFF.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  await addUser("sysSuper", "super_admin")
  await addUser("sysAdmin", "admin")
  await addUser("sysBasic", "user")
  await addUser("sysGoogle", "user", "pending")
  await db.query("update public.profiles set email_verified_at = now() where id = any ($1)", [[ids.sysBasic, ids.sysGoogle, ids.sysSuper, ids.sysAdmin]])
  await db.query("update public.profiles set identity_status = 'verified' where id = $1", [ids.sysBasic])
  await db.query("update public.profiles set registration_completed_at = null where id = $1", [ids.sysGoogle])
  const sup = async () => as("sysSuper", "aal2")
  const switches = async () => { await sup(); return (await db.query("select public.get_system_switches() s")).rows[0].s }
  const flip = async (key, enabled, message = "Closed while we prepare the new intake.") => { await sup(); return (await db.query("select public.set_system_switch($1, $2, $3) r", [key, enabled, message])).rows[0].r }

  await test("Defaults: both switches are off, the table is not reachable directly, and a visitor sees an open registration", async () => {
    await owner()
    assert.equal(await count("select count(*) n from public.system_switches"), 2); assert.equal(await count("select count(*) n from public.system_switches where enabled"), 0)
    await owner(); await db.exec("set role authenticated"); await expectFail("select * from public.system_switches", [], /permission denied/)
    await owner(); await db.exec("set role anon")
    assert.deepEqual((await db.query("select public.get_registration_status() s")).rows[0].s, { closed: false, message: "" }, "anyone may ask whether registration is open, and learns nothing else")
  })

  await test("Only a Super Admin with the authenticator can read or change anything here", async () => {
    for (const call of ["select public.get_system_switches()", "select public.set_system_switch('email_paused', true, '')", "select public.site_emergency_off()", "select public.get_email_delivery(5)", "select public.get_storage_capacity()", "select public.get_system_activity(5, 0)"]) {
      await owner(); await db.exec("set role anon"); await expectFail(call, [], /permission denied/)
      await as("sysAdmin", "aal2"); await expectFail(call, [], /Only a Super Admin/)
      await as("sysBasic"); await expectFail(call, [], /Only a Super Admin/)
      await as("sysSuper", "aal1"); await expectFail(call, [], /Only a Super Admin/)
    }
    await sup(); await expectFail("select public.set_system_switch('nonsense', true, 'Some message here')", [], /Unknown switch/)
    await expectFail("select public.set_system_switch('registration_closed', true, 'no')", [], /at least 5 characters/)
    await expectFail("select public.set_system_switch('registration_closed', true, $1)", ["x".repeat(301)], /at most 300/)
    assert.equal((await switches()).registration_closed.enabled, false, "every refusal changed nothing")
  })

  await test("Closing registration stops new registrations, access requests and invitation codes with the Super Admin's message; opening it restores them; each change is audited", async () => {
    await owner(); const before = await count("select count(*) n from public.audit_log where action = 'system.switch'")
    assert.deepEqual(await flip("registration_closed", true), { changed: true, enabled: true })
    assert.deepEqual(await flip("registration_closed", true), { changed: false, enabled: true }, "the same again changes nothing")
    await owner(); await db.exec("set role anon"); assert.deepEqual((await db.query("select public.get_registration_status() s")).rows[0].s, { closed: true, message: "Closed while we prepare the new intake." })
    await as("sysGoogle"); await expectFail("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'foreman', null)", [], /Closed while we prepare the new intake/)
    await as("sysBasic"); await expectFail("insert into public.access_requests (requested_role) values ('foreman')", [], /Closed while we prepare the new intake/)
    assert.deepEqual((await db.query("select public.redeem_invite('ANYCODE') r")).rows[0].r, { ok: false, reason: "registration_closed" })
    await owner(); assert.equal((await db.query("select registration_completed_at from public.profiles where id = $1", [ids.sysGoogle])).rows[0].registration_completed_at, null, "nothing was sent to the administrators")
    assert.deepEqual(await flip("registration_closed", false), { changed: true, enabled: false })
    await as("sysGoogle"); assert.equal((await db.query("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'foreman', null) s")).rows[0].s, "pending")
    await as("sysBasic"); await db.query("insert into public.access_requests (requested_role) values ('foreman')")
    await owner(); assert.equal(await count("select count(*) n from public.audit_log where action = 'system.switch'"), before + 2)
  })

  await test("Pausing email stops the queue without losing anything; resuming hands the waiting emails out; bell-only kinds still close", async () => {
    await owner(); await db.query("update public.notifications set emailed_at = now() where emailed_at is null")
    const waiting = async (kind, title) => (await db.query("insert into public.notifications (user_id, kind, title) values ($1, $2, $3) returning id", [ids.sysBasic, kind, title])).rows[0].id
    await waiting("pin.assigned", "Needed while paused"); const bell = await waiting("pin.milestone", "Bell only while paused")
    await flip("email_paused", true, "")
    await owner(); await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)")
    assert.deepEqual((await db.query("select * from public.claim_email_batch(10)")).rows, [], "nothing is handed out while paused")
    await owner(); assert.equal(await count("select count(*) n from public.notifications where title = 'Needed while paused' and emailed_at is null and email_attempts = 0"), 1, "and nothing was used up, closed or counted")
    assert.equal(await count("select count(*) n from public.notifications where id = $1 and emailed_at is null", [bell]), 1)
    await flip("email_paused", false, "")
    await owner(); await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)")
    assert.deepEqual((await db.query("select title from public.claim_email_batch(10)")).rows.map((row) => row.title), ["Needed while paused"], "after resuming the waiting email goes out")
    await owner(); assert.equal(await count("select count(*) n from public.notifications where id = $1 and emailed_at is not null", [bell]), 1, "the bell-only one is closed without an email")
  })

  await test("Emergency off puts every control back to normal and records what was on; it signs nobody out and touches no data", async () => {
    await sup(); await db.query("select public.set_maintenance(true, 'Upgrading the database now.', null)")
    await sup(); await db.query("select public.set_feature_lock('quality', true, null, 'Switched off while we fix a problem.')")
    await flip("registration_closed", true); await flip("email_paused", true, "")
    const accounts = await count("select count(*) n from public.profiles"), loggedOut = await count("select count(*) n from public.profiles where force_logout_at is not null")
    await sup(); const result = (await db.query("select public.site_emergency_off() r")).rows[0].r
    assert.equal(result.maintenance, true); assert.deepEqual(result.features, ["quality"]); assert.deepEqual(result.switches, ["email_paused", "registration_closed"])
    await owner()
    assert.equal((await db.query("select maintenance_on from public.site_controls")).rows[0].maintenance_on, false); assert.equal(await count("select count(*) n from public.feature_locks where locked"), 0); assert.equal(await count("select count(*) n from public.system_switches where enabled"), 0)
    assert.equal(await count("select count(*) n from public.profiles"), accounts); assert.equal(await count("select count(*) n from public.profiles where force_logout_at is not null"), loggedOut, "nobody was signed out")
    const log = (await db.query("select details from public.audit_log where action = 'system.emergency_off'")).rows
    assert.equal(log.length, 1); assert.equal(log[0].details.maintenance_was_on, true)
    await sup(); const again = (await db.query("select public.site_emergency_off() r")).rows[0].r; assert.deepEqual(again, { maintenance: false, features: [], switches: [] }, "safe to press when nothing is on")
  })

  await test("The reports: email delivery, storage and the system activity log (only system actions)", async () => {
    await owner()
    await db.query("insert into public.email_log (user_id, status, detail) values ($1, 'failed', 'Brevo 401: Key not found'), ($1, 'sent', 'ok')", [ids.sysBasic])
    await db.query("insert into storage.buckets (id, name) values ('sys-test', 'sys-test') on conflict do nothing")
    await db.query("insert into storage.objects (bucket_id, name, metadata) values ('sys-test', 'a.png', '{\"size\": 1500}'), ('sys-test', 'b.png', '{\"size\": 500}')")
    await db.query("insert into public.audit_log (actor_id, action, details) values ($1, 'record.removed', '{}'::jsonb), ($1, 'pin.status', '{}'::jsonb)", [ids.sysSuper])
    await sup(); const email = (await db.query("select public.get_email_delivery(10) r")).rows[0].r
    assert.ok(email.failed_24h >= 1 && email.sent_24h >= 1); assert.ok(email.recent.length >= 2); assert.ok(email.recent.every((row) => row.detail.length <= 200))
    await sup(); const storage = (await db.query("select public.get_storage_capacity() r")).rows[0].r
    assert.ok(storage.database_bytes > 0); const bucket = storage.buckets.find((row) => row.bucket === "sys-test"); assert.deepEqual({ files: bucket.files, bytes: Number(bucket.bytes) }, { files: 2, bytes: 2000 })
    await sup(); const activity = (await db.query("select public.get_system_activity(100, 0) r")).rows[0].r
    const actions = new Set(activity.map((row) => row.action))
    assert.ok(actions.has("system.switch") && actions.has("system.emergency_off") && actions.has("maintenance.on"), [...actions].join(","))
    assert.ok(!actions.has("record.removed") && !actions.has("pin.status"), "role work and data actions are not part of the system log")
    await sup(); assert.equal((await db.query("select public.get_system_activity(2, 0) r")).rows[0].r.length, 2, "limited");
  })
}
