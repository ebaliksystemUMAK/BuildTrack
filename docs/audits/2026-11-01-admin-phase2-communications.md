# 2026-11-01: Admin phase 2 (notifications, announcement banner, communications hub)

Branch `feature/admin-phase2`, not committed or pushed. One migration, **applied 2026-11-01** to the BuildTrack project with the owner's approval and verified (`20261101090000_admin_communications.sql`, live version `20261101041911`, doc in `sql/`). The Edge Function sources changed only in a shared email file; redeploying is optional (footers). No hosted action was taken.

## Reviewed before building
The notification system already had the table, bell, unread dot, "mark all" for the loaded rows, deadline reminders, links, an "Also email me" switch, the Brevo queue (`claim_email_batch`, `mark_email_result`, `email_log`) and the `send-notifications` function with a branded layout. Everything below extends those; there is no second system.

## A. Notifications and preferences
| Item | Result |
|---|---|
| Unread count | The badge is a count over all notifications (it counted only the 50 loaded). Email-only messages are excluded. |
| Mark all read | One database call for every unread row; falls back to the loaded rows when the migration is not installed. |
| History | "See all notifications" opens a history dialog (all / unread, 25 at a time, open the page, mark all). |
| Destination links | Only in-app paths are ever followed (`safeInAppLink`, same pattern as the database check); anything else is ignored. |
| Email choices | Master switch kept. Under it: reminder emails and announcement emails (default on, per person). Account and security notices (`account.*`, `security.*`) are always emailed and have no switch (password reset and sign-in codes come from Supabase Auth and are not affected by any of these switches). Without the migration only the master switch is offered. |
| Email layout | Same branded layout; only the footer text changes with the category. |
| Queue safety (found while reviewing) | Two overlapping runs could claim the same row and email a person twice. A claim lease fixes it; a repeated result no longer writes a second "sent" line. |

## B. Announcement banner
One row; Super Admin with MFA publishes (confirmation shown), anyone including signed-out visitors reads it through one function; refresh about every 30 seconds while the page is visible and when the tab returns; dismissal is stored per browser per revision, an edit (or publishing again) shows it again, a critical banner has no close button and cannot be dismissed; text is shown as plain text (React escapes it); audit entries `announcement.publish / update / disable`. Mounted in `src/main.tsx` above the whole app (so `App` and its route guard are unchanged) and it appears on public, login, status and workspace pages; a broken banner is isolated by the compact error boundary.

## C. Communications hub (Admin > Announcements & messages)
Search by name, email or company and add a whole role; channel in the app, email or both; the review step shows how many will receive it, how many cannot (not active), how many emails will be queued and how many people opted out, then asks for confirmation; the send is idempotent (a batch id; a retry cannot duplicate); limits 200 people per send (Super Admin 500), 10 sends an hour, 1,000 people a day (Super Admin 2,000); emails go through the existing queue so the opt-outs, daily cap, retries and lease apply; the history shows sent, waiting, skipped and failed per message; every send is in the audit log (title and counts, not the text). Permission: Super Admin, or an Admin holding Edit users (searching also needs View users, because it shows names and emails), with MFA. Project Managers and field roles cannot use it.

## Decisions and limits
- The banner is Super Admin only because it appears to the public; messaging uses the existing `users.edit` permission instead of adding a new permission (a new permission would touch the permission list, matrix and several tests).
- An email-only message creates a hidden notification row (kind `announcement.email`) so the queue can send it; the app never shows it.
- A person who switched announcement emails off receives no email for an email-only message and, being unable to see a hidden row, no bell message either; the review step says so.
- The banner is under the full-window plan editor, which covers the page.
- Suspended people can now receive the suspension notice by email (they were skipped before).
- Without the Brevo secrets and the cron job, queued emails wait and are closed after 2 days; the history then shows them as failed.
- Not verified: a real Brevo send, and a real browser (the pages were tested against fakes). The migration itself is verified on the live database.

## Owner steps
1. Done: the migration was applied and verified (results in `sql/20261101090000_admin_communications.md`). The code that uses it is on this branch only; until it is merged and deployed the live app does not show the new screens, and nothing changes for users.
2. Optional: `pnpm functions:deploy` for the new email footers. Emails also need the existing secrets and cron job (`docs/BUILDTRACK_EMAIL_SETUP.md`).
3. Rollback: the comment block at the end of the migration.

## Checks
`pnpm check`: type-check, all test scripts including the new `pnpm test:communications` (categories, links, footers, banner rules, polling hook, dismissal, component, hub rules, notification and preference hooks, the hub page) and `pnpm test:sql` including `zz-communications.cases.mjs` (preferences, categories, lease, announcement permissions / revision / audit, hub permissions, limits, idempotency, outcomes), build.
