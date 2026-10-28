# 0042 — checklist QA submissions

Status: **Already present in live Supabase**, verified 2026-10-18 and 2026-10-28. Prepared 2026-10-16; subsequent QA migrations supersede these original functions. Do not rerun this migration or its historical handover script.

## Historical owner action — do not rerun

Verify migrations 0001–0041 are present, then paste the entire [SQL Editor script](0042_checklist_qa_submission.apply.sql) once. It wraps the migration and tracking insert in BEGIN/COMMIT and ends with `NOTIFY pgrst, 'reload schema';`. Do not run both the migration and the handover script, and do not rerun if 0042 is already tracked.

Source: `supabase/migrations/0042_checklist_qa_submission.sql`.

SHA-256: `ee93e0967ad6304b7e2bf86d9aeef8f4cee71f33f9c95acc94f01068d22c6c36`

```sql
insert into supabase_migrations.schema_migrations (version, name, checksum)
values ('0042', 'checklist_qa_submission', 'ee93e0967ad6304b7e2bf86d9aeef8f4cee71f33f9c95acc94f01068d22c6c36');
```

The tracking insert is already included in the handover script; do not paste it separately after running that script.

## Changes

Adds Engineer-selected `pins.qa_template_id` and immutable, audited, staff-project-readable `pin_qa_submissions`. Adds atomic submit/return RPCs, evidence/configuration locks, inspection completion handling, and a strict verification gate. Existing stage inspection/reinspection implementations are retained behind checked wrappers. The previous progress RPC now accepts only ordinary In progress updates; old queued For review writes fail explicitly instead of skipping QA.

The last user requirement permits partial QA requests: completed items need evidence; unfinished items may remain open. A partial Pass cannot verify work. Existing photo stamps, storage RLS, identity/MFA, audit, NCRs, hold points, notification delivery and verified-progress calculations remain in place.

No live rows are backfilled or assigned invented criteria. Existing reviewed pins without a snapshot need Engineer return/configuration and Foreman resubmission. Existing verified pins remain historical verified records; reopening/changing them requires a fresh qualifying submission.

## Verification

Local full migrations/RLS suite: 330 passed. TypeScript, 85 library tests and production build passed. The handover is validated on a disposable PGlite database migrated through 0041, including its tracking checksum.

No live migration or multi-session/staging/browser test was performed. See [full audit](../2026-10-16-checklist-qa-submission.md) for changed files and limitations. Take a normal database backup before owner deployment; use a forward migration for any rollback so submitted inspection evidence is not lost.
