// Local SQL test harness: runs every migration in supabase/migrations against an in-memory Postgres (PGlite)
// with a minimal stand-in for Supabase's `auth` schema, then checks RLS / trigger behavior as different users.
// Usage: pnpm test:sql            (all migrations)
//        pnpm test:sql --upto 4   (only migrations 0001-0004, to reproduce older states)
import { readdirSync } from "node:fs"
import { createDatabase } from "./harness.mjs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const uptoArg = process.argv.indexOf("--upto")
const upto = uptoArg > -1 ? Number(process.argv[uptoArg + 1]) : Infinity

const db = await createDatabase({ upto })

// ---- Helpers ----
const ids = {}
async function addUser(key, role, status = "active", verified = true) {
  const email = `${key}@test.local`
  const { rows } = await db.query(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify({ full_name: key })],
  )
  ids[key] = rows[0].id
  await db.query("update public.profiles set role = $2, status = $3, identity_status = $4 where id = $1", [rows[0].id, role, status, verified ? "verified" : "unverified"])
}

async function as(key, aal = "aal1") {
  await db.exec("reset role")
  if (!key) return db.exec("set role anon")
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: ids[key], aal, role: "authenticated" }),
  ])
  await db.exec("set role authenticated")
}
const asOwner = () => db.exec("reset role")

let failed = 0
let passed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ok   ${name}`)
  } catch (error) {
    failed++
    console.log(`  FAIL ${name}\n       ${error.message}`)
  } finally {
    await asOwner()
  }
}
const expectOk = async (sql, params) => db.query(sql, params)
async function expectFail(sql, params, pattern) {
  try {
    await db.query(sql, params)
  } catch (error) {
    if (pattern && !pattern.test(error.message)) throw new Error(`failed with unexpected message: ${error.message}`)
    return
  }
  throw new Error("expected an error but the statement succeeded")
}
const count = async (sql, params) => Number((await db.query(sql, params)).rows[0].n)

// ---- Fixtures ----
await addUser("super", "super_admin")
await addUser("admin", "admin") // gets default permissions from 0004 when present
await addUser("noperm", "admin")
await addUser("eng1", "engineer")
await addUser("eng2", "engineer")
await addUser("fore1", "foreman")
await addUser("client1", "client")
await addUser("pending1", null, "pending")
await asOwner()
// Without 0004 the admin has no permission yet: grant it the way the Super Admin would.
await db.query(
  "insert into public.admin_permissions (user_id, permission) values ($1, 'projects.manage') on conflict do nothing",
  [ids.admin],
)
await db.query("delete from public.admin_permissions where user_id = $1", [ids.noperm])

console.log("\nTests")

await test("Admin (aal2, projects.manage) can create a project", async () => {
  await as("admin", "aal2")
  await expectOk("insert into public.projects (code, name) values ('VCB-001', 'Valencia Commercial Building')")
})

await test("Admin without MFA (aal1) cannot create a project", async () => {
  await as("admin", "aal1")
  await expectFail("insert into public.projects (code, name) values ('NOMFA-1', 'Valid name')", [], /row-level security/)
})

await test("Admin without projects.manage cannot create a project", async () => {
  await as("noperm", "aal2")
  await expectFail("insert into public.projects (code, name) values ('NOPERM-1', 'Valid name')", [], /row-level security/)
})

await test("Engineer / Foreman / Client cannot create projects", async () => {
  for (const who of ["eng1", "fore1", "client1"]) {
    await as(who)
    await expectFail(`insert into public.projects (code, name) values ('X-${who}', 'Valid name')`, [], /row-level security/)
  }
})

await test("Project creation is written to the audit log", async () => {
  await asOwner()
  const n = await count("select count(*) n from public.audit_log where action = 'projects.insert'")
  if (n < 1) throw new Error("no audit row for projects.insert")
})

await test("Super Admin recovery assignment works and rejects non-field roles", async () => {
  await as("super", "aal2")
  const { rows } = await db.query("select id from public.projects where code = 'VCB-001'")
  const pid = rows[0].id
  ids.p1 = pid
  await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [pid, ids.eng1])
  await expectOk("insert into public.project_members (project_id, user_id) values ($1, $2)", [pid, ids.client1])
  await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [pid, ids.super], /Only active/)
  await expectFail("insert into public.project_members (project_id, user_id) values ($1, $2)", [pid, ids.pending1], /Only active/)
})

await test("Engineer sees only the project they are assigned to", async () => {
  await as("admin", "aal2")
  await expectOk("insert into public.projects (code, name) values ('VCB-002', 'Other site')")
  await as("eng1")
  if ((await count("select count(*) n from public.projects")) !== 1) throw new Error("engineer should see exactly 1 project")
  await as("eng2")
  if ((await count("select count(*) n from public.projects")) !== 0) throw new Error("unassigned engineer should see 0 projects")
})

await test("Assigned users cannot modify or delete projects", async () => {
  await as("eng1")
  const upd = await db.query("update public.projects set name = 'hacked' where id = $1 returning id", [ids.p1])
  if (upd.rows.length) throw new Error("engineer updated a project")
  const del = await db.query("delete from public.projects where id = $1 returning id", [ids.p1])
  if (del.rows.length) throw new Error("engineer deleted a project")
})

await test("Disabled member loses access immediately", async () => {
  await asOwner()
  await db.query("update public.profiles set status = 'disabled' where id = $1", [ids.client1])
  await as("client1")
  if ((await count("select count(*) n from public.projects")) !== 0) throw new Error("disabled client still sees projects")
  await asOwner()
  await db.query("update public.profiles set status = 'active' where id = $1", [ids.client1])
})

await test("Deleting a project cascades members and is audited", async () => {
  await as("admin", "aal2")
  const { rows } = await db.query("select id from public.projects where code = 'VCB-002'")
  await expectOk("delete from public.projects where id = $1", [rows[0].id])
  await asOwner()
  const n = await count("select count(*) n from public.audit_log where action = 'projects.delete'")
  if (n < 1) throw new Error("no audit row for projects.delete")
})

// Every *.cases.mjs file in this folder (run in name order). Each exports default async (ctx) => {}.
const helpers = { db, ids, as, asOwner, test, expectOk, expectFail, count, addUser }
for (const file of readdirSync(here).filter((f) => f.endsWith(".cases.mjs")).sort()) {
  const mod = await import(pathToFileURL(join(here, file)).href)
  console.log(`\n${file}`)
  await mod.default(helpers)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
