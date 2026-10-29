-- BuildTrack: add the Project Manager role (part 1 of 2).
-- Postgres cannot use a new enum value in the same transaction that adds it, so this is its own migration;
-- the project_manager_workspace migration uses it. A Project Manager runs the day-to-day operations of the projects an
-- Admin assigns to them (team, blueprint access, details, schedule, monitoring). Company administration stays with Admins.
-- Details: docs/audits/2026-10-29-project-manager-role.md

alter type public.app_role add value if not exists 'project_manager';
