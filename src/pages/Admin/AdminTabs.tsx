import { useCallback, useEffect, useState, type ReactNode } from "react"
import { EmbeddedPageContext, PageIntro, Panel } from "./AdminShell"

export type AdminTab<K extends string> = { key: K; label: string }

// The tab bar and the tab handling shared by the pages that hold other pages as tabs. The open tab is kept in the address (?tab=) so a link or a reload
// returns to it; the old page addresses open the matching tab. Each tab's content keeps its own page header as a compact sub-heading.
export function useTabAddress<K extends string>(path: string, tabs: Array<AdminTab<K>>, initial: K): [K, (next: K) => void] {
  const read = useCallback((): K => {
    try {
      const value = new URLSearchParams(window.location.search).get("tab")
      const found = tabs.find((tab) => tab.key === value)
      if (found) return found.key
    } catch {
      // Use the default tab.
    }
    return tabs.find((tab) => tab.key === initial)?.key ?? tabs[0]?.key ?? initial
  }, [tabs, initial])
  const [tab, setTabState] = useState<K>(read)
  const setTab = useCallback((next: K) => {
    setTabState(next)
    try {
      window.history.replaceState({}, "", `${path}?tab=${next}`)
    } catch {
      // The address is just not updated.
    }
  }, [path])
  useEffect(() => {
    const onPop = () => setTabState(read())
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [read])
  // The person may lose a tab (a permission was taken away): fall back to the first one they still have.
  useEffect(() => {
    if (tabs.length && !tabs.some((entry) => entry.key === tab)) setTabState(tabs[0].key)
  }, [tabs, tab])
  return [tab, setTab]
}

export default function AdminTabs<K extends string>({ eyebrow, title, description, label, tabs, tab, onTab, action, empty, children }: {
  eyebrow: string
  title: string
  description: string
  label: string
  tabs: Array<AdminTab<K>>
  tab: K
  onTab: (next: K) => void
  action?: ReactNode
  empty: string
  children: ReactNode
}) {
  return (
    <div className="admin-page">
      <PageIntro eyebrow={eyebrow} title={title} description={description} action={action} />
      {tabs.length === 0 ? (
        <Panel><p className="text-sm text-fg-muted">{empty}</p></Panel>
      ) : (
        <>
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1" role="tablist" aria-label={label}>
            {tabs.map((entry) => (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={tab === entry.key}
                onClick={() => onTab(entry.key)}
                className={`flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold transition ${tab === entry.key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted"}`}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={tabs.find((entry) => entry.key === tab)?.label}>
            <EmbeddedPageContext.Provider value>{children}</EmbeddedPageContext.Provider>
          </div>
        </>
      )}
    </div>
  )
}
