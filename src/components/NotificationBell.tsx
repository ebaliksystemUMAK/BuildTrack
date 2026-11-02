import { useEffect, useRef, useState } from "react"
import { useAuth } from "../lib/auth"
import { followLink, notificationKinds, timeAgo, useEmailPreference, useNotifications } from "../lib/notifications"
import { safeInAppLink } from "../lib/notificationModel"
import { useToast } from "../lib/toast"
import NotificationHistoryModal from "./NotificationHistoryModal"
import { Skeleton } from "./ui/Skeleton"

// Bell for the top bar of every panel: unread badge and a panel with the latest notifications.
export default function NotificationBell({ onSurface = false }: { onSurface?: boolean }) {
  const { items, unread, loading, failed, reload, markRead, markAllRead, remove } = useNotifications()
  const { profile } = useAuth()
  const toast = useToast()
  const email = useEmailPreference(profile?.id ?? null)
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    void reload()
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, reload])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`relative grid h-10 w-10 place-items-center rounded-[10px] transition ${onSurface ? "text-fg hover:bg-surface-muted" : "text-white hover:bg-white/15"}`}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
        {unread ? (
          <span className={`absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#f18b00] px-1 text-[11px] font-extrabold leading-none text-black ring-2 ${onSurface ? "ring-surface" : "ring-[#c64bc0]"}`}>
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="bt-pop fixed right-2 top-[68px] z-50 w-[24rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-2xl sm:absolute sm:right-0 sm:top-12">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-extrabold">Notifications</h2>
            <button type="button" disabled={!unread} onClick={() => void markAllRead()} className="rounded-md px-2 py-1 text-xs font-bold text-brand-text hover:bg-surface-muted disabled:opacity-40">
              Mark all as read
            </button>
          </div>
          <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
            {loading ? (
              <div className="space-y-3 p-4" role="status" aria-label="Loading notifications">
                {[0, 1, 2].map((row) => (
                  <Skeleton key={row} className="h-12 w-full" />
                ))}
              </div>
            ) : failed ? (
              <p role="alert" className="p-6 text-center text-sm text-fg-muted">
                Could not load notifications.{" "}
                <button type="button" className="font-bold text-brand-text underline" onClick={() => void reload()}>Try again</button>
              </p>
            ) : items.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <p className="text-sm font-bold">You are all caught up</p>
                <p className="mt-1 text-xs text-fg-muted">Reviews, assignments, deadlines and decisions will show here.</p>
              </div>
            ) : (
              <ul>
                {items.map((item) => {
                  const kind = notificationKinds[item.kind]
                  const go = () => {
                    void markRead([item.id])
                    setOpen(false)
                    const link = safeInAppLink(item.link)
                    if (link) followLink(link, item.project_id)
                  }
                  return (
                    <li key={item.id} className={`group relative border-b border-line last:border-b-0 ${item.read_at ? "" : "bg-brand-soft/60"}`}>
                      <button type="button" onClick={go} className="flex w-full items-start gap-3 px-4 py-3 pr-10 text-left transition hover:bg-surface-muted">
                        <span className={`mt-1 h-2 w-2 flex-none rounded-full ${item.read_at ? "bg-transparent" : "bg-brand"}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            {kind ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${kind.tone}`}>{kind.label}</span> : null}
                            <span className="text-[11px] text-fg-muted">{timeAgo(item.created_at)}</span>
                          </span>
                          <span className={`mt-1 block text-sm leading-snug ${item.read_at ? "font-semibold" : "font-extrabold"}`}>{item.title}</span>
                          {item.body ? <span className="mt-0.5 block text-xs leading-snug text-fg-muted">{item.body}</span> : null}
                        </span>
                      </button>
                      <button type="button" onClick={() => void remove(item.id)} aria-label={`Dismiss: ${item.title}`} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-fg-muted opacity-0 transition hover:bg-surface-muted hover:text-fg focus:opacity-100 group-hover:opacity-100">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="border-t border-line px-4 py-2 text-center">
            <button type="button" onClick={() => { setOpen(false); setHistory(true) }} className="rounded-md px-2 py-1 text-xs font-bold text-brand-text hover:bg-surface-muted">See all notifications</button>
          </div>
          <div className="border-t border-line text-xs">
            <label className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5">
              <span><span className="block font-bold">Also email me</span><span className="text-fg-muted">A copy of each notification goes to {profile?.email ?? "your email"}.</span></span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Also email me"
                className="h-4 w-4 flex-none accent-[#9E1F93]"
                checked={email.enabled ?? true}
                disabled={email.enabled === null}
                onChange={(event) => void email.change(event.target.checked).then((problem) => (problem ? toast.error("Not saved", problem) : toast.success(event.target.checked ? "Emails are on" : "Emails are off")))}
              />
            </label>
            {email.categories && email.enabled !== false ? (
              <>
                <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-line/60 py-2 pl-8 pr-4">
                  <span><span className="block font-semibold">Reminder emails</span><span className="text-fg-muted">Deadlines and late work.</span></span>
                  <input type="checkbox" role="switch" aria-label="Reminder emails" className="h-4 w-4 flex-none accent-[#9E1F93]" checked={email.reminders ?? true} disabled={email.reminders === null} onChange={(event) => void email.changeReminders(event.target.checked).then((problem) => (problem ? toast.error("Not saved", problem) : toast.success(event.target.checked ? "Reminder emails are on" : "Reminder emails are off")))} />
                </label>
                <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-line/60 py-2 pl-8 pr-4">
                  <span><span className="block font-semibold">Announcement emails</span><span className="text-fg-muted">Messages from administrators.</span></span>
                  <input type="checkbox" role="switch" aria-label="Announcement emails" className="h-4 w-4 flex-none accent-[#9E1F93]" checked={email.announcements ?? true} disabled={email.announcements === null} onChange={(event) => void email.changeAnnouncements(event.target.checked).then((problem) => (problem ? toast.error("Not saved", problem) : toast.success(event.target.checked ? "Announcement emails are on" : "Announcement emails are off")))} />
                </label>
              </>
            ) : null}
            {email.digestColumn && (profile?.role === "admin" || profile?.role === "super_admin") ? (
              <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-line/60 px-4 py-2">
                <span><span className="block font-bold">Daily admin summary</span><span className="text-fg-muted">One note each morning with what needs your attention. Off = you get none, in the app or by email.</span></span>
                <input type="checkbox" role="switch" aria-label="Daily admin summary" className="h-4 w-4 flex-none accent-[#9E1F93]" checked={email.adminDigest ?? true} disabled={email.adminDigest === null} onChange={(event) => void email.changeAdminDigest(event.target.checked).then((problem) => (problem ? toast.error("Not saved", problem) : toast.success(event.target.checked ? "Daily admin summary is on" : "Daily admin summary is off")))} />
              </label>
            ) : null}
            <p className="border-t border-line/60 px-4 py-2 text-fg-muted">Account and security notices are always emailed.</p>
          </div>
        </div>
      ) : null}
      {history ? <NotificationHistoryModal onClose={() => setHistory(false)} markRead={markRead} markAllRead={markAllRead} /> : null}
    </div>
  )
}
