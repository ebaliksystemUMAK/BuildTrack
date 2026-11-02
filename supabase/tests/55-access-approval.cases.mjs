// Tests for 0016: the real approval path. Admin decisions run as the service role (Edge Function), not as the user.
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count }) {
  const asService = async () => {
    await db.exec("reset role")
    await db.exec("set role service_role")
  }
  const makeRequest = async (key, email, role = "engineer") => {
    await asOwner()
    ids[key] = (await db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, '{}'::jsonb, now()) returning id", [email])).rows[0].id
    await db.query("update public.profiles set identity_status = 'verified', email_verified_at = now() where id = $1", [ids[key]])
    await as(key)
    return (await db.query("insert into public.access_requests (user_id, requested_role, message) values ($1, $2, 'Site engineer for the demo project') returning id", [ids[key], role])).rows[0].id
  }

  await test("The Edge Function (service role) can APPROVE a request and the user becomes that role", async () => {
    const rq = await makeRequest("ap1", "approve1@x.test", "engineer")
    await asService()
    const claimed = await db.query("update public.access_requests set status = 'approved', decided_by = $2, decided_at = now(), decision_note = 'Welcome' where id = $1 and status = 'pending' returning id", [rq, ids.super])
    if (claimed.rows.length !== 1) throw new Error("service role could not approve the request")
    await db.query("update public.profiles set role = 'engineer', approved_by = $2 where id = $1", [ids.ap1, ids.super])
    await asOwner()
    const { rows } = await db.query("select p.role, r.status, r.decision_note from public.profiles p join public.access_requests r on r.user_id = p.id where p.id = $1", [ids.ap1])
    if (rows[0].role !== "engineer" || rows[0].status !== "approved" || rows[0].decision_note !== "Welcome") throw new Error(JSON.stringify(rows[0]))
  })

  await test("The Edge Function can DECLINE a request; the user stays a basic user and may ask again", async () => {
    const rq = await makeRequest("ap2", "decline1@x.test", "foreman")
    await asService()
    await expectOk("update public.access_requests set status = 'rejected', decided_by = $2, decided_at = now() where id = $1 and status = 'pending'", [rq, ids.super])
    await asOwner()
    if ((await db.query("select role from public.profiles where id = $1", [ids.ap2])).rows[0].role !== "user") throw new Error("role changed on decline")
    await as("ap2")
    await expectOk("insert into public.access_requests (user_id, requested_role, message) values ($1, 'client', 'Trying again as a client')", [ids.ap2])
  })

  await test("A request can only be decided once (the claim is atomic)", async () => {
    const rq = await makeRequest("ap3", "claim1@x.test", "client")
    await asService()
    const first = await db.query("update public.access_requests set status = 'approved' where id = $1 and status = 'pending' returning id", [rq])
    const second = await db.query("update public.access_requests set status = 'rejected' where id = $1 and status = 'pending' returning id", [rq])
    if (first.rows.length !== 1 || second.rows.length !== 0) throw new Error("the second admin was able to decide again")
  })

  await test("Users still cannot approve, edit or re-decide their own request", async () => {
    const rq = await makeRequest("ap4", "mine1@x.test", "engineer")
    await as("ap4")
    await expectFail("update public.access_requests set status = 'approved' where id = $1", [rq], /only cancel/)
    await expectFail("update public.access_requests set requested_role = 'client' where id = $1", [rq], /permission denied|only cancel/)
    const cancelled = await db.query("update public.access_requests set status = 'cancelled' where id = $1 returning id", [rq])
    if (cancelled.rows.length !== 1) throw new Error("user could not cancel their own request")
    // once cancelled, row-level security hides it from the update policy: nothing is changed
    const reopened = await db.query("update public.access_requests set status = 'pending' where id = $1 returning id", [rq])
    if (reopened.rows.length !== 0) throw new Error("user re-opened a decided request")
  })
}
