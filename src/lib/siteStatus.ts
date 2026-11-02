import { useEffect, useState } from "react"
import { createPollingStore } from "./pollingStore"
import { parseSiteStatus, type SiteStatus } from "./siteStatusModel"
import { supabase } from "./supabase"

// What the app knows about maintenance and paused features for the person using it (a visitor sees only the maintenance notice). One shared poll every
// 30 seconds while the page is visible. When the database function is not installed yet (migration not run) the answer is an error, which means "nothing to show".
const store = createPollingStore<SiteStatus>(
  async () => {
    const { data, error } = await supabase.rpc("get_site_status")
    return error ? null : parseSiteStatus(data)
  },
  { isVisible: () => document.visibilityState === "visible" },
)

export const refreshSiteStatus = () => store.refresh()

export function useSiteStatus(): SiteStatus | null {
  const [status, setStatus] = useState<SiteStatus | null>(() => store.get())
  useEffect(() => {
    setStatus(store.get())
    return store.subscribe(() => setStatus(store.get()))
  }, [])
  return status
}
