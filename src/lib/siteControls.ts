import { supabase } from "./supabase"
import { parseForcePreview, type AudienceRole, type ForceLogoutPreview } from "./siteStatusModel"

// Calls of the Site controls screen. The database functions decide who may do what (Super Admin with the authenticator); nothing is enforced here.
export type SiteOutcome<T> = { data: T; error: ""; setup: false } | { data: null; error: string; setup: boolean }

export function siteError(error: { message?: string; code?: string } | null | undefined): { error: string; setup: boolean } {
  const message = error?.message ?? ""
  if (error?.code === "PGRST202" || error?.code === "42883" || /could not find the function|does not exist/i.test(message)) return { error: "Site controls are not installed on the database yet (migration 20261101150000_site_controls). The owner reviews and runs it first.", setup: true }
  if (/Only a Super Admin|permission denied/i.test(message)) return { error: "Only a Super Admin signed in with the authenticator app can use the site controls.", setup: false }
  if (/fetch|network/i.test(message)) return { error: "Network problem. Check your connection and try again.", setup: false }
  return { error: message || "That did not work. Try again.", setup: false } // the database messages are written to be read
}
const failure = <T,>(error: { message?: string; code?: string }): SiteOutcome<T> => ({ data: null, ...siteError(error) })

export type MaintenanceState = { on: boolean; message: string; returns_at: string | null; updated_at: string | null; updated_by: string | null }
export type FeatureState = { feature: string; label: string; locked: boolean; audiences: AudienceRole[]; message: string; updated_at: string | null }
export type SiteControls = { maintenance: MaintenanceState; features: FeatureState[]; last_forced_logout: null | { at: string; by: string | null; details: { accounts?: number; roles?: string[]; reason?: string } } }

export async function loadSiteControls(): Promise<SiteOutcome<SiteControls>> {
  const { data, error } = await supabase.rpc("get_site_controls")
  return error ? failure(error) : { data: data as SiteControls, error: "", setup: false }
}

export async function saveMaintenance(input: { on: boolean; message: string; returnsAt: string | null }): Promise<SiteOutcome<{ changed: boolean; on: boolean }>> {
  const { data, error } = await supabase.rpc("set_maintenance", { p_on: input.on, p_message: input.message.trim(), p_returns_at: input.returnsAt })
  return error ? failure(error) : { data: data as { changed: boolean; on: boolean }, error: "", setup: false }
}

export async function saveFeatureLock(input: { feature: string; locked: boolean; audiences: AudienceRole[]; message: string }): Promise<SiteOutcome<{ changed: boolean; locked: boolean }>> {
  const { data, error } = await supabase.rpc("set_feature_lock", { p_feature: input.feature, p_locked: input.locked, p_audiences: input.audiences, p_message: input.message.trim() })
  return error ? failure(error) : { data: data as { changed: boolean; locked: boolean }, error: "", setup: false }
}

export async function previewForceLogout(roles: AudienceRole[], project: string | null): Promise<SiteOutcome<ForceLogoutPreview>> {
  const { data, error } = await supabase.rpc("preview_force_logout", { p_roles: roles, p_project: project })
  if (error) return failure(error)
  const preview = parseForcePreview(data)
  return preview ? { data: preview, error: "", setup: false } : { data: null, error: "The preview could not be read. Try again.", setup: false }
}

export async function forceLogout(input: { roles: AudienceRole[]; project: string | null; expected: number; confirm: string; reason: string }): Promise<SiteOutcome<{ accounts: number; sessions_removed: number }>> {
  const { data, error } = await supabase.rpc("force_logout", { p_roles: input.roles, p_project: input.project, p_expected: input.expected, p_confirm: input.confirm, p_reason: input.reason.replace(/\s+/g, " ").trim() })
  return error ? failure(error) : { data: data as { accounts: number; sessions_removed: number }, error: "", setup: false }
}
