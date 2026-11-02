import { useEffect, useState } from "react"
import Modal from "../../components/Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { Skeleton } from "../../components/ui/Skeleton"
import { formatDate, formatTime } from "../../lib/admin"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { previewRecord, removeRecord, restoreRecord, searchRecords, useRemovedRecords } from "../../lib/recordRemoval"
import { RECORD_KINDS, kindLabels, kindNames, recordRemovalProblem, type RecordKind, type RecordPreview, type RemovableRecord, type RemovedRecord } from "../../lib/recordRemovalModel"
import { REASON_LIMITS } from "../../lib/recycleBinModel"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

const label = "block text-xs font-bold uppercase tracking-wider text-fg-muted"
const when = (iso: string) => (iso ? `${formatDate(iso)} ${formatTime(iso)}` : "")

// ---------------------------------------------------------------- remove one record
export function RemoveRecordModal({ kind, record, onClose, onDone }: { kind: RecordKind; record: RemovableRecord; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<RecordPreview | null>(null)
  const [loadError, setLoadError] = useState("")
  const [reason, setReason] = useState("")
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void previewRecord(kind, record.id).then((result) => {
      if (!live) return
      if (result.error || !result.data) setLoadError(result.error)
      else setPreview(result.data)
    })
    return () => { live = false }
  }, [kind, record.id])
  const problem = recordRemovalProblem({ preview, reason, typed })
  const run = async () => {
    if (problem) return toast.error("Not removed", problem)
    setBusy(true)
    const result = await removeRecord({ kind, id: record.id, reason, phrase: typed })
    setBusy(false)
    if (result.error || !result.data) return toast.error("Not removed", result.error)
    toast.success(`${record.label} was removed`, "Nothing was deleted. You can restore it from Removed records.")
    onDone()
  }
  return (
    <Modal
      title={`Remove this ${kindNames[kind]}?`}
      description="It disappears for everyone, with its photos and history. Nothing is deleted, and you can restore it."
      size="md"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={busy || !preview || Boolean(problem)} onClick={() => void run()}>{busy ? "Removing..." : "Remove"}</button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {loadError ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger-fg">{loadError}</p> : null}
        {!preview && !loadError ? <Skeleton className="h-16 w-full" /> : null}
        {preview ? (
          <>
            <p><strong>{preview.label}</strong> • {preview.project_code} {preview.project_name}<br />{preview.title}</p>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              <li>The people who work on it can no longer open it.</li>
              <li>The audit log records who removed it, when and why.</li>
              <li>Restoring puts it back exactly as it was.</li>
            </ul>
            <label className={label}>Why is it being removed?
              <textarea className={`${inputClass} mt-1 normal-case`} rows={2} maxLength={REASON_LIMITS.max} value={reason} placeholder="For example: entered by mistake" onChange={(event) => setReason(event.target.value)} />
            </label>
            <label className={label}>To confirm, type <code className="rounded bg-surface-muted px-1.5 py-0.5 normal-case">{preview.confirm_phrase}</code>
              <input className={`${inputClass} mt-1 normal-case`} value={typed} autoComplete="off" aria-label="Confirmation phrase" onChange={(event) => setTyped(event.target.value)} />
            </label>
            {problem && (reason || typed) ? <p className="text-xs text-fg-muted">{problem}</p> : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

export function RemovePanel({ onChanged }: { onChanged: () => void }) {
  const [kind, setKind] = useState<RecordKind>("daily_report")
  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [rows, setRows] = useState<RemovableRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [target, setTarget] = useState<RemovableRecord | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    void searchRecords(kind, submitted).then((result) => {
      if (!live) return
      setLoading(false)
      if (result.error || !result.data) { setError(result.error); setRows([]) } else { setError(""); setRows(result.data) }
    })
    return () => { live = false }
  }, [kind, submitted, version])
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">Find the record, then remove it with a reason. Inspections, defect reports, attendance records and the audit log cannot be removed here: project verification depends on the first two, attendance is biometric evidence, and the audit log proves who removed what.</p>
      <form className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); setSubmitted(query) }}>
        <select aria-label="Kind of record" value={kind} onChange={(event) => setKind(event.target.value as RecordKind)} className="min-h-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg">
          {RECORD_KINDS.map((key) => <option key={key} value={key}>{kindLabels[key]}</option>)}
        </select>
        <input aria-label="Search records" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by date, number, text or project" className="min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg" />
        <button type="submit" className={buttonSecondary}>Search</button>
      </form>
      {loading ? <Skeleton className="h-24 w-full" /> : null}
      {error ? <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p> : null}
      {!loading && !error && rows.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-6 text-center text-fg-muted">No {kindLabels[kind].toLowerCase()} match. The newest 50 are shown.</p> : null}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-fg">{row.label} <span className="font-normal text-fg-muted">• {row.project_code} • {row.status}</span></p>
              <p className="truncate text-sm text-fg-muted">{row.title}</p>
            </div>
            <button type="button" className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-bold text-danger-fg hover:bg-danger-soft" onClick={() => setTarget(row)} aria-label={`Remove ${row.label}`}>Remove...</button>
          </li>
        ))}
      </ul>
      {target ? <RemoveRecordModal kind={kind} record={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); setVersion((v) => v + 1); onChanged() }} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------- removed records
