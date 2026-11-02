// The emails that carry a 6-digit code, and the one call to the mail provider (Brevo) they use. Pure apart from the fetch that is passed in, so a test can mock it.
// Nothing here reads or returns a secret value.
import { escapeHtml } from "./emailModel.ts"
import type { FetchLike } from "./emailTest.ts"
import { sanitizeProviderText, type EnvReader } from "./healthModel.ts"
import { CODE_MINUTES, type CodePurpose } from "./codeModel.ts"

const BREVO = "https://api.brevo.com/v3"
const timeout = () => (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(10_000) : undefined)
const first = (name: string | null) => (name ?? "").trim().split(/\s+/)[0] || "there"

type Mail = { subject: string; html: string; text: string }

function frame(title: string, intro: string, code: string | null, outro: string): string {
  const codeBlock = code
    ? `<tr><td align="center" style="padding:6px 32px 22px 32px;"><span style="display:block;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:40px;line-height:1;font-weight:800;letter-spacing:12px;color:#68135f;">${escapeHtml(code)}</span></td></tr>`
    : ""
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light dark" /><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f5f0f5;font-family:'Segoe UI',Helvetica,Arial,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f0f5;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8dce7;">
<tr><td style="background-color:#68135f;padding:28px 32px 22px 32px;"><p style="margin:0;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#f18b00;">Valencia Construction Services</p><h1 style="margin:6px 0 0 0;font-size:26px;line-height:1.2;font-weight:800;color:#ffffff;">${escapeHtml(title)}</h1></td></tr>
<tr><td style="height:4px;background-color:#f18b00;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:30px 32px 14px 32px;color:#2a251d;"><p style="margin:0;font-size:15px;line-height:1.6;color:#4a4350;">${escapeHtml(intro)}</p></td></tr>
${codeBlock}
<tr><td style="padding:6px 32px 28px 32px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#fff7ea;border-left:4px solid #f18b00;border-radius:8px;"><tr><td style="padding:12px 14px;font-size:13px;line-height:1.55;color:#5a4a2c;">${escapeHtml(outro)}</td></tr></table></td></tr>
<tr><td style="padding:18px 32px 26px 32px;border-top:1px solid #efe6ee;background-color:#faf6fa;"><p style="margin:0;font-size:12px;line-height:1.6;color:#8a828f;">Sent by BuildTrack, the site progress and quality platform of Valencia Construction Services.</p></td></tr>
</table></td></tr></table></body></html>`
}

export function buildCodeEmail(input: { purpose: CodePurpose; code: string; name: string | null }): Mail {
  const hello = `Hello ${first(input.name)},`
  const reset = input.purpose === "reset"
  const subject = reset ? "Your BuildTrack password reset code" : "Your BuildTrack verification code"
  const intro = reset
    ? `${hello} use this code to reset the password of your BuildTrack account. Type it on the Forgot password screen.`
    : `${hello} use this code to confirm that this email address is yours. Type it in the BuildTrack window you are registering in.`
  const outro = `The code works once and expires in ${CODE_MINUTES} minutes. Never share it: BuildTrack staff will never ask you for it. If you did not ask for this, ignore this email${reset ? ": your password stays the same" : ""}.`
  return { subject, html: frame(subject, intro, input.code, outro), text: [intro, "", `Code: ${input.code}`, "", outro].join("\n") }
}

export function buildPasswordChangedEmail(input: { name: string | null }): Mail {
  const subject = "Your BuildTrack password was changed"
  const intro = `Hello ${first(input.name)}, the password of your BuildTrack account was just changed with an emailed code. You were signed out everywhere.`
  const outro = "If this was not you, reset your password again right away and tell your administrator: someone may have access to your email."
  return { subject, html: frame(subject, intro, null, outro), text: [intro, "", outro].join("\n") }
}

// Is the saved mail key one the provider accepts? A free, read-only question that sends nothing: it lets a code request fail early with a clear message
// (for everyone alike, so it reveals nothing about who has an account) instead of silently never sending.
export async function brevoReady(options: { read: EnvReader; fetchImpl: FetchLike }): Promise<{ ok: true } | { ok: false; reason: "not_configured" | "key_rejected" | "unreachable" }> {
  const key = (options.read("BREVO_API_KEY") ?? "").trim()
  const from = (options.read("MAIL_FROM_EMAIL") ?? "").trim()
  if (!key || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) return { ok: false, reason: "not_configured" }
  try {
    const response = await options.fetchImpl(`${BREVO}/account`, { method: "GET", headers: { "api-key": key, Accept: "application/json" }, signal: timeout() })
    await response.text()
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "key_rejected" }
    return response.ok ? { ok: true } : { ok: false, reason: "unreachable" }
  } catch {
    return { ok: false, reason: "unreachable" }
  }
}

export async function sendMail(options: { read: EnvReader; fetchImpl: FetchLike; to: string; toName: string | null; mail: Mail; tag: string }): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const apiKey = (options.read("BREVO_API_KEY") ?? "").trim()
  const sender = { email: (options.read("MAIL_FROM_EMAIL") ?? "").trim(), name: options.read("MAIL_FROM_NAME") || "BuildTrack" }
  if (!apiKey || !sender.email) return { ok: false, status: null, detail: "Email is not set up" }
  try {
    const response = await options.fetchImpl(`${BREVO}/smtp/email`, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sender, to: [{ email: options.to, name: options.toName ?? undefined }], subject: options.mail.subject, htmlContent: options.mail.html, textContent: options.mail.text, tags: ["buildtrack", options.tag] }),
      signal: timeout(),
    })
    const body = await response.text()
    return response.ok ? { ok: true, status: response.status, detail: "Accepted by the mail provider" } : { ok: false, status: response.status, detail: `HTTP ${response.status}: ${sanitizeProviderText(body, [apiKey])}` }
  } catch (error) {
    return { ok: false, status: null, detail: `Could not reach the mail provider: ${sanitizeProviderText((error as Error)?.message ?? "network error", [apiKey])}` }
  }
}
