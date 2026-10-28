# Inspection sections and previous reinspection results

## Outcome

`InspectionDetail` now defaults to Checklist rather than a long mixed page. Its sections are Checklist (score, current checks, results/photos and remarks), Submitted evidence (the immutable Foreman snapshot), Details & schedule (requester, inspector, dates, standards/note, work-item links and scheduling), NCRs (the existing records raised by this inspection) and History (timeline). Reinspections add Previous results. Tabs exist before Start, while inspecting and for read-only completed records. Footer Start/Complete/Cancel actions remain available independently of the selected tab; missing results/photos return to Checklist.

The tablist wraps on narrow screens and has linked tab/panel ARIA ids, roving focus, Left/Right/Home/End keys and a selected focus target. Hidden panels remain mounted so changing tabs does not discard an item draft or inspection remarks. The shared modal excludes hidden/inert panels from its initial focus and Tab loop, verified by hidden-control regression tests. Another request defaults to Checklist. Existing editable/read-only role and inspector rules, cancellation, sign-off and automatic NCR closure remain unchanged.

## Previous results

The existing `qa_reinspection_context` RPC supplies exact frozen prior criteria. It is now enabled for all requests with `reinspection_of`, not only new full-checklist requests. The dedicated panel displays previous Pass/Fail/N/A/Pending, recorded measurements and tolerance, previous remarks, requirements, checked time (Manila) and person, plus original inspection/evidence links. Results are immediately visible, not behind a collapsed details control. Full-checklist and older stage reinspection scope explanations differ; previous results are reference-only and never populate current results or bypass fresh evidence requirements.

No database schema, migration, grant, RLS, result, evidence or closure-state changes were made. Supabase guidance informed reusing the existing authorized reader and verifying real historical fields instead of duplicating records or inferring a prior overall score. [Function reference](https://supabase.com/docs/guides/database/functions).

## Verification

- Focused actual-component tests pass for tab order/default, one visible panel, separate evidence/scheduling content, preserved remarks, availability before/during Start, persistent footer actions, keyboard/ARIA wiring, request reset, initial inspection skipping history, stage history lookup and pending-result routing back to Checklist.
- Previous-results component tests cover expanded read-only fields (including a zero measurement), previous Fail and remarks, original-record links, no inputs/scope editor, correct stage/full wording and loading/error/retry behavior. Existing keyed/stale-response history tests pass.
- Existing Start/Cancel/automatic NCR closure/manual checklist tests remain in the regression suite.
- Live authenticated read returned `INSPECTION_PREVIOUS_RESULTS_READ_OK`, verifying previous result, IR number, remarks, measurement and checked-time fields from an accessible actual reinspection. Transaction rolled back; no retained writes.
- Full `pnpm check` verifies TypeScript, application/component/model suites, 486 SQL cases and production build. No signed-in visual/browser acceptance test performed. No commit or push requested/performed.
