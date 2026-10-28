import { useMemo, useRef, useState } from "react"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary, inputClass } from "../ui/PageParts"
import type { Pin } from "../../lib/blueprints"
import { qaActions, tradeLabels, type Template } from "../../lib/qa"
import { pickableChecklists } from "../../lib/qaChecklists"
import { useToast } from "../../lib/toast"
import { Chip } from "./QaBits"
import { usePinQa } from "../../lib/pinQa"

const label = "mb-1 block text-xs font-extrabold uppercase tracking-wider text-fg-muted"

// Request for Inspection (IR): pick the checklist, say what and where. The checklist is copied into the request, so editing the
// list later never changes an inspection that already exists.
export default function NewInspectionModal({
  projectId,
  templates,
  pins,
  initialTemplateId,
  initialPinId,
  pendingPinIds = [],
  onClose,
  onCreated,
}: {
  projectId: string
  templates: Template[]
  pins: Pin[]
  initialTemplateId?: string
  initialPinId?: string
  pendingPinIds?: string[]
  onClose: () => void
  onCreated: (inspectionId: string) => void | Promise<void>
}) {
  const toast = useToast()
  // Only the checklists added to this project (Checklist configuration), never the library or a work item's own criteria.
  const usable = useMemo(() => pickableChecklists(templates, projectId), [templates, projectId])
  const [templateId, setTemplateId] = useState(initialTemplateId && usable.some((template) => template.id === initialTemplateId) ? initialTemplateId : (usable[0]?.id ?? ""))
  const chosen = usable.find((template) => template.id === templateId)
  const [title, setTitle] = useState("")
  const [pinId, setPinId] = useState(initialPinId ?? "")
  const pinQa = usePinQa(pinId)
  const [location, setLocation] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const blockReason = pinId ? pinQa.error || (!pinQa.state ? "Checking this work's pending QA requests…" : pinQa.state.submissionProblem || (pendingPinIds.includes(pinId) ? "This work already has a pending QA request." : "")) : ""
  const blocked = Boolean(blockReason)
  const workPins = pins.filter((pin) => pin.category !== "note")
  const items = chosen?.qa_template_items ?? []
  const holds = items.filter((item) => item.hold_point).length
  const photos = items.filter((item) => item.requires_photo).length

  const submit = async () => {
    if (pending.current || blocked) return
    if (!chosen) return toast.error("Choose a checklist")
    const text = title.trim() || chosen.name
    if (text.length < 3) return toast.error("Give the request a title")
    pending.current = true
    setBusy(true)
    try {
      if (pinId) { const why=await pinQa.preflight(); if(why) throw new Error(why) }
      const result = await qaActions.requestInspection({ projectId, templateId: chosen.id, title: text, pinId: pinId || null, location: location.trim(), note: note.trim() })
      if (!result.ok) return toast.error("Request not sent", result.message)
      toast.success("Inspection requested", "The project engineers have been notified")
      await onCreated(result.data)
    } catch(e) { toast.error("Request not sent",(e as Error).message) }
    finally { setBusy(false); pending.current=false }
  }

  const groups = [{ name: "This project", list: usable }].filter((group) => group.list.length)

  return (
    <Modal
      title="Request a stage / hold-point inspection"
      description="Use this for a stage or hold point. Submit checklist items from their work checklist for QA and Engineer completion. The same checklist item cannot have duplicate pending requests."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={busy || !chosen || blocked} onClick={() => void submit()}>{busy ? "Sending..." : "Send stage request"}</button>
        </>
      }
    >
      <div className="space-y-4">
        {blocked ? <p role="status" className="rounded-lg bg-amber-100 p-3 text-sm text-amber-950">{blockReason}</p> : null}
        <div>
          <label className={label} htmlFor="qa-template">Checklist</label>
          {usable.length === 0 ? <p role="status" className="mb-2 rounded-lg border border-dashed border-line p-3 text-sm text-fg-muted">No checklist has been added to this project yet. The project Engineer adds them in Checklist configuration.</p> : null}
          <select id="qa-template" className={inputClass} value={templateId} disabled={usable.length === 0} onChange={(event) => setTemplateId(event.target.value)}>
            {groups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.list.map((template) => <option key={template.id} value={template.id}>{template.name} ({tradeLabels[template.trade]})</option>)}
              </optgroup>
            ))}
          </select>
          {chosen ? (
            <div className="mt-2 rounded-lg bg-surface-muted p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">{items.length} items</Chip>
                {holds ? <Chip tone="bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-200">{holds} hold point{holds === 1 ? "" : "s"}</Chip> : null}
                {photos ? <Chip tone="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{photos} need a photo</Chip> : null}
                {chosen.standards.map((standard) => <span key={standard} className="font-semibold text-fg-muted">{standard}</span>)}
              </div>
              {chosen.description ? <p className="mt-2 text-fg-muted">{chosen.description}</p> : null}
            </div>
          ) : null}
        </div>
        <div>
          <label className={label} htmlFor="qa-title">What is to be inspected</label>
          <input id="qa-title" className={inputClass} maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={chosen ? `${chosen.name}, e.g. Slab B, grid C-4` : "Describe the work"} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="qa-location">Location</label>
            <input id="qa-location" className={inputClass} maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Level, grid line or room" />
          </div>
          <div>
            <label className={label} htmlFor="qa-pin">Linked pin (optional)</label>
            <select id="qa-pin" className={inputClass} value={pinId} onChange={(event) => setPinId(event.target.value)}>
              <option value="">No pin</option>
              {workPins.map((pin) => <option key={pin.id} value={pin.id} disabled={pendingPinIds.includes(pin.id) || pin.status === "verified"}>{pin.title}{pendingPinIds.includes(pin.id) ? " · QA pending" : pin.status === "verified" ? " · Completed" : ""}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={label} htmlFor="qa-note">Note for the inspector (optional)</label>
          <textarea id="qa-note" rows={2} maxLength={500} className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="When the work is ready, access, who will be there" />
        </div>
      </div>
    </Modal>
  )
}
