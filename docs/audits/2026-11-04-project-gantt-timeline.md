# Project Gantt timeline

Added Calendar / Gantt Timeline tabs in the shared project calendar for Admin, Project Manager, Engineer, Foreman and Client workspaces. The selected project and calendar date/view remain in the URL; `tab=gantt` links directly to the timeline.

## Behavior

- Work rows come from existing pin checklist tasks; a pin without checklist tasks appears as one work row. Names and responsible Foremen remain canonical work data and are managed from the linked task/blueprint, avoiding duplicate work assignments.
- Schedule records supply phase, planned start/finish, actual start/finish, finish-to-start dependencies and a revision number. Unscheduled work never receives an invented start date. Durations are calendar days in Philippine dates.
- The Gantt chart supports day/week/month zoom, phase expansion, status/phase/search filters, My tasks, a Today marker, dependency connectors, actual-date bars and comparison with the latest published baseline. Task details link to the original task, blueprint and daily reports/evidence.
- Saved task finish dates and milestones also appear in the existing month/week/day/schedule calendar. Original pin deadlines remain for pins with unscheduled work.
- Submitted task-report percentages are reported progress, not verification. Draft, removed and returned reports are excluded. If the optional task-entry report migration is not yet installed, scheduling still works and reported progress remains empty.
- A publication saves an immutable snapshot. Clients see only the latest publication's allowed fields and verification state at publication. Working edits require another publication to become visible to Clients. Prior snapshots remain in the private publication table, with version/reason/actor entries in the project audit log.

## Permissions

The database authorizes every RPC against current active profiles, project membership, blueprint access and assignments. Permissions are not derived from user-editable metadata. Raw timeline tables and internal helper functions cannot be accessed by anonymous or authenticated API roles. RLS is enabled on all three new tables. SECURITY DEFINER entry points have fixed empty search paths, explicit authorization, revoked PUBLIC/anon execution and explicit authenticated grants, matching the project's existing checked-RPC model.

| Role | Permission |
| --- | --- |
| Super Admin | Edit, approve requests and publish on accessible open projects after MFA; reasons are audited. |
| Admin | Read projects within existing access; ordinary Admins do not approve, edit or publish the official schedule. |
| Project Manager | Edit/publish and approve requests only for assigned open projects. |
| Engineer | Read accessible blueprint work and request schedule changes; existing QA workflow remains authoritative. |
| Foreman | Read assigned work and project milestones; request changes only for currently assigned work with Assigned blueprint access. Report progress/evidence through existing daily reporting. |
| Client | Read only the published, sanitized timeline; no staff identities, requests, unapproved percentages or internal actuals. |
| Basic/anonymous/disabled | No project timeline access. |

Archived projects are read-only; removed projects are hidden. A request records the schedule revision it was made against. Approval rechecks requester access and refuses stale versions. Dependency dates are validated within one locked project transaction; impossible ordering and cycles are refused rather than automatically shifting dates. Saving a schedule or approving a request never changes pin/checklist QA state.

## Verification

- `node scripts/test-project-timeline.mjs`: pure model and actual component handler checks for geometry, dependency validation, calendar synchronization, filters, zoom, links, saving, role controls, client privacy and loading/error states.
- `node scripts/test-project-timeline-sql.mjs`: nine focused database cases covering all role boundaries, MFA, project isolation, raw-table/helper ACLs, dates/dependencies, stale edits and requests, publication privacy/immutability, approval and progress/QA separation, optional report-table compatibility and revoked/archived access.
- `node scripts/test-project-calendar.mjs`: existing calendar checks pass.
- Full local SQL suite: 726 passed, 0 failed.
- TypeScript and production build pass. Browser visual inspection could not run because app-access approval timed out.

## Database installation

The additive migration is `supabase/migrations/20261104042538_project_gantt_timeline.sql`, generated with the Supabase CLI. It creates three private tables and checked functions; it does not backfill schedules, change existing work data or publish any project schedule.

After the initial automatic approval rejection, the owner explicitly approved activation and the pending Claude-created daily-report migration. The Gantt migration was **APPLIED 2026-11-04** to BuildTrack project `ruimjlhsfpaezkgfphsz` as hosted version `20261104053041_project_gantt_timeline`; daily report task entries followed as `20261104053050_daily_report_task_entries`. No historical migration was rerun.

Live verification: all eight Gantt function bodies exactly match the tested source; all three tables have RLS and no direct authenticated SELECT/INSERT; internal helpers cannot be executed by API roles and no new function is anonymous-accessible. A read-only check in a current assigned PM context returns 13 canonical work rows and `can_edit=true`; a Client receives zero published tasks, no edit/request authority and no private fields. Zero timelines, requests, publications or report entries were fabricated. Existing report/photo/revision/pin/task fingerprints are unchanged. Project Managers can now schedule existing work and publish the first baseline; no schedule was published without project dates supplied by the owner.

Full `pnpm check` (including 726 SQL cases and production build), focused Gantt component/SQL checks and the 5,000-pin load test pass. Security advisors show only the intended additions under existing categories: three private Gantt tables without policies (no API table grants), and seven checked authenticated definer functions across both features. Anonymous definer findings remain 3; the existing password-protection warning is unchanged. Browser/camera verification remains unperformed.

## Scheduling ownership follow-up (2026-11-04)

Implemented the owner's workflow: Engineers create pins and tasks and propose dates; assigned Project Managers adjust/approve the dates, phases and dependencies, review original work assignments, and publish the Client baseline. Foremen report actual work and request changes; Engineers retain all technical QA authority. Super Admin has MFA-protected recovery authority; ordinary Admin scheduling edits are now read-only.

