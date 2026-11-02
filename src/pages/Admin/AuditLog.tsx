import { useCallback, useEffect, useRef, useState } from "react"
import Modal from "../../components/Modal"
import { EmptyState, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonRows } from "../../components/ui/Skeleton"
import { activityLabel, formatDate, formatTime } from "../../lib/admin"
import { AUDIT_CSV_HEADER, AUDIT_EXPORT_MAX, auditCsvRows, auditDetails, auditExportName, auditExportRecords, auditJson, collectAuditPages, type AuditExportScope } from "../../lib/auditLogModel"
import { downloadCsv, downloadText, toCsv } from "../../lib/progress"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

type Row = { id: number; created_at: string; actor_name: string; actor_email: string | null; action: string; target_name: string | null; summary: string | null }

const PAGE = 100
const manilaDay = (date = new Date()) => date.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })
const fromIso = (day: string) => (day ? new Date(`${day}T00:00:00+08:00`).toISOString() : null)
const toIso = (day: string) => (day ? new Date(new Date(`${day}T00:00:00+08:00`).getTime() + 86_400_000).toISOString() : null)
const knownActions = ["profile.status_changed", "profile.role_changed", "oauth.enroll", "oauth.blocked", "registration.submitted", "whitelist.apply", "whitelist.add", "whitelist.remove", "access.approve", "access.reject", "user.reopen", "user.create", "user.update", "user.promote_admin", "user.approve", "user.reject", "user.enable", "user.disable", "user.impersonate", "user.set_permissions", "settings.update", "project.export", "invite.create", "invite.disable", "invite.enable", "invite.redeem", "projects.insert", "projects.update", "projects.delete", "project_members.insert", "project_members.update", "project_members.delete"]

knownActions.push("announcement.publish", "announcement.update", "announcement.disable", "message.send", "email.test", "maintenance.on", "maintenance.update", "maintenance.off", "feature.lock", "feature.update", "feature.unlock", "user.force_logout", "project.archived", "project.restored", "project.removed", "project.recovered", "project.purged", "record.removed", "record.restored", "photos.account_rule", "pins.insert", "pins.update", "pins.delete", "pin_checklist_items.insert", "pin_checklist_items.update", "pin_checklist_items.delete", "qa_work_attempts.insert", "qa_work_attempts.update", "pin_qa_submissions.insert", "daily_report_photos.insert", "daily_report_photos.delete", "blueprints.insert", "blueprints.update", "blueprints.delete")

