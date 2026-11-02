import { useCallback, useEffect, useRef, useState } from "react"
import Modal from "../../components/Modal"
import { buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { Skeleton } from "../../components/ui/Skeleton"
import { formatDate, formatTime } from "../../lib/admin"
import { useAuth } from "../../lib/auth"
import { loadSystemLog } from "../../lib/systemControl"
import { LOG_CATEGORIES, SYSTEM_LOG_TABS, activityName, activitySummary, logCategoryLabels, logReference, logTabLabels, type LogRow, type SystemLogTab } from "../../lib/systemControlModel"
import AdminTabs, { useTabAddress } from "./AdminTabs"
import { Panel } from "./AdminShell"
import { EmailDeliveryPanel, useSwitches } from "./SystemControlPanels"
import { LockoutPanel } from "./SystemControlSchedule"
import type { AdminPageProps } from "./types"

const label = "block text-xs font-bold uppercase tracking-wider text-fg-muted"
const whenOf = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`
const dayStart = (day: string) => (day ? new Date(`${day}T00:00:00+08:00`).toISOString() : "") // the date boxes are Manila days, like the rest of the app
const dayAfter = (day: string) => (day ? new Date(new Date(`${day}T00:00:00+08:00`).getTime() + 86_400_000).toISOString() : "")
const tabs = SYSTEM_LOG_TABS.map((key) => ({ key, label: logTabLabels[key] }))

// Every administrator and system transaction (account creation, approvals, role and status changes, settings, system controls, removals), each one identifiable:
// a reference, when, who did it, to whom and what. Plain table changes (a pin edited, a QA step saved) are in Company Records and Audits instead.
function TransactionsPanel() {
  const [rows, setRows] = useState<LogRow[] | null>(null)
  const [problem, setProblem] = useState("")
  const [category, setCategory] = useState("")
  const [search, setSearch] = useState("")
  const [typed, setTyped] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<LogRow | null>(null)
  const request = useRef(0)

  const load = useCallback(async (offset: number) => {
    const mine = ++request.current
    setBusy(true)
    const result = await loadSystemLog({ category, search, from: dayStart(from), to: dayAfter(to), offset })
    if (mine !== request.current) return
    setBusy(false)
    if (result.error) return setProblem(result.error)
    setProblem("")
    setMore((result.data?.length ?? 0) === 50)
    setRows((previous) => (offset === 0 ? result.data : [...(previous ?? []), ...(result.data ?? [])]))
  }, [category, search, from, to])
  useEffect(() => {
    void load(0)
  }, [load])
  // The search box waits a moment after the last key, so one request is made, not one per letter.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(typed), 350)
    return () => window.clearTimeout(timer)
  }, [typed])

  return (
    <Panel title="Transactions" action={<button type="button" className={buttonSecondary} disabled={busy} onClick={() => void load(0)}>Refresh</button>}>
      <p className="mb-4 text-sm text-fg-muted">Who did what, to whom and when, for the administrator and system processes. Entries cannot be edited. Open one for everything that was recorded.</p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Category">
          {LOG_CATEGORIES.map((key) => (
            <button key={key || "all"} type="button" aria-pressed={category === key} onClick={() => setCategory(key)} className={`rounded-full border px-3 py-1 text-xs font-bold ${category === key ? "border-brand bg-brand text-white" : "border-line bg-surface text-fg-muted hover:bg-surface-muted"}`}>{logCategoryLabels[key]}</button>
          ))}
        </div>
        <label className={label}>Search
          <input className={`${inputClass} mt-1 normal-case`} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Person, action or word" />
        </label>
        <label className={label}>From
          <input type="date" className={`${inputClass} mt-1 normal-case`} value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className={label}>To
          <input type="date" className={`${inputClass} mt-1 normal-case`} value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} />
        </label>
      </div>
      {problem ? <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{problem}</p> : !rows ? (
        <div className="space-y-3" role="status" aria-label="Loading the system logs"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : rows.length === 0 ? <p className="text-sm text-fg-muted">No transaction matches.</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="admin-table w-full text-sm">
              <thead><tr><th>Reference</th><th>When</th><th>What</th><th>By</th><th>To</th><th>Details</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{logReference(row.id)}</td>
                  <td className="whitespace-nowrap">{whenOf(row.created_at)}</td>
                  <td className="font-semibold"><button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setOpen(row)}>{activityName(row.action)}</button><span className="block text-xs font-normal text-fg-muted">{logCategoryLabels[row.category]}</span></td>
                  <td>{row.actor_name ?? "System"}</td>
                  <td>{row.target_name ?? ""}</td>
                  <td className="max-w-md break-words text-fg-muted">{activitySummary(row)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {more ? <button type="button" className={`${buttonSecondary} mt-4`} disabled={busy} onClick={() => void load(rows.length)}>{busy ? "Loading..." : "Load older entries"}</button> : null}
        </>
      )}
      {open ? (
        <Modal title={activityName(open.action)} description={`${logReference(open.id)} · ${whenOf(open.created_at)}`} size="md" onClose={() => setOpen(null)} footer={<button type="button" className={buttonSecondary} onClick={() => setOpen(null)}>Close</button>}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className={label}>Done by</dt><dd>{open.actor_name ?? "System"}{open.actor_email ? <span className="block text-xs text-fg-muted">{open.actor_email}</span> : null}</dd></div>
            <div><dt className={label}>To</dt><dd>{open.target_name ?? "Nobody in particular"}</dd></div>
            <div><dt className={label}>Category</dt><dd>{logCategoryLabels[open.category]}</dd></div>
            <div><dt className={label}>Action code</dt><dd className="font-mono text-xs">{open.action}</dd></div>
          </dl>
          <p className={`${label} mt-4`}>Everything recorded</p>
          <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-surface-muted p-3 text-xs">{JSON.stringify(open.details ?? {}, null, 2)}</pre>
        </Modal>
      ) : null}
    </Panel>
  )
}

export default function SystemLogs({ initialTab = "transactions", ...pageProps }: AdminPageProps & { initialTab?: SystemLogTab }) {
  const { profile } = useAuth()
  const isSuper = profile?.role === "super_admin"
  const switches = useSwitches()
  const [tab, setTab] = useTabAddress<SystemLogTab>("/admin/system-logs", tabs, initialTab)
  void pageProps
  if (!isSuper) {
    return (
      <div className="admin-page">
        <Panel title="System Logs"><p className="text-sm text-fg-muted">Only a Super Admin can open the system logs.</p></Panel>
      </div>
    )
  }
  return (
    <AdminTabs
      eyebrow="System"
      title="System Logs"
      description="What happened in the system and who did it: administrator and system transactions, the emails that were really sent, and locked codes. Read only."
      label="System log sections"
      tabs={tabs}
      tab={tab}
      onTab={setTab}
      empty="No log is available."
    >
      {tab === "transactions" ? <TransactionsPanel /> : null}
      {tab === "email" ? <EmailDeliveryPanel paused={Boolean(switches.switches?.email_paused?.enabled)} /> : null}
      {tab === "lockouts" ? <LockoutPanel /> : null}
    </AdminTabs>
  )
}
