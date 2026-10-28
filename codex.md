# BuildTrack development handover

Updated: 2026-10-26.

Read this alongside `AGENTS.md`, `README.md` and the task-specific audit in `docs/audits/`. This file records current project decisions; it is not an application entrypoint or a database migration. Check the implementation and tests before treating an older document as current behavior. In particular, older handover text mentioning a required Ready tick or a separate Accept action is outdated.

## Project and development

- Frontend: React 19, TypeScript, Vite 8 and Tailwind CSS v4.
- Backend services: Supabase PostgreSQL, Auth, private Storage, Realtime and Edge Functions. Brevo sends email; it is not the application backend.
- Start with the paths in `AGENTS.md`. Role pages are in `src/pages/<Role>/`; shared application navigation/layout lives in `src/components/shell/`.
- The development server is already running on the configured port, normally 8443. Do not start a duplicate server.
- Preserve unrelated working-tree changes. Never commit credentials, `.env` secrets, private keys, local caches or generated build output.
- Use existing shared components and styles. Keep UI wording consistent between Engineer, Foreman and Client.

## Current QA workflow

Cancelled QA requests can be continued by the project Engineer from inspection details, retaining recorded results/evidence and cancellation history. The checked start RPC restores submitted items and the exact cancellation-return NCRs atomically, rejecting changed work, newer drafts/submissions or later NCR decisions. See `docs/audits/2026-10-28-continue-cancelled-inspections.md`.

1. The Engineer creates checklist items and supplies their inspection criteria/tests. Requirements should describe the actual work item, not a broad trade label or invented standard clause.
2. The assigned Foreman opens an item, adds its photos/remarks and submits that item directly for QA. No separate Ready tick is required.
3. The Engineer inspects against the recorded criteria. Failed findings create linked NCRs; corrections require a full reinspection of that same checklist, including previously passed checks, not the whole project or unrelated checklists. Earlier results/evidence stay attached to their original inspections.
4. After QA passes and linked NCRs are closed, the Engineer explicitly chooses **Complete checklist**. Passing QA or closing an NCR must not automatically perform this manual action.
5. The work pin completes only when all checklist items and the applicable pin-level QA/NCR prerequisites are clear.

Important constraints:

