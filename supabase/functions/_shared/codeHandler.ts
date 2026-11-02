// The decisions of the `email-code` Edge Function, with everything it talks to passed in (the database client, the secrets, the network), so a test can run every path
// without Deno, a database or a mail provider. index.ts only wires the real ones in. See that file for what the function is for.
import { brevoReady, buildCodeEmail, buildPasswordChangedEmail, sendMail } from "./codeEmail.ts"
import { authorizeCodeAction, generateCode, hashCode, isCode, isEmail, messages, normalizeEmail, passwordProblem, type CodePurpose } from "./codeModel.ts"
import type { FetchLike } from "./emailTest.ts"
import type { EnvReader } from "./healthModel.ts"

export type Reply = { status: number; body: Record<string, unknown> }
const fail = (status: number, error: string): Reply => ({ status, body: { error } })
const ok = (extra: Record<string, unknown> = {}): Reply => ({ status: 200, body: { ok: true, ...extra } })

// The small part of the Supabase client that is used (the real client satisfies it).
type Rows<T> = Promise<{ data: T | null; error?: { message?: string; code?: string } | null }>
export type CodeAdmin = {
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string; email?: string | null } | null } | null }>; admin: { updateUserById: (id: string, attrs: { password: string }) => Promise<{ error: { message: string } | null }> } }
  from: (table: string) => { select: (columns: string) => { eq: (column: string, value: string) => { maybeSingle: () => Rows<Record<string, unknown>> } }; insert: (row: Record<string, unknown>) => Promise<unknown> }
  rpc: (name: string, args: Record<string, unknown>) => Rows<Record<string, unknown>> | Promise<{ error?: { message?: string; code?: string } | null; data?: unknown }>
}
export type CodeDeps = { admin: CodeAdmin; read: EnvReader; fetchImpl: FetchLike; serviceKey: string; log?: (message: string) => void }

const rateReply = (error: { message?: string; code?: string } | null | undefined): Reply | null =>
  !error ? null : error.code === "P0001" ? fail(429, error.message ?? "Please wait and try again") : fail(500, "Server error")

