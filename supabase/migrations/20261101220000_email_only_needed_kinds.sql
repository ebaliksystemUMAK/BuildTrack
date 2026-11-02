-- Email only what a person needs: some notifications stay in the bell and are never emailed.
-- Adds the category 'inapp' to notification_email_category (20261101090000) and makes claim_email_batch close such rows quietly (no email, no email_log line).
-- Everything else is unchanged: same signature, same choices (master switch, reminders, announcements), same 20-a-day cap, same 10-minute lease, and security notices stay mandatory.
--
-- In the bell only (high volume, or good-to-know rather than needed):
--   pin.milestone, pin.resumed                 progress chatter on a work item
--   report.submitted, report.reviewed          daily-report traffic (the engineer's Reports page and the bell show it)
--   qa.defect_closed                           the foreman already saw the pass; the closure is in the bell and on the NCR
--   project.archived, project.restored         project housekeeping
--   project.manager_removed                    housekeeping (the assignment, project.manager_assigned, IS emailed)
--   attendance.concern_resolved                the person who raised the concern sees it in the app
-- Emailed (somebody has to act, or is waiting outside the app): pin.assigned / review / returned / verified / issue / problem, qa.requested / result / defect /
--   defect_verify / defect_rejected / item_review, snag.*, question.*, report.reopened, access.* / registration.new / identity.* / privacy.* , project.manager_assigned,
--   attendance.concern, reminders (pin.due, pin.overdue, qa.defect_due, qa.defect_overdue, qa.overdue, alert.*), announcements and account / security notices.
-- A kind that is not listed anywhere is emailed (a needed message is never lost silently); pnpm test:lib checks that every kind the database creates is classified.
-- Keep in step with src/lib/notificationModel.ts (notificationCategory) and supabase/functions/_shared/emailModel.ts (emailCategory).

create or replace function public.notification_email_category(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_kind like 'account.%' or p_kind like 'security.%' then 'security'
    when p_kind like 'announcement.%' then 'announcement'
    when p_kind = any (array['pin.due', 'pin.overdue', 'qa.defect_due', 'qa.defect_overdue', 'qa.overdue', 'alert.overdue', 'alert.escalation']) then 'reminder'
    when p_kind = any (array['pin.milestone', 'pin.resumed', 'report.submitted', 'report.reviewed', 'qa.defect_closed', 'project.archived', 'project.restored', 'project.manager_removed', 'attendance.concern_resolved']) then 'inapp'
    else 'activity'
  end;
$$;
revoke execute on function public.notification_email_category(text) from public, anon;
grant execute on function public.notification_email_category(text) to authenticated, service_role;

create or replace function public.claim_email_batch(p_limit integer default 25)
returns table (id uuid, user_id uuid, kind text, title text, body text, link text, to_email text, to_name text)
language plpgsql security definer set search_path = '' as $$
begin
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
revoke execute on function public.claim_email_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_email_batch(integer) to service_role;

-- Rollback (no data is changed by this migration except closing queue rows, which only means "not emailed"):
--   restore notification_email_category and claim_email_batch from 20261101090000_admin_communications.sql.
