// Tests for 0015: email whitelist (role applied on email CONFIRMATION, single use, admin-only management).
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count }) {
  const allow = async (email, role = "engineer", discipline = null) => {
    await asOwner()
    await db.query("insert into public.whitelisted_emails (email, assigned_role, discipline, created_by) values ($1, $2, $3, $4)", [email, role, discipline, ids.super])
  }
  const signUp = async (key, email, confirmed = false) => {
    await asOwner()
    const { rows } = await db.query("insert into auth.users (email, raw_user_meta_data, email_confirmed_at) values ($1, '{}'::jsonb, $2) returning id", [email, confirmed ? new Date().toISOString() : null])
    ids[key] = rows[0].id
    await db.query("update public.profiles set identity_status = 'verified', email_verified_at = now() where id = $1", [rows[0].id])
  }
  const profile = async (key) => (await db.query("select role, status, discipline, approved_by from public.profiles where id = $1", [ids[key]])).rows[0]
  const entry = async (email) => (await db.query("select used_at, used_by from public.whitelisted_emails where email = $1", [email])).rows[0]

  await test("The role is NOT given when the account is created, only when the email is confirmed", async () => {
    await allow("newhire@x.test", "engineer", "mep")
    await signUp("wl1", "newhire@x.test", false)
    let p = await profile("wl1")
    if (p.role !== "user") throw new Error(`role granted before confirmation: ${p.role}`)
    if ((await entry("newhire@x.test")).used_at) throw new Error("entry used before confirmation")
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [ids.wl1])
    p = await profile("wl1")
    if (p.role !== "engineer" || p.status !== "active" || p.discipline !== "mep") throw new Error(`not applied on confirmation: ${JSON.stringify(p)}`)
    if (p.approved_by !== ids.super) throw new Error("approved_by should be the admin who whitelisted the email")
    const e = await entry("newhire@x.test")
    if (!e.used_at || e.used_by !== ids.wl1) throw new Error("entry not marked used")
  })

  await test("Pre-hijack is impossible: an unconfirmed sign-up with a whitelisted address stays a basic user", async () => {
    await allow("victim@x.test", "foreman")
    await signUp("attacker", "victim@x.test", false)
    if ((await profile("attacker")).role !== "user") throw new Error("attacker received the role")
    await as("attacker")
    if ((await count("select count(*) n from public.projects")) !== 0) throw new Error("attacker sees projects")
    await asOwner()
    if ((await entry("victim@x.test")).used_at) throw new Error("entry consumed by an unconfirmed account")
  })

  await test("Google-style sign-up (already confirmed) gets the role immediately; email case does not matter", async () => {
    await allow("googled@x.test", "client")
    await signUp("wl2", "Googled@X.test", true)
    if ((await profile("wl2")).role !== "client") throw new Error("role not applied for a pre-confirmed account")
  })

  await test("Single use: after being used, the entry never re-elevates the account", async () => {
    await asOwner()
    await db.query("update public.profiles set role = 'user' where id = $1", [ids.wl1])
    await db.query("update auth.users set email_confirmed_at = now() + interval '1 minute' where id = $1", [ids.wl1])
    if ((await profile("wl1")).role !== "user") throw new Error("a used entry elevated the account again")
    const result = await db.query("select public.apply_whitelist($1) as applied", [ids.wl1])
    if (result.rows[0].applied) throw new Error("apply_whitelist applied a used entry")
  })

  await test("Adding an email whose owner already has a confirmed basic account applies the role right away", async () => {
    await signUp("wl3", "existing@x.test", true)
    if ((await profile("wl3")).role !== "user") throw new Error("setup: should start as user")
    await allow("existing@x.test", "foreman")
    if ((await profile("wl3")).role !== "foreman") throw new Error("role not applied to the existing account")
  })

  await test("A pending access request is approved with a note when the whitelist applies", async () => {
    await signUp("wl4", "asked@x.test", true)
    await as("wl4")
    await expectOk("insert into public.access_requests (user_id, requested_role, message) values ($1, 'client', 'please')", [ids.wl4])
    await allow("asked@x.test", "engineer")
    await asOwner()
    const { rows } = await db.query("select status, decision_note from public.access_requests where user_id = $1", [ids.wl4])
    if (rows[0].status !== "approved" || !/whitelist/i.test(rows[0].decision_note)) throw new Error(`request not closed: ${JSON.stringify(rows[0])}`)
    if ((await profile("wl4")).role !== "engineer") throw new Error("role not applied")
  })

  await test("Accounts that already have a role, and disabled accounts, are left alone", async () => {
    await allow("eng1@test.local", "client")
    await asOwner()
    if ((await profile("eng1")).role !== "engineer") throw new Error("an existing engineer was changed")
    if ((await entry("eng1@test.local")).used_at) throw new Error("entry consumed by an account that already had a role")
    await signUp("wl5", "dis@x.test", true)
    await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.wl5])
    await allow("dis@x.test", "engineer")
    if ((await profile("wl5")).role !== "user") throw new Error("a disabled account was elevated")
  })

  await test("Entries are validated: lowercase valid email, never super_admin or user, no duplicates, short note", async () => {
    await asOwner()
    const add = (email, role, note = null) => db.query("insert into public.whitelisted_emails (email, assigned_role, note) values ($1, $2, $3)", [email, role, note])
    await expectFail("insert into public.whitelisted_emails (email, assigned_role) values ('Upper@x.test', 'client')", [], /email_check|check constraint/)
    await expectFail("insert into public.whitelisted_emails (email, assigned_role) values ('not-an-email', 'client')", [], /email_check|check constraint/)
    await expectFail("insert into public.whitelisted_emails (email, assigned_role) values ('a b@x.test', 'client')", [], /email_check|check constraint/)
    await expectFail("insert into public.whitelisted_emails (email, assigned_role) values ('boss@x.test', 'super_admin')", [], /assigned_role_check|check constraint/)
    await expectFail("insert into public.whitelisted_emails (email, assigned_role) values ('basic@x.test', 'user')", [], /assigned_role_check|check constraint/)
    await expectFail("insert into public.whitelisted_emails (email, assigned_role, note) values ('long@x.test', 'client', $1)", ["n".repeat(201)], /note_check|check constraint/)
    await add("dupe@x.test", "client")
    await expectFail("insert into public.whitelisted_emails (email, assigned_role) values ('dupe@x.test', 'client')", [], /duplicate key|unique/)
  })

  await test("Reading the list: admins who review users (with MFA) only; no one writes through the API", async () => {
    await as("admin", "aal2")
    if ((await count("select count(*) n from public.whitelisted_emails")) < 3) throw new Error("reviewing admin cannot read the list")
    await expectFail("insert into public.whitelisted_emails (email, assigned_role) values ('direct@x.test', 'client')", [], /permission denied/)
    await expectFail("update public.whitelisted_emails set assigned_role = 'admin'", [], /permission denied/)
    await expectFail("delete from public.whitelisted_emails", [], /permission denied/)
    for (const [who, aal] of [["admin", "aal1"], ["noperm", "aal2"], ["eng1", "aal2"], ["client1", "aal2"], ["pending1", "aal2"]]) {
      await as(who, aal)
      if ((await count("select count(*) n from public.whitelisted_emails")) !== 0) throw new Error(`${who} can read the whitelist`)
    }
    await as(null)
    if ((await count("select count(*) n from public.whitelisted_emails").catch(() => 0)) !== 0) throw new Error("anon can read the whitelist")
  })

  await test("The whitelist functions cannot be called through the API", async () => {
    for (const who of ["eng1", "admin"]) {
      await as(who, "aal2")
      await expectFail("select public.apply_whitelist($1)", [ids.wl3], /permission denied/)
    }
    await as(null)
    await expectFail("select public.apply_whitelist(gen_random_uuid())", [], /permission denied/)
  })

  await test("Adding and using whitelist entries is audited", async () => {
    await asOwner()
    if ((await count("select count(*) n from public.audit_log where action = 'whitelisted_emails.insert'")) < 5) throw new Error("insert audit rows missing")
    if ((await count("select count(*) n from public.audit_log where action = 'whitelist.apply'")) < 4) throw new Error("apply audit rows missing")
  })
}