export function RemovedPanel({ records, loading, error, setup, onChanged }: { records: RemovedRecord[]; loading: boolean; error: string; setup: boolean; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState("")
  if (loading) return <Skeleton className="h-24 w-full" />
  if (setup) return <p role="status" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">Record removal is not installed on the database yet. The owner reviews and runs the record removal migration first.</p>
  if (error) return <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p>
  const restore = async (record: RemovedRecord) => {
    if (!(await confirm({ title: `Restore ${record.label}?`, message: `The ${kindNames[record.kind]} comes back for everyone who could see it before, with its photos and history.`, confirmLabel: "Restore" }))) return
    setBusy(record.id)
    const result = await restoreRecord(record.kind, record.id)
    setBusy("")
    if (result.error || !result.data) return toast.error("Not restored", result.error)
    toast.success(`${record.label} was restored`)
    onChanged()
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">Removed records are hidden from everyone but are kept with their photos and history. Nothing here expires.</p>
      {records.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-6 text-center text-fg-muted">No record has been removed.</p> : null}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {records.map((record) => (
          <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-fg">{kindLabels[record.kind]} • {record.label} <span className="font-normal text-fg-muted">• {record.project_code}</span></p>
              <p className="truncate text-sm text-fg-muted">{record.title}</p>
              <p className="text-xs text-fg-muted">Removed {when(record.removed_at)}{record.removed_by ? ` by ${record.removed_by}` : ""}{record.reason ? <> • Reason: <strong className="text-fg">{record.reason}</strong></> : null}</p>
            </div>
            <button type="button" className={buttonPrimary} disabled={busy === record.id} onClick={() => void restore(record)} aria-label={`Restore ${record.label}`}>{busy === record.id ? "Restoring..." : "Restore"}</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- the page (Super Admin only)
export default function RecordsPage(_: AdminPageProps) {
  const { profile } = useAuth()
  const allowed = profile?.role === "super_admin"
  const [tab, setTab] = useState<"remove" | "removed">("remove")
  const removed = useRemovedRecords(allowed)
  return (
    <div className="admin-page">
      <PageIntro eyebrow="Company • Super Admin" title="Records" description="Remove a daily report, site issue or client report that should not be in the system, with a reason. It is hidden, not deleted, and you can restore it." />
      {!allowed ? (
        <p role="alert" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">Only a Super Admin can open Records.</p>
      ) : (
        <Panel title="Records">
          <div role="tablist" aria-label="Records" className="mb-3 flex gap-2">
            {([["remove", "Remove a record"], ["removed", `Removed records (${removed.records.length})`]] as const).map(([key, text]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={tab === key ? buttonPrimary : buttonSecondary}>{text}</button>
            ))}
          </div>
          {tab === "remove" ? <RemovePanel onChanged={() => void removed.reload()} /> : <RemovedPanel records={removed.records} loading={removed.loading} error={removed.error} setup={removed.setup} onChanged={() => void removed.reload()} />}
        </Panel>
      )}
    </div>
  )
}
