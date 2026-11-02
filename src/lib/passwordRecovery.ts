import { useSyncExternalStore } from "react"

// "This person is in the middle of resetting a password." A reset link or a reset code signs the person in with a one-time session; until they choose
// a new password the app must keep them on the reset screen instead of opening their workspace. The note lives in sessionStorage (this tab only), so a
// reload during the reset keeps it, and ends when the password is changed, the reset is cancelled or the link turns out to be unusable.
const KEY = "buildtrack.recovering"

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1"
  } catch {
    return false // without storage the reset still works; the note only lives in memory
  }
}

let active = read()
const listeners = new Set<() => void>()

function set(value: boolean) {
  if (active === value) return
  active = value
  try {
    if (value) sessionStorage.setItem(KEY, "1")
    else sessionStorage.removeItem(KEY)
  } catch {
    // Memory only.
  }
  listeners.forEach((listener) => listener())
}

export const beginRecovery = () => set(true)
export const endRecovery = () => set(false)
export const isRecovering = () => active

export function useRecovering(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => active,
    () => false,
  )
}

// The address of a reset link carries a one-time sign-in: #access_token=...&type=recovery. The app must notice it BEFORE the auth client reads and removes it.
export const linkIsRecovery = (hash: string) => /(^|[#&?])type=recovery(&|$)/.test(hash)

// A used or expired link comes back as #error=access_denied&error_code=otp_expired.
export function linkProblem(hash: string): string | null {
  if (!/(^|[#&?])error(_code)?=/.test(hash)) return null
  return "This reset link has expired or was already used. Ask for a new one."
}

// Both are read once, when the app starts, because the auth client removes the one-time values from the address while it loads.
export const startupLinkProblem: string | null = typeof window !== "undefined" ? linkProblem(window.location.hash) : null
if (typeof window !== "undefined" && linkIsRecovery(window.location.hash)) set(true)
