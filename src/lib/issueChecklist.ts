export const WHOLE_PIN_CHECKLIST = "__whole_pin__"
export type IssueChecklistLink = { checklist_item_id?: string | null; checklist_name?: string | null }
export const issueChecklistKey = (report: IssueChecklistLink) => report.checklist_name?.trim().replace(/\s+/g," ").toLowerCase() || WHOLE_PIN_CHECKLIST
export const issueChecklistLabel = (report: IssueChecklistLink) => report.checklist_name?.trim() || "Whole work pin"

// Saved names survive renames/removal; one filter groups the same checklist name across work pins.
export function issueChecklistOptions(reports: IssueChecklistLink[]) {
  const names=new Map<string,string>()
  for(const report of reports) {
    const key=issueChecklistKey(report)
    if(key!==WHOLE_PIN_CHECKLIST) names.set(key,issueChecklistLabel(report))
  }
  return [...names].map(([key,name])=>({key,name})).sort((a,b)=>a.name.localeCompare(b.name))
}

export function issueChecklistSelectionProblem(pinId:string,itemId:string,items:Array<{id:string;pin_id:string}>,loading:boolean,error:string) {
  if(loading) return "Loading this work pin's tasks…"
  if(error) return "Could not load this work pin's tasks. Retry before logging the issue."
  if(itemId && !items.some(item=>item.id===itemId && item.pin_id===pinId)) return "Select a task belonging to this work pin."
  return ""
}

export function issueChecklistIndex<T extends IssueChecklistLink & {pin_id:string}>(reports:T[],key:string) {
  const allPins=new Set(reports.map(report=>report.pin_id))
  const selected=reports.filter(report=>!key || issueChecklistKey(report)===key)
  const matches=new Set(selected.map(report=>report.pin_id))
  return {
    // Reports arrive oldest first. The summary must show the latest matching report, not another checklist's description.
    latest:new Map(selected.map(report=>[report.pin_id,report])),
    matches:(pinId:string)=>!key || matches.has(pinId) || (key===WHOLE_PIN_CHECKLIST && !allPins.has(pinId)),
  }
}
