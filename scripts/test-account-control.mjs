import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { REASON_MAX, REASON_MIN, deleteBlocker, deletePhrase, handleAccountControl } from "../supabase/functions/_shared/accountControlHandler.ts"
import { isTotp, verifyTotpCode } from "../supabase/functions/_shared/stepUp.ts"

// Everything here runs against fakes: no account is touched, no authenticator is called, no database is used.

// ---------------------------------------------------------------- the authenticator step-up
{
  for (const bad of ["12345", "1234567", "12345a", " 12345", "", null, 123456, undefined]) assert.equal(isTotp(bad), false, String(bad))
  assert.equal(isTotp("012345"), true)
  const make = (script) => {
    const seen = []
    const fetchImpl = async (input, init) => {
      seen.push([input, init])
      const step = script(input, init)
      return { ok: step.status >= 200 && step.status < 300, status: step.status, text: async () => JSON.stringify(step.body ?? {}) }
    }
    return { seen, fetchImpl }
  }
  const options = (fetchImpl, code = "123456") => ({ baseUrl: "https://x.supabase.co", anonKey: "anon-key", token: "user-jwt", code, fetchImpl })
  const goodScript = (input) => input.endsWith("/user") ? { status: 200, body: { factors: [{ id: "f-old", factor_type: "phone", status: "verified" }, { id: "f-unverified", factor_type: "totp", status: "unverified" }, { id: "f-1", factor_type: "totp", status: "verified" }] } } : input.endsWith("/challenge") ? { status: 200, body: { id: "c-1" } } : { status: 200, body: {} }

  let fake = make(goodScript)
  assert.deepEqual(await verifyTotpCode(options(fake.fetchImpl)), { ok: true })
  assert.deepEqual(fake.seen.map(([input]) => input), ["https://x.supabase.co/auth/v1/user", "https://x.supabase.co/auth/v1/factors/f-1/challenge", "https://x.supabase.co/auth/v1/factors/f-1/verify"], "only the verified authenticator is used")
  assert.equal(fake.seen[2][1].headers.Authorization, "Bearer user-jwt", "the check is made with the caller's own token, never a service key"); assert.equal(fake.seen[2][1].headers.apikey, "anon-key")
  assert.deepEqual(JSON.parse(fake.seen[2][1].body), { challenge_id: "c-1", code: "123456" })

  fake = make(() => ({ status: 200 })); assert.equal((await verifyTotpCode(options(fake.fetchImpl, "12"))).status, 400); assert.equal(fake.seen.length, 0, "a malformed code never reaches the network")
  fake = make((input) => input.endsWith("/user") ? { status: 200, body: { factors: [] } } : { status: 200 }); const none = await verifyTotpCode(options(fake.fetchImpl)); assert.equal(none.status, 403); assert.match(none.message, /no authenticator/)
  fake = make((input) => input.endsWith("/verify") ? { status: 400, body: { msg: "Invalid TOTP code entered" } } : goodScript(input)); const wrong = await verifyTotpCode(options(fake.fetchImpl)); assert.equal(wrong.ok, false); assert.equal(wrong.status, 403); assert.match(wrong.message, /not correct/)
  fake = make((input) => input.endsWith("/verify") ? { status: 429 } : goodScript(input)); assert.equal((await verifyTotpCode(options(fake.fetchImpl))).status, 429)
  fake = make((input) => input.endsWith("/challenge") ? { status: 500 } : goodScript(input)); assert.equal((await verifyTotpCode(options(fake.fetchImpl))).status, 502)
  fake = make((input) => input.endsWith("/user") ? { status: 401 } : goodScript(input)); assert.equal((await verifyTotpCode(options(fake.fetchImpl))).status, 403, "an invalid session confirms nothing")
  assert.equal((await verifyTotpCode(options(async () => { throw new Error("offline") }))).status, 502)
}

// ---------------------------------------------------------------- the deletion decisions
const SUPER = { id: "11111111-1111-4111-8111-111111111111", role: "super_admin" }
const WORKER = "22222222-2222-4222-8222-222222222222", CLEAN = "33333333-3333-4333-8333-333333333333", OTHER_SUPER = "44444444-4444-4444-8444-444444444444", GONE = "55555555-5555-4555-8555-555555555555"
const previews = {
  [WORKER]: { id: WORKER, email: "Worker@Valencia.test", full_name: "Wally Worker", role: "foreman", status: "active", already_closed: false, mode: "close", records: { "public.pins.assigned_to": 4 }, record_total: 4, memberships: 2, managed_projects: 0, open_work: 3 },
  [CLEAN]: { id: CLEAN, email: "clean@valencia.test", full_name: "Cora Clean", role: "user", status: "pending", already_closed: false, mode: "delete", records: {}, record_total: 0, memberships: 0, managed_projects: 0, open_work: 0 },
  [OTHER_SUPER]: { id: OTHER_SUPER, email: "boss@valencia.test", full_name: "Boss", role: "super_admin", status: "active", already_closed: false, mode: "delete", records: {}, record_total: 0, memberships: 0, managed_projects: 0, open_work: 0 },
  [GONE]: { id: GONE, email: `deleted-${GONE}@erased.invalid`, full_name: "Deleted account", role: "foreman", status: "disabled", already_closed: true, mode: "close", records: { "public.pins.assigned_to": 1 }, record_total: 1, memberships: 0, managed_projects: 0, open_work: 0 },
  [SUPER.id]: { id: SUPER.id, email: "me@valencia.test", full_name: "Me", role: "super_admin", status: "active", already_closed: false, mode: "delete", records: {}, record_total: 0, memberships: 0, managed_projects: 0, open_work: 0 },
}

