import { useEffect, useState } from "react"
import { EmptyState, PageHead, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonRows } from "../../components/ui/Skeleton"
import { activityLabel, formatDate, formatTime, roleLabel } from "../../lib/admin"
import { useProjectAudit } from "../../lib/projectManagers"
import { usePmProject } from "./usePmProject"
import type { PmPageProps } from "./types"

const PAGE = 50
const dash = "—"

// Read-only history of the selected project: project and team changes, blueprint access, Project Manager assignments, exports and
// attendance concerns. Nothing here can be edited or deleted; the company-wide audit log stays with Admins.
export default function PmAuditLog(_: PmPageProps) {
  const pm = usePmProject()
  const [draft, setDraft] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const { entries, total, loading, error, reload } = useProjectAudit(pm.project?.id ?? null, search, page, PAGE)
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(draft); setPage(0) }, 300)
    return () => window.clearTimeout(timer)
  }, [draft])
  const pages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="admin-page">
      <PageHead eyebrow={`${pm.project?.code ?? "Project"} • Project audit log`} title="Project audit log"
        description="Who changed what on this project and when, newest first. Read-only." />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search by activity, person or subject" aria-label="Search the project history" className={`min-h-10 max-w-md ${inputClass}`} />
        <span className="text-sm text-fg-muted" aria-live="polite">{loading ? "Loading…" : `${total} ${total === 1 ? "entry" : "entries"}`}</span>
      </div>
      {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error} <button type="button" className="font-bold underline" onClick={() => void reload()}>Retry</button></p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Time (PHT)</th><th>Person</th><th>Role</th><th>Activity</th><th>Subject</th></tr></thead>
          <tbody>
            {loading ? <SkeletonRows rows={5} cols={6} /> : entries.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title={search ? "Nothing matches the search" : "No history yet"}>{search ? "Try another word." : "Changes to this project appear here as they happen."}</EmptyState></td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.id}>
                <td className="is-muted">{formatDate(entry.created_at)}</td>
                <td className="is-muted">{formatTime(entry.created_at)}</td>
                <td className="is-strong">{entry.actor_name}</td>
                <td>{entry.actor_role ? roleLabel[entry.actor_role] : dash}</td>
                <td>{activityLabel(entry.action)}</td>
                <td>{entry.subject ?? dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <button type="button" className={buttonSecondary} disabled={page === 0 || loading} onClick={() => setPage((value) => value - 1)}>Newer</button>
          <span className="text-sm text-fg-muted">Page {page + 1} of {pages}</span>
          <button type="button" className={buttonSecondary} disabled={page + 1 >= pages || loading} onClick={() => setPage((value) => value + 1)}>Older</button>
        </div>
      ) : null}
    </div>
  )
}
