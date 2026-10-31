# QA submissions from short area names

| Field | Value |
|---|---|
| File | `supabase/migrations/20261029190310_short_work_qa_titles.sql` |
| Written / applied | 2026-10-30 (Manila), applied and tracked as 20261029190310 |
| Depends on | `20261020072554_concurrent_checklist_qa.sql` |
| Status | Applied; 534 SQL tests pass; exact live request verified in an authenticated rollback transaction |
| Reversible | Restore the previous internal function body in a follow-up migration; no data conversion is needed |

## Purpose

The Foreman's CR-FLOOR QA request failed with HTTP 400. Postgres logs identified `qa_inspections_title_check`: the generated title was `CR`, a valid two-character pin title, while inspection titles require at least three trimmed characters. The submitted evidence and remark were valid.

## Objects and behavior

`request_work_item_inspection(uuid,uuid,text,uuid,uuid[],text)` now trims and bounds its generated title to 160 characters. Titles shorter than three characters receive a readable label, such as `QA inspection: CR`; an empty trimmed legacy label becomes `QA inspection`. Ordinary titles remain unchanged. The notification uses the same normalized title. Initial submissions and correction packages both use this internal creator.

Pin names, evidence requirements, public RPC signatures, standalone inspection validation and existing QA records are unchanged.

## Security

The creator remains `SECURITY INVOKER`, owned by `postgres`, with an empty search path. Its original ACL is preserved: `postgres` and `service_role` only; `PUBLIC`, `anon` and `authenticated` cannot call it directly. Existing Foreman assignment, project access and evidence checks remain in the checked submission RPCs.

## Verification and rollout

- Added three SQL regression cases. Before the fix, both short-title submission cases failed with the reported constraint error; after the fix all **534 tests pass**.
- Covered CR submission, evidence requirements, Engineer submission denial, Engineer notification, failed inspection followed by correction reinspection, trimmed/blank legacy labels, unchanged normal/maximum-length labels, unchanged pin names and internal helper privileges.
- Applied only the new function replacement and its migration-history row to BuildTrack (`ruimjlhsfpaezkgfphsz`) in one transaction. A guard verified the inspected old function hash before replacement. No old migrations were rerun.
- Live function body and tracked migration statement match the local SQL exactly. SHA-256: `fb513944cf410e38073d35ab7929e3425581a3a8e4a797f880e561dcc6f4b0d4`.
- Ran the exact CR-FLOOR submission as the assigned authenticated Foreman in a rollback transaction. It created `QA inspection: CR`, queued the item for review and captured the existing photo. The transaction was rolled back so the user can submit normally.
- Before/after fingerprints match for pins, checklist items, photos, inspections and submission snapshots. No QA request or notification from the verification was retained.
- Security and performance advisory categories/counts are unchanged. Existing security findings: 4 no-policy INFO, 118 authenticated-definer WARN, 1 auth WARN. No new grants or definer functions were introduced.
- Supabase guidance informed documentation checks, live log/schema inspection, restricted privileges and the rollback verification. No frontend deployment is required.