export async function handleCode(input: { body: unknown; token: string }, deps: CodeDeps): Promise<Reply> {
  const { admin, read, fetchImpl, serviceKey } = deps
  const log = deps.log ?? (() => {})
  const body = (input.body && typeof input.body === "object" ? input.body : {}) as Record<string, unknown>
  // The public key is a valid token but belongs to no person: getUser then says so and the caller is treated as signed out.
  const found = input.token ? await admin.auth.getUser(input.token).catch(() => null) : null
  const user = found?.data?.user ?? null
  const decision = authorizeCodeAction(body.action, Boolean(user))
  if (!decision.ok) return fail(decision.status, decision.message)

  // ---------------------------------------------------------------- the signed-in person's own address
  if (decision.action === "send_register" || decision.action === "verify_register") {
    const email = normalizeEmail(user!.email)
    const profile = (await admin.from("profiles").select("id, full_name, status, email_verified_at").eq("id", user!.id).maybeSingle()).data as { full_name: string | null; status: string; email_verified_at: string | null } | null
    if (!profile || !isEmail(email) || !["pending", "active"].includes(profile.status)) return fail(403, "This account cannot be verified")
    if (profile.email_verified_at) return ok({ already: true })
    if (decision.action === "send_register") {
      if (!(await brevoReady({ read, fetchImpl })).ok) return fail(503, messages.unavailableRegister)
      const code = generateCode()
      const issued = (await admin.rpc("issue_email_code", { p_email: email, p_purpose: "register", p_user: user!.id, p_hash: await hashCode(serviceKey, "register", email, code), p_minutes: 10 })) as { error?: { message?: string; code?: string } | null }
      const limited = rateReply(issued.error)
      if (limited) return limited
      const sent = await sendMail({ read, fetchImpl, to: email, toName: profile.full_name, mail: buildCodeEmail({ purpose: "register", code, name: profile.full_name }), tag: "code-register" })
      if (!sent.ok) {
        log(`register code not sent: ${sent.detail}`)
        return fail(502, messages.unavailableRegister)
      }
      return ok()
    }
    if (!isCode(body.code)) return fail(400, messages.invalid)
    const consumed = ((await admin.rpc("consume_email_code", { p_email: email, p_purpose: "register", p_hash: await hashCode(serviceKey, "register", email, body.code) })) as { data?: { ok?: boolean; user_id?: string; reason?: string } | null }).data
    if (!consumed?.ok || consumed.user_id !== user!.id) return fail(400, consumed?.reason === "locked" ? messages.locked : messages.invalid)
    const marked = (await admin.rpc("mark_email_verified", { p_user: user!.id })) as { error?: unknown }
    return marked.error ? fail(500, "Server error") : ok()
  }

  // ---------------------------------------------------------------- a forgotten password (signed out)
  const email = normalizeEmail(body.email)
  if (!isEmail(email)) return fail(400, "Enter a valid email address.")
  const purpose: CodePurpose = "reset"

  if (decision.action === "send_reset") {
    // A missing or rejected mail key is the same for everybody, so saying so tells nobody anything about an account.
    if (!(await brevoReady({ read, fetchImpl })).ok) return fail(503, messages.unavailable)
    const profile = (await admin.from("profiles").select("id, full_name, status").eq("email", email).maybeSingle()).data as { id: string; full_name: string | null; status: string } | null
    const live = profile?.status === "active"
    const code = generateCode()
    // The limits are counted for every address, existing or not, and a code is only emailed when the account exists and is active.
    const issued = (await admin.rpc("issue_email_code", { p_email: email, p_purpose: purpose, p_user: live ? profile!.id : null, p_hash: await hashCode(serviceKey, purpose, email, code), p_minutes: 10 })) as { error?: { message?: string; code?: string } | null }
    const limited = rateReply(issued.error)
    if (limited) return limited
    if (live) {
      const sent = await sendMail({ read, fetchImpl, to: email, toName: profile!.full_name, mail: buildCodeEmail({ purpose, code, name: profile!.full_name }), tag: "code-reset" })
      if (!sent.ok) log(`reset code not sent: ${sent.detail}`) // the answer below stays the same
    }
    return ok({ message: messages.sent })
  }

  // check_reset: is this the right code? It is confirmed on its own step BEFORE the new password is asked for; the code is not used up here (verify_reset does that).
  if (decision.action === "check_reset") {
    if (!isCode(body.code)) return fail(400, messages.invalid)
    const checked = ((await admin.rpc("check_email_code", { p_email: email, p_purpose: purpose, p_hash: await hashCode(serviceKey, purpose, email, body.code) })) as { data?: { ok?: boolean; reason?: string } | null }).data
    return checked?.ok ? ok() : fail(400, checked?.reason === "locked" ? messages.locked : messages.invalid)
  }

  // verify_reset
  const problem = passwordProblem(body.password)
  if (problem) return fail(400, problem)
  if (!isCode(body.code)) return fail(400, messages.invalid)
  const consumed = ((await admin.rpc("consume_email_code", { p_email: email, p_purpose: purpose, p_hash: await hashCode(serviceKey, purpose, email, body.code) })) as { data?: { ok?: boolean; user_id?: string; reason?: string } | null }).data
  if (!consumed?.ok || !consumed.user_id) return fail(400, consumed?.reason === "locked" ? messages.locked : messages.invalid)
  const profile = (await admin.from("profiles").select("id, full_name, status, email").eq("id", consumed.user_id).maybeSingle()).data as { id: string; full_name: string | null; status: string; email: string } | null
  if (!profile || profile.status !== "active" || normalizeEmail(profile.email) !== email) return fail(400, messages.invalid)
  const updated = await admin.auth.admin.updateUserById(profile.id, { password: body.password as string })
  if (updated.error) {
    const text = updated.error.message.toLowerCase()
    return fail(400, text.includes("same") || text.includes("different") ? "Choose a password you have not used before." : text.includes("weak") || text.includes("pwned") || text.includes("compromised") ? "That password is too easy to guess or appears in known leaks. Choose another one." : "The password could not be changed. Try again.")
  }
  await admin.rpc("revoke_user_sessions", { p_user: profile.id }) // every other sign-in of this account ends
  await admin.from("audit_log").insert({ actor_id: profile.id, target_id: profile.id, action: "account.password_reset", details: { via: "email_code" } })
  const notice = await sendMail({ read, fetchImpl, to: email, toName: profile.full_name, mail: buildPasswordChangedEmail({ name: profile.full_name }), tag: "password-changed" })
  if (!notice.ok) log(`password-changed notice not sent: ${notice.detail}`)
  return ok()
}
