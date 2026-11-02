import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import ts from "typescript"
import { HEALTH_ACTIONS, authorizeHealthCaller, cleanMessageId, interpretEvents, mailConfig, sanitizeProviderText } from "../supabase/functions/_shared/healthModel.ts"
import { checkTestEmail, sendTestEmail } from "../supabase/functions/_shared/emailTest.ts"
import { BUCKETS, FEATURES, TRACKED_MIGRATIONS, manifestItems } from "../src/lib/healthManifest.ts"
import { DIGEST_SCHEDULE_SQL, evaluateHealth, statusLabel, summarize, worst } from "../src/lib/healthModel.ts"

// Everything here runs against fakes: no database, no network, no email is ever sent and no secret is read.
const url = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64")
const fileUrl = (path) => new URL(path, import.meta.url).href
const settle = () => new Promise((resolve) => setImmediate(resolve))
const SECRET = "xkeysib-0123456789abcdef0123456789abcdef-AbCdEfGhIjKlMnOp"

// ---------------------------------------------------------------- who may use the function, and what is said about the settings
{
  for (const action of HEALTH_ACTIONS) {
    assert.deepEqual(authorizeHealthCaller("super_admin", action), { ok: true, action })
    for (const role of ["admin", "project_manager", "engineer", "foreman", "client", "user", null, undefined, ""]) assert.deepEqual(authorizeHealthCaller(role, action), { ok: false, status: 403, message: "Only a Super Admin can use the system health checks" }, `${role} / ${action}`)
  }
  for (const action of ["send_email", "", null, 5, undefined, "CONFIG"]) assert.equal(authorizeHealthCaller("super_admin", action).status, 400)

  const full = { BREVO_API_KEY: SECRET, MAIL_FROM_EMAIL: "no-reply@example.test", MAIL_FROM_NAME: "BuildTrack", APP_URL: "https://app.example.test", CRON_SECRET: "a-long-random-cron-secret-value" }
  const config = mailConfig((name) => full[name])
  assert.deepEqual(config, { brevo_api_key: true, mail_from_email: true, mail_from_name: true, app_url: { set: true, valid: true }, cron_secret: { set: true, strong: true }, can_send: true })
  const text = JSON.stringify(config)
  for (const value of Object.values(full)) assert.ok(!text.includes(value), "a setting's value is never part of the answer")
  assert.equal(mailConfig(() => undefined).can_send, false)
  assert.equal(mailConfig((name) => ({ BREVO_API_KEY: "  ", MAIL_FROM_EMAIL: "x@example.test" })[name]).can_send, false, "a blank key is no key")
  assert.equal(mailConfig((name) => ({ BREVO_API_KEY: "k", MAIL_FROM_EMAIL: "not-an-email" })[name]).mail_from_email, false)
  assert.deepEqual(mailConfig((name) => ({ APP_URL: "http://app.example.test", CRON_SECRET: "short" })[name]).app_url, { set: true, valid: false }, "http (not localhost) is not accepted")
  assert.equal(mailConfig((name) => ({ CRON_SECRET: "short" })[name]).cron_secret.strong, false)
}

// ---------------------------------------------------------------- cleaning provider answers
{
  const clean = (value, secrets) => sanitizeProviderText(value, secrets)
  assert.equal(clean(`rejected key ${SECRET} please`, [SECRET]), "rejected key [hidden] please")
  assert.ok(!clean(`bad key ${SECRET}`).includes(SECRET), "a key-shaped value is hidden even when it was not passed in")
  assert.ok(!clean("Authorization: Bearer abcdef123456.zzz").includes("abcdef123456"), "a bearer token is hidden"); assert.ok(!clean("sent with Bearer abcdef123456.zzz today").includes("abcdef123456")); assert.match(clean("sent with Bearer abcdef123456.zzz today"), /Bearer \[hidden\] today/)
  assert.ok(!clean('{"api-key":"abc12345secret","message":"Key not found"}').includes("abc12345secret"))
  assert.ok(!clean("token=abc123456&x=1").includes("abc123456"))
  assert.ok(!clean("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.signaturepart").includes("eyJhbGci"))
  assert.equal(clean("<script>alert(1)</script>Hello\u0000\n\tworld"), "alert(1) Hello world", "markup and control characters are removed")
  assert.equal(clean("x".repeat(500)).length, 200); assert.ok(clean("x".repeat(500)).endsWith("…"))
  assert.equal(clean(null), ""); assert.equal(clean(undefined), ""); assert.match(clean({ message: "Sender not valid" }), /Sender not valid/)
  assert.equal(clean("short secret", ["abc"]), "short secret", "very short secrets are not replaced (they would mangle ordinary words)")
}

// a provider message id keeps its angle brackets, and anything odd is dropped
assert.equal(cleanMessageId("<202611010000.1@smtp-relay.example.test>"), "<202611010000.1@smtp-relay.example.test>"); assert.equal(cleanMessageId("  abc123@x.test "), "abc123@x.test")
for (const bad of [null, undefined, 5, "", "<a b>", "<script>x</script>", "../../x", "id; drop", "a", "x".repeat(300)]) assert.equal(cleanMessageId(bad), null, String(bad))

