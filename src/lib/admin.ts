import { useCallback, useEffect, useState } from "react"
import type { AppRole } from "./auth"
import { supabase } from "./supabase"

export type ActivityRow = {
  id: number
  created_at: string
  actor_name: string
  actor_role: AppRole | null
  action: string
  subject: string | null
}

const actionLabels: Record<string, string> = {
  "projects.insert": "Created project",
  "projects.update": "Updated project",
  "projects.delete": "Deleted project",
  "project_members.insert": "Added to project",
  "project_members.update": "Changed team member",
  "project_members.delete": "Removed from project",
  "project_blueprint_access.insert": "Gave blueprint access",
  "project_blueprint_access.update": "Changed blueprint access",
  "project_blueprint_access.delete": "Removed blueprint access",
  "user.create": "Created user",
  "user.update": "Edited user",
  "user.promote_admin": "Promoted user to Admin",
  "user.approve": "Approved user",
  "user.reject": "Rejected user",
  "user.reopen": "Reconsidered a rejected registration",
  "profile.status_changed": "Account status changed",
  "profile.role_changed": "Account role changed",
  "oauth.enroll": "Registered with Google",
  "oauth.blocked": "Google login blocked (no account)",
  "registration.submitted": "Registration sent",
  "whitelist.apply": "Pre-approved by the whitelist",
  "whitelist.add": "Added emails to the whitelist",
  "whitelist.remove": "Removed an email from the whitelist",
  "access.approve": "Approved an access request",
  "access.reject": "Declined an access request",
  "user.enable": "Enabled user",
  "user.disable": "Disabled user",
  "user.impersonate": "Logged in as user",
  "user.set_permissions": "Changed permissions",
  "settings.update": "Changed a system setting",
  "project.export": "Exported a project backup",
  "invite.create": "Created invitation code",
  "invite.disable": "Disabled invitation code",
  "invite.enable": "Enabled invitation code",
  "invite.redeem": "Joined with a code",
  "privacy.erasure_requested": "Asked to delete their data",
  "privacy.erasure_withdrawn": "Withdrew a data deletion request",
  "privacy.erasure_declined": "Declined a data deletion request",
  "privacy.erased": "Erased a person's data",
  "privacy.erase_files": "Deleted a person's files",
}

export const activityLabel = (action: string) => actionLabels[action] ?? action

export const roleLabel: Record<AppRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  engineer: "Engineer",
  foreman: "Foreman",
  client: "Client",
  user: "Basic user",
}

const manila = { timeZone: "Asia/Manila" } as const
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-PH", { ...manila, year: "numeric", month: "short", day: "numeric" })
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { ...manila, hour: "2-digit", minute: "2-digit" })

// Recent activity (optionally for one project). The database returns rows only to admins who may see them.
export function useActivity(projectId: string | null = null, limit = 15) {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc("get_activity", { pid: projectId, lim: limit })
    setError(loadError ? "Could not load recent activity." : "")
    setRows((data as ActivityRow[] | null) ?? [])
    setLoading(false)
  }, [projectId, limit])

  useEffect(() => {
    void reload()
  }, [reload])

  return { rows, loading, error, reload }
}

export type UserStats = { engineers: number; foremen: number; clients: number; pending: number }

// Head-only counts. Only call this for admins with users.view: without it Row Level Security would
// return 0 (not an error), which would look like real data.
export function useUserStats(enabled: boolean) {
  const [stats, setStats] = useState<UserStats | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setStats(null)
      return
    }
    let active = true
    const requestsWaiting = async () => {
      const { count, error: countError } = await supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      if (countError) throw countError
      return count ?? 0
    }
    const countOf = async (role: AppRole | null, status: string) => {
      let query = supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", status)
      if (role) query = query.eq("role", role)
      const { count, error: countError } = await query
      if (countError) throw countError
      return count ?? 0
    }
    Promise.all([
      countOf("engineer", "active"),
      countOf("foreman", "active"),
      countOf("client", "active"),
      requestsWaiting(),
    ])
      .then(([engineers, foremen, clients, pending]) => {
        if (active) setStats({ engineers, foremen, clients, pending })
      })
      .catch(() => active && setError(true))
    return () => {
      active = false
    }
  }, [enabled])

  return { stats, error }
}

// Separate counts for the dashboard "needs your decision" band (registrations, ID checks).
export function useDecisionCounts(enabled: boolean) {
  const [counts, setCounts] = useState<{ registrations: number; ids: number; erasures: number } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let active = true
    void (async () => {
      const [pending, ids, erase] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending").not("registration_completed_at", "is", null),
        supabase.from("identity_verifications").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        supabase.from("data_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
      ])
      if (active) setCounts({ registrations: pending.count ?? 0, ids: ids.count ?? 0, erasures: erase.count ?? 0 })
    })()
    return () => {
      active = false
    }
  }, [enabled])
  return counts
}

// How many registrations and ID checks wait for a decision (shown as a badge on User Management). Only admins who may approve get a number.
export function useReviewCount(enabled: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let active = true
    const load = async () => {
      const [pending, ids, erase] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending").not("registration_completed_at", "is", null),
        supabase.from("identity_verifications").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        supabase.from("data_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
      ])
      if (active) setCount((pending.count ?? 0) + (ids.count ?? 0) + (erase.count ?? 0))
    }
    void load()
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [enabled])
  return count
}
