import { siteError, type SiteOutcome } from "./siteControls"
import { supabase } from "./supabase"
import type { ActivityRow, EmailDelivery, LockoutWatch, LogRow, WindowRow } from "./systemControlModel"

// Calls of the System Control page. The database functions decide who may do what (Super Admin with the authenticator); nothing is enforced here.
const failure = <T,>(error: { message?: string; code?: string }): SiteOutcome<T> => {
  const known = siteError(error)
  const missing = /could not find the function|does not exist/i.test(error.message ?? "") || error.code === "PGRST202" || error.code === "42883"
  return { data: null, error: missing ? "System Control is not installed on the database yet (migration 20261102100000_system_control)." : known.error, setup: missing || known.setup }
}
const ok = <T,>(data: T): SiteOutcome<T> => ({ data, error: "", setup: false })

export type SwitchKey = "registration_closed" | "email_paused"
export type SwitchState = { enabled: boolean; message: string; updated_at: string | null; updated_by: string | null }
export type Switches = Partial<Record<SwitchKey, SwitchState>>

export async function loadSwitches(): Promise<SiteOutcome<Switches>> {
  const { data, error } = await supabase.rpc("get_system_switches")
  return error ? failure(error) : ok((data ?? {}) as Switches)
}
export async function saveSwitch(key: SwitchKey, enabled: boolean, message: string): Promise<SiteOutcome<{ changed: boolean; enabled: boolean }>> {
  const { data, error } = await supabase.rpc("set_system_switch", { p_key: key, p_enabled: enabled, p_message: message })
  return error ? failure(error) : ok(data as { changed: boolean; enabled: boolean })
}
export type EmergencyResult = { maintenance: boolean; features: string[]; switches: string[] }
export async function emergencyOff(): Promise<SiteOutcome<EmergencyResult>> {
  const { data, error } = await supabase.rpc("site_emergency_off")
  return error ? failure(error) : ok(data as EmergencyResult)
}
// Anyone may ask this before registering (it returns only closed / not closed and the message).
export async function loadRegistrationStatus(): Promise<{ closed: boolean; message: string }> {
  const { data, error } = await supabase.rpc("get_registration_status")
  const value = (data ?? {}) as { closed?: boolean; message?: string }
  return error ? { closed: false, message: "" } : { closed: Boolean(value.closed), message: typeof value.message === "string" ? value.message : "" }
}
export async function loadEmailDelivery(): Promise<SiteOutcome<EmailDelivery>> {
  const { data, error } = await supabase.rpc("get_email_delivery", { p_limit: 40 })
  return error ? failure(error) : ok(data as EmailDelivery)
}
export type Capacity = { database_bytes: number; buckets: Array<{ bucket: string; files: number; bytes: number }> }
export async function loadCapacity(): Promise<SiteOutcome<Capacity>> {
  const { data, error } = await supabase.rpc("get_storage_capacity")
  return error ? failure(error) : ok(data as Capacity)
}
export async function loadActivity(offset: number): Promise<SiteOutcome<ActivityRow[]>> {
  const { data, error } = await supabase.rpc("get_system_activity", { p_limit: 50, p_offset: offset })
  return error ? failure(error) : ok((data ?? []) as ActivityRow[])
}

export type Windows = { scheduler_ready: boolean; windows: WindowRow[] }
export async function loadWindows(): Promise<SiteOutcome<Windows>> {
  const { data, error } = await supabase.rpc("get_maintenance_windows")
  return error ? failure(error) : ok(data as Windows)
}
export async function scheduleWindow(input: { startsAt: string; endsAt: string; message: string }): Promise<SiteOutcome<{ id: string }>> {
  const { data, error } = await supabase.rpc("schedule_maintenance", { p_starts: input.startsAt, p_ends: input.endsAt, p_message: input.message })
  return error ? failure(error) : ok(data as { id: string })
}
export async function cancelWindow(id: string): Promise<SiteOutcome<{ result: string }>> {
  const { data, error } = await supabase.rpc("cancel_maintenance_window", { p_id: id })
  return error ? failure(error) : ok(data as { result: string })
}
export async function loadLockouts(): Promise<SiteOutcome<LockoutWatch>> {
  const { data, error } = await supabase.rpc("get_lockout_watch")
  return error ? failure(error) : ok(data as LockoutWatch)
}

export type LogQuery = { category: string; search: string; from: string; to: string; offset: number }
export async function loadSystemLog(query: LogQuery): Promise<SiteOutcome<LogRow[]>> {
  const { data, error } = await supabase.rpc("get_system_log", {
    p_category: query.category || null,
    p_search: query.search.trim() || null,
    p_from: query.from || null,
    p_to: query.to || null,
    p_limit: 50,
    p_offset: query.offset,
  })
  return error ? failure(error) : ok((data ?? []) as LogRow[])
}