// ---------------------------------------------------------------- the test email, against a mocked provider
const env = { BREVO_API_KEY: SECRET, MAIL_FROM_EMAIL: "no-reply@example.test", MAIL_FROM_NAME: "BuildTrack", APP_URL: "https://app.example.test" }
const reader = (values = env) => (name) => values[name]
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) })
{
  const calls = []
  const accept = async (input, init) => { calls.push({ input, init }); return response(201, { messageId: "<202611010000.1@smtp-relay.example.test>" }) }
  const result = await sendTestEmail({ read: reader(), fetchImpl: accept, toEmail: "boss@example.test", toName: "Boss Person" })
  assert.deepEqual(result, { accepted: true, http_status: 201, message_id: "<202611010000.1@smtp-relay.example.test>", detail: "Accepted by the mail provider (HTTP 201). That is not confirmation that it reached the inbox." })
  assert.equal(calls.length, 1, "exactly one request to the provider")
  assert.equal(calls[0].input, "https://api.brevo.com/v3/smtp/email"); assert.equal(calls[0].init.method, "POST"); assert.equal(calls[0].init.headers["api-key"], SECRET)
  const sent = JSON.parse(calls[0].init.body)
  assert.deepEqual(sent.to, [{ email: "boss@example.test" }], "one recipient only"); assert.deepEqual(sent.sender, { email: "no-reply@example.test", name: "BuildTrack" }); assert.deepEqual(sent.tags, ["buildtrack", "test"])
  assert.equal(sent.subject, "BuildTrack test email"); assert.match(sent.htmlContent, /Hello Boss,/); assert.match(sent.htmlContent, /Valencia Construction Services - BuildTrack/, "the branded layout is reused")
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET), "the key never appears in the result")
  assert.doesNotMatch(sent.htmlContent + sent.textContent, new RegExp(SECRET))

  const noId = await sendTestEmail({ read: reader(), fetchImpl: async () => response(201, "not json"), toEmail: "boss@example.test", toName: null })
  assert.equal(noId.accepted, true); assert.equal(noId.message_id, null)

  const refused = await sendTestEmail({ read: reader(), fetchImpl: async () => response(401, { code: "unauthorized", message: `Key ${SECRET} not found. <b>api-key: abc123456</b>` }), toEmail: "boss@example.test", toName: null })
  assert.equal(refused.accepted, false); assert.equal(refused.http_status, 401); assert.match(refused.detail, /refused the request \(HTTP 401\)/)
  assert.ok(!refused.detail.includes(SECRET) && !refused.detail.includes("abc123456") && !refused.detail.includes("<b>"), refused.detail)

  const down = await sendTestEmail({ read: reader(), fetchImpl: async () => { throw new Error(`connect failed for ${SECRET}`) }, toEmail: "boss@example.test", toName: null })
  assert.deepEqual([down.accepted, down.http_status, down.message_id], [false, null, null]); assert.match(down.detail, /Could not reach the mail provider/); assert.ok(!down.detail.includes(SECRET))

  let called = 0
  const notSet = await sendTestEmail({ read: reader({ MAIL_FROM_EMAIL: "no-reply@example.test" }), fetchImpl: async () => { called++; return response(201, {}) }, toEmail: "boss@example.test", toName: null })
  assert.equal(notSet.accepted, false); assert.equal(called, 0, "without a key or sender nothing is sent"); assert.match(notSet.detail, /not set up/)
  assert.equal((await sendTestEmail({ read: reader({ BREVO_API_KEY: SECRET, MAIL_FROM_EMAIL: "bad" }), fetchImpl: async () => { called++; return response(201, {}) }, toEmail: "b@example.test", toName: null })).accepted, false); assert.equal(called, 0)
}

// ---------------------------------------------------------------- delivery lookup: accepted is not delivered
{
  const sequence = (...answers) => { const calls = []; return { calls, fetchImpl: async (input) => { calls.push(input); return answers[calls.length - 1] ?? response(500, "unexpected extra call") } } }
  const list = response(200, { count: 1, transactionalEmails: [{ uuid: "11111111-2222-3333-4444-555555555555", messageId: "<m@x>" }] })
  const lookup = (events) => { const s = sequence(list, response(200, { events })); return checkTestEmail({ read: reader(), fetchImpl: s.fetchImpl, messageId: "<m@x>" }).then((result) => ({ result, calls: s.calls })) }

  const delivered = await lookup([{ name: "requests" }, { name: "delivered" }])
  assert.equal(delivered.result.state, "delivered"); assert.deepEqual(delivered.result.events, ["requests", "delivered"])
  assert.match(delivered.calls[0], /smtp\/emails\?messageId=%3Cm%40x%3E&limit=1/); assert.match(delivered.calls[1], /smtp\/emails\/11111111-2222-3333-4444-555555555555$/)
  assert.equal((await lookup([{ name: "requests" }])).result.state, "pending", "only 'requests' (accepted) is not delivery")
  assert.equal((await lookup([{ name: "requests" }, { name: "hardBounces" }])).result.state, "failed")
  assert.equal((await lookup([{ name: "blocked" }, { name: "delivered" }])).result.state, "failed", "a failure outranks a delivery event")
  assert.equal((await lookup([])).result.state, "unknown")
  assert.equal(interpretEvents("nonsense").state, "unknown"); assert.equal(interpretEvents([null, 5, {}]).state, "unknown")

  const none = sequence(response(200, { count: 0, transactionalEmails: [] }))
  const missing = await checkTestEmail({ read: reader(), fetchImpl: none.fetchImpl, messageId: "<m@x>" })
  assert.equal(missing.state, "unknown"); assert.match(missing.detail, /no record of this message yet/); assert.equal(none.calls.length, 1)
  const badUuid = sequence(response(200, { transactionalEmails: [{ uuid: "../../admin" }] }))
  assert.equal((await checkTestEmail({ read: reader(), fetchImpl: badUuid.fetchImpl, messageId: "<m@x>" })).state, "unknown"); assert.equal(badUuid.calls.length, 1, "an unexpected id is never put into a URL")
  const denied = await checkTestEmail({ read: reader(), fetchImpl: sequence(response(403, `forbidden ${SECRET}`)).fetchImpl, messageId: "<m@x>" })
  assert.equal(denied.state, "unknown"); assert.ok(!denied.detail.includes(SECRET)); assert.match(denied.detail, /HTTP 403/)
  assert.equal((await checkTestEmail({ read: reader({}), fetchImpl: async () => assert.fail("no call without a key"), messageId: "<m@x>" })).state, "unknown")
  const broken = await checkTestEmail({ read: reader(), fetchImpl: async () => { throw new Error("offline") }, messageId: "<m@x>" })
  assert.equal(broken.state, "unknown"); assert.match(broken.detail, /Could not reach/)
}

