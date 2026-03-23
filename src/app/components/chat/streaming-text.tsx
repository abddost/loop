import { useStreamingText } from "../../hooks/use-streaming-text"
import { cn } from "../ui/cn"
import { Markdown } from "./markdown"

export interface StreamingTextProps {
	text: string
	/** Runtime part ID — enables streaming buffer reads during active streaming. */
	partId?: string
	isStreaming?: boolean
	className?: string
}

/**
 * Renders assistant text as markdown with an animated streaming cursor when active.
 *
 * During streaming, text is read from the StreamingBuffer (via useStreamingText)
 * instead of the Zustand store. This avoids creating a new immer state tree per
 * token (50-100+/s), yielding the same fine-grained update performance as
 * SolidJS's reactive stores but within React.
 *
 * When streaming completes (part:upsert arrives), the buffer is committed and
 * this component falls back to `text` from props (Zustand store).
 */
export function StreamingText({
	text,
	partId,
	isStreaming = false,
	className,
}: StreamingTextProps) {
	// Subscribe to streaming buffer only when actively streaming.
	// Historical messages pass null, incurring zero subscription overhead.
	const streamingText = useStreamingText(isStreaming && partId ? partId : null)
	const displayText = streamingText ?? text

	return (
		<div className={cn("text-[14px] leading-[1.7] text-foreground", className)}>
			<Markdown text={displayText} cacheKey={partId} streaming={isStreaming} />
		</div>
	)
}
