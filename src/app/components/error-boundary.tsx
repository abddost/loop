import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
	children: ReactNode
}

interface State {
	error: Error | null
}

/**
 * Top-level React error boundary.
 *
 * Catches render-time exceptions (React #310 hook-count mismatches, stale
 * selector reads after SSE reconnect, etc.) so they don't bubble up to
 * TanStack Router's default `CatchBoundary`, which shows a static
 * "Something went wrong!" screen with no recovery path.
 *
 * Recovery model: the user clicks Reload, which calls `window.location.reload()`.
 * We deliberately do NOT auto-clear `state.error` on its own — repeatedly
 * remounting a component that's already in a broken state would just
 * re-trigger the same error.
 */
export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null }

	static getDerivedStateFromError(error: Error): State {
		return { error }
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error("[error-boundary] caught render error", error, info.componentStack)
	}

	private handleReload = (): void => {
		window.location.reload()
	}

	render(): ReactNode {
		if (!this.state.error) return this.props.children

		return (
			<div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
				<h1 className="text-xl font-bold">Loop hit an unexpected error</h1>
				<p className="max-w-md text-center text-sm text-muted">
					{this.state.error.message || "Unknown error"}
				</p>
				<button
					type="button"
					onClick={this.handleReload}
					className="rounded-md border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-hover"
				>
					Reload
				</button>
			</div>
		)
	}
}
