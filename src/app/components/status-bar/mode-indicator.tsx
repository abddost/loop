import { ChevronDown, Desktop } from "@openai/apps-sdk-ui/components/Icon"
import { cn } from "../ui/cn"

export interface ModeIndicatorProps {
	className?: string
}

/** "Local" mode indicator with monitor icon. */
export function ModeIndicator({ className }: ModeIndicatorProps) {
	return (
		<div className={cn("flex items-center gap-1.5 text-xs text-muted", className)}>
			<Desktop className="h-3 w-3" aria-hidden="true" />
			<span>Local</span>
			<ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
		</div>
	)
}
