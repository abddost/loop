import { Branch, ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useFilePanelStore } from "../../stores/file-panel-store"
import { cn } from "../ui/cn"

export interface VcsStatusProps {
	branch?: string
	className?: string
}

/** Git branch display with interactive branch selector dropdown. */
export function VcsStatus({ branch, className }: VcsStatusProps) {
	const [open, setOpen] = useState(false)
	const [search, setSearch] = useState("")
	const containerRef = useRef<HTMLDivElement>(null)
	const searchRef = useRef<HTMLInputElement>(null)

	const branches = useFilePanelStore((s) => s.branches)
	const branchesLoading = useFilePanelStore((s) => s.branchesLoading)
	const loadBranches = useFilePanelStore((s) => s.loadBranches)
	const switchBranch = useFilePanelStore((s) => s.switchBranch)
	const createBranch = useFilePanelStore((s) => s.createBranch)
	const gitLoading = useFilePanelStore((s) => s.gitOperationLoading)

	// Close on outside click
	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false)
				setSearch("")
			}
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	// Focus search on open
	useEffect(() => {
		if (open) {
			searchRef.current?.focus()
			loadBranches()
		}
	}, [open, loadBranches])

	// Close on escape
	useEffect(() => {
		if (!open) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setOpen(false)
				setSearch("")
			}
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open])

	const handleSwitch = useCallback(
		async (branchName: string) => {
			setOpen(false)
			setSearch("")
			await switchBranch(branchName)
		},
		[switchBranch],
	)

	const handleCreateFromSearch = useCallback(async () => {
		if (!search.trim()) return
		setOpen(false)
		const name = search.trim()
		setSearch("")
		await createBranch(name)
	}, [search, createBranch])

	// Filter branches by search
	const filteredLocal = useMemo(() => {
		if (!branches) return []
		const q = search.toLowerCase()
		return branches.local.filter((b) => b.toLowerCase().includes(q))
	}, [branches, search])

	const filteredRemote = useMemo(() => {
		if (!branches) return []
		const q = search.toLowerCase()
		return (
			branches.remote
				.filter((b) => b.toLowerCase().includes(q))
				// Exclude remotes that have a matching local branch
				.filter((r) => {
					const shortName = r.replace(/^[^/]+\//, "")
					return !branches.local.includes(shortName)
				})
		)
	}, [branches, search])

	const searchMatchesExact = useMemo(() => {
		if (!search.trim() || !branches) return false
		const q = search.trim().toLowerCase()
		return branches.local.some((b) => b.toLowerCase() === q)
	}, [search, branches])

	if (!branch) {
		return null
	}

	return (
		<div className="relative" ref={containerRef}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				disabled={gitLoading}
				className={cn(
					"el-surface-hover flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted transition-all",
					"hover:text-foreground",
					open && "bg-[var(--app-surface-hover)] text-foreground",
					gitLoading && "cursor-not-allowed opacity-60",
					className,
				)}
			>
				<Branch className="h-3 w-3" aria-hidden="true" />
				<span className="max-w-[120px] truncate">{branch}</span>
				<ChevronDown
					className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")}
					aria-hidden="true"
				/>
			</button>

			{/* Dropdown */}
			{open && (
				<div
					className={cn(
						"absolute bottom-full right-0 z-50 mb-1 w-[280px] overflow-hidden rounded-xl",
						"el-dropdown shadow-[var(--shadow-dropdown)]",
						"animate-in fade-in slide-in-from-bottom-2 duration-150",
					)}
				>
					{/* Search */}
					<div className="border-b border-border/30 p-2">
						<input
							ref={searchRef}
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Find or create a branch…"
							className={cn(
								"w-full rounded-lg border border-border/40 bg-background px-2.5 py-1.5 text-xs text-foreground",
								"placeholder:text-muted/50 focus:border-accent/40 focus:outline-none",
							)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && search.trim() && !searchMatchesExact) {
									handleCreateFromSearch()
								}
							}}
						/>
					</div>

					{/* Branch list */}
					<div className="max-h-[300px] overflow-y-auto py-1">
						{branchesLoading ? (
							<div className="flex items-center justify-center py-6">
								<div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/30 border-t-accent" />
							</div>
						) : (
							<>
								{/* Local branches */}
								{filteredLocal.length > 0 && (
									<>
										<div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted/50">
											Local
										</div>
										{filteredLocal.map((b) => (
											<BranchItem
												key={b}
												name={b}
												isCurrent={b === branches?.current}
												onClick={() => handleSwitch(b)}
											/>
										))}
									</>
								)}

								{/* Remote-only branches */}
								{filteredRemote.length > 0 && (
									<>
										<div className="mt-1 border-t border-border/20 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted/50">
											Remote
										</div>
										{filteredRemote.map((b) => {
											const shortName = b.replace(/^[^/]+\//, "")
											return (
												<BranchItem
													key={b}
													name={b}
													shortName={shortName}
													isCurrent={false}
													onClick={() => handleSwitch(shortName)}
												/>
											)
										})}
									</>
								)}

								{/* No results */}
								{filteredLocal.length === 0 && filteredRemote.length === 0 && (
									<div className="px-3 py-3 text-center text-xs text-muted/60">
										{search.trim() ? (
											<>
												<p>No branches match &quot;{search}&quot;</p>
												<button
													type="button"
													onClick={handleCreateFromSearch}
													className="mt-2 text-accent transition-colors hover:text-accent/80"
												>
													Create branch &quot;{search.trim()}&quot;
												</button>
											</>
										) : (
											"No branches found"
										)}
									</div>
								)}

								{/* Create option when search doesn't match exact */}
								{search.trim() && !searchMatchesExact && filteredLocal.length > 0 && (
									<>
										<div className="mt-1 border-t border-border/20" />
										<button
											type="button"
											onClick={handleCreateFromSearch}
											className="el-surface-hover flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-accent transition-colors"
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
											Create &quot;{search.trim()}&quot;
										</button>
									</>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	)
}

function BranchItem({
	name,
	shortName,
	isCurrent,
	onClick,
}: {
	name: string
	shortName?: string
	isCurrent: boolean
	onClick: () => void
}) {
	return (
		<button
			type="button"
			onClick={isCurrent ? undefined : onClick}
			disabled={isCurrent}
			className={cn(
				"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
				isCurrent ? "text-accent cursor-default" : "text-overlay-foreground hover:bg-surface-hover",
			)}
		>
			{/* Current indicator */}
			<span className="flex h-3 w-3 shrink-0 items-center justify-center">
				{isCurrent && (
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
			</span>
			<span className="truncate">{shortName ?? name}</span>
			{shortName && (
				<span className="shrink-0 text-[10px] text-muted/40">{name.split("/")[0]}</span>
			)}
		</button>
	)
}
