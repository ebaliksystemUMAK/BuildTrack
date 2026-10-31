-- Site photo capture policy: one Super Admin switch, `photos.allow_device_upload` in system_settings.
--   true  (default) daily progress report photos and field evidence may be taken with the in-app camera OR chosen from the
--         device; the time / place stamp is recorded and flagged as before (0039) and never blocks the photo.
--   false only photos taken with the in-app camera AT THE PROJECT SITE are accepted for
--           * daily progress report photos (daily_report_photos),
--           * work item / correction evidence (pin_photos; only the assigned Foreman adds these),
--           * QA / NCR evidence a Foreman adds (qa_photos: preparing a requested inspection, fixing an NCR).
--         Engineers' own inspection photos are not affected. The browser says how the photo was made (capture_source:
--         camera | upload); 'upload' and 'legacy' are refused, and so is every stamp other than at_site (no position, away
--         from the site, project without a site location, untrusted phone time). Service-role writes (restore) are not checked.
-- What this is not: a determined person can fake a camera or GPS; the stamp still records what the phone sent (0039).
-- Additive: existing photos keep their rows (pin / QA photos become capture_source 'legacy'); nothing is deleted.

insert into public.system_settings (key, value, description) values
  ('photos.allow_device_upload', 'true'::jsonb, 'Allow photos chosen from the device for daily reports and field evidence (false = in-app camera at the project site only)')
on conflict (key) do nothing;

alter table public.daily_report_photos drop constraint daily_report_photos_capture_source_check;
alter table public.daily_report_photos add constraint daily_report_photos_capture_source_check check (capture_source in ('legacy', 'camera', 'upload'));
alter table public.pin_photos add column capture_source text not null default 'legacy' check (capture_source in ('legacy', 'camera', 'upload'));
alter table public.qa_photos add column capture_source text not null default 'legacy' check (capture_source in ('legacy', 'camera', 'upload'));
grant insert (capture_source) on public.qa_photos to authenticated;

-- Missing or malformed setting = uploads allowed (the behaviour before this switch existed).
create function public.photo_uploads_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value <> 'false'::jsonb from public.system_settings s where s.key = 'photos.allow_device_upload'), true);
$$;

-- Runs after <table>_stamp (triggers fire in name order), so stamp_flag and distance_m are already computed here.
create function public.enforce_photo_capture_policy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.photo_uploads_allowed() then
    return new;
  end if;
  if tg_table_name = 'qa_photos' and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'foreman') then
    return new;
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

create trigger pin_photos_stamp_policy before insert on public.pin_photos for each row execute function public.enforce_photo_capture_policy();
create trigger qa_photos_stamp_policy before insert on public.qa_photos for each row execute function public.enforce_photo_capture_policy();
create trigger daily_report_photos_stamp_policy before insert on public.daily_report_photos for each row execute function public.enforce_photo_capture_policy();

-- Daily report photos may now also be chosen from the device while uploads are allowed; the policy trigger above refuses
-- them otherwise. Legacy rows (no source) and photos without a time stamp stay refused.
create or replace function public.require_daily_report_camera()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.capture_source not in ('camera', 'upload') or new.taken_at is null then
    raise exception 'Take a photo with the camera for this daily progress report';
  end if;
  return new;
end;
$$;

-- Same as 20261028150000 plus the photos.allow_device_upload check.
create or replace function public.set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v jsonb := p_value;
  code text;
  seen text[] := '{}';
  item jsonb;
begin
  if not public.is_super_admin() then
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

revoke all on function public.photo_uploads_allowed() from public, anon, authenticated;
revoke all on function public.enforce_photo_capture_policy() from public, anon, authenticated;
revoke all on function public.require_daily_report_camera() from public, anon, authenticated;
revoke execute on function public.set_setting(text, jsonb) from public, anon;
grant execute on function public.set_setting(text, jsonb) to authenticated;
notify pgrst, 'reload schema';
