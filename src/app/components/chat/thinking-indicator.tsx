import type { ReasoningPart } from "@core/schema"
import { cn } from "../ui/cn"

export interface ThinkingIndicatorProps {
	part: ReasoningPart
	isStreaming?: boolean
	className?: string
}

/**
 * Shows "Thinking..." while reasoning is in progress.
 * Completed duration is displayed in the message footer instead.
 */
export function ThinkingIndicator({ isStreaming = false, className }: ThinkingIndicatorProps) {
	if (!isStreaming) return null

	return (
		<div className={cn("flex items-center gap-2 text-xs text-muted", className)}>
			<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
			<span>Thinking...</span>
		</div>
	)
}
