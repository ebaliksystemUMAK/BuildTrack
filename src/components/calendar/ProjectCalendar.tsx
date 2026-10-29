import { useEffect, useMemo, useState, type ReactNode } from "react"
import AdminIcon from "../../pages/Admin/AdminIcon"
import Modal from "../Modal"
import { buttonPrimary, buttonSecondary } from "../ui/PageParts"
import { followLink } from "../../lib/notifications"
import { calendarAddDays, calendarDateLabel, calendarFilter, calendarKindsFor, calendarLabels, calendarMonthDays, calendarMoveMonth, calendarRange, calendarSearch, calendarTimeLabel, calendarViews, monthStart, readCalendar, type CalendarEvent, type CalendarKind, type CalendarRole, type CalendarView } from "../../lib/projectCalendarModel"
import "./projectCalendar.css"

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const viewNames: Record<CalendarView, string> = { month: "Month", week: "Week", day: "Day", schedule: "Schedule" }
const roleNotes: Record<CalendarRole, string> = {
  admin: "Project milestones and work deadlines for management. No inspection or NCR approval actions.",
  project_manager: "Work deadlines, inspection targets, reinspections, NCR deadlines and project milestones. Read-only: Engineers inspect and sign off.",
  engineer: "Project work, inspection targets, reinspections and NCR deadlines.",
  foreman: "Your assigned work and NCRs, inspections you requested or linked to your work, and project milestones.",
  client: "Planned work deadlines and project milestones. Internal QA, NCRs and private staff information are not included.",
}
function IconButton({ label, children, onClick, disabled }: { label: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="bt-cal-icon" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
}
function EventButton({ event, today, onOpen, compact = false }: { event: CalendarEvent; today: string; onOpen: (id: string) => void; compact?: boolean }) {
  const late = !event.completed && event.date < today && event.kind !== "milestone"
  return <button type="button" className={`bt-cal-event bt-cal-${event.kind}${event.completed ? " is-completed" : ""}${compact ? " is-compact" : ""}`} onClick={() => onOpen(event.id)} aria-label={`${event.title}, ${calendarDateLabel(event.date)}, ${calendarTimeLabel(event.at)}, ${event.status}${late ? ", overdue" : ""}`} title={`${event.title}\n${event.location}\n${calendarTimeLabel(event.at)} · ${event.status}${late ? " · Overdue" : ""}`}>
    <span className="bt-cal-dot" aria-hidden="true" />
    <span className="bt-cal-event-title">{event.at ? <span className="bt-cal-event-time">{calendarTimeLabel(event.at)} </span> : null}{event.title}</span>
    {event.completed ? <span className="bt-cal-event-state" aria-label="Completed">✓</span> : late ? <span className="bt-cal-event-state" aria-label="Overdue">!</span> : null}
  </button>
}

export default function ProjectCalendar({ role, projectId, projectName, projectCode, today, events, undated, loading, error, onReload }: {
  role: CalendarRole; projectId: string; projectName: string; projectCode: string; today: string; events: CalendarEvent[]; undated: number; loading: boolean; error: string; onReload: () => void
}) {
  const [selection, setSelection] = useState(() => readCalendar(window.location.search, today))
  const { date, view } = selection
  const [miniMonth, setMiniMonth] = useState(monthStart(date))
  const [sidebar, setSidebar] = useState(false)
  const allowedKinds = calendarKindsFor(role)
  const [kinds, setKinds] = useState<CalendarKind[]>(allowedKinds)
  const [query, setQuery] = useState("")
  const [completed, setCompleted] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  useEffect(() => {
    const changed = () => { const next = readCalendar(window.location.search, today); setSelection(next); setMiniMonth(monthStart(next.date)); setOpenId(null) }
    window.addEventListener("popstate", changed)
    return () => window.removeEventListener("popstate", changed)
  }, [today])
  const choose = (nextDate: string, nextView = view) => {
    const safe = nextDate < "1900-01-01" ? "1900-01-01" : nextDate > "2199-12-31" ? "2199-12-31" : nextDate
    setSelection({ date: safe, view: nextView }); setMiniMonth(monthStart(safe))
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${calendarSearch(window.location.search, safe, nextView)}${window.location.hash}`)
  }
  const move = (direction: number) => choose(view === "month" || view === "schedule" ? calendarMoveMonth(date, direction) : calendarAddDays(date, direction * (view === "week" ? 7 : 1)))
  const range = calendarRange(date, view)
  // No records are rendered behind loading/error states, including stale results during a project switch.
  const visible = useMemo(() => loading || error ? [] : calendarFilter(events, { ...range, kinds, query, completed }), [events, range.from, range.to, kinds, query, completed, loading, error])
  const byDay = useMemo(() => {
    const rows = new Map<string, CalendarEvent[]>()
    for (const event of visible) rows.set(event.date, [...(rows.get(event.date) ?? []), event])
    return rows
  }, [visible])
  const opened = !loading && !error ? events.find(event => event.id === openId) : null
  const monthDays = calendarMonthDays(date)
  const days = view === "week" ? Array.from({ length: 7 }, (_, index) => calendarAddDays(range.from, index)) : view === "day" ? [date] : monthDays
  const title = view === "day" ? calendarDateLabel(date) : view === "week" ? `${calendarDateLabel(range.from, { day: "numeric", month: "short" })} – ${calendarDateLabel(range.to, { day: "numeric", month: "short", year: "numeric" })}` : calendarDateLabel(date, { month: "long", year: "numeric" })
  const openDay = (day: string) => { choose(day, "day"); setSidebar(false) }
  const canShow = !loading && !error

  return <section className="bt-calendar" aria-label="Project calendar">
    <header className="bt-cal-toolbar">
      <div className="bt-cal-brand"><span className="bt-cal-brand-icon"><AdminIcon name="calendar" /></span><div><h1>Project calendar</h1><p>{projectCode} · {projectName}</p></div></div>
      <div className="bt-cal-controls">
        <button type="button" className="bt-cal-today" onClick={() => choose(today)}>Today</button>
        <IconButton label="Previous period" onClick={() => move(-1)} disabled={date <= "1900-01-01"}><span className="bt-cal-chevron previous"><AdminIcon name="chevron" /></span></IconButton>
        <IconButton label="Next period" onClick={() => move(1)} disabled={date >= "2199-12-31"}><span className="bt-cal-chevron next"><AdminIcon name="chevron" /></span></IconButton>
        <h2 aria-live="polite">{title}</h2>
      </div>
      <div className="bt-cal-actions">
        <label className="bt-cal-search"><AdminIcon name="search" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this calendar" aria-label="Search calendar events" /></label>
        <select aria-label="Calendar view" value={view} onChange={event => choose(date, event.target.value as CalendarView)}>{calendarViews.map(key => <option key={key} value={key}>{viewNames[key]}</option>)}</select>
        <button type="button" className="bt-cal-filter-toggle" aria-expanded={sidebar} aria-controls="calendar-filters" onClick={() => setSidebar(value => !value)}><AdminIcon name="menu" />Filters</button>
      </div>
    </header>
    <div className="bt-cal-body">
      <aside id="calendar-filters" className={`bt-cal-sidebar${sidebar ? " is-open" : ""}`} aria-label="Calendar filters">
        <div className="bt-cal-mini-head"><strong>{calendarDateLabel(miniMonth, { month: "long", year: "numeric" })}</strong><IconButton label="Previous mini calendar month" onClick={() => setMiniMonth(calendarMoveMonth(miniMonth, -1))} disabled={miniMonth <= "1900-01-01"}><span className="bt-cal-chevron previous"><AdminIcon name="chevron" /></span></IconButton><IconButton label="Next mini calendar month" onClick={() => setMiniMonth(calendarMoveMonth(miniMonth, 1))} disabled={miniMonth >= "2199-12-01"}><span className="bt-cal-chevron next"><AdminIcon name="chevron" /></span></IconButton></div>
        <div className="bt-cal-mini" aria-label="Choose a calendar date">
          {weekdays.map(day => <span key={day} className="bt-cal-mini-weekday" aria-hidden="true">{day[0]}</span>)}
          {calendarMonthDays(miniMonth).map(day => <button key={day} type="button" className={`${day.slice(0, 7) !== miniMonth.slice(0, 7) ? "is-outside " : ""}${day === today ? "is-today " : ""}${day === date ? "is-selected" : ""}`} aria-label={`Go to ${calendarDateLabel(day)}`} aria-current={day === today ? "date" : undefined} aria-pressed={day === date} onClick={() => { choose(day); setSidebar(false) }}>{Number(day.slice(8))}</button>)}
        </div>
        <fieldset className="bt-cal-types"><legend>Project calendars</legend>{allowedKinds.map(kind => <label key={kind} className={`bt-cal-type bt-cal-${kind}`}><input type="checkbox" checked={kinds.includes(kind)} onChange={event => setKinds(current => event.target.checked ? [...current, kind] : current.filter(value => value !== kind))} /><span className="bt-cal-dot" aria-hidden="true" />{calendarLabels[kind]}</label>)}</fieldset>
        <label className="bt-cal-completed"><input type="checkbox" checked={completed} onChange={event => setCompleted(event.target.checked)} />Show completed records</label>
        <div className="bt-cal-info"><strong>Your project view</strong><p>{roleNotes[role]}</p><p>Philippine time · UTC+8</p><p>Dates come from existing records. Edit the original record to update its schedule.</p></div>
      </aside>
      <div className="bt-cal-main">
        {loading ? <div className="bt-cal-message" role="status"><AdminIcon name="calendar" /><h3>Loading project schedules…</h3></div> : error ? <div className="bt-cal-message" role="alert"><h3>Schedules could not be loaded</h3><p>{error}</p><button type="button" className={buttonSecondary} onClick={onReload}>Retry</button></div> : <>
          <div className="bt-cal-summary" aria-live="polite"><span>{visible.length} {visible.length === 1 ? "event" : "events"} shown · {view === "month" ? "6-week month view" : viewNames[view]}{query ? ` · Matching “${query}”` : ""}</span><span>{undated ? `${undated} ${undated === 1 ? "record has" : "records have"} no scheduled date` : "Schedules from project records"}</span></div>
          {view === "month" || view === "week" ? <div className="bt-cal-grid-scroll"><div className={`bt-cal-grid ${view === "week" ? "is-week" : ""}`} role="table" aria-label={`${title} calendar`}>
            <div className="bt-cal-weekdays" role="row">{weekdays.map(day => <div key={day} role="columnheader">{day}</div>)}</div>
            {Array.from({ length: view === "month" ? 6 : 1 }, (_, week) => <div className="bt-cal-week" role="row" key={week}>{days.slice(week * 7, week * 7 + 7).map(day => {
              const entries = byDay.get(day) ?? [], outside = view === "month" && day.slice(0, 7) !== date.slice(0, 7)
              return <div role="cell" key={day} className={`bt-cal-day${outside ? " is-outside" : ""}${day === today ? " is-today" : ""}${day === date ? " is-selected" : ""}`}>
                <button type="button" className="bt-cal-date" onClick={() => openDay(day)} aria-label={`Show ${calendarDateLabel(day)}`} aria-current={day === today ? "date" : undefined}>{view === "week" || day.endsWith("-01") ? <span>{calendarDateLabel(day, { month: "short" })} </span> : null}{Number(day.slice(8))}</button>
                <div className="bt-cal-day-events">{(view === "month" ? entries.slice(0, 3) : entries).map(event => <EventButton key={event.id} event={event} today={today} onOpen={setOpenId} compact />)}{view === "month" && entries.length > 3 ? <button type="button" className="bt-cal-more" onClick={() => openDay(day)} aria-label={`Show all ${entries.length} events on ${calendarDateLabel(day)}`}>+{entries.length - 3} more</button> : null}</div>
              </div>
            })}</div>)}
          </div></div> : <div className="bt-cal-agenda" aria-label={`${viewNames[view]} events`}>
            {visible.length ? [...byDay].map(([day, entries]) => <section key={day} className="bt-cal-agenda-day"><button type="button" className={`bt-cal-agenda-date${day === today ? " is-today" : ""}`} onClick={() => openDay(day)}><strong>{Number(day.slice(8))}</strong><span>{calendarDateLabel(day, { weekday: "short", month: "short" })}</span></button><div>{entries.map(event => <div className="bt-cal-agenda-event" key={event.id}><span>{calendarTimeLabel(event.at)}</span><EventButton event={event} today={today} onOpen={setOpenId} /><span className="bt-cal-agenda-status">{event.status}</span></div>)}</div></section>) : <div className="bt-cal-message"><AdminIcon name="calendar" /><h3>No events in this period</h3><p>Try another date, show completed records, or change your search and calendar filters.</p></div>}
          </div>}
          {!visible.length && (view === "month" || view === "week") ? <p className="bt-cal-empty-note" role="status">No matching events in this period. The calendar is ready for scheduled project records.</p> : null}
        </>}
      </div>
    </div>
    <footer className="bt-cal-footer"><span className="bt-cal-live-dot" aria-hidden="true" />Project schedules · {canShow ? "Read-only calendar; live project records" : "Connecting to project records"}<span>BuildTrack calendar · Not connected to Google Calendar</span></footer>
    {opened ? <Modal title={opened.title} description={calendarLabels[opened.kind]} onClose={() => setOpenId(null)} footer={<><button type="button" className={buttonSecondary} onClick={() => setOpenId(null)}>Close</button>{opened.recordHref ? <button type="button" className={buttonPrimary} onClick={() => followLink(opened.recordHref!, projectId)}>{opened.kind === "work" ? "Open work pin" : "Open record"}</button> : null}{opened.pinHref && opened.pinHref !== opened.recordHref ? <button type="button" className={buttonSecondary} onClick={() => followLink(opened.pinHref!, projectId)}>Open on blueprint</button> : null}</>}>
      <dl className="bt-cal-facts"><div><dt>When</dt><dd>{calendarDateLabel(opened.date)} · {calendarTimeLabel(opened.at)}{opened.at ? " PHT" : ""}</dd></div><div><dt>Project</dt><dd>{projectCode} · {projectName}</dd></div><div><dt>Location</dt><dd>{opened.location}</dd></div>{opened.owner ? <div><dt>Responsible</dt><dd>{opened.owner}</dd></div> : null}<div><dt>Status</dt><dd>{opened.status}{!opened.completed && opened.date < today && opened.kind !== "milestone" ? " · Overdue" : ""}</dd></div></dl><p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm text-fg-muted">{opened.note}</p>
    </Modal> : null}
  </section>
}