// ---------------------------------------------------------------- the checklist matches the repository
{
  const dir = new URL("../supabase/migrations/", import.meta.url)
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql"))
  const sql = files.map((name) => readFileSync(new URL(name, dir), "utf8")).join("\n").toLowerCase()
  const stems = new Set(files.filter((name) => /^\d{14}_/.test(name)).map((name) => name.replace(/^\d{14}_/, "").replace(/\.sql$/, "")))
  for (const name of TRACKED_MIGRATIONS) assert.ok(stems.has(name), `tracked migration ${name} has a file`)
  assert.equal(new Set(TRACKED_MIGRATIONS).size, TRACKED_MIGRATIONS.length, "no duplicates")
  for (const item of manifestItems().filter((entry) => entry.kind !== "bucket")) {
    const needle = item.kind === "column" ? item.name.split(".")[1] : item.name
    assert.ok(sql.includes(needle.toLowerCase()), `${item.kind} ${item.name} appears in a migration`)
  }
  const items = manifestItems()
  assert.ok(items.length <= 400, "the database accepts at most 400 items")
  const valid = /^[a-z_][a-z0-9_-]*(\.[a-z_][a-z0-9_]*)?$/
  for (const item of items) { assert.ok(valid.test(item.name) && item.name.length <= 80, item.name); assert.ok(["table", "function", "column", "bucket"].includes(item.kind)) }
  assert.equal(new Set(items.map((item) => `${item.kind}:${item.name}`)).size, items.length)
  assert.equal(BUCKETS.filter((bucket) => bucket.public).map((bucket) => bucket.id).join(), "avatars", "only avatars are public")
  assert.deepEqual([...new Set(FEATURES.map((feature) => feature.key))].length, FEATURES.length)
  const migration = readFileSync(new URL("../supabase/migrations/20261101120000_system_health_and_admin_digest.sql", import.meta.url), "utf8")
  assert.ok(!/cron\.schedule\s*\(/i.test(migration.replace(/--[^\n]*/g, "")), "the migration schedules nothing")
  assert.ok(!/\bnet\.http|pg_net|extension/i.test(migration.replace(/--[^\n]*/g, "")), "and installs or calls nothing external")
  assert.match(DIGEST_SCHEDULE_SQL, /cron\.schedule\('buildtrack-admin-digest', '0 0 \* \* \*'/); assert.match(DIGEST_SCHEDULE_SQL, /cron\.unschedule/)
}

// ---------------------------------------------------------------- turning the raw report into results
const now = new Date("2026-11-02T10:00:00Z")
const options = { now, features: FEATURES, buckets: BUCKETS, tracked: TRACKED_MIGRATIONS }
const rawObjects = () => manifestItems().map((item) => ({ ...item, exists: true, ...(item.kind === "bucket" ? { public: BUCKETS.find((b) => b.id === item.name).public } : {}) }))
const healthy = (extra = {}) => ({
  checked_at: "2026-11-02T10:00:00Z", database: { ok: true, version: 17 },
  migrations: { available: true, recorded: 80, latest_version: "20261101120000", latest_name: "system_health_and_admin_digest", names: [...TRACKED_MIGRATIONS, "older_untracked_one"] },
  objects: rawObjects(), buckets: BUCKETS.map((bucket) => ({ id: bucket.id, public: bucket.public, objects: 3 })),
  cron: { installed: true, jobs: [{ name: "send-notifications", schedule: "*/5 * * * *", active: true, last_status: "succeeded", last_run: "2026-11-02T09:55:00Z", last_message: "" }] },
  email_queue: { waiting: 0, waiting_over_1d: 0, sent_24h: 4, failed_24h: 0, skipped_24h: 1 },
  digest: { last_run: { run_date: "2026-11-02", started_at: "2026-11-02T00:00:00Z", finished_at: "2026-11-02T00:00:01Z", status: "ok", recipients: 3, created: 2, skipped_empty: 1, skipped_opt_out: 0, detail: null }, last_ok_at: "2026-11-02T00:00:01Z", failed_7d: 0 },
  email_tests: [], ...extra,
})
const edgeOk = { ok: true, config: { brevo_api_key: true, mail_from_email: true, mail_from_name: true, app_url: { set: true, valid: true }, cron_secret: { set: true, strong: true }, can_send: true } }
const byId = (checks, id) => checks.find((check) => check.id === id)
{
  const all = evaluateHealth(healthy(), edgeOk, options)
  assert.ok(all.every((check) => ["ok", "info"].includes(check.status)), JSON.stringify(all.filter((c) => !["ok", "info"].includes(c.status)).map((c) => [c.id, c.status])))
  assert.equal(byId(all, "database").status, "ok"); assert.equal(byId(all, "migrations").status, "ok"); assert.match(byId(all, "migrations").summary, /Older, numbered migrations/)
  assert.equal(all.filter((check) => check.id.startsWith("schema:")).length, FEATURES.length)
  assert.deepEqual(summarize(all).overall, "info"); assert.equal(worst(["ok", "warn", "info"]), "warn"); assert.equal(worst([]), "ok")
  for (const [status, label] of Object.entries(statusLabel)) assert.ok(label && status)
  const nothingSecret = JSON.stringify(all)
  assert.ok(!nothingSecret.includes(SECRET))
}
{
  const down = evaluateHealth(null, edgeOk, options)
  assert.equal(down.length, 1); assert.equal(down[0].status, "fail"); assert.ok(down[0].action)
}
{
  const gap = evaluateHealth(healthy({ migrations: { available: true, recorded: 3, latest_version: "1", latest_name: "x", names: ["older"] } }), edgeOk, options)
  assert.equal(byId(gap, "migrations").status, "warn"); assert.equal(byId(gap, "migrations").details.length, TRACKED_MIGRATIONS.length)
  assert.match(byId(gap, "migrations").summary, /does not prove the schema is missing/); assert.match(byId(gap, "migrations").action, /Never re-run/)
  assert.equal(byId(evaluateHealth(healthy({ migrations: { available: false } }), edgeOk, options), "migrations").status, "unknown")
  const legacyOnly = evaluateHealth(healthy({ migrations: { available: true, recorded: 70, latest_version: "20261101120000", latest_name: "x", names: [...TRACKED_MIGRATIONS, "user_role", "editor_v2"] } }), edgeOk, options)
  assert.equal(byId(legacyOnly, "migrations").status, "ok", "older numbered migrations are never reported missing")
}
{
  const objects = rawObjects().map((item) => (item.name === "send_admin_message" || item.name === "site_announcement" ? { ...item, exists: false } : item))
  const missing = evaluateHealth(healthy({ objects }), edgeOk, options)
  const feature = byId(missing, "schema:announcements")
  assert.equal(feature.status, "fail"); assert.deepEqual(feature.details.sort(), ["function send_admin_message", "table site_announcement"]); assert.match(feature.action, /owner reviews and runs the migration|owner runs the migration/); assert.match(feature.action, /Nothing is repaired automatically/)
  assert.equal(byId(missing, "schema:accounts").status, "ok", "other features are unaffected")
}
{
  const leaking = evaluateHealth(healthy({ buckets: BUCKETS.map((bucket) => ({ id: bucket.id, public: bucket.id === "identity-docs" ? true : bucket.public, objects: 1 })) }), edgeOk, options)
  assert.equal(byId(leaking, "storage").status, "fail"); assert.match(byId(leaking, "storage").summary, /identity-docs is public but must be private/)
  const absent = evaluateHealth(healthy({ buckets: BUCKETS.slice(1).map((bucket) => ({ id: bucket.id, public: false, objects: 0 })) }), edgeOk, options)
  assert.equal(byId(absent, "storage").status, "fail"); assert.match(byId(absent, "storage").summary, /avatars is missing/)
  const hidden = evaluateHealth(healthy({ buckets: BUCKETS.map((bucket) => ({ id: bucket.id, public: false, objects: 0 })) }), edgeOk, options)
  assert.equal(byId(hidden, "storage").status, "warn", "avatars private is only a warning")
}
{
  const unreachable = evaluateHealth(healthy(), { ok: false, reason: 'The "system-health" function is not deployed yet.' }, options)
  assert.equal(byId(unreachable, "email-config").status, "unknown"); assert.match(byId(unreachable, "email-config").summary, /not deployed yet/); assert.match(byId(unreachable, "email-config").action, /deploys the system-health function/)
  const off = { ok: true, config: { ...edgeOk.config, brevo_api_key: false, can_send: false } }
  assert.equal(byId(evaluateHealth(healthy(), off, options), "email-config").status, "info"); assert.match(byId(evaluateHealth(healthy(), off, options), "email-config").summary, /mail key is missing/)
  const noUrl = { ok: true, config: { ...edgeOk.config, app_url: { set: false, valid: false } } }
  assert.equal(byId(evaluateHealth(healthy(), noUrl, options), "email-config").status, "warn")
  const waitingOff = evaluateHealth(healthy({ email_queue: { waiting: 143, waiting_over_1d: 143, sent_24h: 0, failed_24h: 0, skipped_24h: 0 } }), off, options)
  assert.equal(byId(waitingOff, "email-queue").status, "info"); assert.match(byId(waitingOff, "email-queue").summary, /Email is not set up, so nothing is being sent/)
  const waitingOn = evaluateHealth(healthy({ email_queue: { waiting: 5, waiting_over_1d: 5, sent_24h: 0, failed_24h: 0, skipped_24h: 0 } }), edgeOk, options)
  assert.equal(byId(waitingOn, "email-queue").status, "warn"); assert.match(byId(waitingOn, "email-queue").summary, /the schedule that sends them is not running/)
  const failing = evaluateHealth(healthy({ email_queue: { waiting: 0, waiting_over_1d: 0, sent_24h: 0, failed_24h: 3, skipped_24h: 0 } }), edgeOk, options)
  assert.equal(byId(failing, "email-queue").status, "warn"); assert.match(byId(failing, "email-queue").action, /test email/)
}
{
  const none = evaluateHealth(healthy({ cron: { installed: false, jobs: [] } }), edgeOk, options)
  assert.equal(byId(none, "schedule").status, "info"); assert.match(byId(none, "schedule").summary, /Supabase Cron is off/); assert.match(byId(none, "schedule").action, /Nothing is switched on by this screen/)
  const stale = evaluateHealth(healthy({ cron: { installed: false, jobs: [] }, email_queue: { waiting: 9, waiting_over_1d: 9, sent_24h: 0, failed_24h: 0, skipped_24h: 0 } }), edgeOk, options)
  assert.equal(byId(stale, "schedule").status, "warn")
  assert.equal(byId(evaluateHealth(healthy({ cron: { installed: true, jobs: [] } }), edgeOk, options), "schedule").status, "warn")
  const failedJob = evaluateHealth(healthy({ cron: { installed: true, jobs: [{ name: "buildtrack-admin-digest", schedule: "0 0 * * *", active: true, last_status: "failed", last_run: "2026-11-02T00:00:00Z", last_message: "function does not exist" }] } }), edgeOk, options)
  assert.equal(byId(failedJob, "schedule").status, "fail"); assert.match(byId(failedJob, "schedule").details[0], /failed: function does not exist/); assert.match(byId(failedJob, "schedule").action, /Nothing was re-run/)
  assert.equal(byId(evaluateHealth(healthy({ cron: { installed: true, jobs: [{ name: "a", schedule: "x", active: false, last_status: null, last_run: null, last_message: null }] } }), edgeOk, options), "schedule").status, "warn")
}
{
  const notYet = evaluateHealth(healthy({ digest: { last_run: null, last_ok_at: null, failed_7d: 0 } }), edgeOk, options)
  assert.equal(byId(notYet, "digest").status, "info"); assert.match(byId(notYet, "digest").summary, /It is not scheduled/)
  const run = healthy().digest.last_run
  const failedRun = evaluateHealth(healthy({ digest: { last_run: { ...run, status: "failed", detail: 'relation "x" does not exist' }, last_ok_at: null, failed_7d: 1 } }), edgeOk, options)
  assert.equal(byId(failedRun, "digest").status, "fail"); assert.match(byId(failedRun, "digest").summary, /failed: relation "x" does not exist/)
  const late = evaluateHealth(healthy({ cron: { installed: true, jobs: [{ name: "buildtrack-admin-digest", schedule: "0 0 * * *", active: true, last_status: "succeeded", last_run: "2026-10-30T00:00:00Z", last_message: "" }] }, digest: { last_run: run, last_ok_at: "2026-10-31T00:00:00Z", failed_7d: 0 } }), edgeOk, options)
  assert.equal(byId(late, "digest").status, "warn"); assert.match(byId(late, "digest").summary, /last successful run was \d+ hours ago/)
  const earlyNoJob = evaluateHealth(healthy({ digest: { last_run: run, last_ok_at: "2026-10-31T00:00:00Z", failed_7d: 0 } }), edgeOk, options)
  assert.equal(byId(earlyNoJob, "digest").status, "ok", "an old run without a digest job is not 'late': nothing is scheduled")
  assert.equal(byId(evaluateHealth(healthy({ digest: { last_run: run, last_ok_at: run.finished_at, failed_7d: 2 } }), edgeOk, options), "digest").status, "warn")
  assert.equal(byId(evaluateHealth(healthy({ email_tests: [{ id: 1, created_at: "2026-11-02T09:00:00Z", status: "accepted", provider_status: 201 }] }), edgeOk, options), "email-test").summary.includes("Acceptance is not confirmation of delivery"), true)
  assert.equal(byId(evaluateHealth(healthy({ email_tests: [{ id: 2, created_at: "2026-11-02T09:00:00Z", status: "failed", provider_status: 401 }] }), edgeOk, options), "email-test").status, "warn")
}

// ---------------------------------------------------------------- a small harness that runs React hooks without a browser
function hooksHarness() {
  let state = [], effects = [], cursor = 0, pending = []
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial) { const n = cursor++; if (!(n in state)) state[n] = typeof initial === "function" ? initial() : initial; return [state[n], (value) => { state[n] = typeof value === "function" ? value(state[n]) : value }] },
    useRef(initial) { const n = cursor++; return state[n] ??= { current: initial } },
    useMemo(fn, deps) { const n = cursor++; if (!same(state[n]?.deps, deps)) state[n] = { deps, value: fn() }; return state[n].value },
    useCallback(fn, deps) { const n = cursor++; if (!same(state[n]?.deps, deps)) state[n] = { deps, fn }; return state[n].fn },
    useEffect(fn, deps) { const n = cursor++; if (!same(effects[n]?.deps, deps)) pending.push(() => { effects[n]?.cleanup?.(); effects[n] = { deps, cleanup: fn() } }) },
  }
  return { hooks, render(fn) { cursor = 0; const value = fn(); const work = pending; pending = []; work.forEach((run) => run()); return value }, unmount() { effects.forEach((effect) => effect?.cleanup?.()) } }
}
const transpile = (path, replacements) => {
  let source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const [name, replacement] of Object.entries(replacements)) source = source.replaceAll(`from "${name}"`, `from ${JSON.stringify(replacement)}`)
  return source
}
const text = (node) => Array.isArray(node) ? node.map(text).join("") : typeof node === "object" && node ? text(node.props?.children) : node === undefined || node === null || typeof node === "boolean" ? "" : String(node)
// Draws function components (such as the status badge) so their text can be read like the rest of the tree.
const expand = (node) => Array.isArray(node) ? node.map(expand) : node && typeof node === "object" && node.props ? (typeof node.type === "function" && node.type.name !== "Panel" ? expand(node.type(node.props)) : { ...node, props: { ...node.props, children: expand(node.props.children) } }) : node
const all = (node, predicate) => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap((child) => all(child, predicate)) : [...(predicate(node) ? [node] : []), ...all(node.props?.children, predicate), ...all(node.props?.footer, predicate), ...all(node.props?.action, predicate)]

