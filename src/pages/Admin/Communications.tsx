import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnnouncementView } from "../../components/AnnouncementBanner"
import Modal from "../../components/Modal"
import { EmptyState, buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { Skeleton, SkeletonRows } from "../../components/ui/Skeleton"
import { formatDate, formatTime, roleLabel } from "../../lib/admin"
import { MESSAGE_MAX, TITLE_MAX, TONES, toneLabels, validateAnnouncement, type AnnouncementTone } from "../../lib/announcementModel"
import { useAuth, type AppRole } from "../../lib/auth"
import { listBatches, loadAnnouncementSettings, previewAudience, saveAnnouncement, searchRecipients, sendMessage, type AnnouncementSettings } from "../../lib/communications"
import {
  BODY_MAX, TITLE_MAX as MESSAGE_TITLE_MAX, addRecipients, capFor, channelLabel, channels, outcomeSummary, previewLines, recipientName, validateMessage,
  type AudiencePreview, type BatchRow, type Channel, type Recipient,
} from "../../lib/communicationsModel"
import { useConfirm } from "../../lib/confirm"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

const label = "block text-xs font-bold uppercase tracking-wider text-fg-muted"
const setupNote = (message: string) => <p role="status" className="rounded-xl border border-line bg-surface-muted px-4 py-3 text-sm text-fg-muted">{message}</p>

// ---------------------------------------------------------------- Announcement banner (Super Admin; lives in System Control)
// Quick texts only fill the form; nothing is published until the Super Admin presses Publish and confirms.
const QUICK_TEXTS: Array<{ name: string; title: string; message: string; tone: AnnouncementTone }> = [
  { name: "New version available", title: "A new version is available", message: "BuildTrack was updated. Please refresh this page, or close and reopen the app, to use the latest version. Save any unfinished work first.", tone: "info" },
  { name: "Planned maintenance", title: "Planned maintenance", message: "BuildTrack will be read-only for a short time while we maintain it. Work you have not sent yet is kept and goes out afterwards.", tone: "warning" },
  { name: "Back to normal", title: "BuildTrack is back to normal", message: "The maintenance is finished and everything works again. Thank you for your patience.", tone: "success" },
]

export function AnnouncementPanel() {
  const toast = useToast()
  const confirm = useConfirm()
  const [settings, setSettings] = useState<AnnouncementSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState("")
  const [setup, setSetup] = useState(false)
  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [tone, setTone] = useState<AnnouncementTone>("info")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const result = await loadAnnouncementSettings()
    if (result.error) {
      setProblem(result.error)
      setSetup(result.setup)
    } else {
      setProblem("")
      setSetup(false)
      setSettings(result.data)
      if (result.data) {
        setTitle(result.data.title)
        setMessage(result.data.message)
        setTone((TONES.find((candidate) => candidate === result.data?.tone) ?? "info") as AnnouncementTone)
      }
    }
    setLoading(false)
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const save = async (enabled: boolean) => {
    const invalid = validateAnnouncement({ title, message, tone, enabled })
    if (invalid) return toast.error("Not saved", invalid)
    const publishing = enabled
    const ok = await confirm({
      title: publishing ? (settings?.enabled ? "Update the announcement?" : "Publish the announcement?") : "Switch the announcement off?",
      message: publishing ? "It appears at the top of every page for everyone, including visitors who are not signed in. People who dismissed an earlier version see this one again." : "It disappears from every page within about 30 seconds.",
      confirmLabel: publishing ? (settings?.enabled ? "Update" : "Publish") : "Switch off",
      tone: tone === "critical" && publishing ? "danger" : undefined,
    })
    if (!ok) return
    setBusy(true)
    const result = await saveAnnouncement({ title, message, tone, enabled })
    setBusy(false)
    if (result.error) return toast.error("Not saved", result.error)
    toast.success(publishing ? "Announcement is live" : "Announcement switched off", `Revision ${result.data}`)
    await load()
  }

  const dirty = settings ? settings.title !== title.trim() || settings.message !== message.trim() || settings.tone !== tone : Boolean(title || message)
  const preview = title.trim() && message.trim() ? { title: title.trim(), message: message.trim(), tone, revision: settings?.revision ?? 0 } : null

  return (
    <Panel title="Site announcement banner" action={settings ? <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${settings.enabled ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100" : "bg-surface-muted text-fg-muted"}`}>{settings.enabled ? `Live · revision ${settings.revision}` : "Switched off"}</span> : undefined}>
      <p className="mb-4 text-sm text-fg-muted">One banner at the top of every page, signed in or not. Editing it shows it again to people who dismissed the old one. A critical banner cannot be dismissed. Only a Super Admin can publish.</p>
      {loading ? (
        <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : problem ? (
        setup ? setupNote(problem) : <p role="alert" className="rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{problem}</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <label className={label}>Title
              <input className={`${inputClass} mt-1 normal-case`} value={title} maxLength={TITLE_MAX} onChange={(event) => setTitle(event.target.value)} placeholder="For example: Planned maintenance" />
              <span className="mt-1 block text-xs font-normal normal-case text-fg-muted">{title.trim().length}/{TITLE_MAX}</span>
            </label>
            <label className={label}>Message
              <textarea className={`${inputClass} mt-1 min-h-24 normal-case`} value={message} maxLength={MESSAGE_MAX} onChange={(event) => setMessage(event.target.value)} placeholder="What people need to know" />
              <span className="mt-1 block text-xs font-normal normal-case text-fg-muted">{message.trim().length}/{MESSAGE_MAX}. Plain text only.</span>
            </label>
            <label className={label}>Tone
              <select className={`${inputClass} mt-1 !w-auto normal-case`} value={tone} onChange={(event) => setTone(event.target.value as AnnouncementTone)}>
                {TONES.map((value) => <option key={value} value={value}>{toneLabels[value]}</option>)}
              </select>
            </label>
            <div>
              <p className={label}>Quick text</p>
              <div className="mt-1 flex flex-wrap gap-2">{QUICK_TEXTS.map((quick) => <button key={quick.name} type="button" className={buttonSecondary} onClick={() => { setTitle(quick.title); setMessage(quick.message); setTone(quick.tone) }}>{quick.name}</button>)}</div>
              <p className="mt-1 text-xs text-fg-muted">Fills the form. Nothing is published until you press Publish.</p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" className={buttonPrimary} disabled={busy || !preview || (settings?.enabled && !dirty)} onClick={() => void save(true)}>{settings?.enabled ? "Update announcement" : "Publish announcement"}</button>
              {settings?.enabled ? <button type="button" className={buttonSecondary} disabled={busy} onClick={() => void save(false)}>Switch off</button> : null}
            </div>
            {settings?.updated_at ? <p className="text-xs text-fg-muted">Last changed {formatDate(settings.updated_at)} {formatTime(settings.updated_at)}{settings.updated_by_name ? ` by ${settings.updated_by_name}` : ""}.</p> : null}
          </div>
          <div>
            <p className={label}>Preview</p>
            <div className="mt-1 overflow-hidden rounded-xl border border-line">
              {preview ? <AnnouncementView announcement={preview} onDismiss={() => undefined} /> : <p className="px-4 py-6 text-sm text-fg-muted">Write a title and a message to see how it looks.</p>}
            </div>
            {tone === "critical" ? <p className="mt-2 text-xs text-fg-muted">Critical banners have no close button.</p> : null}
          </div>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------- Send a message
const quickRoles: Array<{ role: AppRole; text: string }> = [
  { role: "engineer", text: "All Engineers" },
  { role: "foreman", text: "All Foremen" },
  { role: "client", text: "All Clients" },
  { role: "project_manager", text: "All Project Managers" },
]

export function MessagePanel({ isSuper, onSent }: { isSuper: boolean; onSent: () => void }) {
  const toast = useToast()
  const cap = capFor(isSuper)
  const [chosen, setChosen] = useState<Recipient[]>([])
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Recipient[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [setup, setSetup] = useState(false)
  const [channel, setChannel] = useState<Channel>("app")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [link, setLink] = useState("")
  const [review, setReview] = useState<AudiencePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const batch = useRef("") // the idempotency key of the message being written: a retry reuses it, so the same send can never go out twice
  const lookup = useRef(0)

  // Search as the sender types (waits for a pause; only the newest answer is used).
  useEffect(() => {
    const run = ++lookup.current
    if (!query.trim()) {
      setResults([])
      setSearchError("")
      return
    }
    setSearching(true)
    const timer = window.setTimeout(async () => {
      const result = await searchRecipients(query, null, 20)
      if (run !== lookup.current) return
      setSearching(false)
      setSearchError(result.error)
      setSetup(Boolean(result.error) && result.setup)
      setResults(result.data ?? [])
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const add = (people: Recipient[]) => {
    const merged = addRecipients(chosen, people, cap)
    setChosen(merged.list)
    if (merged.overLimit) toast.error("Some people were not added", `You can send to at most ${cap} people at once. ${merged.overLimit} did not fit.`)
    else if (!merged.added) toast.success("Already on the list")
  }
  const addRole = async (role: AppRole) => {
    const result = await searchRecipients("", [role], cap + 1)
    if (result.error) return toast.error("Could not load the people", result.error)
    add(result.data ?? [])
  }

  const invalid = validateMessage({ title, body, link, channel, count: chosen.length, isSuper })

  const openReview = async () => {
    if (invalid) return toast.error("Not ready to send", invalid)
    setBusy(true)
    const result = await previewAudience(chosen.map((person) => person.id), channel)
    setBusy(false)
    if (result.error || !result.data) return toast.error("Could not prepare the preview", result.error)
    if (!result.data.eligible) return toast.error("Nobody can receive this", "Only active accounts can receive messages.")
    setReview(result.data)
  }

  const send = async () => {
    setBusy(true)
    if (!batch.current) batch.current = crypto.randomUUID()
    const result = await sendMessage({ batch: batch.current, ids: chosen.map((person) => person.id), title, body, channel, link })
    setBusy(false)
    if (result.error || !result.data) return toast.error("Not sent", result.error) // the same batch id is kept, so trying again cannot duplicate
    setReview(null)
    toast.success(result.data.duplicate ? "Already sent" : `Sent to ${result.data.delivered} ${result.data.delivered === 1 ? "person" : "people"}`, result.data.skipped ? `${result.data.skipped} not active, left out.` : undefined)
    batch.current = "" // the next message gets a new id
    setChosen([])
    setTitle("")
    setBody("")
    setLink("")
    setQuery("")
    onSent()
  }

  const byRole = useMemo(() => Object.entries(review?.by_role ?? {}).map(([role, count]) => `${count} ${roleLabel[role as AppRole] ?? role}`).join(", "), [review])

  return (
    <Panel title="Send a message">
      <p className="mb-4 text-sm text-fg-muted">Send a notice to one person or to a group of active accounts, in the app, by email or both. You review the audience before anything is sent. Every send is recorded in the audit log.</p>
      {setup ? setupNote(searchError) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <p className={label}>1. Who</p>
            <label className="block text-sm">
              <span className="sr-only">Search people</span>
              <input className={`${inputClass} normal-case`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or company" aria-label="Search people" />
            </label>
            {searchError ? <p role="alert" className="text-sm text-danger-fg">{searchError}</p> : null}
            {query.trim() ? (
              <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-xl border border-line" aria-label="Search results">
                {searching && !results.length ? <li className="px-3 py-2 text-sm text-fg-muted">Searching...</li> : null}
                {!searching && !results.length && !searchError ? <li className="px-3 py-2 text-sm text-fg-muted">No active account matches.</li> : null}
                {results.map((person) => (
                  <li key={person.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0"><strong className="block truncate">{recipientName(person)}</strong><span className="block truncate text-xs text-fg-muted">{person.email} · {person.role ? roleLabel[person.role as AppRole] ?? person.role : "No role"}</span></span>
                    <button type="button" className={`${buttonSecondary} !min-h-8 !px-3 !py-1 text-xs`} disabled={chosen.some((known) => known.id === person.id)} onClick={() => add([person])}>{chosen.some((known) => known.id === person.id) ? "Added" : "Add"}</button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add a whole group">
              {quickRoles.map((entry) => <button key={entry.role} type="button" className="rounded-full border border-line px-3 py-1 text-xs font-bold text-fg-muted hover:border-brand hover:text-fg" onClick={() => void addRole(entry.role)}>{entry.text}</button>)}
            </div>
            <div>
              <div className="flex items-baseline justify-between"><p className="text-sm font-bold">{chosen.length} chosen <span className="font-normal text-fg-muted">(limit {cap})</span></p>{chosen.length ? <button type="button" className="text-xs font-bold text-brand-text underline" onClick={() => setChosen([])}>Clear all</button> : null}</div>
              {chosen.length ? (
                <ul className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label="Chosen people">
                  {chosen.map((person) => (
                    <li key={person.id} className="inline-flex items-center gap-1 rounded-full bg-surface-muted py-0.5 pl-3 pr-1 text-xs font-semibold">
                      <span className="max-w-40 truncate">{recipientName(person)}</span>
                      <button type="button" aria-label={`Remove ${recipientName(person)}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-black/10" onClick={() => setChosen((current) => current.filter((known) => known.id !== person.id))}>×</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-xs text-fg-muted">Nobody yet. Search above, or add a whole group.</p>}
            </div>
          </div>
          <div className="space-y-3">
            <p className={label}>2. How and what</p>
            <fieldset>
              <legend className="sr-only">Channel</legend>
              <div className="grid gap-1.5">
                {channels.map((entry) => (
                  <label key={entry.value} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm ${channel === entry.value ? "border-brand bg-brand-soft" : "border-line"}`}>
                    <input type="radio" name="message-channel" className="mt-1 accent-[#9E1F93]" checked={channel === entry.value} onChange={() => setChannel(entry.value)} />
                    <span><strong className="block">{entry.label}</strong><span className="text-xs text-fg-muted">{entry.help}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className={label}>Title
              <input className={`${inputClass} mt-1 normal-case`} value={title} maxLength={MESSAGE_TITLE_MAX} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className={label}>Message
              <textarea className={`${inputClass} mt-1 min-h-24 normal-case`} value={body} maxLength={BODY_MAX} onChange={(event) => setBody(event.target.value)} />
              <span className="mt-1 block text-xs font-normal normal-case text-fg-muted">{body.trim().length}/{BODY_MAX}. Plain text only.</span>
            </label>
            <label className={label}>Link to a page (optional)
              <input className={`${inputClass} mt-1 normal-case`} value={link} onChange={(event) => setLink(event.target.value)} placeholder="/engineer/dashboard" />
            </label>
            <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void openReview()}>Review and send</button>
            {invalid && (title || body || chosen.length) ? <p className="text-xs text-fg-muted">{invalid}</p> : null}
          </div>
        </div>
      )}

      {review ? (
        <Modal
          title="Send this message?"
          description={`${channelLabel(channel)} · ${review.eligible} ${review.eligible === 1 ? "person" : "people"}`}
          size="md"
          onClose={() => !busy && setReview(null)}
          footer={
            <>
              <button type="button" className={buttonSecondary} disabled={busy} onClick={() => setReview(null)}>Back</button>
              <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void send()}>{busy ? "Sending..." : `Send to ${review.eligible} ${review.eligible === 1 ? "person" : "people"}`}</button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-line bg-surface-muted/60 p-3">
              <p className="font-extrabold">{title.trim()}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">{body.trim()}</p>
              {link.trim() ? <p className="mt-1 text-xs text-fg-muted">Opens: {link.trim()}</p> : null}
            </div>
            <ul className="list-disc space-y-1 pl-5">{previewLines(review, channel).map((line) => <li key={line}>{line}</li>)}</ul>
            {byRole ? <p className="text-fg-muted">By role: {byRole}.</p> : null}
            {review.sample.length ? <p className="text-fg-muted">Includes {review.sample.join(", ")}{review.eligible > review.sample.length ? " and others" : ""}.</p> : null}
            <p className="text-xs text-fg-muted">This cannot be unsent. Pressing Send twice does not send it twice.</p>
          </div>
        </Modal>
      ) : null}
    </Panel>
  )
}

// ---------------------------------------------------------------- Recent messages
function HistoryPanel({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<BatchRow[] | null>(null)
  const [problem, setProblem] = useState("")
  const [setup, setSetup] = useState(false)
  const load = useCallback(async () => {
    const result = await listBatches(20)
    setProblem(result.error)
    setSetup(Boolean(result.error) && result.setup)
    setRows(result.data ?? [])
  }, [])
  useEffect(() => {
    void load()
  }, [load, refreshKey])

  return (
    <Panel title="Recent messages" action={<button type="button" className="text-sm font-bold text-brand-text underline" onClick={() => void load()}>Refresh</button>}>
      <p className="mb-3 text-xs text-fg-muted">Email results: sent, waiting (queued or retrying), skipped (the person switched emails off, is not active, or reached the daily limit) and failed.</p>
      {problem ? (setup ? setupNote(problem) : <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{problem}</p>) : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Date</th><th>Time (PHT)</th><th>Title</th><th>Sent by</th><th>How</th><th>Result</th></tr></thead>
          <tbody>
            {rows === null ? <SkeletonRows rows={4} cols={6} /> : rows.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No messages sent yet">Messages you send appear here with what happened to each email.</EmptyState></td></tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td className="is-muted">{formatDate(row.created_at)}</td>
                <td className="is-muted">{formatTime(row.created_at)}</td>
                <td className="is-strong">{row.title}</td>
                <td>{row.sender_name ?? "—"}</td>
                <td>{channelLabel(row.channel)}</td>
                <td>{outcomeSummary(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export default function Communications(_: AdminPageProps) {
  const { profile, can } = useAuth()
  const isSuper = profile?.role === "super_admin"
  const [refreshKey, setRefreshKey] = useState(0)
  return (
    <div className="admin-page">
      <PageIntro eyebrow="Communications" title="Announcements & messages" description="Show a banner on every page, or send a message to people's notifications and inboxes. Everything here is recorded in the audit log." />
      <Panel title="Site announcement banner"><p className="text-sm text-fg-muted">{isSuper ? "The banner is now managed in System Control, on the Announcement banner tab. " : "Only a Super Admin can publish or change the banner. "}Sending a message to people stays on this page.</p>{isSuper ? <a className="mt-3 inline-block text-sm font-bold underline" href="/admin/system-control?tab=banner" onClick={(event) => { event.preventDefault(); window.history.pushState({}, "", "/admin/system-control?tab=banner"); window.dispatchEvent(new PopStateEvent("popstate")) }}>Open System Control: Announcement banner</a> : null}</Panel>
      {can("users.edit") ? <MessagePanel isSuper={isSuper} onSent={() => setRefreshKey((value) => value + 1)} /> : <Panel title="Send a message"><p className="text-sm text-fg-muted">You need the Edit users permission to send messages.</p></Panel>}
      {can("users.edit") ? <HistoryPanel refreshKey={refreshKey} /> : null}
    </div>
  )
}
