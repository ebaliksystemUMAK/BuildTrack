import { useCallback, useEffect, useState, type FormEvent } from "react"
import Modal from "../../components/Modal"
import { EmptyState, buttonPrimary, buttonSecondary, inputClass } from "../../components/ui/PageParts"
import { SkeletonList } from "../../components/ui/Skeleton"
import { requestableRoles, type RequestedRole } from "../../lib/access"

// Invitations give a field role, or Project Manager (an Admin then assigns their projects).
type InviteRole = RequestedRole | "project_manager"
const inviteRoles: Array<{ key: InviteRole; label: string }> = [...requestableRoles, { key: "project_manager", label: "Project Manager" }]
import { formatDate } from "../../lib/admin"
import { useConfirm } from "../../lib/confirm"
import { formatInviteCode } from "../../lib/profileTools"
import { disciplineLabels, type Discipline } from "../../lib/projects"
import { supabase } from "../../lib/supabase"
import { useToast } from "../../lib/toast"
import { PageIntro, Panel, StatusBadge, AdminButton } from "./AdminShell"
import type { AdminPageProps } from "./types"

type Invite = { id: string; code: string; assigned_role: InviteRole; discipline: Discipline | null; note: string | null; max_uses: number; uses: number; expires_at: string; disabled: boolean; created_at: string }

const state = (invite: Invite) => {
  if (invite.disabled) return { label: "Disabled", tone: "neutral" as const }
  if (new Date(invite.expires_at) <= new Date()) return { label: "Expired", tone: "warning" as const }
  if (invite.uses >= invite.max_uses) return { label: "Used up", tone: "info" as const }
  return { label: "Active", tone: "success" as const }
}

