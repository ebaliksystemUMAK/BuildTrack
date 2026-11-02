-- System health, email test limits and the daily admin digest (additive; nothing is dropped, no data is rewritten, nothing is scheduled or sent by this file).
--   A. get_system_health(): a read-only report for Super Admin (database, migration history, required objects, storage buckets, email queue, scheduled jobs,
--      digest runs). It repairs nothing and re-runs nothing, and it never returns secrets or job commands.
--   B. Email test: a rate-limited log the Edge Function `system-health` uses before it asks the mail provider to send one test email to the Super Admin.
--   C. Daily admin digest: per-person opt-out, a run log, one function that creates the digest notifications (service role only, called by a schedule the
--      owner switches on later) and a Super Admin dry run that creates nothing. A person gets at most one digest per day (unique key), so retries and
--      overlapping runs cannot send it twice.
-- Rollback notes are at the end of the file. Verification queries: docs/audits/sql/20261101120000_system_health_and_admin_digest.md.

-- ---------------------------------------------------------------- C1. opt-out
alter table public.notification_prefs add column if not exists email_admin_digest boolean not null default true;
-- email_admin_digest decides whether the person gets the daily admin summary at all (bell and email). The master email switch still decides about email.
grant insert (user_id, email_enabled, email_reminders, email_announcements, email_admin_digest) on public.notification_prefs to authenticated;
grant update (email_enabled, email_reminders, email_announcements, email_admin_digest) on public.notification_prefs to authenticated;

-- ---------------------------------------------------------------- B. email test
create table if not exists public.email_test_log (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'failed')),
  provider_status integer,
  message_id text check (message_id is null or char_length(message_id) <= 200),
  detail text check (detail is null or char_length(detail) <= 300)
);
create index if not exists email_test_log_user_idx on public.email_test_log (user_id, created_at desc);
alter table public.email_test_log enable row level security;
revoke all on public.email_test_log from anon, authenticated;

