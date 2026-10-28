-- A correction inspection's sign-off is the NCR decision. Never close on an unsigned item Pass.
-- CLI-generated filename aligned to the hosted migration version after application.
-- Invoked inside the existing authorized complete_inspection transaction; no new public RPC or RLS bypass.
create function public.auto_close_reinspection_ncrs() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d record; verification_note text; na_remarks text;
begin
  if new.reinspection_of is null or old.status <> 'in_progress' or new.status not in ('passed','conditional','failed') then return new; end if;
  if new.inspector_id is distinct from auth.uid() or not public.can_edit_blueprints(new.project_id) then
    raise exception 'Only the authorized inspector can sign off a correction inspection';
  end if;
  verification_note := 'Automatically closed after this finding passed reinspection IR-' || lpad(new.number::text,4,'0') || '.'
    || case when nullif(btrim(new.summary),'') is not null then ' Remarks: ' || btrim(new.summary) else '' end;
  -- Exact attempt + project + pin and the existing finding-specific, fresh signed-off Pass guard.
  -- Order matches correction submission's NCR lock order. No unrelated/open/standalone finding is closed.
  for d in
    select finding.id,finding.inspection_item_id from public.qa_defects finding
      join public.qa_work_attempts attempt on attempt.id=finding.correction_attempt_id
    where attempt.submitted_inspection_id=new.id and finding.project_id=new.project_id
      and finding.pin_id=new.pin_id and finding.status='for_verification'
    order by finding.number for update of finding
  loop
    -- Reuse notes, audit events, closure guards, actor attribution, notifications and completion checks.
    if public.qa_ncr_verified_inspection(d.id)=new.id then
      perform public.verify_defect(d.id,true,verification_note);
    else
      -- N/A does not verify a previously failed finding. Return it for correction rather than strand it
      -- behind the removed manual decision controls. Failed checks use complete_inspection's existing path.
      select current_check.remarks into na_remarks from public.qa_inspection_items current_check
        join public.qa_inspection_items original on original.id=d.inspection_item_id
      where current_check.inspection_id=new.id and current_check.result='na'
        and current_check.origin_item_id=coalesce(original.origin_item_id,original.id) limit 1;
      if found then
        perform public.verify_defect(d.id,false,'NCR remains open: its finding was marked N/A in reinspection IR-'
          || lpad(new.number::text,4,'0') || '. ' || coalesce(na_remarks,'')
          || case when nullif(btrim(new.summary),'') is not null then ' Remarks: ' || btrim(new.summary) else '' end);
      end if;
    end if;
  end loop;
  return new;
end; $$;
revoke all on function public.auto_close_reinspection_ncrs() from public,anon,authenticated;
create trigger zz_auto_close_reinspection_ncrs after update of status on public.qa_inspections
  for each row when (old.status is distinct from new.status) execute function public.auto_close_reinspection_ncrs();

-- Existing completed inspections/NCRs are not backfilled or rewritten.
notify pgrst,'reload schema';
