import { useEffect, useRef, useState } from "react"
import Modal from "../Modal"
import IssuePhotoPicker from "./IssuePhotoPicker"
import { buttonPrimary, buttonSecondary } from "../ui/PageParts"
import { useConfirm } from "../../lib/confirm"
import type { IssuePhotoDraft } from "../../lib/siteIssues"

export type UploadOutcome = "uploaded" | "queued"

// After photos are chosen: shrink each one (`prepare`, so the markup sits on exactly the stored pixels), let the person mark
// them up with the shared picker / editor (text, lines, arrows, shapes, drawing, rotation, one photo at a time as a slideshow),
// then add them one by one through `onUpload`. A photo that fails stays here with the reason to retry or remove; photos saved
// on the device for later (offline) count as done. Cancel asks first only when something was marked up or captioned.
// allowFiles=false: the photo came from the in-app camera, so no more files can be added here (they would not be camera photos).
export default function MarkupUploadDialog({ files, title, limit = 10, captionLimit = 200, prepare, onUpload, onDone, onClose, editorTitle = "Mark up photo", allowFiles = true }: {
  files: File[]; title: string; limit?: number; captionLimit?: number; editorTitle?: string; allowFiles?: boolean
  prepare: (file: File) => Promise<File>
  onUpload: (draft: IssuePhotoDraft) => Promise<UploadOutcome>
  onDone: (result: { uploaded: number; queued: number }) => void | Promise<void>
  onClose: () => void
}) {
  const confirm = useConfirm()
  const [drafts, setDrafts] = useState<IssuePhotoDraft[]>([])
  const [preparing, setPreparing] = useState(true) // the photos chosen first
  const [adding, setAdding] = useState(false) // more photos added inside the dialog
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState("")
  const urls = useRef(new Set<string>())
  const mounted = useRef(true)
  const started = useRef(false)

  useEffect(() => {
    mounted.current = true
    if (!started.current) {
      started.current = true
      void (async () => {
        const ready: IssuePhotoDraft[] = []
        const problems: string[] = []
        // One at a time: big phone pictures decoded together can run a phone out of memory.
        for (const file of files.slice(0, limit)) {
          try {
            const prepared = await prepare(file)
            if (!mounted.current) return
            const url = URL.createObjectURL(prepared)
            urls.current.add(url)
            ready.push({ id: crypto.randomUUID(), file: prepared, url, caption: "", annotations: [] })
          } catch (error) {
            problems.push(`${file.name}: ${error instanceof Error ? error.message : "could not be read"}`)
          }
        }
        if (!mounted.current) return
        if (files.length > limit) problems.push(`Only the first ${limit} photos were taken; add the rest after these.`)
        setDrafts(ready)
        setProblem(problems.join(" "))
        setPreparing(false)
      })()
    }
    return () => { mounted.current = false }
  }, [files, limit, prepare])
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url) }, [])

  const cancel = async () => {
    if (busy || preparing || adding) return
    const worked = drafts.some((draft) => draft.annotations.length || draft.caption.trim())
    if (worked && !(await confirm({ title: "Discard these photos?", message: "They have not been added, and their markup will be lost.", confirmLabel: "Discard", tone: "danger" }))) return
    onClose()
  }

  const add = async () => {
    if (!drafts.length || busy || preparing || adding) return
    setBusy(true)
    setProblem("")
    const failed: IssuePhotoDraft[] = []
    let uploaded = 0, queued = 0, reason = ""
    for (const draft of drafts) {
      try {
        if ((await onUpload(draft)) === "queued") queued++
        else uploaded++
      } catch (error) {
        failed.push(draft)
        reason ||= error instanceof Error ? error.message : "Upload failed."
      }
    }
    if (!mounted.current) return
    setBusy(false)
    if (uploaded || queued) await onDone({ uploaded, queued })
    if (!failed.length) return onClose()
    setDrafts(failed)
    setProblem(`${failed.length === 1 ? "A photo was" : `${failed.length} photos were`} not added: ${reason.replace(/[.\s]*$/, ".")} Try again, or remove ${failed.length === 1 ? "it" : "them"}.`)
  }

  return (
    <Modal
      title={title}
      description="Mark up each photo before adding it: text, lines, arrows, shapes or drawing. The original photo is kept and the markup is saved over it."
      size="xl"
      onClose={() => void cancel()}
      footer={
        <>
          <button type="button" className={buttonSecondary} disabled={busy || preparing || adding} onClick={() => void cancel()}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={busy || preparing || adding || !drafts.length} onClick={() => void add()}>{busy ? "Adding..." : preparing || adding ? "Preparing..." : drafts.length > 1 ? `Add ${drafts.length} photos` : "Add photo"}</button>
        </>
      }
    >
      {preparing ? <p role="status" className="text-sm text-fg-muted">Preparing the photos…</p> : (
        <IssuePhotoPicker photos={drafts} onChange={setDrafts} limit={limit} disabled={busy} prepare={prepare} onPreparing={setAdding} captionLimit={captionLimit} nameCaptions={false} editorTitle={editorTitle} allowFiles={allowFiles}
          hint={allowFiles ? `Up to ${limit} photos at a time. Use Mark up photos (or Edit / annotate) to mark them up and add a caption; the original photo is kept.` : "Use Mark up photo (or Edit / annotate) to mark it up and add a caption; the original photo is kept. Take another photo after adding this one."} />
      )}
      {problem ? <p role="alert" className="mt-3 text-sm text-danger-fg">{problem}</p> : null}
    </Modal>
  )
}
