import { supabase } from "./supabase"
import { friendlyMessageError, isMissingFunction, parsePreview, type AudiencePreview, type BatchRow, type Channel, type Recipient } from "./communicationsModel"
import type { Announcement } from "./announcementModel"

// Calls of the Communications hub and the announcement banner settings. Authorization is decided by the database functions, not here.
export type Outcome<T> = { data: T; error: ""; setup: false } | { data: null; error: string; setup: boolean }
const failure = <T,>(error: { message?: string; code?: string }): Outcome<T> => ({ data: null, error: friendlyMessageError(error), setup: isMissingFunction(error) })

export async function searchRecipients(query: string, roles: string[] | null, limit: number): Promise<Outcome<Recipient[]>> {
  const { data, error } = await supabase.rpc("search_message_recipients", { p_query: query.trim() || null, p_roles: roles, p_limit: limit })
  return error ? failure(error) : { data: (data as Recipient[] | null) ?? [], error: "", setup: false }
}

export async function previewAudience(ids: string[], channel: Channel): Promise<Outcome<AudiencePreview>> {
  const { data, error } = await supabase.rpc("preview_message_audience", { p_recipients: ids, p_channel: channel })
  if (error) return failure(error)
  const preview = parsePreview(data)
  return preview ? { data: preview, error: "", setup: false } : { data: null, error: "The preview could not be read. Try again.", setup: false }
}

export type SendResult = { batch_id: string; duplicate: boolean; delivered: number; skipped: number }

export async function sendMessage(input: { batch: string; ids: string[]; title: string; body: string; channel: Channel; link: string }): Promise<Outcome<SendResult>> {
  const { data, error } = await supabase.rpc("send_admin_message", { p_batch: input.batch, p_recipients: input.ids, p_title: input.title.trim(), p_body: input.body.trim(), p_channel: input.channel, p_link: input.link.trim() || null })
  return error ? failure(error) : { data: data as SendResult, error: "", setup: false }
}

export async function listBatches(limit = 20): Promise<Outcome<BatchRow[]>> {
  const { data, error } = await supabase.rpc("get_message_batches", { p_limit: limit })
  return error ? failure(error) : { data: (data as BatchRow[] | null) ?? [], error: "", setup: false }
}

export type AnnouncementSettings = Announcement & { enabled: boolean; updated_at: string; updated_by_name: string | null }

export async function loadAnnouncementSettings(): Promise<Outcome<AnnouncementSettings | null>> {
  const { data, error } = await supabase.rpc("get_announcement_settings")
  if (error) return failure(error)
  const row = (Array.isArray(data) ? data[0] : data) as AnnouncementSettings | undefined
  return { data: row ?? null, error: "", setup: false }
}

export async function saveAnnouncement(input: { title: string; message: string; tone: string; enabled: boolean }): Promise<Outcome<number>> {
  const { data, error } = await supabase.rpc("set_announcement", { p_title: input.title.trim(), p_message: input.message.trim(), p_tone: input.tone, p_enabled: input.enabled })
  return error ? failure(error) : { data: Number(data), error: "", setup: false }
}
