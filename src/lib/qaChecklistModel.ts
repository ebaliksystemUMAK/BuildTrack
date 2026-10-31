export type ChecklistRef = { id: string; text: string; done: boolean }
export type ChecklistRecord<T extends ChecklistRef = ChecklistRef> = { checklist_snapshot: T[]; item_ids?: string[] | null }
export const checklistNameKey = (name: string) => name.trim().replace(/\s+/g," ").toLowerCase() || "__unnamed__"

// Legacy partial snapshots also contain unfinished items: those are not submitted reports.
export function submittedChecklistItems<T extends ChecklistRef>(row: ChecklistRecord<T>, itemId?: string, nameKey?: string): T[] {
  const selected=row.item_ids ? new Set(row.item_ids) : null
  return row.checklist_snapshot.filter(item=>(selected ? selected.has(item.id) : item.done)
    && (!itemId || item.id===itemId) && (!nameKey || checklistNameKey(item.text)===nameKey))
}

export function checklistGroups<T extends ChecklistRecord>(rows:T[],itemId?:string) {
  const groups=new Map<string,{key:string;name:string;rows:T[]}>()
  for(const row of rows) {
    const names=new Map(submittedChecklistItems(row,itemId).map(item=>[checklistNameKey(item.text),item.text.trim() || "Unnamed task"]))
    for(const [key,name] of names) {
      const group=groups.get(key) ?? {key,name,rows:[]}
      group.name=name;group.rows.push(row);groups.set(key,group)
    }
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name))
}

export const checklistNames = (row:ChecklistRecord) => [...new Set(submittedChecklistItems(row).map(item=>item.text.trim()))]

export function checklistAttemptNumber<T extends ChecklistRecord & {id:string}>(rows:T[],row:T,itemId?:string,nameKey?:string) {
  const ids=new Set(submittedChecklistItems(row,itemId,nameKey).map(item=>item.id))
  const index=rows.findIndex(candidate=>candidate.id===row.id)
  return index<0 ? 0 : rows.slice(0,index).filter(candidate=>submittedChecklistItems(candidate).some(item=>ids.has(item.id))).length
}
