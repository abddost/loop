import type { FilePart, Part } from "@core/schema"
import { Folder } from "@openai/apps-sdk-ui/components/Icon"
import { memo } from "react"
import { isImageMime } from "../../lib/file-utils"
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

function FilePartRenderer({ part }: { part: FilePart }) {
	const hasDataUrl = part.content?.startsWith("data:")

	if (isImageMime(part.mimeType) && hasDataUrl) {
		return (
			<img
				src={part.content}
				alt={part.path}
				className="max-h-64 max-w-xs rounded-xl object-contain"
				draggable={false}
			/>
		)
	}

	const isFolder = part.mimeType === "application/x-directory"
	const filename = part.path.split("/").pop() ?? part.path

	return (
		<div className="inline-flex items-center gap-2 rounded-full bg-surface-hover/60 px-3 py-1.5 text-sm text-foreground">
			{isFolder ? (
				<Folder className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
			) : (
				<FileDocIcon className="h-4 w-4 shrink-0 text-muted" />
			)}
			<FileReference path={part.path} display={filename} className="text-sm" />
		</div>
	)
}

function FileDocIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
			/>
		</svg>
	)
}

/**
 * Discriminated part rendering switch.
 * Routes each part type to its specialized renderer.
 *
 * Memoized: immer preserves references for unchanged parts within a message,
 * so when one part updates, sibling parts skip re-rendering entirely.
 */
export const PartRenderer = memo(function PartRenderer({
	part,
	partId,
	isStreaming = false,
	onUndo,
}: PartRendererProps) {
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
			return <FilePartRenderer part={part} />

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
})
