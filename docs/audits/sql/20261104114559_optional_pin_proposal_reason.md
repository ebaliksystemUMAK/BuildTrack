# Optional pin proposal explanations and Add Pin validation

| Field | Value |
| --- | --- |
| File | `supabase/migrations/20261104114559_optional_pin_proposal_reason.sql` |
| Applied | 2026-11-04, BuildTrack connector version `20261104115049_optional_pin_proposal_reason` |
| Depends on | Existing project timeline and Engineer schedule proposal migrations |

The New Pin dialog now uses the existing large modal (672px maximum), with paired date fields on wider screens and a single column on mobile. Add pin focuses and scrolls to the first invalid title, proposed start or deadline; the focused field is marked invalid and associated with the explanatory alert. Both dates may be omitted. Entering either requires the other, valid supported years and a deadline on or after the start. Connection failures preserve input and allow retry.

Technical reason is optional in New Pin and the Engineer's subsequent schedule draft/submission form. The additive migration accepts empty, whitespace-only or null proposal/request explanations, normalizes them to an empty string, and retains the 500-character maximum. No placeholder explanation is invented. The shared schedule-request RPC and private request-table check also accept an absent explanation so the same proposal can be sent or updated. PM direct schedule edits, approval/rejection notes and publication reasons remain required.

The three existing RPCs are replaced in place, preserving their signatures, fixed empty search paths, authenticated grants, anonymous denial, project/role/access checks and revision conflict protection. Official dates still require PM approval; drafts remain private and approval never verifies QA. No records, evidence, published snapshots, RLS policies or grants are changed by this migration.

Verification: actual Add Pin and Engineer proposal handlers cover invalid-field focus/scroll, optional dates/reason, date order/bounds, input retention and retry. Local SQL regressions exercise null/blank/short reasons, pending proposal updates, rejection of overlong reasons, Client denial and required PM review notes. Full `pnpm check` passed, including 741 SQL cases, TypeScript and production build; focused schedule/QA runner passed 22 cases. Browser visual verification was unavailable in this session.

Hosted verification confirmed the new 0–500 character constraint, private request-table writes/RLS, anonymous RPC denial, authenticated RPC grants and fixed empty search paths. Function bodies match the local migration: `save_pin_schedule_draft` = `217fff21690c319c30f541922f327bf0`, `request_timeline_change` = `7f709f23bcd71ba783f1e75a2d152769`, `submit_pin_schedule_proposal` = `a3fbba142e2f04ba812d3255c4c99196`. Pre/post security-advisor categories/counts were identical (private RLS tables 16, existing anonymous definers 3, authenticated definers 172, password-protection warning 1). The hosted migration contains no record updates; no production test work was created.

Rollback requires an additive migration restoring the previous functions and reason check, after explicitly resolving any newly saved empty reasons. Do not rewrite prior proposal explanations or evidence to force the old constraint back into place.
