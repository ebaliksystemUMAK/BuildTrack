# 2026-10-29 Project Manager role and workspace

Company administration is separated from project operations. A new role, `project_manager`, runs the day-to-day work of the projects an Admin assigns to it, in its own workspace ("Project office"). Engineers keep inspection, verification and sign-off. Engineer, Foreman, Client, Admin and Super Admin behaviour is otherwise unchanged.

Migrations: `20261029095839_project_manager_role.sql` (enum value) and `20261029100000_project_manager_workspace.sql` (everything else) are both APPLIED and tracked as of 2026-10-29. Codex completed part 2 on the owner's request after the earlier declined call. Details: `sql/20261029100000_project_manager_workspace.md`.

## Permissions (database, enforced for the API as well as the UI)

- `project_managers` (project, user, `primary` | `backup`, one of each per project). Written only by `assign_project_manager` (assign, replace, swap) and `remove_project_manager`, which need `projects.manage` + MFA. Project Managers cannot assign themselves or change another Project Manager's slot: no write grants and no RPC path.
- `is_project_manager(pid)` (active account, role `project_manager`, holds a slot) is added to `can_view_project` and to the `projects` / `project_members` read policies; `is_staff()` includes the role. A Project Manager therefore reads staff data (QA, NCRs, evidence, site issues, attendance, daily reports) of assigned projects only and is never limited by blueprint type. Unassigned projects return nothing, including from RPCs (`get_project_team`, `get_assignable_people`, `get_project_audit_log`, `log_project_export`, `set_blueprint_access`).
- Writes, only on assigned projects that are not archived (`manages_open_project`): project details through RLS plus `guard_project_manager_edit` (dates, location, site point, client, description, phase, status, Engineer / Foreman in charge; code, name, scope, person in charge and archive are refused); team add / remove (`check_project_member` still allows only active Engineers, Foremen, Clients); `set_blueprint_access`; sheet upload, revision and type change (`can_upload_blueprints`, `guard_blueprint_type`); work reassignment through `assign_work_item` (same rules as the Engineer board: no notes, locked, for-review or verified work; the Foreman needs Assigned work on the sheet's type).
- Not opened: QA / inspection / verification RPCs, pin editing, checklist editing, sheet deletion, account approval, roles, suspension, biometrics enrollment / devices, system settings, company QA templates, company audit log, company-wide backup.
- Archive: `projects.archived_at` / `archived_by`, `set_project_archived` (Admins). Archived projects stay readable for their Project Managers; field roles are unchanged.
- Attendance concerns: `attendance_concerns` + `flag_attendance_concern` / `resolve_attendance_concern`; read by the project's Project Managers and Admins with `biometrics.manage` or `projects.manage`.
- Project audit log: `get_project_audit_log` over `audit_log` entries keyed to the project (`audit_project_key`, indexed).
- Accounts: `role_home` → `/pm/projects`; role-granted notice; invitations and whitelist may give the role; access review lists it; `admin-users` Edge Function accepts it (any Admin with the matching `users.*` permission). Self-service requests stay Engineer / Foreman / Client.
- Notifications: `project.manager_assigned`, `project.manager_removed`, `project.archived`, `project.restored`, `attendance.concern` (to Super Admins / Admins with biometrics and the other Project Manager), `attendance.concern_resolved`; serious late-work escalations (`generate_escalations`) also reach the project's Project Managers with a `/pm/dashboard` link.

## UI

- Follow-up requested by the owner: the Project Manager workspace is now exclusive to the `project_manager` role; Admin shortcuts and oversight mode described in the original rollout below were removed. Direct Admin/Super Admin `/pm/*` visits return to the Admin dashboard. Project creation, manager assignment and existing database administrative permissions remain available. See `2026-10-29-admin-workspace-separation.md`.

- Routing `/pm/<page>?project=` (`lib/projectRoutes.ts` `PM_PAGES`, `adminToPmPath`), `App.tsx`, `RouteGuard` (area `pm` for Project Managers and Admins with the Projects permission; a Project Manager opening an Admin project link is moved to the same place in the workspace). Persona `manager` (forest green, M6 block in `index.css`).
- `pages/ProjectManager/`: `PmShell`, `PmProjects` (My projects, archived section), `PmDashboard` (progress, S-curve, deadlines, reviews waiting, quality issues, team, recent activity), `PmDetails`, `PmTeam` (reuses `ProjectAccessDialog` and the Engineer `AssignmentBoard` in `pm` mode), `PmBlueprints` (sheets & revisions, mapping, version history, progress tracking: the Admin pages reused), calendar (`ProjectCalendarPage role="project_manager"`, all event kinds), `PmQuality` (`QaView readOnly`), `PmAttendance` (records, workers, concerns, attendance report), `PmReports` (progress, weekly, QA summary, attendance, daily reports, project-only export), `PmAuditLog`.
- Admin: navigation is company administration only (Company dashboard, All projects + "Project operations", User management, Invitations, Global access review, Company audit log, Biometric management, QA template library, System settings, Full backup & export). All projects gains Managers (`ProjectManagersDialog`), Archive / Restore and "Show archived"; the per-project view links to the Project Manager workspace; Full backup can export every project (data only).
- Data `lib/projectManagers.ts`; pure rules `lib/projectManagerModel.ts` (editable columns kept identical to the SQL guard, checked by the test).

## Tests

- `pnpm test:sql`: 531 cases (16 new in `99-…-project-managers.cases.mjs`: Admin-only assignment, isolation through tables and RPCs, allowed and refused edits, team and access, blocked company actions, blueprints, work reassignment, read-only QA and history, attendance concerns, escalations, archive, replace / swap / remove, disabled account and role change, accounts, existing roles unchanged).
- `pnpm test:project-manager` (10 model / route tests, added to `pnpm check`); existing `test:assignments` unchanged and passing.
- `pnpm check` passes (type-check, every model suite, SQL, build). `pnpm test:load`: Project Manager reads match Engineer reads (5,000 pins ~250 ms, NCR register ~22 ms, audit log 42 ms).
- Not done: browser check of the new screens (no browser tool in this session, and the live database does not have part 2 yet).

## Live database

- 2026-10-29: project URL verified; the 13 replaced function bodies match the repository exactly (compared without carriage returns: production copies installed from the SQL Editor use CRLF); the replaced policies and constraints exist under the expected names.
- `20261029095839_project_manager_role` applied (enum value only; harmless alone: nothing uses it and the deployed Edge Function rejects the role).
- `20261029100000_project_manager_workspace` applied by Codex after a fresh URL check, 531 passing SQL cases, 10 PM model tests, load test and matching hashes for all 13 replaced production functions. All 30 post-migration bodies, RLS, grants, triggers, canonical migration history and unchanged record counts verified. Security advisors added only 12 expected authenticated-definer findings for the gated new helpers/RPCs (4 info / 118 definer warnings / 1 existing auth warning total).
- Deployment of `admin-users` and the frontend remains outstanding; this task applied database migrations only. No existing account role or real Project Manager assignment was changed.
