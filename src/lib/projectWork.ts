import { useCallback, useMemo } from "react"
import { useBlueprints, useProjectPins } from "./blueprints"
import { manilaToday } from "./progress"
import { useProject, useProjectTeam } from "./projects"
import { byProject, useLiveReload, usePeriodicReload } from "./realtime"

// Everything an engineer's page needs about one project in one place: project, sheets, pins and who is on the team.
export function useProjectWork(projectId: string | null) {
  const { project, loading: projectLoading, notFound } = useProject(projectId)
  const { blueprints, loading: sheetsLoading, error: sheetsError, reload: reloadSheets } = useBlueprints(projectId)
  useLiveReload([...byProject("blueprints",projectId),{table:"blueprint_revisions"}],()=>void reloadSheets())
  const { pins, setPins, loading: pinsLoading, error, reload: reloadPins } = useProjectPins(projectId, true, true)
  const { team, loading: teamLoading, error: teamError, reload: reloadTeam } = useProjectTeam(projectId)
  const reload=useCallback(async()=>{await Promise.all([reloadSheets(),reloadPins(),reloadTeam()])},[reloadSheets,reloadPins,reloadTeam])
  usePeriodicReload(projectId ? `work:${projectId}` : null, () => { void reloadSheets(); void reloadPins() })

  const lookups = useMemo(() => {
    const names = new Map(team.map((member) => [member.user_id, member.full_name]))
    const sheets = new Map(blueprints.map((sheet) => [sheet.id, sheet]))
    return {
      nameOf: (id: string | null) => (id ? (names.get(id) ?? "Someone on the team") : "Unassigned"),
      sheetOf: (id: string) => sheets.get(id)?.title ?? "Sheet",
    }
  }, [team, blueprints])

  return {
    project: project?.id === projectId ? project : null,
    notFound,
    blueprints: blueprints.filter(row => row.project_id === projectId),
    pins: pins.filter(row => row.project_id === projectId),
    setPins,
    team,
    loading: projectLoading || sheetsLoading || pinsLoading || teamLoading,
    error: error || sheetsError || teamError,
    today: manilaToday(),
    reload,
    reloadPins,
    ...lookups,
  }
}
