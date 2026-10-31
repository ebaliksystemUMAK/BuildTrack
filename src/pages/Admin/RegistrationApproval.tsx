import { useEffect, useState } from "react"
import { roleLabel } from "../../lib/admin"
import { approvalRoles, type ApprovalRole, type RequestedRole } from "../../lib/access"

const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-[#9e1f93] to-[#b4329f] px-4 py-2 text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgba(158,31,147,0.85)] hover:from-[#8a1a80] hover:to-[#a52a92] disabled:opacity-60"
const select = "min-h-10 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-fg"

// Approving a registration: pick the role from a dropdown (the one the person asked for is preselected), then approve.
// Used by the Review queue detail and the user details dialog; admin-users checks who may give which role.
export default function RegistrationApproval({ userId, requested, busy, onApprove }: { userId: string; requested: RequestedRole | null; busy: boolean; onApprove: (role: ApprovalRole) => void }) {
  const [role, setRole] = useState<ApprovalRole>(requested ?? "engineer")
  useEffect(() => setRole(requested ?? "engineer"), [userId, requested])
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[14rem] flex-1 text-xs font-extrabold uppercase tracking-wider text-fg-muted sm:max-w-xs">Approve as
          <select className={`${select} mt-1 normal-case tracking-normal`} value={role} disabled={busy} onChange={(event) => setRole(event.target.value as ApprovalRole)}>
            {approvalRoles.map((key) => <option key={key} value={key}>{roleLabel[key]}{key === requested ? " (requested)" : ""}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} className={primary} onClick={() => onApprove(role)}>{busy ? "Working..." : `Approve as ${roleLabel[role]}`}</button>
      </div>
      {role === "project_manager" ? <p className="text-xs text-fg-muted">A Project Manager sees no project until an Admin assigns them one in All projects.</p>
        : requested && role !== requested ? <p className="text-xs text-fg-muted">They asked for {roleLabel[requested]} access.</p> : null}
    </div>
  )
}
