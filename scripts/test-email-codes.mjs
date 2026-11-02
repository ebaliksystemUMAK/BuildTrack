import assert from "node:assert/strict"
import { passwordIssue } from "../src/lib/passwordPolicy.ts"
import { brevoReady, buildCodeEmail, buildPasswordChangedEmail, sendMail } from "../supabase/functions/_shared/codeEmail.ts"
import { handleCode } from "../supabase/functions/_shared/codeHandler.ts"
import { CODE_ACTIONS, authorizeCodeAction, generateCode, hashCode, isCode, isEmail, messages, normalizeEmail, passwordProblem } from "../supabase/functions/_shared/codeModel.ts"

// Everything here runs against fakes: no email is sent, no account is touched, no database is used.

// ---------------------------------------------------------------- the pure rules
{
  assert.equal(generateCode(() => new Uint8Array([0])), "000000", "leading zeros are kept")
  const queue = [255, 251, 7, 249, 3, 250, 0, 9, 1, 2]
  assert.equal(generateCode((bytes) => { bytes[0] = queue.shift(); return bytes }), "793091", "bytes of 250 or more are skipped, so no digit is more likely than another")
  const counts = Array(10).fill(0)
  for (let i = 0; i < 4000; i++) for (const digit of generateCode()) counts[Number(digit)]++
  for (const count of counts) assert.ok(count > 2200 && count < 2600, `every digit about equally often: ${counts}`)
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/)
  for (const bad of ["12345", "1234567", "12345a", " 12345", "", null, 123456, undefined]) assert.equal(isCode(bad), false, String(bad))
  assert.equal(isCode("012345"), true)
  assert.equal(normalizeEmail("  Santos@Example.COM "), "santos@example.com"); assert.equal(normalizeEmail(5), ""); assert.equal(isEmail("a@b.co"), true); for (const bad of ["", "a@b", "a b@c.de", "@b.co", "a@@b.co"]) assert.equal(isEmail(bad), false, bad)

  const base = await hashCode("secret", "reset", "a@b.co", "123456")
  assert.match(base, /^[0-9a-f]{64}$/); assert.equal(await hashCode("secret", "reset", "a@b.co", "123456"), base, "the same input gives the same hash")
  for (const other of [await hashCode("other", "reset", "a@b.co", "123456"), await hashCode("secret", "register", "a@b.co", "123456"), await hashCode("secret", "reset", "c@b.co", "123456"), await hashCode("secret", "reset", "a@b.co", "123457")])
    assert.notEqual(other, base, "the secret, the purpose, the address and the code all change the hash")

  // the server's password rule is the same as the browser's
  const samples = ["", "short", "alllowercaselong1!", "ALLUPPERCASELONG1!", "NoNumbersHere!!!!", "NoSpecial12345Aa", "Correct-Horse-9-Battery", "Aa1!Aa1!Aa1!", "Aa1!Aa1!Aa1", "x".repeat(300) + "Aa1!", "Spaces are ok 1A!x"]
  for (const sample of samples) {
    if (sample.length > 200) { assert.equal(passwordProblem(sample), "That password is too long."); continue }
    const server = passwordProblem(sample), browser = passwordIssue(sample)
    assert.equal(server === null ? "" : server, browser, JSON.stringify(sample))
  }
  assert.match(passwordProblem(undefined), /Enter a new password/); assert.match(passwordProblem(12345), /Enter a new password/)

  assert.deepEqual(authorizeCodeAction("send_reset", false), { ok: true, action: "send_reset" }); assert.deepEqual(authorizeCodeAction("verify_reset", false), { ok: true, action: "verify_reset" })
  for (const action of ["send_register", "verify_register"]) { assert.equal(authorizeCodeAction(action, false).status, 401); assert.equal(authorizeCodeAction(action, true).ok, true) }
  for (const bad of ["", "delete", null, 5, undefined, "SEND_RESET"]) assert.equal(authorizeCodeAction(bad, true).status, 400, String(bad))
  assert.equal(CODE_ACTIONS.length, 5); assert.deepEqual(authorizeCodeAction("check_reset", false), { ok: true, action: "check_reset" })
}

