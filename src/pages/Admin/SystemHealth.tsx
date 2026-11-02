import { useCallback, useEffect, useMemo, useState } from "react"
import { buttonPrimary, buttonSecondary } from "../../components/ui/PageParts"
import { Skeleton } from "../../components/ui/Skeleton"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { DIGEST_SCHEDULE_SQL, statusLabel, summarize, type HealthCheck, type HealthStatus } from "../../lib/healthModel"
import { askProviderAboutTest, previewDigest, requestTestEmail, runHealthChecks, type DeliveryAnswer, type DigestPreview, type HealthRun, type TestEmailAnswer } from "../../lib/systemHealth"
import { useToast } from "../../lib/toast"
import { formatDate, formatTime, roleLabel } from "../../lib/admin"
import type { AppRole } from "../../lib/auth"
import { PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

// Status is always written in words and marked with a symbol, never by colour alone.
const badge: Record<HealthStatus, { symbol: string; tone: string }> = {
  ok: { symbol: "✓", tone: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100" },
  info: { symbol: "i", tone: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100" },
  unknown: { symbol: "?", tone: "bg-surface-muted text-fg" },
  warn: { symbol: "!", tone: "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100" },
  fail: { symbol: "×", tone: "bg-red-100 text-red-950 dark:bg-red-900/40 dark:text-red-100" },
}
const when = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`

export function StatusBadge({ status }: { status: HealthStatus }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${badge[status].tone}`}><span aria-hidden="true">{badge[status].symbol}</span>{statusLabel[status]}</span>
}

export function HealthResults({ checks }: { checks: HealthCheck[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, HealthCheck[]>()
    for (const check of checks) map.set(check.group, [...(map.get(check.group) ?? []), check])
    return [...map.entries()]
  }, [checks])
  return (
    <div className="space-y-5">
      {groups.map(([group, items]) => (
        <section key={group} aria-label={group}>
          <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">{group}</h3>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {items.map((check) => (
              <li key={check.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{check.title}</strong><StatusBadge status={check.status} /></div>
                <p className="mt-1 text-sm text-fg-muted">{check.summary}</p>
                {check.action ? <p className="mt-1 text-sm"><strong>What to do:</strong> <span className="text-fg-muted">{check.action}</span></p> : null}
                {check.details?.length ? (
                  <details className="mt-1 text-xs text-fg-muted">
                    <summary className="cursor-pointer font-bold text-brand-text">Details ({check.details.length})</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{check.details.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// One real email, to the signed-in Super Admin's own address only. The provider accepting it is shown apart from confirmed delivery.
export function EmailTestPanel({ email, canSend }: { email: string; canSend: boolean | null }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TestEmailAnswer | null>(null)
  const [problem, setProblem] = useState("")
  const [delivery, setDelivery] = useState<DeliveryAnswer | null>(null)
  const [asking, setAsking] = useState(false)

  const send = async () => {
    if (!(await confirm({ title: "Send one test email?", message: `One real email goes to ${email} (your own address) through the mail provider. At most 3 tests an hour.`, confirmLabel: "Send test email" }))) return
    setBusy(true); setProblem(""); setResult(null); setDelivery(null)
    const answer = await requestTestEmail()
    setBusy(false)
    if (answer.error || !answer.data) { setProblem(answer.error ?? "The test could not be requested."); return }
    setResult(answer.data)
    if (answer.data.accepted) toast.success("The provider accepted the test email", "Delivery is not confirmed yet.")
    else toast.error("The provider did not accept the test email")
  }
  const ask = async () => {
    if (!result) return
    setAsking(true)
    const answer = await askProviderAboutTest(result.test_id)
    setAsking(false)
    if (answer.error || !answer.data) return toast.error("Could not ask the provider", answer.error ?? undefined)
    setDelivery(answer.data)
  }

  return (
    <Panel title="Email test">
      <p className="mb-3 text-sm text-fg-muted">Sends one test message to <strong className="text-fg">{email || "your address"}</strong> only. You cannot choose another recipient. “Accepted” means the mail provider took the message; only the provider's delivery report confirms it reached the receiving mail server, and even that is not the same as someone reading it.</p>
      {canSend === false ? <p role="status" className="mb-3 rounded-lg bg-surface-muted px-4 py-2 text-sm text-fg-muted">Email is not set up yet (see Email settings above), so the provider will not be contacted.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonPrimary} disabled={busy} onClick={() => void send()}>{busy ? "Sending..." : "Send me a test email"}</button>
        {result?.accepted && result.message_id ? <button type="button" className={buttonSecondary} disabled={asking} onClick={() => void ask()}>{asking ? "Asking..." : "Ask the provider if it was delivered"}</button> : null}
      </div>
      {problem ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{problem}</p> : null}
      {result ? (
        <dl className="mt-4 grid gap-3 rounded-xl border border-line p-4 text-sm sm:grid-cols-3" aria-label="Test email result">
          <div><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">Provider</dt><dd className="mt-0.5 font-semibold">{result.accepted ? "Accepted the message" : "Did not accept the message"}{result.http_status ? ` (HTTP ${result.http_status})` : ""}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">Delivery</dt><dd className="mt-0.5 font-semibold">{delivery ? ({ delivered: "Confirmed delivered", failed: "Reported as not delivered", pending: "Not reported yet", unknown: "Unknown" })[delivery.state] : result.accepted ? "Not confirmed" : "Not sent"}</dd></div>
          <div><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">Provider's answer</dt><dd className="mt-0.5 break-words text-fg-muted">{result.detail}</dd></div>
          {delivery ? <div className="sm:col-span-3"><dt className="text-xs font-bold uppercase tracking-wider text-fg-muted">Delivery report</dt><dd className="mt-0.5 text-fg-muted">{delivery.detail}{delivery.events.length ? ` Events: ${delivery.events.join(", ")}.` : ""}</dd></div> : null}
        </dl>
      ) : null}
    </Panel>
  )
}

// What the daily admin digest would say today, without creating or sending anything, and how it is switched on.
export function DigestPanel({ lastRun }: { lastRun: HealthCheck | undefined }) {
  const [preview, setPreview] = useState<DigestPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState("")
  const [copied, setCopied] = useState(false)
  const load = async () => {
    setLoading(true); setProblem("")
    const answer = await previewDigest()
    setLoading(false)
    if (answer.error) { setProblem(answer.error); setPreview(null) } else setPreview(answer.data)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(DIGEST_SCHEDULE_SQL); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <Panel title="Daily admin digest">
      <p className="mb-3 text-sm text-fg-muted">Each morning every active Admin and Super Admin who has something to act on gets one summary in their bell (and by email, if they accept emails): registrations and requests waiting, open projects without a Project Manager, and, for Super Admins, email problems. People see only what they have permission to act on. Each person can switch it off in the bell menu. A person never gets two for one day, even if the job runs twice.</p>
      {lastRun ? <p className="mb-3 text-sm"><StatusBadge status={lastRun.status} /> <span className="ml-1 text-fg-muted">{lastRun.summary}</span></p> : null}
      <button type="button" className={buttonSecondary} disabled={loading} onClick={() => void load()}>{loading ? "Building the preview..." : "Preview today's digest"}</button>
      <span className="ml-2 text-xs text-fg-muted">A preview creates nothing and sends nothing.</span>
      {problem ? <p role="alert" className="mt-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{problem}</p> : null}
      {preview ? (
        <div className="admin-table-wrap mt-3">
          <table className="admin-table" aria-label="Digest preview">
            <thead><tr><th>Person</th><th>Role</th><th>Items</th><th>Would be told</th></tr></thead>
            <tbody>
              {preview.recipients.length === 0 ? <tr><td colSpan={4}>No active Admins or Super Admins.</td></tr> : preview.recipients.map((row) => (
                <tr key={`${row.name}-${row.role}`}>
                  <td className="is-strong">{row.name}</td>
                  <td>{roleLabel[row.role as AppRole] ?? row.role}</td>
                  <td className="tabular-nums">{row.total}</td>
                  <td>{row.opted_out ? "Opted out: gets nothing" : row.total === 0 ? "Nothing to report: gets nothing" : row.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <details className="mt-4 rounded-xl border border-line p-3 text-sm">
        <summary className="cursor-pointer font-bold">How the owner switches the schedule on</summary>
        <p className="mt-2 text-fg-muted">This screen never schedules anything. When approved, the owner runs this once in the Supabase SQL editor (it needs the Cron integration). Until then no digest is created.</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-muted p-3 text-xs">{DIGEST_SCHEDULE_SQL}</pre>
        <button type="button" className={`${buttonSecondary} mt-2`} onClick={() => void copy()}>{copied ? "Copied" : "Copy the SQL"}</button>
      </details>
    </Panel>
  )
}

export default function SystemHealth({ embedded = false }: AdminPageProps & { embedded?: boolean }) {
  const { profile } = useAuth()
  const [run, setRun] = useState<HealthRun | null>(null)
  const [running, setRunning] = useState(false)
  const isSuper = profile?.role === "super_admin"

  const check = useCallback(async () => {
    setRunning(true)
    setRun(await runHealthChecks())
    setRunning(false)
  }, [])
  useEffect(() => {
    if (isSuper) void check()
  }, [isSuper, check])

  const summary = run ? summarize(run.checks) : null
  const canSend = run ? (run.edge.ok ? run.edge.config.can_send : null) : null
  return (
    <div className={embedded ? "space-y-4" : "admin-page"}>
      {embedded ? null : <PageIntro eyebrow="Security" title="System health" description="Read-only checks of the database, migrations, required schema, storage, email and scheduled jobs. Nothing here repairs, re-runs or switches anything on. No secret is ever shown." action={isSuper ? <button type="button" className={buttonPrimary} disabled={running} onClick={() => void check()}>{running ? "Checking..." : "Run checks again"}</button> : undefined} />}
      {!isSuper ? (
        <Panel><p className="text-sm text-fg-muted">Only a Super Admin can open the system health checks.</p></Panel>
      ) : (
        <>
          <Panel title="Results" action={<span className="flex flex-wrap items-center gap-3">{run ? <span className="text-xs text-fg-muted">Checked {when(run.ranAt)}</span> : null}{embedded ? <button type="button" className={buttonPrimary} disabled={running} onClick={() => void check()}>{running ? "Checking..." : "Run checks again"}</button> : null}</span>}>
            {!run ? <div className="space-y-3" role="status" aria-label="Running the checks"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : (
              <>
                <p className="mb-4 flex flex-wrap items-center gap-2 text-sm" role="status"><StatusBadge status={summary!.overall} /><span className="text-fg-muted">{summary!.counts.fail} problems, {summary!.counts.warn} need attention, {summary!.counts.unknown} cannot be told, {summary!.counts.info} not set up, {summary!.counts.ok} working.</span></p>
                <HealthResults checks={run.checks} />
              </>
            )}
          </Panel>
          <EmailTestPanel email={profile?.email ?? ""} canSend={canSend} />
          <DigestPanel lastRun={run?.checks.find((item) => item.id === "digest")} />
        </>
      )}
    </div>
  )
}
