-- System Control: the new switches and read-only reports behind the System Control page (Super Admin only). Additive: one new table, new functions, and one added
-- check in four existing functions (everything else in them is byte-for-byte the live version).
--   * system_switches: two switches, both OFF by default - registration_closed and email_paused.
--   * registration closed: complete_registration, prepare_access_request and redeem_invite refuse with the Super Admin's message. Accounts that already have a role, the
--     whitelist and administrator-made accounts are not touched; a closed registration does not stop an inert basic account from being created (it has no access).
--   * email paused: claim_email_batch hands out nothing. Security codes (email-code function) are NOT affected.
--   * site_emergency_off(): one call switches off maintenance, every feature pause and both switches (never a forced logout, which cannot be undone).
--   * get_email_delivery(), get_storage_capacity(), get_system_activity(): read-only reports.
-- Design and rollback notes: docs/audits/2026-11-02-system-control.md.

create table if not exists public.system_switches (
  key text primary key check (key in ('registration_closed', 'email_paused')),
  enabled boolean not null default false,
  message text not null default '' check (char_length(message) <= 300),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.system_switches (key) values ('registration_closed'), ('email_paused') on conflict (key) do nothing;
alter table public.system_switches enable row level security;
revoke all on public.system_switches from anon, authenticated;

create or replace function public.system_switch_on(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.enabled from public.system_switches s where s.key = p_key), false);
$$;
revoke execute on function public.system_switch_on(text) from public, anon, authenticated;
grant execute on function public.system_switch_on(text) to service_role;

-- What a visitor needs to know before they try to register: closed or not, and the message. Nothing else.
create or replace function public.get_registration_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('closed', coalesce(s.enabled, false), 'message', case when coalesce(s.enabled, false) then coalesce(nullif(s.message, ''), 'New registrations are closed right now. Please try again later.') else '' end)
  from (select 1) x left join public.system_switches s on s.key = 'registration_closed';
$$;
revoke execute on function public.get_registration_status() from public;
grant execute on function public.get_registration_status() to anon, authenticated;

create or replace function public.get_system_switches()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can open the system controls' using errcode = '42501'; end if;
  return (select coalesce(jsonb_object_agg(s.key, jsonb_build_object('enabled', s.enabled, 'message', s.message, 'updated_at', s.updated_at, 'updated_by', public.display_name(s.updated_by))), '{}'::jsonb) from public.system_switches s);
end;
$$;
revoke execute on function public.get_system_switches() from public, anon;
grant execute on function public.get_system_switches() to authenticated;

create or replace function public.set_system_switch(p_key text, p_enabled boolean, p_message text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  old public.system_switches;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can change the system controls' using errcode = '42501'; end if;
  select * into old from public.system_switches where key = p_key for update;
  if not found then raise exception 'Unknown switch'; end if;
  if char_length(v_message) > 300 then raise exception 'The message can be at most 300 characters'; end if;
  if p_key = 'registration_closed' and coalesce(p_enabled, false) and char_length(v_message) < 5 then raise exception 'Write the message people will see (at least 5 characters)'; end if;
  if coalesce(p_enabled, false) = old.enabled and (not old.enabled or old.message is not distinct from v_message) then return jsonb_build_object('changed', false, 'enabled', old.enabled); end if;
  update public.system_switches set enabled = coalesce(p_enabled, false), message = case when coalesce(p_enabled, false) then v_message else old.message end, updated_by = auth.uid(), updated_at = now() where key = p_key;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'system.switch', jsonb_build_object('switch', p_key, 'enabled', coalesce(p_enabled, false), 'message', case when coalesce(p_enabled, false) then v_message else null end));
  return jsonb_build_object('changed', true, 'enabled', coalesce(p_enabled, false));
end;
$$;
revoke execute on function public.set_system_switch(text, boolean, text) from public, anon;
grant execute on function public.set_system_switch(text, boolean, text) to authenticated;

