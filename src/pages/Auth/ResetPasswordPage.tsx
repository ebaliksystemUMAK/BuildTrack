import { useEffect, useState, type FormEvent } from "react"
import type { Page } from "../../App"
import Brand from "../../components/Brand"
import FormField from "../../components/FormField"
import Header from "../../components/Header"
import { useAuth } from "../../lib/auth"
import { setLoginSuccessNotice } from "../../lib/oauthIntent"
import { passwordChecks, passwordIssue } from "../../lib/passwordPolicy"
import { endRecovery, startupLinkProblem } from "../../lib/passwordRecovery"
import { supabase } from "../../lib/supabase"

// Where both ways of resetting end: the reset link opens this page already signed in with a one-time session, and the 6-digit code gets here after it is accepted.
// The one-time session is ended as soon as the new password is saved, so the person signs in again with the new password.
export default function ResetPasswordPage({ navigate }: { navigate: (page: Page) => void }) {
  const { session, loading } = useAuth()
  const problem = startupLinkProblem
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const checks = passwordChecks(password)
  const metCount = checks.filter((check) => check.met).length
  const strength = Math.round((metCount / checks.length) * 100)

  // No one-time session (an old link, a used link, or someone who just typed the address): nothing is waiting, so the note is cleared.
  useEffect(() => {
    if (!loading && !session) endRecovery()
  }, [loading, session])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    const issue = passwordIssue(password)
    if (issue) return setError(issue)
    if (password !== confirm) return setError("Passwords do not match.")
    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password }).catch(() => ({ error: new Error("network fetch failed") }))
    if (updateError) {
      setBusy(false)
      const text = updateError.message.toLowerCase()
      return setError(
        text.includes("same") || text.includes("different from the old")
          ? "Choose a password you have not used before."
          : text.includes("aal2") || text.includes("mfa")
            ? "Open your authenticator app and finish the sign-in check first, then try again."
            : text.includes("weak") || text.includes("pwned") || text.includes("compromised")
              ? "That password is too easy to guess or appears in known leaks. Choose another one."
              : text.includes("fetch") || text.includes("network")
                ? "Cannot reach the server. Check your internet connection and try again."
                : updateError.message,
      )
    }
    endRecovery()
    setLoginSuccessNotice("Password changed", "Sign in with your new password.")
    await supabase.auth.signOut()
    setBusy(false)
    navigate("login")
  }

  const cancel = async () => {
    endRecovery()
    await supabase.auth.signOut()
    navigate("login")
  }

  return (
    <div className="auth-page">
      <Header navigate={navigate} />
      <main className="auth-main">
        <div className="auth-card login-card">
          <Brand compact inverse />
          {loading ? (
            <div className="auth-heading" role="status"><h1>Checking your reset link...</h1></div>
          ) : !session ? (
            <div className="auth-form-stack">
              <div className="auth-heading">
                <h1>Link not usable</h1>
                <p>{problem ?? "There is no reset waiting. Ask for a new link or code."}</p>
              </div>
              <button className="button button--auth" type="button" onClick={() => navigate("forgot-password")}>Ask for a new link or code</button>
              <p className="support-note"><button type="button" className="text-button" onClick={() => navigate("login")}>Back to sign in</button></p>
            </div>
          ) : (
            <form onSubmit={save} className="auth-form-stack">
              <div className="auth-heading">
                <h1>Choose a new password</h1>
                <p>Use a password you do not use anywhere else.</p>
              </div>
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
              <button className="button button--auth" type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save new password"}
              </button>
              {error ? <div className="form-notice form-notice--error" role="alert">{error}</div> : null}
              <p className="support-note"><button type="button" className="text-button" onClick={() => void cancel()}>Cancel and sign out</button></p>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
