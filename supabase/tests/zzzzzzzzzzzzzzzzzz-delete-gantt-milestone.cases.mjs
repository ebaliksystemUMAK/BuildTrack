import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"

export default async function ({ db, ids, as, asOwner, addUser, test, expectFail }) {
  const owner = async () => { await asOwner(); await db.query("select set_config('request.jwt.claims','{}',false)") }
  await owner()
  for (const [name, role] of [["dmPM", "project_manager"], ["dmBackup", "project_manager"], ["dmOtherPM", "project_manager"], ["dmEng", "engineer"], ["dmFore", "foreman"], ["dmClient", "client"], ["dmAdmin", "admin"]]) await addUser(name, role)
  const project = (await db.query("insert into public.projects(code,name) values('DELETE-GANTT','Milestone deletion tests') returning id")).rows[0].id
  const other = (await db.query("insert into public.projects(code,name) values('DELETE-GANTT-OTHER','Other project') returning id")).rows[0].id
  await db.query("insert into public.project_managers(project_id,user_id,designation) values($1,$2,'primary'),($1,$3,'backup'),($4,$5,'primary')", [project, ids.dmPM, ids.dmBackup, other, ids.dmOtherPM])
  for (const person of ["dmEng", "dmFore", "dmClient"]) await db.query("insert into public.project_members(project_id,user_id) values($1,$2)", [project, ids[person]])
  const target = `milestone:${randomUUID()}`, dependent = `milestone:${randomUUID()}`, keep = `milestone:${randomUUID()}`
  const plan = (title, date, predecessors = []) => ({ title, phase: "Preparation", planned_start: date, planned_end: date, actual_start: null, actual_end: null, predecessors })
  const save = (key, value) => db.query("select public.save_timeline_item($1,$2,$3::jsonb,0,'')", [project, key, JSON.stringify(value)])
  const remove = (key = target, expected = 1, projectId = project) => db.query("select public.delete_timeline_milestone($1,$2,$3)", [projectId, key, expected])
  const timeline = async () => (await db.query("select public.get_project_timeline($1) data", [project])).rows[0].data
  await as("dmPM")
  await save(target, plan("Site handover", "2026-12-01"))
  await save(dependent, plan("Dependent checkpoint", "2026-12-02", [target]))
  await save(keep, plan("Final handover", "2026-12-10"))
  await db.query("select public.publish_project_timeline($1,'')", [project])

  await test("Milestone deletion: only the project's schedule managers can call it; private table stays private", async () => {
    for (const person of ["dmEng", "dmFore", "dmClient", "dmOtherPM", "dmAdmin"]) {
      await as(person, "aal2")
      await expectFail("select public.delete_timeline_milestone($1,$2,1)", [project, target], /schedule managers/)
    }
    await as(null)
    await expectFail("select public.delete_timeline_milestone($1,$2,1)", [project, target], /permission denied/)
    await as("dmPM")
    await expectFail("delete from public.project_timeline_items where project_id=$1 and work_key=$2", [project, target], /permission denied/)
    await expectFail("select public.delete_timeline_milestone($1,$2,1)", [other, target], /schedule managers/)
  })
  await test("Milestone deletion: task/pin keys, missing milestones, stale revisions and dependencies are refused", async () => {
    await as("dmPM")
    for (const key of [`task:${randomUUID()}`, `pin:${randomUUID()}`, null]) await expectFail("select public.delete_timeline_milestone($1,$2,1)", [project, key], /Only milestones/)
    await expectFail("select public.delete_timeline_milestone($1,$2,1)", [project, `milestone:${randomUUID()}`], /no longer exists/)
    for (const revision of [0, null]) await expectFail("select public.delete_timeline_milestone($1,$2,$3)", [project, target, revision], /changed/)
    await expectFail("select public.delete_timeline_milestone($1,$2,1)", [project, target], /depends on/)
    assert.equal((await timeline()).items.length, 3)
  })
  await test("Milestone deletion: primary and backup PM delete working milestones, audit before-state and preserve published history", async () => {
    await as("dmBackup")
    await remove(dependent)
    await as("dmPM")
    await remove()
    assert.deepEqual((await timeline()).items.map(item => item.key), [keep])
    await as("dmClient")
    assert.equal((await timeline()).items.length, 3, "Clients keep the last published version until republishing")
    await owner()
    const audits = (await db.query("select actor_id,details from public.audit_log where action='project_timeline.milestone_deleted' and details->>'project_id'=$1", [project])).rows
    assert.equal(audits.length, 2)
    const deletion = audits.find(row => row.details.work_key === target)
    assert.equal(deletion.actor_id, ids.dmPM)
    assert.equal(deletion.details.before.title, "Site handover")
    assert.equal((await db.query("select jsonb_array_length(snapshot) n from public.project_timeline_publications where project_id=$1 and version=1", [project])).rows[0].n, 3)
    await as("dmPM")
    await db.query("select public.publish_project_timeline($1,'')", [project])
    await as("dmClient")
    assert.deepEqual((await timeline()).items.map(item => item.key), [keep])
  })
  await test("Milestone deletion: archived projects and revoked PM assignments cannot delete", async () => {
    await owner()
    await db.query("update public.projects set archived_at=now() where id=$1", [project])
    await as("dmPM")
    await expectFail("select public.delete_timeline_milestone($1,$2,1)", [project, keep], /schedule managers/)
    await owner()
    await db.query("update public.projects set archived_at=null where id=$1", [project])
    await db.query("delete from public.project_managers where project_id=$1 and user_id=$2", [project, ids.dmPM])
    await as("dmPM")
    await expectFail("select public.delete_timeline_milestone($1,$2,1)", [project, keep], /schedule managers/)
  })
}
