# Daily report: work completed per task

| Field | Value |
|---|---|
| File | `supabase/migrations/20261104130000_daily_report_entry_work_done.sql` |
| Applied | **APPLIED 2026-11-04**, connector version `20261104064730_daily_report_entry_work_done`; source parity, column, grants and unchanged report/photo/revision fingerprints verified |
| Dependencies | `20261104120000_daily_report_task_entries` (live `20261104053050`) |
| Reversible | Yes: restore both functions from `20261104120000`, then drop the column. Dropping it loses the per-task text; report summaries keep what was built from it |
| Audit | [2026-11-04-daily-report-task-progress](../2026-11-04-daily-report-task-progress.md) |

| Object | Effect |
|---|---|
| `daily_report_entries.work_done` | Work completed on that task, up to 2000 characters. Default empty; no existing row changes |
| `save_daily_report` | Replaced with the same signature and rights. Accepts `work_done` and builds `daily_reports.work_done` from the tasks (`Pin → Task: text`, one per line, cut to 4000 characters). With no task text it keeps `p_work_done`, so older queued saves and reports without tasks are unaffected |
| `require_complete_report_entries` | Replaced: submission also needs at least 5 characters of work completed on every entry |

## Deployment
Applied through the connector as `daily_report_entry_work_done` after the owner-requested scheduling workflow was activated first. Both replacement bodies match local UTF-8 source; the generated summary uses the correct arrow character. The save remains authenticated-only and entry-table RLS remains unchanged. Existing four reports, five photos and three revisions have identical fingerprints; no entries were fabricated. Do not rerun this applied migration or use `supabase db push`: hosted versions differ from local file names.

## Verification queries (read-only)
```sql
select column_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'daily_report_entries' and column_name = 'work_done';
select has_function_privilege('anon', 'public.save_daily_report(uuid,date,text,text,text,jsonb)', 'execute');  -- expected false
select has_function_privilege('authenticated', 'public.save_daily_report(uuid,date,text,text,text,jsonb)', 'execute');  -- expected true
select md5(prosrc) from pg_proc where oid = 'public.save_daily_report(uuid,date,text,text,text,jsonb)'::regprocedure;  -- compare with the file
```
