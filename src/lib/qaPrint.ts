import { reportHtml } from "./printReport.ts"
import { categoryLabels, defectStatusLabels, dueText, inspectionStatusLabels, qaSeverityLabels, refNumber, toleranceText, tradeLabels } from "./qaModel.ts"
import type { Defect, DefectEvent, Inspection, InspectionItem, QaSummary } from "./qa"
import { allDates, isFiltered, rangeText, type DateRange } from "./dateRangeModel.ts"

// Printable QA documents. Every value goes through reportHtml, which escapes it.
type Person = (id: string | null) => string
type Project = { name: string; code: string; location?: string | null }

const subtitle = (project: Project) => `${project.name} (${project.code})${project.location ? " - " + project.location : ""}`
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-")
const resultText = { pending: "Pending", pass: "Pass", fail: "FAIL", na: "N/A" } as const

export function inspectionReportHtml(input: { inspection: Inspection; items: InspectionItem[]; defects: Defect[]; project: Project; nameOf: Person }): string {
  const { inspection: ir, items, defects, project, nameOf } = input
  return reportHtml({
    title: `Inspection report ${refNumber("ir", ir.number)}`,
    subtitle: subtitle(project),
    meta: [
      ["Result", inspectionStatusLabels[ir.status]],
      ["Score", ir.score === null ? "-" : `${ir.score}% (pass mark ${ir.threshold ?? "-"}%)`],
      ["Scope", ir.full_checklist_reinspection ? "Full QC checklist reinspection, including previously passed checks. All results belong to this inspection; earlier results/evidence remain unchanged. This is not whole-project acceptance." : "Full scope recorded in this inspection"],
      ["Trade", tradeLabels[ir.trade]],
      ["Completed", stamp(ir.completed_at)],
    ],
    sections: [
      {
        heading: "Inspection",
        rows: [
          ["Title", ir.title],
          ["Location", ir.location ?? "-"],
          ["Requested by", `${nameOf(ir.requested_by)} on ${stamp(ir.requested_at)}`],
          ["Inspector", nameOf(ir.inspector_id)],
          ["Started", stamp(ir.started_at)],
          ["Standards cited", ir.standards.length ? ir.standards.join(", ") : "-"],
          ["Re-inspection of", ir.reinspection_of ? "an earlier inspection (linked history retained)" : "-"],
        ],
      },
      { heading: "Engineer's summary", body: ir.summary ?? "No summary written." },
      {
        heading: "QC Checklist",
        table: {
          head: ["No.", "Item", "Class", "Hold", "Requirement", "Result", "Measured", "Remarks"],
          rows: items.map((item) => [
            String(item.position + 1),
            [item.text, item.reference ? `Reference: ${item.reference}` : "", item.acceptance_criteria ? `Acceptance criteria: ${item.acceptance_criteria}` : "", item.evidence_requirement ? `Evidence / test: ${item.evidence_requirement}` : ""].filter(Boolean).join("\n"),
            qaSeverityLabels[item.severity],
            item.hold_point ? "Yes" : "",
            item.kind === "measure" ? toleranceText(item) : "",
            resultText[item.result],
            item.measured_value === null ? "" : `${item.measured_value}${item.unit ? " " + item.unit : ""}`,
            item.remarks ?? "",
          ]),
        },
      },
      defects.length
        ? { heading: "Non-conformances raised", table: { head: ["NCR", "Defect", "Class", "Due", "Status"], rows: defects.map((defect) => [refNumber("ncr", defect.number), defect.title, qaSeverityLabels[defect.severity], defect.due_date ?? "-", defectStatusLabels[defect.status]]) } }
        : { heading: "Non-conformances raised", body: "None." },
      { heading: "Sign-off", rows: [["Inspected by", `${nameOf(ir.inspector_id)}   Signature: ____________________   Date: ____________`], ["Contractor's representative", "Signature: ____________________   Date: ____________"]] },
    ],
  })
}

