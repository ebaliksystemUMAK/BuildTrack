-- System Control, second part (Super Admin only): a maintenance schedule and a read-only lockout watch. Additive: one new table, new functions, one Cron job.
--   * maintenance_windows: a window (start, end, message) that switches maintenance ON by itself at the start and OFF at the end. apply_maintenance_windows() runs every
--     minute from pg_cron. It never touches maintenance that a Super Admin switched on by hand (those rows carry updated_by), never switches on over a manual maintenance
--     (the window is marked skipped), and at the end switches off only what it switched on itself. Existing maintenance functions are not changed.
--   * get_lockout_watch(): read-only. Locked sign-up / reset codes, invitation-code lockouts and blocked Google sign-ins. Wrong PASSWORDS at sign-in are kept by Supabase
--     Auth, not by BuildTrack, so they are not here (Supabase Dashboard > Authentication > Logs).
-- Design: docs/audits/2026-11-02-system-control.md (section "Schedule and lockouts").

create table if not exists public.maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  message text not null check (char_length(message) between 5 and 500),
  status text not null default 'scheduled' check (status in ('scheduled', 'active', 'done', 'cancelled', 'skipped')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  ended_at timestamptz,
  end_note text,
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours')
);
create index if not exists maintenance_windows_status_idx on public.maintenance_windows (status, starts_at);
alter table public.maintenance_windows enable row level security;
revoke all on public.maintenance_windows from anon, authenticated;

create or replace function public.get_maintenance_windows()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ready boolean := false;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can open the system controls' using errcode = '42501'; end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = ''buildtrack-maintenance-windows'' and active)' into v_ready;
  end if;
  return jsonb_build_object(
    'scheduler_ready', v_ready,
    'windows', (select coalesce(jsonb_agg(r order by r.starts_at desc), '[]'::jsonb) from (
      select w.id, w.starts_at, w.ends_at, w.message, w.status, public.display_name(w.created_by) as created_by, w.activated_at, w.ended_at, w.end_note
      from public.maintenance_windows w
      where w.status in ('scheduled', 'active') or w.id in (select id from public.maintenance_windows where status not in ('scheduled', 'active') order by starts_at desc limit 10)
    ) r)
  );
end;
$$;
revoke execute on function public.get_maintenance_windows() from public, anon;
grant execute on function public.get_maintenance_windows() to authenticated;

create or replace function public.schedule_maintenance(p_starts timestamptz, p_ends timestamptz, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  v_id uuid;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can change the system controls' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('maintenance_windows'));
  if p_starts is null or p_ends is null then raise exception 'Choose when the window starts and ends'; end if;
  if p_starts < now() + interval '1 minute' then raise exception 'The start must be in the future'; end if;
  if p_starts > now() + interval '30 days' then raise exception 'The start can be at most 30 days ahead'; end if;
  if p_ends <= p_starts then raise exception 'The end must be after the start'; end if;
  if p_ends > p_starts + interval '24 hours' then raise exception 'A window can last at most 24 hours'; end if;
  if p_ends < p_starts + interval '5 minutes' then raise exception 'A window must last at least 5 minutes'; end if;
  if char_length(v_message) < 5 or char_length(v_message) > 500 then raise exception 'Write the message people will see (5 to 500 characters)'; end if;
  if exists (select 1 from public.maintenance_windows where status in ('scheduled', 'active') and tstzrange(starts_at, ends_at) && tstzrange(p_starts, p_ends)) then raise exception 'That overlaps another scheduled window'; end if;
  if (select count(*) from public.maintenance_windows where status = 'scheduled') >= 10 then raise exception 'There are already 10 scheduled windows. Cancel one first'; end if;
  insert into public.maintenance_windows (starts_at, ends_at, message, created_by) values (p_starts, p_ends, v_message, auth.uid()) returning id into v_id;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'maintenance.schedule', jsonb_build_object('window', v_id, 'starts_at', p_starts, 'ends_at', p_ends, 'message', v_message));
  return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.schedule_maintenance(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.schedule_maintenance(timestamptz, timestamptz, text) to authenticated;

-- Ends one window early. A scheduled window is simply cancelled; an active one switches the maintenance it started off now (never maintenance set by hand).
create or replace function public.cancel_maintenance_window(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.maintenance_windows; sc public.site_controls; v_note text;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can change the system controls' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('maintenance_windows'));
  select * into w from public.maintenance_windows where id = p_id for update;
  if not found then raise exception 'That window does not exist'; end if;
  if w.status = 'scheduled' then
    update public.maintenance_windows set status = 'cancelled', ended_at = now(), end_note = 'Cancelled before it started' where id = p_id;
    v_note := 'cancelled';
  elsif w.status = 'active' then
    select * into sc from public.site_controls where id = 1 for update;
    if sc.maintenance_on and sc.updated_by is null and sc.maintenance_message = w.message then
      update public.site_controls set maintenance_on = false, maintenance_returns_at = null, updated_at = now() where id = 1;
      v_note := 'ended now';
    else
      v_note := 'ended (maintenance was changed by hand, so it was left as it is)';
    end if;
    update public.maintenance_windows set status = 'done', ended_at = now(), end_note = 'Ended early by a Super Admin: ' || v_note where id = p_id;
  else
    raise exception 'That window is already over';
  end if;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'maintenance.schedule_cancel', jsonb_build_object('window', p_id, 'starts_at', w.starts_at, 'ends_at', w.ends_at, 'result', v_note));
  return jsonb_build_object('result', v_note);
end;
$$;
revoke execute on function public.cancel_maintenance_window(uuid) from public, anon;
grant execute on function public.cancel_maintenance_window(uuid) to authenticated;

-- Run every minute by pg_cron (and by nobody else). Ends the windows that are over first, then starts the ones whose time has come.
create or replace function public.apply_maintenance_windows()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.maintenance_windows; sc public.site_controls; v_on integer := 0; v_off integer := 0; v_skipped integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('maintenance_windows'));
  for w in select * from public.maintenance_windows where status = 'active' and ends_at <= now() order by ends_at for update loop
    select * into sc from public.site_controls where id = 1 for update;
    if sc.maintenance_on and sc.updated_by is null and sc.maintenance_message = w.message then
      update public.site_controls set maintenance_on = false, maintenance_returns_at = null, updated_at = now() where id = 1;
      update public.maintenance_windows set status = 'done', ended_at = now(), end_note = 'Switched off at the end of the window' where id = w.id;
      insert into public.audit_log (actor_id, target_id, action, details) values (null, null, 'maintenance.scheduled_off', jsonb_build_object('window', w.id, 'ends_at', w.ends_at));
      v_off := v_off + 1;
    else
      update public.maintenance_windows set status = 'done', ended_at = now(), end_note = case when sc.maintenance_on then 'Left on: maintenance was changed by hand during the window' else 'Maintenance was already off' end where id = w.id;
    end if;
  end loop;
  for w in select * from public.maintenance_windows where status = 'scheduled' and starts_at <= now() order by starts_at for update loop
    select * into sc from public.site_controls where id = 1 for update;
    if w.ends_at <= now() then
      update public.maintenance_windows set status = 'skipped', ended_at = now(), end_note = 'The window was over before it could start' where id = w.id;
      v_skipped := v_skipped + 1;
    elsif sc.maintenance_on then
      update public.maintenance_windows set status = 'skipped', ended_at = now(), end_note = 'Maintenance was already on, so this window was not applied' where id = w.id;
      v_skipped := v_skipped + 1;
    else
      update public.site_controls set maintenance_on = true, maintenance_message = w.message, maintenance_returns_at = w.ends_at, updated_by = null, updated_at = now() where id = 1;
      update public.maintenance_windows set status = 'active', activated_at = now() where id = w.id;
      insert into public.audit_log (actor_id, target_id, action, details) values (null, null, 'maintenance.scheduled_on', jsonb_build_object('window', w.id, 'ends_at', w.ends_at, 'message', w.message));
      v_on := v_on + 1;
    end if;
  end loop;
  return jsonb_build_object('switched_on', v_on, 'switched_off', v_off, 'skipped', v_skipped);
