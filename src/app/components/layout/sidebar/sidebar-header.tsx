export interface SidebarHeaderProps {
	onNewProject: () => void
}

/** "Projects" header with new-project button. */
export function SidebarHeader({ onNewProject }: SidebarHeaderProps) {
	return (
		<div className="flex items-center justify-between px-4 py-2">
			<span className="text-sm font-semibold text-foreground">Projects</span>
			<button
				type="button"
				className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
				onClick={onNewProject}
				title="New project"
				aria-label="New project"
			>
				{/* Plus icon */}
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
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
			</button>
		</div>
	)
}
