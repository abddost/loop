import { formatRelativeTime } from "@app/lib/relative-time"
import type { Session, SessionStatus } from "@core/schema"
import { Archive } from "@openai/apps-sdk-ui/components/Icon"
import { cn } from "../../ui/cn"

export interface SessionItemProps {
	session: Session
	status?: SessionStatus
	isActive: boolean
	onSelect: (sessionId: string) => void
	onArchive: (sessionId: string) => void
}

function StatusIndicator({ status }: { status: SessionStatus }) {
	if (status === "idle") return null

	if (status === "busy" || status === "compacting") {
		return (
			<svg
				className="size-3.5 shrink-0 animate-spin text-muted-foreground"
				viewBox="0 0 16 16"
				fill="none"
				role="img"
				aria-label={status === "busy" ? "Running" : "Compacting"}
			>
				<title>{status === "busy" ? "Running" : "Compacting"}</title>
				<circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28 10" />
			</svg>
		)
	}

	if (status === "awaiting-permission" || status === "awaiting-question") {
		return (
			<span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-400">
				Awaiting approval
			</span>
		)
	}

	if (typeof status === "object" && status.type === "retry") {
		return <span className="shrink-0 text-[10px] font-medium text-orange-400">Retrying...</span>
	}

	return null
}

/**
 * Single session row in the sidebar.
 * Shows truncated title, status indicator, archive button (hover), and relative timestamp.
 */
export function SessionItem({ session, status, isActive, onSelect, onArchive }: SessionItemProps) {
	const title = session.title ?? "Untitled"
	const isRunning = status === "busy" || status === "compacting"

	return (
		<button
			type="button"
			className={cn(
				"group/session flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
				isActive
					? "bg-surface-hover text-foreground"
					: "text-muted hover:bg-surface-hover hover:text-muted-foreground",
			)}
			onClick={() => onSelect(session.id)}
		>
			{isRunning && <StatusIndicator status={status!} />}
			<span className="min-w-0 flex-1 truncate">{title}</span>
			{status && !isRunning && status !== "idle" && <StatusIndicator status={status} />}
			<span className="relative flex shrink-0 items-center justify-end">
				<span className="whitespace-nowrap text-xs text-muted transition-opacity group-hover/session:opacity-0">
					{formatRelativeTime(session.updatedAt)}
				</span>
				<button
					type="button"
					tabIndex={-1}
					className="absolute inset-0 flex items-center justify-end rounded text-muted opacity-0 transition-opacity hover:text-foreground group-hover/session:opacity-100"
					title="Archive thread"
					onClick={(e) => {
						e.stopPropagation()
						onArchive(session.id)
					}}
				>
					<Archive className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			</span>
		</button>
	)
}
