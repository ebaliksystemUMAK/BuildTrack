-- Existing submitted headcounts and photos remain historical evidence.
alter table public.daily_reports
  add column workers_source text not null default 'manual' check (workers_source in ('manual','biometrics')),
  add column workers_synced_at timestamptz;
alter table public.daily_report_photos
  add column annotations jsonb not null default '[]' check (public.valid_issue_markup(annotations)),
  add column capture_source text not null default 'legacy' check (capture_source in ('legacy','camera'));
grant insert(annotations,capture_source) on public.daily_report_photos to authenticated;

-- A worker present during the report day has a real accepted Time IN in that project's Manila day.
-- Count once even after Time OUT; imported/manual totals and rejected/ignored scans are not included.
create function public.daily_report_biometric_headcount(p_project uuid,p_day date)
returns integer language plpgsql stable security invoker set search_path='' as $$
begin
  if p_project is null or p_day is null or not public.is_staff() or not public.can_view_project(p_project) then
    raise exception 'Attendance is unavailable for this project';
  end if;
  return (select count(distinct e.worker_id)::integer from public.biometric_attendance_events e
    where e.project_id=p_project and e.direction='in'
      and e.occurred_at >= (p_day::timestamp at time zone 'Asia/Manila')
      and e.occurred_at < ((p_day+1)::timestamp at time zone 'Asia/Manila'));
end;
$$;
revoke all on function public.daily_report_biometric_headcount(uuid,date) from public,anon;
grant execute on function public.daily_report_biometric_headcount(uuid,date) to authenticated;

create function public.sync_daily_report_headcount()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  -- Review/return operations must not rewrite what the Foreman originally submitted.
  if tg_op='UPDATE' and old.status='submitted' then return new; end if;
  -- Let the report's existing RLS reject unauthorized writes before looking up attendance.
  if not public.is_active() or not public.can_report_on_project(new.project_id) then return new; end if;
  if new.workers_count < 0 or new.workers_count > 5000 then raise exception 'Headcount is outside the allowed check bounds'; end if;
  new.workers_count := public.daily_report_biometric_headcount(new.project_id,new.report_date);
  new.workers_source := 'biometrics'; new.workers_synced_at := now();
  return new;
end;
$$;
-- Run after the existing report validator; its linked-work, revision and completion rules remain intact.
create trigger z_daily_report_biometric_count before insert or update on public.daily_reports
for each row execute function public.sync_daily_report_headcount();
revoke all on function public.sync_daily_report_headcount() from public,anon,authenticated;

create function public.require_daily_report_camera()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.capture_source <> 'camera' or new.taken_at is null then
    raise exception 'Take a photo with the camera for this daily progress report';
  end if;
  return new;
end;
$$;
create trigger z_daily_report_camera before insert on public.daily_report_photos
for each row execute function public.require_daily_report_camera();
revoke all on function public.require_daily_report_camera() from public,anon,authenticated;
notify pgrst,'reload schema';
