import { useEffect, useState, type FormEvent } from "react"
import FormField from "./FormField"
import { confirmAddressCode, isSixDigits, onlyDigits, requestAddressCode, RESEND_SECONDS } from "../lib/emailCodes"
import { useAuth } from "../lib/auth"
import { useToast } from "../lib/toast"

// "Prove this email address is yours": BuildTrack emails a 6-digit code to the signed-in account's own address and the person types it here.
// Until it is confirmed the database refuses a registration, an access request or an invitation code, so this is the step that comes first.
export default function EmailCodeStep({ onVerified, what = "send your request to the administrator", tone = "auth" }: { onVerified?: () => void; what?: string; tone?: "auth" | "gold" }) {
  const primary = tone === "gold" ? "button button--gold" : "button button--auth"
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))

  useEffect(() => {
    if (!resendAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [resendAt])

  if (profile?.email_verified_at) return <div className="form-notice" role="status">Your email address {profile.email} is confirmed.</div>

  const send = async () => {
    setError("")
    setBusy(true)
    const result = await requestAddressCode()
    setBusy(false)
    if (!result.ok) return setError(result.error)
    if (result.already) {
      await refreshProfile()
      return onVerified?.()
    }
    const started = Date.now()
    setNow(started)
    setResendAt(started + RESEND_SECONDS * 1000)
    setSent(true)
    toast.success("Code sent", `Check ${profile?.email ?? "your email"} for the 6-digit code.`)
  }

  const verify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    if (!isSixDigits(code)) return setError("Type the 6 digits from the email.")
    setBusy(true)
    const result = await confirmAddressCode(code)
    if (!result.ok) {
      setBusy(false)
      return setError(result.error)
    }
    await refreshProfile()
    setBusy(false)
    toast.success("Email confirmed", "You can continue now.")
    onVerified?.()
  }

  return (
    <form onSubmit={verify} className="auth-form-stack" aria-label="Confirm your email address">
      <div className="form-notice" role="note">
        <strong>Step 1: confirm your email.</strong> Before you {what}, we send a 6-digit code to <strong>{profile?.email ?? "your email"}</strong>.
      </div>
      {!sent ? (
        <button className={primary} type="button" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending..." : "Email me the code"}
        </button>
      ) : (
        <>
          <FormField label="6-digit code" name="addressCode" icon="shield" autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(value) => setCode(onlyDigits(value))} />
          <button className={primary} type="submit" disabled={busy || code.length < 6}>
            {busy ? "Checking..." : "Confirm email"}
          </button>
          <button className="button button--outline-light button--wide" type="button" disabled={busy || wait > 0} onClick={() => void send()}>
            {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
          </button>
        </>
      )}
      {error ? <div className="form-notice form-notice--error" role="alert">{error}</div> : null}
    </form>
  )
}
