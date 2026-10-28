import { useSettings } from "../../lib/settings"
import { citedStandards, clauseReferences, sourceHost } from "../../lib/qaChecklists"

// Documentation of a checklist: the standards it cites (code, catalog title, official source when documented) and the exact clauses
// its criteria refer to. Sources come from System Settings > Standards and codes; nothing is guessed when a link is not recorded.
export default function ChecklistDocumentation({ standards, items = [], emptyText }: { standards: string[]; items?: { reference?: string | null }[]; emptyText?: string }) {
  const { settings, loading } = useSettings()
  const cited = citedStandards(standards, settings.standards)
  const clauses = clauseReferences(items)
  if (!cited.length && !clauses.length) {
    return emptyText ? <p className="rounded-xl border border-dashed border-line px-3 py-2 text-xs text-fg-muted">{emptyText}</p> : null
  }
  return (
    <section aria-label="Documentation" className="rounded-xl border border-line bg-surface-muted/50 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-fg-muted">Documentation</h3>
      {cited.length ? (
        <ul className="mt-2 space-y-1.5">
          {cited.map((standard) => (
            <li key={standard.code} className="text-sm leading-snug">
              <strong className="text-fg">{standard.code}</strong>
              <span className="text-fg-muted"> · {standard.title ?? (loading ? "…" : "Not in the standards catalog")}</span>
              {standard.source ? (
                <a href={standard.source} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex min-h-6 items-center">
                  <span className="text-xs font-semibold text-brand-text underline">Official source ({sourceHost(standard.source)})</span>
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {clauses.length ? (
        <div className="mt-2">
          <p className="text-xs font-semibold text-fg-muted">Clauses the criteria refer to</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {clauses.map((clause) => <li key={clause} className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-fg">{clause}</li>)}
          </ul>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] leading-snug text-fg-muted">Confirm the edition and the exact clause in the official text before inspecting. Citing a standard does not certify compliance.</p>
    </section>
  )
}
