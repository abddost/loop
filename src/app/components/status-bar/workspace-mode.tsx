import { ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type WorktreeInfo, useWorktreeStore } from "../../stores/worktree-store"
import { cn } from "../ui/cn"

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

	const label = useMemo(() => {
		if (!isNewSession) {
			return activeWorktree ? activeWorktree.branch : "Local"
		}
		if (selected === "main") return "Local"
		if (selected === "create") return "New Worktree"
		const wt = allWorktrees.get(selected)
		return wt?.branch ?? "Worktree"
	}, [isNewSession, activeWorktree, selected, allWorktrees])

	const isSandbox = isNewSession ? selected !== "main" : !!activeWorktree

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

	// Existing sessions: read-only indicator, no dropdown
	if (!isNewSession) {
		return (
			<div
				className={cn(
					"flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-muted",
					className,
				)}
			>
				<span
					className={cn("h-1.5 w-1.5 rounded-full", isSandbox ? "bg-accent" : "bg-emerald-400")}
				/>
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
				<span
					className={cn("h-1.5 w-1.5 rounded-full", isSandbox ? "bg-accent" : "bg-emerald-400")}
				/>
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
								selected === "main"
									? "text-accent"
									: "text-overlay-foreground hover:bg-surface-hover",
							)}
						>
							<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
							Local
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
										: "text-overlay-foreground hover:bg-surface-hover",
									wt.status === "creating" && "cursor-not-allowed opacity-50",
								)}
							>
								<span className="h-1.5 w-1.5 rounded-full bg-accent" />
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
							<svg
								className="h-3 w-3"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								aria-hidden="true"
							>
								<path d="M8 3v10M3 8h10" strokeLinecap="round" />
							</svg>
							New Worktree
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
