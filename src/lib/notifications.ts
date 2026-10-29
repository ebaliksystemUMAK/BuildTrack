import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"
import { useLiveReload } from "./realtime"

export type AppNotification = {
  id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  project_id: string | null
  entity_id: string | null
  created_at: string
  read_at: string | null
}

const POLL_MS = 60_000
const REMINDER_KEY = "buildtrack.reminders"
const REMINDER_EVERY_MS = 30 * 60_000

// Deadline reminders are created by the database on request; ask at most every 30 minutes per browser session.
async function refreshReminders() {
  try {
    const last = Number(sessionStorage.getItem(REMINDER_KEY) ?? 0)
    if (Date.now() - last < REMINDER_EVERY_MS) return
    sessionStorage.setItem(REMINDER_KEY, String(Date.now()))
  } catch {
    // sessionStorage unavailable: ask every time, the database de-duplicates by day.
  }
  await supabase.rpc("generate_due_notifications")
  await supabase.rpc("generate_defect_reminders")
  await supabase.rpc("generate_escalations") // engineers: late-work digest; admins and Project Managers: serious cases only (0038)
  await supabase.rpc("generate_inspection_reminders")
}

// The signed-in user's latest notifications. Polls once a minute while the tab is visible and again on focus.
export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("id,kind,title,body,link,project_id,entity_id,created_at,read_at")
      .order("created_at", { ascending: false })
      .limit(50)
    if (!alive.current) return
    setFailed(Boolean(error))
    if (!error) setItems((data as AppNotification[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    alive.current = true
    void refreshReminders().finally(() => void reload())
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload()
    }, POLL_MS)
    const onFocus = () => void reload()
    window.addEventListener("focus", onFocus)
    return () => {
      alive.current = false
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [reload])

  // New notifications arrive at once (Row Level Security: only the person's own rows are sent).
  useLiveReload([{ table: "notifications" }], () => void reload())

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => (ids.includes(item.id) && !item.read_at ? { ...item, read_at: now } : item)))
    const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids })
    if (error) void reload()
  }, [reload])

  const remove = useCallback(async (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
    const { error } = await supabase.from("notifications").delete().eq("id", id)
    if (error) void reload()
  }, [reload])

  const unread = items.filter((item) => !item.read_at).length
  return { items, unread, loading, failed, reload, markRead, remove }
}

// Go to a notification's page without a full reload (the app re-reads the path on popstate).
export function followLink(link: string, projectId: string | null) {
  if (projectId) {
    try {
      sessionStorage.setItem("buildtrack.project", projectId)
    } catch {
      // The ?project= parameter in the link still carries the selection.
    }
  }
  window.history.pushState({}, "", link)
  window.scrollTo({ top: 0 })
  window.dispatchEvent(new PopStateEvent("popstate"))
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(iso).toLocaleDateString("en-PH", { day: "numeric", month: "short" })
}

// Visual hint per notification kind: a short label and a tone class pair (semantic colours only).
export const notificationKinds: Record<string, { label: string; tone: string }> = {
  "visit.requested": { label: "Site visit", tone: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100" },
  "visit.confirmed": { label: "Visit confirmed", tone: "bg-green-100 text-green-900 dark:bg-green-900/30 dark:text-green-100" },
  "visit.declined": { label: "Visit response", tone: "bg-red-100 text-red-900 dark:bg-red-900/30 dark:text-red-100" },
  "visit.cancelled": { label: "Visit cancelled", tone: "bg-surface-muted text-fg-muted" },
  "access.request": { label: "Request", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "access.declined": { label: "Access", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  "access.granted": { label: "Access", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "pin.review": { label: "Review", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  "pin.issue": { label: "Issue", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  "pin.verified": { label: "Verified", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "pin.milestone": { label: "Milestone", tone: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-200" },
  "pin.returned": { label: "Sent back", tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200" },
  "pin.assigned": { label: "Assigned", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "pin.problem": { label: "Field problem", tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200" },
  "pin.due": { label: "Due soon", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  "report.submitted": { label: "Report", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "report.reopened": { label: "Report", tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200" },
  "question.new": { label: "Question", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  "question.answered": { label: "Answer", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "pin.overdue": { label: "Overdue", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  "registration.new": { label: "Registration", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "snag.new": { label: "Client report", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "snag.accepted": { label: "Report", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "snag.declined": { label: "Report", tone: "bg-gray-200 text-gray-700 dark:bg-gray-700/60 dark:text-gray-200" },
  "snag.resolved": { label: "Fixed", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "qa.requested": { label: "Inspection", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "qa.result": { label: "Inspection", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "qa.defect": { label: "NCR", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  "qa.defect_verify": { label: "Verify", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "qa.defect_closed": { label: "NCR closed", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "qa.defect_rejected": { label: "Sent back", tone: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200" },
  "qa.defect_due": { label: "NCR due", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  "qa.defect_overdue": { label: "NCR overdue", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  "alert.overdue": { label: "Running late", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  "project.manager_assigned": { label: "Project Manager", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "project.manager_removed": { label: "Project Manager", tone: "bg-surface-muted text-fg-muted" },
  "project.archived": { label: "Archived", tone: "bg-surface-muted text-fg-muted" },
  "project.restored": { label: "Restored", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "attendance.concern": { label: "Attendance", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  "attendance.concern_resolved": { label: "Attendance", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "alert.escalation": { label: "Escalation", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
}

// Whether the person also wants an email copy of their notifications (default yes; the row is created the first time they choose).
export function useEmailPreference(userId: string | null) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    if (!userId) return
    let active = true
    supabase.from("notification_prefs").select("email_enabled").eq("user_id", userId).maybeSingle().then(({ data }) => {
      if (active) setEnabled(data ? Boolean((data as { email_enabled: boolean }).email_enabled) : true)
    })
    return () => {
      active = false
    }
  }, [userId])
  const change = useCallback(
    async (next: boolean): Promise<string | null> => {
      if (!userId) return "Not signed in"
      const before = enabled
      setEnabled(next)
      const existing = await supabase.from("notification_prefs").select("user_id").eq("user_id", userId).maybeSingle()
      const { error } = existing.data ? await supabase.from("notification_prefs").update({ email_enabled: next }).eq("user_id", userId) : await supabase.from("notification_prefs").insert({ user_id: userId, email_enabled: next })
      if (error) {
        setEnabled(before)
        return "Could not save your choice. Try again."
      }
      return null
    },
    [userId, enabled],
  )
  return { enabled, change }
}
