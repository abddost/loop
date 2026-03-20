import type { ReasoningPart } from "@core/schema"
import { ChevronDownIcon } from "@heroicons/react/24/outline"
import { useState } from "react"
import { useStreamingText } from "../../hooks/use-streaming-text"
import { cn } from "../ui/cn"
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
					<span className="shimmer-text font-medium">Thinking</span>
					<ChevronDownIcon
						className={cn(
							"h-3.5 w-3.5 text-muted transition-transform duration-200",
							expanded && "rotate-180",
						)}
						aria-hidden="true"
					/>
				</button>
				<div
					className="grid transition-[grid-template-rows] duration-200 ease-out"
					style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				>
					<div className="min-h-0 overflow-hidden">
						{displayText && (
							<div className="max-h-40 overflow-y-auto pt-1 text-xs leading-relaxed text-muted-foreground/50">
								<Markdown text={displayText} cacheKey={partId} />
							</div>
						)}
					</div>
				</div>
			</div>
		)
	}

	if (!part.text) return null

	const duration = part.time ? part.time.end - part.time.start : null
	const label = duration !== null ? `Thought for ${formatDuration(duration)}` : "Thought"

	return (
		<div className={cn("space-y-0.5", className)}>
			<button
				type="button"
				className="flex items-center gap-1.5 text-sm text-muted-foreground/70"
				onClick={() => setExpanded(!expanded)}
			>
				<span className="font-medium">{label}</span>
				<ChevronDownIcon
					className={cn("h-3.5 w-3.5 transition-transform duration-200", expanded && "rotate-180")}
					aria-hidden="true"
				/>
			</button>
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="max-h-64 overflow-y-auto pt-1 text-xs leading-relaxed text-muted-foreground/50">
						<Markdown text={part.text} />
					</div>
				</div>
			</div>
		</div>
	)
}
