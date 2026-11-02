import { Component, type ErrorInfo, type ReactNode } from "react"

// compact: a failing panel shows a small inline message and the rest of the page keeps working (used around independent sections).
type Props = { children: ReactNode; resetKey?: string; compact?: boolean; label?: string }
type State = { error: Error | null }

// Last line of defence: if a screen crashes, show a friendly message instead of a blank page. Navigating to another
// screen (resetKey changes) clears it. The error is also logged so it can be picked up by an error-reporting hook later.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("BuildTrack screen error", error, info.componentStack)
    window.dispatchEvent(new CustomEvent("buildtrack:error", { detail: { message: error.message, stack: error.stack } }))
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.compact) {
      return (
        <div role="alert" className="rounded-xl border border-line bg-danger-soft px-4 py-3 text-sm text-danger-fg">
          <p className="font-bold">{this.props.label ?? "This section"} could not be shown.</p>
          <p className="mt-0.5">The rest of the page still works and your data is safe.</p>
          <button type="button" onClick={() => this.setState({ error: null })} className="mt-2 rounded-lg border border-current px-3 py-1 text-xs font-bold hover:bg-surface/40">Try again</button>
        </div>
      )
    }
    // A stale deploy (old file names after an update) is the most common cause: a reload fixes it.
    const stale = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically/i.test(this.state.error.message)
    return (
      <div role="alert" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center text-fg">
        <p className="text-xs font-extrabold uppercase tracking-widest text-brand-text">BuildTrack</p>
        <h1 className="mt-2 text-2xl font-extrabold">{stale ? "A newer version is available" : "Something went wrong"}</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {stale ? "Reload the page to get the latest version. Your work is saved." : "This screen could not be shown. Your data is safe. Try again, or go back to the start."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover">Reload</button>
          {!stale ? <button type="button" onClick={() => this.setState({ error: null })} className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">Try again</button> : null}
          <a href="/" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-surface-muted">Start page</a>
        </div>
      </div>
    )
  }
}
