import { useEffect, useState, type FormEvent } from "react"
import type { Page } from "../../App"
import Brand from "../../components/Brand"
import FormField from "../../components/FormField"
import Header from "../../components/Header"
import Modal from "../../components/Modal"
import { checkResetCode, finishReset, isSixDigits, onlyDigits, requestResetCode, RESEND_SECONDS } from "../../lib/emailCodes"
import { setLoginSuccessNotice } from "../../lib/oauthIntent"
import { passwordChecks, passwordIssue } from "../../lib/passwordPolicy"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"

type Step = "email" | "choose" | "link" | "code" | "password"
export const FORGOT_EMAIL_KEY = "buildtrack.forgotEmail"

const option = "flex w-full flex-col items-start gap-1 rounded-xl border border-line bg-surface px-4 py-3 text-left transition hover:border-brand/60 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
const quiet = "inline-flex min-h-10 items-center justify-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-muted disabled:opacity-60"
const solid = "inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"

// Resetting a forgotten password, one step at a time, each in its own pop-up:
//   1. the email address ("Find my account");
//   2. how to reset: an emailed link or a 6-digit code;
//   3a. link: "check your email" (the link opens /reset-password);   3b. code: type ONLY the code, which the server checks;
//   4. only after the code is accepted: the new password.
// The screen never says whether an address has an account (that would let anyone find out who is registered): step 1 always continues, and an email is only sent
// to a real, active account. The code is checked on its own step and is not used up until the new password is saved (the server checks it again then).
export default function ForgotPasswordPage({ navigate }: { navigate: (page: Page) => void }) {
  const toast = useToast()
  const [email, setEmail] = useState(() => {
    try {
      const saved = sessionStorage.getItem(FORGOT_EMAIL_KEY) ?? ""
      sessionStorage.removeItem(FORGOT_EMAIL_KEY)
      return saved
    } catch {
      return ""
    }
  })
  const [step, setStep] = useState<Step>("email")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const address = email.trim().toLowerCase()
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const checks = passwordChecks(password)
  const metCount = checks.filter((check) => check.met).length
  const strength = Math.round((metCount / checks.length) * 100)

  useEffect(() => {
    if (!resendAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [resendAt])

  const validEmail = () => /^\S+@\S+\.\S+$/.test(address)

  const find = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    if (!validEmail()) return setError("Enter the email address of your account.")
    setStep("choose")
  }

  const startedSending = (next: Step) => {
    const started = Date.now()
    setNow(started)
    setResendAt(started + RESEND_SECONDS * 1000)
    setCode("")
    setStep(next)
    toast.success(next === "link" ? "Reset link requested" : "Code requested", "If that email has an account, the message is on its way.")
  }

  const sendLink = async () => {
    setError("")
    setBusy(true)
    const { error: resetError } = await supabase.auth
      .resetPasswordForEmail(address, { redirectTo: `${window.location.origin}/reset-password` })
      .catch(() => ({ error: new Error("network fetch failed") }))
    setBusy(false)
    if (resetError) {
      const text = resetError.message.toLowerCase()
      return setError(
        text.includes("rate limit") || text.includes("too many") || text.includes("seconds")
          ? "Too many requests. Please wait a minute and try again."
          : text.includes("fetch") || text.includes("network")
            ? "Cannot reach the server. Check your internet connection and try again."
            : resetError.message,
      )
    }
    startedSending("link")
  }

  const sendCode = async () => {
    setError("")
    setBusy(true)
    const result = await requestResetCode(address)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    startedSending("code")
  }

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    if (!isSixDigits(code)) return setError("Type the 6 digits from the email.")
    setBusy(true)
    const result = await checkResetCode(address, code)
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setPassword("")
    setConfirm("")
    setStep("password")
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    const issue = passwordIssue(password)
    if (issue) return setError(issue)
    if (password !== confirm) return setError("Passwords do not match.")
    setBusy(true)
    const result = await finishReset(address, code, password)
    setBusy(false)
    if (!result.ok) {
      // A code that stopped working (expired, or too many tries) sends the person back to ask for a new one; any other problem stays on this step.
      if (/code/i.test(result.error) && !/password/i.test(result.error)) {
        setCode("")
        setStep("code")
      }
      return setError(result.error)
    }
    setLoginSuccessNotice("Password changed", "Sign in with your new password. Other devices were signed out.")
    navigate("login")
  }

  const close = () => {
    if (busy) return
    setError("")
    setStep("email")
  }

  const errorBox = error ? <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="alert">{error}</div> : null

  return (
    <div className="auth-page">
      <Header navigate={navigate} />
      <main className="auth-main">
        <div className="auth-card login-card">
          <Brand compact inverse />
          <form onSubmit={find} className="auth-form-stack" noValidate>
            <div className="auth-heading">
              <h1>Reset your password</h1>
              <p>Enter the email address of your account and we will help you get back in.</p>
            </div>
            <FormField label="Email" name="email" type="email" icon="mail" autoComplete="email" placeholder="e.g. santos.eduardo@valencia.com" value={email} onChange={setEmail} />
            <button className="button button--auth" type="submit">Find my account</button>
            {step === "email" && error ? <div className="form-notice form-notice--error" role="alert">{error}</div> : null}
            <p className="support-note">
              <button type="button" className="text-button" onClick={() => navigate("login")}>Back to sign in</button>
            </p>
          </form>
        </div>
      </main>

      {step === "choose" ? (
        <Modal title="How do you want to reset it?" description={`Choose where to continue for ${address}.`} size="sm" onClose={close}>
          <div className="space-y-3">
            <button type="button" className={option} disabled={busy} onClick={() => void sendLink()}>
              <span className="text-sm font-bold">Email me a reset link</span>
              <span className="text-xs text-fg-muted">Open the email and press the button to choose a new password.</span>
            </button>
            <button type="button" className={option} disabled={busy} onClick={() => void sendCode()}>
              <span className="text-sm font-bold">Email me a 6-digit code</span>
              <span className="text-xs text-fg-muted">Type the code on the next screen, then choose a new password.</span>
            </button>
            {busy ? <p className="text-sm text-fg-muted" role="status">Sending...</p> : null}
            {errorBox}
          </div>
        </Modal>
      ) : null}

      {step === "link" ? (
        <Modal title="Check your email" description={`If ${address} has an account, we sent a message with a button.`} size="sm" onClose={close}>
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">Press the button in that email to choose a new password. The link works for 10 minutes and only once.</p>
            <button type="button" className={quiet + " w-full"} disabled={busy || wait > 0} onClick={() => void sendLink()}>
              {wait > 0 ? `Send the email again in ${wait}s` : "Send the email again"}
            </button>
            <button type="button" className={quiet + " w-full"} disabled={busy} onClick={() => void sendCode()}>Send me a 6-digit code instead</button>
            {errorBox}
          </div>
        </Modal>
      ) : null}

      {step === "code" ? (
        <Modal title="Enter your code" description={`If ${address} has an account, we sent a 6-digit code.`} size="sm" onClose={close} closeOnBackdrop={false}>
          <form onSubmit={verifyCode} className="space-y-3" noValidate>
            <FormField label="6-digit code" name="code" icon="shield" autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(value) => setCode(onlyDigits(value))} />
            <p className="text-xs text-fg-muted">The code works once and expires in 10 minutes.</p>
            <button type="submit" className={solid} disabled={busy || code.length < 6}>{busy ? "Checking..." : "Verify code"}</button>
            <button type="button" className={quiet + " w-full"} disabled={busy || wait > 0} onClick={() => void sendCode()}>
              {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
            </button>
            {errorBox}
          </form>
        </Modal>
      ) : null}

      {step === "password" ? (
        <Modal title="Choose a new password" description="Your code was accepted. Use a password you do not use anywhere else." size="sm" onClose={close} closeOnBackdrop={false}>
          <form onSubmit={save} className="space-y-3" noValidate>
            <FormField label="New password" name="password" type="password" icon="lock" autoComplete="new-password" placeholder="Create password" onChange={setPassword} />
            <FormField label="Confirm new password" name="confirmPassword" type="password" icon="shield" autoComplete="new-password" placeholder="Confirm password" onChange={setConfirm} />
            <div className="form-field strength-field">
              <span>Password Strength</span>
              <span className="strength-box">
                <i style={{ background: `linear-gradient(90deg, var(--gold) ${strength}%, #4b4b4d ${strength}%)` }} />
                <strong aria-live="polite">{metCount === checks.length ? "Strong password secured" : `${metCount} of ${checks.length} requirements met`}</strong>
                <ul className="strength-rules">
                  {checks.map((check) => (
                    <li key={check.key} className={check.met ? "is-met" : undefined}>
                      <span aria-hidden="true">{check.met ? "✓" : "•"}</span> {check.label}
                      <span className="sr-only">{check.met ? " (done)" : " (missing)"}</span>
                    </li>
                  ))}
                </ul>
              </span>
            </div>
            <button type="submit" className={solid} disabled={busy}>{busy ? "Saving..." : "Change password"}</button>
            {errorBox}
          </form>
        </Modal>
      ) : null}
    </div>
  )
}