export function defectReportHtml(input: { defect: Defect; events: DefectEvent[]; project: Project; nameOf: Person; today: string }): string {
  const { defect, events, project, nameOf, today } = input
  return reportHtml({
    title: `Non-conformance report ${refNumber("ncr", defect.number)}`,
    subtitle: subtitle(project),
    meta: [
      ["Status", defectStatusLabels[defect.status]],
      ["Class", qaSeverityLabels[defect.severity]],
      ["Due", defect.due_date ?? "-"],
      ["State", dueText(defect, today)],
    ],
    sections: [
      {
        heading: "Non-conformance",
        rows: [
          ["Title", defect.title],
          ["Category", categoryLabels[defect.category]],
          ["Trade", tradeLabels[defect.trade]],
          ["Standard / clause", defect.reference ?? "-"],
          ["Raised by", `${nameOf(defect.raised_by)} on ${stamp(defect.raised_at)}`],
          ["Responsible", nameOf(defect.assigned_to)],
        ],
      },
      { heading: "Description", body: defect.description ?? "No description." },
      {
        heading: "Corrective and preventive action",
        rows: [
          ["Root cause", defect.root_cause ?? "-"],
          ["Corrective action", defect.corrective_action ?? "-"],
          ["Preventive action", defect.preventive_action ?? "-"],
          ["Sent for verification", defect.fixed_at ? `${stamp(defect.fixed_at)} by ${nameOf(defect.fixed_by)}` : "-"],
        ],
      },
      { heading: "Verification and closure", rows: [["Closed", defect.closed_at ? `${stamp(defect.closed_at)} by ${nameOf(defect.closed_by)}` : "Not closed"], ["Engineer's note", defect.closing_note ?? "-"]] },
      { heading: "History", table: { head: ["When", "Who", "What", "Note"], rows: events.map((event) => [stamp(event.created_at), nameOf(event.actor_id), event.kind === "status" ? `${event.from_status} to ${event.to_status}` : event.kind, event.note ?? ""]) } },
      { heading: "Sign-off", rows: [["Engineer", "Signature: ____________________   Date: ____________"], ["Contractor's representative", "Signature: ____________________   Date: ____________"]] },
    ],
  })
}

export function qaSummaryHtml(input: { summary: QaSummary; defects: Defect[]; project: Project; nameOf: Person; today: string; asOf: string; dates?: DateRange }): string {
  const { summary: s, defects, project, nameOf, today, asOf } = input
  const open = defects.filter((defect) => defect.status !== "closed")
  const pct = (value: number | null) => (value === null ? "-" : `${value}%`)
  return reportHtml({
    title: "Quality assurance summary",
    subtitle: subtitle(project),
    meta: [
      ["As of", asOf],
      ...(isFiltered(input.dates ?? allDates) ? [["Period (Manila)", rangeText(input.dates!)], ["Scope", "Current status of inspections requested and NCRs raised in the period; not a historical snapshot."]] as Array<[string, string]> : []),
      ["First-time pass rate", pct(s.inspections.first_pass_rate)],
      ["Open NCRs", String(s.defects.open)],
      ["Overdue NCRs", String(s.defects.overdue)],
    ],
    sections: [
      {
        heading: "Inspections",
        rows: [
          ["Completed", String(s.inspections.passed + s.inspections.conditional + s.inspections.failed)],
          ["Passed / conditional / failed", `${s.inspections.passed} / ${s.inspections.conditional} / ${s.inspections.failed}`],
          ["Waiting / in progress", `${s.inspections.requested} / ${s.inspections.in_progress}`],
          ["Average score", pct(s.inspections.average_score)],
          ["Defects per 100 items checked", s.items.defects_per_100_items === null ? "-" : String(s.items.defects_per_100_items)],
        ],
      },
      {
        heading: "Non-conformances",
        rows: [
          ["Open (critical / major / minor)", `${s.defects.open} (${s.defects.critical_open} / ${s.defects.major_open} / ${s.defects.minor_open})`],
          ["Waiting for verification", String(s.defects.for_verification)],
          ["Closed", String(s.defects.closed)],
          ["Average days to close", s.defects.average_days_to_close === null ? "-" : String(s.defects.average_days_to_close)],
        ],
      },
      { heading: "By trade", table: s.by_trade.length ? { head: ["Trade", "Inspections", "Pass rate", "Open NCRs"], rows: s.by_trade.map((row) => [tradeLabels[row.trade], String(row.inspections), pct(row.pass_rate), String(row.open_defects)]) } : undefined, body: s.by_trade.length ? undefined : "No inspections yet." },
      { heading: "Open non-conformances", table: open.length ? { head: ["NCR", "Defect", "Class", "Trade", "Responsible", "Status", "Due"], rows: open.map((defect) => [refNumber("ncr", defect.number), defect.title, qaSeverityLabels[defect.severity], tradeLabels[defect.trade], nameOf(defect.assigned_to), defectStatusLabels[defect.status], dueText(defect, today)]) } : undefined, body: open.length ? undefined : "Nothing is open." },
    ],
  })
}
