# Project team role separation

| Field | Value |
|---|---|
| File | `supabase/migrations/20261031172653_project_team_role_separation.sql` |
| Written/applied | 2026-11-01 Manila |
| Status | Applied and verified |
| Dependencies | Project Manager workspace, blueprint type access, lead synchronization |
| Reversible | Restore earlier policy/RPC definitions in a new reviewed migration |

Regular Admins retain project management and primary/backup manager appointment. Assigned Project Managers operate project teams; Super Admin retains recovery authority.

| Object | Change |
|---|---|
| Three `manage memberships` write policies | Super Admin with active-account/MFA checks; existing PM open-project policies remain |
| `set_blueprint_access`, `assign_work_item` | Authorize assigned PM on open project or Super Admin |
| `guard_project_team_assignment` and project trigger | Guard automatic lead enrollment; allow legitimate nested lead cleanup |

The new trigger is security invoker with empty search path and revoked public/anon/authenticated execution. Existing RPC signatures/grants are preserved; authorization stays inside their definer bodies. Read policies, manager-appointment functions and biometric permissions are unchanged.

Verified: full application check, 566 SQL cases, standard load test, three deployed source-body hashes, policies/trigger/ACLs and unchanged security findings. Fingerprints for projects, memberships, manager assignments, blueprint grants, profiles and Admin permissions all match their pre-migration values. See [audit](../2026-11-01-project-team-role-separation.md).

Rollback in a new reviewed migration: restore the three membership policy predicates to `public.has_permission('projects.manage')`, restore `set_blueprint_access` and `assign_work_item` bodies from `20261029100000_project_manager_workspace.sql`, and remove the guard trigger only after reviewing the intended return of Admin lead-assignment authority. No data restoration is needed because this migration changes no stored assignments.