function world(overrides = {}) {
  const log = { rpc: [], removed: [], deleted: [], locked: [], audit: [], stepUps: [] }
  const deps = {
    caller: SUPER,
    rpc: async (name, args) => {
      log.rpc.push([name, args])
      if (name === "account_delete_preview") return { data: previews[args.p_user] ?? null, error: null }
      if (name === "account_delete_prepare") return { data: { paths: ["u/front.jpg", "u/selfie.jpg"], snapshot: { id: args.p_user, email: previews[args.p_user].email } }, error: null }
      if (name === "close_account") return { data: { paths: ["u/front.jpg"] }, error: null }
      throw new Error("unexpected rpc " + name)
    },
    removeFiles: async (bucket, paths) => { log.removed.push([bucket, paths]); return paths.length },
    listAvatars: async (id) => [`${id}/me.png`],
    deleteAuthUser: async (id) => { log.deleted.push(id); return null },
    lockAuthUser: async (id) => { log.locked.push(id); return null },
    audit: async (action, target, details) => { log.audit.push([action, target, details]) },
    stepUp: async (code) => { log.stepUps.push(code); return code === "123456" ? { ok: true } : { ok: false, status: 403, message: "That authenticator code is not correct. Wait for the next code and try again." } },
    ...overrides,
  }
  const ask = (body) => handleAccountControl(body, deps)
  return { log, ask }
}
const changes = (log) => log.rpc.filter(([name]) => name !== "account_delete_preview").length + log.removed.length + log.deleted.length + log.locked.length + log.audit.length
const good = (id, extra = {}) => ({ action: "delete", id, reason: "Left the company, confirmed by HR", confirm: deletePhrase(previews[id].email), totp: "123456", ...extra })

