import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

export default async function ({ db, asOwner, test, expectFail }) {
  await asOwner()
  const catalog = async () => (await db.query("select value from public.system_settings where key='standards'")).rows[0].value
  const original = await catalog()
  const migration = readFileSync(new URL("../migrations/20261019093602_philippine_qa_standards.sql", import.meta.url), "utf8")
  const append = migration.match(/do \$catalog\$[\s\S]*?\$catalog\$;/)[0]

  await test("Philippine standards: all seven edition-specific references are seeded; legacy citations remain", async () => {
    for (const code of ["PNS 07:2018", "PNS ASTM C90:2019 Amd. 1:2019", "PNS ASTM C129:2019 Amd. 1:2019", "PNS ASTM C140/C140M:2019", "PNS 67:2014", "PGBC 2015", "PNS 49:2020", "PNS 49", "NSCP 2015"]) {
      assert.ok(original.some(s => s.code === code), code)
    }
    assert.equal(original.length, 16)
    assert.equal(original.filter(s => s.source).length, 13, "documented official sources: 7 from 20261028150000 + 6 from 20261031102813")
    assert.equal(original.find(s => s.code === "NSCP 2015").source, undefined, "no invented link")
    assert.equal(Number((await db.query("select count(*) n from public.qa_template_items where acceptance_criteria is not null or evidence_requirement is not null")).rows[0].n), 0, "No fabricated criteria backfilled")
  })

  await test("Philippine standards: appending is idempotent and preserves custom titles, entries and order", async () => {
    const custom = [{ code: "CUSTOM 2026", title: "Synthetic company specification" }, { code: "pns 07:2018", title: "Custom cement title" }]
    try {
      await db.query("update public.system_settings set value=$1::jsonb where key='standards'", [JSON.stringify(custom)])
      await db.exec(append)
      const once = await catalog()
      assert.deepEqual(once.slice(0, 2), custom)
      assert.equal(once.length, 8)
      await db.exec(append)
      assert.deepEqual(await catalog(), once)
      const full = Array.from({ length: 30 }, (_, i) => ({ code: `CUSTOM ${i}`, title: "Synthetic custom reference" }))
      await db.query("update public.system_settings set value=$1::jsonb where key='standards'", [JSON.stringify(full)])
      await expectFail(append, [], /exceed 30/)
      assert.deepEqual(await catalog(), full)
    } finally {
      await db.query("update public.system_settings set value=$1::jsonb where key='standards'", [JSON.stringify(original)])
    }
  })
}
