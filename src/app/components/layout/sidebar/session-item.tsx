import { formatRelativeTime } from "@app/lib/relative-time"
import type { Session, SessionStatus } from "@core/schema"
import { cn } from "../../ui/cn"

export interface SessionItemProps {
	session: Session
	status?: SessionStatus
	isActive: boolean
	onSelect: (sessionId: string) => void
}

/**
 * Single session row in the sidebar.
 * Shows truncated title and relative timestamp.
 */
export function SessionItem({ session, isActive, onSelect }: SessionItemProps) {
	const title = session.title ?? "Untitled"

	return (
		<button
			type="button"
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-4 py-1.5 text-left text-sm transition-colors",
				"pl-8",
				isActive
					? "bg-surface-hover text-foreground"
					: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
			)}
			onClick={() => onSelect(session.id)}
		>
			<span className="min-w-0 flex-1 truncate">{title}</span>
			<span className="shrink-0 text-xs text-muted">{formatRelativeTime(session.updatedAt)}</span>
		</button>
	)
}
