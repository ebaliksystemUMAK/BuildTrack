-- Site controls: read-only maintenance mode, feature isolation and forced logout (additive; every control starts OFF; nothing is dropped or rewritten).
--   * One table `site_controls` (maintenance) and one `feature_locks` (seven named features), readable only through functions.
--   * A statement trigger `zz_site_guard` on the work tables refuses writes from NON-ADMIN signed-in accounts while maintenance or a feature lock applies. It runs for
--     RPC (SECURITY DEFINER) writes as well as direct ones, which row-level security cannot do. Admins, Super Admins and the backend (service role: devices, jobs,
--     Edge Functions: no signed-in user) are never refused. Refusals use error code BT503 so the offline queue can wait instead of failing the item.
--   * Forced logout: one Super Admin function removes the sessions of chosen non-admin accounts and stamps profiles.force_logout_at (the app signs the person out).
-- Design and risks: docs/audits/2026-11-01-admin-phase4-site-controls-design.md. Verification and the switch-off SQL: docs/audits/sql/20261101150000_site_controls.md.

-- ---------------------------------------------------------------- tables
create table if not exists public.site_controls (
  id smallint primary key default 1 check (id = 1),
  maintenance_on boolean not null default false,
  maintenance_message text not null default '' check (char_length(maintenance_message) <= 500),
  maintenance_returns_at timestamptz,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.site_controls (id) values (1) on conflict (id) do nothing;
alter table public.site_controls enable row level security;
revoke all on public.site_controls from anon, authenticated;

create table if not exists public.feature_locks (
  feature text primary key check (feature in ('quality', 'daily_reports', 'blueprint_editor', 'client_reports', 'site_issues', 'site_visits', 'attendance')),
  label text not null,
  locked boolean not null default false,
  audiences text[] not null default array['engineer', 'foreman', 'client', 'project_manager', 'user']
    check (cardinality(audiences) between 1 and 5 and audiences <@ array['engineer', 'foreman', 'client', 'project_manager', 'user']),
  message text not null default '' check (char_length(message) <= 500),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.feature_locks (feature, label) values
  ('quality', 'Quality inspections and defect reports'), ('daily_reports', 'Daily reports'), ('blueprint_editor', 'Plan editor markups'),
  ('client_reports', 'Client problem reports and questions'), ('site_issues', 'Site issue reports'), ('site_visits', 'Client site visits'), ('attendance', 'Attendance requests and concerns')
on conflict (feature) do nothing;
alter table public.feature_locks enable row level security;
revoke all on public.feature_locks from anon, authenticated;

alter table public.profiles add column if not exists force_logout_at timestamptz;

-- ---------------------------------------------------------------- the guard
-- Returns the message to show when THIS caller's write must be refused, or null. Cheap exit first: nothing switched on = no further lookups.
create or replace function public.site_write_block(p_feature text default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_role text; v_c public.site_controls; v_l public.feature_locks;
begin
  if v_uid is null then return null; end if; -- the backend: devices, scheduled jobs, Edge Functions (service role)
  select * into v_c from public.site_controls where id = 1;
  if not coalesce(v_c.maintenance_on, false) and (p_feature is null or not exists (select 1 from public.feature_locks f where f.feature = p_feature and f.locked)) then return null; end if;
  select p.role::text into v_role from public.profiles p where p.id = v_uid;
  if v_role is null or v_role in ('super_admin', 'admin') then return null; end if; -- administrators are never refused
  if coalesce(v_c.maintenance_on, false) then
    return 'Maintenance: ' || coalesce(nullif(btrim(v_c.maintenance_message), ''), 'BuildTrack is being updated.') || ' You can still look at everything; saving changes is paused.'
      || case when v_c.maintenance_returns_at is not null then ' Expected back around ' || to_char(v_c.maintenance_returns_at at time zone 'Asia/Manila', 'DD Mon HH24:MI') || ' (Manila time).' else '' end;
  end if;
  select * into v_l from public.feature_locks f where f.feature = p_feature and f.locked;
  if found and v_role = any (v_l.audiences) then
    return 'Paused: ' || v_l.label || ' is switched off for your role. ' || coalesce(nullif(btrim(v_l.message), ''), 'Please try again later.');
  end if;
  return null;
end;
$$;
revoke execute on function public.site_write_block(text) from public, anon, authenticated;

create or replace function public.site_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_message text;
begin
  v_message := public.site_write_block(nullif(tg_argv[0], ''));
  if v_message is not null then raise exception '%', v_message using errcode = 'BT503'; end if;
  return null;
end;
$$;
revoke execute on function public.site_guard() from public, anon, authenticated;

-- Which tables the guard protects. A feature key means the table belongs to that feature; '' = paused by maintenance only (shared core tables are never
-- locked by a feature switch, so one feature cannot disrupt another that shares them).
do $$
declare v_row record;
begin
  for v_row in select * from (values
    ('daily_reports', 'daily_reports'), ('daily_report_photos', 'daily_reports'), ('daily_report_revisions', 'daily_reports'),
    ('qa_templates', 'quality'), ('qa_template_items', 'quality'), ('qa_inspections', 'quality'), ('qa_inspection_items', 'quality'), ('qa_defects', 'quality'), ('qa_defect_events', 'quality'),
    ('qa_inspection_events', 'quality'), ('qa_photos', 'quality'), ('qa_work_attempts', 'quality'), ('pin_qa_submissions', 'quality'),
    ('blueprint_annotations', 'blueprint_editor'),
    ('client_snags', 'client_reports'), ('snag_photos', 'client_reports'), ('project_questions', 'client_reports'),
    ('site_issue_reports', 'site_issues'), ('site_issue_photos', 'site_issues'), ('site_issue_photo_revisions', 'site_issues'),
    ('site_visit_requests', 'site_visits'),
    ('attendance_concerns', 'attendance'), ('attendance_schedules', 'attendance'), ('worker_enrollment_requests', 'attendance'),
    ('pins', ''), ('pin_events', ''), ('pin_photos', ''), ('pin_checklist_items', ''), ('blueprints', ''), ('blueprint_revisions', ''),
    ('projects', ''), ('project_members', ''), ('project_blueprint_access', '')
  ) as t(tbl, feature) loop
    if to_regclass(format('public.%I', v_row.tbl)) is not null then
      execute format('drop trigger if exists zz_site_guard on public.%I', v_row.tbl);
      execute format('create trigger zz_site_guard before insert or update or delete on public.%I for each statement execute function public.site_guard(%L)', v_row.tbl, v_row.feature);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- what the app shows
-- Open to everyone (the login page can say "maintenance"); the part about the caller's own role needs a signed-in account.
create or replace function public.get_site_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c public.site_controls; v_role text := null; v_locks jsonb := '[]'::jsonb; v_restricted boolean := false;
begin
  select * into v_c from public.site_controls where id = 1;
  if auth.uid() is not null then select p.role::text into v_role from public.profiles p where p.id = auth.uid(); end if;
  v_restricted := coalesce(v_c.maintenance_on, false) and v_role is not null and v_role not in ('super_admin', 'admin');
  if v_role is not null and v_role not in ('super_admin', 'admin') then
    select coalesce(jsonb_agg(jsonb_build_object('feature', f.feature, 'label', f.label, 'message', f.message) order by f.label), '[]'::jsonb) into v_locks
      from public.feature_locks f where f.locked and v_role = any (f.audiences);
  end if;
  return jsonb_build_object(
    'maintenance', case when coalesce(v_c.maintenance_on, false) then jsonb_build_object('on', true, 'message', v_c.maintenance_message, 'returns_at', v_c.maintenance_returns_at) else jsonb_build_object('on', false) end,
    'restricted', v_restricted, 'role', v_role, 'locks', v_locks);
end;
$$;
revoke execute on function public.get_site_status() from public;
grant execute on function public.get_site_status() to anon, authenticated;

-- Everything, for the Super Admin's control page.
create or replace function public.get_site_controls()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c public.site_controls;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can manage the site controls' using errcode = '42501'; end if;
  select * into v_c from public.site_controls where id = 1;
  return jsonb_build_object(
    'maintenance', jsonb_build_object('on', v_c.maintenance_on, 'message', v_c.maintenance_message, 'returns_at', v_c.maintenance_returns_at, 'updated_at', v_c.updated_at,
      'updated_by', case when v_c.updated_by is null then null else public.display_name(v_c.updated_by) end),
    'features', (select coalesce(jsonb_agg(jsonb_build_object('feature', f.feature, 'label', f.label, 'locked', f.locked, 'audiences', f.audiences, 'message', f.message, 'updated_at', f.updated_at) order by f.label), '[]'::jsonb) from public.feature_locks f),
    'last_forced_logout', (select jsonb_build_object('at', l.created_at, 'by', public.display_name(l.actor_id), 'details', l.details) from public.audit_log l where l.action = 'user.force_logout' order by l.id desc limit 1));
end;
$$;
revoke execute on function public.get_site_controls() from public, anon;
grant execute on function public.get_site_controls() to authenticated;

-- ---------------------------------------------------------------- switches (Super Admin + MFA)
create or replace function public.set_maintenance(p_on boolean, p_message text, p_returns_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  old public.site_controls; v_action text;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can manage the site controls' using errcode = '42501'; end if;
  if char_length(v_message) > 500 then raise exception 'The message can be at most 500 characters'; end if;
  if coalesce(p_on, false) then
    if char_length(v_message) < 5 then raise exception 'Write a message people will see (at least 5 characters)'; end if;
    if p_returns_at is not null and (p_returns_at <= now() or p_returns_at > now() + interval '14 days') then raise exception 'The return time must be in the future and within 14 days'; end if;
  end if;
  select * into old from public.site_controls where id = 1 for update;
  if coalesce(p_on, false) = old.maintenance_on and (not old.maintenance_on or (old.maintenance_message is not distinct from v_message and old.maintenance_returns_at is not distinct from p_returns_at)) then
    return jsonb_build_object('changed', false, 'on', old.maintenance_on);
  end if;
  update public.site_controls set maintenance_on = coalesce(p_on, false), maintenance_message = case when coalesce(p_on, false) then v_message else old.maintenance_message end,
    maintenance_returns_at = case when coalesce(p_on, false) then p_returns_at else null end, updated_by = auth.uid(), updated_at = now() where id = 1;
  v_action := case when coalesce(p_on, false) and not old.maintenance_on then 'maintenance.on' when coalesce(p_on, false) then 'maintenance.update' else 'maintenance.off' end;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, v_action, jsonb_build_object('on', coalesce(p_on, false), 'message', case when coalesce(p_on, false) then v_message else null end, 'returns_at', case when coalesce(p_on, false) then p_returns_at else null end));
  return jsonb_build_object('changed', true, 'on', coalesce(p_on, false));
end;
$$;
revoke execute on function public.set_maintenance(boolean, text, timestamptz) from public, anon;
grant execute on function public.set_maintenance(boolean, text, timestamptz) to authenticated;

create or replace function public.set_feature_lock(p_feature text, p_locked boolean, p_audiences text[], p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  v_roles text[]; old public.feature_locks; v_action text;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can manage the site controls' using errcode = '42501'; end if;
  select * into old from public.feature_locks where feature = p_feature for update;
  if not found then raise exception 'Unknown feature'; end if;
  if char_length(v_message) > 500 then raise exception 'The message can be at most 500 characters'; end if;
  select coalesce(array_agg(distinct r order by r), array[]::text[]) into v_roles from unnest(coalesce(p_audiences, old.audiences)) r;
  if cardinality(v_roles) = 0 or not (v_roles <@ array['engineer', 'foreman', 'client', 'project_manager', 'user']) then raise exception 'Choose who is affected: Engineer, Foreman, Client, Project Manager or Basic user (never Admins)'; end if;
  if coalesce(p_locked, false) and char_length(v_message) < 5 then raise exception 'Write the message people will see (at least 5 characters)'; end if;
  if coalesce(p_locked, false) = old.locked and v_roles = (select coalesce(array_agg(x order by x), array[]::text[]) from unnest(old.audiences) x) and (not old.locked or old.message is not distinct from v_message) then return jsonb_build_object('changed', false, 'locked', old.locked); end if;
  update public.feature_locks set locked = coalesce(p_locked, false), audiences = v_roles, message = case when coalesce(p_locked, false) then v_message else old.message end, updated_by = auth.uid(), updated_at = now() where feature = p_feature;
  v_action := case when coalesce(p_locked, false) and not old.locked then 'feature.lock' when coalesce(p_locked, false) then 'feature.update' else 'feature.unlock' end;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, v_action, jsonb_build_object('feature', p_feature, 'label', old.label, 'locked', coalesce(p_locked, false), 'audiences', v_roles, 'message', case when coalesce(p_locked, false) then v_message else null end));
  return jsonb_build_object('changed', true, 'locked', coalesce(p_locked, false));
end;
$$;
revoke execute on function public.set_feature_lock(text, boolean, text[], text) from public, anon;
grant execute on function public.set_feature_lock(text, boolean, text[], text) to authenticated;

-- ---------------------------------------------------------------- forced logout (Super Admin + MFA)
-- The accounts a forced logout would reach: ACTIVE, non-admin, in the chosen roles, and (when a project is chosen) members or managers of that project.
create or replace function public.force_logout_targets(p_roles text[], p_project uuid)
returns table (id uuid, role text) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_roles is null or cardinality(p_roles) = 0 or not (p_roles <@ array['engineer', 'foreman', 'client', 'project_manager', 'user']) then raise exception 'Choose the roles to sign out (never Admins)'; end if;
  return query select p.id, p.role::text from public.profiles p
    where p.status = 'active' and p.role::text = any (p_roles) and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
      and (p_project is null or exists (select 1 from public.project_members m where m.project_id = p_project and m.user_id = p.id) or exists (select 1 from public.project_managers pm where pm.project_id = p_project and pm.user_id = p.id));
end;
$$;
revoke execute on function public.force_logout_targets(text[], uuid) from public, anon, authenticated;

create or replace function public.preview_force_logout(p_roles text[], p_project uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_total integer; v_roles jsonb; v_recent integer; v_last timestamptz;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can manage the site controls' using errcode = '42501'; end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project) then raise exception 'That project does not exist'; end if;
  select count(*)::integer into v_total from public.force_logout_targets(p_roles, p_project);
  select coalesce(jsonb_object_agg(t.role, t.n), '{}'::jsonb) into v_roles from (select role, count(*) n from public.force_logout_targets(p_roles, p_project) group by role) t;
  select count(*)::integer into v_recent from public.force_logout_targets(p_roles, p_project) t join auth.users u on u.id = t.id where u.last_sign_in_at > now() - interval '24 hours';
  select max(created_at) into v_last from public.audit_log where action = 'user.force_logout';
  return jsonb_build_object('total', v_total, 'by_role', v_roles, 'signed_in_last_24h', v_recent, 'confirm_phrase', 'LOG OUT ' || v_total,
    'cooldown_seconds', case when v_last is not null and v_last > now() - interval '10 minutes' then ceil(extract(epoch from (v_last + interval '10 minutes' - now())))::integer else 0 end);
end;
$$;
revoke execute on function public.preview_force_logout(text[], uuid) from public, anon;
grant execute on function public.preview_force_logout(text[], uuid) to authenticated;

-- Signs the chosen accounts out: their refresh tokens and sessions are deleted, and force_logout_at tells the app to sign them out within about 30 seconds.
-- It needs the count from a fresh preview, the exact phrase "LOG OUT <count>" and a reason, and refuses a second run within 10 minutes. Access tokens that
-- were already issued stay valid until they expire (the screen says so); suspending an account is what stops it at once. Saved offline items stay on the device.
create or replace function public.force_logout(p_roles text[], p_project uuid, p_expected integer, p_confirm text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  v_ids uuid[]; v_n integer; v_id uuid; v_sessions integer := 0; v_removed integer;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can manage the site controls' using errcode = '42501'; end if;
  if p_project is not null and not exists (select 1 from public.projects where id = p_project) then raise exception 'That project does not exist'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 300 then raise exception 'Give a reason of 5 to 300 characters'; end if;
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_ids from public.force_logout_targets(p_roles, p_project) t;
  v_n := cardinality(v_ids);
  if v_n = 0 then raise exception 'No active account matches'; end if;
  if v_n > 1000 then raise exception 'That is more than 1,000 accounts. Narrow it by role or project'; end if;
  if p_expected is distinct from v_n then raise exception 'The number of affected accounts is now %. Preview again before confirming', v_n; end if;
  if p_confirm is distinct from 'LOG OUT ' || v_n then raise exception 'Type the confirmation exactly: LOG OUT %', v_n; end if;
  if exists (select 1 from public.audit_log where action = 'user.force_logout' and created_at > now() - interval '10 minutes') then raise exception 'A forced logout was done in the last 10 minutes. Wait before doing another'; end if;
  foreach v_id in array v_ids loop
    v_removed := public.revoke_user_sessions(v_id);
    v_sessions := v_sessions + coalesce(v_removed, 0);
  end loop;
  update public.profiles set force_logout_at = now() where id = any (v_ids);
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, 'user.force_logout', jsonb_build_object('roles', p_roles, 'project', p_project, 'accounts', v_n, 'sessions_removed', v_sessions, 'reason', v_reason));
  return jsonb_build_object('accounts', v_n, 'sessions_removed', v_sessions);
end;
$$;
revoke execute on function public.force_logout(text[], uuid, integer, text, text) from public, anon;
grant execute on function public.force_logout(text[], uuid, integer, text, text) to authenticated;

-- ---------------------------------------------------------------- Rollback notes (not executed)
--   Switch everything off first (maintenance_on = false, feature_locks.locked = false), then:
--     do $$ declare t text; begin for t in select event_object_table from information_schema.triggers where trigger_schema = 'public' and trigger_name = 'zz_site_guard' loop
--       execute format('drop trigger zz_site_guard on public.%I', t); end loop; end $$;
--     drop function public.force_logout(text[], uuid, integer, text, text), public.preview_force_logout(text[], uuid), public.force_logout_targets(text[], uuid),
--       public.set_feature_lock(text, boolean, text[], text), public.set_maintenance(boolean, text, timestamptz), public.get_site_controls(), public.get_site_status(),
--       public.site_guard(), public.site_write_block(text);
--     drop table public.feature_locks, public.site_controls;
--     alter table public.profiles drop column force_logout_at;