// ---------------------------------------------------------------- the emails and the mail provider call
{
  const mail = buildCodeEmail({ purpose: "reset", code: "042913", name: "Eduardo <b>Santos</b>" })
  assert.equal(mail.subject, "Your BuildTrack password reset code"); assert.match(mail.html, /042913/); assert.match(mail.text, /Code: 042913/); assert.match(mail.html, /Hello Eduardo/); assert.doesNotMatch(mail.html, /<b>Santos/, "a name is escaped")
  assert.match(mail.text, /10 minutes/); assert.match(mail.text, /Never share it/); assert.match(mail.text, /password stays the same/)
  const register = buildCodeEmail({ purpose: "register", code: "111222", name: null }); assert.equal(register.subject, "Your BuildTrack verification code"); assert.match(register.text, /Hello there/); assert.doesNotMatch(register.text, /password stays the same/)
  assert.match(buildPasswordChangedEmail({ name: "Ana Cruz" }).text, /was just changed/); assert.doesNotMatch(buildPasswordChangedEmail({ name: "Ana" }).html, /\d{6}/, "the notice carries no code")

  const env = (values) => (name) => values[name]
  const good = { BREVO_API_KEY: "xkeysib-abcdef123456", MAIL_FROM_EMAIL: "buildtracksupport@gmail.com", MAIL_FROM_NAME: "BuildTrack" }
  const reply = (status, body = "{}") => async () => ({ ok: status >= 200 && status < 300, status, text: async () => body })
  assert.deepEqual(await brevoReady({ read: env({}), fetchImpl: reply(200) }), { ok: false, reason: "not_configured" })
  assert.deepEqual(await brevoReady({ read: env({ BREVO_API_KEY: "k", MAIL_FROM_EMAIL: "bad" }), fetchImpl: reply(200) }), { ok: false, reason: "not_configured" })
  assert.deepEqual(await brevoReady({ read: env(good), fetchImpl: reply(401, '{"message":"Key not found"}') }), { ok: false, reason: "key_rejected" }, "the exact failure seen on 2026-11-01")
  assert.deepEqual(await brevoReady({ read: env(good), fetchImpl: reply(200) }), { ok: true })
  assert.deepEqual(await brevoReady({ read: env(good), fetchImpl: async () => { throw new Error("offline") } }), { ok: false, reason: "unreachable" })
  const seen = []
  const spy = async (input, init) => { seen.push([input, init]); return { ok: true, status: 201, text: async () => "{}" } }
  const sent = await sendMail({ read: env(good), fetchImpl: spy, to: "a@b.co", toName: "Ana", mail, tag: "t" })
  assert.equal(sent.ok, true); assert.equal(seen[0][0], "https://api.brevo.com/v3/smtp/email"); assert.equal(JSON.parse(seen[0][1].body).to[0].email, "a@b.co"); assert.equal(JSON.parse(seen[0][1].body).sender.email, "buildtracksupport@gmail.com")
  const refused = await sendMail({ read: env(good), fetchImpl: reply(401, '{"message":"Key not found xkeysib-abcdef123456"}'), to: "a@b.co", toName: null, mail, tag: "t" })
  assert.equal(refused.ok, false); assert.match(refused.detail, /HTTP 401/); assert.doesNotMatch(refused.detail, /xkeysib-abcdef123456/, "the key is never repeated")
  assert.equal((await sendMail({ read: env({}), fetchImpl: spy, to: "a@b.co", toName: null, mail, tag: "t" })).ok, false)
}

