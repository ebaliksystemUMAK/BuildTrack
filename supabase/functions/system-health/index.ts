import { audit, corsHeaders, HttpError, json, requireCaller } from "../_shared/guard.ts"
import { checkTestEmail, sendTestEmail, type FetchLike } from "../_shared/emailTest.ts"
import { authorizeHealthCaller, mailConfig, sanitizeProviderText } from "../_shared/healthModel.ts"

// System health helper for the Super Admin screen (verify_jwt stays ON). It does the three things the browser cannot do itself because they need the
// Edge Function secrets: say whether the mail settings are present (yes / no, never a value), send ONE test email to the signed-in Super Admin's own
// address, and ask the mail provider what happened to that test. Real sending is therefore limited to: one person, their own address, 3 an hour.
const read = (name: string) => Deno.env.get(name)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  try {
    const caller = await requireCaller(req) // signed in, active, Admin or Super Admin, authenticator verified
    const body = await req.json().catch(() => ({}))
    const decision = authorizeHealthCaller(caller.role, body?.action)
    if (!decision.ok) throw new HttpError(decision.status, decision.message)

    if (decision.action === "config") return json(mailConfig(read))

    if (decision.action === "send_test_email") {
      // The recipient is never read from the request: it is this person's own address.
      const { data: me } = await caller.admin.from("profiles").select("email, full_name").eq("id", caller.id).single()
      if (!me?.email) throw new HttpError(400, "Your account has no email address")
      const { data: testId, error: limitError } = await caller.admin.rpc("begin_email_test", { p_user: caller.id })
      if (limitError) throw new HttpError(/too many|daily limit/i.test(limitError.message) ? 429 : 403, sanitizeProviderText(limitError.message))
      const result = await sendTestEmail({ read, fetchImpl: fetch as unknown as FetchLike, toEmail: me.email, toName: me.full_name ?? null })
      await caller.admin.rpc("finish_email_test", { p_id: testId, p_status: result.accepted ? "accepted" : "failed", p_provider_status: result.http_status, p_message_id: result.message_id, p_detail: result.detail })
      await audit(caller, "email.test", null, { test_id: testId, accepted: result.accepted, provider_status: result.http_status })
      return json({ test_id: testId, ...result, delivery: "unconfirmed" })
    }

    // check_test_email: only the caller's own test, and only one the provider accepted.
    const testId = Number(body?.test_id)
    if (!Number.isInteger(testId) || testId <= 0) throw new HttpError(400, "Missing test id")
    const { data: test } = await caller.admin.from("email_test_log").select("id, status, message_id").eq("id", testId).eq("user_id", caller.id).maybeSingle()
    if (!test || test.status !== "accepted" || !test.message_id) throw new HttpError(404, "There is no accepted test email to look up")
    const delivery = await checkTestEmail({ read, fetchImpl: fetch as unknown as FetchLike, messageId: test.message_id })
    return json(delivery)
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status)
    console.error(err)
    return json({ error: "Server error" }, 500)
  }
})
