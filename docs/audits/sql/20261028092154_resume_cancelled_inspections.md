# Continue cancelled QA requests

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028092154_resume_cancelled_inspections.sql` |
| Written / applied | 2026-10-28 / 2026-10-28 |
| Depends on | Work snapshots, concurrent checklist QA guards, cancellation NCR return and automatic NCR sign-off |
| Status | Applied; live rollback smoke and function privileges verified |
| Reversible | Restore requested-only start via a reviewed new migration and remove the continuation UI; preserve audit and already resumed records |

## Purpose / objects

Replaces only `start_inspection(uuid)` to support requested or cancelled requests. Cancelled work must still match its snapshot/current review request and have no newer draft. Stage requests cannot have newer replacements. The exact cancellation-return NCRs are checked/locked before restoring verification, then the inspection, submitted checklist lifecycle and history commit together. Results/evidence remain untouched. No backfill or automatic continuation.

## Security / performance

Existing project-Engineer authorization, SECURITY DEFINER with empty search path and authenticated-only execution remain. Parent pin/project locking matches submission ordering; checklist and NCR rows use deterministic lock order. Existing indexes and open-request triggers protect overlapping work. No RLS/storage policy or new API surface. Advisors unchanged.

## Verification / rollback

493 SQL cases plus UI regression/TypeScript/build pass. Live synthetic authenticated Cancel → Continue → Pass closes the NCR and leaves checklist completion manual; rolled back with unchanged real-record fingerprints. Rollback should use a reviewed new migration restoring requested-only start, never deleting cancellation/resume history. See [audit](../2026-10-28-continue-cancelled-inspections.md).
