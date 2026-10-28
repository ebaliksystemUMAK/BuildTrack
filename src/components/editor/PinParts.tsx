import { Suspense, lazy, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import LimitedTimeline from "../ui/LimitedTimeline"
import PhotoViewer from "../PhotoViewer"
import { Skeleton, SkeletonList } from "../ui/Skeleton"
import BeforeAfter from "../BeforeAfter"
import StampChip from "../StampChip"
import WorkChecklistEditor from "../qa/WorkChecklistEditor"
import { usePinQa } from "../../lib/pinQa"
import { captureStamp, stampFields, stampSummary, photoEligible, photoPreviewBlocked, type PhotoStamp } from "../../lib/photoStamp"
import MarkupUploadDialog, { type UploadOutcome } from "../issues/MarkupUploadDialog"
import { MarkupLayer } from "../issues/MarkupLayer"
import { markupProblem } from "../../lib/issueMarkup"
import type { IssuePhotoDraft } from "../../lib/siteIssues"
import { StageChip } from "../qa/WorkItemParts"
import { useWorkQaHistory } from "../../lib/qaAttempts"
import { stageOf, usePinDefects } from "../../lib/workItem"
import type { SubmissionRef } from "../../lib/workItemModel"
import {
  categoryLabels,
  compressPhoto,
  severityLabels,
  formatStamp,
  statusDot,
  statusLabels,
  useChecklist,
  usePinEvidence,
  usePinPhotos,
  usePinTimeline,
  useSignedUrl,
  type ChecklistItem,
  type Pin,
  type PinCategory,
  type PinSeverity,
  type PinPhoto,
  type PinStatus,
  type TimelineEntry,
} from "../../lib/blueprints"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { isNetworkProblem } from "../../lib/offlineModel"
import { enqueue } from "../../lib/offlineQueue"
import { disciplineLabels, type Discipline, type TeamMember } from "../../lib/projects"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"

// Loaded on demand: the work item workspace also uses the parts below.
const WorkItemWorkspace = lazy(() => import("../qa/WorkItemWorkspace"))

export const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"

export function dbMessage(error: { code?: string; message: string }): string {
  if (error.code === "42501" || /row-level security/i.test(error.message)) return "You are not allowed to do that."
  if (/Only an Engineer can change/i.test(error.message)) return "Only an Engineer can change the checklist items; you can tick them off."
  if (/network|fetch/i.test(error.message)) return "Network problem. Check your connection and try again."
  return error.message
}

// ---------- Progress tracker: Not started > In progress > For review > Verified (an Issue interrupts it) ----------
const steps: PinStatus[] = ["not_started", "in_progress", "verified"]

// White or dark text, whichever reads better on the status colour (WCAG contrast).
const readableOn = (hex: string) => {
  const channel = (start: number) => {
    const v = parseInt(hex.slice(start, start + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const lum = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return 1.05 / (lum + 0.05) >= (lum + 0.05) / 0.0598 ? "#ffffff" : "#1c1722"
}

export function ProgressTracker({ status }: { status: PinStatus }) {
  const index = status === "issue" || status === "for_review" ? 1 : steps.indexOf(status)
  return (
    <div>
      <ol className="flex items-center" aria-label="Progress">
        {steps.map((step, position) => {
          const reached = position <= index
          return (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <span
                className="flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 text-[11px] font-bold text-white transition-colors"
                style={{ background: reached ? statusDot[step] : "transparent", borderColor: reached ? statusDot[step] : "var(--line)", color: reached ? readableOn(statusDot[step]) : "var(--fg-muted)" }}
                aria-current={position === index ? "step" : undefined}
              >
                {reached ? "✓" : position + 1}
              </span>
              {position < steps.length - 1 ? <span className="mx-1 h-0.5 flex-1 rounded transition-colors" style={{ background: position < index ? statusDot[steps[position + 1]] : "var(--line)" }} /> : null}
            </li>
          )
        })}
      </ol>
      <div className="mt-1 flex justify-between text-[11px] font-semibold text-fg-muted">
        {steps.map((step) => <span key={step} className={step === status ? "text-fg" : ""}>{statusLabels[step]}</span>)}
      </div>
      {status === "issue" ? <p className="mt-2 rounded-lg bg-danger-soft px-2 py-1 text-xs font-semibold text-danger-fg">An issue was found. The engineer will reopen it when it is fixed.</p> : null}
    </div>
  )
}

// ---------- Checklist ----------
export function ChecklistProgress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-2" aria-label={`${done} of ${total} done`}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <span className="block h-full rounded-full bg-[#1ca875] transition-all" style={{ width: `${percent}%` }} />
      </span>
      <span className="text-xs font-semibold text-fg-muted">{done}/{total}</span>
    </div>
  )
}

// Work items of this work (FLOOR, WALL…). Each row shows its stage and the one next action; "Open" shows the item's whole QA record
// (evidence, inspection, corrections and NCRs, attempts). Photo controls live inside that record, not on these rows.
export function PinChecklist({ pin, canEdit, canTick, notice = "", onChange, onPinChanged }: { pin: Pin; canEdit: boolean; canTick: boolean; notice?: string; onChange?: (done: number, total: number) => void; onPinChanged?: () => void | Promise<void>; submissionNote?: string }) {
  const pinId = pin.id
  const qa = usePinQa(pinId)
  const editViewAllowed = canEdit
  const locked = !qa.state || Boolean(qa.error) || qa.state.status === "verified"
  canEdit = canEdit && !locked
  canTick = canTick && !locked
  const toast = useToast()
  const { profile } = useAuth()
  const engineer = profile?.role === "engineer"
  const editBlock = !editViewAllowed ? "This sheet view is read-only. Open the latest sheet revision and exit presentation mode to add checklist items."
    : qa.error ? `Could not check QA status: ${qa.error}. Retry the QA check below.`
    : !qa.state ? "Checking QA status before adding checklist items…"
    : qa.state.status === "verified" ? "This work is Completed. Reopen it from Details before adding checklist items."
    : ""
  // QA records are staff-only: clients see the items and whether each is completed, never the QA workspace.
  const staff = profile?.role !== "client" && profile?.role !== "user"
  const { items, loading, error: checklistError, reload } = useChecklist(pinId)
  const { photos, reload: reloadPhotos } = usePinPhotos(pinId)
  const history = useWorkQaHistory(pinId)
  const defects = usePinDefects(pinId)
  const [editing, setEditing] = useState<ChecklistItem | "new" | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const done = items.filter((item) => item.done).length
  const stages = useMemo(() => new Map(items.map((item) => [item.id, stageOf({
    item, pin, pinItems: items, submissions: history.submissions as unknown as SubmissionRef[], inspections: history.inspections, defects,
    draft: history.attempts.find((row) => row.item_id === item.id && !row.submitted_inspection_id) ?? null, photos,
  })])), [items, pin, history.submissions, history.inspections, history.attempts, defects, photos])
  const changed = useRef(onPinChanged)
  changed.current = onPinChanged
  useEffect(() => {
    if (qa.state && qa.state.status !== pin.status) void changed.current?.()
  }, [qa.state?.status, pin.status])

  useEffect(() => {
    onChange?.(done, items.length)
  }, [done, items.length, onChange])

  const refresh = async () => { await Promise.all([reload(), reloadPhotos(), history.reload(), qa.reload()]); await onPinChanged?.() }

  const remove = async (id: string) => {
    const { error } = await supabase.from("pin_checklist_items").delete().eq("id", id)
    if (error) return toast.error("Could not remove the item", dbMessage(error))
    await reload()
  }

  return (
    <div className="space-y-3">
      {engineer ? <section aria-label="Checklist actions" className="space-y-2 rounded-xl border border-line bg-surface-muted p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold">Checklist items</h3>
          <button type="button" disabled={Boolean(editBlock) || loading} aria-describedby={editBlock ? `checklist-add-reason-${pin.id}` : undefined} className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-60" onClick={() => setEditing("new")}>Add item &amp; criteria</button>
        </div>
        {editBlock ? <p id={`checklist-add-reason-${pin.id}`} role="status" className="text-xs text-fg-muted">{editBlock}</p> : <p className="text-xs text-fg-muted">Add a work item and its inspection criteria together.</p>}
        {qa.error ? <button type="button" onClick={() => void qa.reload()} className="text-xs font-bold text-brand-text underline">Retry QA check</button> : null}
      </section> : null}
      {checklistError ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger-fg">{checklistError}</p> : null}
      {notice && !canTick ? <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">{notice}</p> : null}
      {loading ? <SkeletonList rows={3} label="Loading the work items" /> : (
        <>
          {items.length ? <ChecklistProgress done={items.filter((item) => item.review_status === "verified").length} total={items.length} /> : <p className="text-sm text-fg-muted">{canEdit ? "No work items yet. Add the parts of this work the Foreman prepares and the Engineer completes one by one (e.g. FLOOR, WALL, CEILING)." : "No work items for this pin."}</p>}
          {items.length ? <p className="text-xs text-fg-muted">Completed by the Engineer: {items.filter((item) => item.review_status === "verified").length}/{items.length}</p> : null}
          <ul className="space-y-1">
            {items.map((item) => {
              const stage = stages.get(item.id)
              const fresh = !stage?.attempts.length && item.review_status !== "for_review" && item.review_status !== "verified"
              const count = photos.filter((photo) => photo.checklist_item_id === item.id && !photo.qa_attempt_id).length
              return (
                <li key={item.id} className="group flex items-start gap-2 rounded-lg border border-line p-3 hover:bg-surface-muted/60">
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{item.text}</span>
                      {stage && staff ? <StageChip stage={stage.view.stage} /> : !staff && item.review_status === "verified" ? <StageChip stage="completed" /> : !staff && item.review_status === "for_review" ? <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand-text">For review</span> : null}
                    </span>
                    {stage && staff ? <span className="mt-0.5 block text-xs text-fg-muted">{stage.view.blocker ? `Blocked: ${stage.view.blocker}` : `Next: ${stage.view.next}`}</span> : null}
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3">
                      {fresh ? <span className="text-[11px] text-fg-muted">{count} photo{count === 1 ? "" : "s"}{item.remark ? " · remark" : ""}</span> : null}
                      {canEdit && fresh ? <button type="button" onClick={() => setEditing(item)} className="min-h-6 text-[11px] font-bold text-brand-text underline underline-offset-2">Edit item &amp; criteria</button> : null}
                      {staff ? <button type="button" aria-haspopup="dialog" onClick={() => setOpenId(item.id)} className="min-h-6 text-[11px] font-bold text-brand-text underline underline-offset-2 hover:no-underline">Open {item.text}</button> : null}
                    </span>
                  </div>
                  {canEdit && item.review_status !== "verified" ? <button type="button" aria-label={`Remove ${item.text}`} onClick={() => void remove(item.id)} className="px-1 text-fg-muted opacity-0 hover:text-danger-fg focus:opacity-100 group-hover:opacity-100">&times;</button> : null}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {editing ? <WorkChecklistEditor pin={pin} item={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {openId ? <Suspense fallback={null}><WorkItemWorkspace itemId={openId} fromPlan onClose={() => setOpenId(null)} onChanged={refresh} /></Suspense> : null}
    </div>
  )
}

// ---------- Timeline + comments ----------
const describe = (entry: TimelineEntry) => {
  if (entry.kind === "status") return `changed status: ${statusLabels[entry.from_status ?? "not_started"]} → ${statusLabels[entry.to_status ?? "not_started"]}`
  if (entry.kind === "created") return "created the pin"
  if (entry.kind === "moved") return "moved the pin"
  if (entry.kind === "edited") return "edited the details"
  if (entry.kind === "photo") return `added a photo${entry.note ? `: ${entry.note}` : ""}`
  if (entry.kind === "photo_removed") return `removed a photo${entry.note && entry.note !== "Photo removed" ? `: ${entry.note}` : ""}`
  if (entry.kind === "checklist") return entry.note ?? "updated the checklist"
  if (entry.kind === "assigned") return entry.to_name ? (entry.from_name ? `reassigned the work from ${entry.from_name} to ${entry.to_name}` : `assigned the work to ${entry.to_name}`) : `removed the assignment${entry.from_name ? ` from ${entry.from_name}` : ""}`
  return "commented"
}

export function PinTimeline({ pinId, canComment, refreshKey = 0 }: { pinId: string; canComment: boolean; refreshKey?: number }) {
  const toast = useToast()
  const { entries, loading, reload } = usePinTimeline(pinId)
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (refreshKey) void reload()
  }, [refreshKey, reload])

  const post = async (event: FormEvent) => {
    event.preventDefault()
    if (!comment.trim()) return
    setBusy(true)
    const { error } = await supabase.from("pin_events").insert({ pin_id: pinId, project_id: "00000000-0000-0000-0000-000000000000", kind: "comment", note: comment.trim().slice(0, 2000) })
    setBusy(false)
    if (error) return toast.error("Could not post the comment", dbMessage(error))
    setComment("")
    await reload()
  }

  return (
    <div className="space-y-3">
      {loading ? <SkeletonList rows={4} label="Loading the timeline" /> : entries.length === 0 ? <p className="text-sm text-fg-muted">No activity yet.</p> : (
        <LimitedTimeline entries={[...entries].reverse()} resetKey={pinId} entryKey={entry => entry.id} renderEntry={entry => <>
              <span className="font-semibold">{entry.actor_name}</span> <span className="text-fg-muted">{describe(entry)}</span>
              {entry.kind === "comment" && entry.note ? <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-muted px-2 py-1.5">{entry.note}</p> : null}
              <span className="block text-[11px] text-fg-muted">{formatStamp(entry.created_at)}</span>
            </>} />
      )}
      {canComment ? (
        <form className="flex gap-2" onSubmit={(event) => void post(event)}>
          <input className={field + " mt-0"} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" maxLength={2000} aria-label="Comment" />
          <button type="submit" disabled={busy || !comment.trim()} className="rounded-lg bg-brand px-3 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">Post</button>
        </form>
      ) : null}
    </div>
  )
}

// ---------- Photos ----------
function Thumb({ photo, onRemove }: { photo: PinPhoto; onRemove?: () => void }) {
  const { profile } = useAuth()
  const [viewing,setViewing] = useState(false)
  const [height,setHeight] = useState(750)
  const markup = photo.annotations ?? []
  const blocked = photoPreviewBlocked(profile?.role, photo)
  const { url, failed } = useSignedUrl("pin-photos", blocked ? null : photo.path)
  return (
    <><figure className="relative">
      {blocked ? <div className="flex h-24 items-center justify-center rounded-lg bg-danger-soft p-2 text-xs text-danger-fg">Image blocked: site/time check failed</div> : url ? (
        <button type="button" aria-label="Zoom photo and view details" onClick={()=>setViewing(true)} className="block w-full cursor-zoom-in">
          <span className="relative block">
            <img src={url} alt={photo.caption ?? `Pin photo added ${formatStamp(photo.created_at)}`} loading="lazy" onLoad={markup.length ? (event) => setHeight((1000 * event.currentTarget.naturalHeight) / event.currentTarget.naturalWidth) : undefined} className="block h-24 w-full rounded-lg border border-line object-cover transition hover:opacity-90" />
            {markup.length ? <>
              <svg viewBox={`0 0 1000 ${height}`} preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full rounded-lg" aria-hidden="true"><MarkupLayer items={markup} height={height} /></svg>
              <span title="Marked up" className="absolute bottom-1 left-1 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white" aria-hidden="true"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg></span>
            </> : null}
          </span>
        </button>
      ) : failed ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-line bg-surface-muted text-xs text-fg-muted">Unavailable</div>
      ) : (
        <Skeleton className="h-24 w-full" />
      )}
      {photo.caption ? <figcaption className="truncate text-[11px] text-fg-muted">{photo.caption}</figcaption> : null}
      <div className="mt-0.5"><StampChip photo={photo} /></div>
      {onRemove ? <button type="button" aria-label="Remove photo" onClick={onRemove} className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white hover:bg-black/80">&times;</button> : null}
    </figure>{viewing ? <PhotoViewer photo={{...photo,label:photo.checklist_item_id ? "Checklist evidence" : "Work photo"}} bucket="pin-photos" onClose={()=>setViewing(false)} /> : null}</>
  )
}

// Shrunk once before markup (JPEG, 1600 px), so the markup sits on exactly the stored pixels. Module-level: a stable function.
export async function preparePinPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("not an image")
  const blob = await compressPhoto(file)
  return new File([blob], `${file.name.replace(/\.[^.]*$/, "") || "photo"}.jpg`, { type: "image/jpeg", lastModified: file.lastModified })
}

// Uploads one prepared photo of a pin (optionally for one checklist item / correction) with its caption and markup. Without
// signal it waits in the offline queue on this device, markup included, and is sent when the connection is back.
function usePinPhotoUpload(pin: Pin, checklistItemId: string | undefined, attemptId?: string | null) {
  const { profile } = useAuth()
  const itemLink = { ...(checklistItemId ? { checklist_item_id: checklistItemId } : {}), ...(attemptId ? { qa_attempt_id: attemptId } : {}) }
  return async (draft: IssuePhotoDraft, stamp: PhotoStamp | null): Promise<UploadOutcome> => {
    const problem = markupProblem(draft.annotations)
    if (problem) throw new Error(problem)
    const path = `${pin.project_id}/${pin.id}/${crypto.randomUUID()}.jpg`
    const caption = draft.caption.trim().slice(0, 200)
    const extra = { ...(caption ? { caption } : {}), ...(draft.annotations.length ? { annotations: draft.annotations } : {}) }
    const keepOffline = async (): Promise<UploadOutcome> => {
      if (!profile) throw new Error("You are signed out.")
      await enqueue({ userId: profile.id, kind: "pin_photo", label: pin.title, payload: { projectId: pin.project_id, pinId: pin.id, itemId: checklistItemId ?? null, attemptId: attemptId ?? null, path, blob: draft.file, stamp, ...extra } })
      return "queued"
    }
    if (!navigator.onLine) return keepOffline()
    const upload = await supabase.storage.from("pin-photos").upload(path, draft.file, { contentType: "image/jpeg", upsert: false })
    if (upload.error && isNetworkProblem(upload.error)) return keepOffline()
    if (upload.error) throw new Error(upload.error.message)
    const { error } = await supabase.from("pin_photos").insert({ pin_id: pin.id, project_id: pin.project_id, path, ...itemLink, ...stampFields(stamp), ...extra })
    if (error) {
      await supabase.storage.from("pin-photos").remove([path])
      throw new Error(dbMessage(error))
    }
    return "uploaded"
  }
}

// Chosen photos open the markup dialog; the phone's time and position are taken when they are chosen (checked by the database).
function usePinPhotoDialog(pin: Pin, checklistItemId: string | undefined, label: string, onAdded: () => Promise<void> | void, attemptId?: string | null) {
  const toast = useToast()
  const upload = usePinPhotoUpload(pin, checklistItemId, attemptId)
  const [chosen, setChosen] = useState<File[] | null>(null)
  const stamp = useRef<Promise<PhotoStamp> | null>(null)
  const choose = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (!list.length) return
    stamp.current = captureStamp()
    setChosen(list)
  }
  const dialog = chosen ? (
    <MarkupUploadDialog files={chosen} title={`Add photos: ${label}`} prepare={preparePinPhoto} editorTitle="Mark up work photo"
      onUpload={async (draft) => upload(draft, await (stamp.current ?? captureStamp()))}
      onDone={async ({ uploaded, queued }) => {
        if (uploaded) toast.success(`${uploaded} photo${uploaded === 1 ? "" : "s"} added`)
        if (queued) toast.info(`${queued} photo${queued === 1 ? "" : "s"} saved on this device`, "They will be uploaded when you are back online.")
        await onAdded()
      }}
      onClose={() => { setChosen(null); stamp.current = null }} />
  ) : null
  return { choose, busy: Boolean(chosen), dialog }
}

// The upload button on a checklist item: opens the camera / gallery and links the photos to that item.
export function ChecklistUploadButton({ pin, itemId, label, onAdded, attemptId }: { pin: Pin; itemId: string; label: string; onAdded: () => void; attemptId?: string }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const { choose, busy, dialog } = usePinPhotoDialog(pin, itemId, label, onAdded, attemptId)
  const pick = (files: FileList | null) => {
    choose(files)
    if (fileInput.current) fileInput.current.value = ""
    if (cameraInput.current) cameraInput.current.value = ""
  }
  return (
    <>
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.target.files)} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files)} />
      <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} aria-label={`Upload photos for: ${label}`} className="min-h-6 text-[11px] font-bold text-brand-text underline underline-offset-2 hover:no-underline disabled:opacity-60">
        {busy ? "Marking up..." : "Upload photos"}
      </button>
      <button type="button" disabled={busy} onClick={() => cameraInput.current?.click()} aria-label={`Take a photo for: ${label}`} className="min-h-6 text-[11px] font-semibold text-brand-text underline underline-offset-2 hover:no-underline disabled:opacity-60">Take photo</button>
      {dialog}
    </>
  )
}

// With checklistItemId: only that item's photos, and new photos are linked to it (evidence for one checklist item).
// Without it: only the pin's progress photos; checklist photos are shown under their checklist item, never mixed in here.
export function PinPhotos({ pin, checklistItemId, canAdd, canRemoveAny, meId, onChanged, columns = 3, attemptId, unsubmitted = false }: { pin: Pin; checklistItemId?: string; attemptId?: string | null; canAdd: boolean; canRemoveAny: boolean; meId: string; onChanged?: () => void; columns?: 2 | 3 | 4; unsubmitted?: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { profile } = useAuth()
  const { photos: allPhotos, reload } = usePinPhotos(pin.id)
  const photos = allPhotos.filter((photo) => (checklistItemId ? photo.checklist_item_id === checklistItemId : !photo.checklist_item_id) && (attemptId === undefined || (photo.qa_attempt_id ?? null) === attemptId))
  const evidence = usePinEvidence(pin.id, pin.status)
  const fileInput = useRef<HTMLInputElement>(null)

  const { choose, busy, dialog } = usePinPhotoDialog(pin, checklistItemId, pin.title, async () => {
    await reload()
    onChanged?.()
  }, attemptId)

  const remove = async (photo: PinPhoto) => {
    if (!(await confirm({ title: "Remove this photo?", confirmLabel: "Remove", tone: "danger" }))) return
    const { error } = await supabase.from("pin_photos").delete().eq("id", photo.id)
    if (error) return toast.error("Could not remove the photo", dbMessage(error))
    await supabase.storage.from("pin-photos").remove([photo.path]) // allowed for the uploader; otherwise the file stays unused
    toast.success("Photo removed")
    await reload()
    onChanged?.()
  }

  const grid = columns === 4 ? "grid-cols-2 sm:grid-cols-4" : columns === 2 ? "grid-cols-2" : "grid-cols-3"
  return (
    <div className="space-y-2">
      {canAdd ? (
        <div>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { choose(e.target.files); e.target.value = "" }} />
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60">{busy ? "Marking up..." : "Add photos"}</button>
          {dialog}
          {checklistItemId ? <p className="mt-1 text-xs text-fg-muted">Select multiple photos or add more later. Every photo stays linked to this checklist item.</p> : null}
        </div>
      ) : null}
      {photos.length === 0 ? <p className="text-sm text-fg-muted">No photos yet.</p> : (
        <>
          {photos.length > 1 && !checklistItemId && photos.every(photo => !photoPreviewBlocked(profile?.role, photo)) ? <BeforeAfter bucket="pin-photos" before={{ path: photos[0].path, at: photos[0].created_at, caption: photos[0].caption,photo:{...photos[0],label:`${pin.title} · First photo`} }} after={{ path: photos[photos.length - 1].path, at: photos[photos.length - 1].created_at, caption: photos[photos.length - 1].caption,photo:{...photos[photos.length - 1],label:`${pin.title} · Latest photo`} }} /> : null}
          <div className={`grid gap-2 ${grid}`}>
            {photos.map((photo) => <Thumb key={photo.id} photo={photo} onRemove={(!evidence || Boolean(attemptId) || unsubmitted) && (canRemoveAny || photo.uploaded_by === meId) ? () => void remove(photo) : undefined} />)}
          </div>
        </>
      )}
      {stampSummary(photos) ? <p role="status" className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs font-semibold text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Check these photos: {stampSummary(photos)}.</p> : null}
      {evidence && !unsubmitted && photos.length ? (
        <p className="flex items-start gap-1.5 text-xs text-fg-muted">
          <svg className="mt-0.5 flex-none" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          Evidence locked: this work was sent for review, so its photos stay on record. You can still add new ones.
        </p>
      ) : null}
    </div>
  )
}

// ---------- Edit form (Engineers) ----------
export function PinFields({ pin, team, onSaved, idPrefix = "pin" }: { pin: Pin; team: TeamMember[]; onSaved: () => void; idPrefix?: string }) {
  const toast = useToast()
  const [form, setForm] = useState({ title: pin.title, description: pin.description ?? "", category: pin.category, discipline: (pin.discipline ?? "") as Discipline | "", severity: pin.severity ?? "medium", due_date: pin.due_date ?? "", assigned_to: pin.assigned_to ?? "" })
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({})
  const [busy, setBusy] = useState(false)
  // Only Foremen with Assigned work access to this plan's type can take it (the current one stays listed).
  const foremen = team.filter((member) => member.role === "foreman" && (member.can_take_work !== false || member.user_id === pin.assigned_to))

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const found: typeof errors = {}
    if (form.title.trim().length < 2 || form.title.trim().length > 120) found.title = "Enter a title between 2 and 120 characters."
    if (form.description.length > 2000) found.description = "Keep the description under 2000 characters."
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    const { data, error } = await supabase
      .from("pins")
      .update({ title: form.title.trim(), description: form.description.trim() || null, category: form.category, discipline: form.discipline || null, severity: form.severity, due_date: form.due_date || null, assigned_to: form.assigned_to || null })
      .eq("id", pin.id)
      .select("id")
    setBusy(false)
    if (error) return toast.error("Pin not saved", dbMessage(error))
    if (!data?.length) return toast.error("Pin not saved", "You may not be allowed to edit this pin.")
    toast.success("Pin saved")
    onSaved()
  }

  return (
    <form id={`${idPrefix}-fields`} className="space-y-3" noValidate onSubmit={(event) => void save(event)}>
      <label className="block text-sm font-semibold">
        Title
        <input className={field} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        {errors.title ? <span className="mt-1 block text-xs font-normal text-danger-fg">{errors.title}</span> : null}
      </label>
      <label className="block text-sm font-semibold">
        Description
        <textarea className={field} rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {errors.description ? <span className="mt-1 block text-xs font-normal text-danger-fg">{errors.description}</span> : null}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-semibold">Category
          <select className={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as PinCategory })}>
            {(Object.keys(categoryLabels) as PinCategory[]).map((c) => <option key={c} value={c}>{categoryLabels[c]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Discipline
          <select className={field} value={form.discipline} onChange={(e) => setForm({ ...form, discipline: e.target.value as Discipline | "" })}>
            <option value="">Not set</option>
            {(Object.keys(disciplineLabels) as Discipline[]).map((d) => <option key={d} value={d}>{disciplineLabels[d]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Severity
          <select className={field} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as PinSeverity })}>
            {(Object.keys(severityLabels) as PinSeverity[]).map((s) => <option key={s} value={s}>{severityLabels[s]}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Assigned foreman
          <select className={field} value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}>
            <option value="">Not assigned yet</option>
            {foremen.map((f) => <option key={f.user_id} value={f.user_id}>{f.full_name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold">Deadline
          <input className={field} type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </label>
      </div>
      <div className="text-right">
        <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9e1f93] to-[#b4329f] px-4 py-2 text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(158,31,147,0.85)] hover:from-[#8a1a80] hover:to-[#a52a92] disabled:opacity-60">{busy ? "Saving..." : "Save changes"}</button>
      </div>
    </form>
  )
}