// ---------------------------------------------------------------- the calls the screen makes
{
  const rpcs = []; let rpcAnswer = { data: null, error: null }; let edgeAnswer = { data: edgeOk.config, error: null }; const invokes = []
  globalThis.__hSupabase = { rpc: async (name, args) => { rpcs.push([name, args]); return typeof rpcAnswer === "function" ? rpcAnswer(name) : rpcAnswer } }
  globalThis.__hInvoke = async (name, body) => { invokes.push([name, body]); return typeof edgeAnswer === "function" ? edgeAnswer(body) : edgeAnswer }
  const source = transpile("../src/lib/systemHealth.ts", { "./supabase": url("export const supabase=globalThis.__hSupabase;"), "./functions": url("export const invokeFunction=(...a)=>globalThis.__hInvoke(...a);"), "./communicationsModel": fileUrl("../src/lib/communicationsModel.ts"), "./healthManifest": fileUrl("../src/lib/healthManifest.ts"), "./healthModel": fileUrl("../src/lib/healthModel.ts") })
  const lib = await import(url(source))

  rpcAnswer = { data: healthy(), error: null }
  let run = await lib.runHealthChecks()
  assert.equal(rpcs[0][0], "get_system_health"); assert.equal(rpcs[0][1].p_manifest.length, manifestItems().length, "the whole checklist is sent, and nothing else"); assert.deepEqual(invokes[0], ["system-health", { action: "config" }])
  assert.ok(run.checks.length > 10 && run.raw && run.edge.ok)
  edgeAnswer = { data: null, error: 'The "system-health" function is not deployed yet.' }
  run = await lib.runHealthChecks(); assert.equal(run.edge.ok, false); assert.equal(byId(run.checks, "email-config").status, "unknown", "an unreachable function does not hide the other results"); assert.equal(byId(run.checks, "database").status, "ok")
  rpcAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function public.get_system_health" } }
  run = await lib.runHealthChecks(); assert.equal(run.checks.length, 1); assert.equal(run.checks[0].status, "warn"); assert.match(run.checks[0].summary, /not installed on the database yet/)
  rpcAnswer = { data: null, error: { message: "Only a Super Admin can run the system health checks" } }
  run = await lib.runHealthChecks(); assert.equal(run.checks[0].status, "fail"); assert.equal(run.raw, null)

  rpcAnswer = { data: { run_date: "2026-11-02", recipients: [] }, error: null }
  assert.deepEqual(await lib.previewDigest(), { data: { run_date: "2026-11-02", recipients: [] }, error: "", setup: false })
  rpcAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } }; const missingDigest = await lib.previewDigest(); assert.equal(missingDigest.setup, true); assert.match(missingDigest.error, /not installed/)
  rpcAnswer = { data: null, error: { message: "Only a Super Admin can preview the admin digest" } }; assert.match((await lib.previewDigest()).error, /Only a Super Admin signed in with the authenticator/)
  edgeAnswer = { data: { test_id: 4 }, error: null }; await lib.requestTestEmail(); await lib.askProviderAboutTest(4)
  assert.deepEqual(invokes.slice(-2), [["system-health", { action: "send_test_email" }], ["system-health", { action: "check_test_email", test_id: 4 }]], "the browser never sends a recipient")
  delete globalThis.__hSupabase; delete globalThis.__hInvoke
}

