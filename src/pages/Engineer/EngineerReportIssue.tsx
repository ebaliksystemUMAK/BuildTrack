import { useCallback, useMemo, useState, type FormEvent } from "react"
import Modal from "../../components/Modal"
import ProjectContextBar from "../../components/ProjectContextBar"
import { dbMessage } from "../../components/editor/PinParts"
import { EmptyState, PageHead, StatCard, buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { categoryLabels, severityChip, severityLabels, severityRank, type Pin, type PinSeverity } from "../../lib/blueprints"
import { useConfirm } from "../../lib/confirm"
import { followLink } from "../../lib/notifications"
import { daysBetween, downloadCsv, isOverdue, severityOrder, toCsv } from "../../lib/progress"
import { getSelectedProjectId } from "../../lib/projects"
import { useProjectWork } from "../../lib/projectWork"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import type { EngineerPageProps } from "./types"
import LogIssueModal from "../../components/issues/LogIssueModal"
import { pinPlanPath } from "../../lib/pinRecordsModel"
import IssueDetails from "../../components/issues/IssueDetails"
import { useIssueRegister } from "../../lib/siteIssues"
import { issueTab } from "../../lib/issueMarkup"
import { issueChecklistIndex, issueChecklistLabel, issueChecklistOptions, WHOLE_PIN_CHECKLIST } from "../../lib/issueChecklist"

type Tab = "open" | "following_up" | "resolved"

export default function EngineerReportIssue({ onNavigate }: EngineerPageProps) {
  const projectId = getSelectedProjectId()
  const work = useProjectWork(projectId)
  const toast = useToast()
  const confirm = useConfirm()
  const register = useIssueRegister(projectId)
  const { raised, everRaised } = register
  const [sheet,setSheet] = useState(new URLSearchParams(window.location.search).get("sheet") ?? "")
  const [viewing,setViewing] = useState<string|null>(new URLSearchParams(window.location.search).get("issue"))
  const [checklist,setChecklist]=useState("")
  const checklistIndex=useMemo(()=>issueChecklistIndex(register.reports,checklist),[register.reports,checklist])
  const latest=checklistIndex.latest
  const checklistOptions=useMemo(()=>issueChecklistOptions(register.reports),[register.reports])
  const [tab, setTab] = useState<Tab>("open")
  const [query, setQuery] = useState("")
  const [severity, setSeverity] = useState<PinSeverity | "all">("all")
  const [logging, setLogging] = useState(false)
  const [reopening, setReopening] = useState<Pin | null>(null)

  const refresh = useCallback(async () => {
    await work.reload()
    await register.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.reload,register.reload])

  const foremen = work.team.filter((member) => member.role === "foreman")
  const open = work.pins.filter((pin) => pin.status === "issue")
  const resolved = work.pins.filter((pin) => pin.status === "verified" && everRaised.has(pin.id))
  const following = work.pins.filter(pin=>everRaised.has(pin.id) && issueTab(pin.status)==="following_up")

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase()
    const source = tab === "open" ? open : tab === "resolved" ? resolved : following
    return source
      .filter((pin) => checklistIndex.matches(pin.id) && (!sheet || pin.blueprint_id===sheet) && (severity === "all" || pin.severity === severity) && (!text || `${pin.title} ${latest.get(pin.id)?.checklist_name ?? ""} ${latest.get(pin.id)?.description ?? pin.description ?? ""} ${work.sheetOf(pin.blueprint_id)}`.toLowerCase().includes(text)))
      .sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || (raised[a.id] ?? a.updated_at).localeCompare(raised[b.id] ?? b.updated_at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, open, resolved, following, query, severity, raised, sheet, register.reports, checklistIndex])

  const ageOf = (pin: Pin) => {
    const days = daysBetween((raised[pin.id] ?? pin.updated_at).slice(0, 10), work.today)
    return days <= 0 ? "today" : days === 1 ? "1 day" : `${days} days`
  }

  const patch = async (pin: Pin, changes: Record<string, unknown>, success: string) => {
    const { data, error } = await supabase.from("pins").update(changes).eq("id", pin.id).select("id")
    if (error || !data?.length) return toast.error("Not saved", error ? dbMessage(error) : "You may not be allowed to edit this pin.")
    toast.success(success)
    await refresh()
  }

  const close = async (pin: Pin) => {
    if (!(await confirm({ title: `Close "${pin.title}"?`, message: "Mark the issue as fixed and verified. The foreman and the client are notified.", confirmLabel: "Close as verified" }))) return
    await patch(pin, { status: "verified" }, "Issue closed")
  }

  const exportCsv = () => {
    const header = ["Title", "Sheet", "Task", "Category", "Severity", "Status", "Assigned to", "Raised", "Open for", "Due", "Description"]
    const body = rows.map((pin) => [pin.title, work.sheetOf(pin.blueprint_id), issueChecklistLabel(latest.get(pin.id) ?? {}), categoryLabels[pin.category], severityLabels[pin.severity], tab === "resolved" ? "Resolved" : tab === "open" ? "Open" : "Following up", work.nameOf(pin.assigned_to), (raised[pin.id] ?? pin.updated_at).slice(0, 10), tab === "open" ? ageOf(pin) : "", pin.due_date ?? "", latest.get(pin.id)?.description ?? pin.description ?? ""])
    downloadCsv(`issue-register-${work.project?.code ?? "project"}-${work.today}.csv`, toCsv(header, body))
    toast.success("Exported", `${rows.length} issue${rows.length === 1 ? "" : "s"}`)
  }

  const counts = Object.fromEntries(severityOrder.map((level) => [level, open.filter((pin) => pin.severity === level).length])) as Record<PinSeverity, number>

  return (
    <div className="engineer-page">
      <ProjectContextBar listPath="/engineer/projects" listLabel="My projects" />
      <PageHead
        eyebrow="Quality"
        title="Issue register"
        description="Every problem found on site, how serious it is and how long it has been open. Assign it, send it back to the foreman, or close it when it is fixed."
        actions={
          <>
            <button type="button" className={buttonSecondary} disabled={!projectId} onClick={() => followLink(`/engineer/qa?project=${projectId}&tab=defects`, projectId)}>Open QA defects (NCR)</button>
            <button type="button" className={buttonSecondary} onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
            <button type="button" className={buttonPrimary} onClick={() => setLogging(true)} disabled={!projectId || Boolean(work.error || register.error)}>Create Punchlist</button>
          </>
        }
      />

      {!projectId ? null : (
        <>
          {work.error || register.error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft p-3 text-sm text-danger-fg">{work.error || register.error} <button type="button" className="underline" onClick={()=>void refresh()}>Retry</button></p> : null}
          <p className="mb-3 text-xs text-fg-muted">Live project records. Issue status follows the same work pin shown on the plan and in Progress by Zone. <button type="button" className="font-bold underline" onClick={()=>void refresh()}>Refresh database data</button></p>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Open issues" value={open.length} tone={open.length ? "red" : "green"} note={open.length ? `${open.filter((pin) => isOverdue(pin, work.today)).length} past deadline` : "Nothing open"} />
            <StatCard label="Critical" value={counts.critical} tone="red" note="Fix first" onClick={() => { setTab("open"); setSeverity("critical") }} />
            <StatCard label="High" value={counts.high} tone="amber" onClick={() => { setTab("open"); setSeverity("high") }} />
            <StatCard label="Resolved" value={resolved.length} tone="green" note="Closed after an issue" onClick={() => setTab("resolved")} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm" role="tablist" aria-label="Issue list">
              {([["open", `Open (${open.length})`], ["following_up", `Following up (${following.length})`], ["resolved", `Resolved (${resolved.length})`]] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`rounded-lg px-3.5 py-1.5 text-sm font-bold transition ${tab === key ? "bg-brand text-white shadow-[0_6px_14px_-8px_rgba(158,31,147,0.9)]" : "text-fg-muted hover:bg-surface-muted hover:text-fg"}`}>{label}</button>
              ))}
            </div>
            <select aria-label="Filter issues by zone" className={`${inputClass} !w-56`} value={sheet} onChange={event=>setSheet(event.target.value)}><option value="">All sheets / zones</option>{work.blueprints.map(bp=><option key={bp.id} value={bp.id}>{bp.title}</option>)}</select>
            <select aria-label="Filter issues by task" className={`${inputClass} !w-56`} value={checklist} onChange={event=>setChecklist(event.target.value)}><option value="">All tasks</option><option value={WHOLE_PIN_CHECKLIST}>Whole work pin / no task</option>{checklistOptions.map(item=><option key={item.key} value={item.key}>{item.name}</option>)}</select>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search issues..." aria-label="Search issues" className={`${inputClass} !w-56`} />
            <select value={severity} onChange={(event) => setSeverity(event.target.value as PinSeverity | "all")} aria-label="Filter by severity" className={`${inputClass} !w-40`}>
              <option value="all">All severities</option>
              {severityOrder.map((level) => <option key={level} value={level}>{severityLabels[level]}</option>)}
            </select>
          </div>

          {work.loading || register.loading ? (
            <SkeletonList rows={5} label="Loading issues" />
          ) : rows.length === 0 ? (
            <EmptyState title={tab === "open" ? (open.length ? "No issue matches" : "No open issues") : tab === "following_up" ? "No issues under follow-up match" : "No resolved issues yet"}>
              {tab === "open" && !open.length ? "Mark a pin as an issue on the plan, or press \"Log an issue\"." : "Change the search or the severity filter."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b border-line bg-surface-muted text-xs uppercase tracking-wider text-fg-muted">
                  <tr>
                    <th className="px-4 py-2.5">Issue</th>
                    <th className="px-3 py-2.5">Severity</th>
                    <th className="px-3 py-2.5">{tab === "resolved" ? "Closed" : "Since raised"}</th>
                    <th className="px-3 py-2.5">Assigned to</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((pin) => (
                    <tr key={pin.id} className="align-top">
                      <td className="px-4 py-3">
                        <button type="button" className="text-left font-bold text-brand-text hover:underline" onClick={()=>setViewing(pin.id)}>{pin.title}</button>
                        <p className="text-xs font-semibold text-brand-text">Task: {issueChecklistLabel(latest.get(pin.id) ?? {})}</p>
                        <p className="text-xs text-fg-muted">{work.sheetOf(pin.blueprint_id)} • {categoryLabels[pin.category]}{pin.due_date && isOverdue(pin, work.today) ? " • past deadline" : ""}</p>
                        {latest.get(pin.id)?.description || pin.description ? <p className="mt-1 line-clamp-2 max-w-md text-xs text-fg-muted">{latest.get(pin.id)?.description ?? pin.description}</p> : null}
                      </td>
                      <td className="px-3 py-3">
                        {tab === "open" ? (
                          <select value={pin.severity} aria-label={`Severity of ${pin.title}`} onChange={(event) => void patch(pin, { severity: event.target.value }, "Severity updated")} className={`rounded-md border-0 px-2 py-1 text-xs font-extrabold ${severityChip[pin.severity]}`}>
                            {severityOrder.map((level) => <option key={level} value={level}>{severityLabels[level]}</option>)}
                          </select>
                        ) : (
                          <span className={`rounded px-2 py-1 text-xs font-extrabold ${severityChip[pin.severity]}`}>{severityLabels[pin.severity]}</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-fg-muted">{tab !== "resolved" ? ageOf(pin) : pin.verified_at ? new Date(pin.verified_at).toLocaleDateString("en-PH", { day: "numeric", month: "short" }) : ""}</td>
                      <td className="px-3 py-3">
                        {tab === "open" ? (
                          <select value={pin.assigned_to ?? ""} aria-label={`Assign ${pin.title}`} onChange={(event) => void patch(pin, { assigned_to: event.target.value || null }, "Assignment updated")} className="max-w-[10rem] rounded-md border border-line bg-surface px-2 py-1 text-xs">
                            <option value="">Anyone</option>
                            {foremen.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name}</option>)}
                          </select>
                        ) : (
                          <span className="text-fg-muted">{work.nameOf(pin.assigned_to)}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" className="rounded-md border border-line px-2.5 py-1 text-xs font-bold hover:bg-surface-muted" onClick={()=>setViewing(pin.id)}>Details / photos</button>
                          <button type="button" className="rounded-md border border-line px-2.5 py-1 text-xs font-bold hover:bg-surface-muted" onClick={() => followLink(pinPlanPath("engineer", { projectId: pin.project_id, pinId: pin.id, sheetId: pin.blueprint_id, section: "issues" }), pin.project_id)}>Plan</button>
                          {tab === "open" ? (
                            <>
                              <button type="button" className="rounded-md border border-line px-2.5 py-1 text-xs font-bold hover:bg-surface-muted" onClick={() => setReopening(pin)}>Back to foreman</button>
                              <button type="button" className="rounded-md bg-green-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-800" onClick={() => void close(pin)}>Close</button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {logging ? <LogIssueModal pins={work.pins} sheets={work.blueprints} sheetOf={work.sheetOf} onClose={() => setLogging(false)} onDone={async () => { toast.success("Issue logged", "Description, photos and markup saved together."); setLogging(false); setTab("open"); await refresh() }} /> : null}
      {viewing && work.pins.find(pin=>pin.id===viewing) ? <IssueDetails key={viewing} pin={work.pins.find(pin=>pin.id===viewing)!} canEdit nameOf={work.nameOf} onClose={()=>setViewing(null)} /> : null}
      {reopening ? <BackToForemanModal pin={reopening} onClose={() => setReopening(null)} onDone={async () => { setReopening(null); await refresh() }} /> : null}
      <p className="mt-6 text-xs text-fg-muted">Tip: foremen and engineers can also mark a pin as an issue directly on the plan. <button type="button" className="inline-flex min-h-6 items-center font-bold text-brand-text underline" onClick={() => onNavigate("annotation")}>Open the plan</button></p>
    </div>
  )
}

function BackToForemanModal({ pin, onClose, onDone }: { pin: Pin; onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast()
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (note.trim().length < 5) return setError("Tell the foreman what to fix (at least 5 characters).")
    setBusy(true)
    setError("")
    const { error: updateError } = await supabase.rpc("return_site_issue",{p_pin:pin.id,p_note:note.trim()})
    setBusy(false)
    if(updateError) return setError(dbMessage(updateError))
    toast.success("Sent back to the foreman")
    await onDone()
  }

  return (
    <Modal title="Send back to the foreman" description={pin.title} onClose={busy ? () => undefined : onClose}
      footer={<><button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="back-foreman-form" className={buttonPrimary} disabled={busy}>{busy ? "Sending..." : "Send back"}</button></>}>
      <form id="back-foreman-form" noValidate onSubmit={(event) => void submit(event)}>
        <label className="block text-sm font-semibold">What should the foreman do? *
          <textarea className={`${inputClass} mt-1`} rows={4} maxLength={1000} autoFocus value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error ? <p role="alert" className="mt-2 text-sm text-danger-fg">{error}</p> : null}
        <p className="mt-3 text-xs text-fg-muted">The pin goes back to "In progress" and the note is saved in its timeline.</p>
      </form>
    </Modal>
  )
}
