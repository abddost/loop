import { ulid } from "@core/id"
import type {
	SDKAssistantMessage,
	SDKMessage,
	SDKStatusMessage,
	SDKSystemMessage,
	SDKTaskMessage,
	SDKThinkingMessage,
	SDKToolUseMessage,
} from "@cursor/sdk"
import { createLogger } from "../../logger"

/**
 * Translates `SDKMessage` events from `@cursor/sdk` into Loop's `Part` schema.
 *
 * Streaming protocol (matches the claude-code adapter pattern):
 *   - Per text/reasoning chunk: emit ONLY `part:delta`. The frontend's
 *     streamingBuffer accumulates the chunks without re-rendering markdown
 *     (no Zustand churn). The first delta creates a placeholder part in
 *     Zustand at the right position; subsequent deltas update the in-memory
 *     buffer only. NO `part:upsert` per delta — that's what caused the
 *     flashing in the previous version.
 *   - At each block boundary (text → tool, reasoning → tool, etc.) AND on
 *     `finalize()`, flush the accumulated buffer with a single `part:upsert`
 *     so the DB has the final text and the streaming flag drops cleanly.
 *
 * Block-level partition (fixes the post-stream order bug):
 *   - Each contiguous text run gets its own partId (a fresh ulid). When a
 *     tool/reasoning block interrupts text, we close the current text part
 *     and the next text resumes with a new partId — NOT the original.
 *     Loop's DB ordinal is assigned at first INSERT (`max(ordinal) + 1`)
 *     and never updates on conflict, so by giving later text a later partId
 *     we ensure DB ordinal matches the SDK's content order: text₁ < tool <
 *     text₂. Without this, all text collapses into the first text partId
 *     and renders before all tools after a refresh.
 *
 * Tool correlation:
 *   - `tool_use` blocks (inside an `assistant` message) and `tool_call`
 *     events both share `call_id`. Both update the same tool part keyed
 *     by callId. The first sighting opens the part in `pending` state; a
 *     `tool_call` with `status: "running"` flips it to `running`; a
 *     `status: "completed"` / `"error"` flips it to terminal with the
 *     `result` stringified. Late-arriving `running` after `completed` is
 *     ignored (`finalized` latch).
 *
 * The adapter is DB/bus-free — the runtime injects a `PartEmitter` that
 * wraps `Database.withEffects` + `bus()` calls. Mirrors claude-code's
 * adapter shape.
 */

const log = createLogger("cursor-adapter")

export interface CursorPartEmitter {
	upsertPart(part: {
		id: string
		type: "text" | "reasoning" | "tool" | "step-start" | "step-finish" | "edit"
		data: Record<string, unknown>
	}): void
	emitDelta(args: { partId: string; delta: string; partType: "text" | "reasoning" }): void
}

export interface CursorAdapterOptions {
	emitter: CursorPartEmitter
	/**
	 * Called when the adapter sees the `system` (init) message — the runtime
	 * persists the SDK-assigned `agent_id` so future turns can resume.
	 */
	onAgentId?: (agentId: string) => void
	/** Fires once per turn on first assistant activity. */
	onActive?: () => void
}

interface ToolState {
	partId: string
	callId: string
	toolName: string
	startedAt: number
	input?: Record<string, unknown>
	finalized: boolean
}

interface TextState {
	partId: string
	buffer: string
}

interface ReasoningState {
	partId: string
	buffer: string
	startedAt: number
}

export interface CursorFinalizeOptions {
	snapshotHash?: string
	editFiles?: Array<{
		path: string
		additions: number
		deletions: number
		status: "added" | "deleted" | "modified"
	}>
	/** Override finishReason; defaults to whatever the last status event reported. */
	finishReason?: string
}

export interface CursorFinalizeResult {
	finishReason: string
	usage?: { input: number; output: number; reasoning?: number }
	durationMs?: number
}

const TERMINAL_STATUSES = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"])

/**
 * Cursor SDK uses PascalCase tool names ("Read", "Shell", "Ls", ...). Loop's
 * frontend renderer registry is keyed by lowercase kebab-case ("read", "bash",
 * "list", ...). The frontend's `normalizeTool()` already lowercases & maps a
 * subset, but we also normalize here at the source so the persisted tool name
 * is consistent — saves the frontend from having to chase Cursor-specific
 * aliases on every render.
 */
