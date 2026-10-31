// Registration phone numbers: exactly 11 digits, numbers only (Philippine mobile format, e.g. 09123456789).
// Pure, tested in `pnpm test:lib`.
export const PHONE_DIGITS = 11

// What the field keeps while typing or pasting: digits only, never more than 11 ("+63 912-345" becomes "63912345").
export const phoneDigits = (value: string) => value.replace(/\D/g, "").slice(0, PHONE_DIGITS)

export const phoneIssue = (value: string) =>
  new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(value) ? "" : `Enter an ${PHONE_DIGITS}-digit phone number using numbers only, for example 09123456789.`
