-- Daily time record (DTR): one Time IN and one Time OUT per worker per Philippine day, and a daily status
-- (On time / Late / Absent / Not in yet / Rest day) computed from the project's attendance schedule.
-- Before: every scan outside the repeat window flipped IN -> OUT -> IN -> OUT, so testing or a second visit made
-- many in/out rows a day.

-- 1. Working days on the schedule (ISO weekday numbers: 1 = Monday ... 7 = Sunday). Default Monday to Saturday.
alter table public.attendance_schedules
  add column work_days smallint[] not null default '{1,2,3,4,5,6}'
    check (cardinality(work_days) between 1 and 7 and work_days <@ '{1,2,3,4,5,6,7}'::smallint[]);

-- Same rules as 20261027130000 plus the working days. The 6th parameter has a default, so older 5-argument calls
-- still work (they keep Monday to Saturday).
drop function public.set_attendance_schedule(uuid,time,time,integer,integer);
create function public.set_attendance_schedule(p_project uuid,p_time_in time,p_time_out time,p_grace integer,p_repeat integer,p_work_days smallint[] default '{1,2,3,4,5,6}')
returns public.attendance_schedules language plpgsql security definer set search_path='' as $$
declare s public.attendance_schedules; days smallint[];
begin
  if not public.has_permission('biometrics.manage') then raise exception 'Admin biometric permission and MFA required'; end if;
  if p_project is null or not public.can_view_project(p_project) then raise exception 'Project not accessible'; end if;
  if p_time_in is null or p_time_out is null or date_trunc('minute',p_time_out::interval)<=date_trunc('minute',p_time_in::interval) then
    raise exception 'Time out must be later than time in on the same day'; end if;
  if p_grace is null or p_grace not between 0 and 120 then raise exception 'Grace period must be 0 to 120 minutes'; end if;
  if p_repeat is null or p_repeat not between 1 and 120 then raise exception 'Repeat-scan window must be 1 to 120 minutes'; end if;
  select array_agg(distinct x order by x) into days from unnest(p_work_days) x;
  if days is null or not days <@ '{1,2,3,4,5,6,7}'::smallint[] or array_position(days,null) is not null then
    raise exception 'Choose at least one working day'; end if;
  insert into public.attendance_schedules(project_id,time_in,time_out,grace_minutes,repeat_guard_minutes,work_days,updated_by,updated_at)
    values(p_project,date_trunc('minute',p_time_in::interval)::time,date_trunc('minute',p_time_out::interval)::time,p_grace,p_repeat,days,auth.uid(),clock_timestamp())
    on conflict(project_id) do update set time_in=excluded.time_in,time_out=excluded.time_out,grace_minutes=excluded.grace_minutes,
      repeat_guard_minutes=excluded.repeat_guard_minutes,work_days=excluded.work_days,updated_by=excluded.updated_by,updated_at=excluded.updated_at
    returning * into s;
  return s;
end; $$;
revoke all on function public.set_attendance_schedule(uuid,time,time,integer,integer,smallint[]) from public,anon,service_role;
grant execute on function public.set_attendance_schedule(uuid,time,time,integer,integer,smallint[]) to authenticated;

