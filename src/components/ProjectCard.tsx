import type { ReactNode } from "react"
import { disciplineLabels, phaseLabels, statusColor, statusLabels, type Project, type ProjectPhase } from "../lib/projects"

export type CardPerson = { id: string; name: string }

const phaseBanner: Record<ProjectPhase, string> = {
  plan_review: "from-sky-600 to-sky-400",
  team_briefing: "from-violet-600 to-violet-400",
  mobilization: "from-amber-600 to-amber-400",
  execution: "from-[#9e1f93] to-[#d46bcb]",
}

const initials = (name: string) =>
  name
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")

// Drive-style project card, shared by the Admin grid and the Engineer / Foreman / Client dashboards.
export default function ProjectCard({
  project,
  people,
  onOpen,
  actions,
}: {
  project: Project
  people?: CardPerson[]
  onOpen?: () => void
  actions?: ReactNode
}) {
  const shown = (people ?? []).slice(0, 4)
  const extra = (people?.length ?? 0) - shown.length

  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--bt-shadow)] transition hover:-translate-y-0.5 hover:shadow-[var(--bt-shadow-hover)]">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="text-left disabled:cursor-default"
        aria-label={`Open ${project.name}`}
      >
        <div className={`relative flex h-24 items-end justify-between overflow-hidden bg-gradient-to-br p-3 text-white ${phaseBanner[project.phase]}`}>
          <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.09)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.09)_1px,transparent_1px)] bg-[size:20px_20px]" aria-hidden="true" />
          <span className="relative rounded-md bg-black/25 px-2 py-0.5 text-xs font-bold tracking-wider backdrop-blur-sm">{project.code}</span>
          <span className="relative rounded-md bg-black/20 px-2 py-0.5 text-xs font-bold backdrop-blur-sm">{phaseLabels[project.phase]}</span>
        </div>
        <div className="space-y-1 p-4 pb-2">
          <h3 className="line-clamp-2 text-[15px] font-extrabold text-fg group-hover:text-brand-text">{project.name}</h3>
          <p className="truncate text-sm text-fg-muted">{project.location || "Location not set"}</p>
          {project.client_name ? <p className="truncate text-xs text-fg-muted">Client: {project.client_name}</p> : null}
          {project.manager_name ? (
            <p className="truncate text-xs text-fg-muted">
              In charge: <strong className="text-fg">{project.manager_name}</strong>
            </p>
          ) : null}
          {(project.disciplines ?? []).length ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {(project.disciplines ?? []).map((d) => (
                <span key={d} className="rounded bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold text-brand-text">
                  {disciplineLabels[d]}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </button>
      <div className="mt-auto flex items-center justify-between gap-2 px-4 pb-3 pt-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColor[project.status]}`}>
            {statusLabels[project.status]}
          </span>
          {project.archived_at ? <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs font-semibold text-fg-muted">Archived</span> : null}
          {people ? (
            <div className="flex -space-x-2" title={`${people.length} people with access`}>
              {shown.map((person) => (
                <span
                  key={person.id}
                  title={person.name}
                  className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-brand text-[11px] font-bold text-white"
                >
                  {initials(person.name)}
                </span>
              ))}
              {extra > 0 ? (
                <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-surface bg-surface-muted text-[11px] font-bold text-fg-muted">
                  +{extra}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-line bg-surface-muted/60 px-3 py-2">{actions}</div> : null}
    </article>
  )
}
