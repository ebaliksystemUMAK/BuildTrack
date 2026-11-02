import assert from "node:assert/strict"

// Tests for 20261102140000_system_logs: the administrator and system transactions, categorised and identifiable; table-change entries stay out.
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  await owner()
  await addUser("slSuper", "super_admin")
  await addUser("slAdmin", "admin") // has users.view by default: still not allowed here
  await addUser("slTarget", "foreman")
  const sup = async () => as("slSuper", "aal2")
  const log = async (args = {}) => { await sup(); return (await db.query("select public.get_system_log($1, $2, $3, $4, $5, $6) r", [args.category ?? null, args.search ?? null, args.from ?? null, args.to ?? null, args.limit ?? 200, args.offset ?? 0])).rows[0].r }
  const add = (action, details = {}, actor = "slSuper", target = "slTarget") => db.query("insert into public.audit_log (actor_id, target_id, action, details) values ($1, $2, $3, $4)", [actor ? ids[actor] : null, target ? ids[target] : null, action, JSON.stringify(details)])
  const big = { filler: "x".repeat(5000) }

  await test("Only a Super Admin with the authenticator can read the system log; categories are fixed", async () => {
    for (const call of ["select public.get_system_log()"]) {
      await owner(); await db.exec("set role anon"); await expectFail(call, [], /permission denied/)
      await as("slAdmin", "aal2"); await expectFail(call, [], /Only a Super Admin/)
      await as("slSuper", "aal1"); await expectFail(call, [], /Only a Super Admin/)
    }
    await sup(); await expectFail("select public.get_system_log('nonsense')", [], /Unknown category/)
    await owner()
    const cat = async (action) => (await db.query("select public.system_log_category($1) c", [action])).rows[0].c
    for (const [action, expected] of [["user.create", "accounts"], ["profile.role_changed", "accounts"], ["oauth.blocked", "accounts"], ["account.closed", "accounts"], ["maintenance.on", "system"], ["settings.update", "system"], ["email.test", "system"], ["project.purged", "data"], ["record.removed", "data"], ["migration.x", "data"], ["weird", "other"], ["pins.update", null], ["qa_work_attempts.insert", null], ["blueprint_annotations.delete", null], [null, null]]) assert.equal(await cat(action), expected, String(action))
  })

  await test("The log shows the transactions with who, what, to whom and when, and leaves out plain table changes", async () => {
    await owner()
    await add("user.create", { role: "foreman", email: "new@sl.test" }); await add("profile.role_changed", { from: "user", to: "foreman" }); await add("maintenance.on", { message: "Upgrading the database tonight" }, null, null)
    await add("project.removed", { code: "SL-1" }); await add("pins.update", { note: "a work change" }); await add("pin_qa_submissions.insert", {})
    const rows = await log()
    const actions = rows.map((row) => row.action)
    for (const action of ["user.create", "profile.role_changed", "maintenance.on", "project.removed"]) assert.ok(actions.includes(action), action)
    assert.ok(!actions.includes("pins.update") && !actions.includes("pin_qa_submissions.insert"), "plain table changes stay in the Company Records and Audits page")
    const created = rows.find((row) => row.action === "user.create")
    assert.equal(created.category, "accounts"); assert.ok(created.actor_name && created.actor_email); assert.ok(created.target_name); assert.equal(created.details.email, "new@sl.test"); assert.ok(created.created_at)
    assert.equal(rows.find((row) => row.action === "maintenance.on").actor_name, "System", "an action with no person is shown as System")
    assert.deepEqual(rows.map((row) => row.created_at), [...rows.map((row) => row.created_at)].sort().reverse(), "newest first")
  })

  await test("Filters: category, search (action, people, details), dates, paging; a huge detail is not sent", async () => {
    await owner(); await add("user.disable", { reason: "Shared login seen twice" }); await add("record.removed", big)
    assert.ok((await log({ category: "accounts" })).every((row) => row.category === "accounts"))
    assert.ok((await log({ category: "system" })).every((row) => row.category === "system")); assert.ok((await log({ category: "data" })).some((row) => row.action === "project.removed"))
    assert.ok((await log({ search: "shared login" })).some((row) => row.action === "user.disable"), "search finds words in the details")
    assert.ok((await log({ search: "slTarget" })).length >= 3, "search finds the person (name or email)"); assert.ok((await log({ search: "maintenance" })).every((row) => /maintenance/i.test(JSON.stringify(row))))
    assert.equal((await log({ search: "zzzz-nothing-matches" })).length, 0); assert.ok((await log({ search: "50%_" })).length === 0, "wildcard characters are plain text")
    const future = new Date(Date.now() + 86_400_000).toISOString(), past = new Date(Date.now() - 86_400_000).toISOString()
    assert.equal((await log({ from: future })).length, 0); assert.ok((await log({ from: past })).length > 0); assert.equal((await log({ to: past })).length, 0)
    const two = await log({ limit: 2 }), next = await log({ limit: 2, offset: 2 })
    assert.equal(two.length, 2); assert.ok(next.length >= 1 && !next.some((row) => two.some((first) => first.id === row.id)), "pages do not overlap")
    assert.deepEqual((await log({ search: "record.removed" }))[0].details, { truncated: true }, "an oversized detail is replaced, never sent")
  })
}
