# Daily report task entries

| Field | Value |
|---|---|
| File | `supabase/migrations/20261104120000_daily_report_task_entries.sql` |
| Applied | **APPLIED 2026-11-04**, owner-authorized connector migration `20261104053050_daily_report_task_entries`; live schema, grants and all four function bodies verified |
| Dependencies | `daily_reports`, `daily_report_photos`, `pins`, `pin_checklist_items`, `is_staff()`, `viewable_project_ids()`, `client_project_ids()`, `can_report_on_project()`, `can_work_on_pin()`, `is_active()`, `site_guard()` |
| Reversible | Yes: see the notes at the end of the file. Dropping the table loses the entries; reports keep `linked_work` |
| Audit | [2026-11-04-daily-report-task-progress](../2026-11-04-daily-report-task-progress.md) |

| Object | Effect |
|---|---|
| `daily_report_entries` | One row per task on a report: pin, task, percentage, notes, issues, manpower, materials. Select only, for the project team through the report's own visibility. Never Clients |
| `daily_report_photos.entry_id` | Optional link from a photo to an entry of its own report (`check_daily_photo_entry`). Set to null when the entry is removed; the photo stays |
| `save_daily_report(uuid, date, text, text, text, jsonb)` | Saves the caller's report and all its entries together, writes `linked_work` from them, then submits if asked. Authenticated only |
| `require_complete_report_entries` | Trigger on `daily_reports`: no submission while an entry has no percentage |
| `snapshot_daily_report` | Replaced: revisions also keep `task_entries`. Otherwise the same as `20261018124654` |

## Deployment preflight (completed)
Confirm the hosted `snapshot_daily_report` still matches `20261018124654`, because this migration replaces it:
```sql
select pg_get_functiondef('public.snapshot_daily_report'::regproc);
```
Read-only check on 2026-11-04, project `ruimjlhsfpaezkgfphsz`: the function matched, none of the new objects existed, maintenance was off, and the database held 4 reports (1 draft), 5 photos and 3 revisions. Security advisors: 4 existing findings. Repeat this if time has passed.

The initial apply was refused by the Claude Code permission check. The owner subsequently authorized deployment in chat; Codex applied it through `apply_migration` as `daily_report_task_entries`, live version `20261104053050`. This is recorded in hosted migration history. Do not rerun it or use `supabase db push`: hosted versions differ from these file names.

Post-deployment verification: RLS enabled; authenticated INSERT denied and SELECT subject to the report/team policy; anonymous save denied; trigger helpers not executable by API roles. The four function bodies match the tested file. All existing data fingerprints remain identical (4 reports, 5 photos, 3 revisions, 12 pins, 10 tasks; photos compared excluding the new nullable `entry_id`). No report entries were fabricated. Full `pnpm check` passes with 726 SQL cases; the 5,000-pin load test and focused Gantt checks pass. Security-advisor differences across both new migrations are the intended three private Gantt tables without read policies and seven checked authenticated RPCs; anonymous exposure and existing auth warning are unchanged.

## Verification queries (read-only)
```sql
select relrowsecurity from pg_class where oid = 'public.daily_report_entries'::regclass;  -- expected true
select has_table_privilege('authenticated', 'public.daily_report_entries', 'insert');  -- expected false
select has_function_privilege('anon', 'public.save_daily_report(uuid,date,text,text,text,jsonb)', 'execute');  -- expected false
select tgname from pg_trigger where tgrelid = 'public.daily_report_entries'::regclass and not tgisinternal;  -- expected zz_site_guard
```