// Who did what and when. Needs the "View users" permission (checked again by the database).
export default function AuditLog(_: AdminPageProps) {
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [action, setAction] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [selected, setSelected] = useState<Row | null>(null)
  const [format, setFormat] = useState<"csv" | "json">("csv")
  const [exporting, setExporting] = useState(false)
  const request = useRef(0)
  const selectedDetails = selected ? auditDetails(selected) : null

  const load = useCallback(
    async (offset: number) => {
      const version = ++request.current
      setLoading(true)
      try {
        const { data, error: rpcError } = await supabase.rpc("get_audit_log", {
          p_search: search.trim() || null,
          p_action: action || null,
          p_from: fromIso(from),
          p_to: toIso(to),
          p_limit: PAGE,
          p_offset: offset,
        })
        if (version !== request.current) return
        if (rpcError) return setError(/permission/i.test(rpcError.message) ? "You need the View users permission to read the audit log." : "Could not load the audit log. Check your connection and try again.")
        setError("")
        const list = (data as Row[] | null) ?? []
        setRows((current) => (offset === 0 ? list : [...current, ...list]))
        setMore(list.length === PAGE)
      } catch {
        if (version === request.current) setError("Could not load the audit log. Check your connection and try again.")
      } finally {
        if (version === request.current) setLoading(false)
      }
    },
    [search, action, from, to],
  )

  // Reload when a filter changes (search waits for typing to pause).
  useEffect(() => {
    ++request.current
    setRows([])
    setMore(false)
    setLoading(true)
    const timer = window.setTimeout(() => void load(0), 300)
    return () => { ++request.current; window.clearTimeout(timer) }
  }, [load])

  // Both exports use the same authorized get_audit_log rows and the same allow-listed columns. "loaded" = what is on screen;
  // "filtered" = every entry for the current filters, read page by page (newest first, at most AUDIT_EXPORT_MAX).
  const save = (list: Row[], scope: AuditExportScope, truncated: boolean) => {
    const records = auditExportRecords(list, activityLabel)
    const name = auditExportName(scope, format, manilaDay(), truncated)
    if (format === "csv") downloadCsv(name, toCsv(AUDIT_CSV_HEADER, auditCsvRows(records)))
    else downloadText(name, auditJson(records, { scope, filters: { search, action, from, to }, truncated, exportedAt: new Date().toISOString() }), "application/json")
    if (truncated) toast.success(`Exported the newest ${records.length.toLocaleString()} matching entries`, "There are more. Narrow the dates to export the rest.")
    else toast.success("Exported", scope === "loaded" ? `${records.length} loaded entries` : `${records.length} entries matching your filters`)
  }

  const exportLoaded = () => save(rows, "loaded", false)

  const exportAll = async () => {
    setExporting(true)
    // Entries added while the export runs are left out, so a page boundary can never repeat or skip a row.
    const started = new Date()
    const filterEnd = toIso(to)
    const end = filterEnd && new Date(filterEnd) < started ? filterEnd : started.toISOString()
    try {
      const result = await collectAuditPages<Row>(async (offset, limit) => {
        const { data, error: rpcError } = await supabase.rpc("get_audit_log", { p_search: search.trim() || null, p_action: action || null, p_from: fromIso(from), p_to: end, p_limit: limit, p_offset: offset })
        if (rpcError) throw new Error(rpcError.message)
        return (data as Row[] | null) ?? []
      })
      save(result.rows, "filtered", result.truncated)
    } catch (caught) {
      toast.error("Could not export", /permission/i.test(String((caught as Error).message)) ? "You need the View users permission." : "Check your connection and try again.")
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="admin-page">
      <PageIntro eyebrow="Security" title="Audit log" description="Recorded account and project activity. Open an entry to see its full details. Entries cannot be edited." action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select value={format} onChange={(event) => setFormat(event.target.value === "json" ? "json" : "csv")} className={`${inputClass} !w-auto`} aria-label="Export format">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button type="button" className={buttonSecondary} onClick={exportLoaded} disabled={!rows.length || loading || exporting}>{`Export loaded entries (${format.toUpperCase()})`}</button>
          <button type="button" className={buttonSecondary} onClick={() => void exportAll()} disabled={loading || exporting || !!error}>{exporting ? "Exporting..." : `Export all matching (${format.toUpperCase()})`}</button>
        </div>
      } />
      <Panel>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email or detail" className={`${inputClass} mt-1 !w-56 normal-case`} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">Action
            <select value={action} onChange={(event) => setAction(event.target.value)} className={`${inputClass} mt-1 !w-52 normal-case`}>
              <option value="">All actions</option>
              {knownActions.map((key) => <option key={key} value={key}>{activityLabel(key)}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">From
            <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className={`${inputClass} mt-1 !w-40`} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">To
            <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={`${inputClass} mt-1 !w-40`} />
          </label>
          {search || action || from || to ? <button type="button" className="pb-2 text-sm font-bold text-brand-text underline" onClick={() => { setSearch(""); setAction(""); setFrom(""); setTo("") }}>Clear filters</button> : null}
        </div>
        <p className="mb-3 text-xs text-fg-muted">Export loaded entries saves the {rows.length} entries on screen. Export all matching saves every entry for the filters above (newest first, up to {AUDIT_EXPORT_MAX.toLocaleString()}). Both use the same columns and leave out passwords, tokens and ID numbers.</p>
        {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p> : null}
        <div className="admin-table-wrap">
          <table className="admin-table audit-log-table">
            <colgroup><col style={{ width: 110 }} /><col style={{ width: 95 }} /><col style={{ width: 160 }} /><col style={{ width: 180 }} /><col style={{ width: 180 }} /><col /></colgroup>
            <thead><tr><th>Date</th><th>Time (PHT)</th><th>Who</th><th>Action</th><th>About</th><th>Details</th></tr></thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <SkeletonRows rows={8} cols={6} />
              ) : rows.length === 0 && !error ? (
                <tr><td colSpan={6}><EmptyState title="No entries match">Try other words or a wider date range.</EmptyState></td></tr>
              ) : (
                rows.map((row) => {
                  const details = auditDetails(row)
                  return (
                  <tr key={row.id}>
                    <td className="is-muted">{formatDate(row.created_at)}</td>
                    <td className="is-muted">{formatTime(row.created_at)}</td>
                    <td className="is-strong" title={row.actor_email ?? undefined}>{row.actor_name}</td>
                    <td>{activityLabel(row.action)}</td>
                    <td>{details.about}</td>
                    <td>
                      <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">{details.summary}</p>
                      <button type="button" className="mt-1 text-xs font-bold text-brand-text underline underline-offset-2" onClick={() => setSelected(row)} aria-label={`View details: ${activityLabel(row.action)} about ${details.about}`}>View details</button>
                    </td>
                  </tr>
                )})
              )}
            </tbody>
          </table>
        </div>
        {more ? (
          <div className="mt-4 text-center">
            <button type="button" className={buttonSecondary} disabled={loading} onClick={() => void load(rows.length)}>{loading ? "Loading..." : "Load older entries"}</button>
          </div>
        ) : null}
      </Panel>
      {selected && selectedDetails ? <Modal title={activityLabel(selected.action)} description={selectedDetails.about} onClose={() => setSelected(null)} size="xl" footer={<button type="button" className={buttonSecondary} onClick={() => setSelected(null)}>Close</button>}>
        <p className="mb-4 text-sm text-fg-muted">{selected.actor_name} · {formatDate(selected.created_at)} · {formatTime(selected.created_at)} PHT</p>
        {selectedDetails.context.length ? <dl className="mb-5 grid gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:grid-cols-2">{selectedDetails.context.map(field => <div key={field.label}><dt className="text-xs font-bold text-fg-muted">{field.label}</dt><dd className="mt-1 break-words text-sm">{field.value}</dd></div>)}</dl> : null}
        <h3 className="mb-2 font-bold">{selectedDetails.changes ? "Recorded changes" : "Recorded values"}</h3>
        {!selectedDetails.changes && selected.action.endsWith(".update") ? <p className="mb-3 text-sm text-fg-muted">This entry saved the values after the edit. Previous values were not recorded.</p> : null}
        <dl className="divide-y divide-line">{selectedDetails.fields.map((field, index) => <div key={`${field.label}-${index}`} className="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-sm font-semibold">{field.label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm">{field.before !== undefined ? <><span className="text-fg-muted">Before: {field.before}</span><br /><span>After: {field.value}</span></> : field.value}</dd></div>)}</dl>
        <p className="mt-4 text-xs text-fg-muted">Related names use the current account or project record where available.</p>
      </Modal> : null}
    </div>
  )
}
