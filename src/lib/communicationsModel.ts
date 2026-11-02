// Pure rules for the Communications hub (no network, no React). The database enforces the same limits again (send_admin_message); these checks only
// give the sender a clear answer before anything is sent.
import { safeInAppLink } from "./notificationModel.ts"

export type Channel = "app" | "email" | "both"
export const channels: Array<{ value: Channel; label: string; help: string }> = [
  { value: "app", label: "In the app", help: "Shows in each person's bell." },
  { value: "email", label: "Email only", help: "Sent by email to people who accept announcement emails." },
  { value: "both", label: "In the app and by email", help: "The bell message, plus an email to people who accept announcement emails." },
]
export const channelLabel = (channel: string) => channels.find((entry) => entry.value === channel)?.label ?? channel

export const TITLE_MAX = 120
export const BODY_MAX = 500
export const PER_SEND = 200
export const PER_SEND_SUPER = 500
export const capFor = (isSuper: boolean) => (isSuper ? PER_SEND_SUPER : PER_SEND)

export type Recipient = { id: string; full_name: string | null; email: string; role: string | null; company: string | null }
export const recipientName = (recipient: Pick<Recipient, "full_name" | "email">) => recipient.full_name?.trim() || recipient.email

// Adds people to the chosen list without duplicates and never beyond the limit; says how many were new and how many did not fit.
export function addRecipients(current: Recipient[], incoming: Recipient[], cap: number): { list: Recipient[]; added: number; overLimit: number } {
  const list = [...current]
  const known = new Set(list.map((recipient) => recipient.id))
  let added = 0
  let overLimit = 0
  for (const recipient of incoming) {
    if (known.has(recipient.id)) continue
    if (list.length >= cap) {
      overLimit++
      continue
    }
    known.add(recipient.id)
    list.push(recipient)
    added++
  }
  return { list, added, overLimit }
}

export type MessageDraft = { title: string; body: string; link: string; channel: string; count: number; isSuper: boolean }

export function validateMessage(draft: MessageDraft): string | null {
  const title = draft.title.trim()
  const body = draft.body.trim()
  if (!draft.count) return "Choose at least one person."
  if (draft.count > capFor(draft.isSuper)) return `You can send to at most ${capFor(draft.isSuper)} people at once.`
  if (!channels.some((entry) => entry.value === draft.channel)) return "Choose how to send the message."
  if (!title) return "Write a title."
  if (title.length > TITLE_MAX) return `The title can be at most ${TITLE_MAX} characters.`
  if (!body) return "Write the message."
  if (body.length > BODY_MAX) return `The message can be at most ${BODY_MAX} characters.`
  if (draft.link.trim() && !safeInAppLink(draft.link.trim())) return "The link must be a page inside BuildTrack, for example /engineer/dashboard."
  return null
}

export type AudiencePreview = { requested: number; eligible: number; not_eligible: number; will_email: number; opted_out: number; by_role: Record<string, number>; sample: string[] }

export function parsePreview(value: unknown): AudiencePreview | null {
  if (value === null || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const number = (key: string) => (typeof row[key] === "number" && Number.isFinite(row[key]) ? (row[key] as number) : null)
  const requested = number("requested"), eligible = number("eligible"), notEligible = number("not_eligible"), willEmail = number("will_email"), optedOut = number("opted_out")
  if (requested === null || eligible === null || notEligible === null || willEmail === null || optedOut === null) return null
  const byRole = row.by_role && typeof row.by_role === "object" ? Object.fromEntries(Object.entries(row.by_role as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number")) : {}
  const sample = Array.isArray(row.sample) ? row.sample.filter((name): name is string => typeof name === "string") : []
  return { requested, eligible, not_eligible: notEligible, will_email: willEmail, opted_out: optedOut, by_role: byRole, sample }
}

const plural = (count: number, one: string, many = one + "s") => `${count} ${count === 1 ? one : many}`

// The plain-language lines of the confirmation step.
export function previewLines(preview: AudiencePreview, channel: string): string[] {
  const lines = [`${plural(preview.eligible, "person", "people")} will receive this message.`]
  if (preview.not_eligible > 0) lines.push(`${plural(preview.not_eligible, "chosen account")} cannot receive it (not active) and will be left out.`)
  if (channel !== "app") {
    lines.push(`${plural(preview.will_email, "email")} will be queued for sending.`)
    if (preview.opted_out > 0) {
      const who = `${plural(preview.opted_out, "person", "people")} will get no email (they switched announcement emails off or have no address)`
      lines.push(channel === "email" ? `${who}, so they receive nothing.` : `${who}, but still get the bell message.`)
    }
  }
  return lines
}

export type BatchRow = {
  id: string
  created_at: string
  sender_name: string | null
  title: string
  channel: string
  requested_count: number
  delivered_count: number
  skipped_count: number
  email_sent: number
  email_failed: number
  email_skipped: number
  email_waiting: number
}

export function outcomeSummary(batch: BatchRow): string {
  const people = `${batch.delivered_count} of ${plural(batch.requested_count, "person", "people")}`
  if (batch.channel === "app") return `${people} in the app`
  return `${people}; email: ${batch.email_sent} sent, ${batch.email_waiting} waiting, ${batch.email_skipped} skipped, ${batch.email_failed} failed`
}

// The hub needs the 20261101090000 migration. Without it the database answers that the function does not exist; the page then shows a setup message.
export function isMissingFunction(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? "")
}

export function friendlyMessageError(error: { message?: string; code?: string } | null | undefined): string {
  const message = error?.message ?? ""
  if (isMissingFunction(error)) return "The communications update is not installed on the database yet. The owner needs to run migration 20261101090000_admin_communications."
  if (/permission denied|Missing permission|Only a Super Admin|row-level security/i.test(message)) return "You do not have permission to do that, or your Admin sign-in is not verified with the authenticator app."
  if (/fetch|network/i.test(message)) return "Network problem. Check your connection and try again."
  return message || "That did not work. Try again."
}