-- Called by the Edge Function (service role) before it contacts the provider: at most 3 tests per hour and 10 per day per person. Returns the log id.
create or replace function public.begin_email_test(p_user uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_hour integer; v_day integer;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user and status = 'active' and role = 'super_admin') then
    raise exception 'Only an active Super Admin can send a test email' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = p_user for update; -- one request at a time per person keeps the limits exact
  select count(*) filter (where created_at > now() - interval '1 hour'), count(*) into v_hour, v_day from public.email_test_log where user_id = p_user and created_at > now() - interval '24 hours';
  if v_hour >= 3 then raise exception 'Too many test emails in the last hour. Try again later' using errcode = 'P0001'; end if;
  if v_day >= 10 then raise exception 'Daily limit of 10 test emails reached. Try again tomorrow' using errcode = 'P0001'; end if;
  insert into public.email_test_log (user_id) values (p_user) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_email_test(p_id bigint, p_status text, p_provider_status integer, p_message_id text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('accepted', 'failed') then raise exception 'Invalid status'; end if;
  update public.email_test_log set status = p_status, provider_status = p_provider_status, message_id = left(p_message_id, 200), detail = left(p_detail, 300) where id = p_id and status = 'requested';
end;
$$;
revoke execute on function public.begin_email_test(uuid), public.finish_email_test(bigint, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.begin_email_test(uuid), public.finish_email_test(bigint, text, integer, text, text) to service_role;

-- ---------------------------------------------------------------- C2. daily admin digest
create table if not exists public.digest_runs (
  id bigint generated always as identity primary key,
  run_date date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  recipients integer not null default 0,
  created integer not null default 0,
  skipped_empty integer not null default 0,
  skipped_opt_out integer not null default 0,
  detail text check (detail is null or char_length(detail) <= 300)
);
create index if not exists digest_runs_date_idx on public.digest_runs (run_date desc, id desc);
alter table public.digest_runs enable row level security;
revoke all on public.digest_runs from anon, authenticated;

-- What one admin would be told today, built only from what that person may act on: decisions need users.approve, projects need projects.manage, delivery
-- problems are for Super Admin. Counts of real records; an empty digest (total 0) is never sent. Internal: nobody calls this directly.
create or replace function public.admin_digest_content(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text; v_super boolean; v_approve boolean; v_projects boolean;
  v_reg integer := 0; v_ids integer := 0; v_erase integer := 0; v_req integer := 0; v_nopm integer := 0; v_failed integer := 0; v_stuck integer := 0;
  v_parts text[] := array[]::text[]; v_sections jsonb := '[]'::jsonb; v_total integer := 0; v_body text;
begin
  select p.role::text into v_role from public.profiles p where p.id = p_user and p.status = 'active';
  if v_role is null or v_role not in ('super_admin', 'admin') then return jsonb_build_object('total', 0, 'body', '', 'sections', '[]'::jsonb); end if;
  v_super := v_role = 'super_admin';
  v_approve := v_super or exists (select 1 from public.admin_permissions ap where ap.user_id = p_user and ap.permission = 'users.approve');
  v_projects := v_super or exists (select 1 from public.admin_permissions ap where ap.user_id = p_user and ap.permission = 'projects.manage');
  if v_approve then
    select count(*) into v_reg from public.profiles where status = 'pending' and registration_completed_at is not null;
    select count(*) into v_ids from public.identity_verifications where status = 'submitted';
    select count(*) into v_erase from public.data_requests where status = 'open';
    select count(*) into v_req from public.access_requests where status = 'pending';
  end if;
  if v_projects then
    select count(*) into v_nopm from public.projects pr
      where pr.status not in ('completed', 'cancelled') and pr.archived_at is null
        -- "active" is what get_project_managers() reports: the person's account is active and still has the Project Manager role
        and not exists (select 1 from public.project_managers pm join public.profiles pp on pp.id = pm.user_id
                        where pm.project_id = pr.id and pm.designation = 'primary' and pp.status = 'active' and pp.role = 'project_manager');
  end if;
  if v_super then
    select count(*) into v_failed from public.email_log where status = 'failed' and created_at > now() - interval '24 hours';
    select count(*) into v_stuck from public.notifications where emailed_at is null and created_at < now() - interval '1 day';
  end if;
  if v_reg > 0 then v_parts := v_parts || (v_reg || case when v_reg = 1 then ' registration' else ' registrations' end || ' to approve'); v_sections := v_sections || jsonb_build_object('key', 'registrations', 'count', v_reg); end if;
  if v_ids > 0 then v_parts := v_parts || (v_ids || case when v_ids = 1 then ' ID check' else ' ID checks' end || ' to review'); v_sections := v_sections || jsonb_build_object('key', 'id_checks', 'count', v_ids); end if;
  if v_erase > 0 then v_parts := v_parts || (v_erase || case when v_erase = 1 then ' data deletion request' else ' data deletion requests' end); v_sections := v_sections || jsonb_build_object('key', 'data_requests', 'count', v_erase); end if;
  if v_req > 0 then v_parts := v_parts || (v_req || case when v_req = 1 then ' access request' else ' access requests' end); v_sections := v_sections || jsonb_build_object('key', 'access_requests', 'count', v_req); end if;
  if v_nopm > 0 then v_parts := v_parts || (v_nopm || case when v_nopm = 1 then ' open project has' else ' open projects have' end || ' no primary Project Manager'); v_sections := v_sections || jsonb_build_object('key', 'projects_without_manager', 'count', v_nopm); end if;
  if v_failed > 0 then v_parts := v_parts || (v_failed || ' failed ' || case when v_failed = 1 then 'email' else 'emails' end || ' in the last 24 hours'); v_sections := v_sections || jsonb_build_object('key', 'email_failed', 'count', v_failed); end if;
  if v_stuck > 0 then v_parts := v_parts || (v_stuck || case when v_stuck = 1 then ' notification' else ' notifications' end || ' waiting over a day to be emailed'); v_sections := v_sections || jsonb_build_object('key', 'email_waiting', 'count', v_stuck); end if;
  v_total := v_reg + v_ids + v_erase + v_req + v_nopm + v_failed + v_stuck;
  v_body := left(array_to_string(v_parts, '. ') || case when cardinality(v_parts) > 0 then '.' else '' end, 480);
  return jsonb_build_object('total', v_total, 'body', v_body, 'sections', v_sections);
end;
$$;
revoke execute on function public.admin_digest_content(uuid) from public, anon, authenticated;

-- Creates today's digest notification for every active Super Admin / Admin who has something to act on and has not opted out. Runs as the backend (service role)
-- from a schedule. One digest per person per Manila day: the unique key makes a retry or an overlapping run create nothing new. Every run is logged; a failure is
-- logged with its message and the partial work is undone.
create or replace function public.generate_admin_digest(p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, (now() at time zone 'Asia/Manila')::date);
  v_run bigint; v_rec record; v_content jsonb; v_n integer;
  v_recipients integer := 0; v_created integer := 0; v_empty integer := 0; v_opt integer := 0;
begin
  insert into public.digest_runs (run_date) values (v_date) returning id into v_run;
  begin
    for v_rec in select p.id from public.profiles p where p.status = 'active' and p.role in ('super_admin', 'admin') order by p.id loop
      v_recipients := v_recipients + 1;
      if not coalesce((select np.email_admin_digest from public.notification_prefs np where np.user_id = v_rec.id), true) then v_opt := v_opt + 1; continue; end if;
      v_content := public.admin_digest_content(v_rec.id);
      if (v_content ->> 'total')::integer = 0 then v_empty := v_empty + 1; continue; end if;
      insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
      values (v_rec.id, 'digest.admin', 'Admin summary: ' || (v_content ->> 'total') || ' ' || case when (v_content ->> 'total')::integer = 1 then 'item needs' else 'items need' end || ' your attention',
              v_content ->> 'body', '/admin/dashboard', 'digest:' || to_char(v_date, 'YYYYMMDD'))
      on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
      get diagnostics v_n = row_count;
      v_created := v_created + v_n;
    end loop;
    update public.digest_runs set status = 'ok', finished_at = now(), recipients = v_recipients, created = v_created, skipped_empty = v_empty, skipped_opt_out = v_opt where id = v_run;
    return jsonb_build_object('ok', true, 'run_id', v_run, 'run_date', v_date, 'recipients', v_recipients, 'created', v_created, 'skipped_empty', v_empty, 'skipped_opt_out', v_opt);
  exception when others then
    update public.digest_runs set status = 'failed', finished_at = now(), detail = left(sqlerrm, 300) where id = v_run;
    return jsonb_build_object('ok', false, 'run_id', v_run, 'run_date', v_date, 'error', left(sqlerrm, 300));
  end;
end;
$$;
revoke execute on function public.generate_admin_digest(date) from public, anon, authenticated;
grant execute on function public.generate_admin_digest(date) to service_role;

-- The Super Admin's dry run: who would get which digest today. Creates nothing and sends nothing.
create or replace function public.preview_admin_digest()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can preview the admin digest' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'role', p.role::text,
      'opted_out', not coalesce((select np.email_admin_digest from public.notification_prefs np where np.user_id = p.id), true),
      'total', (public.admin_digest_content(p.id) ->> 'total')::integer,
      'body', public.admin_digest_content(p.id) ->> 'body') order by p.role::text, coalesce(nullif(btrim(p.full_name), ''), p.email)), '[]'::jsonb)
    into v_rows from public.profiles p where p.status = 'active' and p.role in ('super_admin', 'admin');
  return jsonb_build_object('run_date', (now() at time zone 'Asia/Manila')::date, 'recipients', v_rows);
