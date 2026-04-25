import { CollapseSm, ExpandSm, Plus } from "@openai/apps-sdk-ui/components/Icon"
import { Tooltip } from "../../ui/tooltip"

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
		<div className="flex items-center justify-between px-4 pb-1 pt-3">
			<span className="text-[11px] font-medium tracking-[0.02em] text-muted-foreground/80">
				Projects
			</span>
			<div className="flex items-center gap-0.5">
				<Tooltip content={allCollapsed ? "Expand all" : "Collapse all"}>
					<button
						type="button"
						className="el-surface-hover flex h-6 w-6 items-center justify-center text-muted/80 hover:text-foreground"
						onClick={onToggleCollapseAll}
						aria-label={allCollapsed ? "Expand all projects" : "Collapse all projects"}
					>
						{allCollapsed ? (
							<ExpandSm className="h-3.5 w-3.5" aria-hidden="true" />
						) : (
							<CollapseSm className="h-3.5 w-3.5" aria-hidden="true" />
						)}
					</button>
				</Tooltip>
				<Tooltip content="New project">
					<button
						type="button"
						className="el-surface-hover flex h-6 w-6 items-center justify-center text-muted/80 hover:text-foreground"
						onClick={onNewProject}
						aria-label="New project"
					>
						<Plus className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</Tooltip>
			</div>
		</div>
	)
}
