import { useCallback, useEffect, useRef, useState } from "react"
import type { AppRole } from "./auth"
import type { ProjectMember } from "./projects"
import type { ConcernCategory, ManagerSlot, ProjectManagerRow } from "./projectManagerModel"
import { usePeriodicReload } from "./realtime"
import { supabase } from "./supabase"

// Data of the Project Manager workspace (20261029100000). Every call is re-checked by the database: a Project Manager only
// reaches the projects an Admin assigned to them, and Admins with the Projects permission reach every project.

const friendly = (error: { message: string } | null, fallback: string) =>
  !error ? fallback : /fetch|network/i.test(error.message) ? "Network problem. Check your connection and try again." : error.message

// One generation-guarded loader so a late answer for a previous project never shows on the current one.
function useLoader<T>(key: string | null, load: () => Promise<{ data: T; error: string }>, empty: T) {
  const generation = useRef(0)
  const [state, setState] = useState<{ key: string | null; data: T; error: string; loading: boolean }>({ key: null, data: empty, error: "", loading: Boolean(key) })
  const reload = useCallback(async () => {
    const run = ++generation.current
    if (!key) {
      setState({ key, data: empty, error: "", loading: false })
      return
    }
    const result = await load().catch(() => ({ data: empty, error: "Could not load. Check your connection and try again." }))
    if (run === generation.current) setState({ key, data: result.data, error: result.error, loading: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    void reload()
    return () => { generation.current++ }
  }, [reload])
  const current = state.key === key
  return { data: current ? state.data : empty, error: current ? state.error : "", loading: Boolean(key) && (!current || state.loading), reload }
}

// The Project Managers of one project, or (projectId "all") of every project the caller manages or administers.
export function useProjectManagers(projectId: string | null | "all") {
  const result = useLoader<ProjectManagerRow[]>(projectId, async () => {
    const { data, error } = await supabase.rpc("get_project_managers", { p_project: projectId === "all" ? null : projectId })
    return { data: (data ?? []) as ProjectManagerRow[], error: error ? "Could not load the Project Managers." : "" }
  }, [])
  usePeriodicReload(projectId ? `managers:${projectId}` : null, () => void result.reload(), 60000)
  return { managers: result.data, loading: result.loading, error: result.error, reload: result.reload }
}

export async function assignProjectManager(projectId: string, userId: string, slot: ManagerSlot): Promise<string> {
  const { data, error } = await supabase.rpc("assign_project_manager", { p_project: projectId, p_user: userId, p_designation: slot })
  if (error) throw new Error(friendly(error, "Not saved"))
  return String(data)
}

export async function removeProjectManager(projectId: string, userId: string) {
  const { error } = await supabase.rpc("remove_project_manager", { p_project: projectId, p_user: userId })
  if (error) throw new Error(friendly(error, "Not removed"))
}

export async function setProjectArchived(projectId: string, archived: boolean) {
  const { error } = await supabase.rpc("set_project_archived", { p_project: projectId, p_archived: archived })
  if (error) throw new Error(friendly(error, "Not changed"))
}

// Active Engineers, Foremen and Clients the caller may add to this project (names, emails and roles only).
export type AssignablePerson = { id: string; full_name: string | null; email: string; role: AppRole; discipline: string | null }
export function useAssignablePeople(projectId: string | null) {
  const result = useLoader<AssignablePerson[]>(projectId, async () => {
    const { data, error } = await supabase.rpc("get_assignable_people", { p_project: projectId })
    return { data: (data ?? []) as AssignablePerson[], error: error ? "Could not load the people you can add." : "" }
  }, [])
  return { people: result.data, loading: result.loading, error: result.error, reload: result.reload }
}

// Team rows of one project (who is on it and in which role).
export function useProjectMembers(projectId: string | null) {
  const result = useLoader<ProjectMember[]>(projectId, async () => {
    const { data, error } = await supabase.from("project_members").select("project_id, user_id, member_role").eq("project_id", projectId as string)
    return { data: (data ?? []) as ProjectMember[], error: error ? "Could not load the project team." : "" }
  }, [])
  usePeriodicReload(projectId ? `members:${projectId}` : null, () => void result.reload(), 30000)
  return { members: result.data, loading: result.loading, error: result.error, reload: result.reload }
}

export async function assignWorkItem(pinId: string, foremanId: string | null, expectedUpdatedAt: string | null) {
  const { data, error } = await supabase.rpc("assign_work_item", { p_pin: pinId, p_foreman: foremanId, p_expected: expectedUpdatedAt })
  if (error) throw new Error(friendly(error, "Not assigned"))
  return data
}

export type AuditEntry = { id: number; created_at: string; actor_name: string; actor_role: AppRole | null; action: string; subject: string | null; total: number }
export function useProjectAudit(projectId: string | null, search: string, page: number, size = 50) {
  const key = projectId ? `${projectId}|${search}|${page}|${size}` : null
  const result = useLoader<AuditEntry[]>(key, async () => {
    const { data, error } = await supabase.rpc("get_project_audit_log", { p_project: projectId, p_search: search.trim() || null, p_limit: size, p_offset: page * size })
    return { data: (data ?? []) as AuditEntry[], error: error ? friendly(error, "Could not load the history.") : "" }
  }, [])
  return { entries: result.data, total: Number(result.data[0]?.total ?? 0), loading: result.loading, error: result.error, reload: result.reload }
}

export type AttendanceConcern = {
  id: string
  project_id: string
  work_date: string
  worker_id: string | null
  category: ConcernCategory
  note: string
  status: "open" | "resolved"
  raised_by: string
  created_at: string
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
}
export function useAttendanceConcerns(projectId: string | null) {
  const result = useLoader<AttendanceConcern[]>(projectId, async () => {
    const { data, error } = await supabase.from("attendance_concerns").select("*").eq("project_id", projectId as string).order("work_date", { ascending: false }).order("created_at", { ascending: false }).limit(200)
    return { data: (data ?? []) as AttendanceConcern[], error: error ? "Could not load the attendance concerns." : "" }
  }, [])
  usePeriodicReload(projectId ? `concerns:${projectId}` : null, () => void result.reload(), 60000)
  return { concerns: result.data, loading: result.loading, error: result.error, reload: result.reload }
}

export async function flagAttendanceConcern(input: { projectId: string; day: string; workerId: string | null; category: ConcernCategory; note: string }) {
  const { error } = await supabase.rpc("flag_attendance_concern", { p_project: input.projectId, p_day: input.day, p_worker: input.workerId, p_category: input.category, p_note: input.note.trim() })
  if (error) throw new Error(friendly(error, "Not flagged"))
}

export async function resolveAttendanceConcern(id: string, note: string) {
  const { error } = await supabase.rpc("resolve_attendance_concern", { p_id: id, p_note: note.trim() || null })
  if (error) throw new Error(friendly(error, "Not resolved"))
}
