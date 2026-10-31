# Official sources for the built-in checklists' cited standards

| Field | Value |
|---|---|
| File | `supabase/migrations/20261031102813_builtin_standard_sources.sql` |
| Written / applied | 2026-10-31, applied and tracked as 20261031102813 |
| Depends on | `20261028150000_project_checklists.sql` (`fill_documented_standard_sources()`, `source` validation in `set_setting`) |
| Status | Applied; 537 SQL tests pass; live catalog verified |
| Reversible | Yes: a Super Admin can remove a link in System settings, or a follow-up migration can drop the six `source` keys |

## Purpose

The 10 built-in checklists cite nine standards, but none of those catalog entries had an official source, so Inspection criteria > View showed codes and titles without a document link. This adds the links that could be confirmed.

## Objects and behavior

`fill_documented_standard_sources()` gains six code → link rows (PD 1096, DOLE D.O. 13, RA 9514, RA 11058, BP 344, RA 1378) and is run once. As before, it adds a `source` only where an entry has none (matched on trimmed, lower-case code). Existing links, codes, titles and order are not touched. No table, policy, template or inspection changes. Sources and the reason three codes stay unlinked: `../2026-10-31-builtin-standard-sources.md`.

## Security

Same function, same `SECURITY DEFINER` + empty search path, ACL unchanged (`postgres`, `service_role`); `public` / `anon` / `authenticated` stay revoked. Every link passes the existing `set_setting` rule (https, up to 300 characters).

## Verification

- New suite `99-…-builtin-standard-sources.cases.mjs` (3 cases) and two extra assertions in `00-philippine-standards.cases.mjs`: every built-in citation gets an official link except NSCP 2015 / PEC 2017 / PNS 49; existing links kept; case/space-insensitive; idempotent; the result passes Super Admin validation; Engineer / Client cannot run it. **537 tests pass.**
- Before applying: live function body matched the repository and `20261029190310` was the latest tracked migration.
- After: catalog still has 16 entries in the same order; 13 carry a source (7 earlier + 6 new); NSCP 2015, PEC 2017 and PNS 49 have none; function ACL unchanged; 10 built-in checklists unchanged.
- Security advisors: same three kinds of finding as before; none names this function or `system_settings`.

## Rollback

```sql
update public.system_settings set value = (
  select jsonb_agg(case when lower(e->>'code') in ('pd 1096','dole d.o. 13','ra 9514','ra 11058','bp 344','ra 1378') then e - 'source' else e end order by ord)
  from jsonb_array_elements(value) with ordinality x(e, ord)) where key = 'standards';
```
Then restore the function body from `20261028150000_project_checklists.sql`.
