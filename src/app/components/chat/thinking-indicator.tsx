import type { ReasoningPart } from "@core/schema"
import { cn } from "../ui/cn"

export interface ThinkingIndicatorProps {
	part: ReasoningPart
	isStreaming?: boolean
	className?: string
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
	return `${remainingSeconds}s`
}

/**
 * Shows "Thinking..." while reasoning is in progress, or "Worked for Xm Ys" when done.
 */
export function ThinkingIndicator({
	part,
	isStreaming = false,
	className,
}: ThinkingIndicatorProps) {
	const duration = part.time ? part.time.end - part.time.start : null

	return (
		<div className={cn("flex items-center gap-2 text-xs text-muted", className)}>
			{isStreaming ? (
				<>
					<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
					<span>Thinking...</span>
				</>
			) : (
				<span>Worked for {duration !== null ? formatDuration(duration) : "a moment"}</span>
			)}
		</div>
	)
}
