# 2026-10-31 — Official sources for the built-in checklists' cited standards

Request: on Inspection criteria, the built-in checklists should include the documents they cite.

The built-in checklists already cited standards (codes + catalog titles), but none of the nine had an official source link. Migration `20261031102813_builtin_standard_sources` adds the six that could be confirmed; `ChecklistDocumentation` now shows "Official source" for them (no frontend change). Details: `sql/20261031102813_builtin_standard_sources.md`.

## Sources (each page opened on 2026-10-31 and its document number confirmed)

| Code | Document | Link |
|---|---|---|
| PD 1096 | Presidential Decree No. 1096 (1977), National Building Code | [Supreme Court E-Library](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/26/53320) |
| DOLE D.O. 13 | DOLE Department Order No. 13, s. 1998, OSH in the Construction Industry | [Supreme Court E-Library](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/10/43886) |
| RA 9514 | Republic Act No. 9514 (2008), Fire Code of the Philippines | [Supreme Court E-Library](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/19962) |
| RA 11058 | Republic Act No. 11058 (2018), OSH Standards | [Supreme Court E-Library](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/86355) |
| BP 344 | Batas Pambansa Blg. 344 (1983), Accessibility Law | [NCDA](https://ncda.gov.ph/disability-laws/batas-pambansa/batas-pambansa-blg-344/) |
| RA 1378 | Republic Act No. 1378 (1955), Plumbing Law | [PRC (PDF)](https://www.prc.gov.ph/sites/default/files/Master%20Plumbing%20-%20Board%20Law_0.PDF) |

The Official Gazette, Senate and OSHC pages refused automated access (HTTP 403), so government reproductions were used. The E-Library pages are reproductions, not the Official Gazette text.

## Left without a link (nothing invented)

- **NSCP 2015** (ASEP) and **PEC 2017** (IIEE): sold by the publisher; no official free text or edition page was found on aseponline.org / iiee.org.ph.
- **PNS 49** (legacy, no edition year): kept as cited; linking it to PNS 49:2020 would reinterpret older inspections (same rule as `2026-10-19-philippine-qa-standards.md`).

A Super Admin can add or change any link in Admin > System settings > Standards and codes.
