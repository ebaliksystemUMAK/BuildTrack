// What the system health screen checks. Every name here exists on the live BuildTrack database today; a missing one therefore means something really
// is missing (or was renamed: update this list in the same change). `pnpm test:health` checks the migration names against the files in supabase/migrations.

export type ObjectKind = "table" | "function" | "column" | "bucket"
export type CheckObject = { kind: ObjectKind; name: string }
export type Feature = { key: string; label: string; needs: CheckObject[]; action: string }

const table = (name: string): CheckObject => ({ kind: "table", name })
const fn = (name: string): CheckObject => ({ kind: "function", name })
const column = (name: string): CheckObject => ({ kind: "column", name })

const migrate = "The owner runs the migration that adds it (see docs/audits/migrations-log.md). Nothing is repaired automatically."

export const FEATURES: Feature[] = [
  { key: "accounts", label: "Accounts, roles and privacy", action: migrate,
    needs: [table("profiles"), table("admin_permissions"), table("access_requests"), table("invite_codes"), table("whitelisted_emails"), table("identity_verifications"), table("data_requests"), table("privacy_consents"), fn("has_permission"), fn("is_super_admin"), fn("is_active"), fn("complete_registration"), fn("request_data_erasure")] },
  { key: "projects", label: "Projects and teams", action: migrate,
    needs: [table("projects"), table("project_members"), table("project_managers"), table("project_blueprint_access"), fn("assign_project_manager"), fn("can_view_project"), fn("set_blueprint_access")] },
  { key: "blueprints", label: "Blueprints and pins", action: migrate,
    needs: [table("blueprints"), table("blueprint_revisions"), table("blueprint_annotations"), table("pins"), table("pin_events"), table("pin_photos"), table("pin_checklist_items"), table("sheet_history"), fn("move_annotations"), fn("report_pin_progress")] },
  { key: "quality", label: "Quality inspections and defect reports", action: migrate,
    needs: [table("qa_templates"), table("qa_template_items"), table("qa_inspections"), table("qa_inspection_items"), table("qa_defects"), table("qa_defect_events"), table("qa_photos"), table("qa_counters"), table("client_snags"), fn("request_inspection"), fn("complete_inspection"), fn("raise_defect"), fn("submit_pin_qa")] },
  { key: "reports", label: "Daily reports, site issues and visits", action: migrate,
    needs: [table("daily_reports"), table("daily_report_photos"), table("project_questions"), table("site_issue_reports"), table("site_visit_requests"), fn("review_daily_report")] },
  { key: "attendance", label: "Biometric attendance", action: migrate,
    needs: [table("attendance_workers"), table("attendance_devices"), table("attendance_schedules"), table("biometric_attendance_events"), table("biometric_daily_totals"), fn("ingest_biometric_scan")] },
  { key: "notifications", label: "Notifications and email queue", action: migrate,
    needs: [table("notifications"), table("notification_prefs"), table("email_log"), fn("claim_email_batch"), fn("mark_email_result"), fn("notification_email_category"), fn("mark_all_notifications_read"), column("notification_prefs.email_reminders"), column("notification_prefs.email_announcements"), column("notifications.email_claimed_at")] },
  { key: "announcements", label: "Announcement banner and messages", action: migrate,
    needs: [table("site_announcement"), table("message_batches"), fn("get_active_announcement"), fn("set_announcement"), fn("send_admin_message"), fn("search_message_recipients")] },
  { key: "health", label: "System health and the daily admin digest", action: migrate,
    needs: [table("digest_runs"), table("email_test_log"), fn("get_system_health"), fn("generate_admin_digest"), fn("preview_admin_digest"), fn("begin_email_test"), column("notification_prefs.email_admin_digest")] },
  { key: "site_controls", label: "Maintenance, feature pauses and forced logout", action: migrate,
    needs: [table("site_controls"), table("feature_locks"), fn("get_site_status"), fn("get_site_controls"), fn("set_maintenance"), fn("set_feature_lock"), fn("force_logout"), fn("site_guard"), column("profiles.force_logout_at")] },
  { key: "recycle_bin", label: "Project recycle bin", action: migrate,
    needs: [fn("get_recycle_bin"), fn("remove_project"), fn("restore_removed_project"), fn("preview_project_removal"), fn("project_is_removed"), fn("preview_project_purge"), fn("project_purge_check"), fn("purge_project_rows"), fn("pin_has_work"), fn("pin_has_records"), column("projects.deleted_at")] },
  { key: "records", label: "Super Admin record removal", action: migrate,
    needs: [fn("remove_record"), fn("restore_record"), fn("get_removed_records"), fn("search_removable_records"), fn("preview_record_removal"), fn("record_is_removed"), column("daily_reports.removed_at"), column("site_issue_reports.removed_at"), column("client_snags.removed_at")] },
  { key: "email_codes", label: "Emailed codes and email verification", action: migrate,
    needs: [table("email_codes"), fn("issue_email_code"), fn("consume_email_code"), fn("check_email_code"), fn("mark_email_verified"), column("profiles.email_verified_at")] },
  { key: "account_deletion", label: "Super Admin account deletion", action: migrate,
    needs: [fn("account_record_counts"), fn("account_delete_preview"), fn("account_delete_prepare"), fn("close_account")] },
  { key: "system_control", label: "System Control switches and reports", action: migrate,
    needs: [table("system_switches"), fn("system_switch_on"), fn("get_registration_status"), fn("get_system_switches"), fn("set_system_switch"), fn("site_emergency_off"), fn("get_email_delivery"), fn("get_storage_capacity"), fn("get_system_activity"), table("maintenance_windows"), fn("get_maintenance_windows"), fn("schedule_maintenance"), fn("cancel_maintenance_window"), fn("apply_maintenance_windows"), fn("get_lockout_watch"), fn("get_system_log"), fn("system_log_category")] },
  { key: "admin", label: "Audit log and system settings", action: migrate, needs: [table("audit_log"), table("system_settings"), fn("get_audit_log"), fn("set_setting")] },
]

