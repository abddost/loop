import type { Part, ToolPart } from "@core/schema"
import { ChevronRight } from "@openai/apps-sdk-ui/components/Icon"
import { memo, useDeferredValue, useMemo, useState } from "react"
import { cn } from "../ui/cn"
import { CollapseBody } from "./collapse-body"
import { PartRenderer } from "./part-renderer"
import { normalizeTool } from "./tool-call"

// ─── Tool classification ────────────────────────────────────────

/** Tools that read state without mutating anything. */
const READ_ONLY_TOOLS = new Set([
	"read",
	"glob",
	"grep",
	"web-fetch",
	"web-search",
	"list",
	"toolsearch",
	"notebookread",
])

/** Tools that write to the filesystem. */
const FILE_MUTATION_TOOLS = new Set(["edit", "write", "multiedit", "apply-patch", "notebookedit"])

/** Subagent / orchestration tools (Task/Agent dispatch). */
const SUBAGENT_TOOLS = new Set(["task", "agent"])

/** Bash-style command execution tools. */
const COMMAND_TOOLS = new Set(["bash", "bashoutput", "bash-output", "killbash", "bash-kill"])

/** Web-fetching tools (rendered as their own summary segment). */
const WEB_TOOLS = new Set(["web-fetch", "web-search"])

/** Todo-management tools — counted in the summary as "updated todos". */
const TODO_TOOLS = new Set(["todowrite"])

/**
 * Tools whose UI is interactive — plan cards, approval dialogs, inline
 * question prompts. They must render as standalone components so their
 * full payload (plan markdown, approval buttons) stays visible without
 * the user expanding a work-log group.
 */
const INTERACTIVE_TOOLS = new Set([
	"plan-exit",
	"plan-enter",
	"exitplanmode",
	"enterplanmode",
	"question",
	"askuserquestion",
])

/** Whether a normalized tool name is read-only. Exported for reuse. */
export function isReadOnlyTool(tool: string): boolean {
	return READ_ONLY_TOOLS.has(tool)
}

function isFileMutationTool(tool: string): boolean {
	return FILE_MUTATION_TOOLS.has(tool)
}

function isSubagentTool(tool: string): boolean {
	return SUBAGENT_TOOLS.has(tool)
}

function isCommandTool(tool: string): boolean {
	return COMMAND_TOOLS.has(tool)
}

function isWebTool(tool: string): boolean {
	return WEB_TOOLS.has(tool)
}

function isTodoTool(tool: string): boolean {
	return TODO_TOOLS.has(tool)
}

/**
 * Whether a part belongs in a work-log group.
 *
 * Reasoning blocks join tool calls in the group so a long
 * tool-reasoning-tool-reasoning sequence collapses into a single
 * chevron line ("Read 3 files") instead of producing many "Reasoned"
 * standalones interleaved with single-tool summaries. The expanded
 * group view still surfaces every reasoning block individually.
 */
function isWorkPart(part: Part): boolean {
	if (part.type === "reasoning") return true
	if (part.type === "tool") {
		const tool = normalizeTool(part.tool)
		if (INTERACTIVE_TOOLS.has(tool)) return false
		if (tool === "subagent") return false
		return true
	}
	return false
}

/**
 * Subagent parts from the Claude Code SDK's `task_*` system events
 * (rendered only in the right-side Tasks & Agents panel). They have a
 * long independent lifecycle and must not be counted in the inline
 * work-log summary or its active/shimmer state.
 */
function isSubagentPanelPart(part: Part): boolean {
	return part.type === "tool" && normalizeTool(part.tool) === "subagent"
}

/**
 * Returns true when the turn qualifies for the work-log treatment —
 * has at least one work part, no edit-aggregator part, no interactive
 * tool call (plan-exit / plan-enter / question).
 */
export function isExplorationOnlyTurn(parts: Part[]): boolean {
	let hasWork = false
	for (const part of parts) {
		if (part.type === "edit") return false
		if (part.type === "tool" && INTERACTIVE_TOOLS.has(normalizeTool(part.tool))) return false
		if (isWorkPart(part)) hasWork = true
	}
	return hasWork
}

// ─── Summary builder ────────────────────────────────────────────

