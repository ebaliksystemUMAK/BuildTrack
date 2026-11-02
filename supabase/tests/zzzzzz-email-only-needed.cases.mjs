import assert from "node:assert/strict"

// Tests for 20261101220000_email_only_needed_kinds: bell-only notifications are never emailed, everything that matters still is.
export default async function ({ db, ids, asOwner, addUser, test, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role") }
  await owner()
  await addUser("eoNeed", "foreman")
  await db.query("update public.notifications set emailed_at = now() where emailed_at is null")

  const note = async (kind, title) => { await owner(); return (await db.query("insert into public.notifications (user_id, kind, title) values ($1, $2, $3) returning id", [ids.eoNeed, kind, title])).rows[0].id }
  const claim = async () => { await service(); const rows = (await db.query("select * from public.claim_email_batch(50)")).rows; await owner(); return rows }
  const state = async (id) => { await owner(); return (await db.query("select emailed_at is not null as closed, (select count(*)::int from public.email_log l where l.notification_id = n.id) as logs from public.notifications n where n.id = $1", [id])).rows[0] }

  await test("only needed: bell-only kinds are closed without an email or a log line; needed kinds are still handed out", async () => {
    const inapp = ["pin.milestone", "pin.resumed", "report.submitted", "report.reviewed", "qa.defect_closed", "project.archived", "project.restored", "project.manager_removed", "attendance.concern_resolved"]
    const quiet = []
    for (const kind of inapp) quiet.push(await note(kind, "Bell only " + kind))
    const needed = ["qa.requested", "qa.result", "qa.defect", "pin.assigned", "pin.returned", "access.granted", "project.manager_assigned", "pin.due", "report.reopened"]
    for (const kind of needed) await note(kind, "Needed " + kind)
    const rows = await claim()
    assert.deepEqual(rows.map((row) => row.title).sort(), needed.map((kind) => "Needed " + kind).sort(), "exactly the needed kinds are emailed")
    for (const id of quiet) assert.deepEqual(await state(id), { closed: true, logs: 0 }, "closed quietly: no email, no log line")
  })

  await test("only needed: a security notice is still always emailed, even next to bell-only ones", async () => {
    await owner()
    await db.query("update public.notifications set emailed_at = now() where emailed_at is null")
    await note("account.reactivated", "Security notice")
    await note("report.submitted", "Daily report")
    const rows = await claim()
    assert.deepEqual(rows.map((row) => row.title), ["Security notice"])
  })

  await test("only needed: the function is not callable by signed-in users or visitors", async () => {
    await owner()
    for (const role of ["anon", "authenticated"]) {
      await db.exec("reset role"); await db.exec(`set role ${role}`)
      let refused = false
      try { await db.query("select * from public.claim_email_batch(1)") } catch (error) { refused = /permission denied/.test(String(error.message)) }
      assert.ok(refused, role + " must not claim the email queue")
      await owner()
    }
    assert.equal(await count("select count(*) n from public.notifications where kind = 'report.submitted' and emailed_at is null"), 0)
  })
}
