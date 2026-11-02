import assert from "node:assert/strict"

// Tests for 20261101090000_admin_communications: email choices and the claim lease (A), the announcement banner (B), the communications hub (C).
export default async function ({ db, ids, as, asOwner, addUser, test, expectFail, count }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims', '{}', false)") }
  const service = async () => { await db.exec("reset role"); await db.exec("set role service_role") }
  await owner()
  await addUser("comSuper", "super_admin")
  await addUser("comAdmin", "admin") // gets users.edit below
  await addUser("comPlain", "admin") // default admin permissions only (no users.edit)
  await addUser("comEditOnly", "admin") // users.edit but not users.view
  await addUser("comEng", "engineer")
  await addUser("comFore", "foreman")
  await addUser("comClient", "client")
  await addUser("comOff", "foreman") // opted out of everything optional
  await addUser("comNoRem", "foreman") // opted out of reminders only
  await addUser("comNoAnn", "foreman") // opted out of announcements only
  await addUser("comGone", "foreman", "disabled")
  await addUser("comBasic", "user")
  await db.query("insert into public.admin_permissions(user_id, permission) values ($1, 'users.edit') on conflict do nothing", [ids.comAdmin])
  await db.query("delete from public.admin_permissions where user_id = $1", [ids.comEditOnly])
  await db.query("insert into public.admin_permissions(user_id, permission) values ($1, 'users.edit')", [ids.comEditOnly])
  await db.query("insert into public.notification_prefs(user_id, email_enabled) values ($1, false)", [ids.comOff])
  await db.query("insert into public.notification_prefs(user_id, email_reminders) values ($1, false)", [ids.comNoRem])
  await db.query("insert into public.notification_prefs(user_id, email_announcements) values ($1, false)", [ids.comNoAnn])
  await db.query("update public.notifications set emailed_at = now() where emailed_at is null") // a clean queue for this file

  const note = async (who, kind, title, extra = "") => {
    await owner()
    return (await db.query(`insert into public.notifications (user_id, kind, title ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, $3 ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [ids[who], kind, title])).rows[0].id
  }
  const claim = async (limit = 50) => { await service(); const rows = (await db.query("select * from public.claim_email_batch($1)", [limit])).rows; await owner(); return rows }
  const titles = (rows) => rows.map((row) => row.title).sort()
  const logFor = async (id) => { await owner(); return (await db.query("select status, detail from public.email_log where notification_id = $1 order by id", [id])).rows }

  // ---------------------------------------------------------------- A. categories, choices, lease
  await test("A: every notification kind falls in one category; account / security notices are mandatory, reminders and announcements are optional", async () => {
    const category = async (kind) => (await db.query("select public.notification_email_category($1) c", [kind])).rows[0].c
    for (const kind of ["account.suspended", "account.reactivated", "security.new_device"]) assert.equal(await category(kind), "security", kind)
    for (const kind of ["pin.due", "pin.overdue", "qa.defect_due", "qa.defect_overdue", "qa.overdue", "alert.overdue", "alert.escalation"]) assert.equal(await category(kind), "reminder", kind)
    for (const kind of ["announcement.message", "announcement.email"]) assert.equal(await category(kind), "announcement", kind)
    for (const kind of ["pin.assigned", "qa.defect", "access.granted", "qa.requested"]) assert.equal(await category(kind), "activity", kind)
  })

  await test("A: a person sets their own reminder and announcement choices; nobody else's, and nothing else in the row", async () => {
    await as("comFore")
    await db.query("insert into public.notification_prefs(user_id, email_enabled, email_reminders, email_announcements) values ($1, true, false, true)", [ids.comFore])
    await db.query("update public.notification_prefs set email_announcements = false")
    await expectFail("insert into public.notification_prefs(user_id, email_reminders) values ($1, false)", [ids.comEng], /row-level security/)
    await expectFail("update public.notification_prefs set updated_at = now()", [], /permission denied/)
    await as("comEng")
    assert.equal(await count("select count(*) n from public.notification_prefs"), 0)
    assert.equal((await db.query("update public.notification_prefs set email_reminders = false returning user_id")).rows.length, 0)
    await owner(); await db.query("delete from public.notification_prefs where user_id = $1", [ids.comFore])
  })

  await test("A: reminders follow the reminder choice, announcements the announcement choice, and the master switch stops both", async () => {
    await note("comFore", "pin.due", "Reminder for the default foreman")
    await note("comNoRem", "pin.due", "Reminder for the one who opted out of reminders")
    await note("comNoRem", "pin.assigned", "Activity for the one who opted out of reminders")
    await note("comNoAnn", "announcement.message", "Announcement for the one who opted out of announcements")
    await note("comNoAnn", "alert.overdue", "Alert for the one who opted out of announcements")
    await note("comOff", "pin.due", "Reminder with the master switch off")
    await note("comOff", "announcement.message", "Announcement with the master switch off")
    await note("comOff", "pin.assigned", "Activity with the master switch off")
    const rows = await claim()
    assert.deepEqual(titles(rows), ["Activity for the one who opted out of reminders", "Alert for the one who opted out of announcements", "Reminder for the default foreman"])
    await owner()
    const skipped = (await db.query("select n.title, l.detail from public.email_log l join public.notifications n on n.id = l.notification_id where l.status = 'skipped' and n.title in ('Reminder for the one who opted out of reminders','Announcement for the one who opted out of announcements','Reminder with the master switch off','Announcement with the master switch off','Activity with the master switch off')")).rows
    assert.equal(skipped.length, 5); assert.ok(skipped.every((row) => /opted out/.test(row.detail)), JSON.stringify(skipped))
    for (const row of rows) { await service(); await db.query("select public.mark_email_result($1, true, 'ok')", [row.id]); await owner() }
  })

  await test("A: security and account notices are always emailed: master switch off, daily cap reached, and a suspended account still gets its suspension notice", async () => {
    await owner()
    for (let i = 0; i < 20; i++) await db.query("insert into public.email_log(user_id, status) values ($1, 'sent')", [ids.comOff])
    await note("comOff", "account.reactivated", "Security notice to a person who switched everything off")
    await note("comOff", "pin.assigned", "Ordinary notice over the cap")
    const suspended = await note("comGone", "account.suspended", "Suspension notice to a suspended account")
    await note("comGone", "pin.assigned", "Ordinary notice to a suspended account")
    await note("comGone", "account.reactivated", "Reactivation notice while still suspended")
    const rows = await claim()
    assert.deepEqual(titles(rows), ["Security notice to a person who switched everything off", "Suspension notice to a suspended account"])
    assert.equal(rows.find((row) => row.title.startsWith("Suspension")).to_email, "comgone@test.local")
    for (const row of rows) { await service(); await db.query("select public.mark_email_result($1, true, 'ok')", [row.id]); await owner() }
    assert.deepEqual((await logFor(suspended)).map((row) => row.status), ["sent"])
    await db.query("delete from public.email_log where user_id = $1 and notification_id is null", [ids.comOff])
  })

  await test("A: nothing is handed out twice while it is being sent; a failure releases it for a retry; an expired lease is claimed again", async () => {
    const id = await note("comEng", "pin.assigned", "Lease me")
    assert.deepEqual(titles(await claim()), ["Lease me"])
    assert.deepEqual(await claim(), [], "a second run during the lease gets nothing")
    await service(); await db.query("select public.mark_email_result($1, false, 'Brevo said no')", [id]); await owner()
    assert.deepEqual(titles(await claim()), ["Lease me"], "a failure releases the lease at once (still within the three attempts)")
    await owner(); await db.query("update public.notifications set email_claimed_at = now() - interval '11 minutes' where id = $1", [id])
    assert.deepEqual(titles(await claim()), ["Lease me"], "a run that died without a result does not block the row forever")
    await owner(); assert.equal((await db.query("select email_attempts from public.notifications where id = $1", [id])).rows[0].email_attempts, 3)
    await service(); await db.query("select public.mark_email_result($1, false, 'third failure')", [id]); await owner()
    assert.deepEqual(await claim(), [], "closed after three attempts")
  })

  await test("A: a late or repeated result is ignored, so a notification never has two 'sent' lines", async () => {
    const id = await note("comEng", "pin.assigned", "Report twice")
    await claim()
    await service(); await db.query("select public.mark_email_result($1, true, 'first')", [id]); await db.query("select public.mark_email_result($1, true, 'second')", [id]); await db.query("select public.mark_email_result($1, false, 'late failure')", [id]); await owner()
    assert.deepEqual((await logFor(id)).map((row) => row.status), ["sent"])
  })

  await test("A: mark all as read marks every unread notification of the caller (not only the first 50), and only theirs", async () => {
    await owner()
    await db.query("insert into public.notifications(user_id, kind, title, emailed_at) select $1, 'pin.assigned', 'Bulk ' || g, now() from generate_series(1, 60) g", [ids.comClient])
    await db.query("insert into public.notifications(user_id, kind, title, emailed_at) values ($1, 'announcement.email', 'Hidden email-only', now()), ($2, 'pin.assigned', 'Someone else', now())", [ids.comClient, ids.comEng])
    await as("comClient")
    const unread = await count("select count(*) n from public.notifications where read_at is null and kind <> 'announcement.email'")
    assert.ok(unread >= 60, "more than the 50 the bell loads")
    assert.equal(Number((await db.query("select public.mark_all_notifications_read() n")).rows[0].n), unread)
    assert.equal(await count("select count(*) n from public.notifications where read_at is null"), 1, "only the hidden email-only row stays unread")
    await as("comEng")
    assert.ok(await count("select count(*) n from public.notifications where read_at is null and title = 'Someone else'") >= 1, "another person's notification was not touched")
    await as(null)
    await expectFail("select public.mark_all_notifications_read()", [], /permission denied/)
  })

  // ---------------------------------------------------------------- B. announcement banner
  await test("B: nothing is shown until a Super Admin publishes; the banner is readable without signing in; nobody reads or writes the table directly", async () => {
    await as(null)
    assert.equal((await db.query("select * from public.get_active_announcement()")).rows.length, 0)
    await expectFail("select * from public.site_announcement", [], /permission denied/)
    await as("comEng")
    await expectFail("update public.site_announcement set enabled = true", [], /permission denied/)
  })

  await test("B: only a Super Admin with MFA manages the banner; admins (even with every permission), project roles and visitors cannot", async () => {
    for (const who of ["comAdmin", "comPlain", "comEng", "comFore", "comClient"]) {
      await as(who, "aal2")
      await expectFail("select public.set_announcement('Hello', 'World', 'info', true)", [], /Only a Super Admin/)
      await expectFail("select * from public.get_announcement_settings()", [], /Only a Super Admin/)
    }
    await as("comSuper", "aal1")
    await expectFail("select public.set_announcement('Hello', 'World', 'info', true)", [], /Only a Super Admin/)
    await as(null)
    await expectFail("select public.set_announcement('Hello', 'World', 'info', true)", [], /permission denied/)
  })

  await test("B: publishing validates the text and tone, shows the same banner to everyone, and writes an audit entry", async () => {
    await as("comSuper", "aal2")
    await expectFail("select public.set_announcement('', 'Message', 'info', true)", [], /title and a message/)
    await expectFail("select public.set_announcement('Title', '   ', 'info', true)", [], /title and a message/)
    await expectFail("select public.set_announcement('Title', 'Message', 'loud', true)", [], /Choose a tone/)
    await expectFail("select public.set_announcement($1, 'Message', 'info', true)", ["x".repeat(81)], /at most 80/)
    await expectFail("select public.set_announcement('Title', $1, 'info', true)", ["x".repeat(501)], /at most 500/)
    const revision = Number((await db.query("select public.set_announcement('Planned maintenance', E'Saturday 10 pm.\\u0007 Back by 11.', 'warning', true) r")).rows[0].r)
    assert.equal(revision, 1)
    for (const who of [null, "comEng", "comClient", "comSuper"]) {
      await as(who, "aal2")
      const row = (await db.query("select * from public.get_active_announcement()")).rows[0]
      assert.deepEqual({ ...row }, { title: "Planned maintenance", message: "Saturday 10 pm. Back by 11.", tone: "warning", revision: 1 }, String(who))
    }
    await owner()
    const audit = (await db.query("select action, details from public.audit_log where action like 'announcement.%' order by id desc limit 1")).rows[0]
    assert.equal(audit.action, "announcement.publish"); assert.equal(audit.details.revision, 1); assert.equal(audit.details.tone, "warning")
  })

  await test("B: the revision goes up when the text or tone changes and when a disabled banner is published again; a save that changes nothing does nothing", async () => {
    await as("comSuper", "aal2")
    const revision = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].r)
    const before = await count("select count(*) n from public.audit_log where action like 'announcement.%'")
    assert.equal(await revision("select public.set_announcement('Planned maintenance', 'Saturday 10 pm. Back by 11.', 'warning', true) r"), 1, "nothing changed")
    assert.equal(await count("select count(*) n from public.audit_log where action like 'announcement.%'"), before, "and nothing was logged")
    assert.equal(await revision("select public.set_announcement('Planned maintenance', 'Saturday 11 pm. Back by midnight.', 'warning', true) r"), 2, "edited text")
    assert.equal(await revision("select public.set_announcement('Planned maintenance', 'Saturday 11 pm. Back by midnight.', 'critical', true) r"), 3, "edited tone")
    assert.equal(await revision("select public.set_announcement('Planned maintenance', 'Saturday 11 pm. Back by midnight.', 'critical', false) r"), 3, "switching off keeps the revision")
    assert.equal((await db.query("select * from public.get_active_announcement()")).rows.length, 0, "a disabled banner is not shown")
    assert.equal(await revision("select public.set_announcement('Planned maintenance', 'Saturday 11 pm. Back by midnight.', 'critical', true) r"), 4, "published again")
    await owner()
    const actions = (await db.query("select action from public.audit_log where action like 'announcement.%' order by id")).rows.map((row) => row.action)
    assert.deepEqual(actions, ["announcement.publish", "announcement.update", "announcement.update", "announcement.disable", "announcement.publish"])
  })

  await test("B: the Super Admin sees the full settings, a draft can be saved while disabled, and the stored tone is always one of the four", async () => {
    await as("comSuper", "aal2")
    await db.query("select public.set_announcement('', '', 'info', false)") // clearing a banner while disabled is allowed
    const settings = (await db.query("select * from public.get_announcement_settings()")).rows[0]
    assert.equal(settings.enabled, false); assert.equal(settings.revision, 5); assert.equal(settings.title, ""); assert.match(settings.updated_by_name, /comSuper/)
    await owner()
    await expectFail("update public.site_announcement set tone = 'rainbow'", [], /check constraint/)
    await expectFail("insert into public.site_announcement(id) values (2)", [], /check constraint/)
  })

  // ---------------------------------------------------------------- C. communications hub
  const send = async (who, batch, recipients, channel = "both", title = "Site closed Friday", body = "The site is closed on Friday for the holiday.", link = null, aal = "aal2") => {
    await as(who, aal)
    return (await db.query("select public.send_admin_message($1, $2, $3, $4, $5, $6) r", [batch, recipients, title, body, channel, link])).rows[0].r
  }
  const batchId = () => crypto.randomUUID()

  await test("C: only a Super Admin, or an Admin holding users.edit with MFA, can search, preview, send or read the history; nobody else", async () => {
    for (const who of ["comPlain", "comEng", "comFore", "comClient", "comBasic"]) {
      await as(who, "aal2")
      await expectFail("select * from public.search_message_recipients('a')", [], /Missing permission: users.edit and users.view/)
      await expectFail("select public.preview_message_audience($1, 'app')", [[ids.comEng]], /Missing permission: users.edit/)
      await expectFail("select public.send_admin_message($1, $2, 'T', 'B', 'app', null)", [batchId(), [ids.comEng]], /Missing permission: users.edit/)
      await expectFail("select * from public.get_message_batches()", [], /Missing permission: users.edit/)
    }
    await as("comEditOnly", "aal2") // may send, but may not browse the user list
    await expectFail("select * from public.search_message_recipients('a')", [], /users.edit and users.view/)
    assert.equal((await db.query("select public.preview_message_audience($1, 'app') r", [[ids.comEng]])).rows[0].r.eligible, 1)
    await as("comAdmin", "aal1") // no MFA
    await expectFail("select * from public.search_message_recipients('a')", [], /Missing permission/)
    await as(null)
    await expectFail("select * from public.search_message_recipients('a')", [], /permission denied/)
    await as("comAdmin", "aal2")
    assert.ok((await db.query("select * from public.search_message_recipients('com')")).rows.length > 0)
    await as("comSuper", "aal2")
    assert.ok((await db.query("select * from public.search_message_recipients('com')")).rows.length > 0)
    await expectFail("select count(*) from public.message_batches", [], /permission denied/)
  })

  await test("C: search finds active people only, by name, email or company and by role; typed % and _ are matched literally; the limit holds", async () => {
    await as("comAdmin", "aal2")
    const search = async (q, roles = null, limit = 20) => (await db.query("select * from public.search_message_recipients($1, $2, $3)", [q, roles, limit])).rows
    assert.ok((await search("comEng")).some((row) => row.id === ids.comEng && row.role === "engineer" && row.email === "comeng@test.local"))
    assert.equal((await search("comGone")).length, 0, "a suspended account is not offered")
    assert.equal((await search("%")).length, 0, "% is not a wildcard")
    assert.equal((await search("_omEng")).length, 0, "_ is not a wildcard")
    assert.equal((await search("COMENG@TEST.LOCAL")).length, 1, "case does not matter")
    const foremen = await search(null, ["foreman"], 500)
    assert.ok(foremen.length >= 4 && foremen.every((row) => row.role === "foreman"))
    assert.equal((await search(null, null, 2)).length, 2)
    assert.ok((await search(null, null, 1000)).length <= 600, "the database caps a search at 600 rows")
    assert.equal((await search(null, ["engineer", "client"], 500)).every((row) => ["engineer", "client"].includes(row.role)), true)
  })

  await test("C: the preview counts who is eligible, who would get an email and who opted out, without sending anything", async () => {
    await as("comAdmin", "aal2")
    const everyone = [ids.comEng, ids.comFore, ids.comOff, ids.comNoRem, ids.comNoAnn, ids.comGone, ids.comEng, crypto.randomUUID()]
    const before = await count("select count(*) n from public.notifications")
    const both = (await db.query("select public.preview_message_audience($1, 'both') r", [everyone])).rows[0].r
    assert.equal(both.requested, 7, "duplicates are merged"); assert.equal(both.eligible, 5); assert.equal(both.not_eligible, 2)
    assert.equal(both.opted_out, 2, "the master switch and the announcement choice"); assert.equal(both.will_email, 3)
    assert.deepEqual(both.by_role, { engineer: 1, foreman: 4 }); assert.equal(both.sample.length, 5)
    const app = (await db.query("select public.preview_message_audience($1, 'app') r", [everyone])).rows[0].r
    assert.equal(app.will_email, 0); assert.equal(app.opted_out, 0)
    await expectFail("select public.preview_message_audience($1, 'sms')", [everyone], /Choose how to send/)
    assert.equal(await count("select count(*) n from public.notifications"), before, "a preview creates nothing")
  })

  await test("C: sending checks the text, the channel, the link and the recipients before doing anything", async () => {
    const one = [ids.comEng]
    await expectFail("select public.send_admin_message($1, $2, '', 'Body', 'app', null)", [batchId(), one], /title needs/)
    await as("comAdmin", "aal2")
    await expectFail("select public.send_admin_message($1, $2, 'T', '', 'app', null)", [batchId(), one], /message needs/)
    await expectFail("select public.send_admin_message($1, $2, $3, 'B', 'app', null)", [batchId(), one, "x".repeat(121)], /title needs/)
    await expectFail("select public.send_admin_message($1, $2, 'T', $3, 'app', null)", [batchId(), one, "x".repeat(501)], /message needs/)
    await expectFail("select public.send_admin_message($1, $2, 'T', 'B', 'sms', null)", [batchId(), one], /Choose how to send/)
    await expectFail("select public.send_admin_message(null, $1, 'T', 'B', 'app', null)", [one], /Missing batch id/)
    for (const link of ["https://evil.example/login", "//evil.example", "/Engineer/Dashboard", "javascript:alert(1)", "/a b", "/x?y=<script>"]) {
      await expectFail("select public.send_admin_message($1, $2, 'T', 'B', 'app', $3)", [batchId(), one, link], /link must be a page inside BuildTrack/)
    }
    await expectFail("select public.send_admin_message($1, $2, 'T', 'B', 'app', null)", [batchId(), []], /Choose at least one person/)
    await expectFail("select public.send_admin_message($1, $2, 'T', 'B', 'app', null)", [batchId(), [ids.comGone]], /None of the chosen people/)
    await expectFail("select public.send_admin_message($1, $2, 'T', 'B', 'app', null)", [batchId(), [crypto.randomUUID()]], /None of the chosen people/)
    await owner()
    assert.equal(await count("select count(*) n from public.message_batches"), 0, "failed sends leave no batch behind")
  })

  await test("C: an in-app message reaches the bell and is closed for the email queue; the text is stored as typed (it is escaped when shown)", async () => {
    const batch = batchId()
    const result = await send("comAdmin", batch, [ids.comEng, ids.comFore, ids.comGone], "app", "Heads up <b>team</b>", "Use the new form: <img src=x onerror=alert(1)>\nThanks & regards", "/engineer/dashboard")
    assert.deepEqual({ ...result }, { batch_id: batch, duplicate: false, delivered: 2, skipped: 1 })
    await as("comEng")
    const mine = (await db.query("select kind, title, body, link, emailed_at from public.notifications where dedupe_key = $1", ["msg:" + batch])).rows[0]
    assert.equal(mine.kind, "announcement.message"); assert.equal(mine.title, "Heads up <b>team</b>"); assert.equal(mine.link, "/engineer/dashboard"); assert.ok(mine.emailed_at)
    assert.match(mine.body, /<img src=x onerror=alert\(1\)>\nThanks & regards/)
    assert.equal(await count("select count(*) n from public.notifications where dedupe_key = $1", ["msg:" + batch]), 1, "a person sees only their own copy")
    await owner()
    assert.equal(await count("select count(*) n from public.notifications where dedupe_key = $1", ["msg:" + batch]), 2, "the suspended account got none")
    assert.deepEqual(titles(await claim()).filter((title) => title.startsWith("Heads up")), [], "an in-app-only message is never emailed")
  })

  await test("C: email and both go through the existing queue with its choices; an email-only message is hidden from the bell; outcomes are recorded", async () => {
    const batch = batchId()
    const everyone = [ids.comEng, ids.comFore, ids.comOff, ids.comNoRem, ids.comNoAnn]
    await send("comAdmin", batch, everyone, "email", "Email only notice", "Please read the safety memo.")
    await owner()
    assert.equal(await count("select count(*) n from public.notifications where dedupe_key = $1 and kind = 'announcement.email' and emailed_at is null", ["msg:" + batch]), 5)
    const rows = await claim()
    assert.deepEqual(rows.map((row) => row.to_email).sort(), ["comeng@test.local", "comfore@test.local", "comnorem@test.local"], "the master switch and the announcement choice are respected")
    const failing = rows.find((row) => row.to_email === "comnorem@test.local")
    for (const row of rows) { await service(); await db.query("select public.mark_email_result($1, $2, $3)", [row.id, row !== failing, row === failing ? "Brevo 500" : "accepted"]); await owner() }
    await as("comAdmin", "aal2")
    let history = (await db.query("select * from public.get_message_batches(10)")).rows.find((row) => row.id === batch)
    assert.deepEqual({ sent: history.email_sent, failed: history.email_failed, skipped: history.email_skipped, waiting: history.email_waiting }, { sent: 2, failed: 0, skipped: 2, waiting: 1 }, "the failed one is retried, so it is still waiting")
    await owner(); await db.query("update public.notifications set email_attempts = 3 where id = $1", [failing.id])
    await service(); await db.query("select public.mark_email_result($1, false, 'Brevo 500 again')", [failing.id]); await owner()
    await as("comAdmin", "aal2")
    history = (await db.query("select * from public.get_message_batches(10)")).rows.find((row) => row.id === batch)
    assert.deepEqual({ sent: history.email_sent, failed: history.email_failed, skipped: history.email_skipped, waiting: history.email_waiting }, { sent: 2, failed: 1, skipped: 2, waiting: 0 })
    assert.equal(history.title, "Email only notice"); assert.equal(history.channel, "email"); assert.equal(history.requested_count, 5); assert.equal(history.delivered_count, 5)
    await as("comEng")
    assert.equal(await count("select count(*) n from public.notifications where kind = 'announcement.email'"), 1, "the hidden row exists for the queue; the app filters it out of the bell")
    const both = batchId()
    await send("comAdmin", both, [ids.comEng], "both", "Both channels", "In the bell and in the inbox.")
    await as("comEng")
    const row = (await db.query("select kind, emailed_at from public.notifications where dedupe_key = $1", ["msg:" + both])).rows[0]
    assert.equal(row.kind, "announcement.message"); assert.equal(row.emailed_at, null)
    assert.deepEqual(titles(await claim()).filter((title) => title === "Both channels"), ["Both channels"])
  })

  await test("C: sending the same batch again (double click, retry) changes nothing and says so", async () => {
    const batch = batchId()
    const first = await send("comAdmin", batch, [ids.comEng, ids.comFore], "both", "Once only", "No duplicates please.")
    assert.equal(first.duplicate, false)
    const again = await send("comAdmin", batch, [ids.comEng, ids.comFore, ids.comClient], "both", "Once only", "No duplicates please.")
    assert.deepEqual({ ...again }, { batch_id: batch, duplicate: true, delivered: 2, skipped: 0 })
    await owner()
    assert.equal(await count("select count(*) n from public.notifications where dedupe_key = $1", ["msg:" + batch]), 2)
    assert.equal(await count("select count(*) n from public.message_batches where id = $1", [batch]), 1)
    await as("comSuper", "aal2")
    await expectFail("select public.send_admin_message($1, $2, 'Other', 'Other', 'app', null)", [batch, [ids.comEng]], /already used/)
  })

  await test("C: abuse limits: 200 people per send (Super Admin 500), 10 sends an hour, 1,000 people a day (Super Admin 2,000)", async () => {
    await owner()
    const crowd = []
    for (let i = 0; i < 250; i++) {
      const key = "crowd" + i
      await addUser(key, "client")
      crowd.push(ids[key])
    }
    await as("comAdmin", "aal2")
    await expectFail("select public.send_admin_message($1, $2, 'Big', 'Big', 'app', null)", [batchId(), crowd], /at most 200 people/)
    const bigSuper = await send("comSuper", batchId(), crowd, "app", "Big but allowed", "Super Admin limit is 500.")
    assert.equal(bigSuper.delivered, 250)
    // 10 sends an hour for the admin
    for (let i = 0; i < 6; i++) await send("comAdmin", batchId(), [crowd[i]], "app", "Hourly " + i, "x")
    await owner()
    const sentThisHour = await count("select count(*) n from public.message_batches where sender_id = $1 and created_at > now() - interval '1 hour'", [ids.comAdmin])
    for (let i = sentThisHour; i < 10; i++) await db.query("insert into public.message_batches(id, sender_id, title, body, channel, requested_count, delivered_count, skipped_count) values ($1, $2, 'filler', 'filler', 'app', 1, 1, 0)", [crypto.randomUUID(), ids.comAdmin])
    await as("comAdmin", "aal2")
    await expectFail("select public.send_admin_message($1, $2, 'Eleventh', 'x', 'app', null)", [batchId(), [crowd[20]]], /Too many messages in the last hour/)
    // the daily budget
    await owner()
    await db.query("update public.message_batches set created_at = now() - interval '3 hours' where sender_id = $1", [ids.comAdmin])
    await db.query("insert into public.message_batches(id, sender_id, title, body, channel, requested_count, delivered_count, skipped_count, created_at) values ($1, $2, 'budget', 'budget', 'app', 900, 900, 0, now() - interval '5 hours')", [crypto.randomUUID(), ids.comAdmin])
    await as("comAdmin", "aal2")
    await expectFail("select public.send_admin_message($1, $2, 'Over budget', 'x', 'app', null)", [batchId(), crowd.slice(0, 150)], /Daily limit of 1000/)
    assert.equal((await send("comAdmin", batchId(), crowd.slice(0, 20), "app", "Within budget", "x")).delivered, 20, "what is left of the budget can still be used")
    await owner()
    await db.query("update public.message_batches set created_at = now() - interval '30 hours' where sender_id = $1", [ids.comAdmin])
    await as("comAdmin", "aal2")
    assert.equal((await send("comAdmin", batchId(), crowd.slice(0, 5), "app", "A new day", "x")).delivered, 5, "the limits are rolling windows")
  })

  await test("C: each sender sees their own history, a Super Admin sees everyone's, and every send is in the audit log without the message text", async () => {
    await as("comAdmin", "aal2")
    const mine = (await db.query("select * from public.get_message_batches(50)")).rows
    assert.ok(mine.length >= 3 && mine.every((row) => row.sender_name && /comAdmin/.test(row.sender_name)))
    await as("comSuper", "aal2")
    const all = (await db.query("select * from public.get_message_batches(50)")).rows
    assert.ok(all.some((row) => /comSuper/.test(row.sender_name)) && all.some((row) => /comAdmin/.test(row.sender_name)))
    assert.equal((await db.query("select * from public.get_message_batches(1)")).rows.length, 1)
    await owner()
    const audit = (await db.query("select details from public.audit_log where action = 'message.send' order by id desc limit 1")).rows[0].details
    assert.deepEqual(Object.keys(audit).sort(), ["batch", "channel", "delivered", "requested", "skipped", "title"])
    assert.ok(await count("select count(*) n from public.audit_log where action = 'message.send'") >= 5)
  })

  await test("C: a message cannot be used to reach a suspended or unknown account, and a suspended sender is refused", async () => {
    await owner(); await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.comAdmin])
    await as("comAdmin", "aal2")
    await expectFail("select public.send_admin_message($1, $2, 'T', 'B', 'app', null)", [batchId(), [ids.comEng]], /Missing permission/)
    await expectFail("select * from public.search_message_recipients('a')", [], /Missing permission/)
    await owner(); await db.query("update public.profiles set status = 'active' where id = $1", [ids.comAdmin])
  })
}