/** Strip surrounding whitespace and collapse newlines for inline display. */
function compactPreview(value: string | undefined, max = 96): string | undefined {
	if (!value) return undefined
	const cleaned = value.replace(/\s+/g, " ").trim()
	if (!cleaned) return undefined
	return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

function basenamePath(p: string | undefined): string | undefined {
	if (!p) return undefined
	return p.split("/").pop() ?? p
}

function readMetaNumber(part: ToolPart, key: string): number | undefined {
	const v = part.metadata?.[key]
	return typeof v === "number" ? v : undefined
}

interface SummaryCounts {
	commands: ToolPart[]
	reads: ToolPart[]
	edits: ToolPart[]
	subagents: ToolPart[]
	web: ToolPart[]
	todos: ToolPart[]
	other: ToolPart[]
}

/** Bucket tool parts by display category. Drops non-tool parts. */
function categorize(parts: Part[]): SummaryCounts {
	const c: SummaryCounts = {
		commands: [],
		reads: [],
		edits: [],
		subagents: [],
		web: [],
		todos: [],
		other: [],
	}
	for (const p of parts) {
		if (p.type !== "tool") continue
		const tool = normalizeTool(p.tool)
		if (isCommandTool(tool)) c.commands.push(p)
		else if (isWebTool(tool)) c.web.push(p)
		else if (isReadOnlyTool(tool)) c.reads.push(p)
		else if (isFileMutationTool(tool)) c.edits.push(p)
		else if (isSubagentTool(tool)) c.subagents.push(p)
		else if (isTodoTool(tool)) c.todos.push(p)
		else c.other.push(p)
	}
	return c
}

/** Total tool count across all buckets. */
function totalTools(c: SummaryCounts): number {
	return (
		c.commands.length +
		c.reads.length +
		c.edits.length +
		c.subagents.length +
		c.web.length +
		c.todos.length +
		c.other.length
	)
}

/**
 * Build the specific verb phrase for a single tool call.
 *
 * Used when the entire group contains exactly one tool — the user gets
 * the actual filename / command rather than a generic count, which
 * matches t3code's behavior for short groups.
 */
function describeSingleTool(part: ToolPart): string {
	const tool = normalizeTool(part.tool)
	const input = (part.input ?? {}) as Record<string, unknown>
	const filePath =
		typeof input.file_path === "string"
			? input.file_path
			: typeof input.path === "string"
				? input.path
				: undefined

	if (tool === "bash-output" || tool === "bashoutput") {
		return "Checked the process"
	}
	if (tool === "bash-kill" || tool === "killbash") {
		return "Killed the process"
	}
	if (isCommandTool(tool)) {
		const cmd = typeof input.command === "string" ? input.command.split("\n")[0] : tool
		return `Ran ${compactPreview(cmd) ?? "a command"}`
	}
	if (tool === "read" || tool === "notebookread") {
		const name = basenamePath(filePath)
		return name ? `Read ${name}` : "Read a file"
	}
	if (tool === "list") {
		const name = basenamePath(filePath)
		return name ? `Listed ${name}` : "Listed a directory"
	}
	if (tool === "glob") {
		const pattern = typeof input.pattern === "string" ? input.pattern : undefined
		return pattern ? `Searched ${compactPreview(pattern)}` : "Searched files"
	}
	if (tool === "grep") {
		const pattern = typeof input.pattern === "string" ? input.pattern : undefined
		return pattern ? `Grepped ${compactPreview(pattern)}` : "Grepped"
	}
	if (tool === "toolsearch") {
		const query = typeof input.query === "string" ? input.query : undefined
		return query ? `Searched tools for ${compactPreview(query)}` : "Searched tools"
	}
	if (isWebTool(tool)) {
		const url = typeof input.url === "string" ? input.url : undefined
		const query = typeof input.query === "string" ? input.query : undefined
		if (tool === "web-fetch") return url ? `Fetched ${compactPreview(url)}` : "Fetched a page"
		return query ? `Web search ${compactPreview(query)}` : "Searched the web"
	}
	if (isFileMutationTool(tool)) {
		const name = basenamePath(filePath)
		const verb = tool === "write" ? "Created" : "Edited"
		const additions = readMetaNumber(part, "additions")
		const deletions = readMetaNumber(part, "deletions")
		const stats =
			additions || deletions
				? ` ${additions ? `+${additions}` : ""}${deletions ? ` −${deletions}` : ""}`.trim()
				: ""
		return name ? `${verb} ${name}${stats ? ` ${stats}` : ""}` : `${verb} a file`
	}
	if (isSubagentTool(tool)) {
		const desc =
			typeof input.description === "string"
				? input.description
				: typeof input.prompt === "string"
					? input.prompt
					: undefined
		return desc ? `Ran agent ${compactPreview(desc, 64)}` : "Ran an agent"
	}
	if (isTodoTool(tool)) return "Updated todos"
	return `Used ${tool || "a tool"}`
}

/**
 * Format a (count, singular, plural?) tuple as a phrase like "a command"
 * (count = 1, no number) or "3 commands" (count > 1).
 */
function countPhrase(count: number, singular: string, pluralForm?: string): string {
	if (count === 1) {
		// Use "a"/"an" article based on the leading vowel of the noun.
		const article = /^[aeiouAEIOU]/.test(singular) ? "an" : "a"
		return `${article} ${singular}`
	}
	return `${count} ${pluralForm ?? `${singular}s`}`
}

/**
 * Build the multi-tool summary phrase. Categories are joined with
 * commas, the first segment is capitalized and subsequent segments
 * lowercased — matching the natural sentence form in the UI mock
 * ("Ran 2 commands, read 7 files, updated todos").
 */
function buildMultiSummary(c: SummaryCounts): string {
	const segments: string[] = []
	if (c.commands.length > 0) segments.push(`Ran ${countPhrase(c.commands.length, "command")}`)
	if (c.reads.length > 0) segments.push(`Read ${countPhrase(c.reads.length, "file")}`)
	if (c.edits.length > 0) segments.push(`Created ${countPhrase(c.edits.length, "file")}`)
	if (c.subagents.length > 0) segments.push(`Ran ${countPhrase(c.subagents.length, "agent")}`)
	if (c.web.length > 0) segments.push(`Browsed ${countPhrase(c.web.length, "page")}`)
	if (c.todos.length > 0) segments.push("Updated todos")
	if (c.other.length > 0) segments.push(`Used ${countPhrase(c.other.length, "tool")}`)

	if (segments.length === 0) return "Worked"

	const head = segments[0]
	const tail = segments.slice(1).map((s) => s.charAt(0).toLowerCase() + s.slice(1))
	return [head, ...tail].join(", ")
}

/**
 * Build the summary phrase for a work-log group.
 *
 * Returns:
 *  - "Thinking" / "Thought" for reasoning-only groups (no tools)
 *  - The single-tool specific form when exactly one tool is in the group
 *  - The multi-segment summary otherwise
 *
 * The `isActive` flag swaps past tense verbs for present continuous so
 * an in-flight turn reads "Running a command" / "Editing layout.tsx"
 * rather than "Ran" / "Edited".
 */
function buildSummary(parts: Part[], isActive: boolean): string {
	const cats = categorize(parts)
	const tools = totalTools(cats)

	if (tools === 0) return isActive ? "Reasoning" : "Reasoned"

	let phrase: string
	if (tools === 1) {
		const onlyTool = [
			...cats.commands,
			...cats.reads,
			...cats.edits,
			...cats.subagents,
			...cats.web,
			...cats.todos,
			...cats.other,
		][0]
		phrase = describeSingleTool(onlyTool)
	} else {
		phrase = buildMultiSummary(cats)
	}

	if (!isActive) return phrase
	// Active turn — convert past-tense verbs to present continuous so the
	// user can tell at a glance the agent is still working. Mapped only
	// for verbs we emit ourselves; other phrases pass through unchanged.
	return phrase
		.replace(/^Ran /, "Running ")
		.replace(/^Read /, "Reading ")
		.replace(/^Listed /, "Listing ")
		.replace(/^Searched /, "Searching ")
		.replace(/^Grepped /, "Grepping ")
		.replace(/^Created /, "Creating ")
		.replace(/^Edited /, "Editing ")
		.replace(/^Fetched /, "Fetching ")
		.replace(/^Browsed /, "Browsing ")
		.replace(/^Updated /, "Updating ")
		.replace(/^Used /, "Using ")
		.replace(/^Checked /, "Checking ")
		.replace(/^Killed /, "Killing ")
		.replace(/, ran /g, ", running ")
		.replace(/, read /g, ", reading ")
		.replace(/, created /g, ", creating ")
		.replace(/, browsed /g, ", browsing ")
		.replace(/, updated /g, ", updating ")
		.replace(/, used /g, ", using ")
}

// ─── Intra-message segmentation ─────────────────────────────────

/** Minimum consecutive work parts required to form a collapsed group.
 *  Set to 1 so even a single tool gets the chevron summary line — the
 *  whole point is to keep text and tool-action lines visually distinct. */
const MIN_GROUP_SIZE = 1

export type PartSegment =
	| { kind: "single"; part: Part; index: number }
	| { kind: "group"; parts: Part[]; startIndex: number }

/**
 * Segments a message's parts into runs of consecutive work parts and
 * standalone non-work parts (text, edit-aggregator). Every run that
 * meets `MIN_GROUP_SIZE` collapses into a group — even
 * reasoning-only runs, which surface as a "Reasoned" chevron line.
 */
export function segmentParts(parts: Part[]): PartSegment[] {
	const segments: PartSegment[] = []
	let workRun: { parts: Part[]; startIndex: number } | null = null

	const flushRun = () => {
		if (!workRun) return
		if (workRun.parts.length >= MIN_GROUP_SIZE) {
			segments.push({ kind: "group", parts: workRun.parts, startIndex: workRun.startIndex })
		} else {
			for (let j = 0; j < workRun.parts.length; j++) {
				segments.push({
					kind: "single",
					part: workRun.parts[j],
					index: workRun.startIndex + j,
				})
			}
		}
		workRun = null
	}

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i]
		if (isWorkPart(part)) {
			if (!workRun) workRun = { parts: [], startIndex: i }
			workRun.parts.push(part)
		} else {
			flushRun()
			segments.push({ kind: "single", part, index: i })
		}
	}

	flushRun()
	return segments
}

