import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import Modal from "./Modal"
import { BLUEPRINT_ACCEPT, openBlueprintPdf, uploadBlueprintRevision, validateBlueprintFile, type Blueprint } from "../lib/blueprints"
import { blueprintTypeLabels, type ClassifiedType } from "../lib/blueprintTypes"

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
type PdfPage = { page: number; title: string; level: string; selected: boolean; revisionId: string; blueprintId?: string; saved?: boolean }
type Errors = { title?: string; file?: string; type?: string; pages?: Record<number, string> }

// New PDFs expand into separately labelled plans. A revision selects one page of its existing plan.
export default function BlueprintUploadDialog({ projectId, existing, blueprintType, uploadTypes = [], onClose, onDone }: {
  projectId: string; existing?: Blueprint | null; blueprintType?: ClassifiedType | null; uploadTypes?: ClassifiedType[]
  onClose: () => void; onDone: (blueprintId: string) => void
}) {
  const formId = useId()
  const [title, setTitle] = useState(existing?.title ?? "")
  const [level, setLevel] = useState(existing?.level ?? "")
  const [type, setType] = useState<ClassifiedType | "">(blueprintType ?? (uploadTypes.length === 1 ? uploadTypes[0] : ""))
  const [file, setFile] = useState<File | null>(null)
  const [pages, setPages] = useState<PdfPage[]>([])
  const [page, setPage] = useState(1)
  const [reading, setReading] = useState(false)
  const [notes, setNotes] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState("")
  const [step, setStep] = useState("")
  const [busy, setBusy] = useState(false)
  const [singleId, setSingleId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ page: number; url: string } | null>(null)
  const [previewing, setPreviewing] = useState<number | null>(null)
  const source = useRef<Awaited<ReturnType<typeof openBlueprintPdf>> | null>(null)
  const generation = useRef(0)
  const saving = useRef(false)
  const created = useRef<Record<number, string>>({})
  const singleRevision = useRef("")
  const previewUrl = useRef("")
  const isPdf = file?.type === "application/pdf"
  const batch = isPdf && !existing
  const started = Boolean(singleId || Object.keys(created.current).length)
  const selected = pages.filter(row => row.selected)
  const saved = selected.filter(row => row.saved)
  const remaining = selected.filter(row => !row.saved)

  const releaseSource = () => {
    if (source.current) void source.current.destroy().catch(() => {})
    source.current = null
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = ""
  }
  useEffect(() => () => { generation.current++; releaseSource() }, [])

  const chooseFile = async (next: File | null) => {
    if (saving.current || started) return
    const run = ++generation.current
    releaseSource()
    setFile(next); setPages([]); setPage(1); setPreview(null); setPreviewing(null); setErrors({}); setFailure(""); setStep("")
    created.current = {}; singleRevision.current = crypto.randomUUID()
    const problem = validateBlueprintFile(next)
    if (problem || !next) { setReading(false); if (problem) setErrors({ file: problem }); return }
    if (next.type !== "application/pdf") { setReading(false); return }
    setReading(true)
    try {
      const doc = await openBlueprintPdf(next)
      if (run !== generation.current) { await doc.destroy(); return }
      source.current = doc
      const base = title.trim() || next.name.replace(/\.pdf$/i, "").trim() || "Plan"
      setPages(Array.from({ length: doc.numPages }, (_, index) => {
        const suffix = doc.numPages > 1 ? ` - Page ${index + 1}` : ""
        return { page: index + 1, title: `${base.slice(0, 120 - suffix.length)}${suffix}`, level, selected: true, revisionId: crypto.randomUUID() }
      }))
    } catch (error) {
      if (run === generation.current) setErrors({ file: error instanceof Error ? `Could not read this PDF: ${error.message}` : "Could not read this PDF. Choose another file." })
    } finally { if (run === generation.current) setReading(false) }
  }

  const showPreview = async (number: number) => {
    if (!source.current || busy || previewing !== null) return
    if (preview?.page === number) { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); previewUrl.current = ""; setPreview(null); return }
    const run = generation.current
    setPreviewing(number); setFailure("")
    try {
      const image = await source.current.renderPage(number, 900)
      if (run !== generation.current || !image.blob) return
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = URL.createObjectURL(image.blob)
      setPreview({ page: number, url: previewUrl.current })
    } catch { if (run === generation.current) setFailure("Could not preview this page. Retry the preview or choose another file.") }
    finally { if (run === generation.current) setPreviewing(null) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving.current || reading || previewing !== null) return
    const found: Errors = {}
    if (!existing && !batch && (title.trim().length < 2 || title.trim().length > 120)) found.title = "Enter a title between 2 and 120 characters."
    if (!existing && !type) found.type = "Choose the blueprint type."
    const problem = validateBlueprintFile(file)
    if (problem) found.file = problem
    if (isPdf && (!source.current || !pages.length)) found.file = "Wait for the PDF pages to load, or choose another PDF."
    if (batch && !selected.length) found.file = "Choose at least one PDF page to upload."
    if (batch) for (const row of remaining) {
      if (row.title.trim().length < 2 || row.title.trim().length > 120) (found.pages ??= {})[row.page] = "Enter a page label between 2 and 120 characters."
      else if (row.level.length > 40) (found.pages ??= {})[row.page] = "Keep the level / area under 40 characters."
    }
    setErrors(found); setFailure("")
    if (Object.keys(found).length || !file || (!existing && !type)) return
    const run = generation.current
    saving.current = true; setBusy(true)
    try {
      if (batch) {
        let firstId = saved[0]?.blueprintId
        for (const row of remaining) {
          if (run !== generation.current || !source.current) return
          setStep(`Page ${row.page} of ${pages.length}: preparing the plan…`)
          const preparedPreview = await source.current.renderPage(row.page)
          if (run !== generation.current) return
          const id = await uploadBlueprintRevision({ projectId, blueprintId: created.current[row.page] ?? row.blueprintId, title: row.title, level: row.level, blueprintType: type as ClassifiedType, file, page: row.page, notes, preparedPreview, revisionId: row.revisionId,
            onCreated: id => { created.current[row.page] = id; if (run === generation.current) setPages(current => current.map(entry => entry.page === row.page ? { ...entry, blueprintId: id } : entry)) },
          }, message => { if (run === generation.current) setStep(`Page ${row.page} of ${pages.length}: ${message}`) })
          if (run !== generation.current) return
          firstId ??= id
          setPages(current => current.map(entry => entry.page === row.page ? { ...entry, blueprintId: id, saved: true } : entry))
        }
        if (firstId) onDone(firstId)
      } else {
        const preparedPreview = isPdf && source.current ? await source.current.renderPage(page) : undefined
        if (run !== generation.current) return
        const id = await uploadBlueprintRevision({ projectId, blueprintId: existing?.id ?? created.current[0], title, level, blueprintType: (type || existing?.blueprint_type || "architectural") as ClassifiedType, file, page, notes, preparedPreview, revisionId: singleRevision.current,
          onCreated: id => { created.current[0] = id; if (run === generation.current) setSingleId(id) },
        }, message => { if (run === generation.current) setStep(message) })
        if (run === generation.current) onDone(id)
      }
    } catch (error) {
      if (run === generation.current) setFailure(`${error instanceof Error ? error.message : "Upload failed."}${batch ? " Saved pages are kept. Retry to upload the remaining pages." : ""}`)
    } finally { saving.current = false; if (run === generation.current) { setBusy(false); setStep("") } }
  }

  const close = () => {
    if (saving.current) return
    const firstSaved = pages.find(row => row.saved)?.blueprintId
    if (firstSaved) onDone(firstSaved)
    else onClose()
  }
  const uploadLabel = existing ? "Upload revision" : batch ? `${saved.length ? "Retry" : "Upload"} ${remaining.length} page${remaining.length === 1 ? "" : "s"}` : "Upload plan"
  return <Modal title={existing ? `New revision: ${existing.title}` : "Upload a plan"} size={isPdf && pages.length > 1 ? "2xl" : "md"} onClose={close} hideClose={busy} closeOnBackdrop={!busy}
    footer={<><span role="status" aria-live="polite" className="mr-auto text-xs text-fg-muted">{busy ? step : batch && pages.length ? `${selected.length} of ${pages.length} pages selected${saved.length ? ` · ${saved.length} saved` : ""}` : ""}</span><button type="button" className="min-h-10 rounded-lg border border-line px-4 text-sm font-semibold" disabled={busy} onClick={close}>Close</button><button type="submit" form={formId} disabled={busy || reading || previewing !== null || Boolean(isPdf && !pages.length)} className="min-h-10 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">{busy ? "Uploading…" : uploadLabel}</button></>}
  >
    <form id={formId} className="space-y-4" noValidate onSubmit={event => void submit(event)}>
      {failure ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{failure}</p> : null}
      {!existing ? <>
        {!isPdf ? <label className="block text-sm font-semibold">Plan title *<input className={field} maxLength={120} placeholder="Ground floor - general arrangement" value={title} onChange={event => setTitle(event.target.value)} disabled={busy || Boolean(singleId)} />{errors.title ? <span className="mt-1 block text-xs font-normal text-danger-fg">{errors.title}</span> : null}</label> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {!isPdf ? <label className="block text-sm font-semibold">Level / area<input className={field} maxLength={40} placeholder="L01" value={level} onChange={event => setLevel(event.target.value)} disabled={busy || Boolean(singleId)} /></label> : null}
          {blueprintType ? <div className="text-sm font-semibold">Blueprint type<p className="mt-1 flex min-h-10 items-center rounded-lg border border-line bg-surface-muted px-3 text-sm font-normal">{blueprintTypeLabels[blueprintType]}</p></div> : <label className="block text-sm font-semibold">Blueprint type *<select className={field} value={type} onChange={event => setType(event.target.value as ClassifiedType | "")} disabled={busy || started}><option value="">Choose a type</option>{uploadTypes.map(value => <option key={value} value={value}>{blueprintTypeLabels[value]}</option>)}</select>{errors.type ? <span className="mt-1 block text-xs font-normal text-danger-fg">{errors.type}</span> : null}</label>}
        </div>
      </> : <p className="text-sm text-fg-muted">The new file becomes revision {(existing.blueprint_revisions[0]?.revision ?? 0) + 1} of this {blueprintTypeLabels[existing.blueprint_type]} plan. Earlier revisions, pins, assignments and history stay with it.</p>}
      <label className="block text-sm font-semibold">File (PDF, PNG, JPEG or WebP, up to 25 MB) *<input className={field} type="file" accept={BLUEPRINT_ACCEPT} disabled={busy || started} onChange={event => void chooseFile(event.target.files?.[0] ?? null)} />{errors.file ? <span role="alert" className="mt-1 block text-xs font-normal text-danger-fg">{errors.file}</span> : null}</label>
      <p className="text-xs text-fg-muted">Working from CAD? Export the sheet as PDF or PNG first; DWG/DXF files cannot be shown in the browser.</p>
      {isPdf ? <p className="text-xs text-fg-muted">The original PDF, including all its pages, is retained with each uploaded plan.</p> : null}
      {reading ? <p role="status" className="rounded-lg bg-surface-muted p-3 text-sm">Reading PDF pages…</p> : null}
      {isPdf && pages.length ? <section aria-label="PDF pages" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold">{pages.length} PDF page{pages.length === 1 ? "" : "s"}</h3><p className="text-xs text-fg-muted">{existing ? "Choose the page to use for this plan's revision. Preview a page to check it." : "Label each page and choose which pages to upload. Each selected page becomes its own plan in this blueprint type."}</p></div>{batch ? <div className="flex gap-3 text-xs font-semibold"><button type="button" className="min-h-6 text-brand-text underline" disabled={busy} onClick={() => setPages(current => current.map(row => row.blueprintId ? row : { ...row, selected: true }))}>Select all</button><button type="button" className="min-h-6 text-brand-text underline" disabled={busy} onClick={() => setPages(current => current.map(row => row.blueprintId ? row : { ...row, selected: false }))}>Clear selection</button></div> : null}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{pages.map(row => <article key={row.page} aria-label={`PDF page ${row.page}`} className="space-y-3 rounded-xl border border-line bg-surface-muted/40 p-4">
          <div className="flex items-center justify-between gap-2"><label className="flex min-h-6 items-center gap-2 text-sm font-bold"><input type={existing ? "radio" : "checkbox"} name={`${formId}-page`} checked={existing ? page === row.page : row.selected} disabled={busy || Boolean(row.blueprintId)} onChange={event => existing ? setPage(row.page) : setPages(current => current.map(entry => entry.page === row.page ? { ...entry, selected: event.target.checked } : entry))} />Page {row.page}</label><button type="button" className="min-h-6 text-xs font-semibold text-brand-text underline" disabled={busy || previewing !== null} onClick={() => void showPreview(row.page)}>{previewing === row.page ? "Loading…" : preview?.page === row.page ? "Hide preview" : "Preview page"}</button></div>
          {preview?.page === row.page ? <img src={preview.url} alt={`Preview of PDF page ${row.page}`} className="max-h-72 w-full rounded-lg border border-line bg-white object-contain" /> : null}
          {!existing ? <><label className="block text-sm font-semibold">Page label *<input aria-label={`Label for PDF page ${row.page}`} className={field} maxLength={120} value={row.title} disabled={busy || !row.selected || Boolean(row.blueprintId)} onChange={event => setPages(current => current.map(entry => entry.page === row.page ? { ...entry, title: event.target.value } : entry))} /></label><label className="block text-sm font-semibold">Level / area<input aria-label={`Level or area for PDF page ${row.page}`} className={field} maxLength={40} value={row.level} disabled={busy || !row.selected || Boolean(row.blueprintId)} onChange={event => setPages(current => current.map(entry => entry.page === row.page ? { ...entry, level: event.target.value } : entry))} /></label></> : null}
          {row.saved ? <p role="status" className="text-xs font-semibold text-brand-text">Uploaded</p> : row.blueprintId ? <p className="text-xs text-fg-muted">Plan prepared. Retry to finish uploading this page.</p> : null}
          {errors.pages?.[row.page] ? <p role="alert" className="text-xs text-danger-fg">{errors.pages[row.page]}</p> : null}
        </article>)}</div>
      </section> : null}
      <label className="block text-sm font-semibold">Notes (what changed)<textarea className={field} rows={2} maxLength={500} value={notes} onChange={event => setNotes(event.target.value)} disabled={busy || started} /></label>
    </form>
  </Modal>
}
