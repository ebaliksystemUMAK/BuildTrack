# Continue cancelled inspections and reinspections

Engineer inspection details now offer **Continue inspection** on a cancelled request, before or after its first start. A confirmation explains that recorded results, measurements, remarks, photos and submission snapshots are retained. History keeps the cancellation reason and a new Engineer-attributed continuation event. Duplicate clicks are guarded; failed server checks leave the request cancelled.

The existing authenticated-only `start_inspection(uuid)` RPC handles the transition atomically. It locks the parent before the inspection, validates the original frozen work/item snapshot, rejects verified items, newer drafts/submissions, changed NCR decisions and superseded stage requests, then reuses the open-inspection overlap guards. The assigned inspector becomes the acting project Engineer; the original start time is retained when present, and cancellation completion/summary fields are cleared without deleting their history.

Submitted items return to For review. Only NCRs tied to this exact correction attempt and last returned by this exact cancellation return to For verification, using the original Foreman's submission actor/time. A resumed finding-specific Pass closes its NCR through the existing automatic sign-off trigger; manual checklist completion remains separate. No snapshots, criteria, recorded results or existing real records are rewritten by deployment.

## Verification

- UI regression checks: initial/reinspection continuation, confirmation decline, exact RPC, double click, failure and non-Engineer restrictions.
- 493 SQL cases pass, including cancellation before/after start, atomic rollback, result/evidence retention, repeated cancellation, NCR decision guards, fresh correction conflicts, stage replacement guards and RPC privileges.
- Full TypeScript/application regression/build check passes.
- Applied `20261028092154_resume_cancelled_inspections.sql` to BuildTrack only. Hosted schema migration version aligned with local filename; existing function retains empty search path and authenticated-only execution.
- Live authenticated synthetic Cancel → Continue → Pass → NCR closure → manual checklist completion smoke passed and rolled back. Existing inspection, result, submission and NCR fingerprints unchanged.
- Existing cancelled IR-0015 and IR-0017 read-only checks found unchanged work/current request, no newer draft, and exact cancellation-return NCR events. Neither was automatically resumed.
- Security advisor counts unchanged: 4 no-policy INFO, 94 authenticated-definer WARN, 1 leaked-password-protection WARN.

Supabase/Postgres guidance informed the checked existing RPC, parent-first locks, privilege verification and atomic lifecycle restoration. No new table, public RPC, RLS change or storage change.
