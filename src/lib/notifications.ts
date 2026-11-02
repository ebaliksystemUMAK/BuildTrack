import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "./supabase"
import { useLiveReload } from "./realtime"
import { HIDDEN_KINDS } from "./notificationModel"

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
  const [unreadTotal, setUnreadTotal] = useState<number | null>(null)
  const alive = useRef(true)

  const reload = useCallback(async () => {
    const [{ data, error }, unreadCount] = await Promise.all([
      supabase
        .from("notifications")
        .select("id,kind,title,body,link,project_id,entity_id,created_at,read_at")
        .not("kind", "in", `(${HIDDEN_KINDS.join(",")})`)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null).not("kind", "in", `(${HIDDEN_KINDS.join(",")})`),
    ])
    if (!alive.current) return
    setFailed(Boolean(error))
    if (!error) setItems((data as AppNotification[] | null) ?? [])
    setUnreadTotal(unreadCount.error ? null : unreadCount.count ?? 0)
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
    const newlyRead = items.filter((item) => ids.includes(item.id) && !item.read_at).length
    setItems((current) => current.map((item) => (ids.includes(item.id) && !item.read_at ? { ...item, read_at: now } : item)))
    setUnreadTotal((total) => (total === null ? null : Math.max(0, total - newlyRead)))
    const { error } = await supabase.rpc("mark_notifications_read", { p_ids: ids })
    if (error) void reload()
  }, [items, reload])

  // Every unread notification, including the ones older than the 50 on screen. Falls back to the loaded ones when the database function is not installed yet.
  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => (item.read_at ? item : { ...item, read_at: now })))
    setUnreadTotal(0)
    const { error } = await supabase.rpc("mark_all_notifications_read")
    if (!error) return
    const loaded = items.filter((item) => !item.read_at).map((item) => item.id)
    if (loaded.length) await supabase.rpc("mark_notifications_read", { p_ids: loaded })
    void reload()
  }, [items, reload])

  const remove = useCallback(async (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id))
    const { error } = await supabase.from("notifications").delete().eq("id", id)
    if (error) void reload()
  }, [reload])

  const unread = unreadTotal ?? items.filter((item) => !item.read_at).length
  return { items, unread, loading, failed, reload, markRead, markAllRead, remove }
}

// Go to a notification's page without a full reload (the app re-reads the path on popstate).
// An in-app path: starts with one "/", no scheme, no "//" or backslash (those can leave the site), no control characters or spaces.
const isInAppPath = (value: string) => /^\/(?![/\\])[^\s\u0000-\u001f\u007f]*$/.test(value)

export function followLink(link: string, projectId: string | null) {
  if (typeof link !== "string" || !isInAppPath(link)) return // never navigate away from BuildTrack
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
  "digest.admin": { label: "Summary", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "announcement.message": { label: "Announcement", tone: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  "account.suspended": { label: "Account", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  "account.reactivated": { label: "Account", tone: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200" },
  "alert.escalation": { label: "Escalation", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
}

// The person's email choices. Master switch: whether they want email copies at all (default yes). Under it, reminders and announcements can be
// switched off separately (default yes). Account and security notices are always emailed, so they have no switch. The row is created the first
// time they choose. When the database does not have the two extra columns yet (migration not installed), only the master switch is offered.
type Prefs = { email_enabled: boolean; email_reminders: boolean; email_announcements: boolean; email_admin_digest: boolean }
const defaultPrefs: Prefs = { email_enabled: true, email_reminders: true, email_announcements: true, email_admin_digest: true }

export function useEmailPreference(userId: string | null) {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [categories, setCategories] = useState(true)
  const [digestColumn, setDigestColumn] = useState(true)
  useEffect(() => {
    if (!userId) return
    let active = true
    void (async () => {
      const full = await supabase.from("notification_prefs").select("email_enabled,email_reminders,email_announcements,email_admin_digest").eq("user_id", userId).maybeSingle()
      if (!active) return
      if (!full.error) return setPrefs({ ...defaultPrefs, ...((full.data as Partial<Prefs> | null) ?? {}) })
      // One step back at a time: the daily-digest column may be missing while the reminder / announcement columns are there.
      const withoutDigest = await supabase.from("notification_prefs").select("email_enabled,email_reminders,email_announcements").eq("user_id", userId).maybeSingle()
      if (!active) return
      if (!withoutDigest.error) {
        setDigestColumn(false)
        return setPrefs({ ...defaultPrefs, ...((withoutDigest.data as Partial<Prefs> | null) ?? {}) })
      }
      const basic = await supabase.from("notification_prefs").select("email_enabled").eq("user_id", userId).maybeSingle()
      if (!active) return
      setCategories(false)
      setDigestColumn(false)
      setPrefs({ ...defaultPrefs, ...((basic.data as Partial<Prefs> | null) ?? {}) })
    })()
    return () => {
      active = false
    }
  }, [userId])
  const save = useCallback(
    async (patch: Partial<Prefs>): Promise<string | null> => {
      if (!userId) return "Not signed in"
      const before = prefs
      setPrefs((current) => ({ ...(current ?? defaultPrefs), ...patch }))
      const existing = await supabase.from("notification_prefs").select("user_id").eq("user_id", userId).maybeSingle()
      const { error } = existing.data ? await supabase.from("notification_prefs").update(patch).eq("user_id", userId) : await supabase.from("notification_prefs").insert({ user_id: userId, ...patch })
      if (error) {
        setPrefs(before)
        return "Could not save your choice. Try again."
      }
      return null
    },
    [userId, prefs],
  )
  return {
    enabled: prefs ? prefs.email_enabled : null,
    reminders: prefs ? prefs.email_reminders : null,
    announcements: prefs ? prefs.email_announcements : null,
    adminDigest: prefs ? prefs.email_admin_digest : null,
    categories,
    digestColumn,
    change: (next: boolean) => save({ email_enabled: next }),
    changeReminders: (next: boolean) => save({ email_reminders: next }),
    changeAnnouncements: (next: boolean) => save({ email_announcements: next }),
    changeAdminDigest: (next: boolean) => save({ email_admin_digest: next }),
  }
}

export const HISTORY_PAGE = 25

// The full notification history, newest first, 25 at a time (the bell only keeps the latest 50).
export function useNotificationHistory(unreadOnly: boolean, enabled: boolean) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [more, setMore] = useState(false)
  const generation = useRef(0)

  const load = useCallback(
    async (offset: number) => {
      const run = ++generation.current
      setLoading(true)
      let query = supabase
        .from("notifications")
        .select("id,kind,title,body,link,project_id,entity_id,created_at,read_at")
        .not("kind", "in", `(${HIDDEN_KINDS.join(",")})`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + HISTORY_PAGE - 1)
      if (unreadOnly) query = query.is("read_at", null)
      const { data, error } = await query
      if (run !== generation.current) return
      setFailed(Boolean(error))
      if (!error) {
        const page = (data as AppNotification[] | null) ?? []
        setItems((current) => (offset === 0 ? page : [...current, ...page.filter((row) => !current.some((known) => known.id === row.id))]))
        setMore(page.length === HISTORY_PAGE)
      }
      setLoading(false)
    },
    [unreadOnly],
  )

  useEffect(() => {
    if (!enabled) return
    setItems([])
    setMore(false)
    void load(0)
    return () => {
      generation.current++
    }
  }, [enabled, load])

  const markReadHere = useCallback((ids: string[]) => {
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => (ids.includes(item.id) && !item.read_at ? { ...item, read_at: now } : item)))
  }, [])

  return { items, loading, failed, more, loadMore: () => load(items.length), reload: () => load(0), markReadHere }
}
