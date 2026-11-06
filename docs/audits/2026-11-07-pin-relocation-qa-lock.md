# Engineer pin relocation and QA locks

## Confirmed cause

The connected database log rejected a coordinate-only `PATCH public.pins` with `Awaiting Engineer inspection: complete or cancel the inspection before changing this work`, raised by `guard_work_qa_config`. The affected Bedroom 2 pin was unlocked, in `for_review`, with a pending task inspection. The browser discarded the returned message and displayed a generic permissions/lock error.

## Prepared fix

`20261106170159_allow_engineer_pin_relocation.sql` treats a coordinate-only move as marker layout metadata for an active project Engineer. It retains existing access, blueprint type, site controls and movement-lock checks and existing movement/audit records. Changing any additional work field still uses the original QA guards.

The migration also preserves task review state on position-only moves and excludes only marker coordinates when comparing frozen work snapshots for task completion, legacy verification and inspection resumption. Historical submission snapshots are not rewritten. Identity, assignment, criteria, evidence and explicit Engineer completion checks remain.

The frontend now preserves the actual database error on movement failures.

## Verification

- SQL migration and regression suite: 758 passed, 0 failed, including relocation during pending QA, unchanged submitted evidence and task state, movement history, locked-pin refusal, Foreman access refusal, and approval after relocation.
- TypeScript: passed.
- Canvas movement, cancellation, rollback and undo/redo checks: passed.
- Updated the stale schedule-reason test to check the existing 500-character upper bound; empty reasons have been allowed by the earlier optional-reason migration.

## Deployment status

The remote migration application was rejected by automatic approval review because it changes production QA-lock and evidence-comparison logic across multiple workflows. No remote migration was applied. Explicit user approval is needed before deployment; the local migration and frontend error-reporting fix are ready for review. A live transactional relocation check has not been run.
