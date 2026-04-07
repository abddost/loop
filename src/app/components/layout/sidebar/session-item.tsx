import { formatRelativeTime } from "@app/lib/relative-time"
import type { Session, SessionStatus } from "@core/schema"
import { Archive, BranchAlt } from "@openai/apps-sdk-ui/components/Icon"
import { SpinningCircle } from "../../chat/tool-output"
import { cn } from "../../ui/cn"

export interface SessionItemProps {
	session: Session
	status?: SessionStatus
	isActive: boolean
	/** If the session runs in a worktree, show this branch name with an icon. */
	worktreeBranch?: string
	onSelect: (sessionId: string) => void
	onArchive: (sessionId: string) => void
}

function StatusIndicator({ status }: { status: SessionStatus }) {
	if (status === "idle") return null

	if (status === "busy" || status === "compacting") {
		return <SpinningCircle className="shrink-0" />
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
export function SessionItem({
	session,
	status,
	isActive,
	worktreeBranch,
	onSelect,
	onArchive,
}: SessionItemProps) {
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
			{worktreeBranch && (
				<span className="flex shrink-0 items-center gap-0.5 text-[10px] text-accent/70">
					<BranchAlt className="h-3.5 w-3.5 text-muted/70" aria-hidden="true" />
				</span>
			)}
			{status && !isRunning && status !== "idle" && <StatusIndicator status={status} />}
			<span className="relative flex w-[2rem] shrink-0 items-center justify-end">
				<span className="whitespace-nowrap text-xs text-muted transition-opacity group-hover/session:opacity-0">
					{formatRelativeTime(session.updatedAt)}
				</span>
				<span
					className="absolute inset-0 flex cursor-pointer items-center justify-end rounded text-muted opacity-0 transition-opacity hover:text-foreground group-hover/session:opacity-100"
					onClick={(e) => {
						e.stopPropagation()
						onArchive(session.id)
					}}
					onKeyDown={() => {}}
				>
					<Archive className="h-3.5 w-3.5" aria-hidden="true" />
				</span>
			</span>
		</button>
	)
}
