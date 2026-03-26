import { CollapseSm, ExpandSm, Plus } from "@openai/apps-sdk-ui/components/Icon"

export interface SidebarHeaderProps {
	onNewProject: () => void
	allCollapsed: boolean
	onToggleCollapseAll: () => void
}

/** "Projects" header with collapse-all toggle and new-project button. */
export function SidebarHeader({
	onNewProject,
	allCollapsed,
	onToggleCollapseAll,
}: SidebarHeaderProps) {
	return (
		<div className="flex items-center justify-between px-4 py-2">
			<span className="text-sm font-semibold text-foreground">Projects</span>
			<div className="flex items-center gap-0.5">
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					onClick={onToggleCollapseAll}
					title={allCollapsed ? "Expand all projects" : "Collapse all projects"}
					aria-label={allCollapsed ? "Expand all projects" : "Collapse all projects"}
				>
					{allCollapsed ? (
						<ExpandSm className="h-3.5 w-3.5" aria-hidden="true" />
					) : (
						<CollapseSm className="h-3.5 w-3.5" aria-hidden="true" />
					)}
				</button>
				<button
					type="button"
					className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					onClick={onNewProject}
					title="New project"
					aria-label="New project"
				>
					<Plus className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			</div>
		</div>
	)
}
