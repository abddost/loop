import { ChevronDownIcon, ComputerDesktopIcon } from "@heroicons/react/24/outline"
import { cn } from "../ui/cn"

export interface ModeIndicatorProps {
	className?: string
}

/** "Local" mode indicator with monitor icon. */
export function ModeIndicator({ className }: ModeIndicatorProps) {
	return (
		<div className={cn("flex items-center gap-1.5 text-xs text-muted", className)}>
			<ComputerDesktopIcon className="h-3 w-3" aria-hidden="true" />
			<span>Local</span>
			<ChevronDownIcon className="h-2.5 w-2.5" aria-hidden="true" />
		</div>
	)
}
