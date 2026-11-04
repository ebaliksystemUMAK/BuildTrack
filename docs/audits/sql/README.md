# SQL documentation (BuildTrack Supabase project only)

One document per SQL file in `supabase/`. Same sections every time so changes are easy to review.

| Doc | SQL file | Status |
|---|---|---|
| [20261104172610_schedule_email_notifications](20261104172610_schedule_email_notifications.md) | `supabase/migrations/20261104172610_schedule_email_notifications.sql` | APPLIED 2026-11-05 Manila (live `20261104174312`) |
| [20261104155523_create_pin_with_foreman](20261104155523_create_pin_with_foreman.md) | `supabase/migrations/20261104155523_create_pin_with_foreman.sql` | APPLIED 2026-11-05 Manila (live `20261104160447`) |
| [20261104153838_optional_schedule_approval_publication_reason](20261104153838_optional_schedule_approval_publication_reason.md) | `supabase/migrations/20261104153838_optional_schedule_approval_publication_reason.sql` | APPLIED 2026-11-04 (live `20261104154404`) |
| [20261104121503_automatic_pin_schedule_requests](20261104121503_automatic_pin_schedule_requests.md) | `supabase/migrations/20261104121503_automatic_pin_schedule_requests.sql` | APPLIED 2026-11-04 (live `20261104122333`) |
| [20261104114559_optional_pin_proposal_reason](20261104114559_optional_pin_proposal_reason.md) | `supabase/migrations/20261104114559_optional_pin_proposal_reason.sql` | APPLIED 2026-11-04 (live `20261104115049`) |
| [20261104101457_qa_schedule_snapshot_compatibility](20261104101457_qa_schedule_snapshot_compatibility.md) | `supabase/migrations/20261104101457_qa_schedule_snapshot_compatibility.sql` | APPLIED 2026-11-04 (live `20261104102037`) |
| [20261104062715_schedule_proposals_and_date_sync](20261104062715_schedule_proposals_and_date_sync.md) | `supabase/migrations/20261104062715_schedule_proposals_and_date_sync.sql` | APPLIED 2026-11-04 (live `20261104064512`) |
| [20261104130000_daily_report_entry_work_done](20261104130000_daily_report_entry_work_done.md) | `supabase/migrations/20261104130000_daily_report_entry_work_done.sql` | APPLIED 2026-11-04 (live `20261104064730`) |
| [20261104042538_project_gantt_timeline](20261104042538_project_gantt_timeline.md) | `supabase/migrations/20261104042538_project_gantt_timeline.sql` | APPLIED 2026-11-04 (live `20261104053041`) |
| [20261104120000_daily_report_task_entries](20261104120000_daily_report_task_entries.md) | `supabase/migrations/20261104120000_daily_report_task_entries.sql` | APPLIED 2026-11-04 (live `20261104053050`) |
| [20261102140000_system_logs](20261102140000_system_logs.md) | `supabase/migrations/20261102140000_system_logs.sql` | APPLIED 2026-11-02 (live `20261102041122`) |
| [20261102120000_system_control_schedule_and_lockouts](20261102120000_system_control_schedule_and_lockouts.md) | `supabase/migrations/20261102120000_system_control_schedule_and_lockouts.sql` | APPLIED 2026-11-02 (live `20261102031428`) |
| [20261102100000_system_control](20261102100000_system_control.md) | `supabase/migrations/20261102100000_system_control.sql` | APPLIED 2026-11-02 (live `20261102024451`) |
| [20261102000000_email_code_check](20261102000000_email_code_check.md) | `supabase/migrations/20261102000000_email_code_check.sql` | APPLIED 2026-11-02 (live `20261102012618`) |
| [20261101210000_email_verification_and_codes](20261101210000_email_verification_and_codes.md) | `supabase/migrations/20261101210000_email_verification_and_codes.sql` | APPLIED 2026-11-01 (live `20261101135551`) |
| [20261101220000_email_only_needed_kinds](20261101220000_email_only_needed_kinds.md) | `supabase/migrations/20261101220000_email_only_needed_kinds.sql` | APPLIED 2026-11-01 (live `20261101135623`) |
| [20261101230000_account_deletion](20261101230000_account_deletion.md) | `supabase/migrations/20261101230000_account_deletion.sql` | APPLIED 2026-11-01 (live `20261101135657`) |
| [20261101200000_record_removal](20261101200000_record_removal.md) | `supabase/migrations/20261101200000_record_removal.sql` | APPLIED 2026-11-01 (live `20261101111602`) |
| [20261101190000_delete_protection_and_purge](20261101190000_delete_protection_and_purge.md) | `supabase/migrations/20261101190000_delete_protection_and_purge.sql` | APPLIED 2026-11-01 (live `20261101081428`) |
| [20261101180000_project_recycle_bin](20261101180000_project_recycle_bin.md) | `supabase/migrations/20261101180000_project_recycle_bin.sql` | APPLIED 2026-11-01 (live `20261101081342`) |
| [20261101150000_site_controls](20261101150000_site_controls.md) | `supabase/migrations/20261101150000_site_controls.sql` | APPLIED 2026-11-01 (live `20261101052258`) |
| [20261101120000_system_health_and_admin_digest](20261101120000_system_health_and_admin_digest.md) | `supabase/migrations/20261101120000_system_health_and_admin_digest.sql` | APPLIED 2026-11-01 (live `20261101052156`) |
| [20261101090000_admin_communications](20261101090000_admin_communications.md) | `supabase/migrations/20261101090000_admin_communications.sql` | Applied and verified 2026-11-01 |
| [20261031172653_project_team_role_separation](20261031172653_project_team_role_separation.md) | `supabase/migrations/20261031172653_project_team_role_separation.sql` | Applied and verified 2026-11-01; 566 SQL cases; Admin manager appointment and read-only team oversight, PM team operations, Super Admin recovery |
| [20261031170819_readable_audit_details](20261031170819_readable_audit_details.md), [20261031171048_audit_label_encoding](20261031171048_audit_label_encoding.md) | `supabase/migrations/20261031170819_readable_audit_details.sql`, `20261031171048_audit_label_encoding.sql` | Applied and verified 2026-11-01; 558 SQL cases; complete readable details, related names, future before/after snapshots; history and access preserved |
| [20261031123546_photo_upload_rules](20261031123546_photo_upload_rules.md) | `supabase/migrations/20261031123546_photo_upload_rules.sql` | Applied and tracked 2026-10-31; 552 SQL cases pass; admin-users v8 with photos.manage deployed and verified 2026-11-01 (JWT on, source parity) |
| [20261031120532_photo_capture_policy](20261031120532_photo_capture_policy.md) | `supabase/migrations/20261031120532_photo_capture_policy.sql` | Applied and tracked 2026-10-31; 545 SQL cases pass; switch seeded on (no behaviour change for evidence until a Super Admin turns it off); existing photos untouched |
| [20261031102813_builtin_standard_sources](20261031102813_builtin_standard_sources.md) | `supabase/migrations/20261031102813_builtin_standard_sources.sql` | Applied and tracked 2026-10-31; 537 SQL cases pass; six official source links added, three codes deliberately unlinked; nothing else changed |
| [20261029190310_short_work_qa_titles](20261029190310_short_work_qa_titles.md) | `supabase/migrations/20261029190310_short_work_qa_titles.sql` | Applied and tracked 2026-10-30 (Manila); 534 SQL cases pass; exact CR-FLOOR rollback submission verified; existing data and privileges unchanged |
| [20261029100000_project_manager_workspace](20261029100000_project_manager_workspace.md) | `supabase/migrations/20261029095839_project_manager_role.sql`, `supabase/migrations/20261029100000_project_manager_workspace.sql` | Both applied and tracked 2026-10-29; 531 SQL cases, 10 PM tests and load test pass; all 30 function bodies and live RLS/grants/triggers verified; admin-users v7 deployed and checked; Vercel frontend deployment unverified |
| [20261028150000_project_checklists](20261028150000_project_checklists.md) | `supabase/migrations/20261028150000_project_checklists.sql` | Applied and tracked 2026-10-28; 515 SQL cases, 5 function bodies and live rollback smoke verified; owner-approved cleanup backed up in audit_log 520 |
| [20261028130000_blueprint_type_access](20261028130000_blueprint_type_access.md) | `supabase/migrations/20261028130000_blueprint_type_access.sql` | Already applied by owner; 29 functions verified and missing history reconciled 2026-10-28 without rerunning DDL or backfill |
| [20261028092154_resume_cancelled_inspections](20261028092154_resume_cancelled_inspections.md) | `supabase/migrations/20261028092154_resume_cancelled_inspections.sql` | Applied and verified; confirmed Engineer continuation, snapshot/newer-work guards, exact NCR restoration; 493 SQL cases |
| [20261028084938_return_cancelled_reinspection_ncrs](20261028084938_return_cancelled_reinspection_ncrs.md) | `supabase/migrations/20261028084938_return_cancelled_reinspection_ncrs.sql` | Applied and verified; cancelled package NCRs return for correction; existing guards/history retained; 486 SQL cases pass |
| [20261028081533_close_existing_passed_reinspection_ncrs](20261028081533_close_existing_passed_reinspection_ncrs.md) | `supabase/migrations/20261028081533_close_existing_passed_reinspection_ncrs.sql` | Applied with explicit owner approval; one existing finding-specific passed NCR closed; history and manual checklist completion retained |
| [20261028081041_auto_close_reinspection_ncrs](20261028081041_auto_close_reinspection_ncrs.md) | `supabase/migrations/20261028081041_auto_close_reinspection_ncrs.sql` | Applied and verified; sign-off atomically closes its own passed NCRs; remarks-only reinspection UI; 484 SQL cases pass |
| [20261028064248_daily_report_camera_biometrics](20261028064248_daily_report_camera_biometrics.md) | `supabase/migrations/20261028064248_daily_report_camera_biometrics.sql` | Applied and verified; biometric Time IN headcount and camera-photo annotations; 479 SQL cases and full check/build pass |
| [20261028061346_client_site_visits](20261028061346_client_site_visits.md) | `supabase/migrations/20261028061346_client_site_visits.sql` | Applied and verified 2026-10-28; Client requests, Engineer responses, cancellation, private access, notifications; 473 SQL cases and full check/build pass |
| [20261025141322_full_checklist_reinspection](20261025141322_full_checklist_reinspection.md) | `supabase/migrations/20261025141322_full_checklist_reinspection.sql` | Applied and verified; all same-checklist criteria need fresh results, retained history, NCR guards; 447 SQL cases and full check/build pass |
| [20261025090858_site_issue_pending_review](20261025090858_site_issue_pending_review.md) | `supabase/migrations/20261025090858_site_issue_pending_review.sql` | Applied; issue logging retains pending QA status and evidence locks |
| [20261028010000_attendance_daily_status](20261028010000_attendance_daily_status.md) | `supabase/migrations/20261028010000_attendance_daily_status.sql` | Applied 2026-10-28 (SQL Editor, verified); one Time IN/OUT per day, working days, On time / Late / Absent status |
| [20261027152428_attendance_scan_notices](20261027152428_attendance_scan_notices.md) | `supabase/migrations/20261027152428_attendance_scan_notices.sql` | Applied and verified; receiver v3 ACTIVE; unregistered / unlinked / inactive scans answered and logged, live pop-ups |
| [20261027130000_attendance_schedule_scans](20261027130000_attendance_schedule_scans.md) | `supabase/migrations/20261027130000_attendance_schedule_scans.sql` | Applied 2026-10-27 (SQL Editor, verified); Admin attendance schedule, server-decided IN/OUT, repeat-scan protection, late / early flags |
| [20261027110000_enrollment_progress](20261027110000_enrollment_progress.md) | `supabase/migrations/20261027110000_enrollment_progress.sql` | Applied 2026-10-27 (SQL Editor, verified); live fingerprint registration steps reported by the ESP32 |
| [20261024152151_pin_record_links](20261024152151_pin_record_links.md) | `supabase/migrations/20261024152151_pin_record_links.sql` | Applied; NCR checklist item link + validation, 11-argument `raise_defect`, Foreman field problems |
| [20261023075625_away_photo_message](20261023075625_away_photo_message.md) | `supabase/migrations/20261023075625_away_photo_message.sql` | Applied; `submit_checklist_qa` message no longer excludes away photos |
| [20261023075351_away_photo_counts](20261023075351_away_photo_counts.md) | `supabase/migrations/20261023075351_away_photo_counts.sql` | Applied; away-from-site photos count as evidence, only untrusted times excluded |
| [20261023073942_pin_photo_markup](20261023073942_pin_photo_markup.md) | `supabase/migrations/20261023073942_pin_photo_markup.sql` | Applied; markup overlay on work item / correction photos |
| [20261021151557_markup_rotation](20261021151557_markup_rotation.md) | `supabase/migrations/20261021151557_markup_rotation.sql` | Applied; optional `rotation` on photo markup marks |
| [20261021111736_qa_photo_markup](20261021111736_qa_photo_markup.md) | `supabase/migrations/20261021111736_qa_photo_markup.sql` | Applied; markup overlay on inspection / NCR evidence photos, validated and insert-only |
| [Independent checklist-item QA](../2026-10-20-concurrent-checklist-qa.md) | `supabase/migrations/20261020072554_concurrent_checklist_qa.sql` | Applied; item-scoped requests allow adding and submitting other items during review; evidence, authorization and completion guards verified |
| [Direct checklist-item QA](../2026-10-20-direct-item-qa.md) | `supabase/migrations/20261020064247_direct_item_qa.sql` | Applied; atomic Engineer item+criteria save, direct Foreman submission, pending/evidence guards and legacy history verified |
| [Biometric attendance](../2026-10-19-biometric-attendance.md) | `supabase/migrations/20261019104906_biometric_attendance_board.sql`, `20261019105837_biometric_device_receiver.sql` | Applied; worker profiles, private photos, live display and authenticated ESP32 receiver verified; physical AS608/ESP32 setup and acceptance test required |
| [Progress / QA review](../2026-10-18-progress-and-qa-review.md) | `supabase/migrations/20261018124654_report_review_and_checklist_acceptance.sql` | Applied; local checks and live rollback smoke passed |
| [0001_profiles_rbac](0001_profiles_rbac.md) | `supabase/migrations/0001_profiles_rbac.sql` | Applied |
| [0002_admin_mfa_aal2](0002_admin_mfa_aal2.md) | `supabase/migrations/0002_admin_mfa_aal2.sql` | Applied |
| [0003_projects](0003_projects.md) | `supabase/migrations/0003_projects.sql` | Applied |
| [0004_default_admin_permissions](0004_default_admin_permissions.md) | `supabase/migrations/0004_default_admin_permissions.sql` | Applied |
| [0005_fix_project_audit_trigger](0005_fix_project_audit_trigger.md) | `supabase/migrations/0005_fix_project_audit_trigger.sql` | Applied (completed via connector 2026-10-09) |
| [0006_project_leads_and_scope](0006_project_leads_and_scope.md) | `supabase/migrations/0006_project_leads_and_scope.sql` | Applied |
| [0007_lock_down_function_execute](0007_lock_down_function_execute.md) | `supabase/migrations/0007_lock_down_function_execute.sql` | Applied (connector) |
| [0008_activity_feed](0008_activity_feed.md) | `supabase/migrations/0008_activity_feed.sql` | Applied (connector) |
| [0009_blueprints](0009_blueprints.md) | `supabase/migrations/0009_blueprints.sql` | Applied (connector) |
| [0010_pins](0010_pins.md) | `supabase/migrations/0010_pins.sql` | Applied (connector) |
| [0011_pin_timeline_names](0011_pin_timeline_names.md) | `supabase/migrations/0011_pin_timeline_names.sql` | Applied (connector) |
| [0012_user_role](0012_user_role.md) | `supabase/migrations/0012_user_role.sql` | Applied (connector) |
| [0013_access_requests](0013_access_requests.md) | `supabase/migrations/0013_access_requests.sql` | Applied (connector) |
| [0014_editor_data](0014_editor_data.md) | `supabase/migrations/0014_editor_data.sql` | Applied (connector) |
| [0015_email_whitelist](0015_email_whitelist.md) | `supabase/migrations/0015_email_whitelist.sql` | Applied (connector) |
| [0016_fix_access_request_guard](0016_fix_access_request_guard.md) | `supabase/migrations/0016_fix_access_request_guard.sql` | Applied (connector) |
| [0017_editor_v2](0017_editor_v2.md) | `supabase/migrations/0017_editor_v2.sql` | Applied (connector) |
| [0018_editor_objects_groups](0018_editor_objects_groups.md) | `supabase/migrations/0018_editor_objects_groups.sql` | Applied (connector) |
| [0019_editor_images_reorder](0019_editor_images_reorder.md) | `supabase/migrations/0019_editor_images_reorder.sql` | Applied (connector) |
| [0020_notifications_invites_audit](0020_notifications_invites_audit.md) | `supabase/migrations/0020_notifications_invites_audit.sql` | Applied (connector) |
| [0021_daily_reports_and_questions](0021_daily_reports_and_questions.md) | `supabase/migrations/0021_daily_reports_and_questions.sql` | Applied (connector) |
| [0022_system_settings](0022_system_settings.md) | `supabase/migrations/0022_system_settings.sql` | Applied (connector) |
| [0023_project_export_audit](0023_project_export_audit.md) | `supabase/migrations/0023_project_export_audit.sql` | Applied (connector) |
| [0024_annotation_text_format](0024_annotation_text_format.md) | `supabase/migrations/0024_annotation_text_format.sql` | Applied (connector) |
| [0025_qa_module](0025_qa_module.md) | `supabase/migrations/0025_qa_module.sql` | Applied (connector) |
| [0026_qa_measure_requires_value](0026_qa_measure_requires_value.md) | `supabase/migrations/0026_qa_measure_requires_value.sql` | Applied (connector) |
| [0027_client_snags](0027_client_snags.md) | `supabase/migrations/0027_client_snags.sql` | Applied (connector) |
| [0028_email_notifications](0028_email_notifications.md) | `supabase/migrations/0028_email_notifications.sql` | Applied (connector) |
| [0029_google_registration_gate](0029_google_registration_gate.md) | `supabase/migrations/0029_google_registration_gate.sql` | Applied (connector) |
| [0030_identity_verification_privacy](0030_identity_verification_privacy.md) | `supabase/migrations/0030_identity_verification_privacy.sql` (+ `0031_privacy_consent_pending.sql`) | Applied (connector) |
| [0032_data_requests](0032_data_requests.md) | `supabase/migrations/0032_data_requests.sql` | Applied (connector) |
| [0033_evidence_lock](0033_evidence_lock.md) | `supabase/migrations/0033_evidence_lock.sql` (+ `0035_history_photo_removed.sql`, `0037_evidence_check_visibility.sql`) | Applied (connector) |
| [0034_realtime](0034_realtime.md) | `supabase/migrations/0034_realtime.sql` | Applied (connector) |
| [0036_rls_performance](0036_rls_performance.md) | `supabase/migrations/0036_rls_performance.sql` | Applied (connector) |
| [0038_escalation_alerts](0038_escalation_alerts.md) | `supabase/migrations/0038_escalation_alerts.sql` | Applied (connector) |
| [0039_photo_stamp](0039_photo_stamp.md) | `supabase/migrations/0039_photo_stamp.sql` | Applied (connector) |
| [0040_pin_assignment_roles](0040_pin_assignment_roles.md) | `supabase/migrations/0040_pin_assignment_roles.sql` | Applied (SQL Editor, by the owner) |
| [0041_daily_report_photos](0041_daily_report_photos.md) | `supabase/migrations/0041_daily_report_photos.sql` | Already present live (verified 2026-10-18 and 2026-10-28); later migrations extend it; do not rerun the historical handover |
| [0042_checklist_qa_submission](0042_checklist_qa_submission.md) | `supabase/migrations/0042_checklist_qa_submission.sql` | Already present live (verified 2026-10-18 and 2026-10-28); later QA migrations supersede its functions; do not rerun the historical handover |
| [seed_super_admin](seed_super_admin.md) | `supabase/seeds/seed_super_admin.sql` | Done (1 Super Admin exists) |

