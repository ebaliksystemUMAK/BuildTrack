import assert from "node:assert/strict"

// Tests for 20261101210000_email_verification_and_codes: nobody reaches an administrator with an unproven email address; codes are single-use, short-lived and rate limited.
export default async function ({ db, ids, as, asOwner, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const hash = (n) => String(n).repeat(64).slice(0, 64)
  const newUser = async (email, provider, confirmedNow) => {
    await owner()
    const row = (await db.query("insert into auth.users (email, raw_app_meta_data, email_confirmed_at) values ($1, $2, $3) returning id", [email, JSON.stringify({ provider }), confirmedNow ? new Date().toISOString() : null])).rows[0]
    return row.id
  }
  const profile = async (id) => { await owner(); return (await db.query("select * from public.profiles where id = $1", [id])).rows[0] }

  await test("The verified flag: only the emailed sign-up confirmation sets it; Google, instant-confirm and admin-made accounts start unverified", async () => {
    const typed = await newUser("typed@verify.test", "email", false)            // "Confirm email" on: created unconfirmed ...
    assert.equal((await profile(typed)).email_verified_at, null)
    await owner(); await db.query("update auth.users set email_confirmed_at = now() where id = $1", [typed]) // ... confirmed when the code is typed
    assert.ok((await profile(typed)).email_verified_at, "typing the code verifies the address")
    const google = await newUser("goog@verify.test", "google", true), instant = await newUser("instant@verify.test", "email", true)
    assert.equal((await profile(google)).email_verified_at, null, "Google confirms at creation: not verified by us"); assert.equal((await profile(instant)).email_verified_at, null, "a project with Confirm email off would confirm at creation: not verified either")
    await owner(); await db.query("update auth.users set email_confirmed_at = now() + interval '1 minute' where id = $1", [typed])
    const first = (await profile(typed)).email_verified_at; assert.ok(first, "a later change never clears or moves it")
    ids.vGoogle = google; ids.vInstant = instant; ids.vTyped = typed
  })

  await test("Nobody can set the flag themselves", async () => {
    await as("vGoogle"); await expectFail("update public.profiles set email_verified_at = now() where id = auth.uid()", [], /permission denied/)
    await as(null); await expectFail("select public.mark_email_verified(gen_random_uuid())", [], /permission denied/)
    await as("vGoogle"); await expectFail("select public.mark_email_verified(auth.uid())", [], /permission denied/)
  })

  await test("An unverified Google account cannot send its registration to the administrators; after the code it can", async () => {
    await as("vGoogle")
    await expectFail("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'foreman', null)", [], /Verify your email first/)
    await owner(); assert.equal((await profile(ids.vGoogle)).registration_completed_at, null, "nothing was sent")
    assert.equal(await count("select count(*) n from public.notifications where kind = 'registration.new' and entity_id = $1", [ids.vGoogle]), 0, "the administrators were not told")
    await service(); await db.query("select public.mark_email_verified($1)", [ids.vGoogle])
    await as("vGoogle"); assert.equal((await db.query("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'foreman', null) s")).rows[0].s, "pending")
    await owner(); assert.equal(await count("select count(*) n from public.audit_log where action = 'account.email_verified' and target_id = $1", [ids.vGoogle]), 1, "the verification is in the audit log")
  })

  await test("A basic account cannot ask for elevated access, or use an invitation code, without a verified email", async () => {
    await owner(); await db.query("update public.profiles set status = 'active', role = 'user', identity_status = 'verified' where id = $1", [ids.vInstant])
    await as("vInstant")
    await expectFail("insert into public.access_requests (requested_role) values ('foreman')", [], /Verify your email first/)
    const redeem = (await db.query("select public.redeem_invite('ANYCODE') r")).rows[0].r; assert.deepEqual({ ok: redeem.ok, reason: redeem.reason }, { ok: false, reason: "email_not_verified" })
    await service(); await db.query("select public.mark_email_verified($1)", [ids.vInstant])
    await as("vInstant"); await db.query("insert into public.access_requests (requested_role) values ('foreman')")
  })

  await test("Codes: service role only; one every 60 seconds, five an hour; the older code stops working", async () => {
    for (const who of [null, "vGoogle"]) { if (who) await as(who); else { await owner(); await db.exec("set role anon") } await expectFail("select public.issue_email_code('a@b.test', 'reset', null, $1, 10)", [hash(1)], /permission denied/); await expectFail("select public.consume_email_code('a@b.test', 'reset', $1)", [hash(1)], /permission denied/) }
    await service()
    await db.query("select public.issue_email_code('Limit@Test.Test', 'reset', null, $1, 10)", [hash(1)])
    await expectFail("select public.issue_email_code('limit@test.test', 'reset', null, $1, 10)", [hash(2)], /Wait a minute/)
    assert.equal((await db.query("select public.issue_email_code('limit@test.test', 'register', null, $1, 10) id", [hash(3)])).rows[0].id.length, 36, "another purpose is counted separately")
    await owner(); await db.query("update public.email_codes set created_at = now() - interval '2 minutes' where email = 'limit@test.test'")
    await service(); await db.query("select public.issue_email_code('limit@test.test', 'reset', null, $1, 10)", [hash(4)])
    assert.equal((await db.query("select public.consume_email_code('limit@test.test', 'reset', $1) r", [hash(1)])).rows[0].r.ok, false, "the first code was replaced by the second")
    assert.equal((await db.query("select public.consume_email_code('limit@test.test', 'reset', $1) r", [hash(4)])).rows[0].r.ok, true)
    await owner(); await db.query("update public.email_codes set created_at = now() - interval '2 minutes' where email = 'limit@test.test'")
    await service()
    for (const n of [5, 6, 7]) { await db.query("select public.issue_email_code('limit@test.test', 'reset', null, $1, 10)", [hash(n)]); await owner(); await db.query("update public.email_codes set created_at = now() - interval '3 minutes' where email = 'limit@test.test'"); await service() }
    await expectFail("select public.issue_email_code('limit@test.test', 'reset', null, $1, 10)", [hash(8)], /Too many codes/)
  })

  await test("A code works once, for the right address and purpose, for ten minutes, with five tries", async () => {
    await service()
    const user = ids.vTyped
    await db.query("select public.issue_email_code('once@test.test', 'reset', $1, $2, 10)", [user, hash(1)])
    const wrongPurpose = (await db.query("select public.consume_email_code('once@test.test', 'register', $1) r", [hash(1)])).rows[0].r; assert.deepEqual(wrongPurpose, { ok: false, reason: "invalid" })
    const wrongAddress = (await db.query("select public.consume_email_code('other@test.test', 'reset', $1) r", [hash(1)])).rows[0].r; assert.equal(wrongAddress.ok, false)
    const right = (await db.query("select public.consume_email_code('ONCE@test.test', 'reset', $1) r", [hash(1)])).rows[0].r; assert.deepEqual(right, { ok: true, user_id: user })
    assert.equal((await db.query("select public.consume_email_code('once@test.test', 'reset', $1) r", [hash(1)])).rows[0].r.ok, false, "the second use fails")
    // five wrong tries lock the code, even for the right answer afterwards
    await db.query("select public.issue_email_code('lock@test.test', 'reset', $1, $2, 10)", [user, hash(1)])
    for (let i = 0; i < 4; i++) assert.deepEqual((await db.query("select public.consume_email_code('lock@test.test', 'reset', $1) r", [hash(9)])).rows[0].r, { ok: false, reason: "invalid" })
    assert.deepEqual((await db.query("select public.consume_email_code('lock@test.test', 'reset', $1) r", [hash(9)])).rows[0].r, { ok: false, reason: "locked" })
    assert.deepEqual((await db.query("select public.consume_email_code('lock@test.test', 'reset', $1) r", [hash(1)])).rows[0].r, { ok: false, reason: "locked" }, "the right answer after five wrong ones is refused")
    // expiry
    await db.query("select public.issue_email_code('old@test.test', 'reset', $1, $2, 10)", [user, hash(1)])
    await owner(); await db.query("update public.email_codes set expires_at = now() - interval '1 second' where email = 'old@test.test'")
    await service(); assert.equal((await db.query("select public.consume_email_code('old@test.test', 'reset', $1) r", [hash(1)])).rows[0].r.ok, false, "an expired code is refused")
    await owner(); assert.equal(await count("select count(*) n from information_schema.table_privileges where table_name = 'email_codes' and grantee in ('anon', 'authenticated')"), 0, "the table is not reachable by the app")
  })
}
