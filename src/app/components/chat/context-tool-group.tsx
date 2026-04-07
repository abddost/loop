import type { Part } from "@core/schema"
import { ChevronRight } from "@openai/apps-sdk-ui/components/Icon"
import { memo, useMemo, useState } from "react"
import { cn } from "../ui/cn"
import { PartRenderer } from "./part-renderer"
import { normalizeTool } from "./tool-call"

// ─── Tool classification ────────────────────────────────────────

/** Tools that modify files or run arbitrary commands — their presence
 *  prevents the turn from being collapsed into an "Explored" group. */
const MODIFICATION_TOOLS = new Set(["bash", "edit", "write", "apply-patch", "multiedit"])

/**
 * Returns true when every part in the turn is read-only exploration —
 * no file-modification tools, no bash, no edit diffs.
 * Must contain at least one tool call to qualify.
 */
export function isExplorationOnlyTurn(parts: Part[]): boolean {
	let hasToolCall = false
	for (const part of parts) {
		if (part.type === "edit") return false
		if (part.type === "tool") {
			if (MODIFICATION_TOOLS.has(normalizeTool(part.tool))) return false
			hasToolCall = true
		}
	}
	return hasToolCall
}

// ─── Summary ────────────────────────────────────────────────────

interface ContextSummary {
	reads: number
	searches: number
	lists: number
}

function computeSummary(parts: Part[]): ContextSummary {
	let reads = 0
	let searches = 0
	let lists = 0

	for (const p of parts) {
		if (p.type !== "tool") continue
		const tool = normalizeTool(p.tool)
		if (tool === "read") reads++
		else if (tool === "glob" || tool === "grep" || tool === "web-search") searches++
		else if (tool === "list") lists++
	}

	return { reads, searches, lists }
}

function formatSummary(s: ContextSummary): string {
	const segments: string[] = []
	if (s.reads > 0) segments.push(`${s.reads} file${s.reads !== 1 ? "s" : ""}`)
	if (s.searches > 0) segments.push(`${s.searches} search${s.searches !== 1 ? "es" : ""}`)
	if (s.lists > 0) segments.push(`${s.lists} list${s.lists !== 1 ? "s" : ""}`)
	return segments.join(", ")
}

// ─── Cross-message merging ──────────────────────────────────────

/**
 * Merges consecutive exploration-only assistant messages into a single
 * group. If trailing text parts exist at the end of the merged group,
 * they are extracted into a separate entry so the user still sees the summary.
 */
export function mergeExplorationMessages<T extends { id: string; role: string; parts: Part[] }>(
	messages: T[],
): T[] {
	const result: T[] = []
	let buffer: T[] = []

	const flush = () => {
		if (buffer.length <= 1) {
			result.push(...buffer)
			buffer = []
			return
		}

		const allParts = buffer.flatMap((m) => m.parts)

		// Extract trailing text parts to keep visible outside the group
		let splitAt = allParts.length
		while (splitAt > 0 && allParts[splitAt - 1].type === "text") {
			splitAt--
		}

		const hasTrailingText = splitAt < allParts.length
		const exploreParts = hasTrailingText ? allParts.slice(0, splitAt) : allParts
		const trailingParts = hasTrailingText ? allParts.slice(splitAt) : []

		if (exploreParts.length > 0) {
			result.push({ ...buffer[0], parts: exploreParts } as T)
		}

		if (trailingParts.length > 0) {
			const lastMsg = buffer[buffer.length - 1]
			result.push({ ...lastMsg, id: `${lastMsg.id}-trailing`, parts: trailingParts } as T)
		}

		buffer = []
	}

	for (const msg of messages) {
		if (msg.role === "assistant" && isExplorationOnlyTurn(msg.parts)) {
			buffer.push(msg)
		} else {
			flush()
			result.push(msg)
		}
	}

	flush()
	return result
}

// ─── Component ──────────────────────────────────────────────────

interface ContextToolGroupProps {
	parts: Part[]
	isStreaming?: boolean
}

/**
 * Renders an exploration-only turn as a single collapsible row:
 * "Explored 3 files, 2 searches".
 *
 * Expanding reveals every part (text, reasoning, tool calls) inline.
 */
export const ContextToolGroup = memo(function ContextToolGroup({
	parts,
	isStreaming = false,
}: ContextToolGroupProps) {
	const [expanded, setExpanded] = useState(false)

	const isActive = useMemo(
		() => parts.some((p) => p.type === "tool" && (p.state === "pending" || p.state === "running")),
		[parts],
	)

	const summary = useMemo(() => computeSummary(parts), [parts])
	const summaryText = useMemo(() => formatSummary(summary), [summary])

	return (
		<div>
			<button
				type="button"
				className="flex items-center gap-1.5 py-0.5 text-sm transition-colors hover:text-foreground"
				onClick={() => setExpanded(!expanded)}
			>
				<ChevronRight
					className={cn(
						"h-3 w-3 shrink-0 text-muted transition-transform duration-200",
						expanded && "rotate-90",
					)}
					aria-hidden="true"
				/>
				<span className={cn("font-medium", isActive ? "shimmer-text" : "text-muted-foreground")}>
					{isActive ? "Exploring" : "Explored"}
				</span>
				<span className="text-muted-foreground/60">{summaryText}</span>
			</button>

			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				aria-hidden={!expanded}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="space-y-0.5 pl-[18px] pt-0.5">
						{parts.map((part, i) => (
							<PartRenderer
								key={part.type === "tool" ? part.callId : `${part.type}-${i}`}
								part={part}
								isStreaming={isStreaming && i === parts.length - 1}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	)
})
