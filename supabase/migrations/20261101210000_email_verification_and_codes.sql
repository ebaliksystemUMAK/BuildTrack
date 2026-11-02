-- Verified email before a registration / access request reaches an administrator, and the table behind the emailed 6-digit codes (additive; nothing is deleted).
--   * profiles.email_verified_at: when this person proved they own their address. Set by (1) Supabase's own sign-up confirmation (the person typed the emailed code: the
--     confirmation happens AFTER the account exists), or (2) the Edge Function `email-code` after the person typed a code it emailed. A Google account, an account made
--     by an administrator and an account that Supabase confirmed at creation (the "Confirm email" setting off) are NOT verified until (2) happens.
--   * complete_registration (Google registration), prepare_access_request (basic account asking for access) and redeem_invite refuse an unverified account.
--   * email_codes: hashed one-time codes with a 10-minute life, a 60-second pause between codes, 5 codes an hour and 5 wrong tries per code. Service role only.
-- Design: docs/audits/2026-11-01-email-codes-and-account-control.md.

-- ---------------------------------------------------------------- verified email
alter table public.profiles add column if not exists email_verified_at timestamptz;

-- Accounts that confirmed their address by typing the emailed code (the confirmation came well after the account was created) are verified already.
update public.profiles p set email_verified_at = u.email_confirmed_at
  from auth.users u
 where u.id = p.id and p.email_verified_at is null and coalesce(u.raw_app_meta_data ->> 'provider', '') = 'email'
   and u.email_confirmed_at is not null and u.email_confirmed_at - u.created_at > interval '5 seconds';

create or replace function public.sync_email_verified()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email_verified_at = new.email_confirmed_at where id = new.id and email_verified_at is null;
  return new;
end;
$$;
revoke execute on function public.sync_email_verified() from public, anon, authenticated;
drop trigger if exists auth_users_email_verified on auth.users;
create trigger auth_users_email_verified after update of email_confirmed_at on auth.users
  for each row when (old.email_confirmed_at is null and new.email_confirmed_at is not null) execute function public.sync_email_verified();

-- ---------------------------------------------------------------- one-time codes
create table if not exists public.email_codes (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('reset', 'register')),
  email text not null check (email = lower(email) and char_length(email) <= 320),
  user_id uuid references auth.users (id) on delete cascade,
  code_hash text not null check (char_length(code_hash) = 64),
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists email_codes_lookup_idx on public.email_codes (email, purpose, created_at desc);
alter table public.email_codes enable row level security;
revoke all on public.email_codes from anon, authenticated;

-- Called by the Edge Function (service role) after it made a code and hashed it. Refuses too-frequent requests; the older unused codes stop working.
create or replace function public.issue_email_code(p_email text, p_purpose text, p_user uuid, p_hash text, p_minutes integer default 10)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if p_purpose not in ('reset', 'register') then raise exception 'Unknown purpose'; end if;
  perform pg_advisory_xact_lock(hashtext(v_email || ':' || p_purpose)); -- one request at a time per address keeps the limits exact
  delete from public.email_codes where created_at < now() - interval '1 day';
  if exists (select 1 from public.email_codes where email = v_email and purpose = p_purpose and created_at > now() - interval '60 seconds') then
    raise exception 'Wait a minute before asking for another code' using errcode = 'P0001';
  end if;
  if (select count(*) from public.email_codes where email = v_email and purpose = p_purpose and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many codes were requested. Try again in an hour' using errcode = 'P0001';
  end if;
  update public.email_codes set used_at = now() where email = v_email and purpose = p_purpose and used_at is null;
  insert into public.email_codes (purpose, email, user_id, code_hash, expires_at)
  values (p_purpose, v_email, p_user, p_hash, now() + make_interval(mins => greatest(1, least(coalesce(p_minutes, 10), 30)))) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.issue_email_code(text, text, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.issue_email_code(text, text, uuid, text, integer) to service_role;

-- Checks the typed code (already hashed by the function). A code works once, for 10 minutes, with 5 tries; a wrong try is counted against the newest code only.
create or replace function public.consume_email_code(p_email text, p_purpose text, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); c public.email_codes;
begin
  perform pg_advisory_xact_lock(hashtext(v_email || ':' || p_purpose));
  select * into c from public.email_codes where email = v_email and purpose = p_purpose and used_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if c.attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if c.code_hash = p_hash then
    update public.email_codes set used_at = now() where id = c.id;
    return jsonb_build_object('ok', true, 'user_id', c.user_id);
  end if;
  update public.email_codes set attempts = attempts + 1 where id = c.id;
  return jsonb_build_object('ok', false, 'reason', case when c.attempts + 1 >= 5 then 'locked' else 'invalid' end);
end;
$$;
revoke execute on function public.consume_email_code(text, text, text) from public, anon, authenticated;
grant execute on function public.consume_email_code(text, text, text) to service_role;

create or replace function public.mark_email_verified(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email_verified_at = coalesce(email_verified_at, now()) where id = p_user;
  insert into public.audit_log (actor_id, target_id, action, details) values (p_user, p_user, 'account.email_verified', '{}'::jsonb);
end;
$$;
revoke execute on function public.mark_email_verified(uuid) from public, anon, authenticated;
grant execute on function public.mark_email_verified(uuid) to service_role;

-- ---------------------------------------------------------------- the gates (the only change to each: refuse an unverified address)
create or replace function public.complete_registration(p_full_name text, p_phone text, p_company text, p_position text, p_requested_role app_role, p_discipline text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare p public.profiles; r record;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null then raise exception 'Profile not found'; end if;
  if p.status not in ('pending', 'active') then raise exception 'This account cannot register'; end if;
  if p.registration_completed_at is not null then raise exception 'Registration was already submitted'; end if;
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

-- ---------------------------------------------------------------- Rollback notes (not executed)
--   Put complete_registration / prepare_access_request / redeem_invite back to the versions of 20261012104604_google_registration_gate, the access request migration and 20261011052520_notifications_invites_audit
--   (the same bodies without the email_verified_at line); drop trigger auth_users_email_verified on auth.users; drop function public.sync_email_verified(), public.mark_email_verified(uuid),
--   public.consume_email_code(text, text, text), public.issue_email_code(text, text, uuid, text, integer); drop table public.email_codes; alter table public.profiles drop column email_verified_at.
