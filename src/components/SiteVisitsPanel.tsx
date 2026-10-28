import { useEffect, useRef, useState, type FormEvent } from "react"
import { EmptyState, buttonPrimary, buttonSecondary, inputClass } from "./ui/PageParts"
import { SkeletonList } from "./ui/Skeleton"
import { useAuth } from "../lib/auth"
import { useConfirm } from "../lib/confirm"
import { useToast } from "../lib/toast"
import { manilaToday } from "../lib/progress"
import { decideSiteVisit, requestSiteVisit, useSiteVisits } from "../lib/siteVisits"
import { visitDraftProblem, visitStamp, visitStatusLabels, visitStatusTone, type SiteVisit, type SiteVisitDraft } from "../lib/siteVisitsModel"

export default function SiteVisitsPanel({ projectId, mode, nameOf = () => "Client" }: { projectId: string; mode: "client" | "engineer"; nameOf?: (id: string | null) => string }) {
  const { profile } = useAuth()
  const data = useSiteVisits(projectId)
  const toast = useToast()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<SiteVisitDraft>({ date: "", time: "", purpose: "", visitors: 1 })
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState("")
  const sending = useRef(false)
  const [wanted, setWanted] = useState(() => new URLSearchParams(window.location.search).get("visit"))
  const mine = data.visits.filter(visit => visit.project_id === projectId && (mode === "engineer" || visit.client_id === profile?.id))
  useEffect(() => {
    const changed = () => setWanted(new URLSearchParams(window.location.search).get("visit"))
    window.addEventListener("popstate", changed)
    return () => window.removeEventListener("popstate", changed)
  }, [])
  useEffect(() => { if (wanted && mine.some(visit => visit.id === wanted)) document.getElementById(`site-visit-${wanted}`)?.scrollIntoView({ block: "center", behavior: "smooth" }) }, [wanted, data.visits])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending.current) return
    const error = visitDraftProblem(draft)
    if (error) return setProblem(error)
    sending.current = true; setBusy("new"); setProblem("")
    try {
      const result = await requestSiteVisit(projectId, draft)
      if (result.error) throw result.error
      setDraft({ date: "", time: "", purpose: "", visitors: 1 })
      toast.success("Visit requested", "The project engineer will confirm or respond here.")
      await data.reload()
    } catch (error) {
      const message = (error as { code?: string }).code === "23505" ? "You already have a request for this date and time." : "Request could not be confirmed as sent. Check your requests before trying again."
      setProblem(message)
    } finally { sending.current = false; setBusy(null) }
  }
  const decide = async (visit: SiteVisit, status: "confirmed" | "declined" | "cancelled") => {
    if (sending.current) return
    const note = (notes[visit.id] ?? "").trim()
    if (status === "declined" && !note) return setProblem("Add a message explaining why the visit cannot be confirmed.")
    if (status === "cancelled" && !await confirm({ title: "Cancel this visit?", message: `Cancel the site visit requested for ${visitStamp(visit.preferred_at)} (Manila time)?`, confirmLabel: "Cancel visit" })) return
    if (sending.current) return
    sending.current = true; setBusy(visit.id); setProblem("")
    try {
      const result = await decideSiteVisit(visit, status, note)
      if (result.error) throw result.error
      if (!result.data?.length) { setProblem("This request changed or is no longer available. The list has been refreshed."); await data.reload(); return }
      toast.success(status === "confirmed" ? "Visit confirmed" : status === "declined" ? "Response sent" : "Visit cancelled")
      await data.reload()
    } catch { setProblem("Could not save the response. Refresh the list and try again.") }
    finally { sending.current = false; setBusy(null) }
  }

  return <section aria-label="Site visits" className="space-y-5">
    {mode === "client" ? <form onSubmit={event => void submit(event)} noValidate className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="font-extrabold text-brand-strong">Request a site visit</h2>
      <p className="mt-1 text-sm text-fg-muted">Suggest a date and time for a visit with the project engineer. Please wait for confirmation before visiting. All times are Manila time.</p>
      <fieldset disabled={Boolean(busy)} className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-semibold">Preferred date *<input aria-label="Preferred visit date" type="date" required min={manilaToday()} value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold">Preferred time *<input aria-label="Preferred visit time" type="time" required value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold">Number of visitors *<input aria-label="Number of visitors" type="number" required min={1} max={50} value={draft.visitors} onChange={event => setDraft({ ...draft, visitors: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>
        <label className="text-sm font-semibold sm:col-span-3">Purpose of visit *<textarea aria-label="Purpose of visit" required rows={3} minLength={5} maxLength={1000} value={draft.purpose} onChange={event => setDraft({ ...draft, purpose: event.target.value })} placeholder="e.g. Review the ground floor finishes and discuss the next stage." className={`${inputClass} mt-1`} /></label>
      </fieldset>
      <div className="mt-4 flex justify-end"><button type="submit" className={buttonPrimary} disabled={Boolean(busy)}>{busy === "new" ? "Sending..." : "Send visit request"}</button></div>
    </form> : <p className="text-sm text-fg-muted">Confirm the client’s proposed visit time or decline with a message. The client receives your response. All times are Manila time.</p>}
    {problem ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger-fg">{problem}</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-extrabold text-brand-strong">{mode === "client" ? "Your visit requests" : "Client visit requests"}</h2><button type="button" className={buttonSecondary} disabled={Boolean(busy) || data.loading} onClick={() => void data.reload()}>Refresh</button></div>
    {data.loading ? <SkeletonList rows={3} label="Loading visit requests" /> : data.error ? <p role="alert" className="text-sm text-danger-fg">{data.error}</p> : !mine.length ? <EmptyState title="No site visit requests yet">{mode === "client" ? "Send a request to arrange a visit with your project engineer." : "Requests from this project’s clients will appear here."}</EmptyState> : <ul className="space-y-3">
      {mine.map(visit => {
        const future = new Date(visit.preferred_at).getTime() > Date.now()
        return <li id={`site-visit-${visit.id}`} key={visit.id} className={`rounded-xl border bg-surface p-4 ${visit.id === wanted ? "border-brand ring-1 ring-brand" : "border-line"}`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{visitStamp(visit.preferred_at)} <span className="text-xs font-normal text-fg-muted">Manila</span></h3><p className="mt-1 text-xs text-fg-muted">{mode === "engineer" ? `${nameOf(visit.client_id)} · ` : ""}{visit.visitors} visitor{visit.visitors === 1 ? "" : "s"} · Requested {visitStamp(visit.created_at)}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${visitStatusTone[visit.status]}`}>{visitStatusLabels[visit.status]}</span></div>
          <p className="mt-3 whitespace-pre-wrap text-sm">{visit.purpose}</p>
          {visit.engineer_note ? <div className="mt-3 rounded-lg bg-surface-muted p-3 text-sm"><p className="text-xs font-bold text-brand-text">Engineer’s response</p><p className="mt-1 whitespace-pre-wrap">{visit.engineer_note}</p></div> : null}
          {mode === "engineer" && visit.status === "requested" && future ? <div className="mt-4 space-y-2"><label className="block text-sm font-semibold">Message to client<textarea aria-label={`Response for visit ${visit.id}`} className={`${inputClass} mt-1`} rows={2} maxLength={2000} disabled={Boolean(busy)} value={notes[visit.id] ?? ""} onChange={event => setNotes({ ...notes, [visit.id]: event.target.value })} placeholder="Meeting point, arrival instructions, or reason for declining." /></label><div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={Boolean(busy)} className={buttonSecondary} onClick={() => void decide(visit, "declined")}>Decline</button><button type="button" disabled={Boolean(busy)} className={buttonPrimary} onClick={() => void decide(visit, "confirmed")}>{busy === visit.id ? "Saving..." : "Confirm visit"}</button></div></div> : null}
          {mode === "client" && ["requested", "confirmed"].includes(visit.status) && future ? <div className="mt-3 flex justify-end"><button type="button" className={buttonSecondary} disabled={Boolean(busy)} onClick={() => void decide(visit, "cancelled")}>Cancel visit</button></div> : null}
          {!future && visit.status === "requested" ? <p className="mt-2 text-xs text-fg-muted">The requested visit time has passed without confirmation.</p> : null}
        </li>
      })}
    </ul>}
  </section>
}
