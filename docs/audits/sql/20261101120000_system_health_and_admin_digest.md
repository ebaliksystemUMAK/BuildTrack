# System health, email test limits and daily admin digest

| Field | Value |
|---|---|
| File | `supabase/migrations/20261101120000_system_health_and_admin_digest.sql` |
| Written | 2026-11-01 Manila |
| Status | **APPLIED** 2026-11-01 via the connector, live version `20261101052156`, verified (privileges as designed, new tables unreadable by the API, record counts unchanged). The `system-health` Edge Function is still NOT deployed and nothing is scheduled |
| Dependencies | `20261101090000_admin_communications` (notification preferences columns), 0028 email queue |
| Reversible | Yes, additive; drop statements at the end of the file |

Additive only. Nothing is scheduled, sent or deleted by this file, and no existing function, policy or table is changed (the one existing table gets one new column).

| Object | What it is |
|---|---|
| `notification_prefs.email_admin_digest` | New, `not null default true`. Whether the person gets the daily admin summary at all. Column grants re-stated to include it (a person can set only their own row). |
| `get_system_health(jsonb)` | Read-only report for a Super Admin with MFA: database answer, migration history names (when the history table exists), the checklist the screen sends (tables, functions, columns, buckets: names are validated, at most 400), storage buckets with public flag and file count, email queue counts, scheduled jobs (name, schedule, active flag and the last run only; **the command is never read**), digest runs, last email tests. Never returns a secret or a file name. |
| `email_test_log`, `begin_email_test(uuid)`, `finish_email_test(...)` | Service-role only. At most 3 test emails an hour and 10 a day per Super Admin; refuses anyone who is not an active Super Admin. |
| `digest_runs`, `admin_digest_content(uuid)`, `generate_admin_digest(date)` | Service-role only. Builds, for each active Super Admin / Admin who has not opted out, a summary of real records they may act on (decisions need `users.approve`, projects need `projects.manage`, delivery problems are Super Admin only) and creates one notification `digest.admin` with the unique key `digest:YYYYMMDD`, so a retry or an overlapping run creates nothing twice. Every call is logged in `digest_runs`; a failure is logged with its message and its partial work is undone. Empty digests are never created. |
| `preview_admin_digest()` | Super Admin dry run: who would be told what. Creates and logs nothing. |

Not changed: `notify_user`, `claim_email_batch` / `mark_email_result` (the digest rides the existing queue; its kind `digest.admin` is an ordinary "activity" email, so the master email switch and the daily cap apply).

## Before running
1. `get_project_url` must be `https://ruimjlhsfpaezkgfphsz.supabase.co`.
2. `pnpm test:sql` passes (613 cases including `zz-health-digest.cases.mjs`).
3. Nothing is deleted, so no backup is needed beyond the normal one.

## Verification queries (read-only, after running)
```sql
select table_name, column_name, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'notification_prefs' and column_name = 'email_admin_digest';
select count(*) as prefs_total, count(*) filter (where email_admin_digest) as digest_on from public.notification_prefs;
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('service_role', p.oid, 'execute') as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
   and p.proname in ('get_system_health','preview_admin_digest','generate_admin_digest','admin_digest_content','begin_email_test','finish_email_test') order by 1;
select has_table_privilege('authenticated', 'public.digest_runs', 'select') as digest_runs_readable, has_table_privilege('authenticated', 'public.email_test_log', 'select') as email_test_log_readable;
select (select count(*) from public.digest_runs) as digest_runs, (select count(*) from public.email_test_log) as email_tests, (select count(*) from public.notifications where kind = 'digest.admin') as digest_notifications;
```
Expected: `anon` false for all six; `authenticated` true only for `get_system_health` and `preview_admin_digest`; `service_role` true for all; both table checks false; the last query returns 0, 0, 0 (nothing has been generated or sent).

## Switching the digest on (owner, after approval; the migration does not do this)
Needs the Supabase **Cron** integration (not installed today). Once installed, run once in the SQL editor:
```sql
select cron.schedule('buildtrack-admin-digest', '0 0 * * *', $$select public.generate_admin_digest()$$);  -- 00:00 UTC = 08:00 Manila
-- switch it off again:
-- select cron.unschedule('buildtrack-admin-digest');
```
The System health page shows the last run, failures and whether the job is late.

## Rollback
The comment block at the end of the migration. If the digest was scheduled, run `cron.unschedule('buildtrack-admin-digest')` first.
