import { formatRelativeTime } from "@app/lib/relative-time"
import type { Session, SessionStatus } from "@core/schema"
import { Archive, BranchAlt, Folder, PinFilled } from "@openai/apps-sdk-ui/components/Icon"
import { usePinStore } from "../../../stores/pin-store"
import { SpinningCircle } from "../../chat/tool-output"
import { cn } from "../../ui/cn"
import { Tooltip } from "../../ui/tooltip"

export interface SessionItemProps {
	session: Session
	status?: SessionStatus
	isActive: boolean
	/** If the session runs in a worktree, show this branch name with an icon. */
	worktreeBranch?: string
	/** Git branch name to display in tooltip. */
	gitBranch?: string
	onSelect: (sessionId: string, directory: string) => void
	onArchive: (sessionId: string, directory: string) => void
}

function StatusIndicator({ status }: { status: SessionStatus }) {
	if (status === "idle") return null

	if (status === "busy" || status === "compacting") {
		return <SpinningCircle className="shrink-0" />
	}

	if (status === "awaiting-permission" || status === "awaiting-question") {
		return (
			<span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-medium leading-none text-emerald-400">
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
 * Shows pin icon (hover or when pinned), truncated title with tooltip,
 * status indicator, timestamp and archive button (hover).
 */
export function SessionItem({
	session,
	status,
	isActive,
	worktreeBranch,
	gitBranch,
	onSelect,
	onArchive,
}: SessionItemProps) {
	const title = session.title ?? "Untitled"
	const isRunning = status === "busy" || status === "compacting"
	const isPinned = usePinStore((s) => s.pinnedIds.has(session.id))
	const togglePin = usePinStore((s) => s.togglePin)
	const displayBranch = worktreeBranch ?? gitBranch

	return (
		<Tooltip
			content={
				<div className="flex max-w-[360px] flex-col gap-0.5">
					<span className="break-words">{title}</span>
					<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
						<Folder className="h-3 w-3 shrink-0" aria-hidden="true" />
						<span className="break-all">{session.directory}</span>
					</span>
					{displayBranch && (
						<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
							<BranchAlt className="h-3 w-3 shrink-0" aria-hidden="true" />
							<span>{displayBranch}</span>
						</span>
					)}
				</div>
			}
			side="right"
			delay={600}
		>
			<button
				type="button"
				className={cn(
					"group/session el-surface-hover flex w-full items-center gap-1.5 px-2.5 py-[5px] text-left text-[13px] font-[450] tracking-el-ui",
					isActive
						? "bg-[var(--app-surface-hover)] text-foreground"
						: "text-foreground/75 hover:text-foreground",
				)}
				onClick={() => onSelect(session.id, session.directory)}
			>
				{/* Pin icon: always visible when pinned, shown on hover otherwise */}
				<button
					type="button"
					aria-label={isPinned ? "Unpin session" : "Pin session"}
					className={cn(
						"shrink-0 text-muted transition-opacity hover:text-foreground",
						isPinned ? "opacity-100" : "opacity-0 group-hover/session:opacity-100",
					)}
					onClick={(e) => {
						e.stopPropagation()
						togglePin(session.id)
					}}
				>
					<PinFilled className="h-3 w-3" aria-hidden="true" />
				</button>
				{isRunning && <StatusIndicator status={status!} />}
				<span className="min-w-0 flex-1 truncate">{title}</span>
				{worktreeBranch && (
					<span className="flex shrink-0 items-center gap-0.5 text-[10px] text-accent/70">
						<BranchAlt className="h-3.5 w-3.5 text-muted/70" aria-hidden="true" />
					</span>
				)}
				{status && !isRunning && status !== "idle" && <StatusIndicator status={status} />}
				<span className="relative flex w-[2rem] shrink-0 items-center justify-end">
					<span className="whitespace-nowrap text-[11px] text-muted/85 transition-opacity group-hover/session:opacity-0">
						{formatRelativeTime(session.updatedAt)}
					</span>
					<button
						type="button"
						aria-label="Archive session"
						className="absolute inset-0 flex cursor-pointer items-center justify-end rounded text-muted opacity-0 transition-opacity hover:text-foreground group-hover/session:opacity-100"
						onClick={(e) => {
							e.stopPropagation()
							onArchive(session.id, session.directory)
						}}
					>
						<Archive className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</span>
			</button>
		</Tooltip>
	)
}
