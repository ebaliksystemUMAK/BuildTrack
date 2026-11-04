-- Keep pin creation, automatic schedule submission and the optional initial assignment atomic.
-- Existing RLS, assignment/type guards, audit events and notifications validate every write.
begin;
create function public.create_pin_with_foreman(
  p_blueprint uuid,p_revision uuid,p_x numeric,p_y numeric,p_title text,p_category public.pin_category,
  p_foreman uuid default null,p_start date default null,p_end date default null,p_phase text default 'Unassigned',p_reason text default ''
) returns public.pins
language plpgsql security invoker set search_path='' as $$
declare pn public.pins;
begin
  if p_category='note' and p_foreman is not null then raise exception 'Notes are not assignable work'; end if;
  select * into pn from public.create_pin_with_schedule_proposal(p_blueprint,p_revision,p_x,p_y,p_title,p_category,p_start,p_end,p_phase,p_reason);
  if p_foreman is not null then
    update public.pins set assigned_to=p_foreman where id=pn.id returning * into pn;
    if pn.id is null then raise exception 'You are not allowed to assign this pin' using errcode='42501'; end if;
  end if;
  return pn;
end;
$$;
revoke all on function public.create_pin_with_foreman(uuid,uuid,numeric,numeric,text,public.pin_category,uuid,date,date,text,text) from public,anon;
grant execute on function public.create_pin_with_foreman(uuid,uuid,numeric,numeric,text,public.pin_category,uuid,date,date,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
