import { useEffect, useRef, useState, type FormEvent } from "react"
import ProjectContextBar from "../../components/ProjectContextBar"
import { EmptyState, PageHead, buttonPrimary, inputClass } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { useProjectWork } from "../../lib/projectWork"
import { getSelectedProjectId } from "../../lib/projects"
import { reportError, useQuestions } from "../../lib/reports"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import type { ClientPageProps } from "./types"
import { clientPinPath, openClientPath } from "../../lib/clientPortalModel"
import { useAuth } from "../../lib/auth"
import SiteVisitsPanel from "../../components/SiteVisitsPanel"

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
const readTab = () => new URLSearchParams(window.location.search).get("tab") === "visits" ? "visits" : "questions"

// Ask the project team a question (about the project or one work item). The engineer answers here and you get a notification.
export default function ClientCommunication(_: ClientPageProps) {
  const projectId = getSelectedProjectId()
  const { profile } = useAuth()
  const work = useProjectWork(projectId)
  const { questions, loading, error, reload } = useQuestions(projectId)
  const toast = useToast()
  const [text, setText] = useState("")
  const [tab, setTab] = useState<"questions" | "visits">(readTab)
  const [pinId, setPinId] = useState(() => new URLSearchParams(window.location.search).get("pin") ?? "")
  const [wanted, setWanted] = useState(() => new URLSearchParams(window.location.search).get("question"))
  const [problem, setProblem] = useState("")
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const pins = work.pins.filter((pin) => pin.category !== "note")
  const mine = questions.filter(question => question.project_id === projectId && question.author_id === profile?.id)
  useEffect(() => {
    const changed = () => { setWanted(new URLSearchParams(window.location.search).get("question")); setPinId(new URLSearchParams(window.location.search).get("pin") ?? ""); setTab(readTab()) }
    window.addEventListener("popstate", changed)
    return () => window.removeEventListener("popstate", changed)
  }, [])
  useEffect(() => { if (wanted && mine.some(question => question.id === wanted)) document.getElementById(`question-${wanted}`)?.scrollIntoView({ block: "center", behavior: "smooth" }) }, [wanted, questions])

  const ask = async (event: FormEvent) => {
    event.preventDefault()
    if (!projectId || sending.current) return
    if (text.trim().length < 3) return setProblem("Write your question (at least 3 characters).")
    if (pinId && !pins.some(pin => pin.id === pinId && pin.project_id === projectId)) return setProblem("Choose a work pin from this project.")
    setProblem("")
    setBusy(true)
    sending.current = true
    const { error: insertError } = await supabase.from("project_questions").insert({ project_id: projectId, pin_id: pinId || null, question: text.trim() }).then(result => result, () => ({ error: { message: "Connection interrupted. Check your questions before trying again." } }))
    setBusy(false)
    sending.current = false
    if (insertError) {
      const message = /many questions/i.test(insertError.message) ? "You have asked many questions today. Please wait for answers." : reportError(insertError)
      setProblem(message)
      return toast.error("Question not sent", message)
    }
    toast.success("Question sent", "The engineer will answer here.")
    setText("")
    setPinId("")
    await reload()
  }

  return (
    <div className="client-page">
      <ProjectContextBar listPath="/client/overview" listLabel="Overview" />
      <PageHead eyebrow="Client portal" title="Communication" description="Ask the project engineers a question or request a site visit. Responses and confirmations appear here." />
      {!projectId ? null : (
        <>
          <div role="tablist" aria-label="Communication" className="mb-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-line bg-surface p-1 shadow-sm">
            {([ ["questions", "Questions"], ["visits", "Site visits"] ] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === key ? "bg-brand text-white" : "text-fg-muted hover:bg-surface-muted"}`} onClick={() => { setTab(key); const params = new URLSearchParams(window.location.search); params.set("tab", key); window.history.replaceState({}, "", `${window.location.pathname}?${params}`) }}>{label}</button>)}
          </div>
          {tab === "visits" ? <SiteVisitsPanel key={projectId} projectId={projectId} mode="client" /> : <>
          <form onSubmit={(event) => void ask(event)} noValidate className="mb-6 rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <label className="block text-sm font-semibold">Your question
              <textarea className={`${inputClass} mt-1`} rows={3} maxLength={1000} value={text} onChange={(event) => setText(event.target.value)} placeholder="e.g. When will the lobby wall be finished?" />
            </label>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <label className="block min-w-[14rem] flex-1 text-sm font-semibold">About a work item (optional)
                <select className={`${inputClass} mt-1`} disabled={busy || work.loading || Boolean(work.error)} value={pinId} onChange={(event) => setPinId(event.target.value)}>
                  <option value="">The project in general</option>
                  {pins.map((pin) => <option key={pin.id} value={pin.id}>{pin.title} ({work.sheetOf(pin.blueprint_id)})</option>)}
                </select>
              </label>
              <button type="submit" className={buttonPrimary} disabled={busy || work.loading || Boolean(work.error)}>{busy ? "Sending..." : "Send question"}</button>
            </div>
            {problem ? <p role="alert" className="mt-2 text-sm text-danger-fg">{problem}</p> : null}
            {work.error ? <p role="alert" className="mt-2 text-sm text-danger-fg">{work.error} <button type="button" className="underline" onClick={() => void work.reload()}>Retry</button></p> : null}
          </form>

          <h2 className="mb-2 border-l-4 border-accent pl-3 text-base font-extrabold text-brand-strong">Your questions</h2>
          {loading ? (
            <SkeletonList rows={3} label="Loading your questions" />
          ) : error ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p>
          ) : mine.length === 0 ? (
            <EmptyState title="No questions yet">Ask anything about the progress, schedule or a specific work item.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {mine.map((question) => (
                <li id={`question-${question.id}`} key={question.id} className={`rounded-xl border bg-surface p-4 ${question.id === wanted ? "border-brand ring-1 ring-brand" : "border-line"}`}>
                  <p className="text-xs text-fg-muted">{when(question.created_at)}{question.pin_id ? ` • about "${work.pins.find((pin) => pin.id === question.pin_id)?.title ?? "a work item"}"` : ""}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm font-semibold">{question.question}</p>
                  {pins.find(pin => pin.id === question.pin_id) ? <button type="button" className="mt-2 text-xs font-bold text-brand-text underline" onClick={() => { const pin = pins.find(pin => pin.id === question.pin_id)!; openClientPath(clientPinPath(question.project_id, pin.blueprint_id, pin.id)) }}>Open linked work pin</button> : null}
                  {question.answer ? (
                    <div className="mt-3 rounded-lg bg-surface-muted p-3 text-sm">
                      <p className="text-xs font-bold text-brand-text">Answer from {work.nameOf(question.answered_by)}{question.answered_at ? ` • ${when(question.answered_at)}` : ""}</p>
                      <p className="mt-1 whitespace-pre-wrap">{question.answer}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-xs font-semibold text-amber-700 dark:text-amber-300">Waiting for an answer</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          </>}
        </>
      )}
    </div>
  )
}
