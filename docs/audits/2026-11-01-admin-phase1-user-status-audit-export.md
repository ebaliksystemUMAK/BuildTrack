# 2026-11-01: Admin phase 1 (suspension reason + notice, audit export, dashboard counts, monthly report, error isolation)

Branch `feature/admin-phase1`, not committed or pushed. No migration. One Edge Function change that the owner must deploy. No database object, policy or hosted setting was touched.

## What was already there (kept)
User search and filters, the details dialog, suspend / enable (`set_enabled`), the self / Admin / Super Admin rules (`loadTarget`), the active-account check in `requireCaller`, database access limited to active accounts, the audit CSV and its CSV formula protection (`csvEscape`).

## Changed
| Area | Change |
|---|---|
| Suspend | A written reason (5 to 500 characters) is required: asked in a dialog, checked again by `admin-users`, then confirmed. The reason is stored in the audit entry (`user.disable`) and sent to the person as a notification (`account.suspended`). |
| Enable | Asks for a confirmation; the person gets `account.reactivated`. |
| Backend rules | `supabase/functions/_shared/accountStatus.ts` (pure, tested): nobody changes their own status, only a Super Admin touches Admin / Super Admin accounts, only an active account can be suspended and only a suspended one enabled (before this, `set_enabled` could switch a pending or rejected registration straight to active). |
| Access review | Bulk "Disable selected" now sends the reason "No sign-in for N days (access review)". |
| Search | User search also matches phone and job title. |
| Copy | Removed the promise that sessions end "now". The proven part is that the database stops serving a suspended account at once (SQL cases); the Auth session removal stays best effort. |
| Audit export | "Export loaded entries" (what is on screen) and the new "Export all matching" (every entry for the current filters, newest first, at most 5,000, fixed end time, de-duplicated). CSV or JSON from the same `get_audit_log` rows and the same allow-listed columns; the file name and JSON `scope` say which one it is; long details are shortened below the spreadsheet cell limit. |

## Dashboard counts and menu badge (item 3)
- `lib/attentionStore.ts` (pure, tested): one shared store of the waiting counts (registrations, ID checks, data deletion requests, access requests). The User management menu badge (`useReviewCount`) and the dashboard "Needs your decision" band (`useDecisionCounts`) read it, so they cost one request set instead of two and always agree; it refreshes every minute while the tab is visible and keeps the last good numbers when a read fails (before, a failed read showed 0). Hook names and return shapes are unchanged.
- The menu badge now also counts pending access requests, so it matches the dashboard band (before it left them out).
- New dashboard tiles: Suspended Accounts and Basic Accounts (View users permission; they use two more head counts in the existing `useUserStats`), Without a Project Manager (Projects permission; uses the managers the dashboard already loads). "Projects needing attention" also lists "No Project Manager". No tile repeats an existing one and no request was added per menu item.

## Monthly report (item 4)
- The existing report modal (Engineer Reports, PM Reports, Client Overview) gained "This month" and "Last month" (Manila calendar months; `monthPresets`) and a comparison with the previous month (`previousPeriod`, `comparePeriods`). An unfinished month is compared with the same number of days of the month before.
- Only dated records are compared: approved tasks, completed work pins, inspections, defect reports raised / closed, daily reports, client questions. Open counts (waiting for review, overdue, open defects) are today's state and are not compared; the screen and the print say so. A period before the project started shows "nothing to compare with"; a percentage over zero stays blank.
- Task approval (progress) and final pin acceptance are separate: `pinsAccepted` (pin status verified, dated by its own verification) next to the existing approved-task list. The weekly print is unchanged.

## Error isolation (item 5)
- `ErrorBoundary` has a `compact` mode (inline message, "Try again", same error reporting). Used around Project health on the Admin dashboard and the Permissions, Data requests and Review queue panels of User Management. Every page was already inside the page-level boundary, which is unchanged.

## Limits to know
- A suspended person cannot sign in, so they see the notice only after the account is enabled. The email queue (`claim_email_batch`) skips accounts that are not active, so with the queue as it is today no suspension email is sent (migration `20261101090000_admin_communications`, once the owner runs it, lets the suspension notice be emailed). Reactivation notices reach the bell and, when email is set up, the inbox.
- The reason is shown in the audit log, not on the user's details dialog.
- Exporting the audit log is not itself logged (it reads through the existing `users.view` RPC).

## Deployment (done 2026-11-01, owner-approved)
`admin-users` was deployed to the BuildTrack project as **v9** (was v8; JWT verification stays on) through the Supabase connector, because the command line on this machine has no access token. Only that function was deployed (`impersonate`, `send-notifications`, `oauth-gate` and the two biometric functions keep their versions). Verified: readback of the three files matches the repository; no credentials -> 401 from the gateway; the browser preflight answers 200; the project's public anonymous key (not an admin session) reaches the function code and gets 401 `Invalid session`, which proves it starts and still refuses non-admins.

**Consequence until the new screens are deployed:** the screens that send the reason are on branch `feature/admin-phase1`/`phase2`, not on `main`. The currently deployed app still calls `set_enabled` without a reason, so **suspending an account from the live app answers "Give a reason for the suspension (at least 5 characters)" and does nothing**, and so does "Disable selected" in Access review. Enabling an account is not affected. Merge and deploy the screens to restore suspension in the app (a suspension can also be done in the Supabase dashboard meanwhile).

## Rollback
Redeploy the previous `admin-users` (v8 source is the version before this branch: `git show main:supabase/functions/admin-users/index.ts`); no data or schema was changed.

## Verification
`pnpm check` before the change and after it passed. New (items 3 to 5): `pnpm test:admin-phase1` (error boundary) and lib tests for the attention store, project counts, month periods, Manila boundaries, comparison and print (145 lib tests). New (items 1 and 2): `pnpm test:account-status` (rules, notices), 8 SQL cases in `zz-disabled-account.cases.mjs` (a suspended Admin, foreman, engineer and client are refused by the database; enabling restores access), audit export tests in `scripts/test-audit-log.mjs` (allow-list, formula text, JSON scope, paging cap, de-duplication, the real page with delayed responses). Not done: browser check against the real project, deployment of the function. The load test was not run: no RLS or database query changed (only client-side head counts on tables the dashboard already read).
