import { useEffect, useRef, useState } from "react"
import { PhotoGrid, type GalleryPhoto } from "./PhotoGallery"
import CameraCapture from "./CameraCapture"
import IssuePhotoEditor from "./issues/IssuePhotoEditor"
import { MarkupLayer } from "./issues/MarkupLayer"
import { buttonPrimary, buttonSecondary, inputClass } from "./ui/PageParts"
import { useEvidencePhotos } from "../lib/dailyPhotos"
import { photosOutsideTasks } from "../lib/photoGalleryModel"
import { saveDailyReportCapture, type ReportCapture } from "../lib/dailyReportCapture"
import { usePhotoPolicy } from "../lib/photoPolicy"
import { captureStamp, type CaptureSource, type PhotoStamp } from "../lib/photoStamp"
import { compressPhoto } from "../lib/blueprints"
import { supabase } from "../lib/supabase"
import { useToast } from "../lib/toast"
import { useConfirm } from "../lib/confirm"

const MAX_PHOTOS = 50

// One photo waiting to be saved: its preview with annotations, and its caption.
function PendingPhoto({ capture, busy, onCaption, onAnnotate, onDiscard }: { capture: ReportCapture; busy: boolean; onCaption: (caption: string) => void; onAnnotate: () => void; onDiscard: () => void }) {
  const [height, setHeight] = useState(750)
  return <li className="space-y-2 rounded-lg border border-line bg-surface p-2">
    <div className="relative overflow-hidden rounded-lg bg-black/10"><img src={capture.url} alt="Unsaved task photo" className="max-h-60 w-full object-contain" onLoad={event => setHeight(1000 * event.currentTarget.naturalHeight / event.currentTarget.naturalWidth)} /><svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full"><MarkupLayer items={capture.annotations} height={height} /></svg></div>
    <label className="block text-sm font-semibold">Photo caption (optional)<textarea className={`${inputClass} mt-1`} rows={2} maxLength={1000} disabled={busy} value={capture.caption} onChange={event => onCaption(event.target.value)} /></label>
    <p className="text-xs font-semibold text-brand-text">{capture.source === "upload" ? "Uploaded" : "Camera"} photo{capture.annotations.length ? ` · ${capture.annotations.length} annotations` : ""}</p>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonSecondary} disabled={busy} onClick={onDiscard}>Discard photo</button><button type="button" className={buttonSecondary} disabled={busy} onClick={onAnnotate}>Annotate photo</button></div>
  </li>
}
// All the panels of one report share one read of its photos (evidence: a report can have many task entries); the limit of 50 is for the whole report.
// entryId: the photos of that task entry, which is where new photos are added. Without it: the photos under no task (taskIds), which stay visible and removable.
export default function DailyReportPhotos({ projectId, evidence, editable = false, ensureDraft, onBusy, entryId, taskIds = [] }: {
  projectId: string; evidence: ReturnType<typeof useEvidencePhotos>; editable?: boolean; ensureDraft?: () => Promise<string | null>; onBusy?: (busy: boolean) => void
  entryId?: string; taskIds?: string[]
}) {
  const { photos, loading, error, reload } = evidence
  const shown = entryId ? photos.filter(photo => photo.entry_id === entryId) : photosOutsideTasks(photos, taskIds)
  const canAdd = editable && Boolean(entryId)
  const latestReload = useRef(reload); latestReload.current = reload
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [captures, setCaptures] = useState<ReportCapture[]>([])
  const [editing, setEditing] = useState(false)
  const [editStart, setEditStart] = useState(0)
  const previews = useRef<string[]>([])
  const toast = useToast()
  const confirm = useConfirm()
  const policy = usePhotoPolicy(projectId)
  const fileInput = useRef<HTMLInputElement>(null)
  const [captureError, setCaptureError] = useState("")
  const parentBusy = useRef(onBusy); parentBusy.current = onBusy
  useEffect(() => { parentBusy.current?.(busy || cameraOpen || captures.length > 0) }, [busy, cameraOpen, captures.length])
  useEffect(() => () => parentBusy.current?.(false), [])
  // A preview's file is released once its photo has left the list, and when the panel closes.
  useEffect(() => {
    const urls = captures.map(row => row.url)
    previews.current.filter(url => !urls.includes(url)).forEach(url => URL.revokeObjectURL(url))
    previews.current = urls
  }, [captures])
  useEffect(() => () => previews.current.forEach(url => URL.revokeObjectURL(url)), [])
  const room = MAX_PHOTOS - photos.length - captures.length

  // New photos open in the annotation editor, which moves between all the unsaved photos of this task.
  const keep = (added: Array<{ file: File; stamp: PhotoStamp; source: CaptureSource }>) => {
    setEditStart(captures.length)
    setCaptures(current => [...current, ...added.map(row => ({ ...row, id: crypto.randomUUID(), url: URL.createObjectURL(row.file), caption: "", annotations: [] }))])
    setEditing(true)
  }
  // Uploads off: the photo must be taken at the project site (the database checks it again when it is saved).
  const captured = (file: File, stamp: PhotoStamp) => {
    setCameraOpen(false)
    const problem = policy.problem(stamp)
    setCaptureError(problem)
    if (!problem) keep([{ file, stamp, source: "camera" }])
  }
  const chooseFiles = async (files: File[]) => {
    if (!files.length || policy.allowUpload !== true || working.current) return
    working.current = true; setBusy(true); setCaptureError("")
    const problems = files.length > room ? [`${files.length - room} not added: one report can hold ${MAX_PHOTOS} photos.`] : []
    const stamp = captureStamp()
    const added: Array<{ file: File; stamp: PhotoStamp; source: CaptureSource }> = []
    for (const file of files.slice(0, Math.max(room, 0))) {
      try {
        if (!file.type.startsWith("image/")) throw new Error("Not a photo")
        const blob = await compressPhoto(file)
        added.push({ file: new File([blob], `daily-report-${Date.now()}.jpg`, { type: "image/jpeg" }), stamp: await stamp, source: "upload" })
      } catch { problems.push(`${file.name} could not be read. Choose a JPEG, PNG or WebP photo.`) }
    }
    if (added.length) keep(added)
    setCaptureError(problems.join(" "))
    working.current = false; setBusy(false)
  }

  // A photo that saved leaves the list at once, so a failure part way keeps only the photos still to send. Each one keeps its path, so a retry cannot repeat it.
  const save = async () => {
    if (!canAdd || !captures.length || working.current) return
    working.current = true; setBusy(true)
    let saved = 0
    try {
      if (!navigator.onLine) throw new Error("Connect to save these photos. Keep this page open and retry when online.")
      if (photos.length + captures.length > MAX_PHOTOS) throw new Error(`One report can hold ${MAX_PHOTOS} photos. Discard ${photos.length + captures.length - MAX_PHOTOS} first.`)
      // A task entry must be saved before a photo can point at it, even when the report already exists.
      const id = await ensureDraft?.()
      if (!id) return
      for (const capture of captures) {
        await saveDailyReportCapture(projectId, id, capture, entryId)
        saved++
        setCaptures(current => current.filter(row => row.id !== capture.id))
      }
      setEditing(false)
      toast.success(saved === 1 ? "Task photo saved" : `${saved} task photos saved`, "The originals and their annotations are saved together.")
    } catch (problem) { toast.error(saved ? `${saved} saved, the rest were not` : "Photo not saved", (problem as { message?: string }).message ?? "Check your connection and retry.") }
    finally { working.current = false; setBusy(false); await latestReload.current() }
  }
  const discard = async (capture: ReportCapture) => {
    if (working.current || !await confirm({ title: "Discard this photo?", message: "The photo, caption and annotations have not been saved.", confirmLabel: "Discard photo", tone: "danger" })) return
    setCaptures(current => current.filter(row => row.id !== capture.id))
  }
  const remove = async (photo: GalleryPhoto) => {
    if (working.current || !await confirm({ title: "Remove this photo?", message: "This draft photo will be removed.", confirmLabel: "Remove photo", tone: "danger" })) return
    working.current = true; setBusy(true)
    try {
      const result = await supabase.from("daily_report_photos").delete().eq("id", photo.id).select("id")
      if (result.error) throw result.error
      if (!result.data?.length) throw new Error("Photo was not removed. Refresh and check your access.")
      const storage = await supabase.storage.from("daily-photos").remove([photo.path])
      if (storage.error) toast.error("Photo record removed", "The unused file could not be cleaned up.")
      else toast.success("Photo removed")
    } catch (problem) { toast.error("Could not remove photo", (problem as { message?: string }).message ?? "Please retry.") }
    finally { working.current = false; setBusy(false); await latestReload.current() }
  }
  return <section aria-label={entryId ? "Task photos" : "Report photos"} className="space-y-3">
    <h3 className="text-sm font-extrabold">{entryId ? "Task photos" : taskIds.length ? "Other photos on this report" : "Daily progress photos"}</h3>
    {editable && !entryId ? <p className="text-xs text-fg-muted">These photos are not attached to a task. Add new photos under each task.</p> : null}
    {canAdd ? <>
      <p className="text-xs text-fg-muted">{policy.cameraOnly ? "Take photos with the camera at the project site (location must be on), annotate them or add captions, then save them to this task. Photo uploads are turned off by the administrator."
        : policy.allowUpload ? "Take photos with the camera or upload several from this device, annotate them or add captions, then save them to this task."
        : "Take photos with the camera, annotate them or add captions, then save them to this task."}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || loading || cameraOpen || Boolean(error) || room <= 0} className={buttonSecondary} onClick={() => { setCaptureError(""); setCameraOpen(true) }}>Take photo</button>
        {policy.allowUpload ? <>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { void chooseFiles(Array.from(event.target.files ?? [])); event.target.value = "" }} />
          <button type="button" disabled={busy || loading || cameraOpen || Boolean(error) || room <= 0} className={buttonSecondary} onClick={() => fileInput.current?.click()}>Upload photos</button>
        </> : null}
      </div>
      {captures.length ? <div className="space-y-3 rounded-xl border border-brand bg-brand-soft p-3">
        <ul className="grid gap-3 @md:grid-cols-2">{captures.map((row, index) => <PendingPhoto key={row.id} capture={row} busy={busy} onCaption={caption => setCaptures(current => current.map(item => item.id === row.id ? { ...item, caption } : item))} onAnnotate={() => { setEditStart(index); setEditing(true) }} onDiscard={() => void discard(row)} />)}</ul>
        <p role="status" className="text-xs font-semibold text-brand-text">{captures.length === 1 ? "1 unsaved photo" : `${captures.length} unsaved photos`}. Save or discard before submitting the report.</p>
        <div className="flex justify-end"><button type="button" className={buttonPrimary} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : captures.length === 1 ? "Save photo to task" : `Save ${captures.length} photos to task`}</button></div>
      </div> : null}
      {captureError ? <p role="alert" className="text-sm text-danger-fg">Photo not accepted: {captureError}</p> : null}
      <p className="text-xs text-fg-muted">{photos.length} of {MAX_PHOTOS} photos saved on this report. The draft is saved before a task's first photo. Camera access requires HTTPS or localhost and browser permission.</p>
    </> : null}
    {cameraOpen && canAdd ? <CameraCapture onClose={() => setCameraOpen(false)} onCapture={captured} /> : null}
    {editing && captures.length && canAdd ? <IssuePhotoEditor title="Annotate daily progress photo" captionLimit={1000} start={editStart} photos={captures.map(row => ({ id: row.id, src: row.url, caption: row.caption, annotations: row.annotations }))} onClose={() => setEditing(false)} onSave={changes => setCaptures(current => current.map(row => { const changed = changes.find(change => change.id === row.id); return changed ? { ...row, annotations: changed.annotations, caption: changed.caption } : row }))} /> : null}
    {error ? <p role="alert" className="text-sm text-danger-fg">{error} <button type="button" onClick={() => void reload()} className="underline">Retry</button></p> : entryId && !loading && !shown.length ? <p className="text-xs text-fg-muted">No photos for this task yet.</p> : <PhotoGrid photos={shown} bucket="daily-photos" loading={loading} emptyHint="No photos for this daily progress report yet." onRemove={editable && !busy && !captures.length && !cameraOpen ? photo => void remove(photo) : undefined} />}
  </section>
}
