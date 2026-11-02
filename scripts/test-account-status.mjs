import assert from "node:assert/strict"
import { checkStatusChange, cleanReason, MAX_REASON, reactivationNotice, suspensionNotice } from "../supabase/functions/_shared/accountStatus.ts"

const superAdmin = { id: "s1", role: "super_admin" }
const admin = { id: "a1", role: "admin" }
const person = (status, role = "foreman", id = "u1") => ({ id, role, status })
const fail = (result, status, pattern) => { assert.equal(result.ok, false); assert.equal(result.status, status); assert.match(result.message, pattern) }

// Suspending needs a written reason.
fail(checkStatusChange(admin, person("active"), false, undefined), 400, /reason/i)
fail(checkStatusChange(admin, person("active"), false, "   "), 400, /reason/i)
fail(checkStatusChange(admin, person("active"), false, "abcd"), 400, /at least 5/)
fail(checkStatusChange(admin, person("active"), false, 12345), 400, /reason/i)
assert.deepEqual(checkStatusChange(admin, person("active"), false, "  Left the company \n last week "), { ok: true, reason: "Left the company last week" })

// Reasons are plain text of limited length; control characters never survive.
assert.equal(cleanReason("a\u0000b\u001fc\u007fd"), "a b c d")
assert.equal(cleanReason("x".repeat(900)).length, MAX_REASON)
assert.equal(cleanReason(null), "")
assert.equal(cleanReason("<script>alert(1)</script>"), "<script>alert(1)</script>") // stored as text; the UI renders text, never HTML

// Protected accounts: nobody changes their own status, only a Super Admin touches Admins or Super Admins.
fail(checkStatusChange(admin, person("active", "admin", "a1"), false, "valid reason"), 400, /own account/)
fail(checkStatusChange(superAdmin, person("active", "super_admin", "s1"), false, "valid reason"), 400, /own account/)
fail(checkStatusChange(superAdmin, person("disabled", "super_admin", "s1"), true, undefined), 400, /own account/)
fail(checkStatusChange(admin, person("active", "admin", "a2"), false, "valid reason"), 403, /Super Admin/)
fail(checkStatusChange(admin, person("active", "super_admin", "s9"), false, "valid reason"), 403, /Super Admin/)
fail(checkStatusChange(admin, person("disabled", "admin", "a2"), true, undefined), 403, /Super Admin/)
assert.equal(checkStatusChange(superAdmin, person("active", "admin", "a2"), false, "valid reason").ok, true)
assert.equal(checkStatusChange(superAdmin, person("active", "super_admin", "s2"), false, "valid reason").ok, true) // a second Super Admin; the caller always stays active

// Only the right status moves: suspend active, enable suspended. Pending and rejected registrations are never switched on from here.
fail(checkStatusChange(admin, person("pending"), false, "valid reason"), 400, /Reject pending/)
fail(checkStatusChange(admin, person("rejected"), false, "valid reason"), 400, /already rejected/)
fail(checkStatusChange(admin, person("disabled"), false, "valid reason"), 400, /already suspended/)
fail(checkStatusChange(admin, person("pending"), true, undefined), 400, /Only a suspended account/)
fail(checkStatusChange(admin, person("rejected"), true, undefined), 400, /Only a suspended account/)
fail(checkStatusChange(admin, person("active"), true, undefined), 400, /Only a suspended account/)
assert.deepEqual(checkStatusChange(admin, person("disabled"), true, undefined), { ok: true, reason: null })
assert.deepEqual(checkStatusChange(admin, person("disabled"), true, "ignored"), { ok: true, reason: null })

// Notices fit the notifications table (kind <= 40, title <= 160, body <= 500) and carry the reason.
const notice = suspensionNotice("y".repeat(MAX_REASON))
assert.equal(notice.kind, "account.suspended")
assert.ok(notice.kind.length <= 40 && notice.title.length <= 160 && notice.body.length <= 500)
assert.equal(suspensionNotice("Left the company").body, "Reason: Left the company")
assert.equal(reactivationNotice().kind, "account.reactivated")
assert.ok(reactivationNotice().body.length <= 500)

console.log("Account status rules: required reason, self / Super Admin protection, status transitions and notices passed")
