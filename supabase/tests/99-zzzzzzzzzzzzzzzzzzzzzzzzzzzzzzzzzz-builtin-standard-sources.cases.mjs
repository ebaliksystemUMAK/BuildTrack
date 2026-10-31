// Tests for 20261031102813: official sources for the standards the built-in checklists cite.
import assert from "node:assert/strict"

export default async function ({ db, as, asOwner, test, expectOk, expectFail }) {
  const one = async (sql, params) => (await db.query(sql, params)).rows[0]
  const catalog = async () => (await one("select value from public.system_settings where key = 'standards'")).value
  const unlinked = ["NSCP 2015", "PEC 2017", "PNS 49"] // sold by the publisher / legacy edition-less code: no invented link

  await test("Built-in sources: every standard a built-in checklist cites has its official source, except the documented exceptions", async () => {
    await asOwner()
    const saved = await catalog() // earlier suites change the catalog, so this test builds its own from the built-in citations
    const cited = (await db.query("select distinct unnest(standards) code from public.qa_templates where is_system order by 1")).rows.map((r) => r.code)
    assert.equal(cited.length, 9, "the built-in checklists cite nine standards")
    try {
      await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify([...cited.map((code) => ({ code, title: "Synthetic title" })), { code: "PNS 49:2020", title: "Steel bars" }])])
      assert.equal((await one("select public.fill_documented_standard_sources() n")).n, cited.length - unlinked.length + 1)
      const filled = await catalog()
      for (const code of cited) {
        const entry = filled.find((s) => s.code === code)
        if (unlinked.includes(code)) assert.equal(entry.source, undefined, `${code} stays without a link`)
        else assert.match(entry.source ?? "", /^https:\/\/(elibrary\.judiciary\.gov\.ph|ncda\.gov\.ph|www\.prc\.gov\.ph)\//, `${code} links to an official copy`)
      }
      assert.match(filled.at(-1).source, /^https:\/\/bps\.dti\.gov\.ph\//, "the earlier documented links still apply")
    } finally {
      await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify(saved)])
    }
  })

  await test("Built-in sources: a link is added only where missing, matched without case or spaces, and running again changes nothing", async () => {
    await asOwner()
    const saved = await catalog()
    const synthetic = [
      { code: " ra 9514 ", title: "Custom fire code title" },
      { code: "BP 344", title: "Accessibility Law", source: "https://custom.example/bp344.pdf" },
      { code: "PEC 2017", title: "Philippine Electrical Code" },
    ]
    try {
      await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify(synthetic)])
      assert.equal((await one("select public.fill_documented_standard_sources() n")).n, 1)
      const filled = await catalog()
      assert.equal(filled[0].source, "https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/2/19962")
      assert.equal(filled[1].source, "https://custom.example/bp344.pdf", "a link set by a Super Admin is kept")
      assert.equal(filled[2].source, undefined)
      assert.deepEqual(filled.map((s) => [s.code, s.title]), synthetic.map((s) => [s.code, s.title]), "codes, titles and order unchanged")
      assert.equal((await one("select public.fill_documented_standard_sources() n")).n, 0)
    } finally {
      await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify(saved)])
    }
  })

  await test("Built-in sources: the filled catalog passes the Super Admin settings validation; nobody else can run the fill", async () => {
    await asOwner()
    const saved = await catalog()
    try {
      await as("super", "aal2")
      await expectOk("select public.set_setting('standards', $1::jsonb)", [JSON.stringify(saved)])
      for (const role of ["eng1", "client1"]) {
        await as(role, "aal2")
        await expectFail("select public.fill_documented_standard_sources()", [], /permission denied/)
      }
    } finally {
      await asOwner()
      await db.query("update public.system_settings set value = $1::jsonb where key = 'standards'", [JSON.stringify(saved)])
    }
  })
}
