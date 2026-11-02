import assert from "node:assert/strict"

// Tests for 20261102000000_email_code_check: a code can be checked without being used up; the password change still consumes it.
export default async function ({ db, ids, as, asOwner, test, expectFail }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const hash = (n) => String(n).repeat(64).slice(0, 64)
  const check = async (email, purpose, h) => (await db.query("select public.check_email_code($1, $2, $3) r", [email, purpose, h])).rows[0].r
  const consume = async (email, purpose, h) => (await db.query("select public.consume_email_code($1, $2, $3) r", [email, purpose, h])).rows[0].r

  await test("Only the backend can check a code", async () => {
    await owner(); await db.exec("set role anon")
    await expectFail("select public.check_email_code('a@b.test', 'reset', $1)", [hash(1)], /permission denied/)
    await as("vGoogle")
    await expectFail("select public.check_email_code('a@b.test', 'reset', $1)", [hash(1)], /permission denied/)
  })

  await test("A right code is confirmed again and again without being used; the password change still uses it once", async () => {
    await service()
    await db.query("select public.issue_email_code('peek@test.test', 'reset', $1, $2, 10)", [ids.vTyped, hash(1)])
    assert.deepEqual(await check("Peek@Test.test", "reset", hash(1)), { ok: true })
    assert.deepEqual(await check("peek@test.test", "reset", hash(1)), { ok: true }, "checking does not use it up")
    assert.deepEqual(await consume("peek@test.test", "reset", hash(1)), { ok: true, user_id: ids.vTyped })
    assert.equal((await check("peek@test.test", "reset", hash(1))).ok, false, "after the password change the code is gone")
  })

  await test("Wrong tries are counted and lock the code, for the check and the change together", async () => {
    await service()
    await db.query("select public.issue_email_code('peeklock@test.test', 'reset', $1, $2, 10)", [ids.vTyped, hash(1)])
    for (let i = 0; i < 3; i++) assert.deepEqual(await check("peeklock@test.test", "reset", hash(9)), { ok: false, reason: "invalid" })
    assert.deepEqual(await consume("peeklock@test.test", "reset", hash(9)), { ok: false, reason: "invalid" }, "the fourth wrong try counts too")
    assert.deepEqual(await check("peeklock@test.test", "reset", hash(9)), { ok: false, reason: "locked" })
    assert.deepEqual(await check("peeklock@test.test", "reset", hash(1)), { ok: false, reason: "locked" }, "the right answer after five wrong ones is refused")
  })

  await test("The purpose, the address and the expiry are respected", async () => {
    await service()
    await db.query("select public.issue_email_code('peekrules@test.test', 'reset', $1, $2, 10)", [ids.vTyped, hash(1)])
    assert.equal((await check("peekrules@test.test", "register", hash(1))).ok, false, "a reset code never opens a register check")
    assert.equal((await check("other@test.test", "reset", hash(1))).ok, false)
    await owner(); await db.query("update public.email_codes set expires_at = now() - interval '1 second' where email = 'peekrules@test.test'")
    await service(); assert.equal((await check("peekrules@test.test", "reset", hash(1))).ok, false, "expired")
  })
}
