# 2026-11-01 Archive review and project recycle bin

Status: migrations `20261101180000_project_recycle_bin` (live `20261101081342`) and `20261101190000_delete_protection_and_purge` (live `20261101081428`) are **APPLIED** (2026-11-01, verified: every table fingerprint identical before and after, 0 projects removed); Edge Function `purge-project` v1 is deployed. The screens are on the branch only until it is merged and deployed.

## 1. What existed before (reviewed read-only on the live database)
| Record | Archive | Deletion today |
|---|---|---|
| Projects | `archived_at` / `archived_by`, set by `set_project_archived` (Admin, Projects permission). Read-only for Project Managers (`manages_open_project`, `guard_project_manager_edit`). Everyone else keeps their normal access. | The **Delete** button did a real `DELETE`. It cascades into 28 child tables: plans, pins, daily reports, inspections, defects, site issues, client reports, questions, photos, notifications. Only pins that ever went for review (evidence lock) and biometric records (no-action keys) stopped it. A project with daily reports, inspections or defects but no reviewed pin was destroyed without a trace. |
| QA checklists | `archived` flag (`archive_qa_template`) | none |
| Plans (sheets) | none | Admin with `blueprints.manage`; cascades pins and markups; evidence lock applies |
| Pins | none | Engineer (not once reviewed or verified) |
| Pin checklist items, markups, photos, daily-report drafts, notifications | none | Direct deletes by the owner/author under row security; evidence photos are locked |
| Inspections, defects, site issues, client reports, daily reports (submitted), audit log, attendance records | none | **No delete path at all** (read-only to the API). They stay that way. |
| Accounts | suspension | anonymised on a privacy request (irreversible by design) |

## 2. What was built
**A. Archive (improved, behaviour preserved).** The "Show archived" checkbox is now a Show filter with counts: Open projects, Archived, Open and archived, Recycle bin. Archived cards show the date; the action reads "Restore from archive"; an empty archive explains itself. Archiving, the Project Manager read-only rule and access to historical records are unchanged.

**B. Reversible deletion, for projects only.** *Remove* appears on archived projects (Admin with the Projects permission / Super Admin, with the authenticator):
- needs an **archived** project, a **reason** (5-300 characters) and the **project code typed exactly**; the dialog first shows what is inside (plans, pins, evidence pins, team, reports, inspections, defects, photos, scans);
- records who, when and why on the project and in the audit log (`project.removed`, with the contents counts);
- the project is **hidden, not moved**: the few functions that decide project access (`can_view_project`, `viewable_project_ids`, `is_project_member`, `is_project_manager`, `is_project_client`, `can_edit_blueprints`, `can_report_on_project`, `can_work_on_pin`, `manages_open_project`) answer "no" for it, so the more than thirty tables that read through them disappear from ordinary lists without being touched. Restrictive policies hide the rows that do not use those functions (the project itself, memberships, site visits, attendance concerns, notifications). New reminders about it are not created (trigger on `notifications`);
- **Restore** (Recycle bin filter): puts it back as **archived** (read-only), optionally with a new code, and tells the Admin what needs attention (team members no longer active, no primary Project Manager). The code stays reserved while the project is in the bin, so no other project can take it; a code another project already uses is refused;
- biometric devices and other backend writes keep working for a removed project (scans are evidence) and reappear on restore;
- the old direct hard delete is refused for signed-in accounts ("archive it, then move it to the recycle bin"); the SQL editor and service role can still delete.

## 3. What does NOT get a recycle bin, and why
- **Plans, pins, markups, checklist items:** hiding one parent leaves its children (events, photos, QA submissions, inspections, defects, daily-report links, notifications) visible in registers, counts and dashboards through their own policies; fixing that means rewriting about 25 tables' read rules, which is the opposite of safe. Pins with evidence are already undeletable; the rest are working drafts with undo and the sheet history.
- **Photos and evidence files:** construction evidence must not be removable. The existing rules already forbid deleting evidence photos; unreferenced files are the only removals.
- **Daily-report drafts, notifications:** private, low-value, author-owned; a bin adds risk for no benefit.
- **Inspections, defects, site issues, client reports, submitted reports, audit log, attendance records:** no deletion exists and none was added.
- **Accounts:** suspension is the reversible option; erasure is irreversible on purpose (RA 10173).

## 4. Risks
1. **Access functions changed.** Nine functions sit under every read policy. The only change is a "not removed" test; all 643 SQL cases (every older suite) and the 5,000-pin load test pass, and the load timings are the same as before the change within run-to-run noise.
2. **A removed project is invisible to its team immediately.** Someone with the project open sees an empty/not-found page after the next refresh. The dialog says so; archiving first (PMs are notified) softens it.
3. **Reminders stop**, because no notification is created for a removed project. Existing notifications about it are hidden until restore.
4. **Not blocked at the database for direct API writes by a stale session** beyond the access functions: a foreman with a stale tab cannot save (the functions say no), which was tested.
5. **Rollback** is documented at the end of the migration; restore every removed project first.

## 5. Permanent deletion and delete protection (owner decision: Super Admin only)
- **Delete forever** (Recycle bin, Super Admin only, authenticator): the project must have been in the bin for **30 days** and must hold **no real records**: no evidence pins, pins with work, inspections, defects, site issues, client reports, questions, daily reports, photos, biometric scans, attendance workers or devices. Such projects stay in the bin and can be restored. What remains deletable is a project made by mistake: plans, untouched pins, team assignments. The Super Admin sees the blockers, types `DELETE FOREVER <code>`, and the `purge-project` Edge Function deletes the rows (service role, after re-checking everything) and then the plan files in storage. The audit log keeps who, when, why it was removed and what it held, and the generic audit also keeps the project row.
- **Records cannot be erased by a side effect** (migration `20261101190000`): a pin with inspections, defects, site issues or client records cannot be deleted by anyone signed in; a pin with progress, comments, photos or ticks only by a Super Admin (this also stops an Admin erasing them by deleting a sheet); a checklist item that was ticked, remarked, reviewed or photographed only by a Super Admin; QA evidence photos are locked once an inspection is concluded or a defect is sent for verification; deleting a user account no longer cascades into that person's daily reports, client reports and questions. Attendance records, inspections, defects and the audit log have never had a delete path and still do not.
- **Confirmations:** deleting a sheet now needs the typed word DELETE; removing a checklist item asks first (it did not); removing a project to the bin needs a reason and the typed code; delete forever needs the typed phrase. The other deletes already asked (pin, photos, draft report, team member).
- **Left as they are on purpose:** markup (annotation) deletes and their undo, a draft daily report and its photos, a photo still in an open inspection or checklist item, a notification, and Engineers deleting their own untouched pins. These are working drafts; making them Admin-only would remove features (the editor's undo) and the Engineer's authority.

## 6. Left out on purpose; decisions for the owner
- **Retention period:** 30 days is the minimum before a delete forever; Philippine retention duties for construction and personnel records (and the Data Privacy Act's erasure rules) should be checked with the school/company before real records are ever deleted. A project with real records can never be deleted from the app.
- **Automatic expiry** of the bin is not built (nothing in the bin expires today); say if you want it.
- Recycle bin for plans/pins is not built (see section 3); say if you want a narrower version, for example only plans with no pins.
