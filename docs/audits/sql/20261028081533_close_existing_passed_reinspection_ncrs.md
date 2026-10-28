# Approved closure of existing passed package NCR findings

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028081533_close_existing_passed_reinspection_ncrs.sql` |
| Written / applied | 2026-10-28 / 2026-10-28 |
| Depends on | Finding-specific signed-off readiness and existing closure guard |
| Status | Applied with explicit owner approval; one existing NCR closed |
| Reversible | Do not blindly reopen closures; any correction needs review and an audited new migration |

## Purpose and data changes

The owner approved inclusion of already-passed NCR findings. This one-time, idempotent data migration matches For verification package NCRs to their exact correction attempt, project/pin, signed-off inspection and currently valid finding-specific Pass. It closes only those qualifying records. It records a generated note with IR/time/optional Remarks, the actual original inspector, a NULL system event actor and a Foreman closure notification. It does not backdate closure, change inspection/results/evidence or perform manual checklist completion.

Read-only preflight identified NCR-0005's own Pass in IR-0007. An unrelated failed check did not invalidate its valid Pass. Other failures stayed open. Post-apply verification confirms that single closure and automatic history entry. No generated identifiers are hardcoded in the migration.

## Security, verification and rollback

No schema, grants or RLS changes. The existing `full_ncr_closure` trigger rechecks readiness on the update. 484 SQL cases pass, including guarded selection, history preservation, NULL system actor, negative N/A case and idempotence. Existing inspection/result/submission fingerprints are unchanged. Do not blindly reopen the affected record; retain the audit trail and review any proposed correction. See [audit](../2026-10-28-automatic-ncr-closure.md).
