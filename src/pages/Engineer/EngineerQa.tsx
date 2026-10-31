import { useCallback, useEffect, useState, type FormEvent } from "react"
import Modal from "../../components/Modal"
import ProjectContextBar from "../../components/ProjectContextBar"
import { PinChecklist, PinTimeline, ProgressTracker, dbMessage } from "../../components/editor/PinParts"
import ChecklistPhotos from "../../components/ChecklistPhotos"
import OpenOnBlueprint from "../../components/OpenOnBlueprint"
import QaView from "../../components/qa/QaView"
import WorkItemBoard from "../../components/qa/WorkItemBoard"
import WorkItemWorkspace from "../../components/qa/WorkItemWorkspace"
import { PageHead, buttonDanger, buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { categoryLabels, formatStamp, statusChip, statusLabels, type Pin } from "../../lib/blueprints"
import { useConfirm } from "../../lib/confirm"
import { followLink } from "../../lib/notifications"
import { getSelectedProjectId } from "../../lib/projects"
import { usePinQuality } from "../../lib/qaLite"
import { defectStatusLabels, inspectionStatusLabels, inspectionTone, pinQualityWarning, qaSeverityLabels, refNumber, severityTone } from "../../lib/qaModel"
import { useQaWorkspace } from "../../lib/qaWorkspace"
import { supabase } from "../../lib/supabase"
import { usePinQa } from "../../lib/pinQa"
import { useToast } from "../../lib/toast"
import { selectedVerification } from "../../lib/verificationViewModel"
import { useItemParam, useWorkItems } from "../../lib/workItem"
import type { EngineerPageProps } from "./types"

// All quality records and checklist completion live in this register. Old review links still open their original record.
export default function EngineerQa({ onNavigate }: EngineerPageProps) {
  const projectId = getSelectedProjectId()
  const ws = useQaWorkspace(projectId)
  const work = ws.work
  const items = useWorkItems(projectId, work.pins, ws.inspections, ws.defects)
  const [itemId, setItemId] = useItemParam()
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("pin"))
  useEffect(() => {
    const changed = () => {
      const params = new URLSearchParams(window.location.search)
      setSelectedId(params.get("pin"))
      if (params.get("tab") === "checklists") onNavigate("checklists")
    }
    changed()
    window.addEventListener("popstate", changed)
    return () => window.removeEventListener("popstate", changed)
  }, [projectId, onNavigate])
  const ready = items.rows.filter(row => row.view.action === "complete")
  const completed = items.rows.filter(row => row.item.review_status === "verified" || row.view.stage === "completed")
  // Submissions from before item-by-item QA retain their original completion dialog.
  const legacy = work.pins.filter(pin => pin.status === "for_review" && !items.rows.some(row => row.pin.id === pin.id && row.attempts > 0))
  const completedPins = work.pins.filter(pin => pin.status === "verified" && !items.rows.some(row => row.pin.id === pin.id))
    .sort((a, b) => (b.verified_at ?? "").localeCompare(a.verified_at ?? ""))
  const selected = selectedVerification(work.pins, projectId, selectedId)
  const closeReview = () => {
    setSelectedId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("pin")
    window.history.replaceState({}, "", url)
  }
  const reload = async () => { await Promise.all([ws.reloadAll(), items.reload()]) }
  const pinList = (pins: Pin[]) => (
    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
      {pins.map(pin => <li key={pin.id}>
        <button type="button" aria-haspopup="dialog" onClick={() => setSelectedId(pin.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-surface-muted">
          <span className="font-semibold">{pin.title} <span className="font-normal text-fg-muted">· {work.sheetOf(pin.blueprint_id)}</span></span>
          <span className="text-xs text-fg-muted">{pin.verified_at ? formatStamp(pin.verified_at) : statusLabels[pin.status]}</span>
        </button>
      </li>)}
    </ul>
  )

  return (
    <div className="engineer-page">
      <ProjectContextBar listPath="/engineer/projects" listLabel="My projects" />
      <PageHead eyebrow="Quality assurance" title="QA register"
        description="Manage inspections, verify NCR corrections, complete passed tasks and view completed work."
        actions={<button type="button" className={buttonSecondary} onClick={() => onNavigate("annotation")}>Open the plan</button>} />
      {projectId ? <QaView key={projectId} ws={{ ...ws, reloadAll: reload }} mode="engineer"
        tabs={["inspections", "defects", "complete", "completed", "snags"]} dateFilter
        workTabs={{
          complete: { count: ready.length + legacy.length, content: <WorkItemBoard key={projectId + ":complete"} showGroupFilters={false}
            groups={[{ key: "complete", short: "Complete task", title: "Ready to complete", rows: ready,
              hint: "Inspection passed and linked NCRs are closed. Open a task to complete it." }]}
            extras={legacy.length ? [{ key: "legacy", short: "Whole-work submissions", title: "Whole-work submissions", count: legacy.length, content: pinList(legacy) }] : []}
            loading={items.loading || ws.loading} error={items.error || ws.error} nameOf={ws.nameOf} sheetOf={work.sheetOf} onOpen={setItemId}
            emptyTitle="No tasks ready to complete" emptyText="Tasks appear here after their inspection passes and all linked NCRs are closed." /> },
          completed: { count: completed.length + completedPins.length, content: <WorkItemBoard key={projectId + ":completed"} showGroupFilters={false}
            groups={[{ key: "completed", short: "Completed tasks", title: "Completed tasks", rows: completed }]}
            extras={completedPins.length ? [{ key: "completed-work", short: "Completed work", title: "Completed work", count: completedPins.length, content: pinList(completedPins) }] : []}
            loading={items.loading || ws.loading} error={items.error || ws.error} nameOf={ws.nameOf} sheetOf={work.sheetOf} onOpen={setItemId}
            emptyTitle="No completed work yet" emptyText="Completed tasks and whole-work records will appear here." /> },
        }} /> : null}
      {selected ? <ReviewPanel key={selected.id} pin={selected} sheet={work.sheetOf(selected.blueprint_id)} foreman={work.nameOf(selected.assigned_to)} onClose={closeReview} onDecided={reload} /> : null}
      {itemId ? <WorkItemWorkspace key={itemId} itemId={itemId} onClose={() => setItemId(null)} onChanged={reload} /> : null}
    </div>
  )
}

function ReviewPanel({ pin, sheet, foreman, onDecided, onClose }: { pin: Pin; sheet: string; foreman: string; onDecided: () => Promise<void>; onClose: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [checklist, setChecklist] = useState({ done: 0, total: 0 })
  const [busy, setBusy] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [tab, setTab] = useState<"checklist" | "quality" | "photos" | "timeline">("checklist")
  const quality = usePinQuality(pin.id)
  const qa = usePinQa(pin.id)
  const qualityWarning = pinQualityWarning(quality)
  // Stable callback: the checklist reports its counts from an effect, so a new function each render would loop.
  const onChecklist = useCallback((done: number, total: number) => setChecklist((current) => (current.done === done && current.total === total ? current : { done, total })), [])

  // Same gate as the database (guard_pin_verification): the Foreman completed the checklist and QA is clear.
  const missing = checklist.total - checklist.done
  const blocker = qa.error || (!qa.state ? "Checking inspection requirements…" : qa.state.problem) || (missing > 0
    ? `Tasks still await Engineer approval (${missing} of ${checklist.total} tasks unapproved). Open Tasks & QC to review them.`
    : qualityWarning ? `${qualityWarning} Resolve it in Quality before verifying.` : "")

  const approve = async () => {
    if (blocker || !quality) return
    const ok = await confirm({
      title: `Complete "${pin.title}"?`,
      message: "All tasks are approved and QA is clear. This completes the work pin and notifies the Foreman and the client.",
      confirmLabel: "Complete work",
    })
    if (!ok) return
    setBusy(true)
    const { data, error } = await supabase.from("pins").update({ status: "verified" }).eq("id", pin.id).select("id")
    setBusy(false)
    if (error || !data?.length) return toast.error("Could not verify", error ? dbMessage(error) : "You may not be allowed to verify this pin.")
    toast.success("Completed", pin.title)
    await onDecided()
  }

  return (
    <Modal title={pin.title} description={`${sheet} · ${categoryLabels[pin.category]} · ${foreman}`} size="2xl" onClose={busy ? () => undefined : onClose} footer={<>
      <button type="button" className={buttonSecondary} disabled={busy} onClick={onClose}>Close details</button>
      <OpenOnBlueprint projectId={pin.project_id} pinId={pin.id} sheetId={pin.blueprint_id} section="checklist" />
      {pin.status === "for_review" ? <button type="button" className={buttonSecondary} disabled={busy || Boolean(qa.state?.open)} onClick={() => setSendingBack(true)}>Send back</button> : null}
      {pin.status !== "verified" ? <button type="button" className={buttonPrimary} disabled={busy || Boolean(blocker) || !quality} title={blocker || undefined} onClick={() => void approve()}>{busy ? "Saving..." : "Complete work"}</button> : null}
    </>}>
    <article className="min-w-0">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-fg-muted">{sheet} • {categoryLabels[pin.category]}</p>
          <p className="mt-1 text-sm text-fg-muted">Reported by {foreman}{pin.due_date ? ` • due ${new Date(pin.due_date + "T00:00:00").toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })}` : ""}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusChip[pin.status]}`}>{statusLabels[pin.status]}</span>
      </header>
      {pin.description ? <p className="mt-3 whitespace-pre-wrap text-sm">{pin.description}</p> : null}

      <div className="mt-4"><ProgressTracker status={pin.status} /></div>

      {pin.status !== "verified" && blocker ? <div role="status" className="mt-4 rounded-xl border border-line bg-surface-muted p-3 text-sm text-fg-muted"><strong>Before completing work: </strong>{blocker}{quality?.defects.some(row => row.status !== "closed") ? <button type="button" className="ml-2 font-bold text-brand-text underline" onClick={() => setTab("quality")}>Review open NCRs</button> : null}</div> : null}
      <div className="mt-5 flex flex-wrap gap-1 border-b border-line pb-2" role="tablist" aria-label="Work review sections">
        {([ ["checklist", "Tasks & QC"], ["quality", "QA & NCRs"], ["photos", "Photos"], ["timeline", "Timeline"] ] as const).map(([key, label]) => <button key={key} id={`review-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`review-section-${key}`} onClick={() => setTab(key)} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted"}`}>{label}</button>)}
      </div>

      <section hidden={tab !== "checklist"} id="review-section-checklist" role="tabpanel" aria-labelledby="review-tab-checklist" className="mt-5">
        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Tasks &amp; QC</h3>
        <PinChecklist pin={pin} canEdit={false} canTick={false} onChange={onChecklist} onPinChanged={onDecided} />
      </section>
      {tab === "photos" ? <section id="review-section-photos" role="tabpanel" aria-labelledby="review-tab-photos" className="mt-5">
        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Photos</h3>
        <ChecklistPhotos pin={pin} />
      </section> : null}
      {tab === "quality" ? (
        <section id="review-section-quality" role="tabpanel" aria-labelledby="review-tab-quality" className="mt-5">
          <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Quality record</h3>
          {qualityWarning ? <p role="status" className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 dark:bg-amber-900/30 dark:text-amber-100">{qualityWarning}</p> : null}
          {!quality ? <p role="status" className="text-sm text-fg-muted">Loading quality records. If this persists, refresh to retry.</p> : !quality.inspections.length && !quality.defects.length ? <p className="text-sm text-fg-muted">No QA records yet.</p> : null}
          <ul className="max-h-96 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
            {quality?.inspections.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => followLink(`/engineer/qa?project=${pin.project_id}&tab=inspections&inspection=${row.id}`, pin.project_id)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface-muted">
                  <strong className="tabular-nums">{refNumber("ir", row.number)}</strong>
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  {row.score !== null ? <span className="text-xs font-bold tabular-nums">{row.score}%</span> : null}
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold uppercase ${inspectionTone[row.status]}`}>{inspectionStatusLabels[row.status]}</span>
                </button>
              </li>
            ))}
            {quality?.defects.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => followLink(`/engineer/qa?project=${pin.project_id}&tab=defects&defect=${row.id}`, pin.project_id)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface-muted">
                  <strong className="tabular-nums">{refNumber("ncr", row.number)}</strong>
                  <span className="min-w-0 flex-1 truncate">{row.title}</span>
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-extrabold uppercase ${severityTone[row.severity]}`}>{qaSeverityLabels[row.severity]}</span>
                  <span className="text-xs font-bold text-fg-muted">{defectStatusLabels[row.status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {tab === "timeline" ? <section id="review-section-timeline" role="tabpanel" aria-labelledby="review-tab-timeline" className="mt-5">
        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Timeline</h3>
        <PinTimeline pinId={pin.id} canComment refreshKey={refresh} />
      </section> : null}

      {sendingBack ? <SendBackModal pin={pin} onClose={() => setSendingBack(false)} onDone={async () => { setSendingBack(false); setRefresh((value) => value + 1); await onDecided() }} /> : null}
    </article>
    </Modal>
  )
}

function SendBackModal({ pin, onClose, onDone }: { pin: Pin; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast()
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (reason.trim().length < 5) return setError("Tell the foreman what needs to be fixed (at least 5 characters).")
    setError("")
    setBusy(true)
    const { error: updateError } = await supabase.rpc("return_pin_for_correction", { p_pin: pin.id, p_reason: reason.trim() })
    if (updateError) {
      setBusy(false)
      return setError(updateError ? dbMessage(updateError) : "You may not be allowed to change this pin.")
    }
    setBusy(false)
    toast.success("Sent back to the foreman", pin.title)
    await onDone()
  }

  return (
    <Modal
      title="Send back for more work"
      description={pin.title}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="send-back-form" className={buttonDanger} disabled={busy}>{busy ? "Sending..." : "Send back"}</button>
        </>
      }
    >
      <form id="send-back-form" noValidate onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-semibold">
          Which items failed and what needs to be fixed? *
          <textarea className={`${inputClass} mt-1`} rows={4} maxLength={1000} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Rebar spacing on grid C is wider than the plan. Re-do and add a photo." />
        </label>
        {error ? <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p> : null}
        <p className="mt-3 text-xs text-fg-muted">The pin goes back to "In progress", the foreman is notified and your reason is saved in the timeline.</p>
      </form>
    </Modal>
  )
}
