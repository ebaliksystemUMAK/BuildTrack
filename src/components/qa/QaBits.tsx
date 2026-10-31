import { useEffect, useRef, useState } from "react"
import Modal from "../Modal"
import PhotoViewer from "../PhotoViewer"
import IssuePhotoPicker from "../issues/IssuePhotoPicker"
import { MarkupLayer } from "../issues/MarkupLayer"
import { useSignedUrl } from "../../lib/blueprints"
import { QA_CAPTION_LIMIT, prepareQaPhoto, removeQaPhoto, uploadQaPhoto, qaSeverityLabels, severityTone, type PhotoTarget, type QaPhoto, type QaSeverity } from "../../lib/qa"
import type { IssuePhotoDraft } from "../../lib/siteIssues"
import { useConfirm } from "../../lib/confirm"
import { errorText, useToast } from "../../lib/toast"
import { buttonPrimary, buttonSecondary } from "../ui/PageParts"
import { captureStamp, stampSummary, photoPreviewBlocked, type CaptureSource, type PhotoStamp } from "../../lib/photoStamp"
import { usePhotoPolicy } from "../../lib/photoPolicy"
import CameraCapture from "../CameraCapture"
import { useAuth } from "../../lib/auth"
import { useProjectTeam } from "../../lib/projects"

const BATCH = 6 // photos added in one go

export function Chip({ tone, children, title }: { tone: string; children: React.ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${tone}`}>{children}</span>
}

export const SeverityChip = ({ severity }: { severity: QaSeverity }) => <Chip tone={severityTone[severity]}>{qaSeverityLabels[severity]}</Chip>

export const HoldChip = () => (
  <Chip tone="bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-200" title="Hold point: work may not go on until the engineer has passed this item">
    Hold point
  </Chip>
)

// Score with the pass mark drawn on the bar.
export function ScoreBar({ score, threshold, label = "Score" }: { score: number | null; threshold: number; label?: string }) {
  const value = score ?? 0
  const good = score !== null && score >= threshold
  return (
    <div role="img" aria-label={score === null ? `${label}: not judged yet` : `${label} ${score} percent, pass mark ${threshold} percent`}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-bold uppercase tracking-wider text-fg-muted">{label}</span>
        <span className="font-extrabold tabular-nums">{score === null ? "-" : `${score}%`} <span className="font-semibold text-fg-muted">/ pass mark {threshold}%</span></span>
      </div>
      <div className="relative mt-1 h-2.5 overflow-hidden rounded-full bg-surface-muted">
        <div className={`h-full rounded-full transition-all ${score === null ? "" : good ? "bg-green-600" : "bg-red-600"}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `${threshold}%` }} aria-hidden="true" />
      </div>
    </div>
  )
}

// The thumbnail is cropped (object-cover), so the markup layer is cropped the same way ("slice"); a pen badge marks it.
function Thumb({ photo, className }: { photo: QaPhoto; className: string }) {
  const { profile } = useAuth()
  const blocked = photoPreviewBlocked(profile?.role, photo)
  const { url, failed } = useSignedUrl("qa-evidence", blocked ? null : photo.path)
  const [height, setHeight] = useState(750)
  const markup = photo.annotations ?? []
  if (blocked) return <div className={`${className} flex items-center justify-center bg-danger-soft p-1 text-[10px] text-danger-fg`}>Site/time check failed</div>
  if (failed) return <div className={`${className} flex items-center justify-center bg-surface-muted text-[11px] text-fg-muted`}>Unavailable</div>
  if (!url) return <div className={`${className} skeleton`} aria-hidden="true" />
  if (!markup.length) return <img src={url} alt={photo.caption ?? "Evidence photo"} loading="lazy" className={`${className} object-cover`} />
  return (
    <span className={`relative block ${className}`}>
      <img src={url} alt={photo.caption ?? "Marked-up evidence photo"} loading="lazy" className="h-full w-full object-cover" onLoad={(event) => setHeight((1000 * event.currentTarget.naturalHeight) / event.currentTarget.naturalWidth)} />
      <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"><MarkupLayer items={markup} height={height} /></svg>
      <span title="Marked up" className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
      </span>
    </span>
  )
}

