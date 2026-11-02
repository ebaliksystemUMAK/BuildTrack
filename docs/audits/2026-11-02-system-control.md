# System Control (2026-11-02)

Branch `feature/admin-phase4`, **not committed**. One additive migration (`20261102100000_system_control`, applied 2026-11-02, live `20261102024451`); no Edge Function change.

## What it is
One Super Admin page, **Admin sidebar > Company > System Control** (`/admin/system-control?tab=...`), for operating the system itself. It replaces the two separate menu entries System health and Site controls; their old addresses (`/admin/system-health`, `/admin/site-controls`) still work and open the matching tab, and their page guides are kept. **Records**, Full backup & export, System settings, Announcements & messages (sending), User management and the project recycle bin stay where they were: they act on role work, records or accounts.

| Tab | Contents |
|---|---|
| Health | The existing system health checks, test email and digest, plus a new read-only **Storage and capacity** panel (database size, files per bucket; no plan limits are invented) |
| Maintenance & isolation | The existing maintenance mode and per-feature, per-role pauses |
| Forced logout | The existing forced logout (preview, reason, typed phrase) |
| Announcement banner | The banner editor moved out of Announcements & messages (which keeps sending messages and now points here), plus **Quick text**: New version available, Planned maintenance, Back to normal (fills the form only) |
| Email | **Pause / resume notification emails** (confirmation pop-up) and **what was really sent** (24 h counts, a plain verdict, the last 40 attempts with the reason) |
| Registration | **Close / open new registrations** with a message people see (pop-up). Closed = the Register page shows the message and the database refuses `complete_registration`, access requests and invitation codes. Existing roles, whitelisted emails and administrator-made accounts are unaffected; an inert basic account can still be created |
| Role access | Which role can open which workspace (from the real route table `rolesForArea`), which Admin page needs which permission, what each role is for, and the existing **Admin permissions editor**. Role rules inside the app are database rules and change only with a migration; this tab says so |
| Activity log | Only system actions (maintenance, feature pauses, forced logouts, banner, switches, emergency off, settings, email test, permissions, account deletions, project purge); role work and records are not in it |

Top right of the page: **Switch everything off** (pop-up): maintenance off, every feature pause off, registration open, email resumed, in one call (`site_emergency_off`). It never signs anybody out and touches no data or accounts; it is audited.

## Backend (`supabase/migrations/20261102100000_system_control.sql`)
- `system_switches` (two rows, both off; no API grants); `system_switch_on` (internal), `get_registration_status` (the only function a visitor may call: closed or not, and the message), `get_system_switches`, `set_system_switch` (audit `system.switch`), `site_emergency_off` (audit `system.emergency_off`), `get_email_delivery`, `get_storage_capacity`, `get_system_activity`. Every one except the visitor function refuses anyone but a Super Admin with the authenticator.
- One added check in `complete_registration`, `prepare_access_request`, `redeem_invite` (registration closed) and `claim_email_batch` (email paused: nothing is claimed, closed or counted, so nothing is lost; rows older than 2 days are still never emailed). The rest of each body equals the live version (hashes compared before applying). Security codes (`email-code`) and account security notices are not affected by the email pause.
- Rollback: restore those four bodies from 20261101210000 / 20261101220000, drop the new functions and the table (block at the end of the file).

## Verification
- `pnpm test:sql` 688 cases (new `zzzzzzzzz-system-control.cases.mjs`: defaults off, Super Admin-only for every call including admins and aal1, registration gates and message, email pause keeps everything, emergency off, reports show only system actions). `pnpm test:system-control` (model + wiring). Older suites updated where menu keys moved.
- Live after applying: all privileges as designed, both switches off, profile fingerprint identical, no maintenance, no feature locked, Cron job still active; security advisor shows only the intended items (RLS-without-policy on `system_switches`; the new Super Admin functions are callable by signed-in users and refuse inside, like the 149 existing ones).
- **Not seen in a signed-in browser**: the page, its pop-ups and the Register-closed screen were checked by tests, type-check and build only (a Super Admin session needs the authenticator). The first real use should be: open the page, run each tab once, close and re-open registration with a test message, pause and resume email.

## Not done on purpose
- No editor for role rules inside the database (a wrong rule would break access for everyone); role access is shown, and Admin permissions are edited as before.
- Closing registration does not stop the email + password sign-up form from creating an account that has no access.
- Records and backup stay outside System Control as requested.

