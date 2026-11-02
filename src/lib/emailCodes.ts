import { invokePublicFunction } from "./functions"

// The emailed 6-digit codes (Edge Function `email-code`). They do not depend on any Supabase email template: BuildTrack makes the code, emails it and checks it itself.
// Resetting a forgotten password works signed out; confirming an address needs the signed-in account whose address it is.
export const RESEND_SECONDS = 60
export const isSixDigits = (value: string) => /^\d{6}$/.test(value)
export const onlyDigits = (value: string) => value.replace(/\D/g, "").slice(0, 6)

type Answer = { ok?: boolean; already?: boolean; message?: string }

const failure = (error: string) => (/cannot reach|not deployed/i.test(error) ? "Cannot reach the server. Check your internet connection and try again." : error)

async function ask(body: Record<string, unknown>): Promise<{ ok: boolean; already: boolean; error: string }> {
  const { data, error } = await invokePublicFunction<Answer>("email-code", body)
  if (error || !data?.ok) return { ok: false, already: false, error: failure(error ?? "Something went wrong. Please try again.") }
  return { ok: true, already: Boolean(data.already), error: "" }
}

export const requestResetCode = (email: string) => ask({ action: "send_reset", email })
export const checkResetCode = (email: string, code: string) => ask({ action: "check_reset", email, code })
export const finishReset = (email: string, code: string, password: string) => ask({ action: "verify_reset", email, code, password })
export const requestAddressCode = () => ask({ action: "send_register" })
export const confirmAddressCode = (code: string) => ask({ action: "verify_register", code })