// Evidence photos for one item, inspection or defect: thumbnails with a viewer, and an add button when the person may add.
// Chosen photos open the same markup editor as client reports and site issues (text, lines, arrows, shapes, drawing) before
// they are added; the file stays the original and the markup is saved over it.
export function EvidenceStrip({
  projectId,
  photos,
  target,
  canAdd,
  canRemove,
  onChanged,
  label,
  compact = false,
}: {
  projectId: string
  photos: QaPhoto[]
  target: PhotoTarget
  canAdd: boolean
  canRemove?: (photo: QaPhoto) => boolean
  onChanged: () => void | Promise<void>
  label: string
  compact?: boolean
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const { team } = useProjectTeam(projectId)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [drafts, setDrafts] = useState<IssuePhotoDraft[] | null>(null) // chosen, waiting for markup and "Add"
  const [draftError, setDraftError] = useState("")
  const [viewing, setViewing] = useState<QaPhoto | null>(null)
  const stamp = useRef<Promise<PhotoStamp> | null>(null)
  const urls = useRef(new Set<string>())
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url) }, [])
  const size = compact ? "h-12 w-12" : "h-16 w-16"
  // Camera only (company switch off for a Foreman, or the person's own "Camera only" choice in System settings): evidence comes
  // only from the in-app camera at the project site (enforced by the database too).
  const policy = usePhotoPolicy(projectId)
  const cameraOnly = policy.qaCameraOnly
  const [cameraOpen, setCameraOpen] = useState(false)
  const [draftSource, setDraftSource] = useState<CaptureSource>("upload")

  const choose = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (input.current) input.current.value = ""
    if (!list.length || cameraOnly) return
    void prepareDrafts(list, "upload", captureStamp()) // the phone's time and (if allowed) position when chosen, checked against the site by the database
  }
  const captured = (file: File, where: PhotoStamp) => {
    setCameraOpen(false)
    const problem = policy.problem(where)
    if (problem) return toast.error("Photo not accepted", problem)
    void prepareDrafts([file], "camera", Promise.resolve(where))
  }

  // Each picture is shrunk before it is shown, so the markup sits on exactly the pixels that are stored.
  const prepareDrafts = async (list: File[], from: CaptureSource, where: Promise<PhotoStamp>) => {
    stamp.current = where
    setDraftSource(from)
    setPreparing(true)
    const ready: IssuePhotoDraft[] = []
    const problems: string[] = []
    for (const file of list.slice(0, BATCH)) {
      try {
        const prepared = await prepareQaPhoto(file)
        const url = URL.createObjectURL(prepared)
        urls.current.add(url)
        ready.push({ id: crypto.randomUUID(), file: prepared, url, caption: "", annotations: [] })
      } catch (error) {
        problems.push(`${file.name}: ${errorText(error)}`)
      }
    }
    setPreparing(false)
    if (list.length > BATCH) problems.push(`Only the first ${BATCH} photos were taken; add the rest after these.`)
    setDraftError(problems.join(" "))
    if (ready.length) setDrafts(ready)
    else toast.error("Photo not added", problems.join(" "))
  }

  const close = () => {
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current.clear()
    stamp.current = null
    setDrafts(null)
    setDraftError("")
  }

  const cancel = async () => {
    if (busy || preparing || !drafts) return
    const worked = drafts.some((draft) => draft.annotations.length || draft.caption.trim())
    if (worked && !(await confirm({ title: "Discard these photos?", message: "They have not been added, and their markup will be lost.", confirmLabel: "Discard", tone: "danger" }))) return
    close()
  }

  // Photos that fail stay in the dialog to retry; the ones that were added leave it.
  const add = async () => {
    if (!drafts?.length || busy || preparing) return
    setBusy(true)
    setDraftError("")
    const where = await (stamp.current ?? captureStamp())
    const failed: IssuePhotoDraft[] = []
    let reason = ""
    for (const draft of drafts) {
      try {
        await uploadQaPhoto(projectId, target, draft, where, draftSource)
      } catch (error) {
        failed.push(draft)
        reason ||= errorText(error)
      }
    }
    setBusy(false)
    const added = drafts.length - failed.length
    if (added) {
      toast.success(added > 1 ? `${added} photos added` : "Photo added")
      await onChanged()
    }
    if (!failed.length) return close()
    setDrafts(failed)
    setDraftError(`${failed.length === 1 ? "A photo was" : `${failed.length} photos were`} not added: ${reason.replace(/[.\s]*$/, ".")} Try again, or remove ${failed.length === 1 ? "it" : "them"}.`)
  }

  const remove = async (photo: QaPhoto) => {
    if (!(await confirm({ title: "Remove this photo?", message: "It is deleted from the evidence for good.", confirmLabel: "Remove", tone: "danger" }))) return
    const problem = await removeQaPhoto(photo)
    if (problem) return toast.error("Not removed", problem)
    setViewing(null)
    await onChanged()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {photos.map((photo) => (
        <button key={photo.id} type="button" onClick={() => setViewing(photo)} aria-label={`View photo: ${photo.caption ?? label}`} className="overflow-hidden rounded-lg border border-line transition hover:ring-2 hover:ring-brand">
          <Thumb photo={photo} className={size} />
        </button>
      ))}
      {stampSummary(photos) ? <p role="status" className="w-full rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Check these photos: {stampSummary(photos)}.</p> : null}
      {canAdd ? (
        <>
          <button type="button" disabled={busy || preparing || cameraOpen || Boolean(drafts)} onClick={() => (cameraOnly ? setCameraOpen(true) : input.current?.click())} aria-label={cameraOnly ? `Take a photo: ${label}` : `Add a photo: ${label}`} className={`flex ${size} flex-col items-center justify-center rounded-lg border border-dashed border-line text-fg-muted transition hover:border-brand hover:bg-brand-soft hover:text-brand-text disabled:opacity-60`}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-2h6l2 2h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            <span className="text-[11px] font-bold">{busy || preparing ? "..." : cameraOnly ? "Camera" : "Photo"}</span>
          </button>
          {!cameraOnly ? <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" multiple hidden onChange={(event) => choose(event.target.files)} /> : null}
        </>
      ) : null}
      {cameraOpen ? <CameraCapture title={`Take a photo: ${label}`} description="Photo uploads are turned off: take the photo here at the project site with location turned on. You can mark it up before adding it." fileName="qa-evidence" onClose={() => setCameraOpen(false)} onCapture={captured} /> : null}
      {drafts ? (
        <Modal
          title={`Add photos: ${label}`}
          description="Mark up each photo before adding it: text, lines, arrows, shapes or drawing. The original photo is kept and the markup is saved over it."
          size="xl"
          onClose={() => void cancel()}
          footer={
            <>
              <button type="button" className={buttonSecondary} disabled={busy || preparing} onClick={() => void cancel()}>Cancel</button>
              <button type="button" className={buttonPrimary} disabled={busy || preparing || !drafts.length} onClick={() => void add()}>{busy ? "Adding..." : drafts.length > 1 ? `Add ${drafts.length} photos` : "Add photo"}</button>
            </>
          }
        >
          <IssuePhotoPicker photos={drafts} onChange={setDrafts} limit={BATCH} disabled={busy} prepare={prepareQaPhoto} onPreparing={setPreparing} captionLimit={QA_CAPTION_LIMIT} nameCaptions={false} editorTitle="Mark up evidence photo" allowFiles={draftSource === "upload"}
            hint={draftSource === "upload" ? `Up to ${BATCH} photos at a time. Use Edit / annotate to mark one up and give it a caption; the original photo is kept.` : "Use Edit / annotate to mark it up and give it a caption; the original photo is kept. Take another photo after adding this one."} />
          {draftError ? <p role="alert" className="mt-3 text-sm text-danger-fg">{draftError}</p> : null}
        </Modal>
      ) : null}
      {viewing ? <PhotoViewer key={viewing.id} bucket="qa-evidence" photo={{...viewing,label,uploaderName:team.find(row=>row.user_id===viewing.uploaded_by)?.full_name}} onClose={()=>setViewing(null)} actions={canRemove?.(viewing) ? <button type="button" className={buttonSecondary} onClick={() => void remove(viewing)}>Remove</button> : null} /> : null}
    </div>
  )
}
