import { useState, type FormEvent } from "react"
import type { Page } from "../../App"
import Brand from "../../components/Brand"
import FormField from "../../components/FormField"
import Header from "../../components/Header"
import DataConfirmModal, { PrivacyNoticeModal } from "../../components/PrivacyNotice"
import Icon from "../../components/Icons"
import { useAuth } from "../../lib/auth"
import { invokeFunction } from "../../lib/functions"
import { setLoginSuccessNotice, setOAuthIntent } from "../../lib/oauthIntent"
import { passwordChecks, passwordIssue } from "../../lib/passwordPolicy"
import { PHONE_DIGITS, phoneDigits, phoneIssue } from "../../lib/phoneNumber"
import { PRIVACY_VERSION } from "../../lib/privacy"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"

type RegisterPageProps = { navigate: (page: Page) => void }

const intelligence = [
  [
    "blueprint",
    "2D Blueprint Mapping",
    "On-site verification events are automatically plotted over layout designs.",
  ],
  [
    "people",
    "Biometric Attendance",
    "Eliminate labor leakage and guarantee safety compliance on critical paths.",
  ],
  [
    "shield",
    "Quality Assurance",
    "Automated QC checklists mapped directly to local regulations.",
  ],
] as const

// Google gave us a verified email and name; the person now adds the details an administrator needs. The account stays pending until
// an administrator approves it (or it is pre-approved on the whitelist, which never reaches this form).
function CompleteGoogleRegistration({ navigate }: RegisterPageProps) {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(profile?.full_name ?? "")
  const [phone, setPhone] = useState("")
  const [company, setCompany] = useState("")
  const [position, setPosition] = useState("")
  const [role, setRole] = useState<"engineer" | "foreman" | "client" | "">("")
  const [discipline, setDiscipline] = useState("")
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    if (name.trim().length < 2) return setError("Enter your full name.")
    const phoneProblem = phoneIssue(phone)
    if (phoneProblem) return setError(phoneProblem)
    if (!role) return setError("Choose the kind of access you need.")
    if (role === "engineer" && !discipline) return setError("Engineers choose a discipline.")
    if (!agree) return setError("Please accept the terms to continue.")
    setConfirming(true)
  }

  const submit = async () => {
    setBusy(true)
    const { error: rpcError } = await supabase.rpc("complete_registration", { p_full_name: name.trim(), p_phone: phone.trim(), p_company: company.trim() || null, p_position: position.trim() || null, p_requested_role: role, p_discipline: role === "engineer" ? discipline : null })
    setBusy(false)
    if (rpcError) {
      setConfirming(false)
      setError(rpcError.message)
      return toast.error("Registration not sent", rpcError.message)
    }
    setLoginSuccessNotice(
      "Registration sent",
      "Your registration is awaiting administrator approval. You will be able to sign in after your access is approved.",
    )
    await signOut()
    navigate("login")
  }

  const useAnotherAccount = async () => {
    setBusy(true)
    await invokeFunction("oauth-gate", {}) // removes this half-created account; nothing else is touched
    await signOut()
  }

  return (
    <form className="register-form" onSubmit={review} noValidate>
      <Brand compact inverse />
      <h1>Finish your registration</h1>
      <p className="register-lead">
        Google confirmed <strong>{profile?.email}</strong>. Add the details below and send them to the administrators. You can use BuildTrack once your registration is approved.
      </p>
      <div className="register-grid">
        <label className="form-field"><span>Full name</span><span className="input-shell"><input name="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></span></label>
        <label className="form-field"><span>Email (from Google)</span><span className="input-shell"><input name="email" value={profile?.email ?? ""} readOnly aria-readonly="true" /></span></label>
        <label className="form-field"><span>Phone number</span><span className="input-shell"><input name="phone" type="tel" inputMode="numeric" maxLength={PHONE_DIGITS} value={phone} onChange={(event) => setPhone(phoneDigits(event.target.value))} autoComplete="tel" placeholder="e.g. 09123456789" /></span></label>
        <label className="form-field"><span>Company / Organization</span><span className="input-shell"><input name="company" value={company} onChange={(event) => setCompany(event.target.value)} autoComplete="organization" placeholder="Valencia Construction Services" /></span></label>
        <label className="form-field"><span>Job title</span><span className="input-shell"><input name="position" value={position} onChange={(event) => setPosition(event.target.value)} placeholder="e.g. Site Engineer" /></span></label>
        <label className="form-field"><span>Access you need</span><span className="input-shell"><select name="role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="">Choose...</option><option value="engineer">Engineer</option><option value="foreman">Foreman</option><option value="client">Client</option></select></span></label>
        {role === "engineer" ? <label className="form-field"><span>Discipline</span><span className="input-shell"><select name="discipline" value={discipline} onChange={(event) => setDiscipline(event.target.value)}><option value="">Choose...</option><option value="civil_structural">Civil / Structural</option><option value="architectural">Architectural</option><option value="mep">MEP</option></select></span></label> : null}
      </div>
      <label className="checkbox terms">
        <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
        <span>I agree to the Terms of Service, Blueprint Security Policies, and Biometric Privacy Disclosures.</span>
      </label>
      <div className="register-actions">
        <button className="button button--gold" type="submit" disabled={busy}>{busy ? "Sending..." : "Send registration"}</button>
        <button className="text-button text-button--gold" type="button" disabled={busy} onClick={() => void useAnotherAccount()}>Use a different account</button>
      </div>
      {error ? <div className="form-notice form-notice--error form-notice--spaced" role="alert">{error}</div> : null}
      <p className="support-note">
        Already registered?{" "}
        <button className="text-button text-button--gold" type="button" onClick={() => navigate("login")}>Back to login</button>
      </p>
      {confirming ? (
        <DataConfirmModal title="Check your registration" description="This goes to the administrators of Valencia Construction Services." scope="registration" rows={[{ label: "Full name", value: name.trim() }, { label: "Email", value: profile?.email ?? "" }, { label: "Phone", value: phone.trim() }, { label: "Company", value: company.trim() }, { label: "Job title", value: position.trim() }, { label: "Access wanted", value: role ? role[0].toUpperCase() + role.slice(1) : "" }, { label: "Discipline", value: role === "engineer" ? discipline : "" }]} confirmLabel="Send registration" busy={busy} onConfirm={submit} onClose={() => !busy && setConfirming(false)} />
      ) : null}
    </form>
  )
}