// ---------------------------------------------------------------- the function's decisions, with a fake database and mail provider
const KEY = "service-secret"
function world() {
  const state = {
    users: { u1: { id: "u1", email: "santos@example.com", full_name: "Eduardo Santos", status: "active", email_verified_at: null }, u2: { id: "u2", email: "gone@example.com", full_name: "Gone", status: "disabled", email_verified_at: null }, u3: { id: "u3", email: "done@example.com", full_name: "Done", status: "active", email_verified_at: "2026-10-01" } },
    codes: [], issued: [], mails: [], updated: [], revoked: [], audit: [], verified: [], consumeCalls: 0, brevo: { account: 200, send: 201 }, rate: null, updateError: null, logs: [],
  }
  const tokens = { "token-u1": "u1", "token-u3": "u3" } // anything else (the public key) belongs to nobody
  const admin = {
    auth: {
      getUser: async (token) => { const id = tokens[token]; return { data: { user: id ? { id, email: state.users[id].email } : null } } },
      admin: { updateUserById: async (id, attrs) => { if (state.updateError) return { error: { message: state.updateError } }; state.updated.push([id, attrs.password]); return { error: null } } },
    },
    from: (table) => ({
      select: () => ({ eq: (column, value) => ({ maybeSingle: async () => ({ data: Object.values(state.users).find((u) => u[column] === value) ?? null }) }) }),
      insert: async (row) => { if (table === "audit_log") state.audit.push(row) },
    }),
    rpc: async (name, args) => {
      if (name === "issue_email_code") { if (state.rate) return { error: state.rate }; state.issued.push(args); state.codes = state.codes.filter((c) => !(c.email === args.p_email && c.purpose === args.p_purpose)); state.codes.push({ email: args.p_email, purpose: args.p_purpose, hash: args.p_hash, user_id: args.p_user, attempts: 0 }); return { error: null } }
      if (name === "check_email_code") {
        state.checkCalls = (state.checkCalls ?? 0) + 1
        const c = state.codes.find((x) => x.email === args.p_email && x.purpose === args.p_purpose)
        if (!c) return { data: { ok: false, reason: "invalid" } }
        if (c.attempts >= 5) return { data: { ok: false, reason: "locked" } }
        if (c.hash === args.p_hash) return { data: { ok: true } }
        c.attempts++; return { data: { ok: false, reason: c.attempts >= 5 ? "locked" : "invalid" } }
      }
      if (name === "consume_email_code") {
        state.consumeCalls++
        const c = state.codes.find((x) => x.email === args.p_email && x.purpose === args.p_purpose)
        if (!c) return { data: { ok: false, reason: "invalid" } }
        if (c.attempts >= 5) return { data: { ok: false, reason: "locked" } }
        if (c.hash === args.p_hash) { state.codes = state.codes.filter((x) => x !== c); return { data: { ok: true, user_id: c.user_id } } }
        c.attempts++; return { data: { ok: false, reason: c.attempts >= 5 ? "locked" : "invalid" } }
      }
      if (name === "mark_email_verified") { state.verified.push(args.p_user); state.users[args.p_user].email_verified_at = "now"; return { error: null } }
      if (name === "revoke_user_sessions") { state.revoked.push(args.p_user); return { error: null } }
      throw new Error("unexpected rpc " + name)
    },
  }
  const fetchImpl = async (input, init) => {
    if (input.endsWith("/account")) return { ok: state.brevo.account === 200, status: state.brevo.account, text: async () => "{}" }
    const body = JSON.parse(init.body); state.mails.push({ to: body.to[0].email, subject: body.subject, html: body.htmlContent, text: body.textContent })
    return { ok: state.brevo.send < 300, status: state.brevo.send, text: async () => "{}" }
  }
  const read = (name) => ({ BREVO_API_KEY: "xkeysib-test", MAIL_FROM_EMAIL: "from@example.com" })[name]
  const call = (body, token = "public-key") => handleCode({ body, token }, { admin, read, fetchImpl, serviceKey: KEY, log: (m) => state.logs.push(m) })
  const codeIn = (mail) => mail.text.match(/Code: (\d{6})/)[1]
  return { state, call, codeIn }
}

