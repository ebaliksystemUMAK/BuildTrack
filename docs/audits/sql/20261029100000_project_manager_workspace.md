# Project Manager role and workspace

Files:
- `supabase/migrations/20261029095839_project_manager_role.sql` (part 1: `app_role` value `project_manager`; its own migration because a new enum value cannot be used in the transaction that adds it)
- `supabase/migrations/20261029100000_project_manager_workspace.sql` (part 2: everything else)

Status: both parts APPLIED 2026-10-29, tracked as 20261029095839 and 20261029100000. Codex applied part 2 after the owner's request to apply Claude's pending migrations. The connector generated 20261029100943; its history row was reconciled to the existing file version 20261029100000 without rerunning the migration. Part 1 was already present and was not rerun.

Part 2 file SHA-256: `7049809fa0a30c6c468a9a34aeaeb288cbaf07d9f9da1dfc462d25131e9cb817`.

Change note: `../2026-10-29-project-manager-role.md`

## Purpose

Separate company administration (Admins) from project operations (Project Managers). Admins assign a primary and an optional backup Project Manager per project; a Project Manager may manage many projects and runs their details, team, blueprint access, sheets, work assignment, monitoring, reports and exports. Engineers keep inspection, verification and sign-off.

## Objects

- Tables: `project_managers` (PK project + user, unique project + designation `primary` | `backup`, audited by trigger, read-only to the API), `attendance_concerns` (read-only to the API).
- Columns: `projects.archived_at`, `projects.archived_by`.
- Helpers: `is_project_manager`, `manages_open_project` (not archived), `managed_project_ids`, `audit_project_key` (immutable, expression index `audit_log_project_key_idx`).
- RPCs (authenticated only): `assign_project_manager`, `remove_project_manager`, `get_project_managers`, `get_assignable_people`, `set_project_archived`, `assign_work_item`, `get_project_audit_log`, `flag_attendance_concern`, `resolve_attendance_concern`.
- Triggers: `project_managers_check`, `project_managers_audit`, `project_managers_touch`, `projects_guard_manager_edit`, `profiles_clear_manager_assignments`.
- Replaced (bodies verified identical to production before the change): `can_view_project`, `is_staff`, `get_project_team`, `can_upload_blueprints`, `guard_blueprint_type`, `set_blueprint_access`, `guard_pin_assignment`, `log_project_export`, `role_home`, `trg_notify_role_granted`, `create_invite`, `get_inactive_users`, `generate_escalations`.
- Policies: recreated `projects` "view assigned or managed projects", `project_members` "view own or managed memberships", `profiles` "project managers view assignable profiles" (now also lists Project Manager accounts to Admins with `projects.manage`); new `projects` "project managers update their projects", `project_members` "project managers add / remove team members", `project_managers` "read project managers", `attendance_concerns` "managers and admins read attendance concerns".
- Constraints: `invite_codes_assigned_role_check` and `whitelisted_emails_assigned_role_check` widened to include `project_manager` (existing rows still valid).

## Security

- Only `has_permission('projects.manage')` (Admin + MFA, or Super Admin) assigns, replaces, removes Project Managers and archives projects. No write grants on the new tables; `anon` has no rights on them.
- A Project Manager reaches only projects where they hold a slot with an active `project_manager` account; disabling the account cuts access at once; a role change removes every slot.
- Project Manager writes are limited to assigned, non-archived projects and to the listed columns; QA, inspection, verification, pin editing and every company-level function stay closed (proved in `99-…-project-managers.cases.mjs`).
- No data is deleted or rewritten by the migration.

## Verification

- `pnpm test:sql` 531/531 (16 new cases), `pnpm test:project-manager`, `pnpm check` and `pnpm test:load` pass locally.
- Before applying: `get_project_url` = `https://ruimjlhsfpaezkgfphsz.supabase.co`; md5 of the 13 replaced function sources (carriage returns removed) equal to the repository; the 3 replaced policies and 2 constraints exist; no new object existed.
- Codex re-ran `pnpm test:sql` (531 passed, 0 failed), `pnpm test:project-manager` (10 passed) and `pnpm test:load` before applying part 2. The 13 production function hashes still matched; the enum was present, and both new tables/archive columns were absent.
- After applying: all 30 function bodies match the file (carriage returns ignored); both tables have RLS and authenticated SELECT but no direct INSERT/UPDATE/DELETE, and no anon SELECT. All 5 named triggers and expected policies exist. Internal trigger functions are not callable by API roles; the 12 new definer helpers/RPCs are authenticated-only. `audit_project_key` is a pure, invoker, argument-only formatter and retains public EXECUTE; it reads no records.
- Existing counts stayed at 2 projects, 10 profiles, 7 memberships, 12 pins, 17 inspections and 12 defects. New assignments and attendance concerns both contain 0 rows. `role_home('project_manager')` returns `/pm/projects`; the canonical history entry is present.
- Security advisors: before 4 RLS info findings, 106 authenticated-definer warnings and 1 leaked-password-protection warning; after 4 / 118 / 1. The only additions are the 12 deliberately authenticated, permission-checked definer helpers/RPCs in this migration. No new advisory category. Reference: [authenticated SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Existing unrelated findings were not changed.

## Rollout

1. DONE: part 2 applied through the BuildTrack connector; read-only function/table/policy/trigger/grant/history checks and security advisors completed.
2. DONE in a follow-up task: `admin-users` deployed as ACTIVE v7 with Project Manager role/whitelist support and `verify_jwt=true`; deployed sources match the repository, unauthorized probes return 401, and CORS preflight returns 200. See `../2026-10-29-admin-users-deployment.md`.
3. UNVERIFIED: frontend deployment on Vercel (code pushed to GitHub as `8a711fe`). Then: give someone the Project Manager role, assign them in All projects > Managers, sign in as them and check My projects, details, team, blueprints, QA (read-only) and the audit log. No real account role or project assignment was changed during migration rollout or Edge Function deployment.
