# 2026-11-01 Super Admin record removal

Owner decision: Admin / Super Admin should have authority to delete the records that were not deletable. The suggestion that was approved: Super Admin only, with the authenticator, a reason, a typed confirmation, a reversible recycle bin and an audit entry; attendance records and the audit log stay protected; accounts stay suspend / privacy-erasure.

Migration `20261101200000_record_removal` is **APPLIED** (2026-11-01, live version `20261101111602`; every table fingerprint identical before and after, nothing removed). The screen (Admin > Records) is on the branch only until it is merged and deployed.

## What can be removed (Super Admin only)
| Record | Why it is safe to hide |
|---|---|
| Daily reports (any status) | Self-contained; engineers and clients read them through row security. The report's photos and history are hidden with it. |
| Site issue reports | Same. A removed issue still counts as "attached" to its pin, so the pin cannot be deleted by a side effect. |
| Client problem reports | Same. The NCR raised from one is untouched. |

Removing needs the authenticator, a reason (5-300 characters) and the typed phrase (`REMOVE <date>` for a daily report, `REMOVE <first 8 characters of the id>` for a site issue, `REMOVE SR-0001` for a client report). The record is **hidden, not deleted** (restrictive read policies, including its photos and revision history), and restoring brings it back exactly as it was. Both actions are written to the audit log (`record.removed`, `record.restored`). A record of a project that is in the recycle bin cannot be removed or restored until the project is restored.

## What cannot be removed, and why
- **Inspections and defect reports (NCRs):** pin verification and completion depend on them (a pin is only Completed when every inspection and NCR is clear). Hiding one would change a pin's verified state. Use the existing cancel / close flows.
- **Attendance and biometric records:** evidence of who was on site; wage and legal disputes depend on them.
- **The audit log:** it is the proof of who removed what. If it grows too big it can be exported.
- **Accounts:** suspension and privacy erasure (which anonymises) already exist; a hard delete would erase the person's work history.
- **Admin / Super Admin being "complete authority":** unchanged for what they could already do (sheets, projects, whitelist, erasure). The records above are Super Admin only on purpose: a stolen Admin session must not be able to hide evidence.

## Left out on purpose
Permanent deletion of a single record is not built (only the reversible removal). Say if you want it, with the same guard rails as the project purge (Super Admin, delay, confirmation).
