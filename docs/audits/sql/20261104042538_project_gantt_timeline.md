# Project Gantt timeline migration

| Field | Value |
| --- | --- |
| Local file | `supabase/migrations/20261104042538_project_gantt_timeline.sql` |
| Applied | 2026-11-04, owner-approved BuildTrack connector, live version `20261104053041_project_gantt_timeline` |
| Project | `ruimjlhsfpaezkgfphsz` only |
| Dependencies | Existing projects, profiles, pins, checklist items, project/blueprint access helpers and site-control guards. Task-entry reports are optional and were installed immediately afterward. |
| Topic audit | [Project Gantt timeline](../2026-11-04-project-gantt-timeline.md) |

Creates private schedule items, publication snapshots and change requests, plus eight functions. All tables have RLS; raw-table access and internal helpers are revoked from API roles. Checked entry points enforce active roles, MFA for privileged accounts, project/blueprint scope, assigned Foreman work, archival/removal restrictions, revision checks and dependency ordering. No existing data is rewritten; schedule publication remains an explicit project-management action.

Verified the eight function-body hashes against the local source, table ACLs/RLS and function grants. Live read-only PM and Client contexts work as intended; no private fields reach the Client projection. Existing reports, photos, revisions, tasks and pins retain their pre-deployment fingerprints. All four new workflow tables remain empty after deployment. Full local check (726 SQL cases), targeted timeline checks and load test pass.

Rollback requires a separately reviewed migration. Revoke the new entry points and remove Gantt frontend integration first; preserve/export any schedules, requests and immutable publications before considering their removal. Do not drop populated tables or rerun this migration to roll back. No rollback was performed.
