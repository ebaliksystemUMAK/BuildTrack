import { useState, type FormEvent } from "react"
import Modal from "../../components/Modal"
import { PinChecklist, PinTimeline, ProgressTracker } from "../../components/editor/PinParts"
import { buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { statusLabels, type Pin } from "../../lib/blueprints"
import { useAuth } from "../../lib/auth"
import { supabase } from "../../lib/supabase"
import { enqueue } from "../../lib/offlineQueue"
import { isNetworkProblem } from "../../lib/offlineModel"
import { useToast } from "../../lib/toast"
import { usePinQa } from "../../lib/pinQa"

// One pin as the foreman sees it: photos and ticks go on each checklist item; leave a note and start or continue the work.
export default function ReportModal({ pin: sourcePin, onClose, onSaved }: { pin: Pin; onClose: () => void; onSaved: () => Promise<void> }) {
  const qa = usePinQa(sourcePin.id)
  const pin = { ...sourcePin, status: qa.state?.status ?? sourcePin.status }
  const { profile } = useAuth()
  const toast = useToast()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const locked = pin.status === "for_review" || pin.status === "verified" || pin.assigned_to !== profile?.id

  const send = async (status: "in_progress", event?: FormEvent) => {
    event?.preventDefault()
    setError("")
    setBusy(true)
    // No signal: keep the report on this device and send it when the connection is back.
    const saveOffline = async () => {
      if (!profile) return
      await enqueue({ userId: profile.id, kind: "pin_progress", label: pin.title, payload: { pinId: pin.id, status, note: note.trim() || null } })
      setBusy(false)
      toast.info("Saved on this device", "It will be sent when you are back online.")
      await onSaved()
    }
    if (!navigator.onLine) return saveOffline()
    const { error: rpcError } = await supabase.rpc("report_pin_progress", { p_pin: pin.id, p_status: status, p_note: note.trim() || null })
    if (rpcError && isNetworkProblem(rpcError)) return saveOffline()
    setBusy(false)
    if (rpcError) {
      const message = rpcError.message.replace(/^.*?(Only a Foreman|Foremen can|A verified|This work is not assigned|Complete every checklist item)/i, "$1")
      setError(message)
      return toast.error("Not sent", message)
    }
    toast.success("Progress saved", pin.title)
    await onSaved()
  }

  return (
    <Modal
      title={pin.title}
      description={`${statusLabels[pin.status]}${pin.due_date ? ` • due ${pin.due_date}` : ""}`}
      size="lg"
      onClose={busy ? () => undefined : onClose}
      footer={
        locked ? (
          <button type="button" className={buttonSecondary} onClick={onClose}>Close</button>
        ) : (
          <>
            <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className={buttonSecondary} onClick={() => void send("in_progress")} disabled={busy}>{pin.status === "not_started" ? "Start work" : "Save progress"}</button>
          </>
        )
      }
    >
      <div className="space-y-5">
        <ProgressTracker status={pin.status} />
        {pin.description ? <p className="whitespace-pre-wrap text-sm">{pin.description}</p> : null}
        <section>
          <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Tasks &amp; QC</h3>
          <PinChecklist pin={pin} canEdit={false} canTick={!locked && pin.assigned_to === profile?.id} notice={pin.assigned_to !== profile?.id ? "This work is not assigned to you. The engineer must assign it to you before you can upload photos." : locked ? "Awaiting Engineer inspection. Photos can be added again if the work is sent back." : ""} onPinChanged={onSaved} submissionNote={note} />
        </section>
        {!locked ? (
          <label className="block text-sm font-semibold">Note for the engineer (optional)
            <textarea className={`${inputClass} mt-1`} rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was done, anything to watch for." />
          </label>
        ) : null}
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <section>
          <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Timeline</h3>
          <PinTimeline pinId={pin.id} canComment />
        </section>
      </div>
    </Modal>
  )
}
