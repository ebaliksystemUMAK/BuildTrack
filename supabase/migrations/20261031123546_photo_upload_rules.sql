-- Site photo rules, part 2 (after 20261031120532): per-account choices and a permission that lets chosen Admins manage them.
-- Both are shown in Admin > System settings > Site photos.
--   * Admin permission photos.manage (Permission matrix; only the Super Admin grants it, through admin-users set_permissions).
--     With MFA such an Admin may change the company switch photos.allow_device_upload and the per-account choices. Every
--     other system setting stays Super Admin only.
--   * photo_upload_overrides: at most one row per Foreman / Engineer account.
--       allow        device uploads are accepted from this person whatever the company switch says
--       camera_only  only in-app camera photos taken at the project site, also for this person's QA / inspection photos
--     No row = follow the company switch (as in 20261031120532: only a Foreman's QA photos follow it).
--     Read-only to the API, written only by set_photo_upload_rule (audited as photos.account_rule). A person reads their own
--     row (so their screen offers the right buttons); Admins with photos.manage or users.view read the list.
-- Additive: no existing row changes; with no rows the behaviour is exactly that of 20261031120532.

alter table public.admin_permissions drop constraint admin_permissions_permission_check;
alter table public.admin_permissions add constraint admin_permissions_permission_check check (permission in (
  'users.view', 'users.create', 'users.edit', 'users.approve', 'users.disable',
  'users.impersonate', 'biometrics.manage', 'projects.manage', 'blueprints.manage', 'photos.manage'
));

create table public.photo_upload_overrides (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('allow', 'camera_only')),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
alter table public.photo_upload_overrides enable row level security;
revoke all on public.photo_upload_overrides from public, anon, authenticated;
grant select on public.photo_upload_overrides to authenticated;
create policy "read photo rules" on public.photo_upload_overrides for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_permission('photos.manage')) or (select public.has_permission('users.view')));

-- p_mode null = follow the company setting (the row is removed).
create function public.set_photo_upload_rule(p_user uuid, p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_before text;
begin
  if not public.has_permission('photos.manage') then
    raise exception 'Only a Super Admin or an Admin with the Site photos permission (with MFA) can change photo rules';
  end if;
  if p_mode is not null and p_mode not in ('allow', 'camera_only') then
    raise exception 'Choose Follow company setting, Allow uploads or Camera only';
  end if;
  select p.role::text into v_role from public.profiles p where p.id = p_user;
  if v_role is null or v_role not in ('foreman', 'engineer') then
    raise exception 'Photo rules apply to Foreman and Engineer accounts only';
  end if;
  select o.mode into v_before from public.photo_upload_overrides o where o.user_id = p_user for update;
  if p_mode is null then
    delete from public.photo_upload_overrides where user_id = p_user;
  else
    insert into public.photo_upload_overrides (user_id, mode, updated_by, updated_at) values (p_user, p_mode, auth.uid(), now())
    on conflict (user_id) do update set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  if v_before is distinct from p_mode then
    insert into public.audit_log (actor_id, target_id, action, details)
    values (auth.uid(), p_user, 'photos.account_rule', jsonb_build_object('before', coalesce(v_before, 'company'), 'after', coalesce(p_mode, 'company')));
  end if;
end;
$$;

-- Active Foremen and Engineers with their choice (null = company setting), for the System settings list.
create function public.get_photo_upload_accounts()
returns table (user_id uuid, full_name text, email text, role text, mode text, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.has_permission('photos.manage') or public.has_permission('users.view')) then
    raise exception 'Only a Super Admin or an Admin with the Site photos or View users permission can see photo rules';
  end if;
  return query
    select p.id, p.full_name, p.email, p.role::text, o.mode, o.updated_at
    from public.profiles p left join public.photo_upload_overrides o on o.user_id = p.id
    where p.role::text in ('foreman', 'engineer') and p.status::text = 'active'
    order by p.role::text desc, lower(coalesce(nullif(p.full_name, ''), p.email)), p.id;
end;
$$;

-- Same checks as 20261031120532; the person's own choice now comes first.
create or replace function public.enforce_photo_capture_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
begin
  if auth.uid() is null then
    return new;
  end if;
  select o.mode into v_mode from public.photo_upload_overrides o where o.user_id = auth.uid();
  if v_mode = 'allow' then
    return new;
  end if;
  if v_mode is null then
    if public.photo_uploads_allowed() then
      return new;
    end if;
    if tg_table_name = 'qa_photos' and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'foreman') then
      return new;
    end if;
  end if;
  if new.capture_source is distinct from 'camera' then
    raise exception 'Photo uploads are turned off: take the photo with the BuildTrack camera at the project site';
  end if;
  case new.stamp_flag
    when 'at_site' then
      return new;
    when 'no_location' then
      raise exception 'Turn on location: photos must be taken at the project site, and this photo has no position';
    when 'no_site_set' then
      raise exception 'This project has no site location yet, so photos cannot be checked. Ask an Admin or the Project Manager to set it';
    when 'away_from_site' then
      raise exception 'This photo was taken % from the project site. Photos must be taken at the site',
        case when new.distance_m < 1000 then new.distance_m || ' m' else round(new.distance_m / 1000.0, 1) || ' km' end;
    else
      raise exception 'The phone time cannot be trusted for this photo. Check the date and time settings and take it again';
  end case;
