// Pure rules for notifications, shared by the bell, the history list and the tests (no network, no React).

// Which kind of email a notification is. Keep in step with SQL notification_email_category (20261101220000) and
// supabase/functions/_shared/emailModel.ts (emailCategory); `pnpm test:communications` checks the three agree on the same list of kinds.
// "inapp" = shown in the bell only, never emailed (see the migration for why each kind is on that list).
export type EmailCategory = "security" | "reminder" | "announcement" | "activity" | "inapp"

const reminderKinds = new Set(["pin.due", "pin.overdue", "qa.defect_due", "qa.defect_overdue", "qa.overdue", "alert.overdue", "alert.escalation"])
export const IN_APP_ONLY_KINDS = ["pin.milestone", "pin.resumed", "report.submitted", "report.reviewed", "qa.defect_closed", "project.archived", "project.restored", "project.manager_removed", "attendance.concern_resolved"]

export function notificationCategory(kind: string): EmailCategory {
  if (kind.startsWith("account.") || kind.startsWith("security.")) return "security"
  if (kind.startsWith("announcement.")) return "announcement"
  if (reminderKinds.has(kind)) return "reminder"
  if (IN_APP_ONLY_KINDS.includes(kind)) return "inapp"
  return "activity"
}

// Messages sent by email only are stored as notifications so the email queue can read them; they never belong in the bell.
export const HIDDEN_KINDS = ["announcement.email"]
export const isHiddenKind = (kind: string) => HIDDEN_KINDS.includes(kind)

// Notification links are in-app paths such as /engineer/qa?project=<id> (the database enforces the same pattern). Anything else is never followed.
const inAppLink = /^\/[a-z0-9/_-]*(\?[A-Za-z0-9=&_.-]*)?$/
export function safeInAppLink(link: string | null | undefined): string | null {
  return typeof link === "string" && inAppLink.test(link) ? link : null
}
