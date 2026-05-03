import { BranchAlt, ChevronDown, Desktop } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
	WORKSPACE_MODE_CURSOR,
	type WorktreeInfo,
	useWorktreeStore,
} from "../../stores/worktree-store"
import { cn } from "../ui/cn"

function CloudIcon({ className }: { className?: string }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth={1.5}
			stroke="currentColor"
			className={className}
			aria-hidden="true"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z"
			/>
		</svg>
	)
}

export interface WorkspaceModeProps {
	/** Project directory (canonical). Used to list available worktrees. */
	parentDirectory: string
	/** Active session's directory. Used to derive current workspace for existing sessions. */
	sessionDirectory?: string
	/** When true, shows interactive dropdown. Otherwise shows read-only indicator. */
	isNewSession?: boolean
	className?: string
}

/**
 * Workspace mode indicator / selector in the status bar.
 * For new sessions: interactive dropdown to choose Local / existing worktree / new worktree.
 * For existing sessions: read-only indicator showing which workspace the session runs in.
 */
export function WorkspaceMode({
	parentDirectory,
	sessionDirectory,
	isNewSession,
	className,
}: WorkspaceModeProps) {
	const selected = useWorktreeStore((s) => s.newSessionWorktree)
	const allWorktrees = useWorktreeStore((s) => s.worktrees)
	const setTarget = useWorktreeStore((s) => s.setNewSessionWorktree)
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	const worktrees = useMemo(() => {
		const result: WorktreeInfo[] = []
		for (const wt of allWorktrees.values()) {
			if (wt.parentDirectory === parentDirectory) result.push(wt)
		}
		return result
	}, [allWorktrees, parentDirectory])

	// For existing sessions, derive workspace from the session's directory
	const activeWorktree = useMemo(() => {
		if (isNewSession || !sessionDirectory) return null
		return allWorktrees.get(sessionDirectory) ?? null
	}, [isNewSession, sessionDirectory, allWorktrees])

	const isCursorMode = isNewSession && selected === WORKSPACE_MODE_CURSOR

	const label = useMemo(() => {
		if (!isNewSession) {
			return activeWorktree ? activeWorktree.branch : "Local"
		}
		if (selected === "main") return "Local"
		if (selected === "create") return "New Worktree"
		if (selected === WORKSPACE_MODE_CURSOR) return "Cloud"
		const wt = allWorktrees.get(selected)
		return wt?.branch ?? "Worktree"
	}, [isNewSession, activeWorktree, selected, allWorktrees])

	const isSandbox = isNewSession
		? selected !== "main" && selected !== WORKSPACE_MODE_CURSOR
		: !!activeWorktree

	// Close on outside click
	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	// Close on escape
	useEffect(() => {
		if (!open) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false)
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open])

	const handleSelect = useCallback(
		(value: "main" | "create" | string) => {
			setTarget(value)
			setOpen(false)
		},
		[setTarget],
	)

	const indicatorIcon = isCursorMode ? (
		<CloudIcon className="h-3.5 w-3.5" />
	) : isSandbox ? (
		<BranchAlt className="h-3.5 w-3.5" />
	) : (
		<Desktop className="h-3.5 w-3.5" />
	)

	// Existing sessions: read-only indicator, no dropdown
	if (!isNewSession) {
		return (
			<div
				className={cn(
					"flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted",
					className,
				)}
			>
				{indicatorIcon}
				<span className="max-w-[120px] truncate">{label}</span>
			</div>
		)
	}

	return (
		<div className="relative" ref={containerRef}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"el-surface-hover flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted transition-all",
					"hover:text-foreground",
					open && "bg-[var(--app-surface-hover)] text-foreground",
					className,
				)}
			>
				{indicatorIcon}
				<span className="max-w-[120px] truncate">{label}</span>
				<ChevronDown
					className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")}
					aria-hidden="true"
				/>
			</button>

			{open && (
				<div
					className={cn(
						"absolute bottom-full right-0 z-50 mb-1 w-[220px] overflow-hidden rounded-xl",
						"el-dropdown shadow-[var(--shadow-dropdown)]",
						"animate-in fade-in slide-in-from-bottom-2 duration-150",
					)}
				>
					<div className="py-1">
						<button
							type="button"
							onClick={() => handleSelect("main")}
							className={cn(
								"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
								selected === "main" ? "text-accent" : "text-foreground hover:bg-surface-hover",
							)}
						>
							<Desktop className="h-3.5 w-3.5 shrink-0 text-muted" />
							Local
						</button>

						<button
							type="button"
							onClick={() => handleSelect(WORKSPACE_MODE_CURSOR)}
							className={cn(
								"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
								selected === WORKSPACE_MODE_CURSOR
									? "text-accent"
									: "text-foreground hover:bg-surface-hover",
							)}
						>
							<CloudIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
							Cloud - Cursor only
						</button>

						{worktrees.map((wt) => (
							<button
								key={wt.directory}
								type="button"
								onClick={() => handleSelect(wt.directory)}
								disabled={wt.status === "creating"}
								className={cn(
									"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
									selected === wt.directory
										? "text-accent"
										: "text-foreground hover:bg-surface-hover",
									wt.status === "creating" && "cursor-not-allowed opacity-50",
								)}
							>
								<BranchAlt className="h-3.5 w-3.5 shrink-0 text-muted" />
								<span className="truncate">{wt.branch}</span>
								{wt.status === "creating" && (
									<span className="text-[10px] text-muted">(creating...)</span>
								)}
							</button>
						))}

						<div className="mt-0.5 border-t border-border/20" />
						<button
							type="button"
							onClick={() => handleSelect("create")}
							className={cn(
								"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
								selected === "create"
									? "text-accent"
									: "text-accent/70 hover:bg-surface-hover hover:text-accent",
							)}
						>
							<BranchAlt className="h-3.5 w-3.5 shrink-0 text-muted" />
							New Worktree
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
