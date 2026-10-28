# 2026-10-28 Blueprint types and per-type access

Plans are now browsed and secured by blueprint type. Migration: `20261028130000_blueprint_type_access.sql` (applied 2026-10-28 by the owner; details in `sql/20261028130000_blueprint_type_access.md`).

## What changed

- Navigation: Project > Blueprints > type cards (only types that have plans; name, plan count, the person's access; "Upload plan" picks the type of a new plan) > the type's plans > viewer / editor. `components/SelectedProjectWorkspace.tsx` (all roles, `?btype=` keeps the type), `components/EditorForSelectedProject.tsx` (deep links still open the editor), `components/editor/BlueprintEditor.tsx` (`blueprintType` filter, per-sheet edit / upload / report rights, a pin link on another type switches the type).
- Uploads belong to the selected type (`BlueprintUploadDialog`; revisions keep their plan's type, pins, assignments and history). Older sheets without a type become Civil / Structural (no Unclassified group); Admins with Blueprints permission can change any plan's type from its card.
- Admin Project Management: card actions Details / Team & access / Blueprints / Delete; the project form is grouped (Project, Schedule, people, scope, site) with one control height and a single column on phones. `pages/Admin/ProjectAccessDialog.tsx`: step 1 project team (add / remove, role, access summary), step 2 blueprint access (table on desktop, one card per person on phones, "Set every type", confirmations before anything is taken away).
- Foreman pickers in the editor only offer Foremen with Assigned work on the sheet's type (`TeamMember.can_take_work`).
- Pure rules: `lib/blueprintTypes.ts` (tested: `pnpm test:blueprint-access`); data: `lib/blueprintAccess.ts`. Activity feed labels for access changes in `lib/admin.ts`.

## Tests

- `pnpm check`: type-check, all model tests, `test:sql` 508/508, build.
- `pnpm test:load`: unchanged for people holding every type; new rows for an Engineer holding one of two types (correct halves, no slow path).
- Layout checked in headless Chrome at 1440 px and a real 390 px viewport (temporary `src/dev` demo, deleted).
- Test fixture: `supabase/tests/harness.mjs` grants every type to new members and defaults new sheets to Civil / Structural for the older suites only; the new strict suite switches both off. `20-blueprints` storage test now uploads into a real sheet folder.
