import { useEffect, useRef, useState, type FormEvent } from "react"
import Modal from "../../components/Modal"
import EmailCodeStep from "../../components/EmailCodeStep"
import DataConfirmModal from "../../components/PrivacyNotice"
import { IdentityCard } from "../../components/identity/IdentityVerification"
import { Skeleton, SkeletonList } from "../../components/ui/Skeleton"
import {
  requestableRoles,
  requestError,
  requestStatusChip,
  requestStatusLabel,
  useMyRequests,
  type RequestedRole,
} from "../../lib/access"
import { useAuth } from "../../lib/auth"
import { useConfirm } from "../../lib/confirm"
import { disciplineLabels, type Discipline } from "../../lib/projects"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { AvatarEditor, Avatar, InviteCodeCard, ProfileCompleteness, RoleGuide } from "./UserExtras"

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"
const roleName: Record<string, string> = { engineer: "Engineer", foreman: "Foreman", client: "Client" }
const when = (iso: string) => new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" })

export default function UserHome() {
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const { requests, loading, error, reload } = useMyRequests()
  const [requesting, setRequesting] = useState(false)
  const [editing, setEditing] = useState(false)
  const pending = requests.find((request) => request.status === "pending") ?? null
  const history = requests.filter((request) => request.status !== "pending")
  const lastDecided = useRef<string | null>(null)

  // While a request is waiting, check every 20 s so an approval takes effect without a manual refresh.
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => {
      void reload()
      void refreshProfile()
    }, 20000)
    return () => window.clearInterval(timer)
  }, [pending, reload, refreshProfile])

  // Tell the user once when a decision arrives.
  useEffect(() => {
    const decided = history[0]
    if (!decided || lastDecided.current === decided.id) return
    if (lastDecided.current !== null && decided.status === "rejected") toast.info("Your request was not approved", decided.decision_note ?? "You can send a new request any time.")
    lastDecided.current = decided.id
  }, [history, toast])

  const cancel = async () => {
    if (!pending) return
    if (!(await confirm({ title: "Cancel your request?", message: "You can send a new one afterwards.", confirmLabel: "Cancel request", cancelLabel: "Keep it" }))) return
    const { error: cancelError } = await supabase.from("access_requests").update({ status: "cancelled" }).eq("id", pending.id)
    if (cancelError) return toast.error("Could not cancel the request", requestError(cancelError))
    toast.success("Request cancelled")
    await reload()
  }

  const name = profile?.full_name || "there"
  const emailConfirmed = Boolean(profile?.email_verified_at)
  const verified = profile?.identity_status === "verified" && emailConfirmed

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="flex items-center gap-5 bg-gradient-to-br from-[#68135f] via-[#7c1a73] to-[#9e1f93] px-6 py-8 text-white">
          <Avatar url={profile?.avatar_url} name={profile?.full_name || profile?.email || ""} size={72} />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#f18b00]">Valencia Construction Services</p>
            <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Welcome, {name}</h1>
            <p className="mt-2 max-w-xl text-sm text-white/85">
              Your account is ready. To work on projects, request access for your role or join with an invitation code. An administrator reviews requests, usually the same day.
            </p>
          </div>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-fg-muted">Account</p>
            <p className="mt-1 truncate text-sm font-semibold">{profile?.email}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-fg-muted">Access level</p>
            <p className="mt-1 text-sm font-semibold">Basic account</p>
          </div>
          <div className="sm:text-right">
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-surface-muted">
              Edit profile
            </button>
          </div>
        </div>
      </section>

      {emailConfirmed ? null : (
        <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h2 className="border-l-4 border-accent pl-3 text-lg font-extrabold text-brand-strong">Confirm your email</h2>
          <p className="mt-1 pl-4 text-sm text-fg-muted">Requests for access and invitation codes unlock after you type the 6-digit code we email to your address.</p>
          <div className="mt-4 max-w-md"><EmailCodeStep what="request access" /></div>
        </section>
      )}

      <IdentityCard />

      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="border-l-4 border-accent pl-3 text-lg font-extrabold text-brand-strong">Elevated access</h2>
            <p className="mt-1 pl-4 text-sm text-fg-muted">Choose Engineer, Foreman or Client. Admins only review these requests.</p>
          </div>
          {!pending && !loading ? (
            <button type="button" onClick={() => setRequesting(true)} disabled={!verified} title={verified ? undefined : emailConfirmed ? "Verify your identity first" : "Confirm your email first"} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50">
              Request elevated access
            </button>
          ) : null}
        </div>

        {error ? (
          <p className="flex items-center gap-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}<button className="font-bold underline" onClick={() => void reload()}>Retry</button></p>
        ) : null}

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-20 w-full" />
            <SkeletonList rows={2} label="Loading your requests" />
          </div>
        ) : pending ? (
          <div className="rounded-xl border border-line bg-surface-muted/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">
                {roleName[pending.requested_role]}
                {pending.discipline ? <span className="font-normal text-fg-muted"> • {disciplineLabels[pending.discipline]}</span> : null}
              </p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${requestStatusChip.pending}`}>{requestStatusLabel.pending}</span>
            </div>
            {pending.message ? <p className="mt-2 whitespace-pre-wrap text-sm">{pending.message}</p> : null}
            <p className="mt-2 text-xs text-fg-muted">Sent {when(pending.created_at)}. This page updates by itself when it is reviewed.</p>
            <button type="button" onClick={() => void cancel()} className="mt-3 text-sm font-semibold text-danger-fg hover:underline">Cancel request</button>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-fg-muted">
            {verified ? 'You have no request waiting. Press "Request elevated access" when you are ready.' : emailConfirmed ? "Verify your identity above to unlock access requests." : "Confirm your email above to unlock access requests."}
          </p>
        )}

        {history.length ? (
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-fg-muted">Earlier requests</h3>
            <ul className="divide-y divide-line">
              {history.map((request) => (
                <li key={request.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                  <div>
                    <p className="font-semibold">{roleName[request.requested_role]}</p>
                    <p className="text-xs text-fg-muted">Sent {when(request.created_at)}{request.decision_note ? ` • "${request.decision_note}"` : ""}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${requestStatusChip[request.status]}`}>{requestStatusLabel[request.status]}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <InviteCodeCard onJoined={refreshProfile} />
        <ProfileCompleteness onEdit={() => setEditing(true)} />
      </div>
      <RoleGuide />

      {requesting ? <RequestAccessModal onClose={() => setRequesting(false)} onSent={() => { setRequesting(false); void reload() }} /> : null}
      {editing && profile ? <EditProfileModal onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void refreshProfile() }} /> : null}
    </div>
  )
}

function RequestAccessModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const [role, setRole] = useState<RequestedRole>("engineer")
  const [discipline, setDiscipline] = useState<Discipline | "">("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const review = (event: FormEvent) => {
    event.preventDefault()
    if (message.trim().length < 10) return setError("Tell the admin which project or company you work with (at least 10 characters).")
    setError("")
    setConfirming(true)
  }

  const submit = async () => {
    setBusy(true)
    const { error: insertError } = await supabase.from("access_requests").insert({
      user_id: "00000000-0000-0000-0000-000000000000", // replaced by the database
      requested_role: role,
      discipline: role === "client" ? null : discipline || null,
      message: message.trim(),
    })
    setBusy(false)
    if (insertError) {
      setConfirming(false)
      setError(requestError(insertError))
      return toast.error("Request not sent", requestError(insertError))
    }
    toast.success("Request sent", "An administrator will review it.")
    onSent()
  }

  return (
    <Modal
      title="Request elevated access"
      description="Pick the role you need. An administrator will approve or decline it."
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted disabled:opacity-60">Cancel</button>
          <button type="submit" form="request-access-form" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9e1f93] to-[#b4329f] px-4 py-2 text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(158,31,147,0.85)] hover:from-[#8a1a80] hover:to-[#a52a92] disabled:opacity-60">{busy ? "Sending..." : "Send request"}</button>
        </>
      }
    >
      <form id="request-access-form" className="space-y-4" noValidate onSubmit={review}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Role</legend>
          <div className="grid gap-2">
            {requestableRoles.map((item) => (
              <label key={item.key} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${role === item.key ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-muted"}`}>
                <input type="radio" name="role" className="mt-1" checked={role === item.key} onChange={() => setRole(item.key)} />
                <span>
                  <span className="block text-sm font-bold">{item.label}</span>
                  <span className="block text-xs text-fg-muted">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {role !== "client" ? (
          <label className="block text-sm font-semibold">
            Your discipline
            <select className={field} value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline | "")}>
              <option value="">Not sure / general</option>
              {(Object.keys(disciplineLabels) as Discipline[]).map((d) => <option key={d} value={d}>{disciplineLabels[d]}</option>)}
            </select>
          </label>
        ) : null}
        <label className="block text-sm font-semibold">
          Why do you need it? *
          <textarea className={field} rows={3} maxLength={500} placeholder="e.g. I am the site engineer for the Ticzon Residence project." value={message} onChange={(e) => setMessage(e.target.value)} />
          <span className="mt-1 block text-right text-xs font-normal text-fg-muted">{message.length}/500</span>
        </label>
      </form>
      {confirming ? (
        <DataConfirmModal title="Check your request" description="This goes to the administrators for a decision." scope="general" rows={[{ label: "Access", value: roleName[role] }, { label: "Discipline", value: role === "client" ? "" : discipline ? disciplineLabels[discipline] : "Not sure / general" }, { label: "Reason", value: message.trim() }]} confirmLabel="Send request" busy={busy} onConfirm={submit} onClose={() => !busy && setConfirming(false)} />
      ) : null}
    </Modal>
  )
}

function EditProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { profile, refreshProfile } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ full_name: profile?.full_name ?? "", phone: profile?.phone ?? "", company: profile?.company ?? "", position: profile?.position ?? "" })
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const [confirming, setConfirming] = useState(false)
  const review = (event: FormEvent) => {
    event.preventDefault()
    if (form.full_name.trim().length < 2) return setError("Enter your full name.")
    setError("")
    setConfirming(true)
  }

  const save = async () => {
    setBusy(true)
    const { error: saveError } = await supabase
      .from("profiles")
      .update({ full_name: form.full_name.trim(), phone: form.phone.trim() || null, company: form.company.trim() || null, position: form.position.trim() || null })
      .eq("id", profile!.id)
    setBusy(false)
    if (saveError) {
      setConfirming(false)
      setError(saveError.message)
      return toast.error("Profile not saved", saveError.message)
    }
    toast.success("Profile saved")
    onSaved()
  }

  return (
    <Modal
      title="Edit profile"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">Cancel</button>
          <button type="submit" form="edit-profile-form" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9e1f93] to-[#b4329f] px-4 py-2 text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(158,31,147,0.85)] hover:from-[#8a1a80] hover:to-[#a52a92] disabled:opacity-60">{busy ? "Saving..." : "Save"}</button>
        </>
      }
    >
      <form id="edit-profile-form" className="space-y-3" noValidate onSubmit={review}>
        <AvatarEditor onChanged={() => void refreshProfile()} />
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        {(
          [
            ["full_name", "Full name *"],
            ["phone", "Phone"],
            ["company", "Company / organization"],
            ["position", "Job title"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block text-sm font-semibold">
            {label}
            <input className={field} maxLength={120} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          </label>
        ))}
      </form>
      {confirming ? (
        <DataConfirmModal title="Save these changes?" description="Your project team and administrators will see these details." scope="profile" rows={[{ label: "Full name", value: form.full_name.trim() }, { label: "Phone", value: form.phone.trim() }, { label: "Company", value: form.company.trim() }, { label: "Job title", value: form.position.trim() }]} confirmLabel="Save changes" busy={busy} onConfirm={save} onClose={() => !busy && setConfirming(false)} />
      ) : null}
    </Modal>
  )
}