-- 2. The scan decision (same signature and answers as 20261027130000). Per worker and Philippine day:
--    no record yet -> Time IN; Time IN only -> Time OUT once the repeat window has passed; Time OUT already
--    recorded -> ignored as a repeat ("already timed out"). Older-than-latest scans stay out_of_order.
create or replace function public.record_biometric_scan(p_project uuid,p_biometric_uid text,p_occurred_at timestamptz,p_device text,p_event text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  w public.attendance_workers; s public.attendance_schedules; previous public.biometric_attendance_events;
  skipped public.attendance_ignored_scans; latest_event public.biometric_attendance_events; kept public.biometric_attendance_events;
  has_last boolean; local_ts timestamp; day_start timestamptz; scan_min integer; next_direction text; flag text; minutes integer;
  new_id uuid; ignore_reason text;
begin
  if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>now()+interval '5 minutes' then
    raise exception 'A valid device scan timestamp is required (not in the future)'; end if;
  if p_device is null or char_length(btrim(p_device)) not between 1 and 100 or p_event is null or char_length(btrim(p_event)) not between 1 and 160 then
    raise exception 'Direction, device and unique event ID are required'; end if;
  -- Locking the worker serializes scans from several devices, so two scans can never both become the next IN.
  select * into w from public.attendance_workers where project_id=p_project and biometric_uid=btrim(p_biometric_uid) for update;
  if not found then raise exception 'Worker biometric ID is not linked to this project'; end if;

  select * into previous from public.biometric_attendance_events where project_id=p_project and device_id=btrim(p_device) and external_event_id=btrim(p_event);
  if found then
    if (previous.worker_id,previous.occurred_at) is distinct from (w.id,p_occurred_at) then
      raise exception 'Source event ID already exists with different scan details'; end if;
    return jsonb_build_object('event_id',previous.id,'status','recorded','direction',previous.direction,'occurred_at',previous.occurred_at,
      'schedule_flag',previous.schedule_flag,'minutes_off',previous.minutes_off);
  end if;
  select * into skipped from public.attendance_ignored_scans where project_id=p_project and device_id=btrim(p_device) and external_event_id=btrim(p_event);
  if found then
    if (skipped.worker_id,skipped.occurred_at) is distinct from (w.id,p_occurred_at) then
      raise exception 'Source event ID already exists with different scan details'; end if;
    select * into kept from public.biometric_attendance_events where id=skipped.kept_event_id;
    return jsonb_build_object('event_id',kept.id,'status',skipped.reason,'direction',kept.direction,'occurred_at',kept.occurred_at,
      'schedule_flag',kept.schedule_flag,'minutes_off',kept.minutes_off);
  end if;
  if not w.active then raise exception 'Worker is inactive'; end if;

  local_ts:=p_occurred_at at time zone 'Asia/Manila';
  day_start:=date_trunc('day',local_ts) at time zone 'Asia/Manila';
  select * into s from public.attendance_schedules where project_id=p_project;
  select * into latest_event from public.biometric_attendance_events
    where project_id=p_project and worker_id=w.id and occurred_at>=day_start and occurred_at<day_start+interval '1 day'
    order by occurred_at desc,received_at desc,id desc limit 1;
  has_last:=found;
  if has_last then
    ignore_reason:=case when p_occurred_at<latest_event.occurred_at then 'out_of_order'
      when latest_event.direction='out' then 'repeat'
      when p_occurred_at-latest_event.occurred_at<make_interval(mins=>coalesce(s.repeat_guard_minutes,15)) then 'repeat' end;
    if ignore_reason is not null then
      insert into public.attendance_ignored_scans(project_id,worker_id,device_id,external_event_id,occurred_at,reason,kept_event_id)
        values(p_project,w.id,btrim(p_device),btrim(p_event),p_occurred_at,ignore_reason,latest_event.id);
      return jsonb_build_object('event_id',latest_event.id,'status',ignore_reason,'direction',latest_event.direction,'occurred_at',latest_event.occurred_at,
        'schedule_flag',latest_event.schedule_flag,'minutes_off',latest_event.minutes_off);
    end if;
  end if;

  next_direction:=case when has_last then 'out' else 'in' end;
  scan_min:=extract(hour from local_ts)::integer*60+extract(minute from local_ts)::integer;
  if s.project_id is null then flag:='no_schedule';
  elsif next_direction='in' then
    -- Late counts from the scheduled time in; the grace period only decides whether it is late at all.
    if scan_min>extract(epoch from s.time_in)::integer/60+s.grace_minutes then
      flag:='late'; minutes:=scan_min-extract(epoch from s.time_in)::integer/60;
    else flag:='on_time'; end if;
  elsif scan_min<extract(epoch from s.time_out)::integer/60 then
    flag:='early_out'; minutes:=extract(epoch from s.time_out)::integer/60-scan_min;
  else flag:='on_time'; end if;

  insert into public.biometric_attendance_events(project_id,worker_id,direction,occurred_at,device_id,external_event_id,schedule_flag,minutes_off)
    values(p_project,w.id,next_direction,p_occurred_at,btrim(p_device),btrim(p_event),flag,minutes)
    on conflict(project_id,device_id,external_event_id) do nothing returning id into new_id;
  if new_id is null then raise exception 'Source event ID already exists with different scan details'; end if;
  return jsonb_build_object('event_id',new_id,'status','recorded','direction',next_direction,'occurred_at',p_occurred_at,
    'schedule_flag',flag,'minutes_off',minutes);
end; $$;

-- 3. Daily status per worker and day (up to 63 days, never after today). Project staff only through RLS.
--    on_time / late: from the day's first Time IN (as flagged when scanned). present: a Time IN before any schedule.
--    absent: no Time IN on a working day once its time out has passed. not_in_yet: today, before time out.
--    rest_day: not a working day. no_schedule: no schedule set. not_enrolled: no fingerprint on that day yet.
create function public.attendance_daily_status(p_project uuid,p_from date,p_to date)
returns table(day date,worker_id uuid,full_name text,worker_code text,trade text,time_in timestamptz,time_out timestamptz,
  status text,late_minutes integer,early_minutes integer)
language plpgsql stable security invoker set search_path='' as $$
#variable_conflict use_column
declare s public.attendance_schedules; last_day date;
begin
  if p_project is null or p_from is null or p_to is null or p_to<p_from or p_to-p_from>62 then
    raise exception 'Choose a date range of up to 63 days'; end if;
  last_day:=least(p_to,(now() at time zone 'Asia/Manila')::date);
  if last_day<p_from then return; end if;
  select * into s from public.attendance_schedules a where a.project_id=p_project;
  return query
  with days as (select g::date d from generate_series(p_from::timestamp,last_day::timestamp,interval '1 day') g),
  ev as (
    select e.worker_id wid,(e.occurred_at at time zone 'Asia/Manila')::date d,
      min(e.occurred_at) filter (where e.direction='in') first_in,
      max(e.occurred_at) filter (where e.direction='out') last_out,
      (array_agg(e.schedule_flag order by e.occurred_at) filter (where e.direction='in'))[1] in_flag,
      (array_agg(e.minutes_off order by e.occurred_at) filter (where e.direction='in'))[1] in_minutes,
      (array_agg(e.schedule_flag order by e.occurred_at desc) filter (where e.direction='out'))[1] out_flag,
      (array_agg(e.minutes_off order by e.occurred_at desc) filter (where e.direction='out'))[1] out_minutes
    from public.biometric_attendance_events e
    where e.project_id=p_project and e.occurred_at>=(p_from::timestamp at time zone 'Asia/Manila')
      and e.occurred_at<((last_day+1)::timestamp at time zone 'Asia/Manila')
    group by 1,2)
  select days.d,w.id,w.full_name,w.worker_code,w.trade,ev.first_in,ev.last_out,
    case
      when ev.first_in is not null then case ev.in_flag when 'late' then 'late' when 'on_time' then 'on_time' when 'returned' then 'on_time' else 'present' end
      when w.biometric_uid is null or days.d<(coalesce(w.fingerprint_enrolled_at,w.created_at) at time zone 'Asia/Manila')::date then 'not_enrolled'
      when s.project_id is null then 'no_schedule'
      when not (extract(isodow from days.d)::smallint=any(s.work_days)) then 'rest_day'
      when ((days.d+s.time_out) at time zone 'Asia/Manila')>now() then 'not_in_yet'
      else 'absent' end,
    case when ev.in_flag='late' then ev.in_minutes end,
    case when ev.out_flag='early_out' then ev.out_minutes end
  from days cross join public.attendance_workers w
  left join ev on ev.wid=w.id and ev.d=days.d
  where w.project_id=p_project
    and (ev.first_in is not null or ev.last_out is not null
      or (w.active and days.d>=(w.created_at at time zone 'Asia/Manila')::date))
  order by days.d,w.full_name,w.id;
end; $$;
revoke all on function public.attendance_daily_status(uuid,date,date) from public,anon;
grant execute on function public.attendance_daily_status(uuid,date,date) to authenticated,service_role;

-- 4. Day summary: same keys plus daily statuses (late now counts workers late, one Time IN per day).
create or replace function public.attendance_day_summary(p_project uuid,p_day date)
returns jsonb language sql stable security invoker set search_path='' as $$
  with events as (
    select * from public.biometric_attendance_events where project_id=p_project
      and occurred_at >= (p_day::timestamp at time zone 'Asia/Manila')
      and occurred_at < ((p_day+1)::timestamp at time zone 'Asia/Manila')
  ), latest as (
    select distinct on(worker_id) direction from events order by worker_id,occurred_at desc,received_at desc,id desc
  ), daily as (
    select status from public.attendance_daily_status(p_project,p_day,p_day)
  ) select jsonb_build_object('scans',(select count(*) from events),'workers',(select count(*) from latest),
      'clocked_in',(select count(*) from latest where direction='in'),'clocked_out',(select count(*) from latest where direction='out'),
      'on_time',(select count(*) from daily where status='on_time'),
      'late',(select count(*) from daily where status='late'),
      'absent',(select count(*) from daily where status='absent'),
      'not_in_yet',(select count(*) from daily where status='not_in_yet'),
      'ignored',(select count(*) from public.attendance_ignored_scans i where i.project_id=p_project
        and i.occurred_at >= (p_day::timestamp at time zone 'Asia/Manila') and i.occurred_at < ((p_day+1)::timestamp at time zone 'Asia/Manila')));
$$;
notify pgrst,'reload schema';
