-- Owner explicitly approved closing existing NCRs with a currently valid finding-specific signed-off Pass.
-- CLI-generated filename aligned to the hosted migration version after application.
-- No old inspection/evidence is changed; no pending/failed/N/A finding or standalone NCR is closed.
do $$
declare finding record; closure_note text;
begin
  for finding in
    select d.id,d.project_id,d.pin_id,d.number,d.assigned_to,i.id as inspection_id,i.number as ir_number,
      i.inspector_id,i.completed_at,i.summary
    from public.qa_defects d
      join public.qa_work_attempts a on a.id=d.correction_attempt_id
      join public.qa_inspections i on i.id=a.submitted_inspection_id
    where d.status='for_verification' and d.project_id=i.project_id and d.pin_id=i.pin_id
      and i.reinspection_of is not null and i.status in ('passed','failed','conditional')
      and i.inspector_id is not null and i.completed_at is not null
      and public.qa_ncr_verified_inspection(d.id)=i.id
    order by d.project_id,d.number for update of d
  loop
    closure_note:='Automatically closed from the finding-specific Pass signed off in reinspection IR-'
      || lpad(finding.ir_number::text,4,'0') || ' on ' || finding.completed_at::text || '.'
      || case when nullif(btrim(finding.summary),'') is not null then ' Remarks: ' || btrim(finding.summary) else '' end;
    -- The existing full_ncr_closure trigger rechecks the exact current Pass on this update.
    update public.qa_defects set status='closed',closed_at=now(),closed_by=finding.inspector_id,
      closing_note=closure_note,updated_at=now() where id=finding.id and status='for_verification';
    -- NULL actor denotes this automatic migration action, not a new human sign-off. closed_by retains
    -- the actual inspector whose immutable finding-specific result authorized closure.
    insert into public.qa_defect_events(defect_id,project_id,actor_id,kind,from_status,to_status,note)
      values(finding.id,finding.project_id,null,'closed','for_verification','closed',closure_note);
    if finding.assigned_to is not null then
      perform public.notify_user(finding.assigned_to,'qa.defect_closed','Closed: NCR-'||lpad(finding.number::text,4,'0'),
        left(closure_note,200),'/foreman/issues?project='||finding.project_id||'&defect='||finding.id,finding.project_id,finding.id);
    end if;
    -- Deliberately do not accept a checklist or complete a work pin here.
  end loop;
end; $$;
