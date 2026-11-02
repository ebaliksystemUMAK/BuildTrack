import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react"
import Modal, { type ModalSize } from "../components/Modal"

type ConfirmOptions = {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: "default" | "danger"
  size?: ModalSize
  // When set, the confirm button stays off until this exact text has been typed (for deletions that cannot be undone).
  typeToConfirm?: string
}

type Pending = ConfirmOptions & { resolve: (value: boolean) => void }
const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

// Replacement for window.confirm(): same promise style, but styled, accessible and on-theme.
//   if (!(await confirm({ title: "Delete project?", tone: "danger", confirmLabel: "Delete" }))) return
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [typed, setTyped] = useState("")
  const active = useRef<Pending | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const next = { ...options, resolve }
        active.current = next
        setTyped("")
        setPending(next)
      }),
    [],
  )

  const settle = (value: boolean) => {
    active.current?.resolve(value)
    active.current = null
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <Modal
          title={pending.title}
          size={pending.size ?? "sm"}
          onClose={() => settle(false)}
          footer={
            <>
              <button type="button" onClick={() => settle(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                disabled={Boolean(pending.typeToConfirm) && typed !== pending.typeToConfirm}
                className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${pending.tone === "danger" ? "bg-[#d93a3a] hover:bg-[#b82f2f]" : "bg-brand hover:bg-brand-hover"}`}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </>
          }
        >
          {pending.message ? <div className="text-sm text-fg">{pending.message}</div> : null}
          {pending.typeToConfirm ? (
            <label className="mt-3 block text-xs font-bold uppercase tracking-wider text-fg-muted">To confirm, type <code className="rounded bg-surface-muted px-1.5 py-0.5 normal-case">{pending.typeToConfirm}</code>
              <input value={typed} autoComplete="off" aria-label="Confirmation text" onChange={(event) => setTyped(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal normal-case text-fg" />
            </label>
          ) : null}
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error("useConfirm must be used inside <ConfirmProvider>")
  return context
}
