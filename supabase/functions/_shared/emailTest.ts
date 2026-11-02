// The one test email and the optional delivery lookup, with the network call passed in so a test can mock it. Nothing here reads or returns a secret value.
import { buildEmail } from "./emailModel.ts"
import { cleanMessageId, interpretEvents, mailConfig, sanitizeProviderText, type EnvReader, type TestState } from "./healthModel.ts"

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>

const BREVO = "https://api.brevo.com/v3"
const timeout = () => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(10_000) : undefined)

export type TestResult = { accepted: boolean; http_status: number | null; message_id: string | null; detail: string }

// Sends ONE message to the address it is given (the caller passes the signed-in Super Admin's own address, never one typed by anybody).
export async function sendTestEmail(options: { read: EnvReader; fetchImpl: FetchLike; toEmail: string; toName: string | null }): Promise<TestResult> {
  const config = mailConfig(options.read)
  if (!config.can_send) return { accepted: false, http_status: null, message_id: null, detail: "Email is not set up: the mail key and the sender address must be saved as Supabase secrets first." }
  const apiKey = (options.read("BREVO_API_KEY") ?? "").trim()
  const sender = { email: (options.read("MAIL_FROM_EMAIL") ?? "").trim(), name: options.read("MAIL_FROM_NAME") || "BuildTrack" }
  const mail = buildEmail({ id: "test", kind: "system.test", title: "BuildTrack test email", body: "If you can read this, BuildTrack can ask the mail provider to send you email. This message was requested from System health.", link: "/admin/system-health", to_email: options.toEmail, to_name: options.toName }, options.read("APP_URL") ?? "")
  try {
    const response = await options.fetchImpl(`${BREVO}/smtp/email`, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender, to: [{ email: options.toEmail }], subject: mail.subject, htmlContent: mail.html, textContent: mail.text, tags: ["buildtrack", "test"] }),
      signal: timeout(),
    })
    const body = await response.text()
    if (!response.ok) return { accepted: false, http_status: response.status, message_id: null, detail: `The mail provider refused the request (HTTP ${response.status}): ${sanitizeProviderText(body, [apiKey]) || "no details"}` }
    let id: string | null = null
    try {
      const parsed = JSON.parse(body) as { messageId?: unknown }
      id = cleanMessageId(parsed.messageId)
    } catch {
      id = null
    }
    return { accepted: true, http_status: response.status, message_id: id, detail: `Accepted by the mail provider (HTTP ${response.status}). That is not confirmation that it reached the inbox.` }
  } catch (error) {
    return { accepted: false, http_status: null, message_id: null, detail: `Could not reach the mail provider: ${sanitizeProviderText((error as Error)?.message ?? "network error", [apiKey])}` }
  }
}

export type DeliveryResult = { state: TestState; events: string[]; detail: string }

// Asks the provider what happened to a message it accepted: the transactional log (by message id), then the events of that message.
export async function checkTestEmail(options: { read: EnvReader; fetchImpl: FetchLike; messageId: string }): Promise<DeliveryResult> {
  const apiKey = (options.read("BREVO_API_KEY") ?? "").trim()
  if (!apiKey) return { state: "unknown", events: [], detail: "Email is not set up, so the provider cannot be asked." }
  const headers = { "api-key": apiKey, Accept: "application/json" }
  const unknown = (detail: string): DeliveryResult => ({ state: "unknown", events: [], detail })
  try {
    const list = await options.fetchImpl(`${BREVO}/smtp/emails?messageId=${encodeURIComponent(options.messageId)}&limit=1`, { method: "GET", headers, signal: timeout() })
    const listText = await list.text()
    if (!list.ok) return unknown(`The provider could not be asked (HTTP ${list.status}): ${sanitizeProviderText(listText, [apiKey]) || "no details"}`)
    let uuid = ""
    try {
      const parsed = JSON.parse(listText) as { transactionalEmails?: Array<{ uuid?: unknown }> }
      uuid = typeof parsed.transactionalEmails?.[0]?.uuid === "string" ? parsed.transactionalEmails[0].uuid : ""
    } catch {
      uuid = ""
    }
    if (!/^[A-Za-z0-9-]{8,64}$/.test(uuid)) return unknown("The provider has no record of this message yet. This can take a few minutes; check again, or look in the provider's dashboard.")
    const detail = await options.fetchImpl(`${BREVO}/smtp/emails/${uuid}`, { method: "GET", headers, signal: timeout() })
    const detailText = await detail.text()
    if (!detail.ok) return unknown(`The provider could not return the message (HTTP ${detail.status}): ${sanitizeProviderText(detailText, [apiKey]) || "no details"}`)
    let events: unknown = []
    try {
      events = (JSON.parse(detailText) as { events?: unknown }).events
    } catch {
      events = []
    }
    const result = interpretEvents(events)
    const text = result.state === "delivered" ? "The provider reports the message was delivered."
      : result.state === "failed" ? "The provider reports the message was not delivered (bounced, blocked or rejected)."
      : result.state === "pending" ? "The provider accepted it but has not reported delivery yet."
      : "The provider has not reported any event for this message yet."
    return { state: result.state, events: result.names, detail: text }
  } catch (error) {
    return unknown(`Could not reach the mail provider: ${sanitizeProviderText((error as Error)?.message ?? "network error", [apiKey])}`)
  }
}
