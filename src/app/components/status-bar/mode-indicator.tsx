import { cn } from "../ui/cn"

export interface ModeIndicatorProps {
	className?: string
}

/** "Local" mode indicator with monitor icon. */
export function ModeIndicator({ className }: ModeIndicatorProps) {
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
				<rect x="2" y="3" width="20" height="14" rx="2" />
				<path d="M8 21h8M12 17v4" />
			</svg>
			<span>Local</span>
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