// ─── Cross-message merging ──────────────────────────────────────

/** A message qualifies for cross-message work-log merging when it
 *  contains at least one tool and only "passable" extras alongside it.
 *
 *  Text and reasoning are passed through unchanged — the merge keeps
 *  parts in their original order, and `segmentParts` later breaks any
 *  work-run on either of them. So even if a merged message ends up
 *  with `[reasoning, tool, text, tool]`, the rendered output is
 *  ThinkingIndicator + summary + text + summary — text and reasoning
 *  stay first-class outside the group. */
function isWorkMessage<T extends { role: string; parts: Part[] }>(msg: T): boolean {
	if (msg.role !== "assistant") return false
	let hasWork = false
	for (const part of msg.parts) {
		if (part.type === "text") continue
		if (part.type === "reasoning") continue
		if (!isWorkPart(part)) return false
		hasWork = true
	}
	return hasWork
}

/**
 * Merges consecutive work-only assistant messages into a single group.
 * Trailing text parts are extracted into a separate entry so the user
 * still sees the summary outside the collapsed group.
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
		if (isWorkMessage(msg)) {
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
 * Read the file path from a tool part's input. Mirrors FileMutationToolCall's
 * resolution: prefer `file_path` (SDK convention), fall back to `path`.
 */
function readFilePath(part: ToolPart): string | undefined {
	const input = (part.input ?? {}) as Record<string, unknown>
	if (typeof input.file_path === "string" && input.file_path.length > 0) return input.file_path
	if (typeof input.path === "string" && input.path.length > 0) return input.path
	return undefined
}

