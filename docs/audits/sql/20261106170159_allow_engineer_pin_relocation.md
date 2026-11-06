# Prepared Engineer pin relocation

File: `supabase/migrations/20261106170159_allow_engineer_pin_relocation.sql`. Status: **pending explicit user approval, not deployed**. Depends on the existing work QA, snapshot compatibility and cancelled-inspection functions.

Purpose: treat coordinate-only moves as marker placement while preserving submitted evidence and approval state. See [the detailed audit](../2026-11-07-pin-relocation-qa-lock.md).

Objects: changes to `guard_work_qa_config` and `reset_changed_work_reviews`, plus narrowly checked coordinate exclusions in the existing completion, legacy verification and resume comparisons. Historical snapshots remain untouched. Access, locks, work identity, criteria and evidence checks remain in force.

Verification: the local SQL suite passed with 758 cases at preparation, and 762 after adding milestone deletion. Movement handler tests and TypeScript passed. No live relocation verification was performed because the deployment was blocked by automatic approval review.

Rollback: not applicable to the live database because this migration has not been applied. If approval is later given, retain the preceding function definitions for a separately reviewed rollback.

Limits: publishing this file to Git is not authorization to deploy it. Approval is still required before applying it to the connected database.
