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
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<circle cx="18" cy="18" r="3" />
					<circle cx="6" cy="6" r="3" />
					<path d="M13 6h3a2 2 0 012 2v7" />
					<path d="M6 9v12" />
				</svg>
				<span>{branch}</span>
				<svg
					width="10"
					height="10"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					aria-hidden="true"
				>
					<path d="M6 9l6 6 6-6" />
				</svg>
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
