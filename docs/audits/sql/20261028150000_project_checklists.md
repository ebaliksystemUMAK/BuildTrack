# Project checklists

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028150000_project_checklists.sql` |
| Written / applied | 2026-10-28 / applied and tracked 2026-10-28 via BuildTrack connector |
| Depends on | 0022 settings, 0025 QA, 20261019093602 standards, 20261020072554 work item criteria |
| Status | Applied; 515 SQL tests, model tests, 5 function-body comparisons, grants and live authenticated rollback smoke verified |
| Reversible | Reviewed follow-up migration required. Removed copies and their criteria are recoverable from audit_log 520; do not remove evidence/history |

## Purpose

Keep each work item's hidden criteria copy out of the project's checklist set, stop leaving unused copies, and document the standards a checklist cites.

## Objects

| Object | Behavior |
|---|---|
| `qa_templates.work_item_criteria` | Backfilled from the copy's fixed description; set by `save_work_checklist_item` |
| One-off delete | Flagged copies referenced by no pin, work item, inspection or submission (live: 2 "LIVING ROOM / LIVING ROOM-PAINT" on TST-002) |
| `guard_work_item_criteria` (BEFORE UPDATE) | A flagged copy cannot be saved or archived as a checklist (a cleared `created_by` is still allowed) |
| `remove_unused_work_item_criteria` (AFTER UPDATE OF qa_template_id / DELETE on `pin_checklist_items`) | Removes the replaced / orphaned copy when nothing refers to it |
| `save_work_checklist_item(..., p_standards text[] default '{}')` | Same rules as before; keeps up to 10 cited standards (2-40 characters each) on the copy; 4-argument calls still work |
| `set_setting` | Same as 0022, plus optional `source` per standard: https, up to 300 characters |
| `fill_documented_standard_sources()` | Internal; adds the 7 documented official links where missing; run once |

## Security

No new API grant except the new `save_work_checklist_item` signature (authenticated only, as before). Internal functions are not callable by `anon` / `authenticated`. Project checklists keep their existing rules (Engineer of the project; library: Super Admin with MFA).

## Verification

`supabase/tests/99-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-project-checklists.cases.mjs`: flagging, one copy per work item after re-saves, cited standards (trim, limits), refusal to edit / archive a copy while project checklists still can, no orphan left after all suites, source filling (only missing, idempotent, nothing invented, internal only), `set_setting` source validation.

## Live rollout — 2026-10-28

This is a current backend dependency of the existing project-checklist feature, not an old checklist-QA migration. Before deployment the editor fell back from `p_standards` and discarded citations; the new optional fifth parameter now persists them. Existing four-argument calls still work.

The owner approved cleanup. In one transaction, audited recovery copies of the two exact unreferenced templates and four criteria were saved in `audit_log` row 520, the unchanged migration was executed, and its original version 20261028150000 was recorded. The preflight refused any different cleanup candidate set. Template count 18 → 16; criteria 101 → 97; four retained criteria copies flagged; zero unreferenced copies remain. Seven existing catalog entries gained documented sources.

Authenticated synthetic rollback smoke verified four-argument compatibility, trimmed citations, replaced-copy cleanup, library/archive rejection, Foreman denial and read-only Engineer denial. Existing pins, inspections, results, submission snapshots, NCRs and blueprint-access fingerprints are unchanged. Security advisors remain 4 no-policy INFO, 106 authenticated-definer WARN and 1 auth WARN. No old migration or blueprint-access DDL was rerun. See [rollout audit](../2026-10-28-migration-review-and-cleanup.md).
