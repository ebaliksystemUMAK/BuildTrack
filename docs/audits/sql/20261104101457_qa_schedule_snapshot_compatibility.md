# QA snapshots and schedule dates

| Field | Value |
| --- | --- |
| File | `supabase/migrations/20261104101457_qa_schedule_snapshot_compatibility.sql` |
| Applied | 2026-11-04, BuildTrack connector version `20261104102037_qa_schedule_snapshot_compatibility` |
| Depends on | `schedule_proposals_and_date_sync`, existing item and whole-pin QA functions |
| Topic | [Project Gantt timeline](../2026-11-04-project-gantt-timeline.md) |

The scheduling migration added `planned_start` and `due_date` to checklist items. Completion compared the entire current item against the immutable inspection snapshot, so old snapshots missing the keys—and approved date changes after newer snapshots—looked like changed evidence. Live DINING AREA / DINING-WALL had only a deadline difference plus the two absent date keys; its inspection was passed, linked NCRs closed, photo eligible and work-pin snapshot unchanged.

This additive fix excludes only those two scheduling columns on both sides of the existing item and historical whole-pin completion comparisons. Existing review metadata exclusions, permissions, locks, required passed inspection, closed NCRs, photo eligibility and work-pin/evidence/criteria comparisons remain in force. The migration does not update records or snapshots, complete work, change schedules or notify users. Engineer completion stays an explicit action.

Local regressions reproduce historical missing keys, changed modern dates, Engineer-only completion, immutable snapshots, retained evidence/criteria mismatch denial and the private legacy-helper ACL. See the topic audit for final verification and actual hosted migration version.

Verified hosted function hashes: `review_checklist_item` = `a8f305c5fdbe53e51596de26d5fb329e`; `legacy_pin_qa_verification_problem` = `e14673627f2c8c65c081d4eae33902b1`. Both retain fixed empty search paths. Anonymous execution is denied, authenticated execution is granted only on the checked review RPC, and the legacy helper remains private. Security-advisor categories are unchanged.

Fingerprints of all 25 submission snapshots, 30 pin photos, 25 inspections, 103 inspection items and 14 NCRs are identical before/after deployment. Task/pin fingerprints changed through the Engineer's recorded completion of DINING-WALL at 10:20:47 UTC, after the 10:20:37 deployment; the migration contains no record updates. The task and DINING AREA pin are now verified. Local checks: 740 SQL cases, 21 focused schedule/QA cases, application checks/typecheck, production build and 5,000-pin load test passed. Browser visual QA was not performed.

Rollback would require a new additive migration restoring the previous two function bodies; that restores the known failure for older or rescheduled tasks. No rollback or evidence rewrite is included.
