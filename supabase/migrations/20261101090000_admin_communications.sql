-- Admin communications (additive; nothing is dropped, no data is rewritten).
--   A. Notifications: optional email choices for reminders and announcements (security / account notices stay mandatory), a claim lease so two
--      overlapping email runs can never send the same notification twice, "mark everything read".
--   B. One site-wide announcement banner (Super Admin + MFA publishes; anyone, signed in or not, can read the active one).
--   C. Communications hub: recipient search, audience preview and a limited, idempotent send that reuses the notification + email queue.
-- Rollback notes are at the end of the file. Verification queries: docs/audits/sql/20261101090000_admin_communications.md.

-- ---------------------------------------------------------------- A. notifications and preferences
alter table public.notification_prefs
  add column if not exists email_reminders boolean not null default true,
  add column if not exists email_announcements boolean not null default true;
-- The master switch (email_enabled) still wins: with it off nothing optional is emailed. The two new switches only narrow what is emailed.
grant insert (user_id, email_enabled, email_reminders, email_announcements) on public.notification_prefs to authenticated;
grant update (email_enabled, email_reminders, email_announcements) on public.notification_prefs to authenticated;

alter table public.notifications add column if not exists email_claimed_at timestamptz;

-- Which kind of email a notification is. Keep in step with src/lib/notificationModel.ts (notificationCategory) and supabase/functions/_shared/emailModel.ts.
--   security     : account and security notices, always emailed (account.*, security.*)
--   reminder     : deadlines and lateness (optional)
--   announcement : messages written by an administrator (optional)
--   activity     : everything else (the master switch)
create or replace function public.notification_email_category(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_kind like 'account.%' or p_kind like 'security.%' then 'security'
    when p_kind like 'announcement.%' then 'announcement'
    when p_kind = any (array['pin.due', 'pin.overdue', 'qa.defect_due', 'qa.defect_overdue', 'qa.overdue', 'alert.overdue', 'alert.escalation']) then 'reminder'
    else 'activity'
  end;
$$;
revoke execute on function public.notification_email_category(text) from public, anon;
grant execute on function public.notification_email_category(text) to authenticated, service_role;

-- Same signature as 0028. New: category-aware choices, a 10-minute claim lease (a row being sent is never handed out again, which is what
-- prevented two overlapping runs from emailing the same person twice), and the suspension notice may reach a suspended person.
create or replace function public.claim_email_batch(p_limit integer default 25)
returns table (id uuid, user_id uuid, kind text, title text, body text, link text, to_email text, to_name text)
language plpgsql security definer set search_path = '' as $$
begin
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

-- Same signature as 0028. New: a result that arrives for an already closed row is ignored (no second "sent" line), and a failure releases the lease
-- so the next run may retry (still at most three attempts).
create or replace function public.mark_email_result(p_id uuid, p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare n public.notifications;
begin
  select * into n from public.notifications where id = p_id for update;
  if n.id is null or n.emailed_at is not null then return; end if;
  if p_ok then
    update public.notifications set emailed_at = now(), email_claimed_at = null where id = p_id;
  else
    update public.notifications set email_claimed_at = null where id = p_id;
  end if;
  insert into public.email_log (notification_id, user_id, status, detail) values (p_id, n.user_id, case when p_ok then 'sent' else 'failed' end, left(p_detail, 300));
  -- three failed attempts close the row so it is not retried forever
  if not p_ok and n.email_attempts >= 3 then update public.notifications set emailed_at = now() where id = p_id; end if;
end;
$$;
revoke execute on function public.claim_email_batch(integer), public.mark_email_result(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_email_batch(integer), public.mark_email_result(uuid, boolean, text) to service_role;

-- "Mark all as read" for every unread notification, not only the 50 the bell loaded. Email-only messages never appear in the bell, so they are left alone.
create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  update public.notifications set read_at = now() where user_id = auth.uid() and read_at is null and kind <> 'announcement.email';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ---------------------------------------------------------------- B. announcement banner
-- One row (id = 1). `revision` goes up whenever the text or tone changes, and when a disabled banner is published again; a person who dismissed
-- an earlier revision sees the new one. Nobody reads or writes the table directly: the functions below are the only door.
create table if not exists public.site_announcement (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  title text not null default '' check (char_length(title) <= 80),
  message text not null default '' check (char_length(message) <= 500),
  tone text not null default 'info' check (tone in ('info', 'success', 'warning', 'critical')),
  revision integer not null default 0 check (revision >= 0),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.site_announcement (id) values (1) on conflict (id) do nothing;
alter table public.site_announcement enable row level security;
revoke all on public.site_announcement from anon, authenticated;

-- What the banner shows. Open to everyone (signed in or not) because the banner appears on public pages too; it returns only the published fields.
create or replace function public.get_active_announcement()
returns table (title text, message text, tone text, revision integer)
language sql stable security definer set search_path = '' as $$
  select a.title, a.message, a.tone, a.revision from public.site_announcement a
  where a.id = 1 and a.enabled and btrim(a.title) <> '' and btrim(a.message) <> '';
$$;
revoke execute on function public.get_active_announcement() from public;
grant execute on function public.get_active_announcement() to anon, authenticated;

create or replace function public.get_announcement_settings()
returns table (enabled boolean, title text, message text, tone text, revision integer, updated_at timestamptz, updated_by_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can manage the announcement banner' using errcode = '42501'; end if;
  return query select a.enabled, a.title, a.message, a.tone, a.revision, a.updated_at, case when a.updated_by is null then null else public.display_name(a.updated_by) end
  from public.site_announcement a where a.id = 1;
end;
$$;
revoke execute on function public.get_announcement_settings() from public, anon;
grant execute on function public.get_announcement_settings() to authenticated;

-- Publish, edit or switch off the banner (Super Admin with MFA). Returns the revision now in force. A save that changes nothing does nothing.
create or replace function public.set_announcement(p_title text, p_message text, p_tone text, p_enabled boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  old public.site_announcement;
  v_changed boolean;
  v_revision integer;
  v_action text;
begin
  if not public.is_super_admin() then raise exception 'Only a Super Admin can manage the announcement banner' using errcode = '42501'; end if;
  if p_tone is null or p_tone not in ('info', 'success', 'warning', 'critical') then raise exception 'Choose a tone: info, success, warning or critical'; end if;
  if char_length(v_title) > 80 then raise exception 'The title can be at most 80 characters'; end if;
  if char_length(v_message) > 500 then raise exception 'The message can be at most 500 characters'; end if;
  if coalesce(p_enabled, false) and (v_title = '' or v_message = '') then raise exception 'Write a title and a message before publishing'; end if;
  select * into old from public.site_announcement where id = 1 for update;
  v_changed := old.title is distinct from v_title or old.message is distinct from v_message or old.tone is distinct from p_tone;
  if not v_changed and old.enabled = coalesce(p_enabled, false) then return old.revision; end if;
  v_revision := old.revision + case when v_changed or (coalesce(p_enabled, false) and not old.enabled) then 1 else 0 end;
  update public.site_announcement set enabled = coalesce(p_enabled, false), title = v_title, message = v_message, tone = p_tone, revision = v_revision, updated_by = auth.uid(), updated_at = now() where id = 1;
  v_action := case when coalesce(p_enabled, false) and not old.enabled then 'announcement.publish' when coalesce(p_enabled, false) then 'announcement.update' when old.enabled then 'announcement.disable' else 'announcement.update' end;
  insert into public.audit_log (actor_id, target_id, action, details)
  values (auth.uid(), null, v_action, jsonb_build_object('title', v_title, 'message', v_message, 'tone', p_tone, 'enabled', coalesce(p_enabled, false), 'revision', v_revision));
  return v_revision;
end;
$$;
revoke execute on function public.set_announcement(text, text, text, boolean) from public, anon;
grant execute on function public.set_announcement(text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------- C. communications hub
-- A batch is one send. Its id comes from the browser and is the idempotency key: sending the same batch twice (double click, retry) does nothing the second time.
create table if not exists public.message_batches (
  id uuid primary key,
  sender_id uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 500),
  link text check (link is null or link ~ '^/[a-z0-9/_-]*(\?[A-Za-z0-9=&_.-]*)?$'),
  channel text not null check (channel in ('app', 'email', 'both')),
  requested_count integer not null check (requested_count > 0),
  delivered_count integer not null check (delivered_count >= 0),
  skipped_count integer not null check (skipped_count >= 0),
  created_at timestamptz not null default now()
);
create index if not exists message_batches_sender_idx on public.message_batches (sender_id, created_at desc);
alter table public.message_batches enable row level security;
revoke all on public.message_batches from anon, authenticated;

-- Active people the sender may message (name, email, role, company only), by words and/or roles. Super Admins, and Admins holding users.edit AND users.view
-- (it shows names and emails, so it needs the same permission as reading the user list), with MFA. Up to 600 rows so the screen can tell when a group is
-- larger than the 500-person limit.
create or replace function public.search_message_recipients(p_query text default null, p_roles text[] default null, p_limit integer default 20)
returns table (id uuid, full_name text, email text, role text, company text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  -- the words are matched literally: % _ and \ typed by the sender are escaped
  v_like text := '%' || replace(replace(replace(coalesce(btrim(p_query), ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not (public.has_permission('users.edit') and public.has_permission('users.view')) then raise exception 'Missing permission: users.edit and users.view' using errcode = '42501'; end if;
  return query
  select p.id, p.full_name, p.email, p.role::text, p.company from public.profiles p
  where p.status = 'active'
    and (p_roles is null or cardinality(p_roles) = 0 or p.role::text = any (p_roles))
    and (v_q is null or p.full_name ilike v_like or p.email ilike v_like or p.company ilike v_like)
  order by coalesce(nullif(btrim(p.full_name), ''), p.email), p.id
  limit least(greatest(coalesce(p_limit, 20), 1), 600);
end;
$$;
revoke execute on function public.search_message_recipients(text, text[], integer) from public, anon;
grant execute on function public.search_message_recipients(text, text[], integer) to authenticated;

-- What a send would do, before it is sent: who is eligible, how many get an email, how many have opted out. Counts and a few names only.
create or replace function public.preview_message_audience(p_recipients uuid[], p_channel text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_eligible integer; v_email integer; v_roles jsonb; v_sample jsonb;
begin
  if not public.has_permission('users.edit') then raise exception 'Missing permission: users.edit' using errcode = '42501'; end if;
  if p_channel is null or p_channel not in ('app', 'email', 'both') then raise exception 'Choose how to send: in the app, by email or both'; end if;
  select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids from unnest(coalesce(p_recipients, array[]::uuid[])) x;
  select count(*) into v_eligible from public.profiles p where p.id = any (v_ids) and p.status = 'active';
  select count(*) into v_email from public.profiles p
    where p.id = any (v_ids) and p.status = 'active' and nullif(btrim(p.email), '') is not null
      and coalesce((select np.email_enabled and np.email_announcements from public.notification_prefs np where np.user_id = p.id), true);
  select coalesce(jsonb_object_agg(r.role, r.n), '{}'::jsonb) into v_roles from (select coalesce(p.role::text, 'none') as role, count(*) n from public.profiles p where p.id = any (v_ids) and p.status = 'active' group by 1) r;
  select coalesce(jsonb_agg(s.name), '[]'::jsonb) into v_sample from (select coalesce(nullif(btrim(p.full_name), ''), p.email) as name from public.profiles p where p.id = any (v_ids) and p.status = 'active' order by 1 limit 8) s;
  return jsonb_build_object(
    'requested', cardinality(v_ids), 'eligible', v_eligible, 'not_eligible', cardinality(v_ids) - v_eligible,
    'will_email', case when p_channel = 'app' then 0 else v_email end,
    'opted_out', case when p_channel = 'app' then 0 else v_eligible - v_email end,
    'by_role', v_roles, 'sample', v_sample);
end;
$$;
revoke execute on function public.preview_message_audience(uuid[], text) from public, anon;
grant execute on function public.preview_message_audience(uuid[], text) to authenticated;

-- The send. In-app messages are notifications; emails are the same rows picked up by the existing queue (so the opt-outs, the daily cap, the
-- retries and the claim lease all apply). Limits: 200 people per send (Super Admin 500), 10 sends per hour, 1,000 people per day (Super Admin 2,000).
create or replace function public.send_admin_message(p_batch uuid, p_recipients uuid[], p_title text, p_body text, p_channel text, p_link text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g'));
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_ids uuid[];
  v_eligible uuid[];
  v_cap integer := case when public.is_super_admin() then 500 else 200 end;
  v_day_cap integer := case when public.is_super_admin() then 2000 else 1000 end;
  v_existing public.message_batches;
  v_sent_hour integer;
  v_sent_day integer;
  v_kind text;
begin
  if v_me is null or not public.has_permission('users.edit') then raise exception 'Missing permission: users.edit' using errcode = '42501'; end if;
  if p_batch is null then raise exception 'Missing batch id'; end if;
  if p_channel is null or p_channel not in ('app', 'email', 'both') then raise exception 'Choose how to send: in the app, by email or both'; end if;
  if char_length(v_title) < 1 or char_length(v_title) > 120 then raise exception 'The title needs 1 to 120 characters'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'The message needs 1 to 500 characters'; end if;
  if v_link is not null and v_link !~ '^/[a-z0-9/_-]*(\?[A-Za-z0-9=&_.-]*)?$' then raise exception 'The link must be a page inside BuildTrack, such as /engineer/dashboard'; end if;
  select coalesce(array_agg(distinct x), array[]::uuid[]) into v_ids from unnest(coalesce(p_recipients, array[]::uuid[])) x;
  if cardinality(v_ids) = 0 then raise exception 'Choose at least one person'; end if;
  if cardinality(v_ids) > v_cap then raise exception 'You can send to at most % people at once', v_cap; end if;

  -- One send at a time per sender: makes the limits and the idempotency check race-free.
  perform 1 from public.profiles where id = v_me for update;
  select * into v_existing from public.message_batches where id = p_batch;
  if found then
    if v_existing.sender_id is distinct from v_me then raise exception 'That batch id is already used'; end if;
    return jsonb_build_object('batch_id', v_existing.id, 'duplicate', true, 'delivered', v_existing.delivered_count, 'skipped', v_existing.skipped_count);
  end if;
  select count(*) into v_sent_hour from public.message_batches where sender_id = v_me and created_at > now() - interval '1 hour';
  select coalesce(sum(requested_count), 0) into v_sent_day from public.message_batches where sender_id = v_me and created_at > now() - interval '24 hours';
  if v_sent_hour >= 10 then raise exception 'Too many messages in the last hour. Try again later'; end if;
  if v_sent_day + cardinality(v_ids) > v_day_cap then raise exception 'Daily limit of % recipients reached. Try again tomorrow', v_day_cap; end if;

  select coalesce(array_agg(p.id), array[]::uuid[]) into v_eligible from public.profiles p where p.id = any (v_ids) and p.status = 'active';
  if cardinality(v_eligible) = 0 then raise exception 'None of the chosen people can receive messages. Only active accounts can'; end if;

  insert into public.message_batches (id, sender_id, title, body, link, channel, requested_count, delivered_count, skipped_count)
  values (p_batch, v_me, v_title, v_body, v_link, p_channel, cardinality(v_ids), cardinality(v_eligible), cardinality(v_ids) - cardinality(v_eligible));

  -- Email-only messages are stored as hidden rows (kind announcement.email) that only the email queue reads; in-app-only rows are closed for the queue at once.
  v_kind := case when p_channel = 'email' then 'announcement.email' else 'announcement.message' end;
  insert into public.notifications (user_id, kind, title, body, link, dedupe_key, emailed_at)
  select e, v_kind, v_title, v_body, v_link, 'msg:' || p_batch::text, case when p_channel = 'app' then now() else null end from unnest(v_eligible) e
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;

  insert into public.audit_log (actor_id, target_id, action, details)
  values (v_me, null, 'message.send', jsonb_build_object('batch', p_batch, 'title', v_title, 'channel', p_channel, 'requested', cardinality(v_ids), 'delivered', cardinality(v_eligible), 'skipped', cardinality(v_ids) - cardinality(v_eligible)));
  return jsonb_build_object('batch_id', p_batch, 'duplicate', false, 'delivered', cardinality(v_eligible), 'skipped', cardinality(v_ids) - cardinality(v_eligible));
end;
$$;
revoke execute on function public.send_admin_message(uuid, uuid[], text, text, text, text) from public, anon;
grant execute on function public.send_admin_message(uuid, uuid[], text, text, text, text) to authenticated;

-- Recent sends with what happened to the emails: sent, waiting (queued or retrying), skipped (opted out, not active, daily limit) and failed.
-- A sender sees their own sends; a Super Admin sees all.
create or replace function public.get_message_batches(p_limit integer default 20)
returns table (id uuid, created_at timestamptz, sender_name text, title text, channel text, requested_count integer, delivered_count integer, skipped_count integer, email_sent integer, email_failed integer, email_skipped integer, email_waiting integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('users.edit') then raise exception 'Missing permission: users.edit' using errcode = '42501'; end if;
  return query
  select b.id, b.created_at, case when b.sender_id is null then null else public.display_name(b.sender_id) end, b.title, b.channel, b.requested_count, b.delivered_count, b.skipped_count,
    coalesce(o.sent, 0)::integer, coalesce(o.failed, 0)::integer, coalesce(o.skipped, 0)::integer, coalesce(o.waiting, 0)::integer
  from public.message_batches b
  left join lateral (
    select count(*) filter (where s.outcome = 'sent') as sent, count(*) filter (where s.outcome = 'failed') as failed,
           count(*) filter (where s.outcome = 'skipped') as skipped, count(*) filter (where s.outcome = 'waiting') as waiting
    from (
      select case
        when exists (select 1 from public.email_log l where l.notification_id = n.id and l.status = 'sent') then 'sent'
        when n.emailed_at is null then 'waiting'
        when exists (select 1 from public.email_log l where l.notification_id = n.id and l.status = 'skipped') then 'skipped'
        else 'failed' end as outcome
      from public.notifications n where b.channel <> 'app' and n.dedupe_key = 'msg:' || b.id::text
    ) s
  ) o on true
  where public.is_super_admin() or b.sender_id = auth.uid()
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end;
$$;
revoke execute on function public.get_message_batches(integer) from public, anon;
grant execute on function public.get_message_batches(integer) to authenticated;

-- ---------------------------------------------------------------- Rollback notes (not executed)
--   The new objects can be removed without touching existing data:
--     drop function public.get_message_batches(integer), public.send_admin_message(uuid, uuid[], text, text, text, text), public.preview_message_audience(uuid[], text),
--       public.search_message_recipients(text, text[], integer), public.set_announcement(text, text, text, boolean), public.get_announcement_settings(),
--       public.get_active_announcement(), public.mark_all_notifications_read(), public.notification_email_category(text);
--     drop table public.message_batches, public.site_announcement;
--     alter table public.notifications drop column email_claimed_at;
--     alter table public.notification_prefs drop column email_reminders, drop column email_announcements;
--   Before dropping the columns, restore claim_email_batch / mark_email_result from 0028 (they reference the new columns).