/**
 * Consolidate consecutive file-mutation tool calls targeting the same
 * file path into a single entry. Cursor's plan/build agents often
 * fragment a logical change into 3-4 separate Edit tool calls (one
 * per concern within the same file) — the resulting per-tool rows
 * look like duplicates ("App.tsx", "App.tsx", "App.tsx") even though
 * the bottom EditDiff aggregator already shows the consolidated view.
 *
 * Strategy: walk the parts list; when a file-mutation tool whose path
 * matches an EARLIER same-path file-mutation in this group is found,
 * merge stats (sum `additions`, `deletions`, `editCount`) into the
 * earliest entry and drop the later one. Keeps order stable for non-
 * file-mutation parts (reasoning, reads, bash, etc.).
 *
 * Note: per-tool diffs are preserved on the merged entry's `metadata.diff`
 * — we concatenate diff strings so expanding the merged tool still
 * shows every change. The bottom EditDiff aggregator is unaffected
 * since it walks edit Parts, not tool Parts.
 */
function consolidateFileMutations(parts: Part[]): Part[] {
	const result: Part[] = []
	const indexByPath = new Map<string, number>()
	for (const part of parts) {
		if (part.type !== "tool") {
			result.push(part)
			continue
		}
		const tool = normalizeTool(part.tool)
		if (!isFileMutationTool(tool)) {
			result.push(part)
			continue
		}
		const path = readFilePath(part)
		if (!path) {
			result.push(part)
			continue
		}
		const existingIdx = indexByPath.get(path)
		if (existingIdx === undefined) {
			indexByPath.set(path, result.length)
			result.push(part)
			continue
		}
		// Merge `part` into the existing same-path entry.
		const existing = result[existingIdx] as ToolPart
		const merged = mergeFileMutations(existing, part)
		result[existingIdx] = merged
	}
	return result
}