-- One call that puts every system control back to normal. It never signs anybody out (that cannot be undone) and never touches data or accounts.
create or replace function public.site_emergency_off()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_maintenance boolean; v_features text[]; v_switches text[];
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can change the system controls' using errcode = '42501'; end if;
  select maintenance_on into v_maintenance from public.site_controls where id = 1 for update;
  select coalesce(array_agg(feature order by feature), array[]::text[]) into v_features from public.feature_locks where locked;
  select coalesce(array_agg(key order by key), array[]::text[]) into v_switches from public.system_switches where enabled;
  update public.site_controls set maintenance_on = false, maintenance_returns_at = null, updated_by = auth.uid(), updated_at = now() where id = 1 and maintenance_on;
  update public.feature_locks set locked = false, updated_by = auth.uid(), updated_at = now() where locked;
  update public.system_switches set enabled = false, updated_by = auth.uid(), updated_at = now() where enabled;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'system.emergency_off', jsonb_build_object('maintenance_was_on', coalesce(v_maintenance, false), 'features_unlocked', v_features, 'switches_off', v_switches));
  return jsonb_build_object('maintenance', coalesce(v_maintenance, false), 'features', to_jsonb(v_features), 'switches', to_jsonb(v_switches));
end;
$$;
revoke execute on function public.site_emergency_off() from public, anon;
grant execute on function public.site_emergency_off() to authenticated;

-- ---------------------------------------------------------------- read-only reports (Super Admin only)
create or replace function public.get_email_delivery(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can open the system controls' using errcode = '42501'; end if;
  return jsonb_build_object(
    'sent_24h', (select count(*) from public.email_log where status = 'sent' and created_at > now() - interval '24 hours'),
    'failed_24h', (select count(*) from public.email_log where status = 'failed' and created_at > now() - interval '24 hours'),
    'skipped_24h', (select count(*) from public.email_log where status = 'skipped' and created_at > now() - interval '24 hours'),
    'waiting', (select count(*) from public.notifications where emailed_at is null and created_at > now() - interval '2 days'),
    'last_sent_at', (select max(created_at) from public.email_log where status = 'sent'),
    'last_failed_at', (select max(created_at) from public.email_log where status = 'failed'),
    'recent', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
      select l.created_at, l.status, left(coalesce(l.detail, ''), 200) as detail, n.kind, public.display_name(l.user_id) as person
      from public.email_log l left join public.notifications n on n.id = l.notification_id
      order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) r)
  );
end;
$$;
revoke execute on function public.get_email_delivery(integer) from public, anon;
grant execute on function public.get_email_delivery(integer) to authenticated;

create or replace function public.get_storage_capacity()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can open the system controls' using errcode = '42501'; end if;
  return jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'buckets', (select coalesce(jsonb_agg(b order by b.bytes desc), '[]'::jsonb) from (
      select o.bucket_id as bucket, count(*) as files, coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0) as bytes from storage.objects o group by o.bucket_id
    ) b)
  );
end;
$$;
revoke execute on function public.get_storage_capacity() from public, anon;
grant execute on function public.get_storage_capacity() to authenticated;

-- Only system actions (never role work): maintenance, feature pauses, forced logout, banner, switches, emergency off, settings, email test, permissions, account deletion, project purge.
create or replace function public.get_system_activity(p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can open the system controls' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
    select l.id, l.created_at, l.action, public.display_name(l.actor_id) as actor, l.details
    from public.audit_log l
    where l.action like 'maintenance.%' or l.action like 'feature.%' or l.action like 'announcement.%' or l.action like 'system.%'
       or l.action in ('user.force_logout', 'settings.update', 'email.test', 'user.set_permissions', 'account.closed', 'account.delete_requested', 'account.deleted', 'project.purged', 'project.purge_files', 'digest.admin')
    order by l.created_at desc, l.id desc
    limit greatest(1, least(coalesce(p_limit, 100), 300)) offset greatest(coalesce(p_offset, 0), 0)
  ) r);
end;
$$;
revoke execute on function public.get_system_activity(integer, integer) from public, anon;
grant execute on function public.get_system_activity(integer, integer) to authenticated;

