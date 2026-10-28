# 2026-10-28 Project checklists and cited-standard documentation

Requested: Checklist configuration shows only the checklists the Engineer added to the project; setting criteria on a pin offers only those checklists; documentation based on the cited standards; remove the entries that do not apply.

Migration: `supabase/migrations/20261028150000_project_checklists.sql` (details in `sql/20261028150000_project_checklists.md`).

## What was wrong

"This project" in Checklist configuration mixed two different things:

- checklists the Engineer added to the project (copied from the library or created), for example "WATER PROOFING";
- hidden copies of each work item's criteria that `save_work_checklist_item` creates, named "<work> / <item>" (for example "DINING AREA / DINING-FLOOR"). A new copy was made on every save, so editing a work item left unused duplicates ("LIVING ROOM / LIVING ROOM-PAINT" three times, two of them unused).

The work item editor on the plan also offered every checklist (company library, project checklists and those hidden copies) under "Copy criteria from an existing checklist".

## What changed

| Where | Now |
|---|---|
| Engineer > Checklist configuration | Lists only this project's added checklists (archived ones on request). The company library opens from **Add from library** (search, View, Add to this project; checklists already added are marked). **New checklist** creates one. Each card shows what it cites. |
| Checklist view | A **Documentation** block: each cited standard with its catalog title and, where documented, its official source link; the exact clauses the criteria refer to; a reminder to confirm the edition and clause in the official text. Also shown on the Admin library page. |
| Plan > work item editor | "Copy criteria from a checklist added to this project" lists only those checklists. The chosen checklist's documentation is shown, and its cited standards are saved with the work item (they can be removed). |
| Stage / hold-point inspection request | Offers only this project's checklists; says so when none has been added yet. |
| Work item criteria copies | Flagged (`work_item_criteria`), never listed as project checklists, changed only by editing the work item. Unused copies are removed (the two unused "LIVING ROOM / LIVING ROOM-PAINT" on TST-002); a copy is also removed when its work item gets new criteria or is deleted and nothing else refers to it. Copies used by a submission or inspection are kept with that history. |
| System Settings > Standards and codes | Each standard may have an official source link (https). |

Library checklists already selected on older pins (pin-level criteria, for example "Concrete masonry (CHB) wall") keep working; they are just no longer offered for new selections.

## Documentation of the cited standards

The catalog (System Settings > Standards and codes) is the documentation source: code, title and, now, the official source. The links below were checked against official listings on 2026-10-19 (`2026-10-19-philippine-qa-standards.md`) and were filled in by the migration. No link was invented for the other codes.

| Code | Title | Official source |
|---|---|---|
| PNS 07:2018 | Portland cement - Specification | [DTI-BPS](https://bps.dti.gov.ph/component/content/article?Itemid=111&id=83) |
| PNS ASTM C90:2019 Amd. 1:2019 | Loadbearing concrete masonry units | [DTI-BPS](https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units) |
| PNS ASTM C129:2019 Amd. 1:2019 | Nonloadbearing concrete masonry units | [DTI-BPS](https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units) |
| PNS ASTM C140/C140M:2019 | Sampling and testing concrete masonry units | [DTI-BPS](https://bps.dti.gov.ph/index.php/press-releases/23-2019/183-dti-bps-adopts-international-standards-on-masonry-units) |
| PNS 67:2014 | Hot-dip metallic-coated steel sheets for roofing | [DTI-BPS](https://bps.dti.gov.ph/component/content/article?Itemid=111&id=267) |
| PGBC 2015 | Philippine Green Building Code | [DPWH](https://www.dpwh.gov.ph/DPWH/sites/default/files/laws_codes_orders/PgbcBooklet23March.pdf) |
| PNS 49:2020 | Steel bars for concrete reinforcement | [DTI-BPS](https://bps.dti.gov.ph/component/content/article?Itemid=111&id=84) |

Still without a recorded official link (add it in System Settings once confirmed): NSCP 2015, PD 1096, PEC 2017, RA 1378, RA 9514, DOLE D.O. 13, RA 11058, BP 344, PNS 49 (legacy citation). Citing a standard documents the basis of a checklist; it does not certify compliance, and the project Engineer confirms the edition and exact clause.

## Files

`src/lib/qaChecklists.ts` (rules, `pnpm test:project-checklists`), `src/components/qa/ProjectChecklists.tsx`, `src/components/qa/ChecklistDocumentation.tsx`, `src/components/qa/{QaPanels,WorkChecklistEditor,NewInspectionModal}.tsx`, `src/lib/{qa,settingsModel}.ts`, `src/pages/Admin/SystemSettings.tsx`, `src/pages/Engineer/EngineerChecklists.tsx`.

## Tests

`pnpm check`: type-check, all model tests (6 new), `test:sql` 515/515 (7 new in `99-…-project-checklists.cases.mjs`; `99-zzzzzzzzzzz-direct-item-qa` now expects the refusal to edit a work item's criteria copy as a checklist), build. Layout checked in headless Chrome with a temporary demo (deleted).
