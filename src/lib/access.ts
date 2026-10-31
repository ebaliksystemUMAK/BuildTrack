import { useCallback, useEffect, useState } from "react"
import type { Discipline } from "./projects"
import { supabase } from "./supabase"

export type RequestedRole = "engineer" | "foreman" | "client"
// Roles an Admin may give when approving a registration (admin-users "approve"); Project Manager is given by an Admin only,
// it is never requested. Admin roles stay with the Super Admin and are not offered here.
export const approvalRoles = ["engineer", "foreman", "client", "project_manager"] as const
export type ApprovalRole = (typeof approvalRoles)[number]
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled"

export type AccessRequest = {
  id: string
  user_id: string
  requested_role: RequestedRole
  discipline: Discipline | null
  message: string | null
  status: RequestStatus
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

export const requestableRoles: Array<{ key: RequestedRole; label: string; description: string }> = [
  { key: "engineer", label: "Engineer", description: "Upload plans, place pins, inspect and verify the foreman's work." },
  { key: "foreman", label: "Foreman", description: "Report daily progress, add photos and notes on pins." },
  { key: "client", label: "Client", description: "Follow your project's plans and progress (read-only)." },
]

export const requestStatusLabel: Record<RequestStatus, string> = {
  pending: "Waiting for review",
  approved: "Approved",
  rejected: "Not approved",
  cancelled: "Cancelled",
}

export const requestStatusChip: Record<RequestStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  approved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  cancelled: "bg-gray-200 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200",
}

export function requestError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "You already have a request waiting for review."
  if (/basic account/i.test(error.message)) return "Only basic accounts can request elevated access."
  if (error.code === "42501" || /row-level security/i.test(error.message)) return "You are not allowed to do that."
  if (/network|fetch/i.test(error.message)) return "Network problem. Check your connection and try again."
  return error.message
}

// The signed-in user's own requests, newest first.
export function useMyRequests(enabled = true) {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState("")

  const reload = useCallback(async () => {
    if (!enabled) return
    const { data, error: loadError } = await supabase.from("access_requests").select("*").order("created_at", { ascending: false })
    setError(loadError ? "Could not load your requests. Check your connection and try again." : "")
    setRequests((data as AccessRequest[] | null) ?? [])
    setLoading(false)
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  return { requests, loading, error, reload }
}