-- ---------------------------------------------------------------- the added checks (the rest of each body is the live version)
create or replace function public.complete_registration(p_full_name text, p_phone text, p_company text, p_position text, p_requested_role app_role, p_discipline text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.profiles; r record;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Profile not found'; end if;
  if p.status not in ('pending', 'active') then raise exception 'This account cannot register'; end if;
  if p.registration_completed_at is not null then raise exception 'Registration was already submitted'; end if;
  if public.system_switch_on('registration_closed') then raise exception '%', coalesce(nullif((select s.message from public.system_switches s where s.key = 'registration_closed'), ''), 'New registrations are closed right now. Please try again later.'); end if;
  if p.email_verified_at is null then raise exception 'Verify your email first: enter the 6-digit code we send to your address'; end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 2 and 120 then raise exception 'Enter your full name'; end if;
  if char_length(btrim(coalesce(p_phone, ''))) not between 7 and 40 or btrim(p_phone) !~ '^[0-9+()./ -]+$' then raise exception 'Enter a valid phone number'; end if;
  if p_requested_role is null or p_requested_role not in ('engineer', 'foreman', 'client') then raise exception 'Choose Engineer, Foreman or Client'; end if;
  if p_requested_role = 'engineer' and (p_discipline is null or p_discipline not in ('civil_structural', 'architectural', 'mep')) then raise exception 'Engineers choose a discipline'; end if;
  update public.profiles set full_name = btrim(p_full_name), phone = btrim(p_phone), company = left(nullif(btrim(coalesce(p_company, '')), ''), 120), position = left(nullif(btrim(coalesce(p_position, '')), ''), 120),
    requested_role = p_requested_role, discipline = case when p_requested_role = 'engineer' then p_discipline else null end, registration_completed_at = now() where id = p.id;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (p.id, p.id, case when p.signup_provider = 'google' then 'oauth.enroll' else 'registration.submitted' end, jsonb_build_object('email', p.email, 'requested_role', p_requested_role, 'status', p.status));
  if p.status = 'pending' then
    for r in select pr.id from public.profiles pr where pr.status = 'active' and (pr.role = 'super_admin' or (pr.role = 'admin' and exists (select 1 from public.admin_permissions ap where ap.user_id = pr.id and ap.permission = 'users.approve'))) loop
      perform public.notify_user(r.id, 'registration.new', 'New registration: ' || left(coalesce(nullif(btrim(p_full_name), ''), p.email), 100), 'Asked for ' || p_requested_role::text || ' access (' || p.email || ')', '/admin/user-management', null, p.id);
    end loop;
  end if;
  return p.status::text;
end;
$$;

create or replace function public.prepare_access_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null or p.status <> 'active' or p.role is distinct from 'user' then raise exception 'Only a basic account can request elevated access'; end if;
  if public.system_switch_on('registration_closed') then raise exception '%', coalesce(nullif((select s.message from public.system_switches s where s.key = 'registration_closed'), ''), 'New registrations are closed right now. Please try again later.'); end if;
  if p.email_verified_at is null then raise exception 'Verify your email first: enter the 6-digit code we send to your address'; end if;
  if p.identity_status <> 'verified' then raise exception 'Verify your identity first: upload your ID so an administrator can confirm who you are'; end if;
  new.user_id := p.id; new.status := 'pending'; new.decided_by := null; new.decided_at := null; new.decision_note := null;
  return new;
end;
$$;

create or replace function public.redeem_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles; c public.invite_codes; v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')); confirmed timestamptz;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
  if me.role is distinct from 'user' then return jsonb_build_object('ok', false, 'reason', 'already_has_role'); end if;
  if public.system_switch_on('registration_closed') then return jsonb_build_object('ok', false, 'reason', 'registration_closed'); end if;
  if me.email_verified_at is null then return jsonb_build_object('ok', false, 'reason', 'email_not_verified'); end if;
  if me.identity_status <> 'verified' then return jsonb_build_object('ok', false, 'reason', 'not_verified'); end if;
  select email_confirmed_at into confirmed from auth.users where id = me.id;
  if confirmed is null then return jsonb_build_object('ok', false, 'reason', 'unconfirmed'); end if;
  if (select count(*) from public.invite_attempts where user_id = me.id and not ok and created_at > now() - interval '1 hour') >= 8 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  select * into c from public.invite_codes where code = v_code and not disabled and expires_at > now() and uses < max_uses for update;
  if c.id is null then
    insert into public.invite_attempts (user_id, ok) values (me.id, false);
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.profiles set role = c.assigned_role, discipline = coalesce(c.discipline, discipline), approved_by = c.created_by, approved_at = now() where id = me.id;
  update public.invite_codes set uses = uses + 1 where id = c.id;
  insert into public.invite_redemptions (code_id, user_id) values (c.id, me.id) on conflict do nothing;
  insert into public.invite_attempts (user_id, ok) values (me.id, true);
  update public.access_requests set status = 'approved', decided_by = c.created_by, decided_at = now(), decision_note = 'Joined with an invitation code' where user_id = me.id and status = 'pending';
  insert into public.audit_log (actor_id, target_id, action, details) values (c.created_by, me.id, 'invite.redeem', jsonb_build_object('role', c.assigned_role, 'email', me.email));
  return jsonb_build_object('ok', true, 'role', c.assigned_role);
end;
$$;

create or replace function public.claim_email_batch(p_limit integer default 25)
returns table (id uuid, user_id uuid, kind text, title text, body text, link text, to_email text, to_name text)
language plpgsql security definer set search_path = '' as $$
begin
  -- Paused by a Super Admin (System Control > Email): nothing is claimed, closed or sent, so nothing is lost while it is paused (rows older than 2 days are still never emailed).
  if public.system_switch_on('email_paused') then return; end if;
  -- Bell-only notifications are closed without an email and without a log line (they were never going to be sent).
  update public.notifications n set emailed_at = now()
  where n.emailed_at is null and public.notification_email_category(n.kind) = 'inapp';

  with decided as (
    select n.id, n.user_id,
      case
        when not exists (
          select 1 from public.profiles p
          where p.id = n.user_id and nullif(btrim(p.email), '') is not null
            and (p.status = 'active' or (p.status = 'disabled' and n.kind = 'account.suspended'))
        ) then 'not active, or no email address'
        when c.cat <> 'security' and not coalesce((
          select np.email_enabled and case c.cat when 'reminder' then np.email_reminders when 'announcement' then np.email_announcements else true end
          from public.notification_prefs np where np.user_id = n.user_id
        ), true) then 'opted out of this kind of email'
        when c.cat <> 'security' and (select count(*) from public.email_log l where l.user_id = n.user_id and l.status = 'sent' and l.created_at > now() - interval '24 hours') >= 20
          then 'daily limit reached'
      end as reason
    from public.notifications n
    cross join lateral (select public.notification_email_category(n.kind) as cat) c
    where n.emailed_at is null and n.created_at > now() - interval '2 days'
      and (n.email_claimed_at is null or n.email_claimed_at < now() - interval '10 minutes')
  ), skipped as (
    update public.notifications n set emailed_at = now()
    from decided d where n.id = d.id and d.reason is not null and n.emailed_at is null
    returning n.id, n.user_id, d.reason
  )
  insert into public.email_log (notification_id, user_id, status, detail)
  select s.id, s.user_id, 'skipped', s.reason from skipped s;
  -- Very old rows are closed quietly (an outage must not email last week's news).
  update public.notifications n set emailed_at = now() where n.emailed_at is null and n.created_at <= now() - interval '2 days';

  return query
  with picked as (
    select n.id from public.notifications n
    where n.emailed_at is null and n.email_attempts < 3
      and (n.email_claimed_at is null or n.email_claimed_at < now() - interval '10 minutes')
    order by n.created_at limit greatest(1, least(p_limit, 100))
    for update skip locked
  ), bumped as (
    update public.notifications n set email_attempts = n.email_attempts + 1, email_claimed_at = now() from picked where n.id = picked.id
    returning n.id, n.user_id, n.kind, n.title, n.body, n.link
  )
  select b.id, b.user_id, b.kind, b.title, b.body, b.link, p.email, p.full_name
  from bumped b join public.profiles p on p.id = b.user_id;
end;
$$;

-- Rollback: put complete_registration / prepare_access_request / redeem_invite back to 20261101210000 and claim_email_batch back to 20261101220000 (the same bodies
-- without the added check lines), then: drop function public.get_system_activity(integer, integer), public.get_storage_capacity(), public.get_email_delivery(integer),
-- public.site_emergency_off(), public.set_system_switch(text, boolean, text), public.get_system_switches(), public.get_registration_status(), public.system_switch_on(text);
-- drop table public.system_switches.