const CURSOR_TOOL_NAME_MAP: Record<string, string> = {
	read: "read",
	shell: "bash",
	edit: "edit",
	write: "write",
	delete: "delete",
	glob: "glob",
	grep: "grep",
	ls: "list",
	readlints: "readlints",
	semsearch: "grep",
	createplan: "plan-write",
	updatetodos: "todowrite",
	task: "task",
	mcp: "mcp",
}

function mapCursorToolName(rawName: string): string {
	if (!rawName) return rawName
	const lower = rawName.toLowerCase()
	return CURSOR_TOOL_NAME_MAP[lower] ?? lower
}

/**
 * Translate Cursor SDK tool inputs into the field names Loop's frontend
 * renderers expect. Several Cursor tools use arg names that don't match
 * Loop's tool-call.tsx renderers, so without remapping the renderer shows
 * the tool but with empty/missing fields ("Grep "" 0 matches").
 *
 * Verified against Cursor SDK 1.0.11 tool-call-types Zod schemas + a live
 * agent.send() probe on 2026-05-01.
 */
function transformCursorToolInput(
	rawName: string,
	input: Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (!input) return {}
	const lower = rawName.toLowerCase()

	// glob: globPattern → pattern, targetDirectory → path
	if (lower === "glob") {
		const out: Record<string, unknown> = {}
		const pattern = input.globPattern ?? input.pattern
		const path = input.targetDirectory ?? input.path
		if (pattern !== undefined) out.pattern = pattern
		if (path !== undefined) out.path = path
		return out
	}

	// semSearch: query → pattern, targetDirectories[0] → path
	// Loop has no semantic-search renderer, so we route to the grep renderer
	// (via name mapping) and mirror the field names so the UI shows the query.
	if (lower === "semsearch") {
		const out: Record<string, unknown> = {}
		if (typeof input.query === "string") out.pattern = input.query
		const dirs = input.targetDirectories
		if (Array.isArray(dirs) && dirs.length > 0) out.path = dirs[0]
		return out
	}

	// readLints: paths (array) → path (single string, joined for display)
	if (lower === "readlints") {
		const out: Record<string, unknown> = {}
		const paths = input.paths
		if (Array.isArray(paths)) out.path = paths.join(", ")
		else if (typeof paths === "string") out.path = paths
		return out
	}

	// shell: workingDirectory → cwd (Loop's BashToolCall uses cwd; the SDK
	// schema names the field workingDirectory).
	if (lower === "shell") {
		const out: Record<string, unknown> = {}
		if (typeof input.command === "string") out.command = input.command
		const wd = input.workingDirectory ?? input.cwd
		if (typeof wd === "string") out.cwd = wd
		if (typeof input.timeout === "number") out.timeout = input.timeout
		return out
	}

	// write: fileText → content (Loop's write/edit renderer reads `content`
	// and `path`/`file_path`, not `fileText`).
	if (lower === "write") {
		const out: Record<string, unknown> = {}
		if (typeof input.path === "string") out.path = input.path
		const text = input.fileText ?? input.content
		if (typeof text === "string") out.content = text
		return out
	}

	// updateTodos: leave as-is (Loop's todowrite renderer reads input.todos).
	// task: leave as-is — fields description/prompt match Loop.
	// read/edit/grep/ls/delete/createPlan/mcp: schema-compatible.
	return input
}

type LastBlockKind = "text" | "reasoning" | "tool" | undefined

