import { useRef, useState } from "react"
import AdminProjectSelect, { useAdminProject } from "../../components/AdminProjectSelect"
import { EmptyState, Meter, buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { SkeletonCardGrid } from "../../components/ui/Skeleton"
import { downloadBlob } from "../../lib/exportSheet"
import { exportProject, type ExportProgress, type ExportResult } from "../../lib/projectExport"
import { buildZip, textBytes } from "../../lib/zipWriter"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`

// A backup of one project in a single ZIP (data as JSON, plus the plan files and photos if you want them), or the full company
// backup: every project's data in one archive (one backup ZIP per project inside). Project Managers export only their own project.
export default function ProjectBackup(_: AdminPageProps) {
  const { projects, project, projectId, loading, choose } = useAdminProject()
  const toast = useToast()
  const [withFiles, setWithFiles] = useState(true)
  const [scope, setScope] = useState<"one" | "all">("one")
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState("")
  const cancel = useRef({ cancelled: false })

  // Every project, data only, one after the other (each one is written to the audit log like a single backup).
  const startAll = async () => {
    cancel.current = { cancelled: false }
    setBusy(true)
    setError("")
    setResult(null)
    try {
      const entries: Array<{ name: string; data: Uint8Array }> = []
      const missing: string[] = []
      let rows = 0
      for (let index = 0; index < projects.length; index += 1) {
        const item = projects[index]
        setProgress({ step: `Exporting ${item.code} (${index + 1} of ${projects.length})`, done: index, total: projects.length })
        const made = await exportProject(item.id, { withFiles: false, cancel: cancel.current })
        entries.push({ name: made.filename, data: new Uint8Array(await made.blob.arrayBuffer()) })
        rows += made.rows
        missing.push(...made.missing.map((file) => `${item.code}: ${file}`))
        const { error: logError } = await supabase.rpc("log_project_export", { p_project: item.id, p_with_files: false, p_rows: made.rows })
        if (logError) missing.push(`${item.code}: not written to the audit log (${logError.message})`)
      }
      const stamp = new Date().toISOString()
      entries.unshift({ name: "README.txt", data: textBytes(["BuildTrack full backup (data only)", `Exported: ${stamp}`, "One backup ZIP per project inside. Restore each one with docs/BUILDTRACK_BACKUP_RESTORE.md.", ""].join("\n")) })
      const blob = new Blob([buildZip(entries) as BlobPart], { type: "application/zip" })
      const filename = `buildtrack-full-backup-${stamp.slice(0, 10)}-data-only.zip`
      downloadBlob(blob, filename)
      setResult({ blob, filename, rows, files: 0, missing, skippedForSize: 0 })
      toast.success("Full backup downloaded", `${projects.length} projects in ${filename}`)
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "The backup failed. Try again."
      setError(message)
      if (!/cancelled/i.test(message)) toast.error("Backup failed", message)
    }
    setBusy(false)
    setProgress(null)
  }

  const start = async () => {
    if (scope === "all") return startAll()
    if (!projectId) return
    cancel.current = { cancelled: false }
    setBusy(true)
    setError("")
    setResult(null)
    try {
      const made = await exportProject(projectId, { withFiles, onProgress: setProgress, cancel: cancel.current })
      downloadBlob(made.blob, made.filename)
      const { error: logError } = await supabase.rpc("log_project_export", { p_project: projectId, p_with_files: withFiles, p_rows: made.rows })
      if (logError) toast.error("The backup was saved, but it could not be written to the audit log", logError.message)
      setResult(made)
      toast.success("Backup downloaded", made.filename)
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "The backup failed. Try again."
      setError(message)
      if (!/cancelled/i.test(message)) toast.error("Backup failed", message)
    }
    setBusy(false)
    setProgress(null)
  }

  return (
    <div className="admin-page">
      <PageIntro eyebrow="Administration" title="Full backup and export" description="Download everything about one project in a single file: plan sheets and revisions, pins with their timeline and checklists, drawings, daily reports and client questions. Keep the file somewhere safe and private." />
      <Panel title="Create a backup">
        {loading ? (
          <SkeletonCardGrid count={1} label="Loading projects" />
        ) : projects.length === 0 ? (
          <EmptyState title="No projects yet">Create a project first.</EmptyState>
        ) : (
          <div className="space-y-5">
            <fieldset className="flex flex-wrap gap-4" disabled={busy}>
              <legend className="mb-1 text-sm font-semibold">Scope</legend>
              <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" name="backup-scope" checked={scope === "one"} onChange={() => setScope("one")} />One project</label>
              <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" name="backup-scope" checked={scope === "all"} onChange={() => setScope("all")} />Every project ({projects.length}, data only)</label>
            </fieldset>
            {scope === "one" ? <AdminProjectSelect projects={projects} value={projectId} onChange={choose} /> : null}
            {scope === "one" ? <fieldset className="space-y-2" disabled={busy}>
              <legend className="mb-1 text-sm font-semibold">What to include</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="backup-kind" className="mt-1" checked={withFiles} onChange={() => setWithFiles(true)} />
                <span><strong className="block">Data and files</strong><span className="text-fg-muted">The complete backup. It can be large (every plan file and photo is downloaded into your browser first).</span></span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="backup-kind" className="mt-1" checked={!withFiles} onChange={() => setWithFiles(false)} />
                <span><strong className="block">Data only</strong><span className="text-fg-muted">Small and quick. Pins, timelines, reports and the list of files, but not the files themselves.</span></span>
              </label>
            </fieldset> : <p className="text-sm text-fg-muted">One archive with a data-only backup of every project. Back up a single project to include its files.</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={buttonPrimary} disabled={busy || (scope === "one" && !projectId)} onClick={() => void start()}>{busy ? "Working..." : scope === "all" ? "Back up every project" : `Back up ${project?.code ?? "project"}`}</button>
              {busy ? <button type="button" className={buttonSecondary} onClick={() => { cancel.current.cancelled = true }}>Cancel</button> : null}
            </div>
            {progress ? (
              <div role="status" aria-live="polite">
                <p className="mb-1 text-sm font-semibold">{progress.step}</p>
                <Meter value={progress.total ? (progress.done / progress.total) * 100 : 0} label="Backup progress" />
              </div>
            ) : null}
            {error && !/cancelled/i.test(error) ? <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p> : null}
            {error && /cancelled/i.test(error) ? <p className="text-sm text-fg-muted">Cancelled. Nothing was downloaded.</p> : null}
            {result ? (
              <div className="rounded-xl border border-line bg-surface-muted/50 p-4 text-sm">
                <p className="font-bold">Done: {result.filename}</p>
                <p className="mt-1 text-fg-muted">{result.rows} rows • {result.files} file{result.files === 1 ? "" : "s"} • {megabytes(result.blob.size)}</p>
                {result.missing.length ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer font-semibold text-danger-fg">{result.missing.length} file{result.missing.length === 1 ? "" : "s"} could not be included</summary>
                    <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-fg-muted">{result.missing.map((item) => <li key={item}>{item}</li>)}</ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Panel>
      <Panel title="Good to know">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-muted">
          <li>The backup contains only what you are allowed to read. It does not include accounts, passwords or other projects.</li>
          <li>Each backup is written to the audit log (who, which project, with or without files).</li>
          <li>To restore, follow <strong>docs/BUILDTRACK_BACKUP_RESTORE.md</strong>. A restore is done by a developer with database access, not from this screen.</li>
          <li>Make a backup before deleting a project or before a big change, and keep a copy off this computer.</li>
        </ul>
      </Panel>
    </div>
  )
}
