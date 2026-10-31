import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import type { Pin } from "../lib/blueprints"
import { sCurve, type SCurvePoint } from "../lib/progress"

// Planned vs verified progress over time (the construction "S-curve"). Planned comes from the due dates on the pins, verified from
// the engineer's verifications, so the chart is the same data as the queue, the dashboard and the client portal.
// Colours validated for colour-blind separation in light and dark (dataviz validator): planned blue (dashed), verified magenta.

const H = 240
const PAD = { top: 16, right: 16, bottom: 30, left: 40 }
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })

export default function SCurveChart({ pins, start, end, today, compact = false }: { pins: Pick<Pin, "category" | "status" | "due_date" | "verified_at" | "tasks">[]; start: string | null; end: string | null; today: string; compact?: boolean }) {
  const data = useMemo(() => sCurve(pins, start, end, today, compact ? 24 : 40), [pins, start, end, today, compact])
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  if (!data) return <p className="text-sm text-fg-muted">No tasks yet. Add tasks inside the work pins to track approved progress.</p>

  const { points, todayIndex, total, undated } = data
  const innerW = width - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (value: number) => PAD.top + innerH - (value / 100) * innerH
  const line = (pick: (point: SCurvePoint) => number | null) =>
    points.map((point, i) => ({ v: pick(point), i })).filter((p): p is { v: number; i: number } => p.v !== null).map((p, n) => `${n ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")
  const plannedPath = line((point) => point.planned)
  const verifiedPath = line((point) => point.verified)
  const lastVerified = points.map((point, i) => ({ point, i })).filter((p) => p.point.verified !== null).pop()
  const area = lastVerified ? `${verifiedPath} L${x(lastVerified.i).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : ""
  const last = points.length - 1
  // Fewer date labels on a phone so they never collide.
  const ticks = Array.from(new Set(width < 480 ? [0, Math.round(last / 2), last] : [0, Math.round(last / 4), Math.round(last / 2), Math.round((last * 3) / 4), last]))
  const now = points[todayIndex]
  const gap = now.verified === null ? null : Math.round((now.verified - now.planned) * 10) / 10
  const shown = hover ?? null

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * width
    const ratio = (px - PAD.left) / innerW
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))))
  }
  const keys = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setHover((current) => Math.max(0, Math.min(points.length - 1, (current ?? todayIndex) + (event.key === "ArrowRight" ? 1 : -1))))
  }

  return (
    <div className="bt-scurve space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-sm text-fg">
          Today: <strong className="tabular-nums">{now.verified ?? 0}%</strong> verified against <strong className="tabular-nums">{now.planned}%</strong> planned
          {gap === null ? null : gap >= 0 ? <span className="text-fg-muted"> · on or ahead of plan</span> : <span className="font-semibold text-danger-fg"> · {Math.abs(gap)} points behind plan</span>}
        </p>
        <ul className="flex gap-4 text-xs text-fg-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5"><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" className="bt-sc-plan" strokeWidth="2" strokeDasharray="4 3" /></svg>Planned (due dates)</li>
          <li className="flex items-center gap-1.5"><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" className="bt-sc-done" strokeWidth="2" /></svg>Verified by the engineer</li>
        </ul>
      </div>

      <div ref={box} className="relative">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`S-curve: ${now.verified ?? 0}% verified against ${now.planned}% planned today. Use the left and right arrow keys to read other dates; a table follows.`}
          className="block max-w-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand"
          onPointerMove={pick}
          onPointerLeave={() => setHover(null)}
          onKeyDown={keys}
          onBlur={() => setHover(null)}
        >
          {[0, 25, 50, 75, 100].map((value) => (
            <g key={value}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} className="bt-sc-grid" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end" className="bt-sc-axis">{value}%</text>
            </g>
          ))}
          {ticks.map((i) => <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} className="bt-sc-axis">{shortDate(points[i].date)}</text>)}
          <line x1={x(todayIndex)} x2={x(todayIndex)} y1={PAD.top} y2={PAD.top + innerH} className="bt-sc-today" strokeWidth="1" />
          <text x={x(todayIndex) + 4} y={PAD.top + 10} className="bt-sc-axis">Today</text>
          {area ? <path d={area} className="bt-sc-done-fill" /> : null}
          <path d={plannedPath} fill="none" className="bt-sc-plan" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
          {verifiedPath ? <path d={verifiedPath} fill="none" className="bt-sc-done" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {lastVerified ? <circle cx={x(lastVerified.i)} cy={y(lastVerified.point.verified as number)} r="4.5" className="bt-sc-dot" strokeWidth="2" /> : null}
          {shown !== null ? (
            <g pointerEvents="none">
              <line x1={x(shown)} x2={x(shown)} y1={PAD.top} y2={PAD.top + innerH} className="bt-sc-cross" strokeWidth="1" />
              <circle cx={x(shown)} cy={y(points[shown].planned)} r="4" className="bt-sc-plan-dot" strokeWidth="2" />
              {points[shown].verified !== null ? <circle cx={x(shown)} cy={y(points[shown].verified as number)} r="4" className="bt-sc-dot" strokeWidth="2" /> : null}
            </g>
          ) : null}
        </svg>
        {shown !== null ? (
          <div className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ left: Math.min(Math.max(x(shown) + 12, 0), width - 170) }} role="status">
            <p className="font-bold text-fg">{longDate(points[shown].date)}</p>
            <p className="mt-1 flex items-center gap-2"><svg width="14" height="4" aria-hidden="true"><line x1="0" y1="2" x2="14" y2="2" className="bt-sc-plan" strokeWidth="2" strokeDasharray="4 3" /></svg><strong className="tabular-nums text-fg">{points[shown].planned}%</strong><span className="text-fg-muted">planned</span></p>
            <p className="flex items-center gap-2"><svg width="14" height="4" aria-hidden="true"><line x1="0" y1="2" x2="14" y2="2" className="bt-sc-done" strokeWidth="2" /></svg><strong className="tabular-nums text-fg">{points[shown].verified === null ? "-" : `${points[shown].verified}%`}</strong><span className="text-fg-muted">{points[shown].verified === null ? "not reached yet" : "verified"}</span></p>
          </div>
        ) : null}
      </div>

      <p className="text-xs text-fg-muted">
        {total} task{total === 1 ? "" : "s"}.{undated ? ` ${undated} ha${undated === 1 ? "s" : "ve"} no due date yet, so ${undated === 1 ? "it is" : "they are"} not in the planned line. Set due dates on the pins to complete the plan.` : ""}
      </p>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-bold text-fg-muted hover:text-fg">Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surface-muted"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Planned</th><th className="px-3 py-2 text-right">Verified</th></tr></thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date} className={`border-t border-line ${point.date === today ? "font-bold" : ""}`}>
                  <td className="px-3 py-1.5">{longDate(point.date)}{point.date === today ? " (today)" : ""}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{point.planned}%</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{point.verified === null ? "-" : `${point.verified}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