end;
$$;

-- Same as 20261031120532, except that photos.allow_device_upload may also be changed by an Admin with photos.manage.
create or replace function public.set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := p_value;
  code text;
  seen text[] := '{}';
  item jsonb;
begin
  if p_key = 'photos.allow_device_upload' then
    if not public.has_permission('photos.manage') then
      raise exception 'Only a Super Admin or an Admin with the Site photos permission (with MFA) can change photo rules';
    end if;
  elsif not public.is_super_admin() then
    raise exception 'Only a Super Admin (with MFA) can change settings';
  end if;
  if not exists (select 1 from public.system_settings where key = p_key) then
    raise exception 'Unknown setting: %', p_key;
  end if;

  if p_key = 'qa.acceptance_threshold' then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 50 and 100 then
      raise exception 'The acceptance threshold is a whole number from 50 to 100';
    end if;
  elsif p_key = 'qa.weights' then
    if jsonb_typeof(v) <> 'object' or not (v ?& array['critical', 'major', 'minor']) or (select count(*) from jsonb_object_keys(v)) <> 3 then
      raise exception 'Weights need exactly critical, major and minor';
    end if;
    foreach code in array array['critical', 'major', 'minor'] loop
      if jsonb_typeof(v -> code) <> 'number' or (v ->> code)::numeric <> trunc((v ->> code)::numeric) or (v ->> code)::numeric not between 1 and 20 then
        raise exception 'Each weight is a whole number from 1 to 20';
      end if;
    end loop;
    if (v ->> 'critical')::int < (v ->> 'major')::int or (v ->> 'major')::int < (v ->> 'minor')::int then
      raise exception 'A critical item must weigh at least as much as a major one, and a major at least as much as a minor one';
    end if;
  elsif p_key = 'work.hours' then
    if jsonb_typeof(v) <> 'object' or (v ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Working hours need a start and an end time (HH:MM)';
    end if;
    if (v ->> 'start') >= (v ->> 'end') then raise exception 'The end time must be after the start time'; end if;
    if jsonb_typeof(v -> 'days') <> 'array' or jsonb_array_length(v -> 'days') not between 1 and 7 then
      raise exception 'Pick at least one working day';
    end if;
    for item in select * from jsonb_array_elements(v -> 'days') loop
      if jsonb_typeof(item) <> 'number' or (item #>> '{}') !~ '^[1-7]$' or (item #>> '{}') = any (seen) then
        raise exception 'Working days are the numbers 1 to 7, each once';
      end if;
      seen := seen || (item #>> '{}');
    end loop;
  elsif p_key = 'standards' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 30 then raise exception 'Up to 30 standards'; end if;
    for item in select * from jsonb_array_elements(v) loop
      if jsonb_typeof(item) <> 'object' or char_length(coalesce(item ->> 'code', '')) not between 2 and 40 or char_length(coalesce(item ->> 'title', '')) not between 2 and 120 then
        raise exception 'Each standard needs a code (2-40 characters) and a title (2-120 characters)';
      end if;
      if item ? 'source' and (jsonb_typeof(item -> 'source') <> 'string' or char_length(item ->> 'source') > 300
          or (item ->> 'source') !~ '^https://[^[:space:]]{4,}$') then
        raise exception 'An official source must be an https:// link of up to 300 characters';
      end if;
      if lower(item ->> 'code') = any (seen) then raise exception 'Each standard code can appear once'; end if;
      seen := seen || lower(item ->> 'code');
    end loop;
  elsif p_key = 'access.inactive_days' then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 14 and 365 then
      raise exception 'Inactive days is a whole number from 14 to 365';
    end if;
  elsif p_key = 'photos.allow_device_upload' then
    if jsonb_typeof(v) <> 'boolean' then
      raise exception 'Photo uploads are either allowed (true) or not (false)';
    end if;
  end if;

  update public.system_settings set value = v, updated_by = auth.uid(), updated_at = now() where key = p_key;
  insert into public.audit_log (actor_id, action, details) values (auth.uid(), 'settings.update', jsonb_build_object('key', p_key, 'value', v));
end;
$$;

revoke all on function public.set_photo_upload_rule(uuid, text) from public, anon;
grant execute on function public.set_photo_upload_rule(uuid, text) to authenticated;
revoke all on function public.get_photo_upload_accounts() from public, anon;
grant execute on function public.get_photo_upload_accounts() to authenticated;
revoke all on function public.enforce_photo_capture_policy() from public, anon, authenticated;
revoke execute on function public.set_setting(text, jsonb) from public, anon;
grant execute on function public.set_setting(text, jsonb) to authenticated;
notify pgrst, 'reload schema';
