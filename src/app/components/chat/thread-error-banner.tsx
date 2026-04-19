import { memo, useState } from "react"
import type { SessionError } from "../../stores/workspace-store"
import { cn } from "../ui/cn"

export interface ThreadErrorBannerProps {
	error: SessionError
	onDismiss: () => void
	className?: string
}

/**
 * Source → human-readable label shown as the banner title.
 *
 * Kept as a switch (not a static map) so a future SourceTag literal can
 * surface a typed compile error rather than silently falling through.
 */
function sourceLabel(source: SessionError["source"]): string {
	switch (source) {
		case "auth":
			return "Authentication failed"
		case "cli":
			return "Claude Code CLI not available"
		case "rate-limit":
			return "Rate limit hit"
		case "tool":
			return "Tool execution failed"
		case "stream":
			return "Stream interrupted"
		case "provider":
			return "Provider unavailable"
		case "runtime":
			return "Runtime error"
		default:
			return "Error"
	}
}

function ChevronDown({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 12 12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
		>
			<path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}

function CloseIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 12 12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
		>
			<path d="M3 3 9 9M9 3l-6 6" strokeLinecap="round" />
		</svg>
	)
}

function AlertIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 14 14"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden="true"
		>
			<circle cx="7" cy="7" r="5.5" />
			<path d="M7 4v3.5M7 9.5v.5" strokeLinecap="round" />
		</svg>
	)
}

/**
 * Thread-level error banner shown above the message list when a session
 * encounters a runtime/auth/CLI/stream failure. Auto-dismissible — the
 * banner persists in the store keyed by sessionId so it survives
 * remounts but is cleared when the user submits the next prompt.
 *
 * Severity drives the color: `error` is red, `warning` is amber. The
 * `details` field, if present, is hidden behind an expand affordance to
 * keep the banner compact for normal cases.
 */
export const ThreadErrorBanner = memo(function ThreadErrorBanner({
	error,
	onDismiss,
	className,
}: ThreadErrorBannerProps) {
	const [expanded, setExpanded] = useState(false)
	const hasDetails = !!error.details && error.details.trim() !== error.message.trim()

	const tone = error.severity === "error" ? "error" : "warning"

	return (
		<div className={cn("mx-auto w-full max-w-[52rem] px-12", className)}>
			<div
				className={cn(
					"flex items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm",
					tone === "error"
						? "border-error/30 bg-error/[0.04] text-error"
						: "border-warning/30 bg-warning/[0.04] text-warning",
				)}
				role="alert"
			>
				<AlertIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<div className="min-w-0 flex-1 space-y-0.5">
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium uppercase tracking-wider opacity-80">
							{sourceLabel(error.source)}
						</span>
						{hasDetails && (
							<button
								type="button"
								onClick={() => setExpanded((v) => !v)}
								className="flex items-center gap-0.5 text-[10px] uppercase tracking-wider opacity-60 transition-opacity hover:opacity-100"
								aria-expanded={expanded}
							>
								<span>{expanded ? "Less" : "Details"}</span>
								<ChevronDown
									className={cn("h-2.5 w-2.5 transition-transform", expanded && "rotate-180")}
								/>
							</button>
						)}
					</div>
					<p className="break-words text-foreground/90">{error.message}</p>
					{hasDetails && expanded && (
						<pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-black/[0.04] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/70">
							{error.details}
						</pre>
					)}
				</div>
				<button
					type="button"
					onClick={onDismiss}
					className="-mt-0.5 -mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-current/60 transition-colors hover:bg-current/[0.08] hover:text-current"
					aria-label="Dismiss error"
				>
					<CloseIcon className="h-3 w-3" />
				</button>
			</div>
		</div>
	)
})
