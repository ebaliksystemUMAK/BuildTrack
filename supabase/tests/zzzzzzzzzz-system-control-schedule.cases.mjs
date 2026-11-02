import assert from "node:assert/strict"

// Tests for 20261102120000_system_control_schedule_and_lockouts: scheduled maintenance windows and the read-only lockout watch.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  await addUser("swSuper", "super_admin")
  await addUser("swAdmin", "admin")
  await addUser("swBasic", "user")
  await db.query("update public.site_controls set maintenance_on = false, maintenance_returns_at = null, updated_by = null where id = 1")
  await db.query("update public.maintenance_windows set status = 'cancelled' where status in ('scheduled', 'active')")

  const sup = async () => as("swSuper", "aal2")
  const inMinutes = (n) => new Date(Date.now() + n * 60_000).toISOString()
  const schedule = async (startMin, endMin, message = "Upgrading the database tonight.") => { await sup(); return (await db.query("select public.schedule_maintenance($1, $2, $3) r", [inMinutes(startMin), inMinutes(endMin), message])).rows[0].r.id }
  const apply = async () => { await service(); return (await db.query("select public.apply_maintenance_windows() r")).rows[0].r }
  const window = async (id) => { await owner(); return (await db.query("select status, end_note, activated_at is not null as activated from public.maintenance_windows where id = $1", [id])).rows[0] }
  const maintenance = async () => { await owner(); return (await db.query("select maintenance_on, maintenance_message, maintenance_returns_at, updated_by from public.site_controls where id = 1")).rows[0] }
  const clock = async (id, startsMinutesAgo, endsMinutesAgo) => { await owner(); await db.query("update public.maintenance_windows set starts_at = now() - make_interval(mins => $2), ends_at = now() - make_interval(mins => $3) where id = $1", [id, startsMinutesAgo, endsMinutesAgo]) }
  const reset = async () => { await owner(); await db.query("update public.maintenance_windows set status = 'cancelled' where status in ('scheduled', 'active')"); await db.query("update public.site_controls set maintenance_on = false, maintenance_returns_at = null, updated_by = null where id = 1") }

  await test("Only a Super Admin with the authenticator can read, schedule or cancel; nobody but the backend can apply", async () => {
    const calls = ["select public.get_maintenance_windows()", "select public.schedule_maintenance(now() + interval '1 hour', now() + interval '2 hours', 'Maintenance tonight please.')", "select public.cancel_maintenance_window(gen_random_uuid())", "select public.get_lockout_watch()"]
    for (const call of calls) {
      await owner(); await db.exec("set role anon"); await expectFail(call, [], /permission denied/)
      await as("swAdmin", "aal2"); await expectFail(call, [], /Only a Super Admin/)
      await as("swBasic"); await expectFail(call, [], /Only a Super Admin/)
      await as("swSuper", "aal1"); await expectFail(call, [], /Only a Super Admin/)
    }
    for (const who of [null, "swSuper"]) { if (who) await as(who, "aal2"); else { await owner(); await db.exec("set role anon") } await expectFail("select public.apply_maintenance_windows()", [], /permission denied/) }
    await owner(); await db.exec("set role authenticated"); await expectFail("select * from public.maintenance_windows", [], /permission denied/)
  })

  await test("A window must be sensible: future, at most 30 days ahead, 5 minutes to 24 hours, a message, and no overlap", async () => {
    await sup()
    await expectFail("select public.schedule_maintenance($1, $2, 'Upgrading the database tonight.')", [inMinutes(-5), inMinutes(60)], /must be in the future/)
    await expectFail("select public.schedule_maintenance($1, $2, 'Upgrading the database tonight.')", [inMinutes(60 * 24 * 31), inMinutes(60 * 24 * 31 + 60)], /30 days ahead/)
    await expectFail("select public.schedule_maintenance($1, $2, 'Upgrading the database tonight.')", [inMinutes(120), inMinutes(60)], /after the start/)
    await expectFail("select public.schedule_maintenance($1, $2, 'Upgrading the database tonight.')", [inMinutes(60), inMinutes(60 * 26)], /at most 24 hours/)
    await expectFail("select public.schedule_maintenance($1, $2, 'Upgrading the database tonight.')", [inMinutes(60), inMinutes(62)], /at least 5 minutes/)
    await expectFail("select public.schedule_maintenance($1, $2, 'no')", [inMinutes(60), inMinutes(120)], /Write the message/)
    await expectFail("select public.schedule_maintenance($1, $2, $3)", [inMinutes(60), inMinutes(120), "x".repeat(501)], /Write the message/)
    await expectFail("select public.schedule_maintenance(null, $1, 'Upgrading the database tonight.')", [inMinutes(120)], /Choose when/)
    const first = await schedule(60, 120)
    await sup(); await expectFail("select public.schedule_maintenance($1, $2, 'Another window at once.')", [inMinutes(90), inMinutes(150)], /overlaps/)
    await schedule(180, 240, "A later window that does not overlap.")
    await owner(); assert.equal(await count("select count(*) n from public.audit_log where action = 'maintenance.schedule'"), 2)
    await sup(); const listed = (await db.query("select public.get_maintenance_windows() r")).rows[0].r
    assert.equal(listed.windows.length, 2); assert.equal(typeof listed.scheduler_ready, "boolean"); assert.equal(listed.windows.find((row) => row.id === first).status, "scheduled")
    await reset()
  })

  await test("At the start the maintenance switches on by itself with the message and return time; at the end it switches off by itself; each step is audited and repeats change nothing", async () => {
    await reset()
    const id = await schedule(30, 90, "Planned upgrade of the database.")
    assert.deepEqual(await apply(), { switched_on: 0, switched_off: 0, skipped: 0 }, "not yet")
    assert.equal((await maintenance()).maintenance_on, false)
    await clock(id, 1, -59) // started a minute ago, ends in 59 minutes
    assert.deepEqual(await apply(), { switched_on: 1, switched_off: 0, skipped: 0 })
    const on = await maintenance(); assert.equal(on.maintenance_on, true); assert.equal(on.maintenance_message, "Planned upgrade of the database."); assert.ok(on.maintenance_returns_at); assert.equal(on.updated_by, null)
    assert.equal((await window(id)).status, "active")
    assert.deepEqual(await apply(), { switched_on: 0, switched_off: 0, skipped: 0 }, "running again changes nothing")
    await owner(); await db.exec("reset role"); await db.exec("set role anon"); const status = (await db.query("select public.get_site_status() s")).rows[0].s
    assert.ok(JSON.stringify(status).includes("Planned upgrade of the database."), "people see the message through the normal status")
    await clock(id, 61, 1) // over a minute ago
    assert.deepEqual(await apply(), { switched_on: 0, switched_off: 1, skipped: 0 })
    assert.equal((await maintenance()).maintenance_on, false); const done = await window(id); assert.equal(done.status, "done"); assert.match(done.end_note, /Switched off at the end/)
    await owner(); assert.equal(await count("select count(*) n from public.audit_log where action in ('maintenance.scheduled_on', 'maintenance.scheduled_off')"), 2)
  })

  await test("Maintenance switched on by hand is never overridden: a window that comes due is skipped, and a window ending leaves hand-made changes alone", async () => {
    await reset()
    await sup(); await db.query("select public.set_maintenance(true, 'Switched on by hand for a fix.', null)")
    const due = await schedule(30, 90, "Window that comes due during a manual maintenance.")
    await clock(due, 1, -59)
    assert.deepEqual(await apply(), { switched_on: 0, switched_off: 0, skipped: 1 })
    assert.equal((await window(due)).status, "skipped"); assert.match((await window(due)).end_note, /already on/)
    assert.equal((await maintenance()).maintenance_message, "Switched on by hand for a fix.", "the hand-made maintenance is untouched")
    await reset()
    const id = await schedule(30, 90, "Window that will be edited by hand.")
    await clock(id, 1, -59); await apply()
    await sup(); await db.query("select public.set_maintenance(true, 'Extended by hand: still working on it.', null)")
    await clock(id, 61, 1)
    assert.deepEqual(await apply(), { switched_on: 0, switched_off: 0, skipped: 0 })
    assert.equal((await maintenance()).maintenance_on, true, "still on: a person took over"); assert.match((await window(id)).end_note, /changed by hand/)
    await reset()
  })

  await test("A window that was missed completely is skipped, never switched on late", async () => {
    await reset()
    const id = await schedule(30, 90, "Window the scheduler never saw.")
    await clock(id, 120, 60)
    assert.deepEqual(await apply(), { switched_on: 0, switched_off: 0, skipped: 1 })
    assert.equal((await maintenance()).maintenance_on, false); assert.match((await window(id)).end_note, /over before it could start/)
  })

  await test("Cancelling: a scheduled window just disappears; an active one is ended now and switches off only its own maintenance; a finished one cannot be cancelled", async () => {
    await reset()
    const later = await schedule(60, 120)
    await sup(); assert.equal((await db.query("select public.cancel_maintenance_window($1) r", [later])).rows[0].r.result, "cancelled"); assert.equal((await window(later)).status, "cancelled")
    const live = await schedule(30, 90, "Window ended early by the Super Admin.")
    await clock(live, 1, -59); await apply(); assert.equal((await maintenance()).maintenance_on, true)
    await sup(); assert.equal((await db.query("select public.cancel_maintenance_window($1) r", [live])).rows[0].r.result, "ended now")
    assert.equal((await maintenance()).maintenance_on, false); assert.equal((await window(live)).status, "done")
    await sup(); await expectFail("select public.cancel_maintenance_window($1)", [live], /already over/)
    await sup(); await expectFail("select public.cancel_maintenance_window(gen_random_uuid())", [], /does not exist/)
    await owner(); assert.equal(await count("select count(*) n from public.audit_log where action = 'maintenance.schedule_cancel'"), 2)
  })

  await test("The lockout watch lists locked codes, invitation-code lockouts and blocked Google sign-ins, and nothing else", async () => {
    await owner()
    const hash = "a".repeat(64)
    await db.query("insert into public.email_codes (purpose, email, code_hash, attempts, expires_at) values ('reset', 'attacker@example.test', $1, 5, now() + interval '5 minutes'), ('reset', 'fine@example.test', $1, 1, now() + interval '5 minutes')", [hash])
    for (let i = 0; i < 8; i++) await db.query("insert into public.invite_attempts (user_id, ok) values ($1, false)", [ids.swBasic])
    await db.query("insert into public.audit_log (actor_id, action, details) values (null, 'oauth.blocked', '{\"email\": \"stranger@example.test\", \"reason\": \"no registered account\"}'::jsonb)")
    await sup(); const watch = (await db.query("select public.get_lockout_watch() r")).rows[0].r
    assert.ok(watch.codes_requested_24h >= 2); assert.ok(Number(watch.wrong_tries_24h) >= 6)
    const locked = watch.locked_codes.map((row) => row.email)
    assert.ok(locked.includes("attacker@example.test"), "a code with five wrong tries is listed"); assert.ok(!locked.includes("fine@example.test"), "a code with one wrong try is not")
    assert.equal(watch.locked_codes.find((row) => row.email === "attacker@example.test").still_locked, true); assert.ok(watch.locked_codes.every((row) => row.attempts >= 5))
    const mine = watch.invite_attempts.filter((row) => Number(row.failed) === 8)
    assert.equal(mine.length, 1, "the account with eight wrong invitation codes is listed once"); assert.equal(mine[0].locked, true); assert.ok(watch.invite_attempts.every((row) => Number(row.failed) >= 3), "only people with at least three wrong tries")
    assert.ok(watch.blocked_signins_7d >= 1); assert.equal(watch.blocked_signins[0].email, "stranger@example.test")
    assert.ok(!JSON.stringify(watch).includes(hash), "a code hash never leaves the database")
  })
}
