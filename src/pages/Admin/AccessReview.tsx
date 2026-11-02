import { useCallback, useEffect, useMemo, useState } from "react"
import { EmptyState, buttonDanger, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonRows } from "../../components/ui/Skeleton"
import { formatDate, roleLabel } from "../../lib/admin"
import { useAuth, type AppRole } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { invokeFunction } from "../../lib/functions"
import { downloadCsv, toCsv } from "../../lib/progress"
import { useSettings } from "../../lib/settings"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

type Row = { id: string; full_name: string | null; email: string; role: AppRole; status: string; last_sign_in_at: string | null; created_at: string; days_inactive: number }

// Accounts that have not signed in for a while: review them and switch off the ones that are no longer needed.
export default function AccessReview(_: AdminPageProps) {
  const { can } = useAuth()
  const { settings, loading: settingsLoading } = useSettings()
  const toast = useToast()
  const confirm = useConfirm()
  const [days, setDays] = useState<string>("")
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const canDisable = can("users.disable")

  useEffect(() => {
    if (!settingsLoading && days === "") setDays(String(settings.inactiveDays))
  }, [settingsLoading, settings.inactiveDays, days])

  const load = useCallback(async (limit: number) => {
    setLoading(true)
    const { data, error: rpcError } = await supabase.rpc("get_inactive_users", { p_days: limit })
    setLoading(false)
    if (rpcError) return setError(/users.view/i.test(rpcError.message) ? "You need the View users permission to open this page." : "Could not load the list. Check your connection and try again.")
    setError("")
    setRows((data as Row[] | null) ?? [])
    setPicked(new Set())
  }, [])

  useEffect(() => {
    const value = Number(days)
    if (!days || !Number.isInteger(value) || value < 1 || value > 3650) return
    const timer = window.setTimeout(() => void load(value), 300)
    return () => window.clearTimeout(timer)
  }, [days, load])

  const allPicked = rows.length > 0 && picked.size === rows.length
  const toggle = (id: string) => setPicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const names = useMemo(() => new Map(rows.map((row) => [row.id, row.full_name || row.email])), [rows])

  const disable = async () => {
    const ids = [...picked]
    if (!ids.length) return
    if (!(await confirm({ title: `Disable ${ids.length} account${ids.length === 1 ? "" : "s"}?`, message: "They cannot sign in until an administrator enables them again. Their work and history stay in the system.", confirmLabel: "Disable", tone: "danger" }))) return
    setBusy(true)
    let done = 0
    for (const id of ids) {
      const { error: callError } = await invokeFunction("admin-users", { action: "set_enabled", id, enabled: false, reason: `No sign-in for ${days} days (access review)` })
      if (callError) {
        toast.error(`Stopped at ${names.get(id) ?? "an account"}`, callError)
        break
      }
      done += 1
    }
    setBusy(false)
    if (done) toast.success(`${done} account${done === 1 ? "" : "s"} disabled`)
    await load(Number(days))
  }

  const exportCsv = () => downloadCsv(`access-review-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(["Name", "Email", "Role", "Last sign-in", "Days inactive", "Account created"], rows.map((row) => [row.full_name ?? "", row.email, roleLabel[row.role], row.last_sign_in_at ?? "never", row.days_inactive, row.created_at.slice(0, 10)])))

  return (
    <div className="admin-page">
      <PageIntro eyebrow="Security" title="Access review" description="Active accounts that have not signed in for the number of days below. Switch off accounts that are no longer needed. Administrators are never listed here." action={<button type="button" className={buttonSecondary} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>} />
      <Panel>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">Not signed in for (days)
            <input value={days} onChange={(event) => setDays(event.target.value)} inputMode="numeric" className={`${inputClass} mt-1 !w-32 normal-case`} aria-label="Days without signing in" />
          </label>
          {canDisable ? <button type="button" className={buttonDanger} disabled={!picked.size || busy} onClick={() => void disable()}>{busy ? "Disabling..." : `Disable ${picked.size || ""} selected`}</button> : <span className="text-xs text-fg-muted">Disabling accounts needs the Disable users permission.</span>}
        </div>
        {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p> : null}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th className="w-10">{canDisable ? <input type="checkbox" aria-label="Select all" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((row) => row.id)))} /> : null}</th><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th>Inactive</th></tr></thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={6} />
              ) : rows.length === 0 && !error ? (
                <tr><td colSpan={6}><EmptyState title="Nobody is inactive for that long">Every active account has signed in recently.</EmptyState></td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{canDisable ? <input type="checkbox" aria-label={`Select ${row.full_name || row.email}`} checked={picked.has(row.id)} onChange={() => toggle(row.id)} /> : null}</td>
                    <td className="is-strong">{row.full_name || "—"}</td>
                    <td className="is-muted">{row.email}</td>
                    <td>{roleLabel[row.role]}</td>
                    <td className="is-muted">{row.last_sign_in_at ? formatDate(row.last_sign_in_at) : "Never"}</td>
                    <td>{row.days_inactive} days</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
