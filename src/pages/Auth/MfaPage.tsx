import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react"
import { useAuth } from "../../lib/auth"
import { supabase } from "../../lib/supabase"

type Mode = "loading" | "enroll" | "challenge" | "failed"

const LandingPage = lazy(() => import("../Public/LandingPage"))

// Authenticator-app (TOTP) step for Admin and Super Admin accounts, shown right after the password step.
export default function MfaPage() {
  const { profile, signOut, refreshProfile } = useAuth()
  const [mode, setMode] = useState<Mode>("loading")
  const [factorId, setFactorId] = useState("")
  const [qr, setQr] = useState("")
  const [secret, setSecret] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const start = async () => {
      const { data, error: listError } = await supabase.auth.mfa.listFactors()
      if (listError || !data) {
        setError(listError?.message ?? "Could not load authenticator settings.")
        return setMode("failed")
      }
      const verified = data.totp[0]
      if (verified) {
        setFactorId(verified.id)
        return setMode("challenge")
      }
      // Remove half-finished enrollments from earlier attempts, then start a fresh one.
      const stale = data.all.filter(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "unverified",
      )
      for (const factor of stale)
        await supabase.auth.mfa.unenroll({ factorId: factor.id })
      const { data: enrolled, error: enrollError } =
        await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: `BuildTrack ${new Date().toISOString().slice(0, 10)}`,
        })
      if (enrollError || !enrolled) {
        setError(enrollError?.message ?? "Could not start authenticator setup.")
        return setMode("failed")
      }
      setFactorId(enrolled.id)
      setQr(enrolled.totp.qr_code)
      setSecret(enrolled.totp.secret)
      setMode("enroll")
    }
    void start()
  }, [])

  const verify = async (event: FormEvent) => {
    event.preventDefault()
    setError("")
    setBusy(true)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    })
    if (verifyError) {
      setBusy(false)
      setCode("")
      setError(
        verifyError.message.toLowerCase().includes("invalid")
          ? "That code is not valid. Open your authenticator app and enter the current 6-digit code."
          : verifyError.message,
      )
      return
    }
    await refreshProfile()
    setBusy(false)
    // RouteGuard now sees an aal2 session and sends the admin to the dashboard.
  }

  return (
    <>
      <div
        aria-hidden="true"
        inert
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        <Suspense fallback={null}>
          <LandingPage navigate={() => {}} />
        </Suspense>
      </div>
      <div className="relative z-10 flex min-h-dvh items-center justify-center bg-black/45 p-4 backdrop-blur-md">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mfa-heading"
          className="w-full max-w-md overflow-hidden rounded-2xl bg-surface shadow-2xl"
        >
          <div className="border-b-4 border-[#f18b00] bg-brand-strong px-8 py-6 text-white">
            <p className="text-xs font-bold uppercase tracking-widest text-[#f18b00]">
              Admin security
            </p>
            <h1 id="mfa-heading" className="mt-1 text-2xl font-extrabold">
              {mode === "enroll"
                ? "Set up your authenticator"
                : "Two-step verification"}
            </h1>
            <p className="mt-1 text-sm text-white/80">{profile?.email}</p>
          </div>

          <div className="px-8 py-6 text-fg">
            {mode === "loading" ? (
              <p className="text-center text-sm">Preparing secure sign-in...</p>
            ) : null}

            {mode === "enroll" ? (
              <ol className="mb-5 space-y-3 text-sm">
                <li>
                  <strong className="text-brand-text">1.</strong> Install Google
                  Authenticator (or Microsoft Authenticator / Authy) on your
                  phone.
                </li>
                <li>
                  <strong className="text-brand-text">2.</strong> Scan this QR
                  code, or type the key manually.
                  <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-line bg-brand-soft p-4">
                    <img
                      src={qr}
                      alt="Authenticator QR code"
                      className="h-44 w-44 bg-surface p-1"
                    />
                    <code className="break-all text-center text-xs font-semibold tracking-wider">
                      {secret}
                    </code>
                  </div>
                </li>
                <li>
                  <strong className="text-brand-text">3.</strong> Enter the
                  6-digit code it shows.
                </li>
              </ol>
            ) : null}

            {mode === "challenge" ? (
              <p className="mb-5 text-sm">
                Enter the 6-digit code from your authenticator app to continue.
              </p>
            ) : null}

            {mode === "enroll" || mode === "challenge" ? (
              <form
                onSubmit={(event) => void verify(event)}
                className="space-y-4"
              >
                <input
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  placeholder="000000"
                  aria-label="6-digit authenticator code"
                  className="w-full rounded-xl border-2 border-line bg-surface text-fg px-4 py-3 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-brand"
                />
                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="w-full rounded-xl bg-brand py-3 font-bold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? "Verifying..."
                    : mode === "enroll"
                      ? "Activate and continue"
                      : "Verify and continue"}
                </button>
              </form>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-danger-fg/30 bg-danger-soft px-3 py-2 text-sm text-danger-fg"
              >
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void signOut()}
              className="mt-5 w-full text-center text-sm font-semibold text-brand-text hover:text-[#f18b00]"
            >
              Cancel and sign out
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
