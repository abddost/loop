export interface SidebarHeaderProps {
	onNewProject: () => void
}

/** "Threads" header with action buttons. */
export function SidebarHeader({ onNewProject }: SidebarHeaderProps) {
	return (
		<div className="flex items-center justify-between px-4 py-2">
			<span className="text-sm font-semibold text-foreground">Threads</span>
			<div className="flex items-center gap-1">
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					onClick={onNewProject}
					title="New project"
					aria-label="New project"
				>
					{/* Document/clipboard icon */}
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
						<polyline points="14 2 14 8 20 8" />
					</svg>
				</button>
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					title="Filter threads"
					aria-label="Filter threads"
				>
					{/* Filter/sort icon (three horizontal lines) */}
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						aria-hidden="true"
					>
						<path d="M4 6h16M7 12h10M10 18h4" />
					</svg>
				</button>
			</div>
		</div>
	)
}
