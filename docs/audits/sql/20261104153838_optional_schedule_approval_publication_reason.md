# Optional schedule approval and publication explanations

| Field | Value |
| --- | --- |
| File | `supabase/migrations/20261104153838_optional_schedule_approval_publication_reason.sql` |
| Applied | 2026-11-04, BuildTrack connector version `20261104154404_optional_schedule_approval_publication_reason` |
| Depends on | Existing Gantt timeline and Engineer/PM schedule proposal workflow |

The PM approval form and Publish schedule dialog now label the explanation optional, remove minimum-length/required validation, and enable submission without text. The 500-character maximum remains. Null, empty and space-only values normalize to an empty string; short explanations are accepted without inventing placeholder text.

The additive migration updates `decide_timeline_request` and `publish_project_timeline`, and relaxes only the private publication reason check to 0–500 characters. Approval still calls the checked private schedule writer. That writer accepts an empty explanation so the approval can record it honestly; its authenticated/public execution remains revoked. The public `save_timeline_item` wrapper explicitly retains the previous 5–500 character requirement for direct schedule edits. Rejection still needs a 5–500 character review note. No existing records, published snapshots, dates, requests, roles, ACLs or RLS policies are rewritten.

The PM must still explicitly approve and explicitly publish. Role/project/MFA guards, stale revision/dependency/date validation, immutable publication history, actor/time/audit records and separate Engineer QA verification remain in force. Publication still requires at least one dated task/milestone and still supplies Clients only the sanitized snapshot.

Verification: actual approval and publication handlers submit blank reasons and keep buttons enabled; approval also accepts a one-character reason. Twenty-eight schedule/QA SQL cases pass, including null/blank/short values, preserved actors/decisions, separate publication, immutable earlier snapshots, sanitized Client reads, excessive-length denial, rejection/direct-edit requirements, role denials and empty-publication denial. Full `pnpm check` passed, including 747 SQL cases, application checks, TypeScript and production build. Browser visual verification was unavailable in this session; source/component checks cover the changed controls.

Hosted verification confirmed the new publication reason check, private publication writes/RLS, unchanged RPC/helper ACLs and fixed empty search paths. Function bodies match local SQL: `write_timeline_item` = `46c608a6f7008590c1bd126cc4f269f1`, `save_timeline_item` = `492c217359b67ec82d276f01ab22666c`, `decide_timeline_request` = `acab9efbaf59ca44ff38574e8d7d055a`, `publish_project_timeline` = `aeb93f807b14eaf98ae228be7d59c813`. The single existing publication retains fingerprint `c789585b2391074e0104c24e2e0bc0b1`; all requests retain fingerprint `055c416fbb3157fb88d36c03ac73dc04`. Security-advisor categories/counts are unchanged (16 private RLS tables, 3 existing anonymous definers, 172 authenticated definers, 1 password-protection warning). No live schedule was approved or published for testing.

Rollback requires an additive migration restoring prior RPC validation and explicitly resolving empty new publication explanations before restoring the old table check. Do not rewrite prior approvals, notes or snapshots merely to restore the old constraint.
