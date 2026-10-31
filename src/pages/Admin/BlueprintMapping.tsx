import { useEffect, useMemo, useState } from "react"
import AdminProjectSelect, { useAdminProject } from "../../components/AdminProjectSelect"
import { EmptyState, Meter } from "../../components/ui/PageParts"
import { SkeletonRows } from "../../components/ui/Skeleton"
import { disciplineLabels } from "../../lib/projects"
import { useProjectWork } from "../../lib/projectWork"
import { summarize } from "../../lib/progress"
import { supabase } from "../../lib/supabase"
import { StackedBar, StatusLegend } from "../Engineer/EngineerProgress"
import { AdminButton, PageIntro, Panel } from "./AdminShell"
import type { AdminPageProps } from "./types"

// Which sheets exist for a project, how many pins and drawings each carries, and in what state. A map of where the work is pinned.
export default function BlueprintMapping({ onNavigate }: AdminPageProps) {
  const { projects, projectId, choose, loading: projectsLoading } = useAdminProject()
  const work = useProjectWork(projectId)
  const [drawings, setDrawings] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!projectId) return
    let active = true
    supabase
      .from("blueprint_annotations")
      .select("blueprint_id")
      .eq("project_id", projectId)
      .limit(5000)
      .then(({ data }) => {
        if (!active) return
        const counts: Record<string, number> = {}
        for (const row of (data as Array<{ blueprint_id: string }> | null) ?? []) counts[row.blueprint_id] = (counts[row.blueprint_id] ?? 0) + 1
        setDrawings(counts)
      })
    return () => {
      active = false
    }
  }, [projectId])

  const rows = useMemo(
    () =>
      work.blueprints.map((sheet) => ({
        sheet,
        totals: summarize(work.pins.filter((pin) => pin.blueprint_id === sheet.id), work.today),
        notes: work.pins.filter((pin) => pin.blueprint_id === sheet.id && pin.category === "note").length,
      })),
    [work.blueprints, work.pins, work.today],
  )
  const loading = projectsLoading || work.loading

  return (
    <div className="admin-page">
      <PageIntro eyebrow="Plans" title="Blueprint mapping" description="Every sheet of the project with the pins and drawings placed on it, and how that work stands." action={<AdminButton icon="blueprint" onClick={() => onNavigate("blueprint-upload")}>Manage sheets</AdminButton>} />
      <Panel title="Sheets">
        <div className="mb-4"><AdminProjectSelect projects={projects} value={projectId} onChange={choose} /></div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Sheet</th><th>Level</th><th>Discipline</th><th>Revision</th><th>Work pins</th><th>Notes</th><th>Drawings</th><th className="w-56">Status</th></tr></thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={4} cols={8} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={8}><EmptyState title="No sheets yet">Upload the first sheet in Blueprint Upload.</EmptyState></td></tr>
              ) : (
                rows.map(({ sheet, totals, notes }) => (
                  <tr key={sheet.id}>
                    <td className="is-strong">{sheet.title}</td>
                    <td className="is-muted">{sheet.level ?? "—"}</td>
                    <td className="is-muted">{sheet.discipline ? disciplineLabels[sheet.discipline] : "—"}</td>
                    <td>Rev {sheet.blueprint_revisions[0]?.revision ?? "?"}</td>
                    <td>{totals.total}</td>
                    <td>{notes}</td>
                    <td>{drawings[sheet.id] ?? 0}</td>
                    <td>
                      <Meter value={totals.percentVerified} tone="green" label={`${sheet.title} approved task progress`} />
                      <span className="mt-1 block text-xs text-fg-muted">{totals.percentVerified}% · {totals.approvedTasks}/{totals.totalTasks} tasks approved</span>
                      <div className="mt-2"><StackedBar totals={totals} /></div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {rows.length ? <div className="mt-3"><StatusLegend /></div> : null}
      </Panel>
    </div>
  )
}
