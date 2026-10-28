# Engineer NCR: direct Start inspection and working cancellation

## Changes

Package NCRs awaiting verification no longer have the body Open inspection action or Close window footer. Their footer uses Start inspection for a requested linked reinspection, Continue inspection when underway, or View inspection results when finished. Print/Edit and the header dismissal remain. The action invokes existing `qaActions.start` on the exact linked correction id (never the original failed inspection), refreshes canonical state and opens that inspection via the caller's callback or existing project-scoped QA deep link. Server failure never navigates as if start succeeded. Loading/missing/error states disable the action; active Engineer, duplicate-click and late-close navigation guards are retained.

Previously Cancel inspection put its reason form at the bottom of a long scrolled dialog. It now opens a focused confirmation with Cancellation reason, Keep inspection and Cancel the inspection. The handler requires at least 5 characters, guards repeated submissions, retains the input and displays an error on rejection, and disables dismissal during the submitted request. A concurrent completed inspection hides the stale cancellation dialog. Successful actions refresh canonical records; refresh failure is not misreported as a failed database write.

Cancellation already had checked RPC permissions and item-return handling, but correction-package NCRs remained For verification after their inspection was cancelled. The private invoker `return_cancelled_reinspection_ncrs` after-status trigger now returns only those exact linked NCRs to In progress through the existing `verify_defect(false)` path. It records the cancellation reason and notification, clears their submitted verification state and allows a fresh correction package. It never closes an NCR, changes unrelated/closed findings, deletes evidence or changes any completed result. Standalone and Foreman cancellation permissions remain unchanged.

## Verification / deployment

- Full `pnpm check` passed: TypeScript, app/model/component suites, 486 SQL cases and production build. Additional focused component checks cover visible server errors and Keep/header-close suppression while cancellation is pending.
- UI tests cover exact start id, start-before-navigation, canonical refresh, callback and deep-link opening, Continue/results without duplicate writes, disabled states/roles, server rejection, double-clicks and header-close race; cancellation modal, empty reason, Keep safety, trimmed exact payload, duplicate requests, failure retention, stale completion, pending dismissal and no manual NCR closure.
- SQL adds requested/in-progress cancellation tests, unauthorized start/cancel/private-helper denials, short reason rejection, exact inspector/start timestamp, repeated action guards, unchanged results/submission snapshots/closed findings, cancellation audit and fresh resubmission. Existing manual checklist and automatic Pass-closure tests still pass.
- `20261028084938_return_cancelled_reinspection_ncrs` applied to BuildTrack `ruimjlhsfpaezkgfphsz`, filename aligned to hosted version. No historical backfill or real inspection start/cancel performed.
- Authenticated live rollback smoke returned `NCR_START_CANCEL_RETRY_SMOKE_OK_ROLLED_BACK`: synthetic initial failure, correction/start, unsigned Pass, cancellation, NCR returned (not closed), new correction request, fresh Pass sign-off and manual checklist completion. Nothing retained.
- Existing row fingerprints unchanged: 12 NCRs, 17 inspections, 81 result rows and 17 submission snapshots. Security advisors unchanged (4 INFO, 94 existing function WARN, 1 existing Auth WARN). New helper is private invoker, empty search path, no anon/authenticated execution. No RLS/grant/storage expansion.
- No signed-in visual/browser acceptance test or commit/push performed.

Supabase guidance informed reuse of checked RPCs and verification; Postgres guidance informed least privilege and consistent NCR lock ordering. [Function security](https://supabase.com/docs/guides/database/functions), [existing advisor guidance](https://supabase.com/docs/guides/database/database-advisors).

## Rollback

Revert UI via a reviewed patch if needed. Disable the new trigger only via a new migration and after restoring a safe correction-retry path. Preserve all inspection, cancellation, NCR, evidence and notification history. No rollback executed.
