import { lazy, Suspense, useEffect, useState } from "react"
import ProjectCalendar from "../components/calendar/ProjectCalendar"
import { EmptyState } from "../components/ui/PageParts"
import { useAuth } from "../lib/auth"
import { getSelectedProjectId } from "../lib/projects"
import { useProjectCalendar } from "../lib/projectCalendar"
import {
  calendarRoleMatches,
  type CalendarRole,
} from "../lib/projectCalendarModel"
import { useProjectTimeline } from "../lib/projectTimeline"
import { timelineCalendarEvents } from "../lib/projectTimelineModel"
import "../components/calendar/projectTimeline.css"

const ProjectTimeline = lazy(
  () => import("../components/calendar/ProjectTimeline"),
)
const readTab = () =>
  new URLSearchParams(window.location.search).get("tab") === "gantt"
    ? "gantt"
    : "calendar"

export default function ProjectCalendarPage({ role }: { role: CalendarRole }) {
  const { profile } = useAuth()
  const [tab, setTab] = useState(readTab)
  useEffect(() => {
    const sync = () => setTab(readTab())
    window.addEventListener("popstate", sync)
    return () => window.removeEventListener("popstate", sync)
  }, [])
  const projectId = getSelectedProjectId()
  const allowed =
    calendarRoleMatches(role, profile?.role) && profile?.status === "active"
  const calendar = useProjectCalendar(
    allowed ? projectId : null,
    role,
    profile?.id ?? null,
  )
  const timeline = useProjectTimeline(allowed ? projectId : null)
  if (!allowed)
    return (
      <div className={`${role}-page`}>
        <EmptyState title="Calendar unavailable">
          Your account cannot access this workspace.
        </EmptyState>
      </div>
    )
  if (!projectId)
    return (
      <div className={`${role}-page`}>
        <EmptyState title="Choose a project">
          Open a project to see its own calendar.
        </EmptyState>
      </div>
    )
  if (calendar.notFound && !calendar.loading)
    return (
      <div className={`${role}-page`}>
        <EmptyState title="Project unavailable">
          The project was removed or your access has changed.
        </EmptyState>
      </div>
    )
  const chooseTab = (next: "calendar" | "gantt") => {
    const params = new URLSearchParams(window.location.search)
    if (next === "gantt") params.set("tab", "gantt")
    else params.delete("tab")
    window.history.pushState(
      {},
      "",
      `${window.location.pathname}?${params}${window.location.hash}`,
    )
    setTab(next)
  }
  return (
    <div className={`${role}-page`}>
      <div
        className="bt-calendar-tabs"
        role="tablist"
        aria-label="Project schedule views"
      >
        <button
          type="button"
          id="calendar-tab"
          role="tab"
          aria-selected={tab === "calendar"}
          aria-controls="project-schedule-panel"
          onClick={() => chooseTab("calendar")}
        >
          Calendar
        </button>
        <button
          type="button"
          id="gantt-tab"
          role="tab"
          aria-selected={tab === "gantt"}
          aria-controls="project-schedule-panel"
          onClick={() => chooseTab("gantt")}
        >
          Gantt Timeline
        </button>
      </div>
      <div
        id="project-schedule-panel"
        role="tabpanel"
        aria-labelledby={tab === "gantt" ? "gantt-tab" : "calendar-tab"}
      >
        {tab === "gantt" ? (
          <Suspense
            fallback={
              <p role="status" className="p-6 text-fg-muted">
                Loading project timeline...
              </p>
            }
          >
            <ProjectTimeline
              key={`${role}:${projectId}`}
              role={role}
              projectId={projectId}
              projectName={calendar.project?.name ?? "Loading project"}
              projectCode={calendar.project?.code ?? ""}
              today={calendar.today}
              timeline={timeline}
            />
          </Suspense>
        ) : (
          <ProjectCalendar
            key={`${role}:${projectId}`}
            role={role}
            projectId={projectId}
            projectName={calendar.project?.name ?? "Loading project"}
            projectCode={calendar.project?.code ?? ""}
            today={calendar.today}
            events={timelineCalendarEvents(
              calendar.events,
              timeline?.data?.items ?? [],
              projectId,
              role,
            )}
            undated={calendar.undated}
            loading={
              calendar.loading ||
              !calendar.project ||
              Boolean(timeline?.loading)
            }
            error={calendar.error || (!timeline?.setupRequired ? timeline?.error : "") || ""}
            onReload={() => {
              void calendar.reload()
              void timeline?.reload()
            }}
          />
        )}
      </div>
    </div>
  )
}
