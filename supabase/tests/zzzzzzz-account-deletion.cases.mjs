import assert from "node:assert/strict"

// Tests for 20261101230000_account_deletion: a deletion either removes an account that has no records, or closes one that has records and keeps every record.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role"); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  await addUser("adSuper", "super_admin")
  await addUser("adOther", "super_admin")
  await addUser("adAdmin", "admin")
  await addUser("adClean", "foreman") // never did anything
  await addUser("adWorker", "engineer") // has a record
  await db.query("insert into public.whitelisted_emails (email, assigned_role, created_by) values ('adworker-made@test.local', 'client', $1)", [ids.adWorker])
  await db.query("insert into public.identity_verifications (user_id, id_type, id_last4, front_path, selfie_path, status) values ($1, 'passport', '1234', 'f/path.jpg', 's/path.jpg', 'pending')", [ids.adWorker]).catch(() => null)
  await db.query("insert into public.notifications (user_id, kind, title) values ($1, 'pin.assigned', 'A notice')", [ids.adWorker])
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'users.view') on conflict do nothing", [ids.adAdmin])

  const preview = async (who) => { await service(); return (await db.query("select public.account_delete_preview($1) p", [ids[who]])).rows[0].p }

  await test("Only the backend can ask: nobody signed in, no visitor, no Super Admin from the browser", async () => {
    for (const role of ["anon", "authenticated"]) {
      await owner(); await db.exec(`set role ${role}`)
      for (const call of ["select public.account_record_counts(gen_random_uuid())", "select public.account_delete_preview(gen_random_uuid())", "select public.account_delete_prepare(gen_random_uuid(), gen_random_uuid())", "select public.close_account(gen_random_uuid(), gen_random_uuid(), 'x')"])
        await expectFail(call, [], /permission denied/)
    }
    await as("adSuper")
    await expectFail("select public.close_account(gen_random_uuid(), gen_random_uuid(), 'reason here')", [], /permission denied/)
  })

  await test("The preview tells the truth: no records = complete deletion, any record = close and keep", async () => {
    const clean = await preview("adClean"), worker = await preview("adWorker")
    assert.equal(clean.mode, "delete"); assert.equal(clean.record_total, 0); assert.equal(clean.already_closed, false)
    assert.equal(worker.mode, "close"); assert.ok(worker.record_total >= 1); assert.ok(Object.keys(worker.records).some((key) => key.includes("whitelisted_emails")), JSON.stringify(worker.records))
    await service(); assert.equal((await db.query("select public.account_delete_preview(gen_random_uuid()) p")).rows[0].p, null)
    assert.equal((await preview("adAdmin")).mode, "delete", "an Admin who did nothing can be removed completely")
  })

  await test("Complete deletion is refused for an account with records, for yourself and for a Super Admin", async () => {
    await service()
    await expectFail("select public.account_delete_prepare($1, $2)", [ids.adWorker, ids.adSuper], /only be closed, not deleted/)
    await expectFail("select public.account_delete_prepare($1, $1)", [ids.adSuper], /cannot delete your own/)
    await expectFail("select public.account_delete_prepare($1, $2)", [ids.adOther, ids.adSuper], /Super Admin account cannot be deleted/)
    await expectFail("select public.account_delete_prepare(gen_random_uuid(), $1)", [ids.adSuper], /does not exist/)
    const ok = (await db.query("select public.account_delete_prepare($1, $2) r", [ids.adClean, ids.adSuper])).rows[0].r
    assert.deepEqual(ok.paths, []); assert.equal(ok.snapshot.email, "adclean@test.local"); assert.equal(ok.snapshot.role, "foreman")
    await owner(); assert.equal(await count("select count(*) n from public.profiles where id = $1", [ids.adClean]), 1, "preparing deletes nothing")
  })

  await test("A complete deletion really removes a recordless account (sign-in and profile), nothing else", async () => {
    await owner()
    const before = await count("select count(*) n from public.profiles")
    await db.query("delete from auth.users where id = $1", [ids.adClean])
    assert.equal(await count("select count(*) n from public.profiles"), before - 1)
    assert.equal(await count("select count(*) n from public.profiles where id = $1", [ids.adWorker]), 1)
  })

  await test("Closing an account with records: personal data wiped, every record stays pointing at the same account", async () => {
    await service()
    await expectFail("select public.close_account($1, $1, 'a good reason')", [ids.adSuper], /cannot delete your own/)
    await expectFail("select public.close_account($1, $2, 'a good reason')", [ids.adOther, ids.adSuper], /Super Admin account cannot be deleted/)
    const recordsBefore = await count("select count(*) n from public.whitelisted_emails where created_by = $1", [ids.adWorker])
    const result = (await db.query("select public.close_account($1, $2, 'Left the company, confirmed by HR') r", [ids.adWorker, ids.adSuper])).rows[0].r
    assert.ok(Array.isArray(result.paths))
    await owner()
    const row = (await db.query("select full_name, email, phone, status, identity_status, email_verified_at from public.profiles where id = $1", [ids.adWorker])).rows[0]
    assert.equal(row.full_name, "Deleted account"); assert.equal(row.email, `deleted-${ids.adWorker}@erased.invalid`); assert.equal(row.phone, null); assert.equal(row.status, "disabled"); assert.equal(row.email_verified_at, null)
    assert.equal(await count("select count(*) n from public.whitelisted_emails where created_by = $1", [ids.adWorker]), recordsBefore, "the record they made is untouched and still points at them")
    assert.equal(await count("select count(*) n from public.notifications where user_id = $1", [ids.adWorker]), 0, "their own notices are gone")
    assert.equal(await count("select count(*) n from public.identity_verifications where user_id = $1", [ids.adWorker]), 0, "ID records are gone")
    const log = (await db.query("select details from public.audit_log where action = 'account.closed' and target_id = $1", [ids.adWorker])).rows
    assert.equal(log.length, 1); assert.equal(log[0].details.reason, "Left the company, confirmed by HR"); assert.equal(log[0].details.previous.email, "adworker@test.local")
    await service(); await expectFail("select public.close_account($1, $2, 'again please')", [ids.adWorker, ids.adSuper], /already closed/)
    assert.equal((await preview("adWorker")).already_closed, true)
  })

  await test("Closing an Admin also removes their permissions", async () => {
    await service()
    await db.query("insert into public.whitelisted_emails (email, assigned_role, created_by) values ('adadmin-made@test.local', 'client', $1)", [ids.adAdmin])
    assert.equal((await preview("adAdmin")).mode, "close")
    await db.query("select public.close_account($1, $2, 'Admin role ended')", [ids.adAdmin, ids.adSuper])
    await owner(); assert.equal(await count("select count(*) n from public.admin_permissions where user_id = $1", [ids.adAdmin]), 0)
  })
}
