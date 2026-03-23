import { Plus } from "@openai/apps-sdk-ui/components/Icon"

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
				<Plus className="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		</div>
	)
}
