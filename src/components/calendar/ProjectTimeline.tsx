import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary } from "../ui/PageParts"
import type { useProjectTimeline } from "../../lib/projectTimeline"
import {
  timelineBar,
  timelineDays,
  timelineDateAxis,
  timelineGeometry,
  timelinePhases,
  timelinePlan,
  timelinePlanProblem,
  timelineStatus,
  type TimelineItem,
  type TimelinePlan,
  type TimelineRequest,
  type TimelineZoom,
} from "../../lib/projectTimelineModel"
import {
  calendarAddDays,
  calendarDateLabel,
  type CalendarRole,
} from "../../lib/projectCalendarModel"
import { pinPlanPath } from "../../lib/pinRecordsModel"
import { followLink } from "../../lib/notifications"
import { supabase } from "../../lib/supabase"
import { useAuth } from "../../lib/auth"
import { useToast } from "../../lib/toast"
import "./projectTimeline.css"

const dateLabel = (date: string | null | undefined) =>
  date
    ? calendarDateLabel(date, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Not recorded"
const inputClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg"

type GanttRow =
  | {
      kind: "phase"
      phase: string
      count: number
    }
  | {
      kind: "item"
      item: TimelineItem
    }

function ScheduleForm({
  item,
  items,
  requesting,
  onSave,
  onClose,
  approval = false,
  onManageAssignment,
  proposalReason,
}: {
  item: TimelineItem
  items: TimelineItem[]
  requesting: boolean
  onSave: (plan: TimelinePlan, reason: string) => Promise<string | null>
  onClose: () => void
  approval?: boolean
  onManageAssignment?: () => void
  proposalReason?: string
}) {
  const [plan, setPlan] = useState(() => timelinePlan(item))
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const update = <K extends keyof TimelinePlan,>(
    key: K,
    value: TimelinePlan[K],
  ) => setPlan((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = timelinePlanProblem(plan, item.key, items)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError("")
    try {
      const failure = await onSave(plan, reason.trim())
      if (failure) setError(failure)
    } catch {
      setError("Could not save. Check your connection and retry.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={
        approval ? "Review & approve proposed schedule" : requesting
          ? "Request schedule change"
          : item.revision
            ? "Edit task schedule"
            : item.kind === "milestone"
              ? "Add milestone"
              : "Schedule task"
      }
      description={
        item.kind === "work"
          ? `${item.pin_title} · ${item.title}`
          : "Mark a project checkpoint with one planned date."
      }
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        {proposalReason ? <p className="rounded-lg bg-brand-soft p-3 text-sm text-brand-text"><strong>Proposal reason: </strong>{proposalReason}</p> : null}
        {approval ? <div className="rounded-lg border border-line p-3 text-sm"><strong>Responsible Foreman: {item.owner ?? "Unassigned"}</strong><p className="mb-1 mt-1 text-xs text-fg-muted">Review the pin's assignment alongside its dates. Assignments stay linked to the original work.</p>{onManageAssignment ? <button type="button" className="text-xs font-semibold text-brand-text underline" onClick={onManageAssignment}>Review team & work assignments</button> : null}</div> : null}
        {item.kind === "milestone" ? (
          <label className="block text-sm font-semibold">
            Milestone title
            <input
              required
              maxLength={160}
              className={`${inputClass} mt-1`}
              value={plan.title}
              onChange={(event) => update("title", event.target.value)}
            />
          </label>
        ) : (
          <p className="rounded-lg bg-surface-muted p-3 text-sm text-fg-muted">
            Task names and assignments come from the linked work pin. Schedule
            changes do not verify work or change QA results.
          </p>
        )}
        <label className="block text-sm font-semibold">
          Phase
          <input
            required
            list="timeline-phases"
            maxLength={80}
            className={`${inputClass} mt-1`}
            value={plan.phase}
            onChange={(event) => update("phase", event.target.value)}
          />
          <datalist id="timeline-phases">
            {timelinePhases.map((phase) => (
              <option key={phase} value={phase} />
            ))}
          </datalist>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([
            ["planned_start", "Planned start"],
            ["planned_end", "Planned finish"],
            ["actual_start", "Actual start"],
            ["actual_end", "Actual finish"],
          ] as const).filter(([key]) => !approval || key.startsWith("planned")).map(([key, label]) => (
            <label key={key} className="block text-sm font-semibold">
              {label}
              <input
                type="date"
                min="1900-01-01"
                max="2199-12-31"
                required={
                  item.kind === "milestone" && key.startsWith("planned")
                }
                value={plan[key] ?? ""}
                className={`${inputClass} mt-1`}
                onChange={(event) => update(key, event.target.value || null)}
              />
            </label>
          ))}
        </div>
        {!approval ? <p className="text-xs text-fg-muted">
          Actual dates record execution only. A task stays unverified until its
          Engineer approves it.
        </p> : null}
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold">
            Finish-to-start dependencies
          </legend>
          <p className="mb-2 text-xs text-fg-muted">
            Selected work must finish before this task starts. Dates are never
            shifted automatically.
          </p>
          <div className="max-h-36 space-y-2 overflow-y-auto">
            {items
              .filter(
                (row) =>
                  row.key !== item.key && row.planned_start && row.planned_end,
              )
              .map((row) => (
                <label key={row.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={plan.predecessors.includes(row.key)}
                    onChange={(event) =>
                      update(
                        "predecessors",
                        event.target.checked
                          ? [...plan.predecessors, row.key]
                          : plan.predecessors.filter((key) => key !== row.key),
                      )
                    }
                  />
                  <span>
                    {row.title}
                    <small className="block text-fg-muted">
                      Finishes {dateLabel(row.planned_end)}
                    </small>
                  </span>
                </label>
              ))}
            {!items.some((row) => row.key !== item.key && row.planned_start) ? (
              <p className="text-sm text-fg-muted">
                Schedule another task first to add a dependency.
              </p>
            ) : null}
          </div>
        </fieldset>
        <label className="block text-sm font-semibold">
          {requesting ? "Reason for this request" : "Reason for this schedule"}
          <textarea
            required
            minLength={5}
            maxLength={500}
            rows={3}
            className={`${inputClass} mt-1`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-danger-soft p-3 text-sm text-danger-fg"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className={buttonSecondary}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            disabled={busy || reason.trim().length < 5}
            type="submit"
            className={buttonPrimary}
          >
            {busy ? "Saving..." : approval ? "Approve schedule" : requesting ? "Send request" : "Save schedule"}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default function ProjectTimeline({
  projectId,
  projectName,
  projectCode,
  role,
  today,
  timeline,
}: {
  projectId: string
  projectName: string
  projectCode: string
  role: CalendarRole
  today: string
  timeline: ReturnType<typeof useProjectTimeline>
}) {
  const { data, loading, error, reload } = timeline
  const { profile } = useAuth()
  const toast = useToast()
  const scroll = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ left: 0, width: 1200 })
  const [query, setQuery] = useState("")
  const [phase, setPhase] = useState("all")
  const [status, setStatus] = useState("all")
  const [mine, setMine] = useState(false)
  const [zoom, setZoom] = useState<TimelineZoom>("week")
  const [baseline, setBaseline] = useState(true)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<TimelineItem | null>(null)
  const [publish, setPublish] = useState(false)
  const [review, setReview] = useState<{
    request: TimelineRequest
    approve: boolean
  } | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState("")
  const items = data?.items ?? []
  const phases = [...new Set(items.map((item) => item.phase))].sort((a, b) => {
    const order = (name: string) => {
      const index = timelinePhases.indexOf(name)
      return index < 0 ? 6 : index
    }
    return order(a) - order(b) || a.localeCompare(b)
  })
  const filtered = items.filter(
    (item) =>
      (phase === "all" || item.phase === phase) &&
      (status === "all" || timelineStatus(item, today) === status) &&
      (!mine || item.assigned_to === profile?.id) &&
      `${item.title} ${item.pin_title ?? ""} ${item.owner ?? ""} ${item.location ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  )
  const scheduled = filtered.filter(
    (item) => item.planned_start && item.planned_end,
  )
  const unscheduled = filtered.filter(
    (item) => !item.planned_start || !item.planned_end,
  )
  const geometry = useMemo(
    () =>
      timelineGeometry(
        [
          ...items,
          ...(baseline && role !== "client" ? (data?.baseline ?? []) : []),
        ],
        today,
        zoom,
      ),
    [items, data?.baseline, baseline, today, zoom, role],
  )
  const todayOffset = timelineDays(geometry.from, today)
  const todayInRange = todayOffset >= 0 && todayOffset < geometry.days
  const axis = timelineDateAxis(geometry, viewport.left, viewport.width)
  const hasScheduled = scheduled.length > 0
  useEffect(() => {
    const element = scroll.current
    if (!element) return
    const sync = () => setViewport(current => current.left === element.scrollLeft && current.width === element.clientWidth ? current : { left: element.scrollLeft, width: element.clientWidth })
    sync()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync)
    observer?.observe(element)
    window.addEventListener("resize", sync)
    return () => { observer?.disconnect(); window.removeEventListener("resize", sync) }
  }, [projectId, loading, error, hasScheduled])
  const rowLayout: GanttRow[] = phases.flatMap((name) => {
    const group = scheduled.filter((item) => item.phase === name)
    if (!group.length) return []
    return [
      { kind: "phase" as const, phase: name, count: group.length },
      ...(collapsed.includes(name)
        ? []
        : group.map((item) => ({ kind: "item" as const, item }))),
    ]
  })
  const positions = new Map<string, number>()
  let height = 0
  for (const row of rowLayout) {
    if (row.kind === "item") positions.set(row.item.key, height + 25)
    height += row.kind === "phase" ? 36 : 68
  }
  const opened = items.find((item) => item.key === selected)
  const openTask = (
    item: TimelineItem,
    section: "checklist" | "reports" = "checklist",
  ) => {
    if (item.pin_id)
      followLink(
        pinPlanPath(role, {
          projectId,
          pinId: item.pin_id,
          sheetId: item.blueprint_id,
          section,
        }),
        projectId,
      )
  }
  const runAction = async (name: string, args: Record<string, unknown>) => {
    setBusy(true)
    setActionError("")
    try {
      const { error: failure } = await supabase.rpc(name, args)
      if (failure) {
        setActionError(failure.message)
        return false
      }
      await reload()
      return true
    } catch {
      setActionError("Could not save. Check your connection and retry.")
      return false
    } finally {
      setBusy(false)
    }
  }
  if (loading)
    return (
      <section className="bt-timeline">
        <p className="p-8 text-fg-muted" role="status">
          Loading project timeline...
        </p>
      </section>
    )
  if (error || !data)
    return (
      <section className="bt-timeline">
        <div className="p-8" role="alert">
          <h2 className="text-lg font-bold">Timeline unavailable</h2>
          <p className="text-fg-muted">
            {error || "The timeline could not be loaded."}
          </p>
          <button className={buttonSecondary} onClick={() => void reload()}>
            Retry
          </button>
        </div>
      </section>
    )
  const visibleRequests = data.requests.filter(request => request.status !== "draft")
  const pending = visibleRequests.filter(
    (request) => request.status === "pending",
  )

  return (
    <section className="bt-timeline" aria-label="Project Gantt timeline">
      <header className="bt-timeline-heading">
        <div>
          <p className="bt-timeline-eyebrow">Project schedule</p>
          <h1>Gantt Timeline</h1>
          <p>
            {projectCode} · {projectName}
          </p>
        </div>
        <div className="bt-timeline-heading-actions">
          {data.can_edit ? (
            <>
              <button
                className={buttonSecondary}
                onClick={() =>
                  setEditing({
                    key: `milestone:${crypto.randomUUID()}`,
                    kind: "milestone",
                    title: "",
                    phase: "Preparation",
                    planned_start: today,
                    planned_end: today,
                    actual_start: null,
                    actual_end: null,
                    predecessors: [],
                    revision: 0,
                    verified: false,
                  })
                }
              >
                + Add milestone
              </button>
              <button
                className={buttonPrimary}
                onClick={() => {
                  setPublish(true)
                  setNote("")
                  setActionError("")
                }}
              >
                Publish schedule
              </button>
            </>
          ) : null}
          <button
            type="button"
            className={buttonSecondary}
            onClick={() => void reload()}
          >
            Refresh
          </button>
        </div>
      </header>
      <div className="bt-timeline-notice">
        {role === "client" ? (
          data.version ? (
            `Published schedule · Version ${data.version}. Progress reflects verification at publication.`
          ) : (
            "Your Project Manager has not published a timeline yet."
          )
        ) : (
          <>
            <strong>
              {data.can_edit ? "Working schedule" : "Project timeline"}
            </strong>{" "}
            ·{" "}
            {data.version
              ? `Published baseline v${data.version} · ${dateLabel(data.published_at?.slice(0, 10))}`
              : "No published baseline yet"}
            .{" "}
            {data.can_edit
              ? "Saving changes the working schedule; publish to share it with Clients."
              : data.can_request
                ? "Request date changes here. Submit progress and evidence in your existing work reports."
                : "You have read-only access to this schedule."}
          </>
        )}
      </div>
      <div className="bt-timeline-stats">
        {[
          ["Work tasks", items.filter((row) => row.kind === "work").length],
          [
            "Scheduled",
            items.filter((row) => row.planned_start && row.planned_end).length,
          ],
          [
            "Overdue",
            items.filter((row) => timelineStatus(row, today) === "Overdue")
              .length,
          ],
          [
            "Unscheduled",
            items.filter((row) => !row.planned_start || !row.planned_end)
              .length,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="bt-timeline-filters">
        <input
          type="search"
          aria-label="Search timeline tasks"
          placeholder="Search tasks, pins or people"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Filter by phase"
          value={phase}
          onChange={(event) => setPhase(event.target.value)}
        >
          <option value="all">All phases</option>
          {phases.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Filter by task status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          {[
            "all",
            "Not started",
            "In progress",
            "Verified",
            "Reached",
            "Overdue",
            "Blocked",
            "Unscheduled",
          ].map((name) => (
            <option key={name} value={name}>
              {name === "all" ? "All statuses" : name}
            </option>
          ))}
        </select>
        <select
          aria-label="Timeline zoom"
          value={zoom}
          onChange={(event) => setZoom(event.target.value as TimelineZoom)}
        >
          <option value="day">Day zoom</option>
          <option value="week">Week zoom</option>
          <option value="month">Month zoom</option>
        </select>
        {role !== "client" ? (
          <>
            <label>
              <input
                type="checkbox"
                checked={mine}
                onChange={(event) => setMine(event.target.checked)}
              />
              My tasks
            </label>
            <label>
              <input
                type="checkbox"
                checked={baseline}
                onChange={(event) => setBaseline(event.target.checked)}
              />
              Baseline
            </label>
          </>
        ) : null}
        <button
          type="button"
          className={buttonSecondary}
          onClick={() =>
            scroll.current?.scrollTo({
              left: Math.max(
                0,
                (todayOffset / geometry.days) * geometry.width - 180,
              ),
              behavior: "smooth",
            })
          }
          disabled={!todayInRange}
        >
          Today
        </button>
      </div>
      <div className="bt-timeline-legend">
        <span>
          <i className="planned" />
          Planned
        </span>
        {role !== "client" ? (
          <>
            <span>
              <i className="reported" />
              Reported progress
            </span>
            <span>
              <i className="actual" />
              Actual dates
            </span>
            <span>
              <i className="baseline" />
              Published baseline
            </span>
          </>
        ) : null}
        <span>
          <i className="verified" />
          Engineer verified
        </span>
        <span>◇ Milestone</span>
        <span>Arrows: finish-to-start</span>
      </div>
      {scheduled.length ? (
        <div
          className="bt-gantt-scroll"
          ref={scroll}
          onScroll={event => setViewport({ left: event.currentTarget.scrollLeft, width: event.currentTarget.clientWidth })}
          tabIndex={0}
          role="region"
          aria-label="Scrollable project Gantt chart"
        >
          <div
            className="bt-gantt-track"
            style={{ width: geometry.width + 280 }}
          >
            <div className="bt-gantt-axis">
              <div className="bt-gantt-label">Task / responsible person</div>
              <div className="bt-gantt-dates" style={{ width: geometry.width }}>
                {axis.months.map(month => {
                  const left = (month.offset / geometry.days) * geometry.width
                  const width = (month.days / geometry.days) * geometry.width
                  return <span
                    key={month.date.slice(0, 7)}
                    className="bt-gantt-month"
                    style={{ left, width, paddingLeft: Math.min(Math.max(7, viewport.left - left + 7), Math.max(0, width - 1)) }}
                    title={calendarDateLabel(month.date, { month: "long", year: "numeric" })}
                  >{calendarDateLabel(month.date, { month: "short", year: "numeric" })}</span>
                })}
                {axis.dates.map(({ offset, date }) => (
                  <span
                    key={date}
                    className="bt-gantt-day"
                    data-date={date}
                    aria-label={dateLabel(date)}
                    aria-current={date === today ? "date" : undefined}
                    title={dateLabel(date)}
                    style={{ left: `${(offset / geometry.days) * 100}%`, width: `${100 / geometry.days}%` }}
                  >
                    {Number(date.slice(8))}
                  </span>
                ))}
              </div>
            </div>
            <svg
              className="bt-gantt-dependencies"
              aria-hidden="true"
              style={{ left: 280, top: 56, width: geometry.width, height }}
              viewBox={`0 0 ${geometry.width} ${height}`}
            >
              <defs>
                <marker
                  id="gantt-arrow"
                  markerWidth="6"
                  markerHeight="6"
                  refX="5"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L6,3 L0,6" fill="currentColor" />
                </marker>
              </defs>
              {scheduled.flatMap((item) =>
                item.predecessors.map((key) => {
                  const before = scheduled.find((row) => row.key === key),
                    y1 = positions.get(key),
                    y2 = positions.get(item.key)
                  if (
                    !before?.planned_end ||
                    !item.planned_start ||
                    y1 === undefined ||
                    y2 === undefined
                  )
                    return null
                  const x1 =
                      ((timelineDays(geometry.from, before.planned_end) + 1) /
                        geometry.days) *
                      geometry.width,
                    x2 =
                      (timelineDays(geometry.from, item.planned_start) /
                        geometry.days) *
                      geometry.width
                  const mid = (x1 + x2) / 2
                  return (
                    <path
                      key={`${key}:${item.key}`}
                      d={`M${x1},${y1} H${mid} V${y2} H${x2}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      markerEnd="url(#gantt-arrow)"
                    />
                  )
                }),
              )}
            </svg>
            {rowLayout.map((row) =>
              row.kind === "phase" ? (
                <div key={`phase:${row.phase}`} className="bt-gantt-phase">
                  <button
                    type="button"
                    className="bt-gantt-label"
                    aria-expanded={!collapsed.includes(row.phase)}
                    onClick={() =>
                      setCollapsed((current) =>
                        current.includes(row.phase)
                          ? current.filter((value) => value !== row.phase)
                          : [...current, row.phase],
                      )
                    }
                  >
                    {collapsed.includes(row.phase) ? "+" : "−"} {row.phase}{" "}
                    <small>{row.count}</small>
                  </button>
                </div>
              ) : (
                (() => {
                  const item = row.item,
                    state = timelineStatus(item, today),
                    old = data.baseline.find(
                      (before) => before.key === item.key,
                    )
                  const planned = timelineBar(
                    item.planned_start,
                    item.planned_end,
                    geometry.from,
                    geometry.days,
                  )
                  const actual = timelineBar(
                    item.actual_start,
                    item.actual_end ?? (item.actual_start ? today : null),
                    geometry.from,
                    geometry.days,
                  )
                  const base =
                    baseline && role !== "client" && old
                      ? timelineBar(
                          old.planned_start,
                          old.planned_end,
                          geometry.from,
                          geometry.days,
                        )
                      : null
                  return (
                    <div
                      key={item.key}
                      className={`bt-gantt-row ${
                        state === "Overdue"
                          ? "is-overdue"
                          : state === "Blocked"
                            ? "is-blocked"
                            : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="bt-gantt-label"
                        onClick={() => setSelected(item.key)}
                      >
                        <strong>
                          {item.kind === "milestone" ? "◇ " : ""}
                          {item.title}
                        </strong>
                        <span>
                          {role === "client"
                            ? state
                            : `${item.owner ?? "Project milestone"} · ${state}`}
                        </span>
                      </button>
                      <div
                        className="bt-gantt-lane"
                        style={{
                          width: geometry.width,
                          backgroundSize: `${100 / geometry.days}% 100%`,
                        }}
                      >
                        {base ? (
                          <span
                            className="bt-gantt-baseline"
                            style={base}
                            title={`Published baseline: ${old?.planned_start} to ${old?.planned_end}`}
                          />
                        ) : null}
                        {planned ? (
                          <button
                            type="button"
                            className={`bt-gantt-bar ${
                              item.kind === "milestone" ? "is-milestone" : ""
                            } ${item.verified ? "is-verified" : ""}`}
                            style={planned}
                            onClick={() => setSelected(item.key)}
                            aria-label={`${item.title}, ${dateLabel(item.planned_start)} to ${dateLabel(item.planned_end)}, ${state}`}
                            title={`${item.title} · ${state}${
                              role !== "client"
                                ? ` · Reported ${item.reported_percent ?? "—"}%`
                                : ""
                            }`}
                          >
                            {role !== "client" &&
                            item.kind !== "milestone" &&
                            item.reported_percent != null ? (
                              <span
                                className="bt-gantt-reported"
                                style={{ width: `${item.reported_percent}%` }}
                              />
                            ) : null}
                            <span className="bt-gantt-bar-text">
                              {item.kind === "milestone"
                                ? "◇"
                                : item.verified
                                  ? "Verified"
                                  : role !== "client" &&
                                      item.reported_percent != null
                                    ? `${item.reported_percent}% reported`
                                    : item.title}
                            </span>
                          </button>
                        ) : null}
                        {actual && role !== "client" ? (
                          <span
                            className="bt-gantt-actual"
                            style={actual}
                            title={`Actual: ${dateLabel(item.actual_start)} to ${
                              item.actual_end
                                ? dateLabel(item.actual_end)
                                : "ongoing"
                            }`}
                          />
                        ) : null}
                        {todayInRange ? (
                          <span
                            className="bt-gantt-today"
                            style={{
                              left: `${(todayOffset / geometry.days) * 100}%`,
                            }}
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                    </div>
                  )
                })()
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="bt-timeline-empty">
          <h2>
            {items.length
              ? "No scheduled tasks match these filters"
              : role === "client"
                ? "No published timeline yet"
                : "No work tasks yet"}
          </h2>
          <p>
            {items.length
              ? "Schedule the undated tasks below, or adjust your filters."
              : role === "client"
                ? "The project timeline will appear here after your Project Manager publishes it."
                : "Add work pins and tasks on the blueprint, then return here to schedule them."}
          </p>
        </div>
      )}
      {role !== "client" && unscheduled.length ? (
        <section className="bt-timeline-unscheduled">
          <h2>
            Unscheduled tasks <span>{unscheduled.length}</span>
          </h2>
          <p>
            These tasks need a planned start and finish before they can appear
            as timeline bars.
          </p>
          <div>
            {unscheduled.map((item) => (
              <button
                type="button"
                key={item.key}
                onClick={() => setSelected(item.key)}
              >
                <strong>{item.title}</strong>
                <span>
                  {item.pin_title} · {item.owner}
                </span>
                {item.planned_end ? (
                  <small>
                    Existing work deadline: {dateLabel(item.planned_end)}
                  </small>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {role !== "client" && data.requests.length ? (
        <section className="bt-timeline-requests">
          <h2>
            Schedule change requests <span>{pending.length} pending</span>
          </h2>
          {visibleRequests.map((request) => (
            <article key={request.id}>
              <div>
                <strong>
                  {items.find((item) => item.key === request.work_key)?.title ??
                    "Work task"}
                </strong>
                <span className="bt-timeline-badge">{request.status}</span>
                <p>{request.reason}</p>
                <small>
                  Proposed: {dateLabel(request.proposal.planned_start)} →{" "}
                  {dateLabel(request.proposal.planned_end)}
                </small>
                {request.review_note ? (
                  <p>Review: {request.review_note}</p>
                ) : null}
              </div>
              {data.can_edit && request.status === "pending" ? (
                <div className="flex gap-2">
                  <button
                    className={buttonSecondary}
                    onClick={() => {
                      setReview({ request, approve: false })
                      setNote("")
                      setActionError("")
                    }}
                  >
                    Reject
                  </button>
                  <button
                    className={buttonPrimary}
                    onClick={() => {
                      setReview({ request, approve: true })
                      setNote("")
                      setActionError("")
                    }}
                  >
                    Review & approve
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      <footer className="bt-timeline-footer">
        Philippine dates · Task progress comes from linked daily reports;
        Engineer approval remains separate.{" "}
        {data.version
          ? `Publication history is retained in the project audit log (v${data.version}).`
          : "Publish a schedule to save its first baseline."}
      </footer>

      {opened && !editing ? (
        <Modal
          title={opened.title}
          description={`${opened.phase}${
            opened.location ? ` · ${opened.location}` : ""
          }`}
          onClose={() => setSelected(null)}
          footer={
            <>
              <button
                className={buttonSecondary}
                onClick={() => setSelected(null)}
              >
                Close
              </button>
              {opened.pin_id ? (
                <button
                  className={buttonSecondary}
                  onClick={() => openTask(opened)}
                >
                  Open task & blueprint
                </button>
              ) : null}
              {data.can_edit || (data.can_request && opened.kind === "work") ? (
                <button
                  className={buttonPrimary}
                  onClick={() => setEditing(opened)}
                >
                  {data.can_edit
                    ? opened.planned_start
                      ? "Edit schedule"
                      : "Schedule task"
                    : "Request date change"}
                </button>
              ) : null}
            </>
          }
        >
          <dl className="bt-timeline-facts">
            <div>
              <dt>Status</dt>
              <dd>{timelineStatus(opened, today)}</dd>
            </div>
            {role !== "client" && opened.owner ? (
              <div>
                <dt>Responsible</dt>
                <dd>
                  {opened.owner}
                  <small>Managed through the linked task.</small>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Planned</dt>
              <dd>
                {dateLabel(opened.planned_start)} →{" "}
                {dateLabel(opened.planned_end)}
                {opened.planned_start && opened.planned_end ? (
                  <small>
                    {timelineDays(opened.planned_start, opened.planned_end) + 1}{" "}
                    calendar days
                  </small>
                ) : null}
              </dd>
            </div>
            {role !== "client" ? (
              <>
                <div>
                  <dt>Actual dates</dt>
                  <dd>
                    {dateLabel(opened.actual_start)} →{" "}
                    {dateLabel(opened.actual_end)}
                  </dd>
                </div>
                <div>
                  <dt>Reported progress</dt>
                  <dd>
                    {opened.reported_percent == null
                      ? "No submitted task progress yet"
                      : `${opened.reported_percent}% · ${dateLabel(opened.report_date)}`}
                    {opened.reported_start ? (
                      <small>
                        First reported work: {dateLabel(opened.reported_start)}
                        {opened.reported_end
                          ? ` · Reported finish: ${dateLabel(opened.reported_end)}`
                          : ""}
                      </small>
                    ) : null}
                  </dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>Engineer verification</dt>
              <dd>
                {opened.kind === "milestone"
                  ? "Project checkpoint; no QA sign-off"
                  : opened.verified
                    ? "Verified"
                    : "Not verified"}
              </dd>
            </div>
            <div>
              <dt>Predecessors</dt>
              <dd>
                {opened.predecessors.length
                  ? opened.predecessors.map((key) => (
                      <button
                        type="button"
                        key={key}
                        className="block text-brand-text underline"
                        onClick={() => setSelected(key)}
                      >
                        {items.find((item) => item.key === key)?.title ??
                          "Linked task"}
                      </button>
                    ))
                  : "None"}
              </dd>
            </div>
          </dl>
          {opened.pin_id && role !== "client" ? (
            <button
              type="button"
              className={`${buttonSecondary} mt-4`}
              onClick={() => openTask(opened, "reports")}
            >
              {role === "foreman"
                ? "Open task reports & evidence"
                : "Open linked daily reports"}
            </button>
          ) : null}
        </Modal>
      ) : null}
      {editing ? (
        <ScheduleForm
          key={editing.key}
          item={editing}
          items={items}
          requesting={!data.can_edit}
          onClose={() => setEditing(null)}
          onSave={async (plan, reason) => {
            const { error: failure } = await supabase.rpc(
              data.can_edit ? "save_timeline_item" : "request_timeline_change",
              {
                p_project: projectId,
                p_key: editing.key,
                p_plan: plan,
                p_expected: editing.revision ?? 0,
                p_reason: reason,
              },
            )
            if (failure) return failure.message
            setEditing(null)
            setSelected(null)
            await reload()
            toast.success(
              data.can_edit ? "Schedule saved" : "Schedule change requested",
            )
            return null
          }}
        />
      ) : null}
      {review?.approve && items.some(item => item.key === review.request.work_key) ? <ScheduleForm
        key={`approve:${review.request.id}`}
        item={{ ...items.find(item => item.key === review.request.work_key)!, ...review.request.proposal, revision: review.request.expected_revision }}
        items={items} requesting={false} approval proposalReason={review.request.reason} onClose={() => setReview(null)} onManageAssignment={() => followLink(`/pm/team?project=${encodeURIComponent(projectId)}`, projectId)}
        onSave={async (plan, reason) => {
          const { error: failure } = await supabase.rpc("decide_timeline_request", { p_request: review.request.id, p_approve: true, p_plan: plan, p_note: reason })
          if (failure) return failure.message
          setReview(null); await reload(); toast.success("Schedule approved", "Pin, task, Calendar and Gantt dates have been synchronized. Publish to share the new baseline with Clients."); return null
        }}
      /> : null}
      {publish || review && !review.approve ? (
        <Modal
          title={
            publish
              ? "Publish schedule & save baseline"
              : review?.approve
                ? "Approve schedule change"
                : "Reject schedule change"
          }
          onClose={() => {
            if (!busy) {
              setPublish(false)
              setReview(null)
            }
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void (async () => {
                const success = publish
                  ? await runAction("publish_project_timeline", {
                      p_project: projectId,
                      p_reason: note.trim(),
                    })
                  : await runAction("review_timeline_change", {
                      p_request: review!.request.id,
                      p_approve: review!.approve,
                      p_note: note.trim(),
                    })
                if (success) {
                  setPublish(false)
                  setReview(null)
                  toast.success(
                    publish
                      ? "Schedule published"
                      : "Schedule request reviewed",
                  )
                }
              })()
            }}
          >
            {publish ? (
              <p className="text-sm text-fg-muted">
                Save the currently scheduled tasks and milestones as version{" "}
                {data.version + 1}. Clients will see this publication, and
                earlier baselines remain in the publication history. Unscheduled
                tasks are excluded.
              </p>
            ) : (
              <>
                <p className="text-sm">{review?.request.reason}</p>
                <dl className="bt-timeline-facts">
                  {[
                    ["Phase", review?.request.proposal.phase],
                    [
                      "Planned start",
                      dateLabel(review?.request.proposal.planned_start),
                    ],
                    [
                      "Planned finish",
                      dateLabel(review?.request.proposal.planned_end),
                    ],
                    [
                      "Actual start",
                      dateLabel(review?.request.proposal.actual_start),
                    ],
                    [
                      "Actual finish",
                      dateLabel(review?.request.proposal.actual_end),
                    ],
                    [
                      "Predecessors",
                      review?.request.proposal.predecessors
                        .map(
                          (key) =>
                            items.find((item) => item.key === key)?.title ??
                            "Unavailable task",
                        )
                        .join(", ") || "None",
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-fg-muted">
                  Approval updates the working schedule. Publish afterward to
                  share the changes with Clients. QA verification is unchanged.
                </p>
              </>
            )}
            <label className="block text-sm font-semibold">
              {publish ? "Publication reason" : "Review note"}
              <textarea
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            {actionError ? (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft p-3 text-sm text-danger-fg"
              >
                {actionError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={buttonSecondary}
                disabled={busy}
                onClick={() => {
                  setPublish(false)
                  setReview(null)
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={buttonPrimary}
                disabled={busy || note.trim().length < 5}
              >
                {busy
                  ? "Saving..."
                  : publish
                    ? "Publish schedule"
                    : review?.approve
                      ? "Approve change"
                      : "Reject change"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  )
}
