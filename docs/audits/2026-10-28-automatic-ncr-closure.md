# Reinspection remarks and automatic NCR closure — 2026-10-28

## Outcome

Removed the separate package NCR verification form from `InspectionDetail` and deleted its unused `NcrInspectionVerification` component. Before Start there is no NCR decision textbox. During reinspection the inspector has one optional Remarks box (the existing inspection summary field), saved at confirmed sign-off. Historical remarks remain readable. Item-specific failure/N/A reasons and normal inspection checks remain.

The private invoker trigger `auto_close_reinspection_ncrs` runs within the existing authorized `complete_inspection` transaction. It matches project, pin and correction attempt to the exact inspection, then reuses `qa_ncr_verified_inspection` and `verify_defect`. Only the finding's own currently valid signed-off Pass closes its NCR. An unrelated failed criterion does not negate that Pass. Unsigned results, missing required evidence, N/A, unrelated requests and stale Passes cannot close a finding. Failed checks reuse the existing rejection path; N/A returns its NCR for correction, avoiding a stranded package after removal of the manual decision form. Standalone NCR verification remains unchanged.

The generated closing note includes the IR number and any Remarks. Existing closure events, inspector attribution, notifications and checklist-completion gates remain. There is no separate frontend NCR write. Manual Complete checklist is still required after QA and NCR blockers clear.

## Deployment and approved historical update

- `20261028081041_auto_close_reinspection_ncrs` applied to BuildTrack `ruimjlhsfpaezkgfphsz`; CLI filename aligned to connector version.
- The owner explicitly chose **Also close existing passed NCRs**. A read-only preflight identified one eligible historical finding. `20261028081533_close_existing_passed_reinspection_ncrs` closed it and recorded an automatic closure event, with NULL system event actor and the original signed-off inspector in `closed_by`. Original sign-off time appears in the closing note, not as a backdated closure timestamp.
- NCR-0005's own criterion passed in IR-0007 even though another criterion made the overall inspection Failed. It alone qualified. Remaining failures were not closed. The backfill uses the same exact-finding readiness guard, is idempotent and never accepts a checklist or completes a pin.
- Future sign-off migration and rollback smoke preserved byte fingerprints: 11 NCRs, 15 inspections, 77 result rows and 15 submission snapshots. After the explicitly approved historical closure, inspection/result/submission fingerprints remain unchanged; only the eligible NCR's current closure state and associated audit/notification records changed.

## Verification

- `pnpm check` passed: TypeScript, all app/component/model suites, 483 SQL cases and production build before the optional historical backfill was added. After adding the approved historical migration, 484 SQL cases pass, including the backfill's positive/negative/idempotence/history checks.
- Actual component tests cover no pre-start form, one optional reinspection Remarks box, exact inspection + remarks sign-off payload, cancel safety, server rejection, read-only other inspectors/roles, saved remarks, no separate closure calls and preserved standalone NCR/manual checklist behavior.
- SQL covers unsigned Pass, required-photo failure, unauthorized inspector/outsider, private helper, transaction rollback, exact-finding Pass despite unrelated failure, N/A return, actor/remarks/history/notification, retry without duplicate closure, optional empty Remarks, unchanged original evidence and manual checklist completion.
- Live authenticated Engineer/Foreman rollback smoke returned `AUTO_NCR_REINSPECTION_SMOKE_OK_ROLLED_BACK`. It created only transaction-local synthetic records and confirmed closure + Remarks + audit + manual completion; nothing retained.
- Security advisors unchanged: 4 no-policy INFO, 94 existing authenticated-definer WARN, 1 leaked-password-protection WARN. New helper is `security invoker`, empty search path, not executable by anon/authenticated. No grants, RLS, storage or existing signed-off results changed. Existing notices are tracked; [Supabase advisor guidance](https://supabase.com/docs/guides/database/database-advisors).
- No signed-in browser visual acceptance test performed. No commit or push requested/performed.

Supabase guidance informed current documentation/changelog checks, server-side verification and private invoker design. Postgres guidance informed stable NCR lock ordering and least privilege; no dependency, authorization or inspection-scope expansion was needed. [Function security reference](https://supabase.com/docs/guides/database/functions).

## Rollback

Use a new migration to disable the new trigger only after restoring an explicit safe verification path. Preserve recorded closures, evidence and audit events. Do not blindly reopen historically backfilled findings; any correction must be reviewed and audited. No rollback executed.
