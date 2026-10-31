import type { ReactNode } from "react"
import Modal from "../Modal"
import AdminIcon from "../../pages/Admin/AdminIcon"
import { buttonSecondary } from "../ui/PageParts"
import type { PageGuide } from "../../lib/pageGuides"

// The instructions for one page (lib/pageGuides.ts): what it is for, how to use it, and what is good to know.
export function PageGuideModal({ guide, onClose, note }: { guide: PageGuide; onClose: () => void; note?: ReactNode }) {
  return (
    <Modal title={`Guide: ${guide.title}`} description={guide.purpose} size="md" onClose={onClose}
      footer={<button type="button" className={buttonSecondary} onClick={onClose}>Close</button>}>
      <div className="space-y-5 text-sm">
        <section>
          <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">How to use this page</h3>
          <ol className="space-y-2">
            {guide.steps.map((step, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand-soft text-xs font-extrabold text-brand-text" aria-hidden="true">{index + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </section>
        {guide.tips?.length ? (
          <section>
            <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wider text-fg-muted">Good to know</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-fg-muted">
              {guide.tips.map((tip, index) => <li key={index}>{tip}</li>)}
            </ul>
          </section>
        ) : null}
        <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-fg-muted">{note ?? <>Press <kbd className="rounded border border-line bg-surface px-1 font-bold">Ctrl K</kbd> to search or jump to any page. The Guide button in the top bar opens this on every page.</>}</p>
      </div>
    </Modal>
  )
}

// The "Guide" button in every workspace's top bar (AppShell owns the dialog, so the Ctrl K palette can open it too).
export function PageGuideButton({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Page guide: ${title}`} title="How to use this page"
      className="flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-sm font-bold text-fg-muted transition hover:bg-surface-muted hover:text-fg">
      <span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5"><AdminIcon name="help" /></span>
      <span className="hidden xl:inline">Guide</span>
    </button>
  )
}