{
  // ---- forgot password: nobody can learn which addresses have accounts
  let w = world()
  const known = await w.call({ action: "send_reset", email: " Santos@Example.com " })
  const unknown = await w.call({ action: "send_reset", email: "nobody@example.com" })
  const suspended = await w.call({ action: "send_reset", email: "gone@example.com" })
  assert.deepEqual(known, { status: 200, body: { ok: true, message: messages.sent } }); assert.deepEqual(unknown, known, "an address with no account gets the identical answer"); assert.deepEqual(suspended, known, "so does a suspended account")
  assert.equal(w.state.mails.length, 1, "only the active account was emailed"); assert.equal(w.state.mails[0].to, "santos@example.com"); assert.match(w.state.mails[0].subject, /password reset code/)
  assert.equal(w.state.issued.length, 3, "the limits are counted for every address"); assert.deepEqual(w.state.issued.map((i) => i.p_user), ["u1", null, null]); assert.ok(w.state.issued.every((i) => /^[0-9a-f]{64}$/.test(i.p_hash) && i.p_minutes === 10))
  const code = w.codeIn(w.state.mails[0]); assert.equal(w.state.issued[0].p_hash, await hashCode(KEY, "reset", "santos@example.com", code), "the database holds only the hash of the emailed code")
  assert.ok(!JSON.stringify(w.state.issued).includes(code), "never the code itself")
  assert.equal((await w.call({ action: "send_reset", email: "not an email" })).status, 400)

  w = world(); w.state.brevo.account = 401
  const rejectedKnown = await w.call({ action: "send_reset", email: "santos@example.com" }), rejectedUnknown = await w.call({ action: "send_reset", email: "nobody@example.com" })
  assert.deepEqual(rejectedKnown, { status: 503, body: { error: messages.unavailable } }); assert.deepEqual(rejectedUnknown, rejectedKnown, "a rejected mail key is reported the same for everyone, and it is reported instead of silently sending nothing")
  assert.equal(w.state.issued.length, 0, "no code is made when it cannot be sent")
  w = world(); w.state.rate = { code: "P0001", message: "Wait a minute before asking for another code" }
  const limitedKnown = await w.call({ action: "send_reset", email: "santos@example.com" }), limitedUnknown = await w.call({ action: "send_reset", email: "nobody@example.com" })
  assert.equal(limitedKnown.status, 429); assert.deepEqual(limitedUnknown, limitedKnown, "the waiting time applies to every address alike"); assert.equal(w.state.mails.length, 0)
  w = world(); w.state.brevo.send = 500
  assert.deepEqual(await w.call({ action: "send_reset", email: "santos@example.com" }), known, "a failed send does not change the answer"); assert.match(w.state.logs[0], /reset code not sent/)

  // ---- forgot password: the code is checked on its own step, without being used up
  w = world(); await w.call({ action: "send_reset", email: "santos@example.com" })
  const typed = w.codeIn(w.state.mails[0]), wrongTyped = typed === "000000" ? "000001" : "000000"
  assert.equal((await w.call({ action: "check_reset", email: "not an email", code: typed })).status, 400); assert.equal((await w.call({ action: "check_reset", email: "santos@example.com", code: "12" })).status, 400)
  assert.deepEqual(await w.call({ action: "check_reset", email: "santos@example.com", code: wrongTyped }), { status: 400, body: { error: messages.invalid } })
  assert.deepEqual(await w.call({ action: "check_reset", email: "santos@example.com", code: typed }), { status: 200, body: { ok: true } })
  assert.deepEqual(await w.call({ action: "check_reset", email: "santos@example.com", code: typed }), { status: 200, body: { ok: true } }, "checking twice is fine: nothing is used up")
  assert.equal(w.state.updated.length, 0, "checking never changes a password"); assert.equal(w.state.consumeCalls, 0); assert.equal(w.state.mails.length, 1, "and sends nothing")
  assert.equal((await w.call({ action: "verify_reset", email: "santos@example.com", code: typed, password: "Correct-Horse-9-Battery" })).status, 200, "the change still works after the check")
  assert.equal((await w.call({ action: "check_reset", email: "santos@example.com", code: typed })).status, 400, "and uses the code up")
  w = world(); const unknownCheck = await w.call({ action: "check_reset", email: "nobody@example.com", code: "123456" }); assert.deepEqual(unknownCheck, { status: 400, body: { error: messages.invalid } }, "an address with no account gets the same refusal as a wrong code")
  w = world(); await w.call({ action: "send_reset", email: "santos@example.com" }); const lockCode = w.codeIn(w.state.mails[0]), lockWrong = lockCode === "999999" ? "999998" : "999999"
  for (let i = 0; i < 5; i++) await w.call({ action: "check_reset", email: "santos@example.com", code: lockWrong })
  assert.deepEqual(await w.call({ action: "check_reset", email: "santos@example.com", code: lockCode }), { status: 400, body: { error: messages.locked } })

  // ---- forgot password: the code and the new password
  w = world(); await w.call({ action: "send_reset", email: "santos@example.com" })
  const good = w.codeIn(w.state.mails[0]), strong = "Correct-Horse-9-Battery"
  const weak = await w.call({ action: "verify_reset", email: "santos@example.com", code: good, password: "short" })
  assert.equal(weak.status, 400); assert.match(weak.body.error, /Password needs/); assert.equal(w.state.consumeCalls, 0, "a weak password is refused BEFORE the code is used up")
  assert.equal((await w.call({ action: "verify_reset", email: "santos@example.com", code: "12ab56", password: strong })).status, 400)
  const wrong = await w.call({ action: "verify_reset", email: "santos@example.com", code: good === "000000" ? "000001" : "000000", password: strong }); assert.deepEqual(wrong, { status: 400, body: { error: messages.invalid } }); assert.equal(w.state.updated.length, 0)
  const otherAddress = await w.call({ action: "verify_reset", email: "done@example.com", code: good, password: strong }); assert.equal(otherAddress.status, 400, "a code only works for the address it was sent to"); assert.equal(w.state.updated.length, 0)
  const done = await w.call({ action: "verify_reset", email: "santos@example.com", code: good, password: strong })
  assert.deepEqual(done, { status: 200, body: { ok: true } }); assert.deepEqual(w.state.updated, [["u1", strong]]); assert.deepEqual(w.state.revoked, ["u1"], "every other sign-in ends")
  assert.deepEqual(w.state.audit.map((a) => a.action), ["account.password_reset"]); assert.equal(w.state.audit[0].details.via, "email_code"); assert.match(w.state.mails.at(-1).subject, /password was changed/); assert.doesNotMatch(JSON.stringify(w.state.audit), new RegExp(strong), "the password is never logged")
  assert.equal((await w.call({ action: "verify_reset", email: "santos@example.com", code: good, password: strong })).status, 400, "a code works once")
  // five wrong tries lock it
  w = world(); await w.call({ action: "send_reset", email: "santos@example.com" }); const realCode = w.codeIn(w.state.mails[0]); const bad = realCode === "999999" ? "999998" : "999999"
  for (let i = 0; i < 5; i++) await w.call({ action: "verify_reset", email: "santos@example.com", code: bad, password: strong })
  assert.deepEqual(await w.call({ action: "verify_reset", email: "santos@example.com", code: realCode, password: strong }), { status: 400, body: { error: messages.locked } }); assert.equal(w.state.updated.length, 0)
  // an account suspended after the code was sent cannot reset; password-service errors become readable messages
  w = world(); await w.call({ action: "send_reset", email: "santos@example.com" }); const c2 = w.codeIn(w.state.mails[0]); w.state.users.u1.status = "disabled"
  assert.equal((await w.call({ action: "verify_reset", email: "santos@example.com", code: c2, password: strong })).status, 400); assert.equal(w.state.updated.length, 0)
  for (const [message, expected] of [["New password should be different from the old password.", /not used before/], ["Password is known to be weak and easy to guess", /too easy to guess/], ["boom", /could not be changed/]]) {
    w = world(); await w.call({ action: "send_reset", email: "santos@example.com" }); w.state.updateError = message
    const r = await w.call({ action: "verify_reset", email: "santos@example.com", code: w.codeIn(w.state.mails[0]), password: strong }); assert.equal(r.status, 400); assert.match(r.body.error, expected, message); assert.deepEqual(w.state.revoked, [], "a failed change signs nobody out")
  }
  // a register code never opens a reset
  w = world(); await w.call({ action: "send_register" }, "token-u1"); const regCode = w.codeIn(w.state.mails[0])
  assert.equal((await w.call({ action: "verify_reset", email: "santos@example.com", code: regCode, password: strong })).status, 400, "the purpose is part of the code")

  // ---- confirming the signed-in person's own address
  w = world()
  assert.deepEqual(await w.call({ action: "send_register" }), { status: 401, body: { error: "Sign in first" } }); assert.deepEqual(await w.call({ action: "verify_register", code: "123456" }), { status: 401, body: { error: "Sign in first" } }); assert.equal(w.state.mails.length, 0)
  assert.deepEqual(await w.call({ action: "send_register", email: "attacker@evil.test" }, "token-u1"), { status: 200, body: { ok: true } })
  assert.equal(w.state.mails.length, 1); assert.equal(w.state.mails[0].to, "santos@example.com", "the code goes to the signed-in person's own address, never one from the request")
  const mine = w.codeIn(w.state.mails[0])
  assert.equal((await w.call({ action: "verify_register", code: "12" }, "token-u1")).status, 400)
  assert.deepEqual(await w.call({ action: "verify_register", code: mine === "000000" ? "000001" : "000000" }, "token-u1"), { status: 400, body: { error: messages.invalid } }); assert.deepEqual(w.state.verified, [])
  assert.deepEqual(await w.call({ action: "verify_register", code: mine }, "token-u1"), { status: 200, body: { ok: true } }); assert.deepEqual(w.state.verified, ["u1"])
  assert.deepEqual(await w.call({ action: "send_register" }, "token-u1"), { status: 200, body: { ok: true, already: true } }, "an already verified account is not emailed again"); assert.equal(w.state.mails.length, 1)
  assert.equal((await w.call({ action: "send_register" }, "token-u3")).body.already, true)
  // somebody else's code does not verify me
  w = world(); w.state.codes.push({ email: "santos@example.com", purpose: "register", hash: await hashCode(KEY, "register", "santos@example.com", "555555"), user_id: "someone-else", attempts: 0 })
  assert.equal((await w.call({ action: "verify_register", code: "555555" }, "token-u1")).status, 400); assert.deepEqual(w.state.verified, [])
  // the mail service is down: say so, plainly
  w = world(); w.state.brevo.account = 401
  assert.deepEqual(await w.call({ action: "send_register" }, "token-u1"), { status: 503, body: { error: messages.unavailableRegister } })
  w = world(); w.state.brevo.send = 500
  assert.deepEqual(await w.call({ action: "send_register" }, "token-u1"), { status: 502, body: { error: messages.unavailableRegister } })
  w = world(); w.state.rate = { code: "P0001", message: "Wait a minute before asking for another code" }
  assert.deepEqual(await w.call({ action: "send_register" }, "token-u1"), { status: 429, body: { error: "Wait a minute before asking for another code" } })
  w = world(); assert.equal((await w.call({ action: "send_register" }, "token-u2".replace("u2", "u1"))).status, 200); w.state.users.u1.status = "disabled"
  assert.equal((await w.call({ action: "send_register" }, "token-u1")).status, 403, "a suspended account is not verified")
  assert.equal((await w.call({ action: "nope" })).status, 400)
}

console.log("Emailed codes: generation, hashing, password rule parity, emails, mail key check, reset and register flows, no account discovery, limits and failures passed")
