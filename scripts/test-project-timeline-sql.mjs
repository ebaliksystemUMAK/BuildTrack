import assert from "node:assert/strict"
import { createDatabase } from "../supabase/tests/harness.mjs"
import cases from "../supabase/tests/zzzzzzzzzzzzzz-project-timeline.cases.mjs"
import proposalCases from "../supabase/tests/zzzzzzzzzzzzzzz-schedule-proposals.cases.mjs"
import qaSnapshotCases from "../supabase/tests/zzzzzzzzzzzzzzzz-qa-schedule-snapshots.cases.mjs"

const db = await createDatabase({ quiet: true })
const ids = {}
const asOwner = () => db.exec("reset role")
const as = async (key, aal = "aal1") => {
  await asOwner()
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify(key ? { sub: ids[key], aal, role: "authenticated" } : {}),
  ])
  await db.exec(key ? "set role authenticated" : "set role anon")
}
const addUser = async (key, role) => {
  const { rows } = await db.query(
    "insert into auth.users(email,raw_user_meta_data) values($1,$2) returning id",
    [`${key}@gantt.test`, JSON.stringify({ full_name: key })],
  )
  ids[key] = rows[0].id
  await db.query(
    "update public.profiles set role=$2,status='active',identity_status='verified',email_verified_at=now() where id=$1",
    [ids[key], role],
  )
}
let passed = 0,
  failed = 0
const test = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`ok ${name}`)
  } catch (error) {
    failed++
    console.error(`FAIL ${name}\n${error.message}\n${error.where ?? ""}`)
  } finally {
    await asOwner()
  }
}
const expectFail = async (sql, params, pattern) => {
  try {
    await db.query(sql, params)
  } catch (error) {
    if (pattern) assert.match(error.message, pattern)
    return
  }
  assert.fail("Expected SQL request to fail")
}
await cases({ db, ids, as, asOwner, addUser, test, expectFail })
await proposalCases({ db, ids, as, asOwner, addUser, test, expectFail })
await qaSnapshotCases({ db, ids, as, asOwner, addUser, test, expectFail })
await db.close()
console.log(`${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
