# Delete Gantt milestone

File: `supabase/migrations/20261106172635_delete_gantt_milestone.sql`. Status: applied to the connected BuildTrack database, 2026-11-07 Manila. Depends on the project-timeline schema and current schedule-manager access helper.

Purpose: allow the PM to delete a standalone working milestone without deleting task schedules, QA records or published snapshots.

Objects: new `delete_timeline_milestone(uuid,text,integer)` RPC. It checks existing schedule-manager permissions, locks the project, checks the milestone key and revision, rejects incoming dependencies, and audits the deleted row. Private-table access and all existing QA rules remain unchanged. Anonymous execution is denied.

Verification: all 762 local SQL cases passed, including four milestone-deletion groups. Gantt UI and TypeScript checks passed. Live RPC existence and execution grants were verified with read-only queries; no existing milestone was deleted for testing.

Rollback: remove the new function and its UI action in a separately reviewed change. Already deleted milestones require deliberate reconstruction from audit/publication data; old publications are never rewritten by deletion.

Limits: removal affects the working schedule. Clients see the previous published version until the PM republishes. Remove incoming dependencies first.