export function createCursorAdapter(opts: CursorAdapterOptions) {
	const { emitter, onAgentId, onActive } = opts

	let textState: TextState | undefined
	let reasoningState: ReasoningState | undefined
	const toolsByCallId = new Map<string, ToolState>()
	let stepStartEmitted = false
	let activeFired = false
	let finalStatus: string | undefined
	let preSnapshotHash: string | undefined
	let agentIdSeen: string | undefined
	let lastBlockKind: LastBlockKind

	function ensureStepStart(): void {
		if (stepStartEmitted) return
		stepStartEmitted = true
		emitter.upsertPart({
			id: ulid(),
			type: "step-start",
			data: {
				type: "step-start",
				...(preSnapshotHash ? { snapshot: preSnapshotHash } : {}),
			},
		})
	}

	function fireActive(): void {
		if (activeFired) return
		activeFired = true
		onActive?.()
	}

	function noteAgentId(id: string | undefined): void {
		if (!id || agentIdSeen === id) return
		agentIdSeen = id
		onAgentId?.(id)
	}

	/**
	 * Persist the current text part with its full accumulated buffer, then
	 * clear `textState` so the next text chunk allocates a fresh partId.
	 * Called on block boundaries (text → tool / reasoning) and at finalize.
	 */
	function flushTextFinal(): void {
		if (textState?.buffer) {
			emitter.upsertPart({
				id: textState.partId,
				type: "text",
				data: { type: "text", text: textState.buffer },
			})
		}
		textState = undefined
	}

	/** Same as flushTextFinal but for reasoning. */
	function flushReasoningFinal(): void {
		if (reasoningState?.buffer) {
			emitter.upsertPart({
				id: reasoningState.partId,
				type: "reasoning",
				data: {
					type: "reasoning",
					text: reasoningState.buffer,
					time: { start: reasoningState.startedAt, end: Date.now() },
				},
			})
		}
		reasoningState = undefined
	}

	/** Append to the running text part — emit delta only, no DB write. */
	function appendText(text: string): void {
		if (!text) return
		ensureStepStart()
		fireActive()

		// Block transition: if the previous block was a tool or reasoning,
		// close the current text/reasoning state so the next text chunk gets
		// a NEW partId placed AFTER the tool/reasoning in DB ordinal order.
		if (lastBlockKind && lastBlockKind !== "text") {
			flushTextFinal()
			flushReasoningFinal()
		}
		if (!textState) {
			textState = { partId: ulid(), buffer: "" }
		}
		textState.buffer += text
		emitter.emitDelta({ partId: textState.partId, delta: text, partType: "text" })
		lastBlockKind = "text"
	}

	/** Append to the running reasoning part — emit delta only, no DB write. */
	function appendReasoning(text: string): void {
		if (!text) return
		ensureStepStart()
		fireActive()

		if (lastBlockKind && lastBlockKind !== "reasoning") {
			flushTextFinal()
			flushReasoningFinal()
		}
		if (!reasoningState) {
			reasoningState = { partId: ulid(), buffer: "", startedAt: Date.now() }
		}
		reasoningState.buffer += text
		emitter.emitDelta({ partId: reasoningState.partId, delta: text, partType: "reasoning" })
		lastBlockKind = "reasoning"
	}

	/** Open or update a tool part keyed by callId. */
	function upsertTool(args: {
		callId: string
		toolName: string
		state: "pending" | "running" | "completed" | "error"
		input?: Record<string, unknown>
		output?: string
		error?: string
		endedAt?: number
	}): void {
		ensureStepStart()
		fireActive()

		// Flush any pending text/reasoning so they're persisted with EARLIER
		// partIds than this tool. Without this, late text upserts would race
		// the tool's upsert and end up with a higher DB ordinal — exactly the
		// "tools at bottom" bug.
		flushTextFinal()
		flushReasoningFinal()

		let tool = toolsByCallId.get(args.callId)
		if (!tool) {
			tool = {
				partId: ulid(),
				callId: args.callId,
				toolName: args.toolName,
				startedAt: Date.now(),
				input: args.input && hasKeys(args.input) ? args.input : undefined,
				finalized: false,
			}
			toolsByCallId.set(args.callId, tool)
		} else if (args.input && hasKeys(args.input)) {
			// Only overwrite when the newer event has STRICTLY more keys than
			// what we already have. The `tool_use` block in the assistant
			// message often carries fuller input than the subsequent
			// `tool_call` events (which may echo a partial view), so naive
			// overwriting drops fields. Empty/undefined args from a status
			// transition never overwrite.
			const existingKeys = tool.input ? Object.keys(tool.input).length : 0
			const newKeys = Object.keys(args.input).length
			if (newKeys >= existingKeys) {
				tool.input = args.input
			}
		}
		// Once we've seen completed/error, ignore later state updates so a
		// late "running" doesn't overwrite the terminal state.
		if (tool.finalized) {
			lastBlockKind = "tool"
			return
		}
		if (args.state === "completed" || args.state === "error") tool.finalized = true

		const data: Record<string, unknown> = {
			type: "tool",
			callId: tool.callId,
			tool: tool.toolName,
			state: args.state,
			time: {
				start: tool.startedAt,
				...(args.endedAt !== undefined ? { end: args.endedAt } : {}),
			},
		}
		// Only emit `input` when it actually has fields. Empty `{}` confuses
		// the frontend renderers that look for specific keys (path, command,
		// pattern) and ends up showing "Tool  " with blanks.
		if (tool.input && hasKeys(tool.input)) data.input = tool.input
		if (args.output !== undefined) data.output = args.output
		if (args.error !== undefined) data.error = args.error
		emitter.upsertPart({ id: tool.partId, type: "tool", data })
		lastBlockKind = "tool"
	}

	function hasKeys(obj: Record<string, unknown> | undefined): boolean {
		return obj !== undefined && Object.keys(obj).length > 0
	}

	function handleSystem(msg: SDKSystemMessage): void {
		if (msg.subtype === "init") {
			noteAgentId(msg.agent_id)
		}
	}

	function handleAssistant(msg: SDKAssistantMessage): void {
		noteAgentId(msg.agent_id)
		for (const block of msg.message.content) {
			if (block.type === "text") {
				appendText(block.text)
			} else if (block.type === "tool_use") {
				const rawInput =
					block.input && typeof block.input === "object"
						? (block.input as Record<string, unknown>)
						: {}
				upsertTool({
					callId: block.id,
					toolName: mapCursorToolName(block.name),
					state: "pending",
					input: transformCursorToolInput(block.name, rawInput),
				})
			}
		}
	}

	function handleThinking(msg: SDKThinkingMessage): void {
		noteAgentId(msg.agent_id)
		appendReasoning(msg.text)
	}

	function handleToolCall(msg: SDKToolUseMessage): void {
		noteAgentId(msg.agent_id)
		const rawArgs =
			msg.args && typeof msg.args === "object" ? (msg.args as Record<string, unknown>) : undefined
		const args = rawArgs ? transformCursorToolInput(msg.name, rawArgs) : undefined

		// SDK tool_call status: "running" | "completed" | "error"
		// Loop tool state:    pending | running | completed | error
		const state =
			msg.status === "running"
				? ("running" as const)
				: msg.status === "completed"
					? ("completed" as const)
					: ("error" as const)

		const truncated = (msg as { truncated?: { args?: boolean; result?: boolean } }).truncated
		const truncatedSuffix = truncated?.result ? "\n[output truncated]" : ""

		const output =
			state === "completed" && msg.result !== undefined
				? safeExtractToolOutput(msg.name, msg.result) + truncatedSuffix
				: undefined
		const errorText =
			state === "error" && msg.result !== undefined
				? safeExtractToolOutput(msg.name, msg.result) + truncatedSuffix
				: undefined

		upsertTool({
			callId: msg.call_id,
			toolName: mapCursorToolName(msg.name),
			state,
			input: args,
			output,
			error: errorText,
			endedAt: state === "running" ? undefined : Date.now(),
		})
	}

	/**
	 * `extractToolOutput` walks an unstable SDK result shape — every defensive
	 * cast inside it is best-effort. Wrap with try/catch so a malformed
	 * payload can't poison the whole stream. On failure we fall back to
	 * stringifying so the user sees raw data instead of a stuck spinner.
	 */
	function safeExtractToolOutput(toolName: string, result: unknown): string {
		try {
			return extractToolOutput(toolName, result)
		} catch (err) {
			log.warn("extractToolOutput threw — falling back to raw stringify", {
				toolName,
				error: err instanceof Error ? err.message : String(err),
			})
			try {
				return JSON.stringify(result, null, 2)
			} catch {
				return String(result)
			}
		}
	}

	function handleStatus(msg: SDKStatusMessage): void {
		noteAgentId(msg.agent_id)
		if (TERMINAL_STATUSES.has(msg.status)) {
			finalStatus = msg.status
		}
	}

	function handleTask(_msg: SDKTaskMessage): void {
		// Subagent progress. The parent's `task` tool_call event already
		// renders a tool part; subagent activity is internal to that tool.
		// We deliberately don't render duplicate timeline entries.
	}

	function handle(msg: SDKMessage): void {
		try {
			switch (msg.type) {
				case "system":
					handleSystem(msg)
					return
				case "assistant":
					handleAssistant(msg)
					return
				case "thinking":
					handleThinking(msg)
					return
				case "tool_call":
					handleToolCall(msg)
					return
				case "status":
					handleStatus(msg)
					return
				case "task":
					handleTask(msg)
					return
				case "user":
				case "request":
					return
				default:
					log.debug("Unhandled SDK message type", {
						type: (msg as { type?: string }).type,
					})
			}
		} catch (err) {
			log.warn("Adapter handler threw", {
				error: err instanceof Error ? err.message : String(err),
				type: (msg as { type?: string }).type,
			})
		}
	}

	function beginTurn(snapshotHash: string | undefined): void {
		preSnapshotHash = snapshotHash
		stepStartEmitted = false
		activeFired = false
		finalStatus = undefined
		textState = undefined
		reasoningState = undefined
		lastBlockKind = undefined
		toolsByCallId.clear()
	}

	function finalize(opts: CursorFinalizeOptions = {}): CursorFinalizeResult {
		// Flush stragglers so anything still buffered hits the DB.
		flushTextFinal()
		flushReasoningFinal()

		// Match the cookbook: do NOT auto-convert unfinalized tools at the
		// end of the run. If the SDK emitted a terminal `tool_call` event,
		// `upsertTool` already wrote it. If it didn't, fabricating a
		// `completed`/`error` record here masks the actual SDK behavior
		// (the previous over-aggressive conversion is what produced
		// state="completed" with no output rows in the DB and made
		// genuine SDK omissions look like successful empty tool calls).
		// Leaving the tool's last-known status in place mirrors what
		// `coding-agent-cli` and `app-builder` do.

		const finishReason = opts.finishReason ?? mapFinishReason(finalStatus)

		emitter.upsertPart({
			id: ulid(),
			type: "step-finish",
			data: {
				type: "step-finish",
				finishReason,
				...(opts.snapshotHash ? { snapshot: opts.snapshotHash } : {}),
			},
		})

		if (opts.editFiles && opts.editFiles.length > 0 && opts.snapshotHash) {
			const totals = opts.editFiles.reduce(
				(acc, f) => ({
					additions: acc.additions + f.additions,
					deletions: acc.deletions + f.deletions,
				}),
				{ additions: 0, deletions: 0 },
			)
			emitter.upsertPart({
				id: ulid(),
				type: "edit",
				data: {
					type: "edit",
					hash: opts.snapshotHash,
					files: opts.editFiles,
					totalAdditions: totals.additions,
					totalDeletions: totals.deletions,
				},
			})
		}

		return { finishReason }
	}

	return { handle, beginTurn, finalize }
}