export default function RegisterPage({ navigate }: RegisterPageProps) {
  const { session, profile } = useAuth()
  const finishing = Boolean(session) && profile?.status === "pending" && !profile.registration_completed_at
  const toast = useToast()
  const [values, setValues] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    role: "",
    password: "",
    confirmPassword: "",
  })
  const [step, setStep] = useState<"form" | "otp">("form")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }))
  const email = values.email.trim().toLowerCase()
  const checks = passwordChecks(values.password)
  const metCount = checks.filter((check) => check.met).length
  const strength = Math.round((metCount / checks.length) * 100)

  const [confirming, setConfirming] = useState(false)
  const [reading, setReading] = useState(false)
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setInfo("")
    if (values.name.trim().length < 2) return setError("Enter your full name.")
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.")
    const phoneProblem = phoneIssue(values.phone)
    if (phoneProblem) return setError(phoneProblem)
    const issue = passwordIssue(values.password)
    if (issue) return setError(issue)
    if (values.password !== values.confirmPassword) return setError("Passwords do not match.")
    setConfirming(true)
  }

  const sendSignUp = async () => {
    setBusy(true)
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password: values.password,
      options: {
        data: {
          full_name: values.name.trim(),
          phone: values.phone.trim(),
          company: values.company.trim(),
          position: values.role.trim(),
          consent_version: PRIVACY_VERSION, // the database records the privacy notice that was accepted
        },
      },
    })
    setBusy(false)
    setConfirming(false)
    if (signUpError) return setError(signUpError.message)
    setStep("otp")
    setInfo(`We sent a verification code to ${email}. Enter it below to finish.`)
    toast.info("Check your email", "The code arrives within a minute.")
  }

  const handleVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setBusy(true)
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "signup",
    })
    setBusy(false)
    if (verifyError) {
      setError("That code is incorrect or has expired.")
      return
    }
    setLoginSuccessNotice("Email verified", "Your basic account is ready. Sign in to request the access you need.")
    await supabase.auth.signOut()
    navigate("login")
  }

  const handleGoogle = async () => {
    setError("")
    setOAuthIntent("register")
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/login` },
    })
    if (oauthError) {
      setError(oauthError.message)
      toast.error("Google sign-up failed", oauthError.message)
    }
  }

  const handleResend = async () => {
    setError("")
    const { error: resendError } = await supabase.auth.resend({ type: "signup", email })
    if (resendError) {
      setError(resendError.message)
      toast.error("Could not resend the code", resendError.message)
    } else {
      setInfo("A new code has been sent.")
      toast.success("New code sent")
    }
  }

  return (
    <div className="auth-page">
      <Header navigate={navigate} />
      <main className="auth-main auth-main--register">
        <div className="register-card">
          {finishing ? (
            <CompleteGoogleRegistration navigate={navigate} />
          ) : step === "otp" ? (
            <form className="register-form" onSubmit={handleVerify}>
              <Brand compact inverse />
              <h1>Verify your email</h1>
              {info ? <p>{info}</p> : null}
              <FormField
                label="Verification code"
                name="code"
                icon="shield"
                autoComplete="one-time-code"
                placeholder="123456"
                onChange={(value) => setCode(value.replace(/\D/g, "").slice(0, 10))}
              />
              <div className="register-actions">
                <button className="button button--gold" type="submit" disabled={busy || code.length < 6}>
                  {busy ? "Verifying..." : "Verify and continue"}
                </button>
                <button className="text-button text-button--gold" type="button" onClick={() => void handleResend()}>
                  Resend code
                </button>
              </div>
              {error ? <div className="form-notice form-notice--error form-notice--spaced" role="alert">{error}</div> : null}
            </form>
          ) : (
          <form className="register-form" onSubmit={handleSubmit}>
            <Brand compact inverse />
            <h1>Register</h1>
            <p className="register-lead">
              Submit your details to create a basic account. You can then request Engineer, Foreman or Client access.
            </p>
            <button className="button button--outline-light button--wide" type="button" onClick={() => void handleGoogle()}>
              Register with Google
            </button>
            <p className="support-note">Google fills in your verified email and name. An administrator reviews Google registrations before access is given, unless your email was pre-approved.</p>
            <div className="divider">
              <span>or use your email</span>
            </div>
            <div className="register-grid">
              <FormField
                label="Full Name"
                name="name"
                icon="user"
                onChange={set("name")}
                placeholder="e.g. Eduardo Santos"
              />
              <FormField
                label="Email Address"
                name="email"
                onChange={set("email")}
                type="email"
                icon="mail"
                placeholder="e.g. santos.e@valencia.com"
              />
              <FormField
                label="Phone Number"
                name="phone"
                value={values.phone}
                onChange={(value) => set("phone")(phoneDigits(value))}
                type="tel"
                inputMode="numeric"
                maxLength={PHONE_DIGITS}
                icon="phone"
                placeholder="e.g. 09123456789"
              />
              <FormField
                label="Company / Organization"
                name="company"
                onChange={set("company")}
                icon="building"
                placeholder="Valencia Construction Services"
              />
              <FormField
                label="Job title"
                name="role"
                onChange={set("role")}
                icon="user"
                placeholder="Crane Operator Level III"
              />
              <FormField
                label="Confirm Password"
                name="confirmPassword"
                onChange={set("confirmPassword")}
                type="password"
                icon="shield"
                placeholder="Confirm password"
              />
              <FormField
                label="Password"
                name="password"
                onChange={set("password")}
                type="password"
                icon="lock"
                placeholder="Create password"
              />
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
            </div>
            <label className="checkbox terms">
              <input type="checkbox" required />
              <span>
                I agree to the Terms of Service, Blueprint Security Policies,
                and Biometric Privacy Disclosures. Read the{" "}
                <button type="button" className="text-button text-button--gold" onClick={() => setReading(true)}>data privacy notice</button>.
              </span>
            </label>
            <div className="register-actions">
              <button className="button button--gold" type="submit" disabled={busy}>
                {busy ? "Sending code..." : "Register"}
              </button>
              <span>
                Already have an account?{" "}
                <button
                  className="text-button text-button--gold"
                  type="button"
                  onClick={() => navigate("login")}
                >
                  Sign in
                </button>
              </span>
            </div>
            {error ? (
              <div className="form-notice form-notice--error form-notice--spaced" role="alert">
                {error}
              </div>
            ) : null}
          </form>
          )}
          {confirming ? (
            <DataConfirmModal title="Check your information" description="We will email you a 6-digit code to verify this address." scope="registration" record={false} rows={[{ label: "Full name", value: values.name.trim() }, { label: "Email", value: email }, { label: "Phone", value: values.phone.trim() }, { label: "Company", value: values.company.trim() }, { label: "Job title", value: values.role.trim() }]} confirmLabel="Register" busy={busy} onConfirm={sendSignUp} onClose={() => !busy && setConfirming(false)} />
          ) : null}
          {reading ? <PrivacyNoticeModal scope="registration" onClose={() => setReading(false)} /> : null}
          <aside className="intelligence-panel">
            <div>
              <h2>Valencia Intelligence</h2>
              <p>
                Deploying top-tier structural masterworks verified through
                complete digital oversight loops.
              </p>
            </div>
            <div className="intelligence-list">
              {intelligence.map(([icon, title, description]) => (
                <div className="intelligence-item" key={title}>
                  <span>
                    <Icon name={icon} />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="intelligence-stats">
              <div>
                <strong>15+</strong>
                <span>Years Active</span>
              </div>
              <div>
                <strong>100%</strong>
                <span>Accuracy</span>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
