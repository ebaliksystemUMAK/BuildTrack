# Client site visits

| Field | Value |
|---|---|
| File | `supabase/migrations/20261028061346_client_site_visits.sql` |
| Written / applied | 2026-10-28 / 2026-10-28 |
| Depends on | Projects, profiles, membership helpers, notifications, Realtime publication |
| Status | Applied via connector and verified with an authenticated rollback smoke |
| Reversible | Additive; disable new UI before removing objects; preserve submitted requests |

## Purpose

Give Clients a distinct Communication tab to request site visits and allow assigned Engineers to respond, using one authoritative project-scoped request record.

## Objects created or changed

| Object | Behavior |
|---|---|
| `public.site_visit_requests` | Requested time, purpose, visitor count, state and stamped Engineer response |
| Three RLS policies and column grants | Private reads, Client inserts, checked decisions/cancellation; no deletion |
| `public.prepare_site_visit_request` | Invoker trigger; immutable identity/details, future times, legal transitions |
| `private.notify_site_visit_request` | Internal definer trigger; project Engineer requests/cancellations, Client decisions |
| Indexes and unique active request slot | Efficient project/identity lookup; duplicate active request prevention |
| `supabase_realtime` | Publishes new request changes using RLS |

## Security and RLS

Only active Clients/Engineers with matching current profile and project membership roles participate. Clients read their own requests and may cancel upcoming pending/confirmed ones. Assigned Engineers read project requests and confirm/decline pending requests. Declines require a message. Caller-supplied author, decision metadata and timestamps are not granted. Neither anonymous users nor authenticated users can directly execute notification trigger code. No new exposed definer RPC was added.

## Verification

Seven new SQL cases in `supabase/tests/98-site-visits.cases.mjs`; 473 total SQL regressions passed. The Realtime allowlist test explicitly includes this table. Live RLS/policy/grant/publication checks and the request → confirm → cancel rollback smoke passed. Security advisor counts unchanged. See [full audit](../2026-10-28-client-site-visits.md).

## Rollback

Prefer disabling the new tabs while retaining request history. After explicitly exporting/backing up any requests and approval to remove the feature, reverse the additive objects in a new migration: remove the table from the publication; drop its triggers, policies, indexes and table; drop `public.prepare_site_visit_request()` and `private.notify_site_visit_request()`. Do not drop the shared `private` schema or notification infrastructure. No rollback was executed.

## Notes / limits

The preferred time is a request until an Engineer confirms it. All times use Asia/Manila. Changes to the requested slot require cancelling and submitting a new request; this preserves the original decision record. Requests are not copied into a separate calendar or marked as physically completed.
