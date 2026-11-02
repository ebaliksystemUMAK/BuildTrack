// Pure rules for the emailed 6-digit codes (no Deno or network APIs, so they are unit-tested in Node by `pnpm test:email-codes`): making a code, hashing it, and the
// password rule that mirrors src/lib/passwordPolicy.ts. A code is never stored: only an HMAC of (purpose, address, code) keyed with a server secret.

export type CodePurpose = "reset" | "register"
export const CODE_LENGTH = 6
export const CODE_MINUTES = 10

// Six digits, every value equally likely (rejection sampling, no modulo bias), leading zeros kept.
export function generateCode(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  let value = ""
  while (value.length < CODE_LENGTH) {
    const [byte] = random(new Uint8Array(1))
    if (byte < 250) value += String(byte % 10) // 250 is the largest multiple of 10 below 256
  }
  return value
}

export const isCode = (value: unknown): value is string => typeof value === "string" && new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value)

export const normalizeEmail = (value: unknown): string => (typeof value === "string" ? value.trim().toLowerCase() : "")
export const isEmail = (value: string): boolean => value.length <= 320 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("")

// 64 hex characters. The purpose and address are part of the message, so a code for one purpose or address never opens another.
export async function hashCode(secret: string, purpose: CodePurpose, email: string, code: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${purpose}:${email}:${code}`)))
}

// The same rule as src/lib/passwordPolicy.ts (12+ characters with lowercase, uppercase, a number and a special character); the test compares them.
export const PASSWORD_MIN_LENGTH = 12
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== "string") return "Enter a new password."
  const missing: string[] = []
  if (value.length < PASSWORD_MIN_LENGTH) missing.push(`at least ${PASSWORD_MIN_LENGTH} characters`)
  if (!/[a-z]/.test(value)) missing.push("a lowercase letter")
  if (!/[A-Z]/.test(value)) missing.push("an uppercase letter")
  if (!/\d/.test(value)) missing.push("a number")
  if (!/[!-\/:-@[-`{-~]/.test(value)) missing.push("a special character")
  if (value.length > 200) return "That password is too long."
  if (!missing.length) return null
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
  return `Password needs ${list}.`
}

export type CodeAction = "send_reset" | "check_reset" | "verify_reset" | "send_register" | "verify_register"
export const CODE_ACTIONS: CodeAction[] = ["send_reset", "check_reset", "verify_reset", "send_register", "verify_register"]

// Resetting a password is open to a signed-out person (they are, by definition); confirming an address needs the signed-in account itself.
export function authorizeCodeAction(action: unknown, signedIn: boolean): { ok: true; action: CodeAction } | { ok: false; status: number; message: string } {
  if (typeof action !== "string" || !CODE_ACTIONS.includes(action as CodeAction)) return { ok: false, status: 400, message: "Unknown action" }
  if ((action === "send_register" || action === "verify_register") && !signedIn) return { ok: false, status: 401, message: "Sign in first" }
  return { ok: true, action: action as CodeAction }
}

export const messages = {
  invalid: "That code is incorrect or has expired. Ask for a new one.",
  locked: "Too many wrong tries. Ask for a new code.",
  unavailable: "Emailed codes are not available right now. Use the reset link instead, or contact your administrator.",
  unavailableRegister: "We could not send the code right now. Please try again in a few minutes, or contact your administrator.",
  sent: "If that email has an account, a code is on its way.",
} as const
