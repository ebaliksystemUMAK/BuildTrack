# Automatic package NCR closure on reinspection sign-off

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028081041_auto_close_reinspection_ncrs.sql` |
| Written / applied | 2026-10-28 / 2026-10-28 |
| Depends on | Full-checklist reinspection, exact finding readiness and existing `verify_defect` |
| Status | Applied and live authenticated rollback smoke verified |
| Reversible | New migration may disable trigger; preserve closure/audit history and restore a safe manual path first |

## Purpose and objects

One private invoker function and an after-status-update trigger close exact linked package NCRs at authorized inspection sign-off, not on individual unsigned Pass selection. Pass readiness reuses the original guard. N/A returns for correction; failure processing remains in `complete_inspection`. Inspection Remarks are included in generated closure/rejection notes. No new RPC signature or table/column is introduced.

## Security

The helper checks project authorization and actual inspector, uses an empty search path and has no public/anon/authenticated execution grant. It runs inside the existing checked transaction, using `verify_defect` for closure history, notifications and authoritative guards. RLS and existing API grants are unchanged. No signed-off history is rewritten.

## Verification and rollback

Full application check/build, 484 SQL cases including the historical backfill tests, private-invoker/grant checks and live rollback smoke passed. Security advisors unchanged. Rollback should disable only this trigger via a new approved migration, retain all recorded history, and restore a safe decision workflow. See [audit](../2026-10-28-automatic-ncr-closure.md).