// Private buckets must stay private; avatars are public on purpose.
export const BUCKETS: Array<{ id: string; public: boolean }> = [
  { id: "avatars", public: true },
  { id: "blueprints", public: false },
  { id: "daily-photos", public: false },
  { id: "identity-docs", public: false },
  { id: "issue-photos", public: false },
  { id: "pin-photos", public: false },
  { id: "qa-evidence", public: false },
  { id: "snag-photos", public: false },
  { id: "worker-photos", public: false },
]

// Migrations recorded in the database's own history (supabase_migrations) carry the name of the file after its timestamp. Files before 18 Oct 2026 were
// numbered (0001 ... 0043) and run in the SQL Editor, so they are NOT in that history under the same name and are never reported as missing: their
// tables and functions are covered by the schema checks above.
export const TRACKED_MIGRATIONS = [
  "report_review_and_checklist_acceptance", "qa_resubmission_attempts", "qa_pending_pin_enforcement", "work_item_correction_package", "daily_report_checklist_links",
  "daily_report_photo_limit", "philippine_qa_standards", "site_issue_photos", "site_issue_checklist_filter", "biometric_attendance_board", "biometric_device_receiver",
  "direct_item_qa", "concurrent_checklist_qa", "worker_sensor_enrollment", "client_pin_reports_and_photo_markup", "qa_photo_markup", "markup_rotation", "pin_photo_markup",
  "away_photo_counts", "away_photo_message", "pin_record_links", "site_issue_pending_review", "full_checklist_reinspection", "enrollment_progress", "attendance_schedule_scans",
  "attendance_scan_notices", "attendance_daily_status", "client_site_visits", "daily_report_camera_biometrics", "auto_close_reinspection_ncrs", "close_existing_passed_reinspection_ncrs",
  "return_cancelled_reinspection_ncrs", "resume_cancelled_inspections", "blueprint_type_access", "project_checklists", "project_manager_role", "project_manager_workspace",
  "short_work_qa_titles", "builtin_standard_sources", "photo_capture_policy", "photo_upload_rules", "readable_audit_details", "audit_label_encoding", "project_team_role_separation",
  "admin_communications", "system_health_and_admin_digest", "site_controls", "project_recycle_bin", "delete_protection_and_purge", "record_removal",
  "email_verification_and_codes", "email_only_needed_kinds", "account_deletion", "email_code_check", "system_control", "system_control_schedule_and_lockouts", "system_logs",
]

export const manifestItems = (): CheckObject[] => [
  ...FEATURES.flatMap((feature) => feature.needs),
  ...BUCKETS.map((bucket): CheckObject => ({ kind: "bucket", name: bucket.id })),
]
