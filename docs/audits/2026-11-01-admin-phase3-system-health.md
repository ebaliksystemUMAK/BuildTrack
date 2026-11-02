# 2026-11-01: Admin phase 3 (system health, email test, daily admin digest)

Branch `feature/admin-phase3`, not committed or pushed. One migration written (`20261101120000_system_health_and_admin_digest.sql`, see `sql/`), one new Edge Function `system-health` written and **not deployed**. No real email was sent and nothing was scheduled.

## Reviewed first
Existing: `ProjectHealth` (project progress, not system health), the notification + email queue (0028 and `20261101090000`), the `send-notifications` function and its setup note, the audit log. Not present: any system diagnostics, any scheduler (the live database has no Cron extension and no jobs), any migration comparison. The live checks showed: 9 storage buckets (`avatars` public, the rest private), a migration history table with 45 tracked migrations since 18 Oct 2026 and different names for the older numbered files, 143 notifications waiting to be emailed (email is not set up).

## A. System health (Super Admin, Admin > Company > System health)
Read-only; nothing repairs, re-runs or switches anything on; no secret, job command or file name is ever shown.

| Check | How |
|---|---|
| Database | The report answering is the connectivity check (a failure says what to try). |
| Migrations | Compared by name for the 46 migrations tracked since 18 Oct 2026 (`healthManifest.ts`, tested against the files). The older numbered migrations are **never** reported missing (they were run in the SQL Editor and are recorded under other names, or not at all); a missing record is only a warning that says it does not prove the schema is missing and never to re-run an applied migration. |
| Required schema | 10 features, each a list of tables, functions and columns that exist on the live database today; one result per feature naming exactly what is missing. |
| Storage | The 9 buckets exist; a private bucket that is public is a **problem**; `avatars` private is a warning; file counts shown. |
| Email settings | Yes / no only, read by the new Edge Function (mail key, valid sender, valid https app address, strong cron secret). If the function is not deployed the result is "cannot tell" with the action, and every other result still shows. |
| Email queue | Waiting, waiting over a day, sent / failed / skipped in 24 h. |
| Scheduled jobs | From Supabase Cron when installed: job name, schedule, active flag and last run status and message (the command is never read). Not installed is reported as "not set up", or a warning when emails are waiting. |
| Digest and email test | Last runs and failures. |

## B. Email test
Edge Function `system-health` (verify_jwt on): Super Admin with the authenticator only. The recipient is always the Super Admin's own address (never taken from the request), at most 3 tests an hour and 10 a day (database, `begin_email_test`), audited as `email.test`. The result keeps **"the provider accepted it"** apart from **"delivered"**: acceptance says "not confirmation that it reached the inbox"; a separate "Ask the provider" step reads the provider's events and only a delivered / opened / clicked event is shown as confirmed. The provider's answer is cleaned (keys, bearer tokens, markup, control characters, 200 characters). Written and tested against a mocked provider only.

## C. Daily admin digest
Per active Super Admin / Admin: one summary of real records they may act on (decisions need `users.approve`, projects without a primary Project Manager need `projects.manage`, delivery problems are Super Admin only); nothing is created when there is nothing to report. Opt-out: "Daily admin summary" in the bell menu (admins only; off = none, in the app or by email). Duplicate protection: one unique key per person per Manila day, so retries and overlapping runs create nothing twice (tested with two simultaneous runs). Every run is logged; a failure is logged with its message and its partial work is undone. Emails use the existing queue (master switch, daily cap, claim lease). The Super Admin can preview exactly what each admin would get (creates nothing).

## Limits and decisions
- Delivery of the digest, and any scheduled job, needs the owner to set up email and the Cron integration; this phase schedules nothing.
- "Confirmed delivery" depends on the provider's reporting (Brevo's transactional log). The lookup was written to its documented shape and is untested against the real provider.
- The migration check is name based; a future migration must be added to `healthManifest.ts` (a test fails if a listed name has no file, not if one is missing from the list).
- Cron job output is read only through `cron.job_run_details`; if the Cron schema is not installed the page says so instead of guessing.
- Found while testing: provider message ids contain angle brackets, which the general text cleaner strips; message ids now have their own strict check.

## Owner steps (nothing here was done for you)
1. Review and run the migration (or ask for it to be applied), then the verification queries in `sql/20261101120000_system_health_and_admin_digest.md`.
2. Review and deploy the new function: `npx supabase functions deploy system-health --project-ref ruimjlhsfpaezkgfphsz --use-api` (JWT verification stays on). Until then the page shows email settings as "cannot tell" and the test email as unavailable.
3. Email: follow `docs/BUILDTRACK_EMAIL_SETUP.md` (secrets, then the Cron job). Then send the test email from the page.
4. Digest schedule (only when approved): the one-line SQL in the page and in the SQL document.
5. Rollback: the comment block at the end of the migration; remove the digest job first if it was scheduled.

## Checks
`pnpm check` including the new `pnpm test:health` (roles, secret-free settings, redaction, mocked test email and delivery lookup, checklist against the migration files, every result status, the screen flows, the staged digest-switch fallback) and `pnpm test:sql` including `zz-health-digest.cases.mjs` (permissions, validation, objects, buckets, migration history and cron when present with no command leakage, queue counts, test limits, digest content per permission, dry run, creation, opt-out, duplicates and concurrency, failure logging, queue honouring the master switch, no direct table access).
