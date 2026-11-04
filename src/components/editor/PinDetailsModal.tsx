import { useState } from "react"
import { taskProgress } from "../../lib/taskProgress"
import Modal from "../Modal"
import { PinDetailSections, PinSectionBody, Tabs, type InspectorProps } from "./Inspector"
import { usePinPanelData } from "./PinRecordSections"
import { statusChip, statusDot, statusLabels, type Pin } from "../../lib/blueprints"
import { clientPinStatus } from "../../lib/clientPortalModel"
import { pinSectionsFor, sectionLabel, type PinSection } from "../../lib/pinRecordsModel"

const prettyDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-PH", { day: "numeric", month: "short", year: "numeric" })

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0 rounded-xl border border-line bg-surface px-3 py-2"><dt className="text-[11px] font-bold uppercase tracking-wider text-fg-muted">{label}</dt><dd className="mt-0.5 break-words text-sm font-semibold">{children}</dd></div>
}

// The roomy view of one pin: the same sections as the panel beside the sheet, with records in detailed columns, every field,
// large photos and the timeline. Opens on the section the panel was showing.
export default function PinDetailsModal({ pin, inspector, section = "details", onClose, onDelete }: { pin: Pin; inspector: InspectorProps; section?: PinSection; onClose: () => void; onDelete: () => void }) {
  const [refresh, setRefresh] = useState(0)
  const data = usePinPanelData(pin, inspector.role)
  const sections = pinSectionsFor(inspector.role)
  const [tab, setTab] = useState<PinSection>(sections.includes(section) ? section : "details")
  const changed = () => {
    inspector.onPinChanged()
    setRefresh((value) => value + 1)
    void data.reload()
  }
  const nameOf = (id: string | null) => (id ? inspector.team.find((member) => member.user_id === id)?.full_name ?? "Someone on the team" : "Not assigned yet")
  const { approved: done, percent: progress } = taskProgress(data.checklist.items)
  const status = clientPinStatus(pin.status)
  const openNcrs = data.records.defects.filter((row) => row.status !== "closed").length
  return (
    <Modal
      title={`${inspector.numberOf(pin)}. ${pin.title}`}
      description={`Pin on ${inspector.blueprint?.title ?? "the sheet"}`}
      size="2xl"
      onClose={onClose}
      footer={
        <>
          {inspector.canEdit ? <button type="button" onClick={onDelete} className="mr-auto rounded-lg border border-line px-4 py-2 text-sm font-semibold text-danger-fg hover:bg-danger-soft">Delete pin</button> : null}
          <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover">Done</button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: statusDot[status] }}>{inspector.numberOf(pin)}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusChip[status]}`}>{statusLabels[status]}</span>
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Fact label="Assigned Foreman">{nameOf(pin.assigned_to)}</Fact>
        <Fact label="Approved schedule">{pin.planned_start ? prettyDate(pin.planned_start) : "Start not approved"} → {pin.due_date ? prettyDate(pin.due_date) : "No deadline"}</Fact>
        <Fact label="Pin progress">{data.checklist.items.length ? `${progress}% · ${done}/${data.checklist.items.length} tasks approved` : "No tasks yet"}</Fact>
        <Fact label={inspector.role === "client" ? "Your open reports" : "Open NCRs"}>{inspector.role === "client" ? data.counts.issues ?? 0 : openNcrs}</Fact>
      </dl>
      <div className="sticky -top-5 z-10 -mx-6 mb-4 bg-surface">
        <Tabs tabs={sections.map((key) => ({ key, label: sectionLabel(inspector.role, key), count: data.counts[key] }))} value={tab} onChange={setTab} label="Pin sections" />
      </div>
      {tab === "details" ? (
        <PinDetailSections key={pin.id} {...inspector} pin={pin} inDialog onChanged={changed} />
      ) : <PinSectionBody {...inspector} pin={pin} section={tab} data={data} wide refreshKey={refresh} onChanged={changed} />}
    </Modal>
  )
}
