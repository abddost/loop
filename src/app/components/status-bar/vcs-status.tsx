import { Branch, ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { cn } from "../ui/cn"

export interface VcsStatusProps {
	branch?: string
	onCreateRepo?: () => void
	className?: string
}

/** Git branch display or "Create git repository" link. */
export function VcsStatus({ branch, onCreateRepo, className }: VcsStatusProps) {
	if (branch) {
		return (
			<div className={cn("flex items-center gap-1.5 text-xs text-muted", className)}>
				<Branch className="w-3 h-3" aria-hidden="true" />
				<span>{branch}</span>
				<ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
			</div>
		)
	}

	return (
		<button
			type="button"
			onClick={onCreateRepo}
			className={cn("text-xs text-accent transition-colors hover:text-accent/80", className)}
		>
			Create git repository
		</button>
	)
}
