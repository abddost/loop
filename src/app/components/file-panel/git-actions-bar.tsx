import { Branch, ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useRef, useState } from "react"
import { type ChangeFilter, selectChanges, useFilePanelStore } from "../../stores/file-panel-store"
import { cn } from "../ui/cn"

const FILTER_LABELS: Record<ChangeFilter, string> = {
	all: "Uncommitted",
	staged: "Staged",
	unstaged: "Unstaged",
}

export function GitActionsBar() {
	const changes = useFilePanelStore(selectChanges)
	const branches = useFilePanelStore((s) => s.branches)
	const changeFilter = useFilePanelStore((s) => s.changeFilter)
	const setChangeFilter = useFilePanelStore((s) => s.setChangeFilter)
	const commitMessage = useFilePanelStore((s) => s.commitMessage)
	const setCommitMessage = useFilePanelStore((s) => s.setCommitMessage)
	const showCommitInput = useFilePanelStore((s) => s.showCommitInput)
	const toggleCommitInput = useFilePanelStore((s) => s.toggleCommitInput)
	const loading = useFilePanelStore((s) => s.gitOperationLoading)
	const loadBranches = useFilePanelStore((s) => s.loadBranches)
	const stageAll = useFilePanelStore((s) => s.stageAll)
	const commit = useFilePanelStore((s) => s.commit)
	const commitAndPush = useFilePanelStore((s) => s.commitAndPush)
	const push = useFilePanelStore((s) => s.push)
	const createBranch = useFilePanelStore((s) => s.createBranch)

	const [actionDropdownOpen, setActionDropdownOpen] = useState(false)
	const [filterDropdownOpen, setFilterDropdownOpen] = useState(false)
	const [branchModalOpen, setBranchModalOpen] = useState(false)
	const [branchName, setBranchName] = useState("")
	const [pendingAction, setPendingAction] = useState<"commit" | "commitPush" | null>(null)
	const actionRef = useRef<HTMLDivElement>(null)
	const filterRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// Load branches on mount
	useEffect(() => {
		loadBranches()
	}, [loadBranches])

	// Close dropdowns on outside click
	useEffect(() => {
		if (!actionDropdownOpen && !filterDropdownOpen) return
		const handler = (e: MouseEvent) => {
			if (actionDropdownOpen && actionRef.current && !actionRef.current.contains(e.target as Node))
				setActionDropdownOpen(false)
			if (filterDropdownOpen && filterRef.current && !filterRef.current.contains(e.target as Node))
				setFilterDropdownOpen(false)
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [actionDropdownOpen, filterDropdownOpen])

	// Focus textarea when shown
	useEffect(() => {
		if (showCommitInput) textareaRef.current?.focus()
	}, [showCommitInput])

	const handleMessageChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			setCommitMessage(e.target.value)
			const el = e.target
			el.style.height = "auto"
			el.style.height = `${Math.min(el.scrollHeight, 120)}px`
		},
		[setCommitMessage],
	)

	const handleCommitAndPush = useCallback(async () => {
		if (!commitMessage.trim()) return
		await stageAll()
		await commitAndPush(commitMessage.trim())
	}, [commitMessage, stageAll, commitAndPush])

	const handleCommitOnly = useCallback(async () => {
		if (!commitMessage.trim()) return
		setActionDropdownOpen(false)
		await stageAll()
		await commit(commitMessage.trim())
	}, [commitMessage, stageAll, commit])

	const handlePush = useCallback(async () => {
		setActionDropdownOpen(false)
		await push(true)
	}, [push])

	const handleCreateBranchAndCommit = useCallback((withPush: boolean) => {
		setActionDropdownOpen(false)
		setPendingAction(withPush ? "commitPush" : "commit")
		setBranchModalOpen(true)
	}, [])

	const handleBranchConfirm = useCallback(async () => {
		if (!branchName.trim()) return
		const created = await createBranch(branchName.trim())
		if (!created) return

		setBranchModalOpen(false)
		setBranchName("")

		if (pendingAction && commitMessage.trim()) {
			await stageAll()
			if (pendingAction === "commitPush") {
				await commitAndPush(commitMessage.trim())
			} else {
				await commit(commitMessage.trim())
			}
		}
		setPendingAction(null)
	}, [branchName, createBranch, pendingAction, commitMessage, stageAll, commitAndPush, commit])

	const hasMessage = commitMessage.trim().length > 0
	const currentBranch = branches?.current
	const additions = changes.reduce((sum, c) => sum + c.additions, 0)
	const deletions = changes.reduce((sum, c) => sum + c.deletions, 0)

	return (
		<>
			<div className="border-b border-[var(--separator)]">
				{/* Top row: Branch + Action split button */}
				<div className="flex items-center justify-between px-2 pt-2 pb-1.5">
					{/* Branch display */}
					{currentBranch && (
						<div className="flex items-center gap-1.5 text-xs text-muted">
							<Branch className="h-3 w-3" aria-hidden="true" />
							<span className="max-w-[100px] truncate font-medium">{currentBranch}</span>
						</div>
					)}

					{/* Action split button */}
					<div className="relative flex items-center" ref={actionRef}>
						{/* Primary action */}
						<button
							type="button"
							onClick={() => {
								if (showCommitInput && hasMessage) {
									handleCommitAndPush()
								} else {
									toggleCommitInput()
								}
							}}
							disabled={loading}
							className={cn(
								"flex h-7 items-center gap-1.5 rounded-l-md px-3 text-xs font-medium transition-all",
								showCommitInput && hasMessage && !loading
									? "bg-accent text-accent-foreground hover:bg-accent/90"
									: "bg-surface-hover text-foreground hover:bg-surface-hover/80",
								loading && "cursor-not-allowed opacity-60",
							)}
						>
							{loading ? (
								<div className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
							) : (
								"Commit & Push"
							)}
						</button>

						{/* Dropdown chevron */}
						<button
							type="button"
							onClick={() => setActionDropdownOpen(!actionDropdownOpen)}
							disabled={loading}
							className={cn(
								"flex h-7 items-center justify-center rounded-r-md border-l border-border/30 px-1.5 transition-all",
								showCommitInput && hasMessage && !loading
									? "bg-accent text-accent-foreground hover:bg-accent/90"
									: "bg-surface-hover text-foreground hover:bg-surface-hover/80",
								loading && "cursor-not-allowed opacity-60",
							)}
						>
							<ChevronDown className="h-3 w-3" aria-hidden="true" />
						</button>

						{/* Action dropdown */}
						{actionDropdownOpen && (
							<div
								className={cn(
									"el-dropdown absolute right-0 top-full z-50 mt-1 min-w-[220px] overflow-hidden",
								)}
							>
								<div className="py-1">
									<DropdownItem
										label="Commit"
										disabled={!hasMessage || loading}
										onClick={handleCommitOnly}
									/>
									<DropdownItem
										label="Commit & Push"
										disabled={!hasMessage || loading}
										onClick={() => {
											setActionDropdownOpen(false)
											handleCommitAndPush()
										}}
									/>
									<DropdownItem label="Push" disabled={loading} onClick={handlePush} />
									<div className="my-1 border-t border-[var(--separator)]" />
									<DropdownItem
										label="Create Branch & Commit"
										disabled={!hasMessage || loading}
										onClick={() => handleCreateBranchAndCommit(false)}
									/>
									<DropdownItem
										label="Create Branch, Commit & Push"
										disabled={!hasMessage || loading}
										onClick={() => handleCreateBranchAndCommit(true)}
									/>
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Commit message input (shown on demand) */}
				{showCommitInput && (
					<div className="px-2 pb-2">
						<textarea
							ref={textareaRef}
							value={commitMessage}
							onChange={handleMessageChange}
							placeholder="Commit message…"
							rows={1}
							className={cn(
								"w-full resize-none rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-xs text-foreground",
								"placeholder:text-muted/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20",
								"transition-all",
							)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && hasMessage && !loading) {
									e.preventDefault()
									handleCommitAndPush()
								}
								if (e.key === "Escape") {
									toggleCommitInput()
								}
							}}
						/>
					</div>
				)}

				{/* Change filter row */}
				<div className="flex items-center gap-2 px-3 py-1.5">
					<div className="relative" ref={filterRef}>
						<button
							type="button"
							onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
							className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
						>
							<span className="font-medium">
								{changes.length} {FILTER_LABELS[changeFilter]} Change
								{changes.length !== 1 ? "s" : ""}
							</span>
							<ChevronDown
								className={cn(
									"h-2.5 w-2.5 transition-transform",
									filterDropdownOpen && "rotate-180",
								)}
								aria-hidden="true"
							/>
						</button>

						{filterDropdownOpen && (
							<div
								className={cn(
									"el-dropdown absolute left-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden",
								)}
							>
								<div className="py-1">
									{(["all", "unstaged", "staged"] as ChangeFilter[]).map((filter) => (
										<button
											key={filter}
											type="button"
											onClick={() => {
												setChangeFilter(filter)
												setFilterDropdownOpen(false)
											}}
											className={cn(
												"el-surface-hover flex w-full items-center justify-between px-3 py-2 text-left text-xs",
												"text-overlay-foreground",
											)}
										>
											<span>{FILTER_LABELS[filter]}</span>
											{changeFilter === filter && (
												<svg
													className="h-3 w-3 text-accent"
													viewBox="0 0 16 16"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													aria-hidden="true"
												>
													<path d="M4 8l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
												</svg>
											)}
										</button>
									))}
								</div>
							</div>
						)}
					</div>

					{/* Diff summary */}
					<span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
						{additions > 0 && <span className="text-diff-add">+{additions}</span>}
						{deletions > 0 && <span className="text-diff-remove">-{deletions}</span>}
					</span>
				</div>
			</div>

			{/* Branch creation modal */}
			{branchModalOpen && (
				<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
					<div
						className={cn("el-dialog w-[360px] p-5", "animate-in fade-in zoom-in-95 duration-200")}
					>
						<h3 className="text-sm font-semibold text-foreground">Create New Branch</h3>
						<p className="mt-1 text-xs text-muted">
							Enter a name for the new branch. It will be created from the current HEAD.
						</p>
						<input
							ref={(el) => el?.focus()}
							type="text"
							value={branchName}
							onChange={(e) => setBranchName(e.target.value)}
							placeholder="feature/my-branch"
							className={cn(
								"mt-3 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-foreground",
								"placeholder:text-muted/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/20",
							)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && branchName.trim()) handleBranchConfirm()
								if (e.key === "Escape") {
									setBranchModalOpen(false)
									setPendingAction(null)
								}
							}}
						/>
						<div className="mt-4 flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={() => {
									setBranchModalOpen(false)
									setPendingAction(null)
								}}
								className="el-btn-pill text-xs text-muted hover:text-foreground"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleBranchConfirm}
								disabled={!branchName.trim() || loading}
								className={cn(
									"el-btn-pill text-xs font-medium",
									branchName.trim() && !loading
										? "bg-accent text-accent-foreground hover:bg-accent/90"
										: "bg-surface-hover text-muted cursor-not-allowed",
								)}
							>
								{loading ? "Creating…" : "Create & Continue"}
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	)
}

function DropdownItem({
	label,
	disabled,
	onClick,
}: {
	label: string
	disabled?: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className={cn(
				"el-surface-hover flex w-full items-center px-3 py-2 text-left text-xs",
				disabled ? "cursor-not-allowed text-muted/40" : "text-overlay-foreground",
			)}
		>
			{label}
		</button>
	)
}
