# Blueprint type access

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028130000_blueprint_type_access.sql` |
| Written / applied | 2026-10-28 / applied by owner in SQL Editor; missing schema_migrations entry reconciled 2026-10-28 after verification, without rerunning DDL |
| Depends on | 0003 projects/members, 0009 blueprints, 0010 pins, 0025 QA, 0036 RLS sets, 20261020072554 inspection owner trigger, 20261025141322 reinspection helpers |
| Status | `pnpm test:sql` 508/508 (16 new strict cases), `pnpm test:load` incl. a one-type-of-two Engineer |
| Reversible | Additive data (new column + table); dropping the restrictive policies and triggers restores the old project-wide rules. Keep `project_blueprint_access` rows and audit rows |

## Purpose

Plans are organised by type (Architectural, Civil / Structural, Electrical, Mechanical, Plumbing / Sanitary). An Admin gives each project Engineer / Foreman No access, View only or Assigned work access per type. Membership alone no longer opens every plan.

## Objects created or changed

| Object | Behavior |
|---|---|
| `blueprints.blueprint_type` (not null, 5 types) | Backfilled from `discipline`: architectural stays Architectural; civil_structural, `mep` and empty become Civil / Structural (owner, 2026-10-28: no Unclassified group). `discipline` itself untouched |
| `guard_blueprint_type` trigger | A sheet sent without a type (older app versions) is filed like the backfill, so uploads keep working during the deploy; fills an empty `discipline` from the type; only `blueprints.manage` changes a type |
| `project_blueprint_access` + RLS | (project, member, type) -> view / assigned. FK to `project_members` (leaving the project removes the grants). Staff of the project read it; no write policies |
| `set_blueprint_access(project, user, levels jsonb)` | `projects.manage` + MFA only; Engineer / Foreman members only; `none` deletes. Audited (`project_blueprint_access.*`, target = person, `before` on updates) |
| `blueprint_access_level`, `type_scoped`, `my_blueprint_grants`, `unrestricted_project_ids`, `scoped_*_ids`, `record_blueprint_scope` | Helpers; internal ones are not callable by API roles |
| 20 restrictive SELECT policies | Sheets, revisions, annotations, pins, pin events / photos / checklist, QA inspections / items / events, NCRs / events, QA photos, work attempts, submissions, site issues (+ photos, revisions), client reports (+ photos). Skip when the person holds every type the project uses |
| `guard_blueprint_type_work` (18 tables, BEFORE I/U/D) | Every Engineer / Foreman write, direct or inside any RPC, needs Assigned work on the row's type (project-wide QA rows: on any type). Work can only be handed to someone holding Assigned work on the type (`pins.assigned_to`, `qa_defects.assigned_to`, `qa_inspections.inspector_id` / `escalation_owner`) |
| `a_0_inspection_type_owner` | New inspection requests are routed to an Engineer with Assigned work on the type (lead Engineer first); clear refusal when none exists |
| `release_revoked_type_work` | A Foreman losing Assigned work on a type hands back open (not completed) pins of that type, like leaving the project |
| 4 restrictive storage policies | `blueprints`, `pin-photos`, `issue-photos`, `qa-evidence` files follow their sheet / pin / inspection / NCR folder |
| `notify_user` | Typed notifications only reach Engineers / Foremen with Assigned work on that type |
| `generate_escalations`, `get_pin_timeline`, `get_sheet_history`, `get_qa_summary`, `qa_reinspection_context`, `qa_ncr_reinspection_state` | Same narrowing inside these definer functions |
| `backfill_blueprint_access()` (run once) | Transition, see below |

## Transition (owner decision 2026-10-28)

- Existing Engineer / Foreman members keep today's access: Assigned work on every type their project already has sheets in. Live data at writing: 3 Engineers + 3 Foremen on 2 projects; all 5 sheets become Civil / Structural (dry run 2026-10-28: "L03" and "2 STORY FLOOR" had no discipline; no MEP sheets). Every grant is in the audit log (actor empty = migration).
- There is no Unclassified group (owner decision 2026-10-28). An Admin with Blueprints permission can move any plan to another type from its card.
- New members, and the Engineer / Foreman in charge set on a project, start with No access.
- Clients and Admins are not type-restricted (Clients still read every plan of their projects; Admins keep their permissions).

## Not narrowed (project-level by design)

Daily reports, site visits, attendance, project questions, QA templates and project-wide (pin-less) stage inspections stay project-level. Boolean helpers (`pin_has_evidence`, `pin_qa_*_problem`) answer yes/no for a known pin id only.

## Verification

`supabase/tests/99-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-blueprint-type-access.cases.mjs` (strict mode: no legacy fixture). Older suites run with a test-only harness fixture that grants every type to new members (they predate per-type access); the parity test still matches 0036 counts.

## Deploy

Already deployed. On 2026-10-28 all 29 function bodies matched the local file, with 18 write guards, 20 data-read policies and 4 storage policies present. Only the missing history entry (20261028130000) was added; no DDL or transition backfill was executed again. The 5 existing sheets and 6 access grants were preserved. The steps below describe the original deployment, not instructions to rerun it.

1. Apply this migration (connector, after `get_project_url` check) and deploy the frontend. Order no longer matters for uploads (sheets sent without a type are filed automatically), but Team & access and the type browser need both.
2. Read-only checks: grants created = members x types in use; `select count(*) from blueprints where blueprint_type is null` = 0; advisors (security).
3. Admin: review Project Management > Team & access per project and tighten the transitional grants; move any plan that is not Civil / Structural to its type.
