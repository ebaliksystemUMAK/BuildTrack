# 2026-11-04 Daily progress report: task progress entries

Owner request: on the existing Daily Progress Report form (no separate page), the Foreman adds a progress entry per task with task, linked pin, percentage completed, daily notes, issues, manpower, materials and photos, adds more with an **Add Task Progress** button, keeps them all under one daily report, and saves a draft or submits at the end of the day.

Migration `20261104120000_daily_report_task_entries` was **APPLIED 2026-11-04** to the owner-approved BuildTrack project `ruimjlhsfpaezkgfphsz`, recorded by the connector as `20261104053050_daily_report_task_entries`. The report pages can now use the new table and save function. Existing report data was preserved.

The per-task work-completed follow-up `20261104130000_daily_report_entry_work_done` was subsequently **APPLIED** as hosted `20261104064730`, after the owner-requested scheduling workflow was implemented first. Both updated function bodies match the local UTF-8 source; the column and authenticated-only save grants are verified. Existing reports, photos and revisions remain unchanged. New submissions require work-completed text on every task; drafts and historical reports remain preserved.

## What changed
| Area | Behaviour |
|---|---|
| Form | `TaskProgressEditor` replaces the old linked-work rows on `ForemanDailyProgressReport`. Choosing a task fills in its pin; choosing a pin first narrows the tasks. Weather and the biometric headcount are unchanged. |
| Work completed | Owner decision: written under each task (required to submit, 5 characters, same as the report's rule). `daily_reports.work_done` stays, because client site logs, Engineer review, prints and the submission rule read it: `save_daily_report` builds it from the tasks as `Pin → Task: text`, cut to 4000 characters while each entry keeps its full text. The report-level box shows only for an older summary or for a Foreman with no assigned work, so such a day can still be reported. A summary on an older draft moves to its first task. |
| Blueprint filter | Owner decision: each task has a Blueprint filter over the Foreman's assigned work, narrowing its pins and tasks. It is not saved: the entry links the pin, the pin belongs to a blueprint, and a chosen pin shows its blueprint. |
| Materials | Owner decision: removed from the form, prints and views after first being included. `daily_report_entries.materials` stays in the database, unused and empty (no entry had any), so no migration was needed. |
| Photos | Owner decision: photos are added only under a task, with the same camera, upload (where allowed), annotation and caption steps; the report-level photo section is gone. A task can take many photos: several can be chosen at once, more can be added before saving, the annotation editor moves between them, and each keeps its own annotations and caption. They are saved one by one, so a failure keeps only the photos still to send and a retry cannot repeat one. The limit stays 50 per report, enforced by `prepare_daily_report_photo`. An unsaved photo leaves the entries editable, so its task can still be chosen, but the entry cannot be removed and the report cannot be saved. Photos under no task (older reports, photos of a removed entry) stay listed as "Other photos on this report" and can still be removed from a draft, so no evidence goes missing. A report that has no task entries therefore cannot get new photos. The database still accepts a photo without an entry; the form no longer offers it. |
| Saving | `save_daily_report` saves the report and all its entries in one transaction, online and from the offline queue. Items queued before this change keep their direct write. A retry is safe because the browser chooses each entry's id. |
| Team views | Engineer reports show each entry with its photos and the reported percentage beside the task's QA state. Revision history and the Foreman, Engineer and PM prints include the entries. |
| Export | `daily_report_entries` is in the project export. |

## Decisions to confirm
- **Clients do not see task entries.** Every project member can read a submitted `daily_reports` row, so these details are in a separate table with its own row security, not in `linked_work`. Hiding them only on screen would still send them to the client's browser. The client keeps the summary (now built from each task's work completed), pin links and report photos. Everything else in an entry stays team-only. Task photos are report photos, so they do appear in the client's site log, as report photos always have; the Foreman is told so at submission.
- **"Assigned tasks" means tasks on pins assigned to the Foreman.** Assignment is per pin (`pins.assigned_to`); there is no per-task assignee. The form and `save_daily_report` both limit new entries to that work ("Foreman works only on assigned work"). This is narrower than the old rows, which offered any pin of the project. "Additional tasks" was read as more assigned tasks in the same report. Work the report already links stays valid after reassignment, so a returned report can still be corrected.
- **The percentage is the Foreman's report of the day.** Nothing here changes a task's `done` or `review_status`. Official progress still comes only from Engineer-approved tasks, and a reported 100% completes nothing.
- **Manpower is a number the Foreman enters per task.** It is separate from the biometric headcount, which stays the attendance figure. A breakdown by trade can go in the daily notes.

