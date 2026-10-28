# 2026-10-28 View only access in the QA screens

The database already refuses every QA action on a blueprint type held as View only (20261028130000) and sends those people no notification. The screens still showed action buttons by role, so a View only Engineer saw "IR-… is waiting to be inspected" and a Start inspection button that failed. UI only, no migration.

- `lib/blueprintTypes.ts` `recordLevel` (tested in `pnpm test:blueprint-access`): a record's level = its pin's plan type; a project-wide record takes the best level held; a hidden pin gives none (mirror of SQL `record_blueprint_scope`).
- `lib/qaWorkspace.ts`: `canActOn(record)`, `typeLabelOf(record)`, `holdsAnyWork`. Admins and Clients are unaffected.
- QA register (`QaView`, `QaPanels`): View only inspections / NCRs open read-only (no Start, Complete, Cancel, Verify, Edit, correction or re-inspection buttons), show a "View only" chip in the lists and a note in the dialog, and never appear in "needs your attention". Request / Raise NCR buttons need Assigned work on at least one type.
- Work item workspace: same via `usePinTypeAccess` (`lib/blueprintAccess.ts`).
- Sidebar badges (`lib/pinCounts.ts`): Engineers / Foremen count only sheets of types they hold with Assigned work (`scoped_blueprint_ids(true)`).

Verification: `pnpm check` (515 SQL, all model tests, build); dialog checked in headless Chrome with a temporary demo (deleted).