/**
 * Extract a clean text output from Cursor's tool result. The SDK wraps every
 * result in a `{status: "success" | "error", value | error}` discriminated
 * union (see `@anysphere/cursor-sdk-shared/tool-call-types`). For each tool
 * type we extract the most useful field for Loop's UI:
 *
 *   - shell: stdout (or stderr on non-zero exit)
 *   - read:  content (the actual file text)
 *   - edit:  diffString
 *   - glob:  files joined by newline
 *   - grep:  the matches blob (already pre-formatted)
 *   - ls:    a flattened listing
 *   - write/delete/createPlan/updateTodos: a short summary
 *
 * Falls back to JSON.stringify for unknown shapes so the user always sees
 * something rather than silence.
 */
function extractToolOutput(toolName: string, result: unknown): string {
	if (typeof result === "string") return result
	if (!result || typeof result !== "object") return String(result ?? "")

	const wrapped = result as { status?: string; value?: unknown; error?: unknown }
	const inner = wrapped.status === "success" ? wrapped.value : (wrapped.error ?? wrapped.value)
	const payload = inner !== undefined ? inner : result

	const lower = toolName.toLowerCase()

	if (payload && typeof payload === "object") {
		const v = payload as Record<string, unknown>
		// Shell / Bash
		if (lower.includes("shell") || lower.includes("bash") || lower.includes("command")) {
			const stdout = typeof v.stdout === "string" ? v.stdout : ""
			const stderr = typeof v.stderr === "string" ? v.stderr : ""
			const exit = typeof v.exitCode === "number" ? v.exitCode : undefined
			if (exit !== undefined && exit !== 0) {
				return [stdout, stderr ? `[stderr]\n${stderr}` : "", `[exit ${exit}]`]
					.filter(Boolean)
					.join("\n")
			}
			return stdout || stderr || ""
		}
		// Read
		if (lower === "read" && typeof v.content === "string") return v.content
		// Edit
		if (lower === "edit" && typeof v.diffString === "string") return v.diffString
		// Write / Delete
		if (lower === "write" && typeof v.path === "string") {
			const lines = typeof v.linesCreated === "number" ? v.linesCreated : 0
			return `Wrote ${v.path} (${lines} lines)`
		}
		if (lower === "delete" && typeof v.fileSize === "number") {
			return `Deleted file (${v.fileSize} bytes)`
		}
		// Glob
		if (lower === "glob" && Array.isArray(v.files)) {
			const total = typeof v.totalFiles === "number" ? v.totalFiles : v.files.length
			const truncated = v.clientTruncated || v.ripgrepTruncated
			const header = truncated
				? `${v.files.length} of ${total} matches (truncated)`
				: `${total} matches`
			return [header, ...v.files].join("\n")
		}
		// Grep — server returns a content blob already formatted
		if (lower === "grep" && typeof v.results === "string") return v.results
		// SemSearch
		if (lower === "semsearch" && typeof v.results === "string") return v.results
		// Ls
		if (lower === "ls" && v.directoryTreeRoot) {
			return formatLsTree(v.directoryTreeRoot)
		}
		// ReadLints
		if (lower === "readlints" && Array.isArray(v.fileDiagnostics)) {
			return formatLints(v.fileDiagnostics)
		}
		// UpdateTodos
		if (lower === "updatetodos" && Array.isArray(v.todos)) {
			return v.todos
				.map((t) => {
					const todo = t as { content?: string; status?: string }
					return `[${todo.status ?? "?"}] ${todo.content ?? ""}`
				})
				.join("\n")
		}
		// MCP — content is an array of {text|image} blocks
		if (lower === "mcp" && Array.isArray(v.content)) {
			return v.content
				.map((c) => {
					const block = c as { text?: { text?: string } }
					return block.text?.text ?? ""
				})
				.filter(Boolean)
				.join("\n")
		}
	}

	// Fallback: pretty-printed JSON. Better than nothing.
	try {
		return JSON.stringify(payload, null, 2)
	} catch {
		return String(payload)
	}
}

