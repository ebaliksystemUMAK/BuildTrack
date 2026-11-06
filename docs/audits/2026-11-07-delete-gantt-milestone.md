# Project Manager milestone deletion

Added Delete milestone to the milestone-details dialog in the Gantt chart. The confirmation explains that deletion affects the working schedule; previously published versions remain intact until the PM publishes an updated schedule. Dependencies are listed and must be removed before deletion. Work tasks do not receive the delete action.

The new `delete_timeline_milestone(uuid,text,integer)` RPC uses the existing schedule-manager permission check, serializes against schedule saves and publications with the project lock, checks the expected revision, accepts only standalone milestone keys, rejects incoming dependencies, and records the deleted row and actor in the audit log. Private table access remains restricted and anonymous execution is denied. It does not modify task, pin or QA records.

Verification: Gantt component tests and TypeScript passed. The full local SQL suite passed with 762 tests, including primary/backup PM deletion, unauthorized roles, stale revisions, cross-project access, dependencies, client publication behavior, archived projects, revoked assignments and audit history.

Deployment: applied only `20261106172635_delete_gantt_milestone.sql` to the connected BuildTrack database through the migration tool. No existing milestones were deleted during deployment. The earlier pending pin-relocation migration was not applied as part of this change.
