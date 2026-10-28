# Return NCRs when their correction inspection is cancelled

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028084938_return_cancelled_reinspection_ncrs.sql` |
| Written / applied | 2026-10-28 / 2026-10-28 |
| Depends on | Existing cancellation permissions, item-return trigger and `verify_defect` |
| Status | Applied and live authenticated rollback smoke verified |
| Reversible | Disable trigger via a reviewed new migration only after preserving history and correction-retry workflow |

## Purpose / objects

Creates one private invoker function and an after-status-update trigger. For Requested/In progress → Cancelled, match correction attempt, exact inspection, project and pin, then return only For verification NCRs using existing checked rejection logic. The reason, audit and Foreman notification are retained; no finding is closed. No public RPC, new table or historical backfill.

## Security

Empty search path; public/anon/authenticated execute revoked. Existing Engineer cancellation, requester/stage permissions and submitted-work restrictions stay in place. `verify_defect` rechecks authorization and supplies canonical status/history. No RLS, evidence or storage changes; existing indexes support the joins.

## Verification / rollback

486 SQL cases, full application check/build, start/cancel UI tests and live rollback Start → Cancel → fresh correction → Pass flow passed. Existing fingerprints and security-advisor counts unchanged. To roll back, use a reviewed new migration to disable only the trigger, keep history and ensure cancelled packages still have a correction retry path. See [audit](../2026-10-28-ncr-start-and-cancel.md).
