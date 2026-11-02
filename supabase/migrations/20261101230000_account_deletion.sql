-- Super Admin account deletion (Edge Function `account-control`, service role only).
-- Two outcomes, decided by the DATABASE from what the account has done:
--   delete : the account has NO records anywhere (no work, QA, reports, attendance, approvals ...): the sign-in and its profile are removed completely.
--   close  : the account has records: it is closed and anonymised ("Deleted account", sign-in email replaced, personal data wiped) and every record
--            stays exactly as it was, still pointing at the same account row. Nothing a person did on site is ever deleted or re-attributed.
-- "Records" are found from the catalog (every foreign key that points at an account and would be emptied or refused by a delete), so a table added later
-- is covered automatically. Logs (audit_log, email_log, email_test_log) are not records: the audit entry about the deletion keeps a snapshot.
-- Functions are service role only; nothing here is reachable from the browser. No existing function or table is changed.

create or replace function public.account_record_counts(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  fk record;
  n bigint;
  found jsonb := '{}'::jsonb;
  total bigint := 0;
begin
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'f' and c.confdeltype in ('n', 'r', 'a', 'd')
      and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
      and c.conrelid::regclass::text not in ('audit_log', 'email_log', 'email_test_log', 'public.audit_log', 'public.email_log', 'public.email_test_log')
      and c.conrelid::regclass::text not like 'auth.%'
    order by 1, 2
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col) into n using p_user;
    if n > 0 then
      found := found || jsonb_build_object(fk.tbl || '.' || fk.col, n);
      total := total + n;
    end if;
  end loop;
  return jsonb_build_object('total', total, 'where', found);
end;
$$;

-- What a deletion would do, for the confirmation screen. mode = 'delete' (nothing recorded) or 'close' (records are kept).
create or replace function public.account_delete_preview(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  rec jsonb;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null then return null; end if;
  rec := public.account_record_counts(p_user);
  return jsonb_build_object(
    'id', p.id, 'email', p.email, 'full_name', p.full_name, 'role', p.role, 'status', p.status,
    'already_closed', p.email like 'deleted-%@erased.invalid',
    'mode', case when (rec ->> 'total')::bigint = 0 then 'delete' else 'close' end,
    'records', rec -> 'where',
    'record_total', (rec ->> 'total')::bigint,
    'memberships', (select count(*) from public.project_members m where m.user_id = p_user),
    'managed_projects', (select count(*) from public.project_managers m where m.user_id = p_user),
    'open_work', (select count(*) from public.pins x where x.assigned_to = p_user and x.status <> 'verified')
  );
end;
$$;

-- Step 1 of a complete deletion: refuses unless the account has no records, lists its stored files (ID photos) and returns the snapshot for the audit entry.
create or replace function public.account_delete_prepare(p_user uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  rec jsonb;
  paths text[];
begin
  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'That account does not exist'; end if;
  if p_user = p_actor then raise exception 'You cannot delete your own account'; end if;
  if p.role = 'super_admin' then raise exception 'A Super Admin account cannot be deleted here'; end if;
  rec := public.account_record_counts(p_user);
  if (rec ->> 'total')::bigint > 0 then raise exception 'This account has records, so it can only be closed, not deleted'; end if;
  select coalesce(array_agg(x), '{}') into paths from (
    select front_path x from public.identity_verifications where user_id = p_user
    union select back_path from public.identity_verifications where user_id = p_user and back_path is not null
    union select selfie_path from public.identity_verifications where user_id = p_user
  ) s;
  return jsonb_build_object('paths', to_jsonb(paths), 'snapshot', jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name, 'role', p.role, 'status', p.status, 'created_at', p.created_at));
end;
$$;

-- A closed account: personal data wiped, sign-in made unusable by the function, every record kept. Same wiping as erase_user_data (0032) without a data request.
create or replace function public.close_account(p_user uuid, p_actor uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  paths text[];
  before_state jsonb;
begin
  select * into p from public.profiles where id = p_user for update;
  if p.id is null then raise exception 'That account does not exist'; end if;
  if p_user = p_actor then raise exception 'You cannot delete your own account'; end if;
  if p.role = 'super_admin' then raise exception 'A Super Admin account cannot be deleted here'; end if;
  if p.email like 'deleted-%@erased.invalid' then raise exception 'This account is already closed'; end if;
  before_state := jsonb_build_object('email', p.email, 'full_name', p.full_name, 'role', p.role, 'status', p.status);
  select coalesce(array_agg(x), '{}') into paths from (
    select front_path x from public.identity_verifications where user_id = p_user
    union select back_path from public.identity_verifications where user_id = p_user and back_path is not null
    union select selfie_path from public.identity_verifications where user_id = p_user
  ) s;
  delete from public.identity_verifications where user_id = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.access_requests where user_id = p_user;
  delete from public.invite_redemptions where user_id = p_user;
  delete from public.whitelisted_emails where lower(email) = lower(p.email);
  delete from public.admin_permissions where user_id = p_user;
  delete from public.photo_upload_overrides where user_id = p_user;
  update public.data_requests set status = 'done', decided_by = p_actor, decided_at = now() where user_id = p_user and status = 'open';
  update public.profiles set
    full_name = 'Deleted account', email = 'deleted-' || p_user::text || '@erased.invalid', phone = null, company = null, position = null, avatar_url = null,
    status = 'disabled', identity_status = 'unverified', identity_verified_at = null, email_verified_at = null
  where id = p_user;
  perform public.revoke_user_sessions(p_user);
  insert into public.audit_log (actor_id, target_id, action, details)
  values (p_actor, p_user, 'account.closed', jsonb_build_object('reason', p_reason, 'previous', before_state, 'files', coalesce(array_length(paths, 1), 0)));
  return jsonb_build_object('paths', to_jsonb(paths));
end;
$$;

revoke execute on function public.account_record_counts(uuid), public.account_delete_preview(uuid), public.account_delete_prepare(uuid, uuid), public.close_account(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.account_record_counts(uuid), public.account_delete_preview(uuid), public.account_delete_prepare(uuid, uuid), public.close_account(uuid, uuid, text) to service_role;

-- Rollback: drop these four functions. No table, column or existing function is changed by this migration.
--   drop function public.close_account(uuid, uuid, text), public.account_delete_prepare(uuid, uuid), public.account_delete_preview(uuid), public.account_record_counts(uuid);
