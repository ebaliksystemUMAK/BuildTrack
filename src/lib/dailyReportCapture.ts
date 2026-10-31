import { supabase } from "./supabase"
import { issuePhotoProblem, markupProblem, type IssueMarkup } from "./issueMarkup"
import { stampFields, type CaptureSource, type PhotoStamp } from "./photoStamp"

// source: in-app camera, or a file chosen from the device (only while the Super Admin allows photo uploads; checked by the database).
export type ReportCapture = { id: string; file: File; url: string; caption: string; annotations: IssueMarkup[]; stamp: PhotoStamp; source: CaptureSource }

// Retry uses the same path so a lost response cannot attach the same capture twice.
export async function saveDailyReportCapture(projectId: string, reportId: string, capture: ReportCapture) {
  const problem = issuePhotoProblem(capture.file) || markupProblem(capture.annotations)
  if (problem) throw new Error(problem)
  const path = `${projectId}/${reportId}/${capture.id}.jpg`
  const existing = await supabase.from("daily_report_photos").select("id").eq("path", path).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) return
  const uploaded = await supabase.storage.from("daily-photos").upload(path, capture.file, { contentType: "image/jpeg", upsert: false })
  if (uploaded.error && !/already exists|duplicate|resource exists/i.test(uploaded.error.message)) throw uploaded.error
  const inserted = await supabase.from("daily_report_photos").insert({ project_id: projectId, report_id: reportId, path,
    caption: capture.caption.trim() || null, annotations: capture.annotations, capture_source: capture.source, ...stampFields(capture.stamp) })
  if (!inserted.error) return
  const check = await supabase.from("daily_report_photos").select("id").eq("path", path).maybeSingle()
  if (check.data) return
  if (!check.error) await supabase.storage.from("daily-photos").remove([path])
  throw inserted.error
}
