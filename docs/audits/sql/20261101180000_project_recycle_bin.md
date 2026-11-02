# Project recycle bin

| Field | Value |
|---|---|
| File | `supabase/migrations/20261101180000_project_recycle_bin.sql` |
| Written | 2026-11-01 Manila |
| Status | **APPLIED** 2026-11-01 via the connector, live version `20261101081342`, verified (all table fingerprints identical, 0 removed projects, privileges / triggers / policies as designed). Extended by `20261101190000_delete_protection_and_purge` (permanent deletion, Super Admin only) |
| Dependencies | `set_project_archived` (archive), `has_permission`, `display_name`, the access helper functions it replaces, `notifications`, `project_members`, `site_visit_requests`, `attendance_concerns` |
| Reversible | Yes: restore every removed project, then the rollback block at the end of the file |

Nothing is moved, rewritten or deleted by this file, and no existing project changes state. With no removed project, every read and write behaves exactly as before.

| Object | What it does |
|---|---|
| `projects.deleted_at / deleted_by / deleted_reason` | Who removed it, when and why (reason 5-300 characters). Null for every project today. |
| `project_is_removed(uuid)` | True for a removed project. Used by the policies below. |
| Nine access functions (`can_view_project`, `viewable_project_ids`, `is_project_member`, `is_project_manager`, `is_project_client`, `can_edit_blueprints`, `can_report_on_project`, `can_work_on_pin`, `manages_open_project`) | Replaced with the same bodies plus "and the project is not removed". |
| Restrictive SELECT policies on `projects`, `project_members`, `site_visit_requests`, `attendance_concerns`, `notifications` | Hide the rows that do not read through those functions. Restrictive policies only narrow. |
| `notifications_skip_removed_project` trigger | No notification is created about a removed project. |
| `projects_guard_bin` trigger | The three bin columns change only through the functions below (signed-in accounts); the SQL editor and service role are not restricted. |
| `projects_guard_hard_delete` trigger | A signed-in account can no longer `DELETE` a project directly. The SQL editor and service role can. |
| `project_contents(uuid)` | Internal: counts of what a project holds. |
| `preview_project_removal`, `remove_project`, `restore_removed_project`, `get_recycle_bin` | Admin with the Projects permission, or Super Admin, with the authenticator. Audited as `project.removed` / `project.recovered`. |

## Before running
1. `get_project_url` must be `https://ruimjlhsfpaezkgfphsz.supabase.co`.
2. `pnpm check` passes (643 SQL cases including `zz-recycle-bin.cases.mjs`, and the load test).
3. Nothing is deleted. Merge and deploy the new screens too: until then the live Delete button would hit the new refusal ("archive it, then move it to the recycle bin") and there is no screen for the bin.

## Verification queries (read-only, after running)
```sql
select count(*) filter (where deleted_at is not null) as removed, count(*) as projects from public.projects;            -- expected: 0, <your project count>
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
   and p.proname in ('get_recycle_bin','remove_project','restore_removed_project','preview_project_removal','project_contents','project_is_removed','guard_project_bin','guard_project_hard_delete','skip_removed_project_notification') order by 1;
select tablename, policyname, permissive from pg_policies where schemaname = 'public' and policyname like 'removed project%' order by 1;
select tgname from pg_trigger where not tgisinternal and tgname in ('projects_guard_bin','projects_guard_hard_delete','notifications_skip_removed_project') order by 1;
select (select count(*) from public.pins) pins, (select count(*) from public.project_members) members, (select count(*) from public.notifications) notifications, (select count(*) from public.audit_log) audit;   -- compare with the counts before
```
Expected: removed = 0; `anon` false for all; `authenticated` true only for the four screen functions and `project_is_removed`; five restrictive policies; three triggers.

## If a removed project must come back and the screen is unavailable (owner, SQL editor)
```sql
update public.projects set deleted_at = null, deleted_by = null, deleted_reason = null where code = 'THE-CODE';
```
It is still archived afterwards; un-archive it with the screen or `select public.set_project_archived('<id>', false)` as an Admin.

## Rollback
The comment block at the end of the migration. Restore every removed project first.
