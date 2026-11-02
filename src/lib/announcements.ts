import { useCallback, useEffect, useState } from "react"
import { supabase } from "./supabase"
import { DISMISS_KEY, REFRESH_MS, canDismiss, isHidden, parseAnnouncement, readDismissed, type Announcement } from "./announcementModel"

const readStored = () => {
  try {
    return readDismissed(localStorage.getItem(DISMISS_KEY))
  } catch {
    return 0 // storage blocked: the banner simply shows every time
  }
}

// The active banner, for everybody (the database function is open to visitors who are not signed in). Asks again about every 30 seconds while the page
// is visible, and when the tab becomes visible again. A failed read keeps what was shown (a network blip must not hide a critical notice); when the
// database function is not installed yet there is simply no banner.
export function useActiveAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [dismissed, setDismissed] = useState(readStored)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data, error } = await supabase.rpc("get_active_announcement")
      if (!alive || error) return
      setAnnouncement(parseAnnouncement(Array.isArray(data) ? data[0] : data))
    }
    void load()
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), REFRESH_MS)
    const onVisible = () => document.visibilityState === "visible" && void load()
    const onStorage = (event: StorageEvent) => event.key === DISMISS_KEY && setDismissed(readStored())
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("storage", onStorage)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const dismiss = useCallback(() => {
    if (!announcement || !canDismiss(announcement)) return
    setDismissed(announcement.revision)
    try {
      localStorage.setItem(DISMISS_KEY, String(announcement.revision))
    } catch {
      // Not saved: it comes back after a reload, which is acceptable.
    }
  }, [announcement])

  return { announcement: isHidden(announcement, dismissed) ? null : announcement, dismiss }
}
