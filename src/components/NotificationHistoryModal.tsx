import { useState } from "react"
import Modal from "./Modal"
import { Skeleton } from "./ui/Skeleton"
import { followLink, notificationKinds, timeAgo, useNotificationHistory } from "../lib/notifications"
import { safeInAppLink } from "../lib/notificationModel"

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })

// Everything the person was notified about, not only the latest 50 in the bell: filter to unread, load older ones, open the page it points to.
export default function NotificationHistoryModal({
  onClose,
  markRead,
  markAllRead,
}: {
  onClose: () => void
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
}) {
  const [unreadOnly, setUnreadOnly] = useState(false)
  const history = useNotificationHistory(unreadOnly, true)
  const unreadHere = history.items.filter((item) => !item.read_at).map((item) => item.id)

  return (
    <Modal
      title="Notification history"
      description="Everything you were notified about, newest first."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-muted" onClick={onClose}>Close</button>
          <button
            type="button"
            className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-muted disabled:opacity-50"
            disabled={!unreadHere.length && !history.items.length}
            onClick={() => void markAllRead().then(() => { history.markReadHere(history.items.map((item) => item.id)); if (unreadOnly) void history.reload() })}
          >
            Mark all as read
          </button>
        </>
      }
    >
      <div className="mb-3 inline-flex gap-0.5 rounded-xl border border-line bg-surface p-1" role="group" aria-label="Show">
        {([[false, "All"], [true, "Unread"]] as const).map(([value, label]) => (
          <button key={label} type="button" aria-pressed={unreadOnly === value} onClick={() => setUnreadOnly(value)} className={`rounded-lg px-3 py-1.5 text-sm font-bold ${unreadOnly === value ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}>{label}</button>
        ))}
      </div>
      {history.failed ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger-fg">
          Could not load your notifications. <button type="button" className="font-bold underline" onClick={() => void history.reload()}>Try again</button>
        </p>
      ) : history.loading && history.items.length === 0 ? (
        <div className="space-y-3" role="status" aria-label="Loading notifications">{[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-14 w-full" />)}</div>
      ) : history.items.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">{unreadOnly ? "You have no unread notifications." : "Nothing here yet. Reviews, assignments, deadlines and messages will show up."}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {history.items.map((item) => {
            const kind = notificationKinds[item.kind]
            const link = safeInAppLink(item.link)
            const open = () => {
              void markRead([item.id])
              history.markReadHere([item.id])
              if (link) {
                onClose()
                followLink(link, item.project_id)
              }
            }
            return (
              <li key={item.id} className={item.read_at ? "" : "bg-brand-soft/60"}>
                <button type="button" onClick={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-muted">
                  <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${item.read_at ? "bg-transparent" : "bg-brand"}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      {kind ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${kind.tone}`}>{kind.label}</span> : null}
                      <span className="text-xs text-fg-muted" title={when(item.created_at)}>{timeAgo(item.created_at)} · {when(item.created_at)}</span>
                      {!item.read_at ? <span className="sr-only">Unread</span> : null}
                    </span>
                    <span className={`mt-1 block text-sm leading-snug ${item.read_at ? "font-semibold" : "font-extrabold"}`}>{item.title}</span>
                    {item.body ? <span className="mt-0.5 block whitespace-pre-wrap break-words text-sm leading-snug text-fg-muted">{item.body}</span> : null}
                    {link ? <span className="mt-1 block text-xs font-bold text-brand-text">Open the page</span> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {history.more ? (
        <div className="mt-4 text-center">
          <button type="button" disabled={history.loading} onClick={() => void history.loadMore()} className="rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-muted disabled:opacity-60">{history.loading ? "Loading..." : "Load older notifications"}</button>
        </div>
      ) : null}
    </Modal>
  )
}
