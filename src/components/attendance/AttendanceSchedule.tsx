import { useEffect, useState, type FormEvent } from "react"
import { supabase } from "../../lib/supabase"
import { errorText, useToast } from "../../lib/toast"
import { SkeletonText } from "../ui/Skeleton"
import {
  defaultScheduleDraft,
  scheduleDraft,
  scheduleProblem,
  scheduleSummary,
  weekdayNames,
  type AttendanceSchedule as Schedule,
  type ScheduleDraft,
} from "../../lib/attendanceScheduleModel"

const field = "mt-1 block min-h-11 w-full rounded-xl border border-line bg-surface px-3 !text-sm !font-normal text-fg"
const label = "block text-sm font-bold text-fg"

// Admin: the project's working hours. The database uses them to flag late arrivals / early clock-outs and the repeat
// window to ignore double scans. Saved only through set_attendance_schedule (biometrics.manage + MFA, audited).
export default function AttendanceSchedule({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [saved, setSaved] = useState<Schedule | null>(null)
  const [draft, setDraft] = useState<ScheduleDraft>(defaultScheduleDraft)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    void supabase
      .from("attendance_schedules")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!current) return
        if (error) {
          setLoadError("The attendance schedule could not be loaded. If this keeps happening, the database update for schedules has not been applied yet.")
        } else {
          setLoadError("")
          setSaved((data as Schedule | null) ?? null)
          setDraft(scheduleDraft((data as Schedule | null) ?? null))
        }
        setLoading(false)
      })
    return () => {
      current = false
    }
  }, [projectId, version])

  const problem = scheduleProblem(draft)
  const changed = JSON.stringify(draft) !== JSON.stringify(scheduleDraft(saved))
  const set = (key: Exclude<keyof ScheduleDraft, "workDays">) => (value: string) => setDraft((old) => ({ ...old, [key]: value }))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || problem) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc("set_attendance_schedule", {
        p_project: projectId,
        p_time_in: draft.timeIn,
        p_time_out: draft.timeOut,
        p_grace: Number(draft.grace),
        p_repeat: Number(draft.repeat),
        p_work_days: draft.workDays,
      })
      if (error) throw new Error(error.message || "The schedule could not be saved.")
      toast.success("Attendance schedule saved", scheduleSummary(draft))
      setVersion((value) => value + 1)
    } catch (problem) {
      toast.error("Schedule not saved", errorText(problem))
    } finally {
      setBusy(false)
    }
  }

  if (loading)
    return (
      <section aria-label="Attendance schedule" aria-busy="true" className="rounded-2xl border border-line bg-surface p-5">
        <SkeletonText lines={4} />
      </section>
    )

  return (
    <section aria-label="Attendance schedule" className="space-y-5 rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-lg font-extrabold text-fg">Attendance schedule</h2>
        <p className="text-sm text-fg-muted">
          {saved ? `Current: ${scheduleSummary(saved)}.` : "No schedule set yet: scans are recorded but not marked late or early."}
        </p>
        {saved?.updated_at ? (
          <p className="text-xs text-fg-muted">Last changed {new Date(saved.updated_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Philippine time)</p>
        ) : null}
      </div>
      {loadError ? (
        <div role="alert" className="space-y-2 rounded-xl border border-danger-fg/40 bg-danger-soft p-3 text-sm text-danger-fg">
          <p>{loadError}</p>
          <button type="button" className="font-bold underline" onClick={() => setVersion((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => void save(event)} noValidate>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className={label}>
              Time in
              <input type="time" required className={field} value={draft.timeIn} onChange={(event) => set("timeIn")(event.target.value)} />
            </label>
            <label className={label}>
              Time out
              <input type="time" required className={field} value={draft.timeOut} onChange={(event) => set("timeOut")(event.target.value)} />
            </label>
            <label className={label}>
              Grace period (minutes)
              <input type="number" inputMode="numeric" min={0} max={120} step={1} className={field} value={draft.grace} onChange={(event) => set("grace")(event.target.value)} aria-describedby="schedule-grace-help" />
              <span id="schedule-grace-help" className="mt-1 block text-xs font-normal text-fg-muted">A time in after this many minutes counts as late.</span>
            </label>
            <label className={label}>
              Ignore repeat scans within (minutes)
              <input type="number" inputMode="numeric" min={1} max={120} step={1} className={field} value={draft.repeat} onChange={(event) => set("repeat")(event.target.value)} aria-describedby="schedule-repeat-help" />
              <span id="schedule-repeat-help" className="mt-1 block text-xs font-normal text-fg-muted">A second scan this soon after the last one is not recorded again.</span>
            </label>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-fg">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {weekdayNames.map((name, index) => {
                const day = index + 1
                const on = draft.workDays.includes(day)
                return (
                  <label key={name} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${on ? "border-brand bg-brand-soft text-fg" : "border-line bg-surface text-fg-muted"}`}>
                    <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => setDraft((old) => ({ ...old, workDays: on ? old.workDays.filter((d) => d !== day) : [...old.workDays, day].sort((a, b) => a - b) }))} />
                    {name}
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-fg-muted">Workers are marked Absent only on working days; other days are rest days.</p>
          </fieldset>
          {problem ? (
            <p role="alert" className="text-sm font-semibold text-danger-fg">{problem}</p>
          ) : (
            <p className="text-sm text-fg">{scheduleSummary(draft)}</p>
          )}
          <button type="submit" disabled={busy || Boolean(problem) || (!changed && Boolean(saved))} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-5 !text-sm !font-bold text-white disabled:opacity-50">
            {busy ? "Saving…" : saved ? "Save schedule" : "Set schedule"}
          </button>
        </form>
      )}
      <div className="rounded-xl border border-line bg-surface-muted/50 p-4 text-sm text-fg">
        <p className="font-bold">How scans are counted</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-muted">
          <li>One Time in and one Time out per worker per day (Philippine time): the first scan is Time in, the next scan after the repeat window is Time out. Any later scan shows "Already timed out" and is not recorded.</li>
          <li>A scan within the repeat window of the worker's last scan is ignored, so scanning twice never creates a second Time in or a wrong Time out. Use at least 10–15 minutes.</li>
          <li>A scan that arrives late from the scanner and is older than the worker's last scan is ignored rather than changing the order.</li>
          <li>Time in after the grace period is Late (minutes counted from time in); Time out before the scheduled time out is Early out (undertime).</li>
          <li>No Time in on a working day once the time out has passed is Absent. Before that it shows Not in yet. Workers without a registered fingerprint are never marked absent.</li>
          <li>Ignored scans are kept in the record for checking; they never count as attendance.</li>
        </ul>
      </div>
    </section>
  )
}
