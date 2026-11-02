import { useEffect, useState } from "react"
import Modal from "../../components/Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { Skeleton } from "../../components/ui/Skeleton"
import { formatDate, formatTime } from "../../lib/admin"
import { previewPurge, previewRemoval, purgeProject, removeProject, restoreProject } from "../../lib/recycleBin"
import { REASON_LIMITS, describeContents, isEmptyProject, purgePhrase, purgeProblem, removalProblem, restoreCodeProblem, restoreNotes, type ProjectContents, type PurgePreview, type RemovalPreview, type RemovedProject } from "../../lib/recycleBinModel"
import { useToast } from "../../lib/toast"

const label = "block text-xs font-bold uppercase tracking-wider text-fg-muted"
const when = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`

function Inside({ contents }: { contents: ProjectContents }) {
  const lines = describeContents(contents)
  if (isEmptyProject(contents)) return <p className="text-sm text-fg-muted">Nothing has been recorded in this project yet.</p>
  return <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg-muted">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
}

// ---------------------------------------------------------------- move to the recycle bin
export function RemoveProjectModal({ project, onClose, onDone }: { project: { id: string; code: string; name: string }; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<RemovalPreview | null>(null)
  const [loadError, setLoadError] = useState("")
  const [reason, setReason] = useState("")
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void previewRemoval(project.id).then((result) => {
      if (!live) return
      if (result.error || !result.data) setLoadError(result.error)
      else setPreview(result.data)
    })
    return () => { live = false }
  }, [project.id])
  const problem = removalProblem({ preview, reason, typedCode: typed })
  const run = async () => {
    if (problem) return toast.error("Not removed", problem)
    setBusy(true)
    const result = await removeProject({ projectId: project.id, reason, code: typed })
    setBusy(false)
    if (result.error || !result.data) return toast.error("Not removed", result.error)
    toast.success(`${project.code} is in the recycle bin`, "Nothing was deleted. You can restore it from the recycle bin.")
    onDone()
  }
  return (
    <Modal
      title={`Move ${project.code} to the recycle bin?`}
      description="The project disappears for everyone, including its team. Nothing is deleted, and you can restore it."
      size="md"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={busy || !preview || Boolean(problem)} onClick={() => void run()}>{busy ? "Moving..." : "Move to recycle bin"}</button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {loadError ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger-fg">{loadError}</p> : null}
        {!preview && !loadError ? <Skeleton className="h-16 w-full" /> : null}
        {preview ? (
          <>
            <div>
              <p className={label}>What is inside {preview.name}</p>
              <Inside contents={preview.contents} />
            </div>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              <li>Team members, Project Managers and clients can no longer open it or see its records until you restore it.</li>
              <li>Every plan, pin, photo, report and audit entry is kept as it is.</li>
              {preview.contents.devices > 0 ? <li>Biometric devices on this project keep recording scans; they show again when the project is restored.</li>: null}
              <li>Restoring puts it back as an archived (read-only) project.</li>
              <li>Permanent deletion is not available here.</li>
            </ul>
            {!preview.archived ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger-fg">Archive the project first. Only an archived project can be moved to the recycle bin.</p> : null}
            <label className={label}>Why is it being removed?
              <textarea className={`${inputClass} mt-1 normal-case`} rows={2} maxLength={REASON_LIMITS.max} value={reason} placeholder="For example: created twice by mistake" onChange={(event) => setReason(event.target.value)} />
            </label>
            <label className={label}>To confirm, type <code className="rounded bg-surface-muted px-1.5 py-0.5 normal-case">{preview.code}</code>
              <input className={`${inputClass} mt-1 normal-case`} value={typed} autoComplete="off" aria-label="Project code" onChange={(event) => setTyped(event.target.value)} />
            </label>
            {problem && (reason || typed) ? <p className="text-xs text-fg-muted">{problem}</p> : null}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- restore
export function RestoreProjectModal({ item, onClose, onDone }: { item: RemovedProject; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [newCode, setNewCode] = useState("")
  const [busy, setBusy] = useState(false)
  const problem = restoreCodeProblem(newCode)
  const run = async () => {
    if (problem) return toast.error("Not restored", problem)
    setBusy(true)
    const result = await restoreProject({ projectId: item.id, newCode })
    setBusy(false)
    if (result.error || !result.data) return toast.error("Not restored", result.error)
    toast.success(`${result.data.code} is restored`, restoreNotes(result.data).join(" "))
    onDone()
  }
  return (
    <Modal
      title={`Restore ${item.code}?`}
      description="It comes back as an archived project, so nothing becomes editable by surprise."
      size="md"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={busy || Boolean(problem)} onClick={() => void run()}>{busy ? "Restoring..." : "Restore project"}</button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>{item.name}. Removed {when(item.removed_at)}{item.removed_by ? ` by ${item.removed_by}` : ""}{item.reason ? `. Reason: ` : "."}{item.reason ? <strong>{item.reason}</strong> : null}</p>
        <Inside contents={item.contents} />
        <label className={label}>New code (optional)
          <input className={`${inputClass} mt-1 normal-case`} value={newCode} maxLength={30} placeholder={`Keep ${item.code}`} aria-label="New project code" autoComplete="off" onChange={(event) => setNewCode(event.target.value)} />
        </label>
        <p className="text-xs text-fg-muted">The code {item.code} stays reserved while the project is in the recycle bin, so it is not taken by another project. Only change it if you want to.</p>
        {problem && newCode ? <p className="text-xs text-danger-fg">{problem}</p> : null}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- delete forever (Super Admin only)
export function PurgeProjectModal({ item, onClose, onDone }: { item: RemovedProject; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<PurgePreview | null>(null)
  const [loadError, setLoadError] = useState("")
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void previewPurge(item.id).then((result) => {
      if (!live) return
      if (result.error || !result.data) setLoadError(result.error)
      else setPreview(result.data)
    })
    return () => { live = false }
  }, [item.id])
  const problem = purgeProblem({ preview, typed })
  const run = async () => {
    if (problem) return toast.error("Not deleted", problem)
    setBusy(true)
    const result = await purgeProject({ projectId: item.id, phrase: typed })
    setBusy(false)
    if (result.error || !result.data) return toast.error("Not deleted", result.error)
    toast.success(`${result.data.code} was deleted forever`, result.data.files_failed ? `${result.data.files_failed} unused file(s) could not be removed from storage.` : `${result.data.files_removed} plan file(s) removed from storage.`)
    onDone()
  }
  return (
    <Modal
      title={`Delete ${item.code} forever?`}
      description="This cannot be undone. Only a Super Admin can do it, and only for a project that holds no real records."
      size="md"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={busy || !preview || Boolean(problem)} onClick={() => void run()}>{busy ? "Deleting..." : "Delete forever"}</button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {loadError ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger-fg">{loadError}</p> : null}
        {!preview && !loadError ? <Skeleton className="h-16 w-full" /> : null}
        {preview ? (
          <>
            <p>{preview.name}. In the recycle bin for <strong>{preview.days_in_bin ?? 0} day{preview.days_in_bin === 1 ? "" : "s"}</strong>; the minimum is {preview.min_days}.</p>
            {!preview.ok ? (
              <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-danger-fg">
                <p className="font-bold">It cannot be deleted forever:</p>
                <ul className="list-disc pl-5">{preview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                <p className="mt-1 text-xs">Projects with real records stay in the recycle bin; they can still be restored.</p>
              </div>
            ) : (
              <>
                <div><p className={label}>What will be deleted</p><Inside contents={preview.contents} /></div>
                <ul className="list-disc space-y-1 pl-5 text-fg-muted">
                  <li>The project, its plans, empty pins and team assignments, and the plan files in storage.</li>
                  <li>The audit log keeps who deleted it, when, why it was removed and what it held.</li>
                  <li>It cannot be restored afterwards.</li>
                </ul>
                <label className={label}>To confirm, type <code className="rounded bg-surface-muted px-1.5 py-0.5 normal-case">{purgePhrase(preview.code)}</code>
                  <input className={`${inputClass} mt-1 normal-case`} value={typed} autoComplete="off" aria-label="Confirmation phrase" onChange={(event) => setTyped(event.target.value)} />
                </label>
                {problem && typed ? <p className="text-xs text-fg-muted">{problem}</p> : null}
              </>
            )}
          </>
        ) : null}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- the list
export default function ProjectRecycleBin({ projects, loading, error, setup, onChanged, canPurge = false }: { projects: RemovedProject[]; loading: boolean; error: string; setup: boolean; onChanged: () => void; canPurge?: boolean }) {
  const [restoring, setRestoring] = useState<RemovedProject | null>(null)
  const [purging, setPurging] = useState<RemovedProject | null>(null)
  if (loading) return <Skeleton className="h-24 w-full" />
  if (setup) return <p role="status" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">The recycle bin is not installed on the database yet. The owner reviews and runs the project recycle bin migration first.</p>
  if (error) return <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p>
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">Removed projects are hidden from everyone but are kept with all their plans, pins, photos, reports and history. Nothing here expires, and nothing is deleted automatically.{canPurge ? " A Super Admin can delete a project forever once it has been here 30 days, but only if it holds no real records." : ""}</p>
      {projects.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-8 text-center text-fg-muted">The recycle bin is empty.</p> : null}
      <ul className="space-y-3">
        {projects.map((item) => (
          <li key={item.id} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-brand-text">{item.code}</p>
                <p className="text-base font-bold text-fg">{item.name}</p>
                <p className="mt-1 text-sm text-fg-muted">Removed {when(item.removed_at)}{item.removed_by ? ` by ${item.removed_by}` : ""}{item.reason ? <> • Reason: <strong className="text-fg">{item.reason}</strong></> : null}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canPurge ? <button type="button" className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-bold text-danger-fg hover:bg-danger-soft" onClick={() => setPurging(item)} aria-label={`Delete ${item.code} forever`}>Delete forever...</button> : null}
                <button type="button" className={buttonPrimary} onClick={() => setRestoring(item)} aria-label={`Restore ${item.code}`}>Restore</button>
              </div>
            </div>
            <div className="mt-2"><Inside contents={item.contents} /></div>
          </li>
        ))}
      </ul>
      {restoring ? <RestoreProjectModal item={restoring} onClose={() => setRestoring(null)} onDone={() => { setRestoring(null); onChanged() }} /> : null}
      {purging ? <PurgeProjectModal item={purging} onClose={() => setPurging(null)} onDone={() => { setPurging(null); onChanged() }} /> : null}
    </div>
  )
}
