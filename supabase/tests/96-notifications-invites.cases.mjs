// Tests for 0020: notifications, deadline reminders, invitation codes, pin severity, audit log viewer, profile photos.
import { passWorkFixture, submitWorkFixture } from "./qa-fixtures.mjs"
export default async function ({ db, ids, as, asOwner, test, expectOk, expectFail, count, addUser }) {
  const P1 = ids.p1
  // Notifications of one person, optionally narrowed to a kind and to the thing they are about (earlier test files created others).
  const mine = async (who, kind, entity) => {
    await as(who, "aal2")
    return (await db.query("select * from public.notifications where ($1::text is null or kind = $1) and ($2::uuid is null or entity_id = $2) order by created_at", [kind ?? null, entity ?? null])).rows
  }
  const confirm = (key) => db.query("update auth.users set email_confirmed_at = now() where id = $1", [ids[key]])

  await asOwner()
  await addUser("basic1", "user")
  await addUser("basic2", "user")
  await addUser("basic3", "user")
  await addUser("basic4", "user")
  for (const k of ["basic1", "basic2", "basic3"]) await confirm(k) // basic4 stays unconfirmed
  await db.query("delete from public.admin_permissions where user_id = $1", [ids.admin])
  await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'users.view'), ($1, 'projects.manage'), ($1, 'blueprints.manage')", [ids.admin])

  // ---------------------------------------------------------------- notifications: access requests and roles
  await test("A new access request notifies Super Admins and admins who review requests, not other admins or the requester", async () => {
    await asOwner()
    await db.query("insert into public.admin_permissions (user_id, permission) values ($1, 'users.approve') on conflict do nothing", [ids.noperm])
    await as("basic1")
    const rq = (await db.query("insert into public.access_requests (user_id, requested_role, message) values ($1, 'engineer', 'Site engineer, Block A') returning id", [ids.basic1])).rows[0].id
    const sup = await mine("super", "access.request", rq)
    const reviewer = await mine("noperm", "access.request", rq)
    const viewOnly = await mine("admin", "access.request", rq)
    const self = await mine("basic1", "access.request", rq)
    if (sup.length !== 1 || !/Engineer access/.test(sup[0].title + sup[0].body) || sup[0].link !== "/admin/user-management") throw new Error("super admin not notified correctly: " + JSON.stringify(sup))
    if (reviewer.length !== 1) throw new Error("admin with users.approve not notified")
    if (viewOnly.length !== 0) throw new Error("admin without users.approve was notified")
    if (self.length !== 0) throw new Error("requester was notified of their own request")
  })

  await test("A declined request notifies the person with the admin's note; a role grant notifies them with their dashboard link", async () => {
    await asOwner()
    const rq = (await db.query("select id from public.access_requests where user_id = $1", [ids.basic1])).rows[0].id
    await db.query("update public.access_requests set status = 'rejected', decision_note = 'Please use your company email' where id = $1", [rq])
    const declined = await mine("basic1", "access.declined")
    if (declined.length !== 1 || !/company email/.test(declined[0].body)) throw new Error("decline not delivered with the note")
    await asOwner()
    await db.query("update public.profiles set role = 'engineer' where id = $1", [ids.basic2])
    const granted = await mine("basic2", "access.granted")
    if (granted.length !== 1 || granted[0].link !== "/engineer/dashboard" || !/Engineer/.test(granted[0].title)) throw new Error("role grant not delivered")
    await asOwner()
    await db.query("update public.profiles set role = 'user' where id = $1", [ids.basic2]) // back to a basic account for later tests
    if ((await mine("basic2", "access.granted")).length !== 1) throw new Error("a role going back to user should not notify again")
  })

  // ---------------------------------------------------------------- notifications: pin workflow
  await as("eng1", "aal2")
  const bp = (await db.query("insert into public.blueprints (project_id, title) values ($1, 'Notify plan') returning id", [P1])).rows[0].id
  const pin = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 20, 20, 'Beam B7') returning id", [P1, bp])).rows[0].id

  await test("Assigning a pin notifies the Foreman (not the person who assigned it)", async () => {
    await as("eng1", "aal2")
    await expectOk("update public.pins set assigned_to = $2 where id = $1", [pin, ids.fore1])
    const list = await mine("fore1", "pin.assigned", pin)
    if (list.length !== 1 || !/Beam B7/.test(list[0].title) || !list[0].link.startsWith("/foreman/dashboard?project=" + P1)) throw new Error("assignment not delivered: " + JSON.stringify(list))
    if ((await mine("eng1", "pin.assigned", pin)).length !== 0) throw new Error("assigner notified about their own action")
  })

  await test("Sending a pin for review notifies the project's Engineers except the sender; sending it back and verifying reach the Foreman; Clients hear about verified milestones", async () => {
    await as("fore1", "aal2")
    await submitWorkFixture({db,ids,as,asOwner},pin)
    const review = await mine("eng1", "pin.review", pin)
    if (review.length !== 1 || review[0].link !== `/engineer/verification?project=${P1}`) throw new Error("review request not delivered")
    if ((await mine("fore1", "pin.review", pin)).length !== 0) throw new Error("sender notified")
    if ((await mine("eng2", "pin.review", pin)).length !== 0) throw new Error("an engineer of another project was notified")
    await as("eng1", "aal2")
    await expectOk("select public.return_pin_for_correction($1,'Test step needs correction')", [pin])
    if ((await mine("fore1", "pin.returned", pin)).length !== 1) throw new Error("sent-back not delivered")
    await as("eng1", "aal2") // mine() above switched roles
    await passWorkFixture({db,ids,as,asOwner},pin)
    await expectOk("update public.pins set status = 'verified' where id = $1", [pin])
    const st = (await db.query("select status, assigned_to from public.pins where id = $1", [pin])).rows[0]
    const got = await mine("fore1", "pin.verified", pin)
    if (got.length !== 1) throw new Error("verified not delivered to the foreman: " + JSON.stringify(st) + " fore1=" + ids.fore1)
    const milestone = await mine("client1", "pin.milestone", pin)
    if (milestone.length !== 1 || milestone[0].link !== `/client/overview?project=${P1}`) throw new Error("client milestone missing")
  })

  await test("An issue reaches the project's Engineers", async () => {
    await as("eng1", "aal2")
    const issuePin = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title) values ($1, $2, 30, 30, 'Crack in slab') returning id", [P1, bp])).rows[0].id
    ids.issuePin = issuePin
    await expectOk("update public.pins set status = 'issue' where id = $1", [issuePin])
    if ((await mine("eng1", "pin.issue", issuePin)).length !== 0) throw new Error("the person who reported the issue was notified")
    await asOwner()
    const told = await count("select count(*) n from public.notifications where kind = 'pin.issue' and entity_id = $1", [issuePin])
    const others = await count("select count(*) n from public.project_members where project_id = $1 and member_role = 'engineer' and user_id <> $2", [P1, ids.eng1])
    if (told !== others) throw new Error(`expected ${others} Engineer(s) told, got ${told}`)
  })

  await test("Deadline reminders: due soon and overdue, only for your own pins, once per day", async () => {
    await as("eng1", "aal2")
    await asOwner() // Approved-date fixtures; Engineers now propose rather than directly set official dates.
    const late = (await db.query("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to, due_date) values ($1, $2, 40, 40, 'Late rebar', $3, current_date - 3) returning id", [P1, bp, ids.fore1])).rows[0].id
    await expectOk("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to, due_date) values ($1, $2, 50, 50, 'Soon pour', $3, current_date + 1)", [P1, bp, ids.fore1])
    await expectOk("insert into public.pins (project_id, blueprint_id, x, y, title, assigned_to, due_date) values ($1, $2, 60, 60, 'Far away', $3, current_date + 30)", [P1, bp, ids.fore1])
    await as("fore1", "aal2")
    const first = (await db.query("select public.generate_due_notifications() n")).rows[0].n
    const second = (await db.query("select public.generate_due_notifications() n")).rows[0].n
    const list = (await db.query("select kind, title from public.notifications where kind in ('pin.overdue', 'pin.due') order by title")).rows
    if (first !== 2 || second !== 0) throw new Error(`expected 2 then 0 reminders, got ${first} then ${second}`)
    if (!list.some((r) => r.kind === "pin.overdue" && /Late rebar/.test(r.title)) || !list.some((r) => r.kind === "pin.due" && /Soon pour/.test(r.title))) throw new Error("wrong reminders")
    await as("client1", "aal2")
    if ((await db.query("select public.generate_due_notifications() n")).rows[0].n !== 0) throw new Error("a client received reminders")
    await as("eng2", "aal2")
    if ((await db.query("select public.generate_due_notifications() n")).rows[0].n !== 0) throw new Error("an outsider received reminders")
    void late
  })

  await test("Notifications are private: only your own, can be marked read or cleared, cannot be written or read by anyone else", async () => {
    await as("eng1", "aal2")
    const own = await mine("eng1")
    if (!own.length) throw new Error("eng1 has no notifications to test with")
    const foreignCount = await count("select count(*) n from public.notifications where user_id <> auth.uid()")
    if (foreignCount !== 0) throw new Error("another person's notifications are visible")
    await expectFail("insert into public.notifications (user_id, kind, title) values ($1, 'x', 'forged')", [ids.eng1], /permission denied/)
    await expectFail("update public.notifications set title = 'changed'", [], /permission denied/)
    const marked = (await db.query("select public.mark_notifications_read($1::uuid[]) n", [[own[0].id]])).rows[0].n
    if (marked !== 1) throw new Error("mark read failed")
    const all = (await db.query("select public.mark_notifications_read() n")).rows[0].n
    if (all !== own.length - 1) throw new Error(`expected ${own.length - 1} more, got ${all}`)
    if ((await db.query("select public.mark_notifications_read() n")).rows[0].n !== 0) throw new Error("already read items were counted")
    await as("fore1", "aal2")
    if ((await db.query("select public.mark_notifications_read($1::uuid[]) n", [[own[0].id]])).rows[0].n !== 0) throw new Error("marked someone else's notification")
    const del = await db.query("delete from public.notifications where id = $1 returning id", [own[0].id])
    if (del.rows.length) throw new Error("deleted someone else's notification")
    await as("eng1", "aal2")
    const cleared = await db.query("delete from public.notifications where id = $1 returning id", [own[0].id])
    if (cleared.rows.length !== 1) throw new Error("could not clear own notification")
    await as(null)
    await expectFail("select * from public.notifications", [], /permission denied/)
  })

  await test("Notification content is validated (link shape, title length, kind)", async () => {
    await asOwner()
    await expectFail("insert into public.notifications (user_id, kind, title, link) values ($1, 'x', 'bad link', 'https://evil.example/')", [ids.eng1], /check constraint/)
    await expectFail("insert into public.notifications (user_id, kind, title, link) values ($1, 'x', 'bad link', '//evil.example')", [ids.eng1], /check constraint/)
    await expectFail("insert into public.notifications (user_id, kind, title) values ($1, 'x', '')", [ids.eng1], /check constraint/)
    await expectOk("insert into public.notifications (user_id, kind, title, link) values ($1, 'x', 'fine', '/engineer/verification?project=abc-123')", [ids.eng1])
  })

  // ---------------------------------------------------------------- invitation codes
  await test("Only people who review requests can create invitations; Admin / Super Admin roles cannot be invited", async () => {
    await as("super", "aal2")
    ids.invite1 = (await db.query("select public.create_invite('engineer', 'mep', 'Batch for Block A', 1, 7) code")).rows[0].code
    if (!/^[A-F0-9]{12}$/.test(ids.invite1)) throw new Error(`bad code format ${ids.invite1}`)
    await as("noperm", "aal2")
    await expectOk("select public.create_invite('foreman')")
    await as("admin", "aal2")
    await expectFail("select public.create_invite('engineer')", [], /Missing permission/)
    await as("super", "aal2")
    await expectFail("select public.create_invite('admin')", [], /Engineer, Foreman or Client/)
    await expectFail("select public.create_invite('client', null, null, 1, 0)", [], /between 1 and 90/)
    await expectFail("select public.create_invite('client', null, null, 500, 7)", [], /check constraint/)
    await as("super", "aal1")
    await expectFail("select public.create_invite('client')", [], /Missing permission/)
    for (const who of ["eng1", "client1", "basic1"]) {
      await as(who, "aal2")
      await expectFail("select public.create_invite('client')", [], /Missing permission/)
    }
  })

  await test("Redeeming a code gives the role at once (single use), keeps the code readable for admins, and is audited", async () => {
    await as("basic3", "aal2")
    const bad = (await db.query("select public.redeem_invite('WRONGCODE123') r")).rows[0].r
    if (bad.ok !== false || bad.reason !== "invalid") throw new Error("a wrong code was accepted")
    const typed = ids.invite1.toLowerCase().replace(/(.{4})(.{4})(.{4})/, "$1-$2-$3") // lower case with dashes, as people type it
    const ok = (await db.query("select public.redeem_invite($1) r", [typed])).rows[0].r
    if (!ok.ok || ok.role !== "engineer") throw new Error(`redeem failed: ${JSON.stringify(ok)}`)
    await asOwner()
    const p = (await db.query("select role, discipline, approved_by from public.profiles where id = $1", [ids.basic3])).rows[0]
    if (p.role !== "engineer" || p.discipline !== "mep" || p.approved_by !== ids.super) throw new Error(`profile not updated: ${JSON.stringify(p)}`)
    if ((await count("select count(*) n from public.audit_log where action = 'invite.redeem'")) !== 1) throw new Error("redeem not audited")
    if ((await mine("basic3", "access.granted")).length !== 1) throw new Error("role notification missing after redeeming")
    await as("super", "aal2")
    const row = (await db.query("select uses, max_uses from public.invite_codes where code = $1", [ids.invite1])).rows[0]
    if (row.uses !== 1 || row.max_uses !== 1) throw new Error("use count not updated")
    await as("basic1", "aal2")
    const again = (await db.query("select public.redeem_invite($1) r", [ids.invite1])).rows[0].r
    if (again.ok || again.reason !== "invalid") throw new Error("a used code worked twice")
  })

  await test("Codes can be limited, multi-use, expire and be disabled; nobody but a confirmed basic user can redeem", async () => {
    await as("super", "aal2")
    const multi = (await db.query("select public.create_invite('client', null, 'Client site visit', 2, 3) code")).rows[0].code
    const disabled = (await db.query("select public.create_invite('foreman') code")).rows[0].code
    const disabledId = (await db.query("select id from public.invite_codes where code = $1", [disabled])).rows[0].id
    await expectOk("select public.set_invite_disabled($1, true)", [disabledId])
    await asOwner()
    const expired = (await db.query("insert into public.invite_codes (code, assigned_role, expires_at) values ('ABCDEF012345', 'client', now() - interval '1 minute') returning code")).rows[0].code
    await as("basic1", "aal2")
    for (const code of [disabled, expired]) {
      const r = (await db.query("select public.redeem_invite($1) r", [code])).rows[0].r
      if (r.ok || r.reason !== "invalid") throw new Error(`code ${code} should not work`)
    }
    const first = (await db.query("select public.redeem_invite($1) r", [multi])).rows[0].r
    if (!first.ok || first.role !== "client") throw new Error("first use failed")
    await as("basic4", "aal2")
    const unconfirmed = (await db.query("select public.redeem_invite($1) r", [multi])).rows[0].r
    if (unconfirmed.ok || unconfirmed.reason !== "unconfirmed") throw new Error("an unconfirmed email redeemed a code")
    await as("eng1", "aal2")
    const has = (await db.query("select public.redeem_invite($1) r", [multi])).rows[0].r
    if (has.ok || has.reason !== "already_has_role") throw new Error("a person with a role redeemed a code")
    await as("super", "aal2")
  })

  await test("Guessing is limited to 8 misses per hour; the limit blocks even a correct code until it passes", async () => {
    await asOwner()
    await addUser("guesser", "user")
    await confirm("guesser")
    await as("super", "aal2")
    const good = (await db.query("select public.create_invite('client') code")).rows[0].code
    await as("guesser", "aal2")
    for (let i = 0; i < 8; i++) {
      const r = (await db.query("select public.redeem_invite($1) r", [`BADCODE0000${i}`])).rows[0].r
      if (r.reason !== "invalid") throw new Error(`miss ${i + 1} gave ${r.reason}`)
    }
    const blocked = (await db.query("select public.redeem_invite($1) r", [good])).rows[0].r
    if (blocked.ok || blocked.reason !== "too_many") throw new Error("the rate limit did not stop a correct code")
    await asOwner()
    await db.query("update public.invite_attempts set created_at = now() - interval '2 hours' where user_id = $1", [ids.guesser])
    await as("guesser", "aal2")
    const later = (await db.query("select public.redeem_invite($1) r", [good])).rows[0].r
    if (!later.ok) throw new Error("the code should work again after the hour")
  })

  await test("Invite tables: admins who review users read them; nobody writes through the API; ordinary users see nothing", async () => {
    await as("super", "aal2")
    if ((await count("select count(*) n from public.invite_codes")) < 3) throw new Error("super admin cannot read invites")
    await as("noperm", "aal2")
    if ((await count("select count(*) n from public.invite_codes")) < 3) throw new Error("a reviewing admin cannot read invites")
    await expectFail("insert into public.invite_codes (code, assigned_role, expires_at) values ('AAAAAAAAAAAA', 'client', now() + interval '1 day')", [], /permission denied/)
    await expectFail("update public.invite_codes set uses = 0", [], /permission denied/)
    await as("eng1", "aal2")
    if ((await count("select count(*) n from public.invite_codes")) !== 0) throw new Error("an engineer reads invite codes")
    await as("basic1", "aal2")
    await expectFail("select * from public.invite_attempts", [], /permission denied/)
    await as(null)
    await expectFail("select public.redeem_invite('AAAAAAAAAAAA')", [], /permission denied/)
  })

  // ---------------------------------------------------------------- severity
  await test("Pin severity: default medium, four levels, edits are logged on the timeline", async () => {
    await as("eng1", "aal2")
    if ((await db.query("select severity from public.pins where id = $1", [ids.issuePin])).rows[0].severity !== "medium") throw new Error("default is not medium")
    await expectOk("update public.pins set severity = 'critical' where id = $1", [ids.issuePin])
    await expectFail("update public.pins set severity = 'urgent' where id = $1", [ids.issuePin], /check constraint/)
    const edited = await count("select count(*) n from public.pin_events where pin_id = $1 and kind = 'edited'", [ids.issuePin])
    if (edited < 1) throw new Error("severity change not on the timeline")
    await as("fore1", "aal2")
    const upd = await db.query("update public.pins set severity = 'low' where id = $1 returning id", [ids.issuePin])
    if (upd.rows.length) throw new Error("a foreman changed the severity directly")
  })

  // ---------------------------------------------------------------- audit log
  await test("The audit log viewer needs users.view with MFA; it searches by text, action and dates and pages results", async () => {
    await as("admin", "aal2")
    const all = (await db.query("select * from public.get_audit_log(null, null, null, null, 500, 0)")).rows
    if (all.length < 5) throw new Error("audit log is empty")
    const redeem = (await db.query("select * from public.get_audit_log(null, 'invite.redeem', null, null, 50, 0)")).rows
    if (redeem.length < 2 || redeem.some((r) => r.action !== "invite.redeem")) throw new Error("action filter wrong")
    if (!redeem[0].actor_name || !redeem[0].summary) throw new Error("names or summary missing")
    const text = (await db.query("select * from public.get_audit_log('Block A', null, null, null, 50, 0)")).rows
    if (text.length < 1) throw new Error("text search found nothing")
    const future = (await db.query("select * from public.get_audit_log(null, null, now() + interval '1 day', null, 50, 0)")).rows
    if (future.length !== 0) throw new Error("date filter wrong")
    const page1 = (await db.query("select id from public.get_audit_log(null, null, null, null, 2, 0)")).rows
    const page2 = (await db.query("select id from public.get_audit_log(null, null, null, null, 2, 2)")).rows
    if (page1.length !== 2 || page2.some((r) => page1.some((p) => p.id === r.id))) throw new Error("paging overlaps")
    if (Number(page1[0].id) < Number(page1[1].id)) throw new Error("not newest first")
    await as("admin", "aal1")
    await expectFail("select * from public.get_audit_log()", [], /Missing permission/)
    await asOwner()
    await db.query("delete from public.admin_permissions where user_id = $1 and permission = 'users.view'", [ids.projonly ?? ids.admin])
    for (const who of ["eng1", "client1", "basic1"]) {
      await as(who, "aal2")
      await expectFail("select * from public.get_audit_log()", [], /Missing permission/)
    }
    await as(null)
    await expectFail("select * from public.get_audit_log()", [], /permission denied/)
  })

  // ---------------------------------------------------------------- profile photo
  await test("People can set their own photo link (https only) and nobody else's", async () => {
    await as("eng1", "aal2")
    await expectOk("update public.profiles set avatar_url = 'https://x.example/storage/avatars/a.webp' where id = $1", [ids.eng1])
    await expectFail("update public.profiles set avatar_url = 'http://insecure.example/a.png' where id = $1", [ids.eng1], /check constraint/)
    const other = await db.query("update public.profiles set avatar_url = 'https://x.example/a.png' where id = $1 returning id", [ids.fore1])
    if (other.rows.length) throw new Error("changed someone else's photo")
    await expectFail("update public.profiles set role = 'admin' where id = $1", [ids.eng1], /permission denied/)
  })
}
