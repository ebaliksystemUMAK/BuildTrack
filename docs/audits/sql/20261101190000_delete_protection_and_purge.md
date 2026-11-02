# Delete protection and Super Admin-only permanent deletion

| Field | Value |
|---|---|
| File | `supabase/migrations/20261101190000_delete_protection_and_purge.sql` |
| Applied | 2026-11-01 via the connector, live version `20261101081428`, verified |
| Dependencies | `20261101180000_project_recycle_bin` (applied first), the existing evidence-lock triggers |
| Edge Function | `purge-project` v1 (deployed, `verify_jwt` on) |
| Reversible | Yes, rollback block at the end of the file. Nothing is deleted or rewritten by the migration |

## What it does
| Object | Effect |
|---|---|
| `pin_has_records`, `pin_has_work` | Internal tests. Records = inspections, defects, QA attempts / submissions, site issues, client reports, questions. Work = status beyond Not started, progress / photo / checklist / comment events, photos, ticked or remarked checklist items, linked daily reports. |
| `pins_work_lock` (before delete on `pins`) | A pin with records cannot be deleted by anybody signed in. A pin with work only by a Super Admin. It also runs when a sheet is deleted (cascade), so an Admin deleting a sheet cannot erase pins with work. |
| `pin_checklist_items_work_lock` | A ticked, remarked, reviewed or photographed checklist item can only be deleted by a Super Admin. |
| `qa_photos_evidence_lock` | QA photos cannot be removed once the inspection is passed / conditional / failed / cancelled or the defect is sent for verification / closed (adds the "for verification" case to the existing lock). |
| Three foreign keys (`daily_reports`, `client_snags`, `project_questions` author) | `on delete restrict` instead of cascade: deleting an account can no longer erase that person's reports. Privacy erasure anonymises and is unaffected. |
| `revoke delete ... from anon` | On the ten work tables (no policy ever allowed it). |
| `project_contents` | Replaced: same keys plus `pins_with_work`, `attendance_workers`, `devices_total`. |
| `project_purge_check`, `preview_project_purge`, `purge_project_rows` | Permanent deletion of a REMOVED project: Super Admin with the authenticator; at least 30 days in the bin; refused while the project holds evidence pins, pins with work, inspections, defects, site issues, client reports, questions, daily reports, photos, biometric scans, attendance workers or devices. `purge_project_rows` is service role only (called by the Edge Function). Audit: `project.purged` with who, when, the removal reason and what the project held; the generic `projects.delete` row also keeps the project row. |

The backend (no signed-in user: devices, jobs, the purge function, the SQL editor) is never restricted by the three delete guards.

## Verification queries (read-only)
```sql
select tgname, tgrelid::regclass from pg_trigger where not tgisinternal and tgname in ('pins_work_lock','pin_checklist_items_work_lock','qa_photos_evidence_lock');
select conname, confdeltype from pg_constraint where conname in ('daily_reports_author_id_fkey','client_snags_author_id_fkey','project_questions_author_id_fkey');   -- expected: r (restrict)
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('service_role', p.oid, 'execute') as svc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('preview_project_purge','project_purge_check','purge_project_rows');
-- expected: preview_project_purge auth=true; the other two auth=false, svc=true
select count(*) filter (where deleted_at is not null) as removed from public.projects;
```

## Permanent deletion when the screen is unavailable (owner, SQL editor)
The SQL editor is the backend, so these guards do not apply to it. Use it only after checking the project in the recycle bin and keep a backup:
```sql
select public.project_purge_check('<project id>');       -- ok must be true
-- then delete the project's plan files in Storage (bucket blueprints, folder <project id>) and:
-- delete from public.projects where id = '<project id>';
```

## Rollback
The comment block at the end of the migration. Drop the three triggers first.
