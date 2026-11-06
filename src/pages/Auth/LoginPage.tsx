import { useEffect, useRef, useState, type FormEvent } from "react"
import type { Page } from "../../App"
import Brand from "../../components/Brand"
import FormField from "../../components/FormField"
import Header from "../../components/Header"
import { PrivacyNoticeModal } from "../../components/PrivacyNotice"
import { FORGOT_EMAIL_KEY } from "./ForgotPasswordPage"
import { clearOAuthIntent, setOAuthIntent, takeLoginNotice, takeLoginSuccessNotice } from "../../lib/oauthIntent"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"

type LoginPageProps = { navigate: (page: Page) => void }

export default function LoginPage({ navigate }: LoginPageProps) {
  const toast = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(() => takeLoginNotice())
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [privacy, setPrivacy] = useState(false)

  useEffect(() => {
    const notice = takeLoginSuccessNotice()
    if (notice) toast.success(notice.title, notice.detail)
  }, [toast])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setError("")
    setBusy(true)
    const { error: signInError } = await supabase.auth
      .signInWithPassword({ email: email.trim().toLowerCase(), password })
      .catch(() => ({ error: new Error("network fetch failed") }))
    if (signInError) {
      pending.current = false
      setBusy(false)
      const text = signInError.message.toLowerCase()
      setError(
        text.includes("invalid login")
          ? "Incorrect email or password."
          : text.includes("banned")
            ? "This account has been disabled. Contact your administrator."
            : text.includes("not confirmed")
              ? "Your email is not verified yet. Register again to get a new 6-digit code."
              : text.includes("rate limit") || text.includes("too many")
                ? "Too many attempts. Please wait a minute and try again."
                : text.includes("fetch") || text.includes("network")
                  ? "Cannot reach the server. Check your internet connection and try again."
                  : signInError.message,
      )
    }
    if (!signInError) toast.success("Signed in", "Taking you to your workspace.")
    else if (/network|fetch|server/i.test(signInError.message)) toast.error("Could not reach the server", "Check your connection and try again.")
    // On success RouteGuard sends the user to their role dashboard.
  }

  const handleGoogle = async () => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError("")
    // Logging in is not registering: a Google account that never registered is turned away after the redirect (see RouteGuard).
    setOAuthIntent("login")
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/login`,
          // BuildTrack sign-out does not end the browser's Google session.
          queryParams: { prompt: "select_account" },
        },
      })
      if (oauthError) throw new Error(oauthError.message)
      // Keep both sign-in methods locked until Google redirects the page.
    } catch (error) {
      clearOAuthIntent()
      const message = error instanceof Error ? error.message : "Could not open Google sign-in. Please try again."
      setError(message)
      toast.error("Google sign-in failed", message)
      pending.current = false
      setBusy(false)
    }
  }

  // The reset itself has its own screen: the person chooses an emailed link or a 6-digit code there. A typed email address is carried over.
  const handleForgot = () => {
    try {
      if (/^\S+@\S+\.\S+$/.test(email.trim())) sessionStorage.setItem(FORGOT_EMAIL_KEY, email.trim())
    } catch {
      // The email is simply typed again.
    }
    navigate("forgot-password")
  }

  return (
    <div className="auth-page">
      <Header navigate={navigate} />
      <main className="auth-main">
        <form className="auth-card login-card" onSubmit={handleSubmit}>
          <Brand compact inverse />
          <div className="auth-heading">
            <h1>Welcome back</h1>
            <p>Access your real-time site engineering intelligence</p>
          </div>
          <FormField
            label="Email"
            name="email"
            type="email"
            icon="mail"
            autoComplete="email"
            placeholder="e.g. santos.eduardo@valencia.com"
            onChange={setEmail}
            disabled={busy}
          />
          <FormField
            label="Password"
            name="password"
            type="password"
            icon="lock"
            autoComplete="current-password"
            placeholder="Enter your password"
            onChange={setPassword}
            disabled={busy}
          />
          <div className="form-options">
            <span />
            <button className="text-button" type="button" disabled={busy} onClick={handleForgot}>
              Forgot password?
            </button>
          </div>
          <button className="button button--auth" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Login to BuildTrack"}
          </button>
          {error ? (
            <div className="form-notice form-notice--error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="register-callout">
            <span>New to BuildTrack?</span>
            <button className="button button--gold button--wide" type="button" disabled={busy} onClick={() => navigate("register")}>
              Create an account
            </button>
          </div>
          <div className="divider">
            <span>or</span>
          </div>
          <button
            className="button button--outline-light button--wide"
            type="button"
            disabled={busy}
            onClick={() => void handleGoogle()}
          >
            Sign in with Google
          </button>
          <p className="support-note">Google sign-in only works for registered accounts.</p>
          <p className="support-note">
            Account pending approval?{" "}
            <button type="button" className="text-button">
              Contact Support
            </button>
          </p>
          <p className="support-note">
            <button type="button" className="text-button" onClick={() => setPrivacy(true)}>
              Data privacy notice
            </button>
          </p>
          {privacy ? <PrivacyNoticeModal scope="general" onClose={() => setPrivacy(false)} /> : null}
        </form>
      </main>
    </div>
  )
}