## Schedule and lockouts (second part, 2026-11-02)
Migration `20261102120000_system_control_schedule_and_lockouts` (applied, live `20261102031428`, verified). No Edge Function change.
- **Maintenance schedule** (System Control > Maintenance & isolation > Scheduled maintenance, pop-up form, Manila time). A window (5 minutes to 24 hours, up to 30 days ahead, no overlap, at most 10 waiting) switches maintenance ON by itself at the start with the message and return time, and OFF at the end. `apply_maintenance_windows()` runs every minute from a new pg_cron job `buildtrack-maintenance-windows` (your existing `send-notification` job is untouched). Safety rules: it never overrides maintenance a Super Admin switched on by hand (the window is marked "Not applied"), it switches off only what it switched on itself (a hand-made change during the window is left alone and noted), a window that was missed completely is skipped and never switched on late, running it twice changes nothing. Cancel a waiting window, or "End now" for a running one. Every step is audited (`maintenance.schedule`, `.scheduled_on`, `.scheduled_off`, `.schedule_cancel`) and appears in the Activity log. The page warns if the scheduler job is not active.
- **Lockouts tab** (read only): locked sign-up / reset codes (5 wrong tries), invitation-code lockouts (8 wrong in an hour) and blocked Google sign-ins (7 days), with a one-line verdict. Wrong passwords at sign-in are kept by Supabase Auth, not by BuildTrack, so they are not here (Supabase Dashboard > Authentication > Logs).
- **Sidebar**: System Control is the only menu entry for these tools. System health and Site controls were already removed from the menu in the first part (their old addresses open System Control). Nothing else in the sidebar duplicates System Control: Announcements & messages still sends messages to people, Company audit log is the full audit trail (the Activity log is only its system subset), Records and Full backup & export stay outside by decision.
- Tests: `pnpm test:sql` 695 cases (new `zzzzzzzzzz-system-control-schedule.cases.mjs`: permissions, validation, start / end / idempotence, hand-made maintenance protected, missed window skipped, cancel and end now, lockout lists), `pnpm test:system-control` extended (Manila time conversion, the same limits as the database, lockout verdict).
- Rollback and switch-off: block at the end of the migration; `select cron.unschedule('buildtrack-maintenance-windows')` stops the scheduler; maintenance a window left on is switched off the usual way (System Control, or Switch everything off).
- Not seen in a signed-in browser: the Schedule form, its pop-ups and the Lockouts tab (tests, type-check and build only).

## Admin menu rearranged and System Logs (third part, 2026-11-02)
Only the menu and where pages live changed; every page, button and rule inside them is the same page as before. One small read-only migration: `20261102140000_system_logs` (applied, live `20261102041122`).

| Menu group | Entry | What it holds |
|---|---|---|
| Overview | Company dashboard | as before |
| Projects | All projects | as before |
| People & access | User management | as before (All users, Review queue, Access requests, Whitelist, Permissions) |
| People & access | **Access & messages** (new) | tabs **Invitations**, **Global access review**, **Announcements & messages** (the three old pages) |
| Company | **Company Records and Audits** (new) | tabs **Company audit log**, **Records** (Super Admin) |
| Company | Biometric management | as before |
| Company | **Company Configuration** (was System settings) | its five tabs plus **QC checklist library** (was its own page) |
| System | System Control | Health, Maintenance & isolation, Forced logout, Announcement banner, Email (the pause switch), Registration, Role access |
| System | **System Logs** (new, Super Admin) | **Transactions**, **Email delivery**, **Lockouts** |
| System | Full backup & export | as before, moved here |

13 entries became 10. A tab appears only for someone with its permission (Invitations: Review access requests; Global access review: View users; Announcements & messages: Edit users; Company audit log: View users; Records, System Control, System Logs: Super Admin). Every older address (/admin/invites, /access-review, /communications, /audit-log, /records, /qa-checklists, /system-health, /site-controls) still opens, on the tab that now holds it, and lights up the entry that holds it. Inside a tab a page keeps its header, description and buttons as a compact sub-heading, so each page still has one main heading.
- **System Logs > Transactions**: the administrator and system transactions of the audit log (account creation, approvals, role and status changes, suspensions, permissions, Google registration and blocks, settings, system controls, banner, emails, project and record removals, migrations), each with a reference (LOG-00042), time, who, to whom and what; category filter (Accounts & access, System controls, Projects & records, Other), search, Manila date range, paging, and a pop-up with everything recorded. Plain work-table changes (pins, QA steps, plans, attendance: 294 of the 347 entries today) are not listed here; they stay in Company Records and Audits, which is the unchanged full audit log. `get_system_log` is Super Admin only, read only, and replaces an oversized detail with a marker.
- **Moved out of System Control** into System Logs: the Activity log (now the Transactions tab), the sent-emails table (Email delivery; the pause switch stays in System Control > Email) and Lockouts. The older `get_system_activity` function is left in place, unused.
- Tests: `pnpm test:sql` 698 cases (new `zzzzzzzzzzz-system-logs.cases.mjs`), `pnpm test:system-control` extended (tabs by permission, old addresses, categories, wiring), `test-role-separation` stub updated. Not seen in a signed-in browser.
