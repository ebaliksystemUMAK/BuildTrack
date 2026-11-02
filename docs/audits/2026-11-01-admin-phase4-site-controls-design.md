# 2026-11-01: Admin phase 4 design (maintenance mode, forced logout, feature isolation) and its risks

Written BEFORE the code, as asked. Nothing in this phase is applied to the live database or deployed; everything starts switched off.

## What the system already does (reviewed)
- Sign-in, sign-up, password reset and sessions belong to Supabase Auth. The database never sees them, so nothing in this phase can stop a person signing in.
- Most writes are made by `SECURITY DEFINER` functions (`report_pin_progress`, `submit_*`, `request_inspection`, ...). Those bypass row-level security, so **RLS cannot enforce a pause**; a restrictive policy on a table would miss every RPC write.
- The offline queue (`offlineQueue.ts`) retries only dropped connections; any server refusal marks the saved item **failed**. A pause would therefore wrongly mark every queued report and photo as failed unless the queue learns a "paused, try later" answer.
- Biometric devices call Edge Functions (`biometric-attendance`, `biometric-enrollment`, verify_jwt off, device tokens) that write with the **service role**: no signed-in user.
- `signOut()` does not touch IndexedDB, so the offline queue survives a sign-out and resumes when the same person signs in again.
- `revoke_user_sessions(uuid)` (service role) removes refresh tokens and sessions. An access token (JWT) already issued stays valid until it expires (Supabase default 1 hour); only the account status stops the database serving a person at once.
- The app re-reads the profile every 30 seconds.

## Design
| Control | Enforcement | Who is affected | Never affected |
|---|---|---|---|
| Maintenance (read-only) | A statement trigger `zz_site_guard` on the work tables refuses INSERT / UPDATE / DELETE with error code `BT503` and a readable message. It runs for RPC writes too. | Signed-in accounts that are not Admin or Super Admin. | Sign-in, recovery, reading, Admins and Super Admins (their own MFA session), the service role (devices, scheduled jobs, Edge Functions), notifications, profile, privacy, access requests, identity, audit. |
| Feature isolation | The same trigger with a feature key: `quality`, `daily_reports`, `blueprint_editor`, `client_reports`, `site_issues`, `site_visits`, `attendance`. | The roles chosen for that feature. | Everything outside that feature's own tables (pins, notifications, other features), Admins, the service role. |
| Forced logout | One database function removes the sessions of the chosen non-admin accounts and stamps `profiles.force_logout_at`; the app signs the person out within about 30 seconds. | Active non-admin accounts you choose by role (and optionally project). | Admins, Super Admin, yourself, suspended accounts. |

Fail-safe defaults: with no row or an error the guard allows the write (a broken control must never lock people out). Maintenance and every feature lock are OFF after the migration.

## Risks you should know before the migration is applied
1. **The guard lists tables.** A work table not on the list is not paused. The list is in the migration and a test lists what is and is not guarded. New work tables need adding.
2. **It touches ~35 tables with a trigger.** It is a statement-level check of one tiny row and returns at once when nothing is switched on, but it is a broad change. Rollback is a loop that drops the trigger (in the migration).
3. **Pausing mid-work.** A person partway through a form sees the refusal message when they save. The app keeps queued items instead of failing them (queue change below), but a half-typed online form is not saved.
4. **Forced logout is not instant for an existing token.** Refresh tokens and sessions are deleted at once and the app signs the person out in about 30 seconds, but a token already issued can still call the API until it expires (up to an hour by default). To stop an account at once, suspend it (the database then refuses it immediately). This is stated on the screen.
5. **Offline evidence.** Signing out does not remove queued items. They stay on the device and send after the same person signs in again. During a pause the queue waits (every 5 minutes) without using up its attempts.
6. **Locking yourself out.** Admins and Super Admins are never blocked by either control. If the Super Admin's authenticator is unavailable, the switch-off SQL in the SQL document works from the Supabase SQL editor.
7. **A forgotten pause.** The return time is information only; maintenance stays on until switched off. The page and the strip say when the expected time has passed.
8. **Uploads.** A paused person can still upload a file to storage; the record that would point to it is refused, and the queue removes the orphan file (existing behaviour). Online flows leave the file unreferenced and invisible.
9. **Devices.** Scans, enrollments and any other service-role write continue during a pause; they are evidence and must not be lost. Manual attendance requests by people are paused only if the attendance feature is locked.

## Not done on purpose
No automatic maintenance, no automatic expiry, no mass notification of users, no change to Auth settings, no JWT lifetime change, no hosted action.

## What was built (2026-11-01)
- Migration `20261101150000_site_controls` (written, NOT applied): tables `site_controls`, `feature_locks`; guard `site_write_block` / `site_guard` with trigger `zz_site_guard` on the work tables; `get_site_status`, `get_site_controls`, `set_maintenance`, `set_feature_lock`, `preview_force_logout`, `force_logout`; column `profiles.force_logout_at`. Everything starts off. See `docs/audits/sql/20261101150000_site_controls.md`.
- App: Admin page `site-controls` (Super Admin only) with Maintenance, Feature isolation and Forced logout panels; notice strips on every page (`SiteStatusNotice`), per-page `FeatureLockNotice`; the app signs a forced account out locally without touching the offline queue; the offline queue treats `BT503` as a pause (kept, retried every 5 minutes) and `isNetworkProblem` no longer mistakes any `BT…` database code for a dropped connection.
- Tests: `pnpm test:site-controls` (queue with a fake IndexedDB, polling store, status, notices, forms, typed confirmation, sign-out rule, page) and `supabase/tests/zz-site-controls.cases.mjs` (decision matrix, real refused / allowed writes, service-role writes, excluded tables, forced logout scope, confirmation, audit, cooldown).

## Owner setup
1. Review and approve the migration; apply it through the connector after the usual gates.
2. Merge and deploy the frontend (until then nobody can switch anything on).
3. Try feature isolation on the role "Basic users" first; keep any maintenance test to under a minute.
4. Note the switch-off SQL in the SQL document in case the Super Admin's authenticator is unavailable.

## Applied (2026-11-01)
Phases 3 and 4 were applied through the connector after: project URL check, `pnpm check` green (631 SQL cases), file in `supabase/migrations/`, a read-only pre-check (no name collisions, all 33 guard tables present, no existing guard triggers) and a check that `revoke_user_sessions(uuid) -> integer`, `display_name(uuid)` and `is_super_admin()` exist. Live versions: `20261101052156` (system health and digest) and `20261101052258` (site controls). After: maintenance off, 7 feature rows all unlocked, 33 guarded tables, nobody has `force_logout_at`, the new tables are not readable by the API, function privileges as designed; profiles 11, notifications 143, audit_log 335, pins 12 and projects 2 are unchanged. Security advisors show only the expected patterns for the new objects (RLS on with no policy for server-only tables; `get_site_status` open to anon on purpose; signed-in RPCs that check Super Admin inside).