{
  assert.equal(deletePhrase("  Worker@Valencia.test "), "DELETE worker@valencia.test")
  assert.equal(deleteBlocker(SUPER, previews[WORKER]), null); assert.match(deleteBlocker(SUPER, previews[SUPER.id]), /your own/); assert.match(deleteBlocker(SUPER, previews[OTHER_SUPER]), /Super Admin/); assert.match(deleteBlocker(SUPER, previews[GONE]), /already deleted/)

  // ---- who may ask, and what they must send
  let w = world({ caller: { id: "a", role: "admin" } })
  for (const action of ["preview", "delete"]) assert.deepEqual(await w.ask({ action, id: WORKER }), { status: 403, body: { error: "Only a Super Admin can delete accounts" } }, "a regular Admin cannot even look: " + action)
  assert.equal(w.log.rpc.length, 0, "and the database is not asked")
  w = world()
  assert.equal((await w.ask({ action: "wipe", id: WORKER })).status, 400); assert.equal((await w.ask({ action: "delete", id: "not-a-uuid" })).status, 400); assert.equal((await w.ask(null)).status, 400); assert.equal((await w.ask({ action: "preview" })).status, 400)
  assert.equal((await w.ask({ action: "preview", id: "66666666-6666-4666-8666-666666666666" })).status, 404)

  // ---- the preview changes nothing and tells the Super Admin what will happen
  w = world()
  const look = await w.ask({ action: "preview", id: WORKER })
  assert.equal(look.status, 200); assert.equal(look.body.mode, "close"); assert.equal(look.body.record_total, 4); assert.equal(look.body.phrase, "DELETE worker@valencia.test"); assert.equal(look.body.blocker, null); assert.equal(look.body.open_work, 3)
  assert.equal((await w.ask({ action: "preview", id: SUPER.id })).body.blocker, "You cannot delete your own account.")
  assert.equal(changes(w.log), 0, "looking changes nothing"); assert.equal(w.log.stepUps.length, 0)

  // ---- every refusal changes nothing, and the authenticator is asked last (a wrong phrase never burns a code)
  w = world()
  assert.match((await w.ask(good(SUPER.id))).body.error, /own account/); assert.match((await w.ask(good(OTHER_SUPER))).body.error, /Super Admin/); assert.match((await w.ask(good(GONE))).body.error, /already deleted/)
  for (const reason of ["", "ok", "x".repeat(REASON_MAX + 1), 5, undefined]) assert.match((await w.ask(good(WORKER, { reason }))).body.error, new RegExp(`${REASON_MIN}-${REASON_MAX}`), String(reason).slice(0, 10))
  for (const confirm of ["", "DELETE", "delete forever", "DELETE someone@else.test", undefined, 7]) assert.match((await w.ask(good(WORKER, { confirm }))).body.error, /Type DELETE worker@valencia\.test exactly/, String(confirm))
  assert.equal(w.log.stepUps.length, 0, "no code is checked until everything else is right")
  const noCode = await w.ask(good(WORKER, { totp: undefined })); assert.equal(noCode.status, 403); assert.equal((await w.ask(good(WORKER, { totp: "000000" }))).status, 403)
  assert.equal(changes(w.log), 0, "not one change was made by any refusal")

  // ---- an account with records is closed: personal data wiped, records kept, nothing deleted
  w = world()
  const closed = await w.ask(good(WORKER, { confirm: "  delete WORKER@valencia.test " }))
  assert.deepEqual(closed, { status: 200, body: { ok: true, mode: "close", files_removed: 2 } }, "the phrase ignores case and surrounding spaces")
  assert.deepEqual(w.log.rpc.filter(([name]) => name === "close_account"), [["close_account", { p_user: WORKER, p_actor: SUPER.id, p_reason: "Left the company, confirmed by HR" }]])
  assert.deepEqual(w.log.locked, [WORKER], "the sign-in is locked"); assert.deepEqual(w.log.deleted, [], "the account row is never deleted when it has records"); assert.ok(!w.log.rpc.some(([name]) => name === "account_delete_prepare"))
  assert.deepEqual(w.log.removed, [["identity-docs", ["u/front.jpg"]], ["avatars", [`${WORKER}/me.png`]]])

  // ---- an account with no records is removed completely, with a trail written before and after
  w = world()
  const deleted = await w.ask(good(CLEAN))
  assert.deepEqual(deleted, { status: 200, body: { ok: true, mode: "delete", files_removed: 3 } })
  assert.deepEqual(w.log.deleted, [CLEAN]); assert.deepEqual(w.log.audit.map(([action]) => action), ["account.delete_requested", "account.deleted"], "written before and after, so a failure in between is visible")
  assert.equal(w.log.audit[0][2].snapshot.email, "clean@valencia.test", "the audit keeps who it was"); assert.equal(w.log.audit[0][2].reason, "Left the company, confirmed by HR")
  assert.deepEqual(w.log.rpc.map(([name]) => name), ["account_delete_preview", "account_delete_prepare"])
  assert.ok(w.log.audit[0] && w.log.rpc.findIndex(([n]) => n === "account_delete_prepare") < w.log.removed.length + 1)

  // ---- failures part-way are reported, never hidden
  w = world({ deleteAuthUser: async () => ({ message: "boom" }) })
  const failedDelete = await w.ask(good(CLEAN)); assert.equal(failedDelete.status, 500); assert.match(failedDelete.body.error, /could not be deleted: boom/); assert.deepEqual(w.log.audit.map(([action]) => action), ["account.delete_requested"], "no 'deleted' line when it did not happen")
  w = world({ lockAuthUser: async () => ({ message: "no lock" }) })
  const failedLock = await w.ask(good(WORKER)); assert.equal(failedLock.status, 500); assert.match(failedLock.body.error, /records were kept/)
  w = world({ rpc: async (name, args) => name === "account_delete_preview" ? { data: previews[args.p_user], error: null } : { data: null, error: { message: 'ERROR: This account has records, so it can only be closed, not deleted' } } })
  const raced = await w.ask(good(CLEAN)); assert.equal(raced.status, 409); assert.match(raced.body.error, /only be closed, not deleted/, "if records appear in between, the database still refuses"); assert.deepEqual(w.log.deleted, [])
  w = world({ rpc: async () => ({ data: null, error: { message: "db down" } }) })
  assert.deepEqual(await w.ask({ action: "preview", id: WORKER }), { status: 500, body: { error: "The account could not be checked, so nothing was changed" } })
}

// ---------------------------------------------------------------- the wiring
{
  const index = readFileSync(new URL("../supabase/functions/account-control/index.ts", import.meta.url), "utf8")
  assert.match(index, /requireCaller\(req\)/); assert.match(index, /verifyTotpCode/); assert.doesNotMatch(index, /verify_jwt\s*[:=]\s*false/)
  assert.match(index, /SUPABASE_ANON_KEY/, "the authenticator check uses the public key + the caller's token, not the service key")
  const stepUp = readFileSync(new URL("../supabase/functions/_shared/stepUp.ts", import.meta.url), "utf8")
  assert.doesNotMatch(stepUp, /SERVICE_ROLE/)
}

console.log("Account control: authenticator step-up, Super Admin only, preview, every refusal changes nothing, close vs complete deletion, audit trail and failure reporting passed")
