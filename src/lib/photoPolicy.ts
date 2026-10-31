import { useCallback, useEffect, useState } from "react"
import { supabase } from "./supabase"
import { useAuth } from "./auth"
import { fetchAll } from "./paging"
import { sitePhotoProblem, type PhotoStamp, type ProjectSite } from "./photoStamp"
import { cameraOnlyFor, fieldUploads, type PhotoRule } from "./photoPolicyModel"

// The company switch `photos.allow_device_upload` (20261031120532), the signed-in person's own choice (20261031123546) and the
// project's site location. Mounted pages refresh each minute and on focus, visibility and reconnection. Cached/in-flight
// reads are shared by the photo buttons. The database enforces the rule; this picks the buttons and warns early.
const CACHE_KEY = "buildtrack.photoUploads"
const TTL = 60_000
type Policy = { company: boolean | null; rule: PhotoRule | null }
let policy: { at: number; userId: string; pending: boolean; value: Promise<Policy> } | null = null
const sites = new Map<string, { at: number; pending: boolean; value: Promise<ProjectSite | null> }>()

// The last policy seen on this device for this person (used offline).
const remembered = (userId: string | undefined): Policy => {
  if (!userId) return { company: null, rule: null }
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as (Policy & { userId?: string }) | null
    if (saved && saved.userId === userId) return { company: typeof saved.company === "boolean" ? saved.company : null, rule: saved.rule === "allow" || saved.rule === "camera_only" ? saved.rule : null }
  } catch { /* storage unavailable or old format */ }
  return { company: null, rule: null }
}

function loadPolicy(userId: string, force = false): Promise<Policy> {
  if (policy && policy.userId === userId && Date.now() - policy.at < TTL && (policy.pending || !force)) return policy.value
  const value: Promise<Policy> = Promise.resolve().then(async () => {
    const [setting, own] = await Promise.all([
      supabase.from("system_settings").select("value").eq("key", "photos.allow_device_upload").maybeSingle(),
      supabase.from("photo_upload_overrides").select("mode").eq("user_id", userId).maybeSingle(),
    ])
    if (setting.error || own.error) throw new Error("Photo policy unavailable")
    const result: Policy = { company: setting.data?.value !== false, rule: (own.data?.mode as PhotoRule | undefined) ?? null }
    try { if (policy === entry) localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, ...result })) } catch { /* storage unavailable */ }
    return result
  }).catch(() => {
    if (policy === entry) policy = null
    return remembered(userId)
  }).finally(() => { entry.pending = false })
  const entry = { at: Date.now(), userId, pending: true, value }
  policy = entry
  return value
}

// null = could not be read (offline): the database decides when the photo is sent.
function loadSite(projectId: string, force = false): Promise<ProjectSite | null> {
  const hit = sites.get(projectId)
  if (hit && Date.now() - hit.at < TTL && (hit.pending || !force)) return hit.value
  const value: Promise<ProjectSite | null> = Promise.resolve().then(async () => {
    const { data, error } = await supabase.from("projects").select("site_lat,site_lng,site_radius_m").eq("id", projectId).maybeSingle()
    if (error || !data) throw new Error("Project site unavailable")
    return { lat: data.site_lat === null ? null : Number(data.site_lat), lng: data.site_lng === null ? null : Number(data.site_lng), radius_m: Number(data.site_radius_m) }
  }).catch(() => {
    if (sites.get(projectId) === entry) sites.delete(projectId)
    return null
  }).finally(() => { entry.pending = false })
  const entry = { at: Date.now(), pending: true, value }
  sites.set(projectId, entry)
  return value
}

// allowUpload (daily report, work item / correction photos): true = offer "Upload", false = in-app camera at the site only,
// null = not known yet (upload hidden). qaCameraOnly: the same for QA / NCR evidence photos (depends on the role).
export function usePhotoPolicy(projectId: string | null | undefined) {
  const { profile } = useAuth()
  const userId = profile?.id
  const projectKey = projectId ?? null
  const [snapshot, setSnapshot] = useState<{ userId: string | undefined; projectId: string | null; value: Policy; site: ProjectSite | null }>(() => ({ userId, projectId: projectKey, value: remembered(userId), site: null }))
  useEffect(() => {
    let live = true
    let request = 0
    if (!userId) return
    const reload = async (force = false) => {
      const run = ++request
      const [value, site] = await Promise.all([loadPolicy(userId, force), projectKey ? loadSite(projectKey, force) : Promise.resolve(null)])
      if (live && run === request) setSnapshot({ userId, projectId: projectKey, value, site })
    }
    const resume = () => { if (!document.hidden) void reload(true) }
    void reload()
    const timer = window.setInterval(() => { if (!document.hidden) void reload() }, TTL)
    window.addEventListener("focus", resume)
    window.addEventListener("online", resume)
    document.addEventListener("visibilitychange", resume)
    return () => {
      live = false
      window.clearInterval(timer)
      window.removeEventListener("focus", resume)
      window.removeEventListener("online", resume)
      document.removeEventListener("visibilitychange", resume)
    }
  }, [userId, projectKey])
  const state = snapshot.userId === userId ? snapshot.value : remembered(userId)
  const site = snapshot.userId === userId && snapshot.projectId === projectKey ? snapshot.site : null
  const cameraOnly = cameraOnlyFor("field", state.company, state.rule, profile?.role)
  const qaCameraOnly = cameraOnlyFor("qa", state.company, state.rule, profile?.role)
  return {
    allowUpload: fieldUploads(state.company, state.rule),
    cameraOnly,
    qaCameraOnly,
    problem: (stamp: PhotoStamp) => ((cameraOnly || qaCameraOnly) && site ? sitePhotoProblem(stamp, site) : ""),
  }
}

// ---------- System settings > Site photos: per-account choices ----------
export type PhotoAccount = { user_id: string; full_name: string | null; email: string; role: "foreman" | "engineer"; mode: PhotoRule | null; updated_at: string | null }

// Active Foremen and Engineers with their choice. Admins with photos.manage or users.view only (checked by the database).
export function usePhotoAccounts(enabled: boolean) {
  const [accounts, setAccounts] = useState<PhotoAccount[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState("")
  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    const { data, error: failed } = await fetchAll<PhotoAccount>((from, to) => supabase.rpc("get_photo_upload_accounts").range(from, to))
    setError(failed ? "Could not load the accounts. Check your connection and try again." : "")
    setAccounts(data)
    setLoading(false)
  }, [enabled])
  useEffect(() => { void reload() }, [reload])
  return { accounts, loading, error, reload }
}

// mode null = follow the company setting. Returns an error message, or "".
export async function setPhotoRule(userId: string, mode: PhotoRule | null): Promise<string> {
  const { error } = await supabase.rpc("set_photo_upload_rule", { p_user: userId, p_mode: mode })
  if (!error) {
    policy = null
    return ""
  }
  return /Site photos permission/i.test(error.message) ? "You need the Site photos permission (and the authenticator check) to change photo rules." : error.message
}
