// Password rule for new accounts: 12+ characters with lowercase, uppercase, a number and a special character. Pure, tested in pnpm test:lib.
export const PASSWORD_MIN_LENGTH = 12

export const passwordRules = [
  { key: "length", label: `At least ${PASSWORD_MIN_LENGTH} characters`, need: `at least ${PASSWORD_MIN_LENGTH} characters`, test: (value: string) => value.length >= PASSWORD_MIN_LENGTH },
  { key: "lower", label: "Lowercase letter (a-z)", need: "a lowercase letter", test: (value: string) => /[a-z]/.test(value) },
  { key: "upper", label: "Uppercase letter (A-Z)", need: "an uppercase letter", test: (value: string) => /[A-Z]/.test(value) },
  { key: "number", label: "Number (0-9)", need: "a number", test: (value: string) => /\d/.test(value) },
  { key: "special", label: "Special character (! @ # $ % ...)", need: "a special character", test: (value: string) => /[!-\/:-@[-`{-~]/.test(value) }, // ASCII symbols, the same set Supabase Auth accepts
] as const

export const passwordChecks = (value: string) => passwordRules.map((rule) => ({ key: rule.key, label: rule.label, met: rule.test(value) }))

// One sentence naming everything still missing, or "" when the password is accepted.
export const passwordIssue = (value: string) => {
  const missing = passwordRules.filter((rule) => !rule.test(value)).map((rule) => rule.need)
  if (!missing.length) return ""
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`
  return `Password needs ${list}.`
}