- There is no separate user-facing Accept status/action. The summary rail is **Submitted -> Passed -> Completed**. Legacy `review_status='verified'` storage and `review_checklist_item` with `p_accept=true` remain implementation details; do not casually rename stored values or rewrite history.
- A pending request for one checklist item must not block another eligible item on the same pin. Do not restore a blanket whole-pin pending block. Duplicate active requests for the same item and guarded legacy/stage routes remain subject to server checks.
- The Engineer must be able to add eligible checklist items while other work awaits QA; preserve existing evidence and completion safeguards.
- Every original request/resubmission keeps its own immutable photos, remarks, timestamps, result and timeline. New correction evidence must not overwrite old submissions.
- An **Away from site** photo still counts as evidence and the Engineer can open it (owner's decision, `20261023075351`; message follow-up `20261023075625`). It keeps its flag, distance and amber chip. Only a wrong phone clock (`clock_ahead`) or a photo more than 3 days old (`old_photo`) stays on record without counting and stays hidden from Engineers. SQL `photo_eligible` and TS `photoEligible` must stay identical.
- Evidence and Corrections & NCRs tabs must show actual linked records, with explicit empty/loading/error states. Link by permanent item IDs, not just names.
- Preserve the original-versus-latest comparison. Clicking for a larger view must not replace/remove comparison functionality or its details.
- Engineer/Foreman QA boards put **All** last and open on the first available nonempty list, not All. All remains an explicit choice. If a chosen list disappears, fall back to another available list; switching projects remounts the board to reset its filters/selection. Each Review inbox list remains separate: work-item chips (Inspect, NCRs, Complete checklist, Criteria missing) and `WorkItemBoard` extras (Other NCRs, Blocked work, Older submissions, Recently completed).
- Foreman **Corrections** has To fix, In review, **Completed**, Other NCRs and Site issues. Completed stays available at zero and means Engineer-completed checklists, never merely Passed QA or a closed NCR. Correction resubmissions in Requested / In progress / Passed remain In review even without a For verification NCR. Mixed NCRs needing Foreman work stay in To fix, not two lists at once.
- Foreman correction submission confirmation uses a medium dialog, **Submit correction?** title and compact **Submit request** action so Cancel and Submit align without the previous long, unevenly wrapped button. Keep the full-checklist reinspection/NCR explanation intact. Other confirmations retain their default small size.
- Corrections Sheet / Pin / Checklist item / search filters apply to work rows **and** its Other NCRs / Site issues extras, using permanent ids. A new sheet clears pin/item; a pin chooses its parent sheet and clears item. Clear filters clears search too. Whole-pin or project-wide findings do not match a selected checklist item. Site-issue item + search must match the same observation. Counts and the Other NCR register/CSV follow the location filters; the register retains its own status/class/trade/assignment filters and closed history. Other NCRs counts open ones assigned to the Foreman and stays reachable at zero with older records. Detail dialogs/deep links live outside filtered lists; refresh reloads QA, pins/sheets, work items and issue history, with load errors shown. See `docs/audits/2026-10-26-foreman-corrections.md`.
- Extras opt into shared work filtering via `BoardExtra.filter` and their filter-choice ids. Legacy non-filterable extras still step aside while shared filters/search are used. Stage/hold-point request panels were removed from these boards, not historical data or database completion checks; blocked inspections remain accessible in the QA register.
- **For review** belongs to checklist QA presentation, not a displayed pin-level status. Keep underlying status/authorization logic intact.
- Engineer checklist cleanup (2026-10-26): NCR rows in `WorkItemWorkspace` are summaries with **Open NCR record**, not inline verification forms. Do not restore the **Review NCR corrections** footer shortcut. Hide **Return [item]** once current QA is Passed, including a Return dialog already open when the status changes; retain the separate explicit **Reopen [item]** action for completed checklists. Manual Complete checklist and all NCR/completion blockers remain. See `docs/audits/2026-10-26-engineer-checklist-actions.md`.
- NCR reinspection update (2026-10-28, supersedes the 2026-10-26 decision form): package NCR details still open the exact linked correction inspection, but `InspectionDetail` no longer renders `NcrInspectionVerification` (deleted). No NCR verification form before Start; the current inspector gets one optional **Remarks** box during inspection. Confirmed sign-off atomically closes only package NCRs whose own exact, fresh linked finding has a signed-off Pass; failed findings remain in correction, N/A returns for correction without closure. Remarks, actor, closure events and notifications use existing guards; no browser-side close request or manual Close NCR button. An unrelated failed check does not invalidate another finding's valid Pass. Checklist completion remains manual. Standalone NCRs retain their explicit verification path. Migrations `20261028081041_auto_close_reinspection_ncrs` and owner-approved historical backfill `20261028081533_close_existing_passed_reinspection_ncrs` are applied and verified; one existing qualifying NCR closed, without rewriting inspection/evidence history. See `docs/audits/2026-10-28-automatic-ncr-closure.md`.

Relevant files: `src/lib/workItemModel.ts`, `src/lib/workItem.ts`, `src/components/qa/WorkItemWorkspace.tsx`, `WorkItemBoard.tsx`, `SubmittedEvidence.tsx` and `WorkSubmissionEvidence.tsx`.

- Engineer NCR start/cancel refinement (2026-10-28): package NCRs awaiting verification have one footer **Start inspection** action instead of the body Open inspection button and Close window footer. It uses the exact linked id and existing checked `start_inspection`, refreshes canonical state then opens that inspection. Already-started requests show **Continue inspection**; finished requests show **View inspection results**. Missing/error/loading links and non-active/non-Engineer profiles cannot start; duplicate clicks and late navigation after header dismissal are guarded. Header ×/Escape remain. Inspection cancellation opens a focused reason dialog (minimum 5 characters), keeps input on server failure, prevents duplicate/in-flight dismissal, and refreshes only after success. Migration `20261028084938_return_cancelled_reinspection_ncrs` atomically returns only the cancelled request's For verification package NCRs to correction, preserving evidence/history and existing permissions. No backfill. See `docs/audits/2026-10-28-ncr-start-and-cancel.md`.

### Full-checklist corrections and reinspection (2026-10-25)

- Inspection dialog tabs (2026-10-28): `InspectionDetail` opens on **Checklist** with score, criteria/results and inspector remarks; separate **Submitted evidence**, **Details & schedule**, **NCRs** and **History** panels keep the dialog compact before/during/after inspection. Reinspections also show **Previous results** via the existing exact-id history RPC, including older/stage reinspections. That tab displays recorded Pass/Fail/N/A, measurements/tolerances, remarks, checked time/person, requirements and original-record/evidence links without a collapsed details control. History is read-only and never counts as the new result; full-checklist vs stage-scope copy stays distinct. Panels remain mounted while hidden to preserve draft input, support keyboard/ARIA tabs and reset selection for another request. Footer Start/Complete/Cancel remains accessible. No DB/migration or permission changes. See `docs/audits/2026-10-28-inspection-section-tabs.md`.

- Deployment: migration `20261025141322_full_checklist_reinspection` applied and live-verified on BuildTrack Supabase. Matching frontend changes are local, tested, not committed/pushed. Original history fingerprints remained unchanged; see the audit for checks/security notices.

- The owner replaced the earlier unapplied targeted-only proposal with **full checklist reinspection**. Wall corrections recheck every recorded Wall criterion at that pin, including earlier Pass/N/A checks. Unrelated Floor/Ceiling items are not silently resubmitted.
- Foreman uses **Submit correction & request reinspection**: choose the NCRs actually corrected, describe the repairs and add fresh eligible evidence. NCR selection identifies corrective actions, **never narrows the inspection scope**. Requests from different previous inspections remain separate.
- The new request contains all frozen criteria as fresh Pending checks. Required measurements, tests and per-check photos must be recorded again. Previous inspection results, photos, correction attempts and submission snapshots remain unchanged. The new `full_checklist_reinspection` flag identifies these requests; `origin_item_id` retains exact criterion lineage without rewriting older rows.
- `qa_reinspection_context` supplies reference-only prior results with original-inspection links; no scope editor or automatic carry-forward Pass exists. Older selected findings without reliable lineage include their exact frozen source as well, rather than being silently dropped.
- Repeated failures of the same linked open finding reuse its NCR with a rejection event. A newly failed or previously closed finding creates a new NCR. NCR closure requires its own signed-off Pass after the repair, not another finding's result. A newer pending/failed check of that same criterion invalidates an older Pass.
- `qa_ncr_reinspection_state` is the authorized readiness read; responses are keyed by finding + correction attempt so late results cannot enable another NCR's closure. Server guards recheck on save. One finding may close after full-inspection sign-off even if another failed, but those remaining failures still block checklist completion.
- Manual **Complete checklist** remains a separate Engineer action after QA passes and all linked NCRs close. This is not project acceptance or a substitute for the approved quality plan, required tests, specialist/design approvals and handover inspections.
- Files: `src/lib/qaReinspection.ts`, `qaReinspectionModel.ts`, `components/qa/ReinspectionScope.tsx`, correction/inspection/NCR/work-item components and `qaPrint.ts`. `pnpm test:qa-reinspection` is in the full check. See `docs/audits/2026-10-25-full-checklist-reinspection.md` for deployment and verification status.

## Reports, progress, assignments and issues

- Daily Progress Report (2026-10-28): Foreman headcount is now read-only, from distinct biometric Time IN workers on the selected project's Manila report day. Time OUT does not subtract a worker; ignored scans and imported totals do not contribute. The database rechecks on draft save/submission. Historical/submitted counts remain fixed during Engineer review/return; a corrected resubmission gets a fresh count and retains earlier revisions. Report photos use live camera capture only, then the existing annotation editor; original bytes, capture timestamp, caption and validated overlay are saved together. Unsaved captures lock report submission/date switching. Migration `20261028064248_daily_report_camera_biometrics` is applied and live-verified. See `docs/audits/2026-10-28-daily-report-camera-biometrics.md`.

- Client **Communication → Site visits** (2026-10-28): preferred Manila date/time, purpose, visitor count; own request history and cancellation. Assigned Engineers respond in **Site Logs & Reports → Site visits** (Confirm / Decline with required message). Database notifications link to the exact request; decisions/cancellation are conditional and server-guarded. `site_visit_requests` is RLS-private to the assigned active Client/Engineer roles; request identity/details remain immutable. Migration `20261028061346_client_site_visits` is applied and live-verified. No duplicate calendar source was introduced. See `docs/audits/2026-10-28-client-site-visits.md`; `pnpm test:site-visits`.

- Site Logs reads real Foreman Daily Progress Reports. QA activity does not automatically create a daily report.
- Submitted reports retain linked pins/checklists and their historical snapshots. Older reports outside the editing window remain available read-only.
- Progress uses completed work pins, excluding notes. Checklist completion contributes to completing its pin; do not silently substitute a checklist-percentage or quantity-weighted progress formula.
- Calendar filters (`components/ui/DateRangeFilter.tsx` + pure `lib/dateRangeModel.ts`, Manila days, weeks Monday to Sunday, kept in `?from=&to=`):
  - Progress by Zone filters work pins by **due date**. Pins without a due date are left out and counted in the note, which also shows how many pins were verified on those dates. Stat cards, zones (empty ones hidden), disciplines, deadlines and CSV follow the filter; the S-curve stays whole-project.
  - The Engineer QA register shares a calendar filter across Overview, Inspections (requested), NCR register (raised) and Client reports (reported). Search, filters and CSV follow it. Overview cards, attention, recent inspections, trade breakdown, trends and printed summary follow the period using current status, not an end-of-period historical snapshot. All dates restores server summary figures. Filtered check counts use a paginated, authenticated/project-scoped read of inspection results, never inferred NCR counts; incomplete/failed reads show an error instead of partial figures. Filtered trends cover the whole interval; URL dates survive refresh and Back/Forward. Tab badges remain whole-project and Foreman QA pages are unchanged. See `docs/audits/2026-10-23-qa-overview-calendar.md`.
- Progress by Zone and Assignment Board must use the same project-scoped pin records. Assignment lists include completed work by default and support assigned/unassigned, sheet and status filtering.
- Confirm assignment writes on the server, guard concurrent/stale saves and reload canonical records. Never show an optimistic reassignment as successfully saved after a rejected write.
- Project changes must discard late responses from the previous project. Preserve pagination and reconnect/live-update handling rather than relying on a first-page query.
- Engineer site issues link to a work pin and optionally its checklist item. Assigned Foremen read the same issue and preserved annotated evidence; do not create a disconnected duplicate issue source.

Relevant files: `src/lib/projectWork.ts`, `reports.ts`, `siteReportsModel.ts`, `src/pages/Engineer/EngineerAssignments.tsx`, `EngineerReports.tsx` and `src/components/DailyReportWorkflow.tsx`.

## Per-project calendar

- A Google Calendar-inspired **Project Calendar** lives inside each project's workspace, not a global cross-project page. Admin uses the project tab at `/admin/projects/<id>/calendar`; Engineer, Foreman and Client use `/engineer/calendar`, `/foreman/calendar` and `/client/calendar` with `?project=<id>`.
- Shared `components/calendar/ProjectCalendar.tsx` and scoped CSS provide Month, Week, Day and Schedule views, a mini calendar, Today/previous/next controls, search, category filters, completed toggle, day overflow expansion and linked event details. Date/view survive refresh and Back/Forward; the calendar starts on the current Manila date. Sunday-first grids follow the supplied reference; existing Monday-first report/date-filter rules are unchanged.
- This is a **read-only projection** of existing records, not Google-account integration: non-note work-pin `due_date`, inspection `target_at` (Manila time), NCR `due_date`, and project start/end dates. Do not invent meetings, report deadlines, appointment durations or dates for unscheduled records. Edit canonical records to change their schedules; no duplicate event table or new scheduling permissions.
- Engineer sees project work deadlines, scheduled QA/reinspections, NCR deadlines and milestones. Foreman sees assigned work/NCRs and inspections requested by them or linked to assigned pins, plus milestones. Admin sees management work deadlines and milestones. Client sees work deadlines/milestones only, with no internal QA/NCR details, staff identities, private remarks or evidence. Admin/Client calendars never request the internal QA/NCR tables.
- Reuses authenticated project reads, pagination, Realtime, reconnect/periodic reloads and existing RLS. Page checks actual active role; project IDs and canonical project objects are checked before deriving events. Loading/error states do not render stale events. Event links use permanent record IDs and the existing pin-panel deep links.
- Files: `src/lib/projectCalendarModel.ts`, `projectCalendar.ts`, `src/pages/ProjectCalendarPage.tsx`; test `pnpm test:project-calendar` is in `pnpm check`. See `docs/audits/2026-10-24-project-calendar.md`.

## Blueprint pin records

- Every location record links its project and blueprint pin by permanent id, and a checklist item where it applies:
  - site issues: pin required, item optional, name saved;
  - NCRs: pin, or Project-wide; item optional, name saved since `20261024152151`;
  - inspections: pin + `work_item_ids`;
  - client reports and questions: pin, or Project-wide;
  - daily reports: `linked_work`;
  - checklist / correction photos: pin + item + `qa_attempt_id`.
  The database validates that project, pin and item belong together. A renamed item shows its current name; a removed one keeps the saved name.
- The pin panel (`editor/Inspector.tsx` side panel, `PinDetailsModal` full view with detailed columns) shows the sections allowed per role (`pinSectionsFor` in `lib/pinRecordsModel.ts`): Details, Checklist & QA, Issues & NCRs (client: My reports), **Next actions**, Daily reports, Photos, Activity, Communication. Next actions is available to Engineer/Foreman/Client with role-specific content, not Admin. Its `?pintab=actions` link works in the side panel and Full view.
  - Clients never get Photos, Activity or any QA record; Admins read without actions.
  - Records load once per pin (`lib/pinRecords.ts`: paged, live, stale answers dropped) and the tabs show counts of what needs attention.
  - "For review" remains a checklist state.
- Issues & NCRs reuse the existing detail views with the same rights:
  - Engineer: verifies and closes NCRs, inspects, decides client reports, logs issues, raises NCRs.
  - Foreman: corrects NCRs through the NCR or the work item correction package, and reports a field problem (`report_field_problem`: pin timeline + Engineer notification; it never creates an NCR).
  - Client: follows own reports.
  - Do not add new approval paths here; the manual Complete checklist stays in the work item record.
- Issues & NCRs has a filter bar: Record type dropdown with counts, Status dropdown (All / Open / Closed), checklist item ("Whole work pin" included) and search. Creation/report buttons and the unfiltered Next actions list live **only in the separate Next actions tab**, not above the register. It reuses the same exact record dialogs and permissions; no action grants new rights.
  - "Open" means still waiting for someone: an NCR not closed, an inspection requested or under way, a client report waiting or being fixed, a site issue until its work pin is completed.
  - Rules live in `recordMatches` / `recordKindCounts`.
  - The Engineer sees a short explanation of Log an issue (flags the pin, shows the Foreman what is wrong, no number or deadline) versus Raise NCR (numbered, class, deadline, responsible Foreman, Engineer verifies and closes, blocks completion).
- Create forms opened from a pin start on its project, sheet and pin.
  - From other pages they use the shared searchable picker `ui/PinLinkPicker.tsx` (rules in `lib/pinPickerModel.ts`): only this project's work pins, dependent choices cleared, "Project-wide" only where the record allows it, and saving waits for the chosen pin's checklist.
- Panel refinements (2026-10-25):
  - Docked desktop panels default to 480px, resize from their left edge (320–760px, constrained to preserve sheet space) and remember width in editor preferences. Floating inspectors resize from the right. Mobile remains a nearly full-width drawer. The section body scrolls vertically beneath the pin heading/tabs; the separator supports arrow keys and Home/End.
  - Issues/NCR records use a **compact row-and-column summary table in both side panel and Full view**, not large cards or expanded details inside every row. Keep main fields only and limit summary text to two lines. Full descriptions, severity/raised/correction/closure notes and history belong in the opened record. Clicking a row, Enter/Space or View details opens its canonical dialog without duplicate events; existing operational permissions and own-open highlighting remain. Read-only summary-only records open a non-operational details dialog. Narrow tables scroll horizontally in a labelled keyboard-focusable region.
  - The Engineer may log an issue while QA is pending, even if the pin's position is locked. Notes and completed pins are still ineligible. The issue form shows loading/errors instead of an invisible wait. Migration `20261025090858_site_issue_pending_review` keeps stored `for_review` status when logging an observation; it does not cancel an inspection, unlock evidence or bypass completion gates. Normal non-review pins still change to Issue.
  - Pin Photos opens on today's **upload date in Asia/Manila** on each mount; `DateRangeFilter` allows older/custom/all dates. Bounds reach `useEvidencePhotos` before sorting/limiting. A filter change remounts the results/viewer to prevent stale photos or an old slideshow. Detailed cards show caption, item/remarks, uploader, capture/upload time and evidence kind; original and correction evidence remain separate. Global photo-documentation defaults and photo-editing tools are unchanged.
  - See `docs/audits/2026-10-25-pin-panel-refinements.md`.
- Every link to a pin uses `OpenOnBlueprint` / `pinPlanPath`, never a hand-built URL.
  - The link opens the role's plan page with `?project=&sheet=&pin=&pintab=<section>`; the editor opens that section once.
  - The assigned Foreman's "Add this pin to today's daily report" uses `?linkpin=` on Daily progress report, which never replaces an existing draft or changes a submitted one.
  - Panel **Daily reports** opens on **Today (Asia/Manila report work date)** on each mount. Shared `DateRangeFilter` supports Today, Last 7 days, week/month, earlier month, custom and All dates. Filter linked reports by `report_date`, not submission/photo timestamps; clients still see only submitted reports for this pin/project. Invalid ranges hide results until corrected; a date change remounts report details/slideshows, and another pin/reopening the tab resets Today. Tab badge remains the whole linked history count. See `docs/audits/2026-10-26-pin-panel-tabs-and-report-dates.md`.
- Tests: `pnpm test:pin-records`, pin sections and picker rules in `pnpm test:lib`, SQL in `99-zzzzzzzzzzzzzzzzzzz-pin-record-links`. See `docs/audits/2026-10-24-pin-record-connections.md`.

## Client portal

- Open an accessible assigned project automatically instead of requiring an assigned-project card click. Provide a switcher when the client has multiple accessible projects; preserve project scope in navigation.
- A selected blueprint pin exposes submitted daily reports explicitly linked through `daily_reports.linked_work`. Exclude drafts, unrelated pins and other projects.
- Report photos use slideshow navigation, a larger viewer and a details icon. Photos belong to the whole report unless a more specific link is actually stored.
- Problem reports can link to a project work pin and contain annotated photos. Retrying failed photo uploads must reuse the saved report, not create duplicate reports.
- Engineer acceptance of a client problem report preserves its pin on the resulting NCR. Original client evidence stays separate from subsequent correction evidence.
- Communication is the private client question/Engineer answer workflow, with project/pin links and exact-question notifications. Do not expose one client's private questions to another client.

Relevant files: `src/pages/Client/`, `src/components/client/PinDailyReports.tsx`, `src/lib/clientPortalModel.ts` and `src/lib/snags.ts`.

## Shared photo editing

- One editor for every editable-photo flow: site issues (Log an issue, Add issue photos, Edit markup on saved issue photos), client problem reports and QA / NCR evidence (`EvidenceStrip`). Upload flows go through `src/components/issues/IssuePhotoPicker.tsx`, which opens `IssuePhotoEditor.tsx` on all chosen photos. Read-only views (client report photos, old issue-photo versions) use the same editor with `readOnly`.
- Editor API: `photos` (`{ id, src, annotations, caption }[]`), `start`, `readOnly`, `title`, `captionLimit`, `onSave(changes)`. Save returns only the photos whose markup or caption changed; saving with no changes just closes (no new issue-photo version).
- Preserve the original photo and save validated text, lines, arrows, shapes and freehand annotations as a separate overlay. Do not flatten over or replace the original.
- Layout follows the blueprint editor. `PhotoEditorToolbar.tsx` is one compact icon toolbar with tooltips: (slideshow controls) | Select, Pan | Text, Shapes dropdown (Line, Arrow, Rectangle, Ellipse, Freehand) | Undo, Redo | View original | zoom − % + Fit Fill | fullscreen. The active tool is filled in brand colour. `MarkupProperties` (colour swatches + custom colour, line width or text size S/M/L/XL, text, delete) shows only while a drawing tool is active or a mark is selected. Changes to a selected mark apply at once; a slider drag or typing run is one undo step, each colour or size pick is its own. No pins, tape or other blueprint-only actions.
- Shortcuts: V select, H pan, T text, L line, A arrow, R rectangle, E ellipse, D freehand, Del delete, Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), Page Up / Page Down between photos. They are ignored while typing in a field.
- Select, move, rotate (like the blueprint editor):
  - After placing text or finishing a shape, the tool returns to Select and the new mark stays selected.
  - Every mark has a wide invisible grab area (a band around thin outlines, a box around text), so it is easy to pick up.
  - A selected mark shows a dashed frame, turned with the mark, and a round rotate handle above it. Drag the mark to move it; drag the handle to rotate (Shift snaps to 15°).
  - The properties bar has Rotate left / right 15° and a degrees field; `[` and `]` rotate by 15°; arrow keys nudge 0.5% (Shift 5%). A handle drag, a typed angle or a run of arrow presses is one undo step.
  - Rotation is the optional `rotation` key (degrees, around the mark's own centre from `markupBox`, stored -180..180, dropped at 0), allowed by `valid_issue_markup` since `20261021151557`. Every viewer and thumbnail draws it through `MarkupLayer`.
- Several photos open as a manual slideshow: "Image n of N" with Previous / Next (no wrap-around, never automatic) and a collapsible numbered thumbnail strip (`PhotoSlides.tsx`, like the sheet sidebar; a row above the photo on phones) with the current photo highlighted and an "edited" note. Each photo keeps its own markup, caption and undo / redo history (`src/lib/photoEditorModel.ts`, pure and tested). Fullscreen and the chosen tool stay when moving between photos. A single photo shows none of these controls.
- Unsaved work is protected: closing the editor with changes asks (`useConfirm`); the picker asks before removing a photo that has markup or an edited caption; Escape leaves fullscreen first.
- Work item / correction photos (`pin_photos`, Foreman **Corrections** correction package and the work item checklist):
  - The upload button (`ChecklistUploadButton` / `PinPhotos` in `editor/PinParts.tsx`) opens `components/issues/MarkupUploadDialog.tsx`. Chosen photos are shrunk first (`preparePinPhoto`, JPEG 1600 px), marked up in the same picker / editor, then added one by one; failures stay to retry.
  - Each photo keeps its link to the checklist item and correction (`qa_attempt_id`) and carries its caption and `annotations` (`20261023073942`, checked by `valid_issue_markup`, no UPDATE policy, so fixed once saved).
  - Without signal it waits in the offline queue with its markup (`lib/offlineQueue.ts` sends caption and annotations; older queued photos still send).
  - QA submission snapshots copy the whole row, so submitted evidence keeps its markup. Thumbnails (`PinPhotos`, `PhotoGrid`) and `PhotoViewer` draw it.
  - NCR evidence on the same page uses the QA `EvidenceStrip` dialog (`qa_photos.annotations`).
- `src/lib/canvasView.ts` shares the blueprint sheet's fit/zoom mathematics with `src/components/editor/StageCanvas.tsx`. Zoom limits are 5%-1000%, multiplicative 1.3x buttons. Every photo opens with **Fit** (whole image, padding, never cropped or stretched). **Fill** covers the canvas only when chosen and stays chosen for the next photo; manual zoom/pan stays stable across fullscreen changes.
- The canvas gets most of the space: 56vh on phones and 64vh beside the thumbnails on wider screens (minimums 18-20rem); in fullscreen it takes all remaining height. The dialog body still scrolls to the caption and hints on small screens.
- Ordinary mouse-wheel scrolling moves through the editor. Ctrl/Command + wheel zooms toward the cursor. Keep button zoom, Pan/Select/Space/middle-button drag, touch pinch and keyboard controls working.
- Fullscreen uses an icon button. Escape leaves fullscreen first without discarding unsaved markup. The fullscreen caption disclosure leaves more room for editing.
- Keep the photo and SVG overlay in the same transformed stage so annotations stay aligned at every scale. `MarkupLayer` lives in `MarkupLayer.tsx` (re-exported by the editor) for thumbnails and viewers.
- `ui/Popover.tsx` panels share the dialogs' z-900 layer, so dropdowns opened inside a dialog appear above it and stacking follows opening order.

## Workforce and biometric attendance

- ESP32 setup (2026-10-27): the owner's board is a classic DevKit V1. Start hardware bring-up with `hardware/esp32-as608/connection_test/connection_test.ino` and `FIRST_UPLOAD.md` (RX16/TX17, 57600 sensor baud, 115200 monitor). This diagnostic only captures/searches locally; it must not enroll, delete templates or send attendance. Website-driven enrollment remains in `attendance/attendance.ino`, which needs a private `config.h` before operation. The example config permits compilation but must stop at boot with placeholders. See `docs/audits/2026-10-27-esp32-as608-setup.md` for actual toolchain/USB/verification findings; compilation is not physical verification.
- Fingerprint registration (2026-10-27, [audit](docs/audits/2026-10-27-fingerprint-registration-steps.md)): the ESP32 trusts the three roots in `hardware/esp32-as608/tls-root-ca.pem` (GTS R4, GTS R1, GlobalSign Root CA). Check the chain the server really sends with `openssl s_client -CAfile`, not a Windows chain build. HTTP -1 on the device with an empty `last_seen_at` = TLS/root CA problem. Admin flow: scanner online badge, confirm the worker is present, live steps from the device (`worker_enrollment_requests.stage`, migration `20261027110000_enrollment_progress`, applied 2026-10-27, `biometric-enrollment` v2 deployed), a third confirmation scan before success. An unconfirmed template is removed by the device (it would otherwise match scans and block the terminal with 422). Rules in `lib/enrollmentModel.ts`.
- Attendance scans (2026-10-27, [audit](docs/audits/2026-10-27-attendance-schedule-scans.md), migration `20261027130000_attendance_schedule_scans` applied 2026-10-27, `biometric-attendance` v2 deployed): the database decides Time IN / OUT (`record_biometric_scan`, worker row lock), never a scanner switch. First accepted scan of the Manila day = IN, then alternate. A scan within the project's repeat window (default 15 min) or older than the worker's last scan goes to `attendance_ignored_scans`, never to attendance. Admin sets time in / out, grace and the window in Biometric Registration → Attendance schedule (`set_attendance_schedule`). Events carry `schedule_flag` / `minutes_off` (late = first IN after grace, minutes from time in; early_out = OUT before time out; returned = later IN). Labels in `lib/attendanceScheduleModel.ts`. Deploy order: migration → `biometric-attendance` (calls `ingest_biometric_scan`) → firmware (`"direction":"auto"`). The standalone attendance page was not changed.
- Scan pop-ups (2026-10-27, [audit](docs/audits/2026-10-27-attendance-scan-popups.md), migration `20261027152428_attendance_scan_notices` APPLIED; receiver v3 ACTIVE): the attendance screen (`AttendanceBoard` → `ScanNoticePopup`, hook `lib/scanNotices.ts`, texts `lib/scanNoticeModel.ts`) pops up "Time IN/OUT recorded", "Already timed IN/OUT … not recorded again" and "Fingerprint not registered / not linked / Worker inactive / Wrong scanner" for scans received after it opened, queued once each without replacing the visible message, closing after 6 s (warnings 10 s). This is an explicit request to change the standalone screen. Unregistered scans never raise: they are logged in `attendance_unregistered_scans`, so the scanner never stops on them.
- Daily time record (2026-10-28, [audit](docs/audits/2026-10-28-attendance-daily-time-record.md), migration `20261028010000_attendance_daily_status` applied 2026-10-28): one Time in + one Time out per worker per day; later scans are "already timed out". The wording is Time in / Time out, never Clock in/out. Daily status (On time / Late / Absent / Not in yet / Rest day / No fingerprint) comes only from `attendance_daily_status` (labels `lib/attendanceStatusModel.ts`): Foreman Daily attendance table, worker detail, site screen cards, report "Daily time record". The Admin schedule has working days.
- Admin manages worker registration, profile changes and fingerprint enrollment. Do not add the previously rejected remote delegation/Foreman enrollment permission.
- The hardware workflow uses an AS608 sensor connected to ESP32. Enrollment must be sensor-driven, not require a person to type an AS608 enrollment ID manually.
- Registration includes worker names/contact fields and camera photo capture. Workers do not require website accounts.
- Worker Profiles opens a detailed worker record, not the registration form.
- Foreman **Workforce management** has **Attendance records** first and **Workers** second. Workers are searchable and open details, attendance summaries and records.
- Attendance records support date selection and daily/weekly/monthly reports; individual worker records support attendance reports as well.
- The standalone attendance page is a separate read-only display tied to the selected project. It displays the project name, live recent scans and latest worker profile. It has no project/search/date/status filters or refresh button; fullscreen is icon-only.
- Do not change the standalone attendance page when modifying Foreman workforce pages unless explicitly requested. Never invent attendance records or claim physical sensor enrollment was tested without hardware.

## Database safety and migrations

- Keep role/project authorization, RLS, private Storage policies, checked RPCs, immutable evidence and concurrency guards. UI permission checks are not sufficient.
- Write versioned migrations and corresponding SQL regression tests for database changes. Do not edit previously applied migrations to change production history.
- A committed migration file does not prove deployment. Check migration status and document whether it was applied and verified; never tell the user to paste already-deployed SQL unnecessarily.
- PostgreSQL installation alone does not provide an offline database connection or cloud synchronization. Do not claim local/cloud sync exists without implementing and testing it.
- Do not put access tokens, service-role credentials, database passwords or worker biometric data in this file or Git commits.

## Verification and handoff

- Full regression: `pnpm check` (TypeScript, helper/component tests, SQL regressions and production build).
- Targeted photo/editor checks: `pnpm test:issue-editor`, `pnpm test:comparison`, `pnpm test:qa-photo-markup`.
- QA checks: `pnpm test:direct-qa`, `pnpm test:work-item-evidence`, `pnpm test:qa-board-layout`.
- Connected pages: `pnpm test:project-records`, `pnpm test:client-portal`, `pnpm test:assignments`.
- Attendance/enrollment/report tests are listed in `package.json` and included in `pnpm check`.
- Run `git diff --check`. Report actual test results, remaining blockers and whether visual/hardware checks were possible. A successful build is not visual or hardware verification.
- Keep task-specific implementation/security/test records in `docs/audits/`. Update this handover when workflow decisions change rather than recording contradictory instructions indefinitely.
- Commit/push only when requested. Check the configured remote and remote branch first; never force-push to resolve an unexpected divergence.

## Public Valencia introduction

- Opening `/` replaces the URL with `/valencia`. The separate BuildTrack landing page is at `/buildtrack`; internal `navigate("home")` must use that path. Preserve both pages and protected workspace/deep-link routes. Legacy explicit `/#about`, `/#services`, `/#features` and `/#contact` bookmarks redirect to their corresponding `/buildtrack` sections.
- The Valencia desktop/mobile header includes a **BuildTrack** link to `/buildtrack`; its brand logo returns to `/valencia`. The BuildTrack header, About section and footer link back to Valencia. Landing section links must use `/buildtrack#...`, not the new opening `/` URL.
- At widths of 1100px and below, Valencia uses an in-header hamburger and `ValenciaMobileNavigation.tsx` right-side drawer instead of a horizontal navigation strip. It reuses `Modal` with `placement="right"` for focus trapping, Escape/backdrop closing and scroll locking. Section/BuildTrack clicks close it; modified links retain native behavior. Desktop resizing closes the drawer. Drawer focus restoration must not scroll away from the selected section. Desktop links, main landing authentication and standalone attendance stay unchanged.
- Vercel requires the root `vercel.json` SPA rewrite to `/index.html` for direct visits/refreshes of `/valencia`, `/buildtrack`, login and workspace URLs. Do not remove it or bypass RouteGuard to address a hosting 404. Public header/mobile/cross-page links use `handlePublicNavigation` for normal same-tab clicks; preserve external, modified/new-tab and download behavior. `usePublicHashScroll` scrolls sections after lazy page mounting and on hash/Back/Forward changes; keep the sticky-header offset.
- Sources: the Home, About Us, Services, Projects and Contact pages at `https://valenciaconstructionservices.mystrikingly.com/`, checked 2026-10-21. Keep company facts separate from private project records and do not invent project completion dates, statistics, staff, certifications or testimonials.
- `src/pages/Public/ValenciaIntroduction.tsx`, `valenciaContent.ts` and scoped `valencia.css` reuse the public Header and its brand colors. `/valencia` is rendered as static public content; workspace routes retain their existing RouteGuard.
- `src/assets/valencia/introduction/` holds local source photos, an enhanced interior hero and the transparent logo. Preserve source images and do not flatten the logo's alpha channel.
- `proprietor-roxan-valencia.png` is the original supplied proprietor portrait, also published by Valencia. It replaces the initials beside Roxan D. Valencia in About; preserve the actual portrait rather than generating a substitute.
- Hero refinement (2026-10-22): retain the left headline, actions, colors and readability gradient. Overlay the transparent logo directly over the interior photo at the user's yellow-circled right-center area (desktop center at 68% across / 58% down). Keep it clear of tablet copy and above mobile copy. This supersedes the earlier top-center placement. Do not restore the white/glass logo card or the red less-than/chevron decoration.
- The enlarged hero logo uses `clamp(320px,34vw,540px)` on desktop, with smaller tablet/mobile bounds. Preserve its marked center when resizing; mobile copy reserves space below the larger logo.
- The Valencia company header hides Log in and Register using `Header`'s opt-in `showAuthActions={false}`. Keep the main landing page's sign-in controls and the standalone attendance branding-only header unchanged.
- Both public pages use `src/components/PublicFooter.tsx` for the landing footer layout, contact details and responsive columns. Valencia passes `page="valencia"` for white (not yellow) brand/headings/hover text and its own About/Services/Contact anchors; Platform Features links to `/buildtrack#features`. Do not restore the removed Stay connected/company-site promotion or duplicate the footer markup.
- Project filters and gallery slides are manual. Keep renderings labelled as perspectives, not finished construction. Source-website ongoing-status lines, the portfolio-source/date footnote and repeated gallery status disclosures are removed from the public page by request; source provenance remains in content/audits and is not a live database status.
- The inquiry form prepares a `mailto:` message. It does not store or send inquiries itself; keep this clear to visitors. The address-map link uses the published Taytay office address, not the original site's generic map. No verified company social profile was available.
- Run `pnpm test:valencia` after changes; it is included in `pnpm check`. See `docs/audits/2026-10-21-valencia-introduction.md` for sources, asset prompts and verification limitations.

## Recent implementation records

- `docs/audits/2026-10-26-engineer-checklist-actions.md`
- `docs/audits/2026-10-22-valencia-opening-and-proprietor.md`
- `docs/audits/2026-10-22-deployed-public-navigation.md`
- `docs/audits/2026-10-22-shared-public-footer.md`
- `docs/audits/2026-10-22-valencia-mobile-navigation.md`

- `docs/audits/2026-10-21-work-item-evidence.md`
- `docs/audits/2026-10-21-manual-checklist-completion.md`
- `docs/audits/2026-10-21-qa-board-filters.md`
- `docs/audits/2026-10-21-connected-site-reports-and-assignments.md`
- `docs/audits/2026-10-21-client-portal-connections.md`
- `docs/audits/2026-10-21-qa-photo-markup.md`
- `docs/audits/2026-10-21-photo-editor-zoom-fullscreen.md`
- `docs/audits/2026-10-22-calendar-filters.md`
- `docs/audits/2026-10-23-qa-overview-calendar.md`
- `docs/audits/2026-10-23-correction-photo-markup.md`
- `docs/audits/2026-10-23-away-photos-count.md`
- `docs/audits/2026-10-24-pin-record-connections.md`
- `docs/audits/2026-10-25-pin-panel-refinements.md`
- `docs/audits/2026-10-25-full-checklist-reinspection.md`
- `docs/audits/2026-10-25-targeted-qa-reinspection.md` (superseded, never applied)
- `docs/audits/2026-10-22-photo-markup-select-move-rotate.md`
- `docs/audits/2026-10-21-photo-editor-toolbar-slideshow.md` (supersedes the Fill-first default and viewport heights above)

These audits describe individual task runs. Historical statements such as "no push was made" apply to that task, not necessarily to the current repository state. Use Git history for current commit/push status.