/** Sum stats + concatenate diffs from `b` into `a`, preserving `a`'s identity. */
function mergeFileMutations(a: ToolPart, b: ToolPart): ToolPart {
	const aMeta = (a.metadata ?? {}) as Record<string, unknown>
	const bMeta = (b.metadata ?? {}) as Record<string, unknown>
	const sumNum = (k: string): number | undefined => {
		const av = typeof aMeta[k] === "number" ? (aMeta[k] as number) : 0
		const bv = typeof bMeta[k] === "number" ? (bMeta[k] as number) : 0
		const total = av + bv
		return total > 0 ? total : undefined
	}
	const aDiff = typeof aMeta.diff === "string" ? aMeta.diff : ""
	const bDiff = typeof bMeta.diff === "string" ? bMeta.diff : ""
	const mergedDiff = [aDiff, bDiff].filter(Boolean).join("\n")
	const aEditCount = typeof aMeta.editCount === "number" ? (aMeta.editCount as number) : 1
	const bEditCount = typeof bMeta.editCount === "number" ? (bMeta.editCount as number) : 1
	const mergedMeta: Record<string, unknown> = { ...aMeta, ...bMeta }
	const additions = sumNum("additions")
	const deletions = sumNum("deletions")
	if (additions !== undefined) mergedMeta.additions = additions
	if (deletions !== undefined) mergedMeta.deletions = deletions
	mergedMeta.editCount = aEditCount + bEditCount
	if (mergedDiff) mergedMeta.diff = mergedDiff
	// Take the LATER part's state — if `b` is still running, the merged
	// entry is running; if `b` is completed, the merged entry is too.
	return {
		...a,
		state: b.state,
		metadata: mergedMeta,
	}
}

/**
 * Single-line summary of a run of work parts, with a chevron expand
 * affordance. Mirrors the UI mock: text replies stay first-class,
 * everything else collapses into "Ran 2 commands, read 7 files, …".
 *
 * Expanding switches to full PartRenderer for every part — the user can
 * still drill into bash output, file diffs, plan content, reasoning
 * markdown, etc.
 */
export const ContextToolGroup = memo(function ContextToolGroup({
	parts,
	isStreaming = false,
}: ContextToolGroupProps) {
	const [expanded, setExpanded] = useState(false)

	// During streaming, parts changes on every delta. Defer the heavy
	// summary recompute so React can interrupt it for higher-priority
	// updates (clicks, scroll, the collapse animation).
	const deferredParts = useDeferredValue(parts)

	// Subagent parts (background task progress from the Claude Code SDK)
	// are rendered exclusively in the right-side Tasks & Agents panel and
	// live indefinitely — the leader turn completes long before the
	// background teammates finish. Excluding them here keeps the "Running
	// N agents" shimmer from latching on for hours after the leader's
	// turn genuinely ended.
	//
	// Also collapse consecutive same-file Edit/Write/MultiEdit tool calls
	// into one entry — cursor's agents often fragment a logical change
	// into 3-4 separate tool calls (one per concern within the file),
	// which produces 3-4 visually-identical "App.tsx" rows. Stats are
	// summed, diffs concatenated, the latest state kept; the bottom
	// EditDiff aggregator is unchanged.
	const inlineParts = useMemo(
		() => consolidateFileMutations(deferredParts.filter((p) => !isSubagentPanelPart(p))),
		[deferredParts],
	)

	const isActive = useMemo(
		() =>
			inlineParts.some(
				(p) => p.type === "tool" && (p.state === "pending" || p.state === "running"),
			),
		[inlineParts],
	)

	const summary = useMemo(() => buildSummary(inlineParts, isActive), [inlineParts, isActive])

	return (
		<div className="space-y-1">
			<button
				type="button"
				className="group/wl flex w-full items-center gap-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<span
					className={cn("min-w-0 truncate text-left tracking-el-ui", isActive && "shimmer-text")}
				>
					{summary}
				</span>
				<ChevronRight
					className={cn(
						"h-3 w-3 shrink-0 text-muted/60 transition-transform duration-200",
						expanded && "rotate-90",
					)}
					aria-hidden="true"
				/>
			</button>

			{/* Expanded view: full PartRenderer for every part — bash output,
			    file diffs, plan content, reasoning markdown all available.
			    `inlineParts` already has same-file mutations consolidated,
			    so the expanded view shows ONE "App.tsx" entry with merged
			    stats / diff instead of N near-identical rows. */}
			<CollapseBody
				expanded={expanded}
				className="ml-[6px] space-y-1 border-l border-border/40 pl-3"
			>
				{inlineParts.map((part, i) => (
					<PartRenderer
						key={part.type === "tool" ? part.callId : `${part.type}-${i}`}
						part={part}
						isStreaming={isStreaming && i === inlineParts.length - 1}
					/>
				))}
			</CollapseBody>
		</div>
	)
})
