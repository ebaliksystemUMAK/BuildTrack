# Complete audit details

| Field | Value |
|---|---|
| File | `supabase/migrations/20261031170819_readable_audit_details.sql` |
| Written/applied | 2026-11-01 Manila |
| Status | Applied; followed by `20261031171048_audit_label_encoding` |
| Dependencies | Existing audit_log, users.view/MFA helpers and project/work/report tables |
| Reversible | Restore prior function bodies in a new reviewed migration; stored history remains |

Removes the audit viewer's 400-character cutoff and resolves current related record labels without rewriting past entries. Future generic updates capture the genuine old row alongside the existing row payload.

| Object | Change |
|---|---|
| `get_audit_log` | Same parameters/return signature; complete sanitized envelope, reference names and searchable names |
| `audit_reference_id`, `audit_display_details`, `audit_log_context` | Private invoker helpers; malformed-reference tolerance, sensitive-field removal and indexed reference lookups |
| `log_row_change`, `log_project_change` | Preserve row payload and add before row on UPDATE only |

Access remains the existing `users.view` permission with active account/MFA checks. No RLS/table grants changed. All helpers/trigger functions revoke API-role execution, and function search paths are empty.

Verified by 558 SQL cases, full application check, 5,000-pin load test, live authenticated read, six function-body hashes, execution-grant checks and unchanged security advisor findings. Original 335 audit records through ID 580 retain fingerprint `7298c62c3e1baaf98104a5383770e669`.

Rollback: in a new migration restore `get_audit_log` from `0020_notifications_invites_audit.sql`, `log_row_change` from `0009_blueprints.sql`, and `log_project_change` from `0005_fix_project_audit_trigger.sql` using their CREATE OR REPLACE definitions. Keep the helpers private. This restores the earlier read/recording behavior without deleting history or the before values already recorded.

Limits: past after-only entries cannot show invented before values; names resolved through references are current labels. The initial deployed separator was decoded incorrectly by Windows; the exact deployed artifact is retained and the follow-up fixes the two display sources.
