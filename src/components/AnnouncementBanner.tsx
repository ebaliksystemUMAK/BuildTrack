import { useActiveAnnouncement } from "../lib/announcements"
import { canDismiss, toneClasses, type Announcement } from "../lib/announcementModel"

// The text is shown as plain text (React escapes it); line breaks are kept.
export function AnnouncementView({ announcement, onDismiss }: { announcement: Announcement; onDismiss?: () => void }) {
  const critical = announcement.tone === "critical"
  return (
    <div role={critical ? "alert" : "status"} aria-label="Announcement" className={`flex items-start gap-3 border-b px-4 py-2.5 text-sm ${toneClasses[announcement.tone]}`}>
      <p className="min-w-0 flex-1 leading-snug">
        <strong className="font-extrabold">{announcement.title}</strong>
        <span className="ml-2 whitespace-pre-line break-words">{announcement.message}</span>
      </p>
      {onDismiss && canDismiss(announcement) ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss this announcement" className="-my-1 grid h-7 w-7 flex-none place-items-center rounded-md text-current hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-current">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      ) : null}
    </div>
  )
}

// On every page, signed in or not. Nothing is drawn when there is no active announcement or this revision was dismissed.
export default function AnnouncementBanner() {
  const { announcement, dismiss } = useActiveAnnouncement()
  return announcement ? <AnnouncementView announcement={announcement} onDismiss={dismiss} /> : null
}
