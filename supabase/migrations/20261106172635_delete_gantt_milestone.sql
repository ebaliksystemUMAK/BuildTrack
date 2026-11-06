-- Delete only standalone Gantt milestones through the existing schedule-manager permission boundary.
-- Task schedules, QA records and published snapshots are never deleted by this operation.
create function public.delete_timeline_milestone(p_project uuid,p_key text,p_expected integer) returns void
language plpgsql security definer set search_path='' as $$
declare milestone public.project_timeline_items;
begin
  if not public.can_manage_timeline(p_project) then
    raise exception 'Only project schedule managers can delete milestones' using errcode='42501';
  end if;
  if p_key is null or p_key !~ '^milestone:[0-9a-f-]{36}$' then
    raise exception 'Only milestones can be deleted here';
  end if;
  -- Same project lock as schedule saves, approvals and publication; recheck access after waiting.
  perform 1 from public.projects where id=p_project for update;
  if not public.can_manage_timeline(p_project) then
    raise exception 'Project unavailable for schedule changes' using errcode='42501';
  end if;
  select * into milestone from public.project_timeline_items
    where project_id=p_project and work_key=p_key for update;
  if not found then raise exception 'Milestone no longer exists. Refresh the timeline.'; end if;
  if milestone.pin_id is not null or milestone.item_id is not null then
    raise exception 'Only standalone milestones can be deleted here';
  end if;
  if p_expected is distinct from milestone.revision then
    raise exception 'Milestone changed. Refresh the timeline before deleting it.';
  end if;
  if exists(select 1 from public.project_timeline_items where project_id=p_project and p_key=any(predecessors)) then
    raise exception 'Another task or milestone depends on this milestone. Remove that dependency before deleting it.';
  end if;
  delete from public.project_timeline_items where project_id=p_project and work_key=p_key;
  insert into public.audit_log(actor_id,action,details)
    values(auth.uid(),'project_timeline.milestone_deleted',jsonb_build_object('project_id',p_project,'work_key',p_key,'before',to_jsonb(milestone)));
end; $$;

revoke all on function public.delete_timeline_milestone(uuid,text,integer) from public,anon;
grant execute on function public.delete_timeline_milestone(uuid,text,integer) to authenticated;
