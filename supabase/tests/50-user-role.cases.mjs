// Tests for 0012 + 0013: base `user` role on sign-up, and the "request elevated access" state machine.
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count }) {
  const signUp = async (key, meta = {}) => {
    await asOwner()
    const { rows } = await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [`${key}@signup.test`, JSON.stringify(meta)])
    ids[key] = rows[0].id
    await db.query("update public.profiles set identity_status = 'verified' where id = $1", [rows[0].id]) // these tests are about the request flow, not identity (see 99-identity-privacy)
    return (await db.query("select * from public.profiles where id = $1", [rows[0].id])).rows[0]
  }

  await test("Sign-up creates an ACTIVE basic user with no approval step", async () => {
    const p = await signUp("newbie", { full_name: "New Bie", phone: "0917", company: "ACME", position: "Mason" })
    if (p.role !== "user" || p.status !== "active") throw new Error(`got ${p.role}/${p.status}`)
    if (p.full_name !== "New Bie" || p.company !== "ACME") throw new Error("details not copied")
  })

  await test("A role (or status) sent in sign-up metadata is ignored", async () => {
    const p = await signUp("sneaky", { role: "super_admin", status: "active", app_role: "admin", full_name: "Sneaky" })
    if (p.role !== "user") throw new Error(`escalated to ${p.role}`)
  })

  await test("Google-style metadata: name and avatar are picked up; non-https or oversized avatar is dropped; long text is trimmed", async () => {
    const g = await signUp("googler", { name: "Gina Google", picture: "https://lh3.googleusercontent.com/a/photo" })
    if (g.full_name !== "Gina Google" || !g.avatar_url?.startsWith("https://")) throw new Error("google details missing")
    const bad = await signUp("badavatar", { full_name: "x".repeat(300), picture: "http://insecure.example/a.png" })
    if (bad.avatar_url !== null) throw new Error("http avatar accepted")
    if (bad.full_name.length !== 120) throw new Error("name not trimmed")
    const huge = await signUp("hugeavatar", { picture: "https://x.example/" + "a".repeat(600) })
    if (huge.avatar_url !== null) throw new Error("oversized avatar accepted")
  })

  await test("A basic user sees no projects, blueprints, pins or teams", async () => {
    await as("newbie", "aal2")
    for (const table of ["projects", "project_members", "blueprints", "blueprint_revisions", "pins", "pin_events", "pin_photos"]) {
      if ((await count(`select count(*) n from public.${table}`)) !== 0) throw new Error(`user sees ${table}`)
    }
    if ((await db.query("select * from public.get_project_team($1)", [ids.p1])).rows.length) throw new Error("user sees a team")
    if ((await db.query("select * from public.get_activity()")).rows.length) throw new Error("user sees activity")
  })

  await test("A basic user cannot change their own role or status", async () => {
    await as("newbie")
    await expectFail("update public.profiles set role = 'engineer' where id = $1", [ids.newbie], /permission denied/)
    await expectFail("update public.profiles set status = 'active' where id = $1", [ids.newbie], /permission denied/)
    await expectOk("update public.profiles set phone = '0999' where id = $1", [ids.newbie])
  })

  await test("A user can request Engineer, Foreman or Client access; user_id and status are set by the database", async () => {
    await as("newbie")
    const r = await db.query(
      "insert into public.access_requests (user_id, requested_role, discipline, message, status) values ($1, 'engineer', 'mep', 'I run the MEP works', 'approved') returning user_id, status, decided_by",
      [ids.sneaky],
    )
    if (r.rows[0].user_id !== ids.newbie) throw new Error("user_id was spoofed")
    if (r.rows[0].status !== "pending") throw new Error("status was spoofed")
    if (r.rows[0].decided_by !== null) throw new Error("decided_by was spoofed")
  })

  await test("Admin roles and 'user' cannot be requested", async () => {
    await as("googler")
    for (const role of ["admin", "super_admin", "user"]) {
      await expectFail("insert into public.access_requests (user_id, requested_role) values ($1, $2)", [ids.googler, role], /requested_role_check/)
    }
  })

  await test("Only basic accounts may ask: engineers, admins, disabled and unverified-role users cannot", async () => {
    for (const who of ["eng1", "fore1", "client1", "admin"]) {
      await as(who, "aal2")
      await expectFail("insert into public.access_requests (user_id, requested_role) values ($1, 'client')", [ids[who]], /basic account/)
    }
    await asOwner()
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.badavatar])
    await as("badavatar")
    await expectFail("insert into public.access_requests (user_id, requested_role) values ($1, 'client')", [ids.badavatar], /basic account/)
    await asOwner()
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.badavatar])
  })

  await test("Only one pending request per user; a new one is allowed after cancelling", async () => {
    await as("newbie")
    await expectFail("insert into public.access_requests (user_id, requested_role) values ($1, 'foreman')", [ids.newbie], /access_requests_one_pending|duplicate key/)
    const upd = await db.query("update public.access_requests set status = 'cancelled' where user_id = $1 and status = 'pending' returning id", [ids.newbie])
    if (upd.rows.length !== 1) throw new Error("could not cancel own request")
    await expectOk("insert into public.access_requests (user_id, requested_role) values ($1, 'foreman')", [ids.newbie])
  })

  await test("A user cannot approve their own request or edit it (only cancel)", async () => {
    await as("newbie")
    await expectFail("update public.access_requests set status = 'approved' where user_id = $1", [ids.newbie], /only cancel/)
    await expectFail("update public.access_requests set requested_role = 'client', status = 'cancelled' where user_id = $1 and status = 'pending'", [ids.newbie], /permission denied|only cancel/)
    await expectFail("update public.access_requests set decided_by = $2 where user_id = $1", [ids.newbie, ids.newbie], /permission denied/)
    await expectFail("delete from public.access_requests where user_id = $1", [ids.newbie], /permission denied/)
  })

  await test("Requests are private: other users, engineers, anon see none; admins who review users see them (with MFA)", async () => {
    const seen = async (who, aal = "aal1") => {
      await as(who, aal)
      return count("select count(*) n from public.access_requests")
    }
    if ((await seen("googler")) !== 0) throw new Error("another user sees requests")
    if ((await seen("eng1")) !== 0) throw new Error("engineer sees requests")
    if ((await seen("admin", "aal1")) !== 0) throw new Error("admin without MFA sees requests")
    if ((await seen("newbie")) < 2) throw new Error("owner cannot see own requests")
    if ((await seen("admin", "aal2")) < 2) throw new Error("reviewing admin cannot see requests")
    await as(null)
    if ((await count("select count(*) n from public.access_requests").catch(() => 0)) !== 0) throw new Error("anon sees requests")
  })

  await test("Admins cannot decide requests directly (no write policy): approval goes through the Edge Function", async () => {
    await as("admin", "aal2")
    const upd = await db.query("update public.access_requests set status = 'approved' where user_id = $1 returning id", [ids.newbie])
    if (upd.rows.length) throw new Error("admin updated a request through the API")
  })

  await test("Request changes are audited", async () => {
    await asOwner()
    if ((await count("select count(*) n from public.audit_log where action like 'access_requests.%'")) < 3) throw new Error("audit rows missing")
  })

  await test("After approval (done by the Edge Function) the user becomes an Engineer and can be assigned to a project", async () => {
    await asOwner()
    await db.query("update public.profiles set role = 'engineer', discipline = 'mep' where id = $1", [ids.newbie])
    await as("super", "aal2")
    await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [ids.p1, ids.newbie])
    await as("newbie")
    if ((await count("select count(*) n from public.projects")) < 1) throw new Error("approved engineer cannot see the assigned project")
    await expectFail("insert into public.access_requests (user_id, requested_role) values ($1, 'client')", [ids.newbie], /basic account/)
  })
}
