// Tests for 0029: Google sign-ups never get access by themselves; registration details; audit of status / role changes; session revocation.
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count }) {
  const google = async (key, name = "Gina Google") => {
    await asOwner()
    const { rows } = await db.query(
      "insert into auth.users (email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at) values ($1, $2, '{\"provider\":\"google\"}', now()) returning id",
      [`${key}@test.local`, JSON.stringify({ name, picture: "https://lh3.example.com/a.jpg" })],
    )
    ids[key] = rows[0].id
    return rows[0].id
  }
  const profile = async (key) => {
    await asOwner()
    return (await db.query("select * from public.profiles where id = $1", [ids[key]])).rows[0]
  }
  const audits = async (action, target) => {
    await asOwner()
    return (await db.query("select * from public.audit_log where action = $1 and target_id = $2 order by id", [action, ids[target]])).rows
  }
  await asOwner()
  await db.query("delete from public.admin_permissions where user_id = $1", [ids.admin])
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'users.approve'), ($1, 'users.view') on conflict do nothing", [ids.admin])

  await test("An unknown Google sign-up is PENDING with no access, not active; an email sign-up is unchanged", async () => {
    await google("g1")
    const p = await profile("g1")
    if (p.status !== "pending" || p.role !== "user" || p.registration_completed_at !== null || p.signup_provider !== "google") throw new Error("google profile wrong: " + JSON.stringify(p))
    if (p.full_name !== "Gina Google") throw new Error("name from Google not kept")
    await asOwner()
    const { rows } = await db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ('mailer@test.local', '{}', now()) returning id")
    const e = (await db.query("select * from public.profiles where id = $1", [rows[0].id])).rows[0]
    if (e.status !== "active" || e.role !== "user" || e.signup_provider !== "email" || !e.registration_completed_at) throw new Error("email sign-up changed: " + JSON.stringify(e))
  })

  await test("A pending Google account sees no project data and cannot act", async () => {
    await as("g1")
    if ((await count("select count(*) n from public.projects")) !== 0) throw new Error("pending google user reads projects")
    await expectFail("insert into public.access_requests (user_id, requested_role) values ($1, 'engineer')", [ids.g1], /basic account|row-level security|permission denied/)
    await expectFail("update public.profiles set status = 'active'", [], /permission denied/)
    await expectFail("update public.profiles set registration_completed_at = now()", [], /permission denied/)
  })

  await test("Registration details are validated; the request goes to the administrators and the audit log", async () => {
    await asOwner(); await db.query("update public.profiles set email_verified_at = now() where id = $1", [ids.g1]) // the emailed code is tested in zzzzz-email-verification
    await as("g1")
    await expectFail("select public.complete_registration('G', '+63 912 345 6789', null, null, 'engineer', 'mep')", [], /full name/)
    await expectFail("select public.complete_registration('Gina Google', 'abc', null, null, 'engineer', 'mep')", [], /phone/)
    await expectFail("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'admin', null)", [], /Choose Engineer/)
    await expectFail("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'engineer', null)", [], /discipline/)
    await expectFail("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'engineer', 'plumbing')", [], /discipline/)
    const status = (await db.query("select public.complete_registration('Gina Google', '+63 912 345 6789', 'Valencia', 'Site engineer', 'engineer', 'mep') s")).rows[0].s
    if (status !== "pending") throw new Error("must stay pending: " + status)
    const p = await profile("g1")
    if (!p.registration_completed_at || p.requested_role !== "engineer" || p.discipline !== "mep" || p.phone !== "+63 912 345 6789" || p.status !== "pending") throw new Error("not saved: " + JSON.stringify(p))
    const log = await audits("oauth.enroll", "g1")
    if (log.length !== 1 || log[0].details.requested_role !== "engineer") throw new Error("OAuth enrollment not logged")
    await asOwner()
    const told = (await db.query("select user_id from public.notifications where kind = 'registration.new'")).rows.map((r) => r.user_id)
    if (!told.includes(ids.super) || !told.includes(ids.admin)) throw new Error("approvers not told: " + JSON.stringify(told))
    await as("g1")
    await expectFail("select public.complete_registration('Gina Google', '+63 912 345 6789', null, null, 'client', null)", [], /already submitted/)
  })

  await test("Approving a pending registration activates it and is audited with who and what changed", async () => {
    await asOwner()
    await db.query("update public.profiles set status = 'active', role = 'engineer', approved_by = $2, approved_at = now() where id = $1", [ids.g1, ids.super])
    const status = await audits("profile.status_changed", "g1")
    const role = await audits("profile.role_changed", "g1")
    if (status.length !== 1 || status[0].details.from !== "pending" || status[0].details.to !== "active") throw new Error("status change not logged: " + JSON.stringify(status))
    if (role.length !== 1 || role[0].details.from !== "user" || role[0].details.to !== "engineer") throw new Error("role change not logged")
    await db.query("update public.profiles set full_name = 'Gina G.' where id = $1", [ids.g1])
    if ((await audits("profile.status_changed", "g1")).length !== 1) throw new Error("a plain edit must not be logged as a status change")
  })

  await test("A whitelisted Google email is active with its role at once, even though Google sign-ups start pending", async () => {
    await asOwner()
    await db.query("insert into public.whitelisted_emails (email, assigned_role, created_by) values ('gwhite@test.local', 'foreman', $1)", [ids.super])
    await google("gwhite", "Wally White")
    const p = await profile("gwhite")
    if (p.status !== "active" || p.role !== "foreman" || !p.registration_completed_at) throw new Error("whitelisted google not activated: " + JSON.stringify(p))
    if ((await audits("whitelist.apply", "gwhite")).length !== 1) throw new Error("whitelist not logged")
    await as("gwhite")
    await expectFail("select public.complete_registration('Wally White', '+63 912 345 6789', null, null, 'client', null)", [], /already submitted/)
  })

  await test("Every status change is logged by the database, including a disable and a re-enable", async () => {
    await asOwner()
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.g1])
    await db.query("update public.profiles set status = 'active' where id = $1", [ids.g1])
    const log = (await audits("profile.status_changed", "g1")).map((r) => `${r.details.from}>${r.details.to}`)
    if (log.join(",") !== "pending>active,active>disabled,disabled>active") throw new Error("trail: " + log.join(","))
  })

  await test("Only the service role can end someone's sessions; it removes sessions and tokens", async () => {
    await asOwner()
    await db.query("insert into auth.sessions (id, user_id) values (gen_random_uuid(), $1), (gen_random_uuid(), $1)", [ids.g1])
    await db.query("insert into auth.refresh_tokens (user_id) values ($1)", [ids.g1])
    for (const who of ["g1", "eng1", "super"]) {
      await as(who, "aal2")
      await expectFail("select public.revoke_user_sessions($1)", [ids.g1], /permission denied/)
    }
    await asOwner()
    await db.exec("set role service_role")
    const n = (await db.query("select public.revoke_user_sessions($1) n", [ids.g1])).rows[0].n
    await asOwner()
    if (n !== 2) throw new Error("expected 2 sessions removed, got " + n)
    if ((await count("select count(*) n from auth.sessions where user_id = $1", [ids.g1])) !== 0 || (await count("select count(*) n from auth.refresh_tokens where user_id = $1", [ids.g1])) !== 0) throw new Error("sessions or tokens left")
  })

  await test("Deleting a half-created Google account (the login gate) leaves no profile and keeps the audit history", async () => {
    await google("g2")
    await asOwner()
    await db.query("insert into public.audit_log (actor_id, target_id, action, details) values (null, $1, 'oauth.blocked', '{}')", [ids.g2])
    await db.query("delete from auth.users where id = $1", [ids.g2])
    if ((await count("select count(*) n from public.profiles where id = $1", [ids.g2])) !== 0) throw new Error("profile left behind")
    if ((await count("select count(*) n from public.audit_log where action = 'oauth.blocked'")) !== 1) throw new Error("audit row lost")
  })
}