export default function InviteCodes(_: AdminPageProps) {
  const toast = useToast()
  const confirm = useConfirm()
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const { data, error: loadError } = await supabase.from("invite_codes").select("*").order("created_at", { ascending: false }).limit(200)
    setError(loadError ? "Could not load invitation codes. Check your connection and try again." : "")
    setInvites((data as Invite[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(formatInviteCode(code))
      toast.success("Code copied", formatInviteCode(code))
    } catch {
      toast.info("Select and copy the code", formatInviteCode(code))
    }
  }

  const toggle = async (invite: Invite) => {
    const disabling = !invite.disabled
    if (disabling && !(await confirm({ title: "Disable this code?", message: `${formatInviteCode(invite.code)} will stop working right away. People who already joined keep their role.`, confirmLabel: "Disable", tone: "danger" }))) return
    const { error: rpcError } = await supabase.rpc("set_invite_disabled", { p_id: invite.id, p_disabled: disabling })
    if (rpcError) return toast.error("Not changed", rpcError.message)
    toast.success(disabling ? "Code disabled" : "Code enabled")
    await reload()
  }

  return (
    <div className="admin-page">
      <PageIntro
        eyebrow="Access"
        title="Invitation codes"
        description="Give a trusted person a code and they get their role the moment they enter it, with no waiting. Codes expire, can be limited to a number of uses and can be switched off."
        action={<AdminButton icon="plus" onClick={() => setCreating(true)}>New code</AdminButton>}
      />
      {error ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-4 py-2 text-sm text-danger-fg">{error}</p> : null}
      <Panel title="Codes">
        {loading ? (
          <SkeletonList rows={4} label="Loading codes" />
        ) : invites.length === 0 ? (
          <EmptyState title="No codes yet" action={<button type="button" className={buttonPrimary} onClick={() => setCreating(true)}>Create the first code</button>}>
            Useful for onboarding a whole site team or a client contact without approving requests one by one.
          </EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Code</th><th>Role</th><th>Used</th><th>Expires</th><th>Note</th><th>Status</th><th /></tr></thead>
              <tbody>
                {invites.map((invite) => {
                  const current = state(invite)
                  return (
                    <tr key={invite.id}>
                      <td className="is-strong"><span className="font-mono tracking-widest">{formatInviteCode(invite.code)}</span></td>
                      <td>{inviteRoles.find((item) => item.key === invite.assigned_role)?.label}{invite.discipline ? ` • ${disciplineLabels[invite.discipline]}` : ""}</td>
                      <td>{invite.uses} / {invite.max_uses}</td>
                      <td className="is-muted">{formatDate(invite.expires_at)}</td>
                      <td className="is-muted">{invite.note ?? "—"}</td>
                      <td><StatusBadge tone={current.tone}>{current.label}</StatusBadge></td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button type="button" className="rounded-md border border-line px-2.5 py-1 text-xs font-bold hover:bg-surface-muted" onClick={() => void copy(invite.code)}>Copy</button>
                          <button type="button" className="rounded-md border border-line px-2.5 py-1 text-xs font-bold hover:bg-surface-muted" onClick={() => void toggle(invite)}>{invite.disabled ? "Enable" : "Disable"}</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {creating ? <CreateInviteModal onClose={() => setCreating(false)} onCreated={(code) => { setCreating(false); setCreated(code); void reload() }} /> : null}
      {created ? (
        <Modal title="Code created" size="sm" onClose={() => setCreated(null)} footer={<><button type="button" className={buttonSecondary} onClick={() => setCreated(null)}>Done</button><button type="button" className={buttonPrimary} onClick={() => void copy(created)}>Copy code</button></>}>
          <p className="text-sm text-fg-muted">Share this code with the person. They enter it on their account home page.</p>
          <p className="mt-4 rounded-xl border border-line bg-surface-muted py-4 text-center font-mono text-2xl font-extrabold tracking-[0.2em]">{formatInviteCode(created)}</p>
        </Modal>
      ) : null}
    </div>
  )
}

function CreateInviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const toast = useToast()
  const [role, setRole] = useState<InviteRole>("foreman")
  const [discipline, setDiscipline] = useState<Discipline | "">("")
  const [uses, setUses] = useState(1)
  const [days, setDays] = useState(14)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!Number.isInteger(uses) || uses < 1 || uses > 100) return setError("Uses must be between 1 and 100.")
    if (!Number.isInteger(days) || days < 1 || days > 90) return setError("Valid days must be between 1 and 90.")
    setError("")
    setBusy(true)
    const { data, error: rpcError } = await supabase.rpc("create_invite", { p_role: role, p_discipline: role === "engineer" || role === "foreman" ? discipline || null : null, p_note: note.trim() || null, p_max_uses: uses, p_days: days })
    setBusy(false)
    if (rpcError || !data) {
      const message = /aal2|MFA/i.test(rpcError?.message ?? "") ? "Confirm your authenticator code first." : (rpcError?.message ?? "Could not create the code.")
      setError(message)
      return toast.error("Code not created", message)
    }
    onCreated(data as string)
  }

  return (
    <Modal title="New invitation code" description="Pick the role it gives and how long it stays valid." onClose={busy ? () => undefined : onClose}
      footer={<><button type="button" className={buttonSecondary} onClick={onClose} disabled={busy}>Cancel</button><button type="submit" form="create-invite-form" className={buttonPrimary} disabled={busy}>{busy ? "Creating..." : "Create code"}</button></>}>
      <form id="create-invite-form" className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        {error ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-fg">{error}</p> : null}
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Role it gives</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {inviteRoles.map((item) => (
              <label key={item.key} className={`cursor-pointer rounded-xl border p-3 text-sm transition ${role === item.key ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-muted"}`}>
                <input type="radio" name="invite-role" className="sr-only" checked={role === item.key} onChange={() => setRole(item.key)} />
                <span className="block font-bold">{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {role === "engineer" || role === "foreman" ? (
          <label className="block text-sm font-semibold">Discipline (optional)
            <select className={`${inputClass} mt-1`} value={discipline} onChange={(event) => setDiscipline(event.target.value as Discipline | "")}>
              <option value="">Not set</option>
              {(Object.keys(disciplineLabels) as Discipline[]).map((key) => <option key={key} value={key}>{disciplineLabels[key]}</option>)}
            </select>
          </label>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Can be used by
            <input className={`${inputClass} mt-1`} type="number" min={1} max={100} value={uses} onChange={(event) => setUses(Number(event.target.value))} />
            <span className="mt-1 block text-xs font-normal text-fg-muted">people (1 to 100)</span>
          </label>
          <label className="block text-sm font-semibold">Valid for
            <input className={`${inputClass} mt-1`} type="number" min={1} max={90} value={days} onChange={(event) => setDays(Number(event.target.value))} />
            <span className="mt-1 block text-xs font-normal text-fg-muted">days (1 to 90)</span>
          </label>
        </div>
        <label className="block text-sm font-semibold">Note (only admins see it)
          <input className={`${inputClass} mt-1`} maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Foremen, Ticzon Residence site team" />
        </label>
      </form>
    </Modal>
  )
}
