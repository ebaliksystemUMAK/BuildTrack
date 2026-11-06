# Optional schedule-save reason

File: `supabase/migrations/20261106144417_optional_timeline_save_reason.sql`. Status: applied 2026-11-06. Depends on the Gantt schedule writer and the optional approval/publication-reason migration.

Purpose: allow a PM to save a task schedule with a blank reason.

Objects: replaces `save_timeline_item(uuid,text,jsonb,integer,text)`. Blank/null reasons are normalized to an empty string. The existing schedule-manager permission check, internal writer, audit trail and 500-character maximum remain.

Verification: live function definition was read back. Gantt component and TypeScript checks passed. SQL regression coverage accepts a blank save reason and rejects reasons over 500 characters.

Rollback: a separately reviewed replacement can restore the previous minimum-length requirement for future saves. Existing audit records should remain intact.

Limits: this UI change leaves schedule-change request validation unchanged. No schedule dates were changed by applying the migration itself.
