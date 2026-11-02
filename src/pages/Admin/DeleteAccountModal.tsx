import { useEffect, useState } from "react"
import Modal from "../../components/Modal"
import { Skeleton } from "../../components/ui/Skeleton"
import type { Profile } from "../../lib/auth"
import { invokeFunction } from "../../lib/functions"
import { useToast } from "../../lib/toast"

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
const secondary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg shadow-sm hover:border-brand/50 hover:text-brand-text disabled:opacity-60"

type Preview = {
  mode: "delete" | "close"
  record_total: number
  memberships: number
  managed_projects: number
  open_work: number
  blocker: string | null
  phrase: string
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

// The most serious account action, so it asks for three things at once: a written reason, the exact phrase `DELETE <email>`, and a FRESH code from the authenticator app
// (the server checks it again; nothing here is trusted). What happens to the person's records is decided by the database and shown here before anything is changed.
export default function DeleteAccountModal({ user, onClose, onDone }: { user: Profile; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState("")
  const [reason, setReason] = useState("")
  const [typed, setTyped] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const who = user.full_name || user.email

  useEffect(() => {
    let active = true
    void invokeFunction<Preview>("account-control", { action: "preview", id: user.id }).then(({ data, error: failure }) => {
      if (!active) return
      if (failure || !data) setLoadError(failure ?? "The account could not be checked.")
      else setPreview(data)
    })
    return () => {
      active = false
    }
  }, [user.id])

  const cleanReason = reason.replace(/\s+/g, " ").trim()
  const phraseOk = Boolean(preview) && typed.trim().toLowerCase() === preview!.phrase.toLowerCase()
  const ready = Boolean(preview) && !preview!.blocker && cleanReason.length >= 5 && cleanReason.length <= 300 && phraseOk && /^\d{6}$/.test(code)

  const submit = async () => {
    if (!preview || !ready) return
    setBusy(true)
    setError("")
    const { data, error: failure } = await invokeFunction<{ mode: "delete" | "close" }>("account-control", { action: "delete", id: user.id, reason: cleanReason, confirm: typed.trim(), totp: code })
    setBusy(false)
    if (failure || !data) {
      setCode("") // a code is for one try
      return setError(failure ?? "The account could not be deleted.")
    }
    toast.success(data.mode === "delete" ? "Account deleted" : "Account closed", data.mode === "delete" ? `${who} was removed completely.` : `${who} can no longer sign in. Their records were kept.`)
    onDone()
  }

  return (
    <Modal
      title={`Delete ${who}`}
      description={user.email}
      size="md"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={secondary + " !border-danger-fg !text-danger-fg"} disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? "Deleting..." : preview?.mode === "close" ? "Delete and keep records" : "Delete account"}
          </button>
        </>
      }
    >
      {loadError ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{loadError}</p>
      ) : !preview ? (
        <div className="space-y-3" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : preview.blocker ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{preview.blocker}</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-danger-fg/40 bg-danger-soft px-4 py-3 text-sm text-danger-fg">
            <p className="font-bold">This cannot be undone.</p>
            {preview.mode === "delete" ? (
              <p className="mt-1">{who} has no records in BuildTrack, so the account and its sign-in are removed completely.</p>
            ) : (
              <p className="mt-1">{who} has {plural(preview.record_total, "record")} (work, quality, reports, approvals and so on). The account is closed: the name, email, phone and photos are wiped and the person can never sign in again, but <strong>every record stays exactly as it was</strong>, shown as "Deleted account".</p>
            )}
          </div>
          {preview.open_work || preview.managed_projects || preview.memberships ? (
            <p className="text-sm text-fg-muted">
              Still attached: {[preview.open_work ? plural(preview.open_work, "unfinished work item") : "", preview.managed_projects ? plural(preview.managed_projects, "project") + " as Project Manager" : "", preview.memberships ? plural(preview.memberships, "project team") : ""].filter(Boolean).join(", ")}. Reassign them first if someone else must carry on.
            </p>
          ) : null}
          <div>
            <label className="block text-sm font-bold" htmlFor="delete-reason">1. Reason (required)</label>
            <textarea id="delete-reason" className={field + " min-h-20"} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} placeholder="For example: left the company, duplicate account, request of the person" />
            <p className="mt-1 text-xs text-fg-muted">{cleanReason.length}/300. Saved in the audit log.</p>
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="delete-phrase">2. Type <span className="font-mono">{preview.phrase}</span></label>
            <input id="delete-phrase" className={field + " font-mono"} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
          </div>
          <div>
            <label className="block text-sm font-bold" htmlFor="delete-code">3. Code from your authenticator app</label>
            <input id="delete-code" className={field + " font-mono tracking-widest"} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" />
            <p className="mt-1 text-xs text-fg-muted">A fresh code, even though you are already signed in with the authenticator.</p>
          </div>
          {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        </div>
      )}
    </Modal>
  )
}
