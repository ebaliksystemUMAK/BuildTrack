import { useEffect, useRef, useState } from "react"
import { PhotoGrid, type GalleryPhoto } from "./PhotoGallery"
import CameraCapture from "./CameraCapture"
import IssuePhotoEditor from "./issues/IssuePhotoEditor"
import { MarkupLayer } from "./issues/MarkupLayer"
import { buttonPrimary, buttonSecondary, inputClass } from "./ui/PageParts"
import { useEvidencePhotos } from "../lib/dailyPhotos"
import { saveDailyReportCapture, type ReportCapture } from "../lib/dailyReportCapture"
import { usePhotoPolicy } from "../lib/photoPolicy"
import { captureStamp, type CaptureSource, type PhotoStamp } from "../lib/photoStamp"
import { compressPhoto } from "../lib/blueprints"
import { supabase } from "../lib/supabase"
import { useToast } from "../lib/toast"
import { useConfirm } from "../lib/confirm"

const MAX_PHOTOS = 50
export default function DailyReportPhotos({ projectId, reportId, editable = false, ensureDraft, onBusy }: {
  projectId: string; reportId: string | null; editable?: boolean; ensureDraft?: () => Promise<string | null>; onBusy?: (busy: boolean) => void
}) {
  const { photos, loading, error, reload } = useEvidencePhotos(projectId, "daily", reportId)
  const latestReload = useRef(reload); latestReload.current = reload
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [capture, setCapture] = useState<ReportCapture | null>(null)
  const [editing, setEditing] = useState(false)
  const [height, setHeight] = useState(750)
  const toast = useToast()
  const confirm = useConfirm()
  const policy = usePhotoPolicy(projectId)
  const fileInput = useRef<HTMLInputElement>(null)
  const [captureError, setCaptureError] = useState("")
  const parentBusy = useRef(onBusy); parentBusy.current = onBusy
  useEffect(() => { parentBusy.current?.(busy || cameraOpen || Boolean(capture)) }, [busy, cameraOpen, capture])
  useEffect(() => () => parentBusy.current?.(false), [])
  useEffect(() => { const url = capture?.url; return () => { if (url) URL.revokeObjectURL(url) } }, [capture?.url])

  const keep = (file: File, stamp: PhotoStamp, source: CaptureSource) => {
    setCapture({ id: crypto.randomUUID(), file, stamp, source, url: URL.createObjectURL(file), caption: "", annotations: [] }); setEditing(true)
  }
  // Uploads off: the photo must be taken at the project site (the database checks it again when it is saved).
  const captured = (file: File, stamp: PhotoStamp) => {
    setCameraOpen(false)
    const problem = policy.problem(stamp)
    setCaptureError(problem)
    if (!problem) keep(file, stamp, "camera")
  }
  const chooseFile = async (file: File | undefined) => {
    if (!file || policy.allowUpload !== true || working.current) return
    working.current = true; setBusy(true); setCaptureError("")
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose a photo (JPEG, PNG or WebP).")
      const stamp = captureStamp()
      const blob = await compressPhoto(file)
      keep(new File([blob], `daily-report-${Date.now()}.jpg`, { type: "image/jpeg" }), await stamp, "upload")
    } catch (problem) { setCaptureError(problem instanceof Error ? problem.message : "That photo could not be read.") }
    finally { working.current = false; setBusy(false) }
  }

  const save = async () => {
    if (!editable || !capture || working.current) return
    working.current = true; setBusy(true)
    try {
      if (!navigator.onLine) throw new Error("Connect to save this photo. Keep this page open and retry when online.")
      if (photos.length >= MAX_PHOTOS) throw new Error(`This report already has ${MAX_PHOTOS} photos.`)
      const id = reportId ?? await ensureDraft?.()
      if (!id) return
      await saveDailyReportCapture(projectId, id, capture)
      setCapture(null); setEditing(false)
      toast.success("Report photo saved", "The original and its annotations are saved together.")
    } catch (problem) { toast.error("Photo not saved", (problem as { message?: string }).message ?? "Check your connection and retry.") }
    finally { working.current = false; setBusy(false); await latestReload.current() }
  }
  const discard = async () => {
    if (working.current) return
    if (capture && !await confirm({ title: "Discard this capture?", message: "The photo, caption and annotations have not been saved.", confirmLabel: "Discard photo", tone: "danger" })) return
    setCapture(null); setEditing(false)
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
  return <section aria-label="Report photos" className="space-y-3">
    <h3 className="text-sm font-extrabold">Daily progress photos</h3>
    {editable ? <>
      <p className="text-sm text-fg-muted">{policy.cameraOnly ? "Take a photo with the camera at the project site (location must be on), annotate it or add a caption, then save it to this report. Photo uploads are turned off by the administrator."
        : policy.allowUpload ? "Take a photo with the camera or upload one from this device, annotate it or add a caption, then save it to this report."
        : "Take a photo with the camera, annotate it or add a caption, then save it to this report."}</p>
      {!capture ? <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || loading || cameraOpen || Boolean(error) || photos.length >= MAX_PHOTOS} className={buttonSecondary} onClick={() => { setCaptureError(""); setCameraOpen(true) }}>Take photo</button>
        {policy.allowUpload ? <>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { void chooseFile(event.target.files?.[0]); event.target.value = "" }} />
          <button type="button" disabled={busy || loading || cameraOpen || Boolean(error) || photos.length >= MAX_PHOTOS} className={buttonSecondary} onClick={() => fileInput.current?.click()}>Upload photo</button>
        </> : null}
      </div> : <div className="space-y-3 rounded-xl border border-brand bg-brand-soft p-3">
        <div className="relative overflow-hidden rounded-lg bg-black/10"><img src={capture.url} alt="Unsaved daily progress capture" className="max-h-80 w-full object-contain" onLoad={event => setHeight(1000 * event.currentTarget.naturalHeight / event.currentTarget.naturalWidth)} /><svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full"><MarkupLayer items={capture.annotations} height={height} /></svg></div>
        <label className="block text-sm font-semibold">Photo caption (optional)<textarea className={`${inputClass} mt-1`} rows={2} maxLength={1000} disabled={busy} value={capture.caption} onChange={event => setCapture({ ...capture, caption: event.target.value })} /></label>
        <p role="status" className="text-xs font-semibold text-brand-text">Unsaved {capture.source === "upload" ? "uploaded" : "camera"} photo{capture.annotations.length ? ` · ${capture.annotations.length} annotations` : ""}. Save or discard it before submitting the report.</p>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className={buttonSecondary} disabled={busy} onClick={() => void discard()}>Discard photo</button><button type="button" className={buttonSecondary} disabled={busy} onClick={() => setEditing(true)}>Annotate photo</button><button type="button" className={buttonPrimary} disabled={busy} onClick={() => void save()}>{busy ? "Saving photo..." : "Save photo to report"}</button></div>
      </div>}
      {captureError ? <p role="alert" className="text-sm text-danger-fg">Photo not accepted: {captureError}</p> : null}
      <p className="text-xs text-fg-muted">{photos.length} of {MAX_PHOTOS} photos saved. A new report is saved as a draft before its first photo. Camera access requires HTTPS or localhost and browser permission.</p>
    </> : null}
    {cameraOpen && editable ? <CameraCapture onClose={() => setCameraOpen(false)} onCapture={captured} /> : null}
    {editing && capture && editable ? <IssuePhotoEditor title="Annotate daily progress photo" captionLimit={1000} photos={[{ id: capture.id, src: capture.url, caption: capture.caption, annotations: capture.annotations }]} onClose={() => setEditing(false)} onSave={changes => { const changed = changes.find(change => change.id === capture.id); if (changed) setCapture({ ...capture, annotations: changed.annotations, caption: changed.caption }) }} /> : null}
    {error ? <p role="alert" className="text-sm text-danger-fg">{error} <button type="button" onClick={() => void reload()} className="underline">Retry</button></p> : <PhotoGrid photos={photos} bucket="daily-photos" loading={loading} emptyHint="No photos for this daily progress report yet." onRemove={editable && !busy && !capture && !cameraOpen ? photo => void remove(photo) : undefined} />}
  </section>
}