end;
$$;
revoke execute on function public.apply_maintenance_windows() from public, anon, authenticated;
grant execute on function public.apply_maintenance_windows() to service_role;

-- The Cron job (only where pg_cron exists; the job is one cheap function call a minute).
do $$
begin
  if to_regnamespace('cron') is not null and to_regclass('cron.job') is not null then
    if not exists (select 1 from cron.job where jobname = 'buildtrack-maintenance-windows') then
      perform cron.schedule('buildtrack-maintenance-windows', '* * * * *', 'select public.apply_maintenance_windows()');
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------- lockout watch (read only)
create or replace function public.get_lockout_watch()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can open the system controls' using errcode = '42501'; end if;
  return jsonb_build_object(
    'codes_requested_24h', (select count(*) from public.email_codes where created_at > now() - interval '24 hours'),
    'wrong_tries_24h', (select coalesce(sum(attempts), 0) from public.email_codes where created_at > now() - interval '24 hours'),
    'locked_codes', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
      select c.email, c.purpose, c.attempts, c.created_at, c.expires_at, (c.used_at is null and c.expires_at > now()) as still_locked
      from public.email_codes c where c.attempts >= 5 and c.created_at > now() - interval '24 hours' order by c.created_at desc limit 50
    ) r),
    'invite_attempts', (select coalesce(jsonb_agg(r order by r.failed desc, r.last_at desc), '[]'::jsonb) from (
      select public.display_name(a.user_id) as person, count(*) filter (where not a.ok) as failed, (count(*) filter (where not a.ok)) >= 8 as locked, max(a.created_at) as last_at
      from public.invite_attempts a where a.created_at > now() - interval '1 hour'
      group by a.user_id having count(*) filter (where not a.ok) >= 3 limit 50
    ) r),
    'blocked_signins_7d', (select count(*) from public.audit_log where action = 'oauth.blocked' and created_at > now() - interval '7 days'),
    'blocked_signins', (select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb) from (
      select l.created_at, left(coalesce(l.details ->> 'email', ''), 120) as email, left(coalesce(l.details ->> 'reason', ''), 120) as reason
      from public.audit_log l where l.action = 'oauth.blocked' and l.created_at > now() - interval '7 days' order by l.created_at desc limit 30
    ) r)
  );
end;
$$;
revoke execute on function public.get_lockout_watch() from public, anon;
grant execute on function public.get_lockout_watch() to authenticated;

-- Rollback: select cron.unschedule('buildtrack-maintenance-windows'); drop function public.get_lockout_watch(), public.apply_maintenance_windows(), public.cancel_maintenance_window(uuid),
-- public.schedule_maintenance(timestamptz, timestamptz, text), public.get_maintenance_windows(); drop table public.maintenance_windows. Maintenance switched on by a window is
-- switched off the usual way (System Control > Maintenance & isolation, or Switch everything off).
