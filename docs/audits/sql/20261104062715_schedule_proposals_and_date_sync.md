# Engineer proposals and PM-owned dates

| Field | Value |
| --- | --- |
| File | `supabase/migrations/20261104062715_schedule_proposals_and_date_sync.sql` |
| Applied | 2026-11-04, BuildTrack connector version `20261104064512_schedule_proposals_and_date_sync` |
| Depends on | Gantt timeline `20261104053041`, existing pin/checklist QA guards and project/blueprint permissions |
| Topic | [Project Gantt timeline](../2026-11-04-project-gantt-timeline.md) |

Adds official pin/task start dates, task deadlines and retained approved request plans. Engineers keep private drafts and submit proposals; assigned PMs approve/adjust dates and publish. The official date trigger blocks direct API date writes. Existing timeline writes synchronize task dates and the pin's overall approved range. Ordinary Admins are read-only; MFA-protected Super Admin recovery remains. No QA decision or evidence edit is granted to PMs.

Existing inherited deadlines are copied into the new task deadline column; missing starts are never invented. Already approved schedules are reconciled. The existing evidence guard excludes scheduling-only fields from its evidence comparison while preserving all evidence/result locks. First apply rolled back without partial changes; the final migration passed the verified-state regression and all 735 SQL cases before the successful retry.

All twelve hosted function bodies match the local file. Work/QA fingerprints are unchanged; live Engineer draft access works; source and ACL checks confirm client drafts remain private. Component, full application, build and 5,000-pin checks pass. No real work pin, draft request, test schedule or publication was created for verification. Manual browser QA remains unperformed.

Rollback needs a separately reviewed additive migration. Preserve schedule/request history and approved dates; do not drop populated columns or restore old date-edit rights automatically. No rollback was performed after the successful deployment.
