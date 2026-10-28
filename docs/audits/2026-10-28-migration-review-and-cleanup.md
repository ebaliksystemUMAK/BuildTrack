# Migration review and approved cleanup — 2026-10-28

## Scope and decision

Reviewed CLAUDE.md, the current source, local SQL, migration history and live schema on BuildTrack only (`ruimjlhsfpaezkgfphsz`). The user approved cleanup and necessary migrations, then explicitly excluded obsolete/unnecessary migrations. No legacy migration was rerun.

The only missing current feature migration was `20261028150000_project_checklists.sql`. The current work-item editor sends cited standards but intentionally falls back without them against the old four-argument RPC. Its SQL supplies persistence, criteria-copy protection, safe orphan cleanup and source-link support for the already implemented checklist feature. It is not the older 0042 checklist submission migration and is unrelated to enabling blueprint access.

## Executed

- Verified the pinned project URL and passed all 515 SQL cases before deployment.
- Applied the existing, unchanged project-checklist SQL in one transaction with a cleanup candidate-set assertion, recovery backup, migration-history insert and PostgREST schema reload.
- Removed exactly two unused `LIVING ROOM / LIVING ROOM-PAINT` templates (IDs `7d3f4090-adb7-4b7b-ad14-d4a1c0cd88f9` and `8ed8d850-4d1b-4fe8-86aa-a9dd7a66fe14`) and four child criteria. Neither template was referenced by a pin, checklist item, inspection or submission. Counts: templates 18 → 16; criteria 101 → 97. No orphaned criteria copies remain; four used copies retained/flagged.
- Saved original template rows, criteria rows and the standards catalog in audit_log row **520**, action `migration.project_checklists_cleanup_backup`, for administrator recovery. These recovery records are not public files. Recovery requires a reviewed owner/admin SQL operation; do not undo evidence/history.
- Added seven documented official source links only where missing; existing codes, titles, order and custom source values retained.
- Reconciled history for already-installed `20261028130000_blueprint_type_access`: all 29 function bodies match local SQL, 18 write guards, 20 data-read policies and 4 storage policies present. Added the original history row and an audit event only; did not execute its DDL or access backfill again. Both versions now appear in schema_migrations.

## Verification

- Current checklist SQL: all five function bodies match the file; only one save-work-item signature (optional fifth standards argument). Authenticated-only RPC execution; three internal helpers denied to anon and authenticated; empty search paths retained.
- Authenticated synthetic live rollback smoke passes: old four-argument call, trimmed cited standards, replaced-copy removal, refusal to archive hidden criteria through library, Foreman denial and read-only Engineer denial. No smoke records remain.
- Six checklist-model cases and eight blueprint-access model cases pass. In-memory load test passes with 50 sheets, 5,000 pins, 14,000 timeline entries, 300 inspections and 500 NCRs through all current triggers/RLS; partial-type access returns only its 2,500 pins / 250 NCRs. Main Engineer pin read median 223.5 ms, partial-type read 102.3 ms; no live load data was written.
- Existing pin, inspection, result, submission snapshot, NCR and access-grant fingerprints unchanged. Existing five sheets and six access grants preserved.
- Security advisors unchanged: 4 no-policy INFO, 106 authenticated-definer WARN, 1 leaked-password-protection WARN. No new security finding.
- Supabase skill guided current documentation checks, schema/history reconciliation, explicit privileges, backup and live verification. No frontend implementation changes, account changes, commit or push.

## Old notes and runner warning

0041 daily-report evidence, 0042 QA submissions and 0043 Foreman selection objects already exist. Earlier “NOT APPLIED” handover notes are historical and were corrected/superseded in the current documentation. Old numeric filenames also differ from hosted timestamped migration history; do not treat all missing filename versions as pending.

Do not blindly run `pnpm db:apply`: its status path calls `ensureTracking()` (DDL) and compares exact numeric versions/checksums against hosted history, which has different legacy names/versions and no checksum column. Use the pinned connector plus schema/function verification for this database; comprehensive runner baselining is a separate task.