/** Best-effort flatten of an LsDirectoryTreeNode into a path listing. */
function formatLsTree(root: unknown, prefix = ""): string {
	if (!root || typeof root !== "object") return ""
	const node = root as { name?: string; path?: string; children?: unknown[] }
	const path = node.path ?? node.name ?? ""
	const lines: string[] = []
	if (path) lines.push(prefix + path)
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			const sub = formatLsTree(child, `${prefix}  `)
			if (sub) lines.push(sub)
		}
	}
	return lines.join("\n")
}

function formatLints(fileDiagnostics: unknown[]): string {
	const out: string[] = []
	for (const f of fileDiagnostics) {
		const file = f as { path?: string; diagnostics?: unknown[] }
		if (!file.path || !Array.isArray(file.diagnostics)) continue
		out.push(`${file.path}:`)
		for (const d of file.diagnostics) {
			const diag = d as { severity?: string; range?: { start?: { line?: number } } }
			const line = diag.range?.start?.line
			out.push(`  ${diag.severity ?? "info"}${line !== undefined ? ` L${line + 1}` : ""}`)
		}
	}
	return out.join("\n")
}

function mapFinishReason(status: string | undefined): string {
	switch (status) {
		case "FINISHED":
			return "stop"
		case "CANCELLED":
			return "abort"
		case "ERROR":
			return "error"
		case "EXPIRED":
			return "error"
		default:
			return "stop"
	}
}
