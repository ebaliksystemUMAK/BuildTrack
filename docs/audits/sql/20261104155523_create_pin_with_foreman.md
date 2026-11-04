# Assign a Foreman when adding a pin

| Field | Value |
| --- | --- |
| File | `supabase/migrations/20261104155523_create_pin_with_foreman.sql` |
| Applied | 2026-11-05 (Manila), BuildTrack connector version `20261104160447_create_pin_with_foreman` |
| Depends on | Existing pin creation/automatic schedule request RPC and pin assignment/type-access guards |

New Pin now includes an optional Assigned Foreman selector for work pins. It lists only project Foremen with Assigned work access to the selected plan's type. The existing team/access reads supply the options; loading, error/retry and empty-list states are shown. A stale selection is retained visibly and must be refreshed, replaced or cleared before saving. Leaving it unassigned is supported. Note pins have no assignment selector. Selected-plan display, required proposed start/deadline/phase, optional technical reason and invalid-field focus remain in place.

The new `create_pin_with_foreman` RPC is security invoker with a fixed empty search path and authenticated-only execution. It calls the existing checked pin/schedule creation RPC, then applies the initial Foreman through the same RLS and assignment triggers used by the existing details form. Existing guards validate active Foreman role, project membership and Assigned access to the plan type, stamp `assigned_by`/`assigned_at`, and retain assignment events/notifications. Pin, assignment and pending PM request save in one transaction. An invalid assignment rolls everything back, leaving no partial pin or request. No PM-only reassignment RPC is bypassed or broadened; no existing records/functions, grants, RLS policies or QA state are changed. PostgREST schema reload is requested for the new endpoint.

Assigned new work remains unapproved in the schedule and unverified in QA. Client visibility still requires PM publication. Existing reassignment/full-details controls remain available; the new wrapper only assigns the pin it just created.

Verification: actual dialog handler tests cover eligible options, assignment forwarding, unavailable selections, loading/error/retry, optional unassignment and notes. Thirty-one focused schedule/QA SQL cases pass, including assignment actor/time/events, automatic PM request, Foreman visibility, separate Client publication, disabled/non-Foreman/out-of-project/view-only target denials, role/archived-project denials and complete rollback of pin/request/event counts. Full `pnpm check` passed (750 SQL cases, application checks, TypeScript and production build), as did the 5,000-pin load check. Browser visual verification was unavailable in this session.

The initial full run exposed four cascading failures in the existing record-removal test fixture after Manila midnight: its expected confirmation date used UTC today. The fixture now reads the created report's stored `report_date` for its label/confirmation expectations; production removal logic was untouched. The complete rerun passed.

Hosted verification confirmed the new RPC argument names, invoker security, empty search path, authenticated grant and anonymous denial. Its body matches local SQL (`f5b0cbd4713621fbd0101befab653a47`); existing creation remains unchanged (`f9b7a2083915fe57af0d5324be4fbd25`). All 17 existing pins retain fingerprint `8012f2a34d0eebc6f2515e18574d5cb9`; requests retain fingerprint `055c416fbb3157fb88d36c03ac73dc04`. Security-advisor categories/counts are unchanged (16 private RLS tables, 3 existing anonymous definers, 172 authenticated definers, 1 password-protection warning). No production test work or assignments were created.

Rollback requires an additive migration removing the new endpoint after reverting its UI caller. Keep all valid created work, assignments, proposal history and audit records; no record deletion or historical migration rerun is included.