## Latest workflow migrations

- [`20261024152151_pin_record_links.sql`](20261024152151_pin_record_links.md): applied via connector; see [pin record connections audit](../2026-10-24-pin-record-connections.md). NCR `checklist_item_id` / `checklist_name` validated by `guard_defect_links`; `report_field_problem`.
- [`20261023075625_away_photo_message.sql`](20261023075625_away_photo_message.md) and [`20261023075351_away_photo_counts.sql`](20261023075351_away_photo_counts.md): applied via connector; see [away photos count audit](../2026-10-23-away-photos-count.md). `photo_eligible` excludes only `clock_ahead` / `old_photo`.
- [`20261023073942_pin_photo_markup.sql`](20261023073942_pin_photo_markup.md): applied via connector; see [correction photo markup audit](../2026-10-23-correction-photo-markup.md). `pin_photos.annotations`, no UPDATE policy.
- [`20261021151557_markup_rotation.sql`](20261021151557_markup_rotation.md): applied via connector; see [photo markup select / move / rotate audit](../2026-10-22-photo-markup-select-move-rotate.md). `valid_issue_markup` accepts an optional `rotation`.
- [`20261021111736_qa_photo_markup.sql`](20261021111736_qa_photo_markup.md): applied via connector; see [QA photo markup audit](../2026-10-21-qa-photo-markup.md). `qa_photos.annotations` checked by `valid_issue_markup`, no UPDATE grant.
- `20261019101438_site_issue_checklist_filter.sql`: applied and live-verified; see [issue checklist filtering audit](../2026-10-19-issue-checklist-filter.md). Pin-scoped checklist selection, durable name snapshot, checklist filters and backward-compatible RPC signatures.
- `20261019095439_site_issue_photos.sql`: applied and live-verified; see [site issue and zone progress audit](../2026-10-19-site-issues-and-zone-progress.md). Private original photos, versioned markup, atomic issue/return actions, shared pin-state progress and exact-sheet links.
- `20261019093602_philippine_qa_standards.sql`: applied and live-verified; see [Philippine QA standards audit](../2026-10-19-philippine-qa-standards.md); additive references and snapshot-safe acceptance/evidence instructions.
- [`20261018172839_daily_report_photo_limit.sql`](20261018172839_daily_report_photo_limit.md): applied via connector; up to 50 photos per daily report.
- [`20261018170444_daily_report_checklist_links.sql`](20261018170444_daily_report_checklist_links.md): applied via connector; daily report linked work is a work pin + checklist item.
- [`20261018153632_work_item_correction_package.sql`](20261018153632_work_item_correction_package.md): applied via connector; see [work item QA workspace audit](../2026-10-18-work-item-qa-workspace.md). Live rollback validation: `20261018-correction-package-smoke.sql` (aborts itself with SMOKE_OK).
- `20261018142455_qa_pending_pin_enforcement.sql`: applied via connector; see [QA photos, tiles and pending audit](../2026-10-18-qa-photos-tiles-pending.md). Live rollback validation: `20261018-pending-pin-smoke.sql`.

- `20261018124654_report_review_and_checklist_acceptance.sql`: applied via connector; see [progress and QA review](../2026-10-18-progress-and-qa-review.md).
- `20261018133531_qa_resubmission_attempts.sql`: applied via connector; see [QA resubmission audit](../2026-10-18-qa-resubmission-attempts.md). Validation SQL: `20261018-qa-attempts-smoke.sql`, run only inside a transaction ending in ROLLBACK.

- `20261020090300_worker_sensor_enrollment.sql`: applied via connector; automatic worker fingerprint enrollment and split contact fields. See [worker sensor enrollment audit](../2026-10-20-worker-sensor-enrollment.md).

## Document template (copy for every new migration)

1. Header table: file, date written, date applied, depends on, status, reversible
2. Purpose (why, 2-3 lines)
3. Objects created or changed (table)
4. Security and RLS (who can do what)
5. Verification (queries to prove it worked)
6. Rollback (SQL to undo)
7. Notes / known limits

Also add a row to `../migrations-log.md` and an audit note in `docs/audits/`.
Every migration must also get tests in `supabase/tests/` and pass `pnpm test:sql` before it is handed over.
Order matters: run migrations in numeric order, never edit an applied file (add a new migration instead).
