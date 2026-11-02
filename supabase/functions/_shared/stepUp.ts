// A fresh authenticator (TOTP) code, checked by the server, for the most serious actions. The session is already at aal2 from sign-in; this asks again, right now,
// so a session left open on an unattended screen cannot delete anything. The check is the same one the sign-in uses (Supabase Auth MFA challenge + verify, made with
// the caller's own token), so BuildTrack never sees or stores the authenticator secret. Pure apart from the fetch that is passed in, so Node tests can fake it.
import type { FetchLike } from "./emailTest.ts"

export const isTotp = (value: unknown): value is string => typeof value === "string" && /^\d{6}$/.test(value)

export type StepUp = { ok: true } | { ok: false; status: number; message: string }

type Factor = { id?: string; factor_type?: string; status?: string }

export async function verifyTotpCode(options: { baseUrl: string; anonKey: string; token: string; code: unknown; fetchImpl: FetchLike }): Promise<StepUp> {
  if (!isTotp(options.code)) return { ok: false, status: 400, message: "Type the 6-digit code from your authenticator app." }
  const headers = { Authorization: `Bearer ${options.token}`, apikey: options.anonKey, "Content-Type": "application/json" }
  const wrong = { ok: false as const, status: 403, message: "That authenticator code is not correct. Wait for the next code and try again." }
  try {
    const me = await options.fetchImpl(`${options.baseUrl}/auth/v1/user`, { method: "GET", headers })
    const profile = me.ok ? (JSON.parse(await me.text()) as { factors?: Factor[] }) : null
    const factor = (profile?.factors ?? []).find((item) => item.factor_type === "totp" && item.status === "verified" && typeof item.id === "string")
    if (!factor?.id) return { ok: false, status: 403, message: "This account has no authenticator set up, so this action cannot be confirmed." }
    const challenge = await options.fetchImpl(`${options.baseUrl}/auth/v1/factors/${encodeURIComponent(factor.id)}/challenge`, { method: "POST", headers, body: "{}" })
    const challengeId = challenge.ok ? (JSON.parse(await challenge.text()) as { id?: string }).id : null
    if (!challengeId) return { ok: false, status: 502, message: "The authenticator check could not start. Try again in a moment." }
    const verify = await options.fetchImpl(`${options.baseUrl}/auth/v1/factors/${encodeURIComponent(factor.id)}/verify`, { method: "POST", headers, body: JSON.stringify({ challenge_id: challengeId, code: options.code }) })
    await verify.text()
    if (verify.ok) return { ok: true }
    return verify.status === 429 ? { ok: false, status: 429, message: "Too many tries. Wait a minute and try again." } : wrong
  } catch {
    return { ok: false, status: 502, message: "The authenticator check could not be completed. Try again in a moment." }
  }
}
