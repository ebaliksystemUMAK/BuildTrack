# Audit label encoding correction

| Field | Value |
|---|---|
| File | `supabase/migrations/20261031171048_audit_label_encoding.sql` |
| Written/applied | 2026-11-01 Manila |
| Status | Applied and verified |
| Depends on | `20261031170819_readable_audit_details` |
| Reversible | Formatting only; restore prior function source in a new migration if necessary |

The initial deployment's Windows text decoder turned a UTF-8 middle dot into two characters. This ASCII-only migration replaces that sequence in `audit_log_context` and `get_audit_log` definitions using character codes. Function signatures, permissions, logic and audit records remain unchanged.

Both migrations together pass 558 SQL cases; the final function bodies match the intended tested sources. Live related-name search returns correctly encoded results and complete details; original history fingerprint and security advisor findings are unchanged. See [verification](../2026-11-01-readable-audit-details.md).

No rollback is necessary for a display encoding correction. If restoring an earlier application version, restore its function definitions in a new migration; do not rewrite audit records.
