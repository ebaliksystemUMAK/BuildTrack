# Project team role separation

Implemented and verified 2026-11-01 against BuildTrack only (`ruimjlhsfpaezkgfphsz`).

The agreed responsibilities are now enforced in the interface and database:

- Super Admin: company oversight and recovery authority. Biometric management is hidden from the normal sidebar and command palette; the existing guarded route/components remain available for recovery, with active-account/MFA checks.
- Admin: biometric operations with the configured permission, project creation/edit/archive, primary/backup Project Manager appointment and team/access viewing.
- Assigned Project Managers: membership, blueprint access, project leads and work assignment on their open projects. Archived projects remain read-only; managers cannot appoint other managers.

Admin cards/forms show View team. The shared team/access dialog hides addition/removal/access-edit controls in read-only mode. Project saves omit lead IDs for regular Admins, preserving the PM's current choices. The project form explains who assigns leads. Dashboard onboarding uses actual active primary-manager assignments and the permission descriptions/help match the new workflow.

Migration `20261031172653_project_team_role_separation` changes the three existing Admin membership write policies to Super Admin recovery authority; the PM policies remain. `set_blueprint_access` and `assign_work_item` accept assigned PMs or Super Admin. A private invoker trigger guards automatic lead-field enrollment, while permitting internal lead cleanup after account disable/removal. Manager-appointment functions and biometric grants were not changed.

Verification:

- Full `pnpm check` passed: TypeScript, all frontend suites including new role-separation tests, 566 SQL cases, production build.
- Eight SQL cases cover Admin team/RPC/lead bypass denial, retained manager appointment and project editing, PM primary/backup and project/archive scope, Super Admin recovery/MFA, unchanged biometric permission checks, and internal disabled-lead cleanup.
- Existing team/access setup fixtures now use authorized Super Admin recovery operations. Their independent Admin project/upload and other role assertions remain; blueprint access denial expectations reflect the new authority.
- UI tests render the actual shell, team dialog and project page; verify menu hiding/direct recovery content, read-only display, retained manager buttons and lead-free Admin save payloads.
- Standard 5,000-pin load test passed through all migrations/triggers and RLS.
- Deployed three function bodies match tested sources. Trigger definition, three membership policies, empty search paths and execution grants verified. The invoker trigger is not callable by anon/authenticated; the two gated RPCs remain authenticated-only.
- Exact before/after fingerprints match for 2 projects, 7 memberships, 1 manager assignment, 7 blueprint grants, 11 profiles and 8 Admin permissions. No assignments or accounts were rewritten.
- Security advisor findings unchanged: 4 existing RLS-without-policy info findings, 120 existing authenticated-definer warnings and 1 existing Auth password-protection warning.

Local migration filename matches the hosted version. No Edge Function deployment was required; the frontend is included in the user's requested repository push.