// ---------------------------------------------------------------- the screen
{
  const harness = hooksHarness()
  globalThis.__pgHooks = harness.hooks
  const delegate = (name) => `${name}=(...a)=>globalThis.__pgHooks.${name}(...a)`
  const calls = { test: [], ask: [], preview: 0, confirm: [], toast: [], run: 0 }
  let testAnswer = { data: { test_id: 7, accepted: true, http_status: 201, message_id: "<m@x>", detail: "Accepted by the mail provider (HTTP 201). That is not confirmation that it reached the inbox.", delivery: "unconfirmed" }, error: null }
  let askAnswer = { data: { state: "delivered", events: ["requests", "delivered"], detail: "The provider reports the message was delivered." }, error: null }
  let confirmAnswer = true
  let previewAnswer = { data: { run_date: "2026-11-02", recipients: [{ name: "Ana", role: "super_admin", opted_out: false, total: 3, body: "2 registrations to approve." }, { name: "Ben", role: "admin", opted_out: true, total: 5, body: "x" }, { name: "Cy", role: "admin", opted_out: false, total: 0, body: "" }] }, error: "", setup: false }
  globalThis.__pgApi = {
    requestTestEmail: async () => { calls.test.push(1); return testAnswer }, askProviderAboutTest: async (id) => { calls.ask.push(id); return askAnswer },
    previewDigest: async () => { calls.preview++; return previewAnswer }, runHealthChecks: async () => { calls.run++; return { checks: evaluateHealth(healthy(), edgeOk, options), raw: healthy(), edge: edgeOk, ranAt: "2026-11-02T10:00:00Z" } },
  }
  globalThis.__pgToast = { error: (...a) => calls.toast.push(["error", ...a]), success: (...a) => calls.toast.push(["success", ...a]) }
  globalThis.__pgConfirm = async (options) => { calls.confirm.push(options); return confirmAnswer }
  globalThis.__pgRole = "super_admin"
  const noop = "export default function X(){return null}"
  const source = transpile("../src/pages/Admin/SystemHealth.tsx", {
    react: url(`export const ${delegate("useState")},${delegate("useEffect")},${delegate("useCallback")},${delegate("useMemo")};`), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "../../components/ui/PageParts": url("export const buttonPrimary='primary',buttonSecondary='secondary';"), "../../components/ui/Skeleton": url("export const Skeleton=function Skeleton(){return null};"),
    "../../lib/auth": url("export const useAuth=()=>({profile:{role:globalThis.__pgRole,email:'boss@example.test'}});"), "../../lib/confirm": url("export const useConfirm=()=>globalThis.__pgConfirm;"),
    "../../lib/healthModel": fileUrl("../src/lib/healthModel.ts"), "../../lib/toast": url("export const useToast=()=>globalThis.__pgToast;"),
    "../../lib/admin": url("export const formatDate=(x)=>x,formatTime=(x)=>x,roleLabel={super_admin:'Super Admin',admin:'Admin'};"),
    "../../lib/systemHealth": url("export const requestTestEmail=(...a)=>globalThis.__pgApi.requestTestEmail(...a),askProviderAboutTest=(...a)=>globalThis.__pgApi.askProviderAboutTest(...a),previewDigest=(...a)=>globalThis.__pgApi.previewDigest(...a),runHealthChecks=(...a)=>globalThis.__pgApi.runHealthChecks(...a);"),
    "./AdminShell": url("export const PageIntro=function PageIntro(){return null},Panel=function Panel(){return null};"),
  })
  const page = await import(url(source))
  const click = async (element) => { element.props.onClick(); await settle(); await settle() }
  const button = (tree, wording) => all(tree, (node) => node.type === "button" && text(node).includes(wording))[0]

  // results: every status is written in words with a symbol
  const resultsHarness = hooksHarness(); globalThis.__pgHooks = resultsHarness.hooks // its own hook slots, so the later panels start clean
  const results = expand(resultsHarness.render(() => page.HealthResults({ checks: evaluateHealth(healthy({ cron: { installed: false, jobs: [] }, email_queue: { waiting: 4, waiting_over_1d: 4, sent_24h: 0, failed_24h: 2, skipped_24h: 0 } }), { ok: false, reason: "not deployed" }, options) })))
  globalThis.__pgHooks = harness.hooks
  const written = text(results)
  for (const word of ["Needs attention", "Cannot tell", "What to do:", "Database connection", "Scheduled jobs"]) assert.ok(written.includes(word), word)
  const first = all(results, (node) => node.type === "li")[0]; assert.ok(first)
  assert.ok(all(results, (node) => node.props?.["aria-hidden"] === "true").length >= 5, "every result has a symbol, and it is decoration only")
  const badgeEl = page.StatusBadge({ status: "fail" }); assert.match(text(badgeEl), /Problem/); assert.equal(badgeEl.props.children[0].props["aria-hidden"], "true", "the symbol is decoration; the word carries the meaning"); assert.ok(!/^[×!?i✓]$/.test(text(badgeEl)), "a symbol alone is never the whole message")

  // the email test: confirmation first, one request, accepted shown apart from delivered
  const draw = () => harness.render(() => page.EmailTestPanel({ email: "boss@example.test", canSend: true }))
  let tree = draw()
  assert.match(text(tree), /boss@example\.test/); assert.match(text(tree), /You cannot choose another recipient/)
  confirmAnswer = false; await click(button(tree, "Send me a test email")); assert.equal(calls.test.length, 0, "declining the confirmation sends nothing"); assert.match(calls.confirm.at(-1).message, /boss@example\.test \(your own address\)/)
  confirmAnswer = true; await click(button(tree, "Send me a test email")); tree = draw()
  assert.equal(calls.test.length, 1)
  const result = all(tree, (node) => node.props?.["aria-label"] === "Test email result")[0]
  assert.ok(result); assert.match(text(result), /Accepted the message \(HTTP 201\)/); assert.match(text(result), /Not confirmed/); assert.doesNotMatch(text(result), /Confirmed delivered/, "accepted is not delivered")
  assert.equal(calls.toast.at(-1)[1], "The provider accepted the test email")
  await click(button(tree, "Ask the provider if it was delivered")); tree = draw()
  assert.deepEqual(calls.ask, [7]); assert.match(text(tree), /Confirmed delivered/); assert.match(text(tree), /Events: requests, delivered/)
  askAnswer = { data: { state: "pending", events: ["requests"], detail: "The provider accepted it but has not reported delivery yet." }, error: null }
  await click(button(tree, "Ask the provider if it was delivered")); tree = draw(); assert.match(text(tree), /Not reported yet/); assert.doesNotMatch(text(tree), /Confirmed delivered/)
  testAnswer = { data: { test_id: 8, accepted: false, http_status: 401, message_id: null, detail: "The mail provider refused the request (HTTP 401): Key not found", delivery: "unconfirmed" }, error: null }
  await click(button(tree, "Send me a test email")); tree = draw()
  assert.match(text(tree), /Did not accept the message \(HTTP 401\)/); assert.match(text(tree), /Not sent/); assert.equal(button(tree, "Ask the provider if it was delivered"), undefined, "nothing to look up when the provider refused")
  testAnswer = { data: null, error: "Too many test emails in the last hour. Try again later" }
  await click(button(tree, "Send me a test email")); tree = draw(); assert.match(text(tree), /Too many test emails in the last hour/); assert.ok(all(tree, (node) => node.props?.role === "alert").length === 1)
  tree = harness.render(() => page.EmailTestPanel({ email: "boss@example.test", canSend: false })); assert.match(text(tree), /Email is not set up yet/)

  // the digest preview and how it is switched on
  const drawDigest = () => harness.render(() => page.DigestPanel({ lastRun: undefined }))
  let digest = drawDigest()
  assert.match(text(digest), /A preview creates nothing and sends nothing/); assert.match(text(digest), /never schedules anything/); assert.match(text(digest), /cron\.schedule\('buildtrack-admin-digest'/)
  await click(button(digest, "Preview today's digest")); digest = drawDigest()
  const table = text(all(digest, (node) => node.type === "table")[0])
  assert.equal(calls.preview, 1); assert.match(table, /Ana/); assert.match(table, /2 registrations to approve\./); assert.match(table, /Opted out: gets nothing/); assert.match(table, /Nothing to report: gets nothing/)
  previewAnswer = { data: null, error: "Only a Super Admin signed in with the authenticator app can preview the digest.", setup: false }
  await click(button(digest, "Preview today's digest")); digest = drawDigest(); assert.match(text(all(digest, (node) => node.props?.role === "alert")[0]), /Only a Super Admin/)

  // the page itself: only a Super Admin gets any checks
  globalThis.__pgRole = "admin"
  let shell = harness.render(() => page.default({ onNavigate() {} })); await settle()
  assert.equal(calls.run, 0, "no check runs for an Admin"); assert.match(text(shell), /Only a Super Admin can open the system health checks/); assert.equal(all(shell, (node) => node.type === "button").length, 0)
  globalThis.__pgRole = "super_admin"
  shell = harness.render(() => page.default({ onNavigate() {} })); await settle(); await settle(); shell = harness.render(() => page.default({ onNavigate() {} }))
  assert.equal(calls.run, 1, "the checks run once when the page opens"); assert.match(text(shell), /problems,.*need attention,.*cannot be told,.*not set up,.*working/)
  harness.unmount()
  for (const key of ["__pgHooks", "__pgApi", "__pgToast", "__pgConfirm", "__pgRole"]) delete globalThis[key]
}

// ---------------------------------------------------------------- the digest switch: staged fallback while the newest columns are not installed yet
{
  const harness = hooksHarness()
  globalThis.__prefHooks = harness.hooks
  const log = []
  let row = { email_enabled: true, email_reminders: true, email_announcements: false, email_admin_digest: false }, missing = new Set()
  const builder = (table) => {
    const q = { ops: [], then: (resolve, reject) => Promise.resolve(answer(q)).then(resolve, reject) }
    for (const name of ["select", "eq", "update", "insert", "maybeSingle"]) q[name] = (...args) => { q.ops.push([name, ...args]); return q }
    q.table = table; return q
  }
  const has = (q, name) => q.ops.find((op) => op[0] === name)
  const answer = (q) => {
    log.push(q)
    if (has(q, "update") || has(q, "insert")) return { error: null }
    const columns = has(q, "select")[1]
    if (columns.split(",").some((column) => missing.has(column))) return { data: null, error: { message: "column does not exist" } }
    return { data: Object.fromEntries(columns.split(",").filter((column) => column in row).map((column) => [column, row[column]])), error: null }
  }
  globalThis.__prefSupabase = { from: builder, rpc: async () => ({ data: 0, error: null }) }
  const saved = { window: globalThis.window, document: globalThis.document }
  globalThis.window = { setInterval() { return 1 }, clearInterval() {}, addEventListener() {}, removeEventListener() {}, history: { pushState() {} }, scrollTo() {}, dispatchEvent() {} }; globalThis.document = { visibilityState: "visible" }
  const source = transpile("../src/lib/notifications.ts", { react: url("export const useState=(...a)=>globalThis.__prefHooks.useState(...a),useEffect=(...a)=>globalThis.__prefHooks.useEffect(...a),useCallback=(...a)=>globalThis.__prefHooks.useCallback(...a),useRef=(...a)=>globalThis.__prefHooks.useRef(...a);"), "./supabase": url("export const supabase=globalThis.__prefSupabase;"), "./realtime": url("export const useLiveReload=()=>{};"), "./notificationModel": fileUrl("../src/lib/notificationModel.ts") })
  const lib = await import(url(source))
  const read = async (user) => { const h = hooksHarness(); globalThis.__prefHooks = h.hooks; h.render(() => lib.useEmailPreference(user)); await settle(); await settle(); await settle(); const value = h.render(() => lib.useEmailPreference(user)); return { value, h } }

  let { value, h } = await read("u1")
  assert.deepEqual([value.enabled, value.reminders, value.announcements, value.adminDigest, value.categories, value.digestColumn], [true, true, false, false, true, true], "all four choices are read")
  assert.equal(await value.changeAdminDigest(true), null)
  assert.deepEqual(has(log.filter((q) => q.table === "notification_prefs").at(-1), "update").slice(1), [{ email_admin_digest: true }], "only the digest column is written"); h.unmount()

  missing = new Set(["email_admin_digest"])
  ;({ value, h } = await read("u2"))
  assert.deepEqual([value.enabled, value.reminders, value.announcements, value.categories, value.digestColumn], [true, true, false, true, false], "without the digest column the reminder and announcement switches still work"); assert.equal(value.adminDigest, true); h.unmount()

  missing = new Set(["email_admin_digest", "email_reminders", "email_announcements"])
  ;({ value, h } = await read("u3"))
  assert.deepEqual([value.enabled, value.categories, value.digestColumn], [true, false, false], "with neither migration only the master switch is offered"); h.unmount()
  Object.assign(globalThis, saved); if (saved.window === undefined) delete globalThis.window; if (saved.document === undefined) delete globalThis.document
  delete globalThis.__prefHooks; delete globalThis.__prefSupabase
}

console.log("System health: roles, secret-free settings, redaction, mocked test email and delivery lookup, checklist vs migrations, every result status, the screen flows and the digest switch passed")
