import { useCallback, useEffect, useState } from "react"
import { useAuth } from "../../lib/auth"
import { SYSTEM_TABS, isSystemTab, tabLabels, type SystemTab } from "../../lib/systemControlModel"
import { AnnouncementPanel } from "./Communications"
import { PageIntro, Panel } from "./AdminShell"
import SiteControlsPage from "./SiteControls"
import { SchedulePanel } from "./SystemControlSchedule"
import SystemHealth from "./SystemHealth"
import { CapacityPanel, EmailPanel, EmergencyOff, RegistrationPanel, RoleAccessPanel, useSwitches } from "./SystemControlPanels"
import type { AdminPageProps } from "./types"

const tabFromAddress = (fallback: SystemTab): SystemTab => {
  try {
    const value = new URLSearchParams(window.location.search).get("tab")
    return isSystemTab(value) ? value : fallback
  } catch {
    return fallback
  }
}

// The operating panel of the system itself (Super Admin only): health, maintenance and feature isolation, forced logout, the announcement banner, email and
// registration switches, the role access overview and a log of system actions. It never touches the work of the roles (reports, QA, plans, attendance, accounts).
// The older addresses /admin/system-health and /admin/site-controls open the matching tab.
export default function SystemControl({ initialTab = "health", ...pageProps }: AdminPageProps & { initialTab?: SystemTab }) {
  const { profile } = useAuth()
  const isSuper = profile?.role === "super_admin"
  const [tab, setTabState] = useState<SystemTab>(() => tabFromAddress(initialTab))
  const [refreshKey, setRefreshKey] = useState(0)
  const switches = useSwitches()

  const setTab = useCallback((next: SystemTab) => {
    setTabState(next)
    try {
      window.history.replaceState({}, "", `/admin/system-control?tab=${next}`)
    } catch {
      // The address just is not updated.
    }
  }, [])
  // Back / forward, or a link from another page, may change the address while this page stays open.
  useEffect(() => {
    const onPop = () => setTabState(tabFromAddress(initialTab))
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [initialTab])

  if (!isSuper) {
    return (
      <div className="admin-page">
        <PageIntro eyebrow="System" title="System Control" description="The operating panel of the system." />
        <Panel><p className="text-sm text-fg-muted">Only a Super Admin can open System Control.</p></Panel>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <PageIntro
        eyebrow="System"
        title="System Control"
        description="Operate the system itself: health, maintenance and feature isolation, forced logout, the announcement banner, email and registration switches, and who can open what. Role work and records are not here. Everything you change is recorded in System Logs."
        action={<EmergencyOff state={switches} onDone={() => setRefreshKey((value) => value + 1)} />}
      />
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist" aria-label="System Control sections">
        {SYSTEM_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted"}`}
          >
            {tabLabels[key]}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tabLabels[tab]} className="space-y-4">
        {tab === "health" ? (
          <>
            <SystemHealth {...pageProps} embedded />
            <CapacityPanel />
          </>
        ) : null}
        {tab === "maintenance" ? (
          <>
            <SiteControlsPage {...pageProps} embedded part="maintenance" refreshKey={refreshKey} />
            <SchedulePanel refreshKey={refreshKey} />
          </>
        ) : null}
        {tab === "logout" ? <SiteControlsPage {...pageProps} embedded part="logout" refreshKey={refreshKey} /> : null}
        {tab === "banner" ? <AnnouncementPanel /> : null}
        {tab === "email" ? <EmailPanel key={refreshKey} state={switches} /> : null}
        {tab === "registration" ? <RegistrationPanel state={switches} /> : null}
        {tab === "roles" ? <RoleAccessPanel onOpenTab={setTab} /> : null}
      </div>
    </div>
  )
}
