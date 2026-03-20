import type { Part } from "@core/schema"
import { EditDiff } from "./edit-diff"
import { FileReference } from "./file-reference"
import { StreamingText } from "./streaming-text"
import { ThinkingIndicator } from "./thinking-indicator"
import { ToolCall } from "./tool-call"

export interface PartRendererProps {
	part: Part
	/** Runtime part ID from database (not in schema, present at runtime). */
	partId?: string
	isStreaming?: boolean
	onUndo?: (hash: string) => void
}

/**
 * Discriminated part rendering switch.
 * Routes each part type to its specialized renderer.
 */
export function PartRenderer({ part, partId, isStreaming = false, onUndo }: PartRendererProps) {
	switch (part.type) {
		case "text":
			return <StreamingText text={part.text} partId={partId} isStreaming={isStreaming} />

		case "reasoning":
			return <ThinkingIndicator part={part} partId={partId} isStreaming={isStreaming} />

		case "tool":
			return <ToolCall part={part} />

		case "edit":
			return <EditDiff part={part} onUndo={onUndo} />

		case "step-start":
			if (isStreaming) {
				return <span className="shimmer-text text-sm">Thinking</span>
			}
			return null

		case "step-finish":
			return null

		case "file":
			return (
				<div className="inline-flex items-center gap-1 rounded-[--radius-sm] border border-border bg-surface px-2 py-0.5 text-xs text-muted-foreground">
					<FileReference path={part.path} />
				</div>
			)

		case "subtask":
			return <div className="text-xs text-muted">Subtask: {part.description}</div>

		case "compaction":
			return <div className="text-xs text-muted italic">Context compacted</div>

		case "retry":
			return (
				<div className="text-xs text-warning">
					Retry attempt {part.attempt}: {part.error}
				</div>
			)

		case "snapshot":
			return null

		default:
			return null
	}
}