## Rules enforced by the database
- Only the report's author writes it, through the same checks as the report's write policies. Nothing else can write `daily_report_entries`.
- A pin must belong to the project and not be a note. A task must belong to its pin, and is required when the pin has tasks.
- Percentage: whole number 0 to 100. Manpower: whole number 0 to 5000. Texts: 2000 characters each. At most 100 entries. One entry per task. Unknown fields are refused.
- A draft may leave the percentage blank. No route submits an entry without one. Older reports without entries are unaffected.
- A photo can only point at an entry of its own report. Removing an entry never deletes evidence: its photos stay on the report, listed as other photos.
- Reports keep the 14-day window, one report per author per day, the 50-photo limit and every existing trigger, because the function writes through the same table.

## Reference checks
| Check | Result |
|---|---|
| Site controls | `zz_site_guard` on the new table with feature `daily_reports`; the save returns `BT503` in maintenance, so the offline queue pauses as usual |
| Realtime | Not registered: every save updates the report row, which pages already follow |
| Removed report / removed project | The read policy goes through `daily_reports` and `viewable_project_ids`, so both hide entries; `can_report_on_project` refuses removed projects |
| Pin delete | `linked_work` stays complete, so `pin_has_records` still blocks; the foreign key backs it up |
| Task delete | `item_id` is deliberately not a foreign key, matching `linked_work`: the record neither blocks the deletion nor forgets the id |
| Project purge | Unchanged: a project with daily reports is not purgeable. A delete with draft reports cascades through the entries (tested) |
| Account deletion | Entries hold no person's id; they follow the report |
| Revisions | `snapshot_daily_report` adds `task_entries`. Clients cannot read revisions |

## Verification
Local only, all passing: `pnpm check` (includes `tsc`), `pnpm build`, `pnpm test:sql` (726 cases; new file `zzzzzzzzzzzz-daily-report-entries.cases.mjs`) and `pnpm test:load`. The form, editor and offline routing are covered by `test-project-records`, `test-qa-photo-markup`, `test-pin-records` and `test-site-controls`.

Load: a year of reports with 1,825 entries reads in about 267 ms as Engineer (PGlite, this machine, no network), in line with the app's other full-project reads. The same read as a client returns no entries in about 12 ms.

Hosted follow-up (2026-11-04): snapshot replacement preflight matched the previous source; all four deployed function bodies match this migration. Entry RLS/ACLs and private helper grants are correct. Fingerprints of all 4 reports, 5 photos (excluding the added null `entry_id`), 3 revisions, 12 pins and 10 tasks are unchanged. No report entries were created during deployment. Full `pnpm check` now passes with 726 SQL cases including Gantt coverage; `pnpm test:load` passes. The new Gantt read path also works with the installed task-entry table. No new unexpected security-advisor category; the new save RPC appears under the existing checked authenticated-definer warning.

**Not verified:** the page in a real browser or a real camera capture. These are not implied by database deployment or the local build.

## Cumulative percentage and blueprint task follow-up (2026-11-04)

- The Foreman can type the total percentage directly in a numeric-keyboard text box, without number steppers. Only whole digits are accepted; existing save validation still requires 0–100, and clearing the box while typing is supported.
- Selecting a task or opening a blank task entry carries its latest submitted total from before the selected report date, even after days without a report or reassignment. For example, 15% carries into the next report and the Foreman types 25% after completing another 10%. This is an updated total, never an automatic sum. Drafts, returned/removed reports, different projects and later dates are excluded. Saved or dirty draft values are retained; submitted history is never filled or rewritten.
- The Engineer's blueprint **Tasks & QC** rows (side panel and full pin view) show **Foreman reported: X%** and the report date. Empty, loading and failed reads are distinguished, with retry available. The existing paged, pin-scoped report query includes task entries for staff only; Client queries still request no task-entry data. Existing report-row realtime and reconnect refresh update these values.
- Reported 100% has no effect on Engineer-approved progress or QA status. No schema migration or hosted data write is needed for this follow-up.
- Focused form/editor tests cover previous-day carry-forward, task switching, dates, 0/100, typed replacement/clearing, draft/history preservation, deep-link loading and exact save payloads. Blueprint tests cover submitted-only task percentages, project/pin isolation, loading/errors, Client privacy and the reported100/QA distinction. Browser visual verification remains unavailable because the browser access host is unavailable.
- Verification: `pnpm check` passed TypeScript, all application checks and 735 SQL cases; its final build hit sandbox `spawn EPERM` while loading Vite's native dependency. The same production build then passed via authorized `npm run build` with local process access. The 5,000-pin load test passed, including the year of task-entry reports and Client privacy reads. No backend, report or QA data was changed by this follow-up.

## Found, not changed
`remove_record` cannot remove a **submitted** daily report. It sets `buildtrack.record_bin`, which only `guard_record_removal` honours, so `prepare_daily_report` refuses with "A submitted report cannot be edited". `2026-11-01-record-removal.md` says any status, but its tests only use a draft. This comes from the code, reproduced locally; it was not tried on the hosted database.

## Rollback
See the end of the migration. Entries are lost if the table is dropped, and reports keep `linked_work`.
