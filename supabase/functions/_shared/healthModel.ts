// Pure rules for the system health function (no Deno or network APIs here, so they are unit-tested in Node by `pnpm test:health`):
// who may use it, what is reported about the mail configuration (yes / no only, never a value) and how provider answers are cleaned before anyone sees them.
import { appBase } from "./emailModel.ts"

export type HealthAction = "config" | "send_test_email" | "check_test_email"
export const HEALTH_ACTIONS: HealthAction[] = ["config", "send_test_email", "check_test_email"]

// Every action is for an active Super Admin whose session passed the authenticator check (requireCaller already enforced the session and the active account).
export function authorizeHealthCaller(role: string | null | undefined, action: unknown): { ok: true; action: HealthAction } | { ok: false; status: number; message: string } {
  if (typeof action !== "string" || !HEALTH_ACTIONS.includes(action as HealthAction)) return { ok: false, status: 400, message: "Unknown action" }
  if (role !== "super_admin") return { ok: false, status: 403, message: "Only a Super Admin can use the system health checks" }
  return { ok: true, action: action as HealthAction }
}

// Removes anything that looks like a credential, markup and control characters from text that came from outside, then shortens it.
export function sanitizeProviderText(text: unknown, secrets: Array<string | undefined> = []): string {
  let out = typeof text === "string" ? text : text === null || text === undefined ? "" : JSON.stringify(text) ?? ""
  for (const secret of secrets) if (secret && secret.length >= 6) out = out.split(secret).join("[hidden]")
  out = out
    .replace(/xkeysib-[A-Za-z0-9_-]+/g, "[hidden]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[hidden]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [hidden]")
    .replace(/(api[-_ ]?key|authorization|token|secret|password)(["']?\s*[:=]\s*)["']?[^\s"',}]+/gi, "$1$2[hidden]")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return out.length > 200 ? out.slice(0, 199).trimEnd() + "…" : out
}

// A provider message id such as <202611010000.1@smtp-relay.example.test>. It is kept exactly (the angle brackets are part of it) only when it has the
// shape of one; anything else is dropped, so nothing odd is stored or later put into a request.
export function cleanMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const id = value.trim()
  return /^<?[A-Za-z0-9._%+=@-]{3,180}>?$/.test(id) ? id : null
}

export type EnvReader = (name: string) => string | undefined
export type MailConfig = {
  brevo_api_key: boolean
  mail_from_email: boolean
  mail_from_name: boolean
  app_url: { set: boolean; valid: boolean }
  cron_secret: { set: boolean; strong: boolean }
  can_send: boolean
}

// What is configured, as yes / no answers. The values themselves are never returned.
export function mailConfig(read: EnvReader): MailConfig {
  const key = (read("BREVO_API_KEY") ?? "").trim()
  const from = (read("MAIL_FROM_EMAIL") ?? "").trim()
  const fromValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)
  const url = (read("APP_URL") ?? "").trim()
  const cron = read("CRON_SECRET") ?? ""
  return {
    brevo_api_key: key.length > 0,
    mail_from_email: fromValid,
    mail_from_name: (read("MAIL_FROM_NAME") ?? "").trim().length > 0,
    app_url: { set: url.length > 0, valid: appBase(url) !== "" },
    cron_secret: { set: cron.length > 0, strong: cron.length >= 16 },
    can_send: key.length > 0 && fromValid,
  }
}

export type TestState = "delivered" | "failed" | "pending" | "unknown"

// Reads the events of one transactional email as the provider reports them. "Accepted" is not one of them on purpose: acceptance is the provider saying it
// took the message; only a delivered (or later opened / clicked) event confirms that the receiving mail server took it.
export function interpretEvents(events: unknown): { state: TestState; names: string[] } {
  const names = Array.isArray(events) ? events.map((event) => (event && typeof event === "object" ? String((event as { name?: unknown }).name ?? "") : "")).filter(Boolean).map((name) => name.slice(0, 30)) : []
  const lower = names.map((name) => name.toLowerCase())
  const failed = ["hardbounces", "softbounces", "blocked", "invalid", "spam", "error", "unsubscribed"]
  if (lower.some((name) => failed.includes(name))) return { state: "failed", names }
  if (lower.some((name) => ["delivered", "opened", "clicks", "uniqueopened"].includes(name))) return { state: "delivered", names }
  return { state: names.length ? "pending" : "unknown", names }
}
