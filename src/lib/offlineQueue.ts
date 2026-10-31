import { useCallback, useEffect, useState } from "react"
import { stampFields } from "./photoStamp"
import { MAX_ATTEMPTS, backoffSeconds, kindLabel, sendOrder, summarizeQueue, verdictFor, type QueueItem, type QueueKind } from "./offlineModel"
import { supabase } from "./supabase"

// Work saved on this device while there is no signal (a foreman on a basement slab, a site with a weak connection). It is kept in
// IndexedDB, shown in the app status pill, and sent in order as soon as the connection is back. Only the signed-in person's own items are sent.

const DB_NAME = "buildtrack-offline"
const STORE = "queue"
const CHANGED = "buildtrack:queue"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("This browser cannot save work offline."))
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open the offline store."))
  })
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = work(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error ?? new Error("The offline store failed."))
      transaction.onabort = () => reject(transaction.error ?? new Error("The offline store failed."))
    })
  } finally {
    db.close()
  }
}

const changed = () => window.dispatchEvent(new Event(CHANGED))

export async function enqueue(input: { userId: string; kind: QueueKind; label: string; payload: Record<string, unknown> }): Promise<QueueItem> {
  const item: QueueItem = { id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0, status: "pending", ...input }
  await run("readwrite", (store) => store.put(item))
  changed()
  return item
}

export async function listQueue(userId: string): Promise<QueueItem[]> {
  const all = await run<QueueItem[]>("readonly", (store) => store.getAll())
  return all.filter((item) => item.userId === userId).sort((a, b) => a.createdAt - b.createdAt)
}

export async function removeItem(id: string) {
  await run("readwrite", (store) => store.delete(id))
  changed()
}

async function saveItem(item: QueueItem) {
  await run("readwrite", (store) => store.put(item))
  changed()
}

export async function retryItem(item: QueueItem) {
  await saveItem({ ...item, status: "pending", attempts: 0, error: undefined, nextAt: undefined })
}

// ---- Sending one item ----
type Failure = { message: string; code?: string } | null

async function send(item: QueueItem): Promise<Failure> {
  const p = item.payload as Record<string, any>
  try {
    if (item.kind === "pin_progress") {
      const { error } = await supabase.rpc("report_pin_progress", { p_pin: p.pinId, p_status: p.status, p_note: p.note ?? null })
      return error ? { message: error.message, code: error.code } : null
    }
    if (item.kind === "daily_report") {
      const { data: existing, error: lookupError } = await supabase.from("daily_reports").select("id,status").eq("project_id", p.projectId).eq("report_date", p.date).eq("author_id", item.userId).maybeSingle()
      if (lookupError) return { message: lookupError.message, code: lookupError.code }
      if (existing && existing.status === "submitted") return { message: "That day's report was already submitted, so the saved copy was not applied.", code: "BT001" }
      const { error } = existing
        ? await supabase.from("daily_reports").update(p.values).eq("id", existing.id)
        : await supabase.from("daily_reports").insert({ project_id: p.projectId, report_date: p.date, ...p.values })
      return error ? { message: error.message, code: error.code } : null
    }
    if (item.kind === "pin_photo") {
      const upload = await supabase.storage.from("pin-photos").upload(p.path, p.blob as Blob, { contentType: "image/jpeg", upsert: false })
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) return { message: upload.error.message }
        const { error } = await supabase.from("pin_photos").insert({ pin_id: p.pinId, project_id: p.projectId, path: p.path, ...(p.source ? { capture_source: p.source } : {}), ...(p.itemId ? { checklist_item_id: p.itemId } : {}), ...(p.attemptId ? { qa_attempt_id: p.attemptId } : {}), ...(p.caption ? { caption: p.caption } : {}), ...(Array.isArray(p.annotations) && p.annotations.length ? { annotations: p.annotations } : {}), ...stampFields(p.stamp) })
      if (error) {
        if (error.code !== "23505") await supabase.storage.from("pin-photos").remove([p.path])
        return { message: error.message, code: error.code }
      }
      return null
    }
    return { message: "Unknown item", code: "BT002" }
  } catch (problem) {
    return { message: problem instanceof Error ? problem.message : String(problem) }
  }
}

let flushing: Promise<{ sent: number; failed: number; left: number }> | null = null

// Sends the person's pending items in order. Stops at the first lost connection (the rest would fail the same way).
export function flushQueue(userId: string): Promise<{ sent: number; failed: number; left: number }> {
  if (flushing) return flushing
  flushing = (async () => {
    let sent = 0
    let failed = 0
    for (const item of sendOrder(await listQueue(userId))) {
      if (item.nextAt && item.nextAt > Date.now()) break // still waiting after a lost connection; later items wait too, to keep the order
      const attempts = item.attempts + 1
      const failure = await send(item)
      const verdict = verdictFor(failure, attempts)
      if (verdict === "sent") {
        await removeItem(item.id)
        sent += 1
      } else if (verdict === "retry") {
        await saveItem({ ...item, attempts, error: failure?.message, nextAt: Date.now() + backoffSeconds(attempts) * 1000 })
        break
      } else {
        await saveItem({ ...item, attempts, status: "failed", error: failure?.message })
        failed += 1
      }
    }
    const left = summarizeQueue(await listQueue(userId)).pending
    return { sent, failed, left }
  })().finally(() => {
    flushing = null
  })
  return flushing
}

// ---- Hook ----
export function useOfflineQueue(userId: string | null) {
  const [items, setItems] = useState<QueueItem[]>([])
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  const [syncing, setSyncing] = useState(false)

  const reload = useCallback(async () => {
    if (!userId) return setItems([])
    try {
      setItems(await listQueue(userId))
    } catch {
      setItems([])
    }
  }, [userId])

  const sync = useCallback(async () => {
    if (!userId || !navigator.onLine) return null
    setSyncing(true)
    try {
      return await flushQueue(userId)
    } catch {
      return null
    } finally {
      setSyncing(false)
      await reload()
    }
  }, [userId, reload])

  useEffect(() => {
    void reload()
    const onChange = () => void reload()
    const goOnline = () => {
      setOnline(true)
      void sync()
    }
    const goOffline = () => setOnline(false)
    window.addEventListener(CHANGED, onChange)
    window.addEventListener("online", goOnline)
    window.addEventListener("offline", goOffline)
    const timer = window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === "visible") void sync()
    }, 30_000)
    void sync()
    return () => {
      window.removeEventListener(CHANGED, onChange)
      window.removeEventListener("online", goOnline)
      window.removeEventListener("offline", goOffline)
      window.clearInterval(timer)
    }
  }, [reload, sync])

  return { items, online, syncing, sync, summary: summarizeQueue(items), reload }
}

export { MAX_ATTEMPTS, kindLabel }
// One queued item, as flushQueue sends it (exported for the regression tests).
export { send as sendQueuedItem }