- New pin: optional start/deadline and technical reason are saved atomically as a private proposal draft. After adding the pin's tasks, the Engineer uses **Send dates for PM approval** in Edit details. This submits a request for each current task; new tasks added later need another proposal. Individual changes remain available in Gantt.
- PM Gantt: **Review & approve** opens editable proposed dates, phase/dependencies and technical reason; assignment review links to the existing PM team/work board. The original proposal is retained alongside the approved plan. Rejections keep the official dates untouched. Publishing remains explicit and preserves earlier baselines.
- `project_timeline_items` remains the schedule source. A guarded trigger mirrors approved dates to checklist items and derives each pin's earliest approved task start / latest approved task deadline. Task-specific deadlines feed progress/weekly calculations. Existing inherited task deadlines are preserved; no missing start date is invented. Calendar and Gantt read the same task schedules.
- Drafts stay in the private request table and are excluded from the project review inbox until sent. Raw pin/task date edits through the API are blocked, so Engineer/Foreman changes require PM approval. The task record, pin details and page guides explain this ownership.
- Verified task evidence and review state remain locked. The existing evidence guard's comparison now excludes only the two scheduling columns in addition to its existing review metadata; no evidence, criteria, done flag or result exemption was added. A trusted historical verified-state regression confirms schedule-only updates preserve QA fields and attempted evidence edits remain blocked.

Migration `20261104062715_schedule_proposals_and_date_sync.sql` was applied as hosted `20261104064512`. The first attempt rolled back atomically because existing verified tasks rejected the deadline metadata backfill; the narrow guard change above was tested before retrying. All twelve final function bodies match the local source. Existing pin and task work/QA fingerprints (excluding scheduling columns and update timestamps) remain unchanged. Read-only live Engineer proposal access succeeds. No proposals or schedules were fabricated.

Checks: full application check and build; 735 SQL cases; 16 focused timeline/proposal cases; actual Engineer form handlers for draft load, validation, safe revisioned submission and error retention; Gantt/calendar/progress checks; 5,000-pin load check. The load fixture now seeds approved deadlines as the trusted backend rather than pretending Engineers may set official dates. Browser visual and camera checks remain unperformed. Security advisors: 16 intentional private-table INFOs, 3 existing anonymous-definer findings, 172 gated authenticated-definer findings (four new checked RPCs), and the existing auth warning.

After activating scheduling first, the previously requested Claude report follow-up was applied as `20261104064730_daily_report_entry_work_done`. The Foreman form's per-task work-completed field is now supported by the live save function; report/photo/revision fingerprints are unchanged. Per-task text is required for new submissions; existing historical reports remain intact.

## Date axis follow-up (2026-11-04)

Date-axis follow-up: Gantt now shows month/year bands above every calendar day number at day, week and month zoom. Each day has an aligned grid column, a full-date accessible label/tooltip and a highlight for today. Zoom spacing keeps two-digit dates readable; horizontal scrolling reveals the whole range, with offscreen date labels windowed for long projects. The dependency layer is offset for the taller header. Focused checks cover consecutive dates, leap days, year/month boundaries, today and scrolling through long schedules.

Proposal approval continues to show only planned dates, as previously requested; a rendered-form regression now checks that Actual start/finish and their execution hint are absent. Gantt/calendar checks, TypeScript and production build passed. Browser visual verification remains unperformed.

## QA snapshot compatibility follow-up (2026-11-04)

The owner reported **Task not completed: Work changed after inspection; submit again** on DINING AREA / DINING-WALL despite a passed inspection and closed NCR. A read-only live comparison confirmed `due_date` was the only changed value, `planned_start`/`due_date` were absent from the historical snapshot, the work-pin snapshot matched, eligible photo evidence existed and no linked NCR remained open. The earlier additive scheduling columns caused the completion check to compare schedule metadata as evidence.

Migration `20261104101457_qa_schedule_snapshot_compatibility.sql` excludes only those two date keys from both sides of `review_checklist_item` and the historical `legacy_pin_qa_verification_problem` comparisons. Every other evidence/identity/criteria/work-pin field, Engineer-only access, passed-inspection and closed-NCR requirement, photo eligibility and concurrency lock is retained. No existing snapshot, task review state or schedule is rewritten. The Engineer must still explicitly complete the task after installation.

Five new local SQL cases cover old missing-column snapshots, PM date updates after inspection, explicit completion, role denials, immutable snapshots, changed evidence/criteria refusal and the private legacy gate. The focused timeline/proposal/QA suite passes 21 cases. Full application checks/typecheck, all 740 SQL cases, production build and the 5,000-pin load test passed. The first full SQL run exposed missing blueprint-type grants in the new test fixture; explicit Assigned work grants were added only to the synthetic test accounts, then the complete SQL suite passed. The production build used authorized local process access because Vite's Windows native tooling is sandbox-restricted.

Applied to BuildTrack as hosted `20261104102037_qa_schedule_snapshot_compatibility`. Both function bodies match local source, search paths and API execution ACLs are correct, and security-advisor categories are unchanged. Fingerprints of all submission snapshots, photos, inspections/results and NCRs remain identical. Read-only verification confirms the new comparison matches the affected task's evidence. The Engineer's normal completion at 10:20:47 UTC changed task/pin review state after deployment; DINING-WALL and DINING AREA are now verified. No real task was completed, submitted, resubmitted or otherwise edited by the migration or test tools. Browser visual QA remains unperformed.
