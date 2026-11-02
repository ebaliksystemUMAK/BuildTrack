-- System Logs (Super Admin only, read only): the administrator and system TRANSACTIONS in the audit log, each one identifiable (when, who, what, to whom), in four categories.
--   accounts : user.*, profile.*, account.*, whitelist.*, invite.*, registration.*, identity.*, privacy.*, oauth.*, access.*  (account creation, approvals, role and status changes, ...)
--   system   : maintenance.*, feature.*, system.*, announcement.*, settings.*, photos.*, email.*, digest.*, message.*          (the system controls and settings)
--   data     : project.*, record.*, migration.*                                                                               (project removal / purge, record removal, migrations)
--   other    : any other named action
-- Plain table-change entries (pins.update, qa_work_attempts.insert, ...) are NOT here: they stay in the Company Records and Audits page (the unchanged Company audit log).
-- Additive: two read-only functions. Nothing in the audit log is changed. Rollback: drop function public.get_system_log(text, text, timestamptz, timestamptz, integer, integer), public.system_log_category(text);

create or replace function public.system_log_category(p_action text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_action is null then null
    when p_action ~ '^(user|profile|account|whitelist|invite|registration|identity|privacy|oauth|access)\.' then 'accounts'
    when p_action ~ '^(maintenance|feature|system|announcement|settings|photos|email|digest|message)\.' then 'system'
    when p_action ~ '^(project|record|migration)\.' then 'data'
    when p_action ~ '^[a-z_]+\.(insert|update|delete)$' then null
    else 'other'
  end;
$$;
revoke execute on function public.system_log_category(text) from public, anon;
grant execute on function public.system_log_category(text) to authenticated, service_role;

create or replace function public.get_system_log(p_category text default null, p_search text default null, p_from timestamptz default null, p_to timestamptz default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_search text := lower(btrim(coalesce(p_search, '')));
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can open the system logs' using errcode = '42501'; end if;
  if coalesce(p_category, '') not in ('', 'accounts', 'system', 'data', 'other') then raise exception 'Unknown category'; end if;
  return (select coalesce(jsonb_agg(r order by r.created_at desc, r.id desc), '[]'::jsonb) from (
    select l.id, l.created_at, l.action, public.system_log_category(l.action) as category,
      coalesce(nullif(a.full_name, ''), a.email, 'System') as actor_name, a.email as actor_email,
      coalesce(nullif(t.full_name, ''), t.email) as target_name,
      case when length(l.details::text) > 4000 then jsonb_build_object('truncated', true) else l.details end as details
    from public.audit_log l
    left join public.profiles a on a.id = l.actor_id
    left join public.profiles t on t.id = l.target_id
    where public.system_log_category(l.action) is not null
      and (coalesce(p_category, '') = '' or public.system_log_category(l.action) = p_category)
      and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at < p_to)
      and (v_search = '' or strpos(lower(l.action), v_search) > 0
           or strpos(lower(coalesce(a.full_name, '') || ' ' || coalesce(a.email, '')), v_search) > 0
           or strpos(lower(coalesce(t.full_name, '') || ' ' || coalesce(t.email, '')), v_search) > 0
           or (length(l.details::text) <= 4000 and strpos(lower(l.details::text), v_search) > 0))
    order by l.created_at desc, l.id desc
    limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(coalesce(p_offset, 0), 0)
  ) r);
end;
$$;
revoke execute on function public.get_system_log(text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.get_system_log(text, text, timestamptz, timestamptz, integer, integer) to authenticated;
