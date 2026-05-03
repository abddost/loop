import type { ReasoningPart } from "@core/schema"
import { ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useState } from "react"
import { useStreamingText } from "../../hooks/use-streaming-text"
import { cn } from "../ui/cn"
import { CollapseBody } from "./collapse-body"
import { Markdown } from "./markdown"

export interface ThinkingIndicatorProps {
	part: ReasoningPart
	partId?: string
	isStreaming?: boolean
	className?: string
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000)
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	if (minutes > 0) return `${minutes}m ${remainingSeconds}s`
	return `${seconds}s`
}

/**
 * Renders reasoning/thinking content.
 *
 * Streaming: shimmer "Thinking" label with toggle arrow to reveal live reasoning text.
 * Done: "Thought for Xs" (no shimmer) with toggle arrow; reasoning text at low opacity with markdown.
 */
export function ThinkingIndicator({
	part,
	partId,
	isStreaming = false,
	className,
}: ThinkingIndicatorProps) {
	const [expanded, setExpanded] = useState(false)
	const streamingText = useStreamingText(isStreaming && partId ? partId : null)

	if (isStreaming) {
		const displayText = streamingText ?? part.text
		return (
			<div className={cn("space-y-0.5", className)}>
				<button
					type="button"
					className="flex items-center gap-1.5 text-sm"
					onClick={() => setExpanded(!expanded)}
				>
					<span className="shimmer-text font-medium">Reasoning</span>
					<ChevronDown
						className={cn(
							"h-3.5 w-3.5 text-muted transition-transform duration-200",
							expanded && "rotate-180",
						)}
						aria-hidden="true"
					/>
				</button>
				<CollapseBody expanded={expanded}>
					{displayText && (
						<div className="max-h-40 overflow-y-auto pt-1 text-xs leading-relaxed text-muted-foreground/80">
							<Markdown text={displayText} cacheKey={partId} streaming />
						</div>
					)}
				</CollapseBody>
			</div>
		)
	}

	if (!part.text) return null

	// Keep the duration available on hover so power users can still see
	// how long the model spent reasoning, but the visible label stays
	// the cleaner one-word "Reasoned" form.
	const duration = part.time ? part.time.end - part.time.start : null
	const tooltip = duration !== null ? `Reasoned for ${formatDuration(duration)}` : undefined

	return (
		<div className={cn("space-y-0.5", className)}>
			<button
				type="button"
				className="flex items-center gap-1.5 text-sm text-muted-foreground"
				onClick={() => setExpanded(!expanded)}
				title={tooltip}
			>
				<span className="font-medium">Reasoned</span>
				<ChevronDown
					className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-180")}
					aria-hidden="true"
				/>
			</button>
			<CollapseBody expanded={expanded}>
				<div className="max-h-64 overflow-y-auto pt-1 text-xs leading-relaxed text-muted-foreground/80">
					<Markdown text={part.text} />
				</div>
			</CollapseBody>
		</div>
	)
}
