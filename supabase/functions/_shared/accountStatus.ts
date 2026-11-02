// Rules for suspending and re-enabling an account, kept free of Deno / Supabase imports so `pnpm test:account-status` can run them in Node.
// admin-users calls checkStatusChange before it touches anything, so the browser can never skip the reason or the target rules.

export const MIN_REASON = 5
export const MAX_REASON = 500

export type StatusActor = { id: string; role: string | null }
export type StatusTarget = { id: string; role: string | null; status: string }
export type StatusCheck = { ok: true; reason: string | null } | { ok: false; status: number; message: string }

const isPrivileged = (role: string | null) => role === "super_admin" || role === "admin"

// Trimmed, control characters removed, one space between words and lines, at most MAX_REASON characters. Never HTML: callers store and show it as text.
export function cleanReason(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_REASON)
}

export function checkStatusChange(actor: StatusActor, target: StatusTarget, enable: boolean, rawReason: unknown): StatusCheck {
  if (target.id === actor.id) {
    return { ok: false, status: 400, message: enable ? "You cannot change your own account status" : "You cannot disable your own account" }
  }
  // Only a Super Admin may touch Admin or Super Admin accounts (same rule as every other user action).
  if (isPrivileged(target.role) && actor.role !== "super_admin") {
    return { ok: false, status: 403, message: "Only a Super Admin can manage admin accounts" }
  }
  if (enable) {
    // Enabling must never turn a pending or rejected registration into an active account: those go through the review queue.
    if (target.status !== "disabled") return { ok: false, status: 400, message: "Only a suspended account can be enabled" }
    return { ok: true, reason: null }
  }
  if (target.status === "pending") return { ok: false, status: 400, message: "Reject pending users instead" }
  if (target.status === "rejected") return { ok: false, status: 400, message: "This registration was already rejected" }
  if (target.status === "disabled") return { ok: false, status: 400, message: "This account is already suspended" }
  const reason = cleanReason(rawReason)
  if (reason.length < MIN_REASON) return { ok: false, status: 400, message: `Give a reason for the suspension (at least ${MIN_REASON} characters)` }
  return { ok: true, reason }
}

export type StatusNotice = { kind: string; title: string; body: string }

// The notification kinds are registered in src/lib/notifications.ts (notificationKinds).
export const suspensionNotice = (reason: string): StatusNotice => ({
  kind: "account.suspended",
  title: "Your account was suspended",
  body: `Reason: ${reason}`.slice(0, 500),
})

export const reactivationNotice = (): StatusNotice => ({
  kind: "account.reactivated",
  title: "Your account is active again",
  body: "An administrator enabled your account. You can sign in and continue.",
})