end;
$$;
revoke execute on function public.preview_admin_digest() from public, anon;
grant execute on function public.preview_admin_digest() to authenticated;

-- ---------------------------------------------------------------- A. system health (read only)
-- p_manifest is a list of {"kind": "table" | "function" | "column" | "bucket", "name": "..."} the screen wants checked (a column is "table.column").
-- Names are validated, so nothing typed here can reach a query as code. The report has no secrets, no job commands and no file names.
create or replace function public.get_system_health(p_manifest jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_objects jsonb := '[]'::jsonb; v_item jsonb; v_kind text; v_name text; v_exists boolean; v_public boolean;
  v_migrations jsonb := jsonb_build_object('available', false); v_cron jsonb := jsonb_build_object('installed', false, 'jobs', '[]'::jsonb);
  v_buckets jsonb; v_queue jsonb; v_digest jsonb; v_tests jsonb; v_names jsonb; v_recorded integer; v_latest_version text; v_latest_name text;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can run the system health checks' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_manifest, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_manifest, '[]'::jsonb)) > 400 then raise exception 'The checklist must be a list of at most 400 items'; end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_manifest, '[]'::jsonb)) loop
    v_kind := v_item ->> 'kind'; v_name := v_item ->> 'name'; v_public := null;
    if v_kind is null or v_kind not in ('table', 'function', 'column', 'bucket') or v_name is null or v_name !~ '^[a-z_][a-z0-9_-]*(\.[a-z_][a-z0-9_]*)?$' or char_length(v_name) > 80 then
      raise exception 'Invalid checklist item';
    end if;
    if v_kind = 'table' then v_exists := to_regclass(format('public.%I', v_name)) is not null;
    elsif v_kind = 'function' then v_exists := exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_name);
    elsif v_kind = 'column' then
      v_exists := position('.' in v_name) > 0 and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = split_part(v_name, '.', 1) and c.column_name = split_part(v_name, '.', 2));
    else
      select true, b.public into v_exists, v_public from storage.buckets b where b.id = v_name;
      v_exists := coalesce(v_exists, false);
    end if;
    v_objects := v_objects || jsonb_build_array(jsonb_build_object('kind', v_kind, 'name', v_name, 'exists', v_exists) || case when v_public is null then '{}'::jsonb else jsonb_build_object('public', v_public) end);
  end loop;

  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select count(*)::integer, max(version), (array_agg(name order by version desc))[1], coalesce(jsonb_agg(name order by version), ''[]''::jsonb) from supabase_migrations.schema_migrations'
      into v_recorded, v_latest_version, v_latest_name, v_names;
    v_migrations := jsonb_build_object('available', true, 'recorded', v_recorded, 'latest_version', v_latest_version, 'latest_name', v_latest_name, 'names', v_names);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'public', b.public, 'objects', coalesce(o.n, 0)) order by b.id), '[]'::jsonb) into v_buckets
    from storage.buckets b left join (select bucket_id, count(*)::integer as n from storage.objects group by bucket_id) o on o.bucket_id = b.id;

  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    -- Name, schedule, active flag and the last run only. The command is never read: it can hold a secret.
    execute $q$
      select jsonb_build_object('installed', true, 'jobs', coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(j.jobname, 'job ' || j.jobid), 'schedule', j.schedule, 'active', j.active,
        'last_status', r.status, 'last_run', r.start_time, 'last_message', left(regexp_replace(coalesce(r.return_message, ''), '[^[:print:]]', ' ', 'g'), 160)
      ) order by j.jobid), '[]'::jsonb))
      from cron.job j
      left join lateral (select d.status, d.start_time, d.return_message from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
    $q$ into v_cron;
  end if;

  select jsonb_build_object(
    'waiting', count(*) filter (where n.emailed_at is null),
    'waiting_over_1d', count(*) filter (where n.emailed_at is null and n.created_at < now() - interval '1 day'),
    'sent_24h', (select count(*) from public.email_log l where l.status = 'sent' and l.created_at > now() - interval '24 hours'),
    'failed_24h', (select count(*) from public.email_log l where l.status = 'failed' and l.created_at > now() - interval '24 hours'),
    'skipped_24h', (select count(*) from public.email_log l where l.status = 'skipped' and l.created_at > now() - interval '24 hours'))
    into v_queue from public.notifications n;

  select jsonb_build_object(
    'last_run', (select to_jsonb(r) from (select run_date, started_at, finished_at, status, recipients, created, skipped_empty, skipped_opt_out, detail from public.digest_runs order by id desc limit 1) r),
    'last_ok_at', (select max(finished_at) from public.digest_runs where status = 'ok'),
    'failed_7d', (select count(*) from public.digest_runs where status = 'failed' and started_at > now() - interval '7 days'))
    into v_digest;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_tests
    from (select id, created_at, status, provider_status from public.email_test_log order by id desc limit 3) t;

  return jsonb_build_object('checked_at', now(), 'database', jsonb_build_object('ok', true, 'version', current_setting('server_version_num')::integer / 10000),
    'migrations', v_migrations, 'objects', v_objects, 'buckets', v_buckets, 'cron', v_cron, 'email_queue', v_queue, 'digest', v_digest, 'email_tests', v_tests);
end;
$$;
revoke execute on function public.get_system_health(jsonb) from public, anon;
grant execute on function public.get_system_health(jsonb) to authenticated;

-- ---------------------------------------------------------------- Rollback notes (not executed)
--   drop function public.get_system_health(jsonb), public.preview_admin_digest(), public.generate_admin_digest(date), public.admin_digest_content(uuid),
--     public.finish_email_test(bigint, text, integer, text, text), public.begin_email_test(uuid);
--   drop table public.digest_runs, public.email_test_log;
--   alter table public.notification_prefs drop column email_admin_digest;
--   Nothing is scheduled by this file. If the owner scheduled the digest, remove that job first (see the SQL document).
