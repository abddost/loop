import { spawn } from "node:child_process"
import { createLogger } from "../../logger"

const log = createLogger("cursor:runtime")

// ─── Types ──────────────────────────────────────────────────────

/**
 * OpenAI-compatible wire types we see on POST /v1/chat/completions.
 * The AI SDK's openai-compatible provider converts its internal AI-SDK
 * message parts into this shape before the request hits our fetch.
 */
export interface OpenAiContentPart {
	type: string
	text?: string
	image_url?: { url: string }
	[k: string]: unknown
}

export interface OpenAiToolCall {
	id: string
	type?: "function"
	function: { name: string; arguments: string }
}

export interface OpenAiMessage {
	role: "system" | "user" | "assistant" | "tool"
	content?: string | OpenAiContentPart[] | null
	tool_calls?: OpenAiToolCall[]
	tool_call_id?: string
}

export interface OpenAiTool {
	type?: "function"
	function?: { name: string; description?: string; parameters?: unknown }
	name?: string
	description?: string
	parameters?: unknown
}

/** cursor-agent stream-json event shape. */
export interface CursorStreamEvent {
	type: string
	subtype?: string
	timestamp_ms?: number
	session_id?: string
	call_id?: string
	text?: string
	message?: {
		content: Array<{ type: string; text?: string; thinking?: string }>
	}
	tool_call?: Record<string, { args?: unknown; result?: unknown }>
	is_error?: boolean
	error?: { message?: string; code?: number | string; details?: string }
	/** Terminal `result` event carries aggregate usage for the whole turn. */
	usage?: {
		inputTokens?: number
		outputTokens?: number
		cacheReadTokens?: number
		cacheWriteTokens?: number
	}
	duration_ms?: number
	duration_api_ms?: number
}

// ─── ANSI + Error Classification ────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: need to strip ANSI escape codes
const ANSI_RE = /[\u001B\u009B][#();?[]*(?:\d{1,4}(?:;\d{0,4})*)?[\d<=>A-ORZcf-nqry]/g

export function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, "")
}

export type CursorErrorType = "quota" | "auth" | "network" | "model" | "unknown"

export interface CursorError {
	type: CursorErrorType
	recoverable: boolean
	message: string
	userMessage: string
	suggestion?: string
}

export function classifyCursorError(stderr: string): CursorError {
	const clean = stripAnsi(stderr).trim()

	if (/usage limit|hit your usage limit/i.test(clean)) {
		return {
			type: "quota",
			recoverable: false,
			message: clean,
			userMessage: "You've hit your Cursor usage limit",
			suggestion: "Switch models (try `auto`) or set a Spend Limit in Cursor settings",
		}
	}

	if (/not logged in|unauthorized|\bauth\b/i.test(clean)) {
		return {
			type: "auth",
			recoverable: false,
			message: clean,
			userMessage: "Not authenticated with Cursor",
			suggestion: "Sign in from provider settings or run: cursor-agent login",
		}
	}

	if (/ECONNREFUSED|network error|fetch failed/i.test(clean)) {
		return {
			type: "network",
			recoverable: true,
			message: clean,
			userMessage: "Connection to Cursor failed",
			suggestion: "Check your internet connection and retry",
		}
	}

	if (/model not found|invalid model|Cannot use this model/i.test(clean)) {
		return {
			type: "model",
			recoverable: false,
			message: clean,
			userMessage: "Requested model is not available on your Cursor plan",
			suggestion: "Switch to `auto` or another available model",
		}
	}

	return {
		type: "unknown",
		recoverable: /timeout|ETIMEDOUT/i.test(clean),
		message: clean,
		userMessage: clean.slice(0, 200) || "cursor-agent error",
	}
}

export function formatCursorError(err: CursorError): string {
	let out = err.userMessage
	if (err.suggestion) out += `\n\nSuggestion: ${err.suggestion}`
	return out
}

// ─── LineBuffer ─────────────────────────────────────────────────

/**
 * Byte-safe NDJSON line buffer. Handles partial UTF-8 chunks (via
 * stream-mode decoder) and both LF/CRLF line endings.
 */
export class LineBuffer {
	private buffer = ""
	private decoder = new TextDecoder()

	push(chunk: Uint8Array | string): string[] {
		const text = typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true })
		if (!text) return []
		this.buffer += text
		const parts = this.buffer.split("\n")
		this.buffer = parts.pop() ?? ""

		const lines: string[] = []
		for (const raw of parts) {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
			if (line.trim()) lines.push(line)
		}
		return lines
	}

	flush(): string[] {
		if (!this.buffer.trim()) {
			this.buffer = ""
			return []
		}
		const line = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer
		this.buffer = ""
		return line.trim() ? [line] : []
	}
}

// ─── DeltaTracker ───────────────────────────────────────────────

/**
 * Emit only the new suffix when cursor-agent streams accumulated text.
 * Handles prefix drift (unicode/whitespace normalization) by falling
 * back to longest-common-prefix rather than re-emitting everything.
 */
export class DeltaTracker {
	private lastText = ""
	private lastThinking = ""

	nextText(value: string): string {
		const delta = this.diff(this.lastText, value)
		this.lastText = value
		return delta
	}

	nextThinking(value: string): string {
		const delta = this.diff(this.lastThinking, value)
		this.lastThinking = value
		return delta
	}

	private diff(previous: string, current: string): string {
		if (!previous) return current
		if (current.startsWith(previous)) return current.slice(previous.length)
		if (previous.startsWith(current)) return ""
		let i = 0
		const minLen = Math.min(previous.length, current.length)
		while (i < minLen && previous[i] === current[i]) i++
		return current.slice(i)
	}
}

// ─── PartialAccumulator ─────────────────────────────────────────

/**
 * Dedup cursor-agent partial text streams. Different models use
 * different emission strategies:
 *   1. **auto**: emits text as large blocks + a pre-tool-call re-emission
 *      of the same block ("flush"). Two consecutive partials with the same
 *      text → the second is redundant.
 *   2. **composer-2**: emits text token-by-token as incremental chunks,
 *      then a single full-accumulated-snapshot partial right before the
 *      tool_call. If we naively emit everything we get the full response
 *      twice (streamed + snapshot).
 *
 * Algorithm:
 *   - If `text === emitted` → identical snapshot, skip.
 *   - If `text.startsWith(emitted)` and we've emitted anything → it's a
 *     progressive snapshot; emit only the new suffix.
 *   - Otherwise → treat as an incremental chunk, append and emit.
 *
 * `reset()` is called at each tool_call / non-text boundary so a
 * legitimate new text segment after a tool call starts fresh.
 */
export class PartialAccumulator {
	private emitted = ""

	next(text: string): string {
		if (!text) return ""
		if (text === this.emitted) return ""
		if (this.emitted && text.startsWith(this.emitted)) {
			const delta = text.slice(this.emitted.length)
			this.emitted = text
			return delta
		}
		this.emitted += text
		return text
	}

	reset(): void {
		this.emitted = ""
	}
}

// ─── Tool Name Resolution ───────────────────────────────────────

/**
 * Cursor-agent emits tool-call events with varying naming conventions
 * (readFileToolCall, run_terminal_cmd, searchFiles, etc.). This map
 * canonicalises them to Loop's tool names so the AI SDK can dispatch
 * them to the right executor. Ported from opencode-cursor.
 */
const TOOL_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
	// bash
	["runcommand", "bash"],
	["executecommand", "bash"],
	["runterminalcommand", "bash"],
	["runterminalcmd", "bash"],
	["terminalcommand", "bash"],
	["shellcommand", "bash"],
	["shell", "bash"],
	["terminal", "bash"],
	["bashcommand", "bash"],
	["runbash", "bash"],
	["executebash", "bash"],
	// glob
	["findfiles", "glob"],
	["searchfiles", "glob"],
	["globfiles", "glob"],
	["fileglob", "glob"],
	["matchfiles", "glob"],
	// grep
	["search", "grep"],
	["searchtext", "grep"],
	["codesearch", "grep"],
	["textsearch", "grep"],
	["filesearch", "grep"],
	// read
	["readfile", "read"],
	["viewfile", "read"],
	["openfile", "read"],
	["catfile", "read"],
	// write
	["writefile", "write"],
	["createfile", "write"],
	["newfile", "write"],
	// edit
	["editfile", "edit"],
	["modifyfile", "edit"],
	["patchfile", "edit"],
	["replace", "edit"],
	["replaceinfile", "edit"],
	["searchreplace", "edit"],
	// task / subagents
	["delegatetask", "task"],
	["delegate", "task"],
	["runtask", "task"],
	["subagent", "task"],
	["invokeagent", "task"],
	["callagent", "task"],
	// todos
	["updatetodos", "todowrite"],
	["updatetodostoolcall", "todowrite"],
	["writetodos", "todowrite"],
	["readtodos", "todoread"],
	["readtodostoolcall", "todoread"],
	// web
	["fetchurl", "web_fetch"],
	["webfetch", "web_fetch"],
	["websearch", "web_search"],
	["searchweb", "web_search"],
])

export function normalizeAliasKey(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Resolve a cursor-emitted tool name to one of Loop's allowed tool names.
 * Returns null if unresolvable — in that case, cursor handles the call
 * natively and we don't intercept.
 */
export function resolveToolName(rawName: string, allowed: Set<string>): string | null {
	if (allowed.has(rawName)) return rawName

	const normalized = normalizeAliasKey(rawName)
	for (const name of allowed) {
		if (normalizeAliasKey(name) === normalized) return name
	}

	const canonical = TOOL_NAME_ALIASES.get(normalized)
	if (!canonical) return null

	const canonicalNorm = normalizeAliasKey(canonical)
	for (const name of allowed) {
		if (normalizeAliasKey(name) === canonicalNorm) return name
	}
	return null
}

/** Extract the first tool name referenced in a tool_call event. */
export function inferCursorToolName(event: CursorStreamEvent): string {
	const key = Object.keys(event.tool_call ?? {})[0]
	if (!key) return ""
	if (key.endsWith("ToolCall")) {
		const base = key.slice(0, -"ToolCall".length)
		return base.charAt(0).toLowerCase() + base.slice(1)
	}
	return key
}

export function extractAllowedToolNames(tools: OpenAiTool[] | undefined): Set<string> {
	const set = new Set<string>()
	if (!Array.isArray(tools)) return set
	for (const t of tools) {
		const name = t.function?.name ?? t.name
		if (typeof name === "string" && name.length > 0) set.add(name)
	}
	return set
}

// ─── Tool Argument Translation ──────────────────────────────────

/**
 * Cursor-agent calls tools using its OWN native tool schemas (e.g.
 * `globToolCall` with `globPattern`+`targetDirectory`, `shellToolCall`
 * with `workingDirectory`+`simpleCommands`+...). Loop's registered
 * tools use different arg names. This module translates cursor's arg
 * shape into Loop's expected shape.
 *
 * The transform for each tool is keyed by Loop's canonical tool name
 * (after alias resolution). Rules:
 *   - `rename`: cursor arg → Loop arg
 *   - `drop`: cursor-only fields Loop doesn't accept
 *   - `defaults`: required Loop fields to inject when cursor didn't
 *     supply them (e.g. bash's required `description`)
 */
interface ArgTransform {
	rename?: Record<string, string>
	drop?: readonly string[]
	defaults?: (rawArgs: Record<string, unknown>) => Record<string, unknown>
}

const TOOL_ARG_TRANSFORMS = new Map<string, ArgTransform>([
	[
		"bash",
		{
			drop: [
				"workingDirectory",
				"toolCallId",
				"simpleCommands",
				"hasInputRedirect",
				"hasOutputRedirect",
				"hasPipe",
				"parsingResult",
			],
			defaults: (args) => {
				const cmd = typeof args.command === "string" ? args.command : ""
				return {
					description: cmd ? cmd.split("\n")[0].slice(0, 80) : "cursor command",
				}
			},
		},
	],
	["glob", { rename: { globPattern: "pattern", targetDirectory: "path" } }],
	[
		"grep",
		{
			rename: { searchPattern: "pattern", targetDirectory: "path" },
			drop: ["caseInsensitive", "multiline", "offset", "limit"],
		},
	],
	["read", { rename: { filePath: "path", targetFile: "path" }, drop: ["toolCallId"] }],
	["write", { rename: { filePath: "path", fileContent: "content" }, drop: ["toolCallId"] }],
	[
		"edit",
		{
			rename: {
				filePath: "path",
				oldString: "old_string",
				newString: "new_string",
				replaceAll: "replace_all",
			},
			drop: ["toolCallId"],
		},
	],
	["list", { rename: { targetDirectory: "path", directory: "path" }, drop: ["toolCallId"] }],
	[
		"task",
		{
			rename: { agentType: "subagent_type", subagentType: "subagent_type" },
			drop: ["toolCallId"],
			// Loop's task tool accepts cursor-native names (browser_use/shell/vm)
			// and maps them to Loop agents. If cursor sends nothing or an
			// unrecognised value, fall back to `explore` — the one cursor-native
			// name that also matches a Loop agent directly, keeping the default
			// safe (read-only, cheap) for ambiguous calls.
			defaults: (args) => {
				const known = new Set([
					"build",
					"plan",
					"explore",
					"universal",
					"browser_use",
					"shell",
					"vm",
				])
				const raw = args.subagent_type ?? args.agentType ?? args.subagentType
				if (typeof raw === "string" && known.has(raw)) return {}
				return { subagent_type: "explore" }
			},
		},
	],
])

export function transformCursorArgs(
	loopToolName: string,
	rawArgs: unknown,
): Record<string, unknown> {
	const inputObj: Record<string, unknown> =
		rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
			? (rawArgs as Record<string, unknown>)
			: {}

	const transform = TOOL_ARG_TRANSFORMS.get(loopToolName)
	if (!transform) return inputObj

	const drop = new Set(transform.drop ?? [])
	const rename = transform.rename ?? {}
	const out: Record<string, unknown> = {}

	for (const [key, value] of Object.entries(inputObj)) {
		if (drop.has(key)) continue
		const loopKey = rename[key] ?? key
		out[loopKey] = value
	}

	if (transform.defaults) {
		const filled = transform.defaults(inputObj)
		for (const [k, v] of Object.entries(filled)) {
			if (!(k in out) || out[k] === undefined || out[k] === "") out[k] = v
		}
	}

	return out
}

// ─── Prompt Builder ─────────────────────────────────────────────

/** Subagent types advertised to cursor-agent. Matches cursor-agent's own
 *  native enum (explore / browser_use / shell) so its internal task-tool
 *  validator never rejects what the LLM picks up from our prompt. Loop's
 *  task tool accepts these and maps them back to Loop agents — see
 *  `CURSOR_NATIVE_SUBAGENT_MAP` in `src/server/tool/builtin/task.ts`. */
const LOOP_SUBAGENT_TYPES: readonly string[] = ["explore", "browser_use", "shell"]

function hasToolNamed(tools: OpenAiTool[], name: string): boolean {
	return tools.some((t) => (t.function?.name ?? t.name ?? "").toLowerCase() === name)
}

/**
 * Serialize an OpenAI-style transcript into cursor-agent's plain-text
 * stdin prompt. Preserves tool_calls and tool results across turns so
 * cursor has the full conversation context.
 *
 * Format (adapted from opencode-cursor/prompt-builder.ts):
 *   SYSTEM: <tool manifest + subagent hint>
 *   USER: ...
 *   ASSISTANT: [text]
 *   tool_call(id: X, name: Y, args: {...})
 *   TOOL_RESULT (call_id: X): <output>
 *   [continuation suffix if trailing tool results]
 */
export interface PromptBuildOptions {
	/** When true, skip the tool manifest — cursor remembers it from a
	 *  prior turn in the same --resume'd session. */
	resume?: boolean
}

export function buildCursorPrompt(
	messages: OpenAiMessage[],
	tools: OpenAiTool[],
	options: PromptBuildOptions = {},
): string {
	const lines: string[] = []

	if (!options.resume && tools.length > 0) {
		const descs = tools
			.map((t) => {
				const fn = t.function ?? (t as OpenAiTool)
				const name = fn.name ?? "unknown"
				const desc = fn.description ?? ""
				const params = fn.parameters ? JSON.stringify(fn.parameters) : "{}"
				return `- ${name}: ${desc}\n  Parameters: ${params}`
			})
			.join("\n")

		const intro: string[] = [
			"SYSTEM: You have access to the following tools. When you need to use one, respond with a tool_call in the standard OpenAI format.",
			"Tool guidance: prefer the dedicated tools above over shell commands where a dedicated tool exists (e.g. use `read` instead of `cat`, `glob` instead of `find`, `grep` instead of `rg`). Use `write`/`edit` for file changes, `bash` only for commands/tests/build steps.",
		]

		if (hasToolNamed(tools, "task")) {
			intro.push(
				`For multi-step exploration or research that spans several files, delegate to the \`task\` tool instead of calling many \`read\`/\`glob\`/\`grep\` tools yourself — it runs a sub-agent in an isolated context and returns only the summary, keeping your working context small. Set \`subagent_type\` to one of: ${LOOP_SUBAGENT_TYPES.join(", ")}. Do not omit \`subagent_type\`.`,
			)
		} else {
			// When task is NOT in our advertised tools, this session is either
			// a subagent itself or an agent that shouldn't recurse. cursor-agent
			// still has an *internal* task tool baked into its binary, so the
			// LLM may reach for it reflexively and then narrate a
			// "subagent launch failed because subagent_type" error when its own
			// validator rejects the call. Forbid it explicitly.
			intro.push(
				"You are running inside a sub-agent session. Do NOT call the `task` tool — it is unavailable here. Complete the work yourself using the tools listed above (read/grep/glob/bash/etc.).",
			)
		}

		lines.push(`${intro.join("\n")}\n\nAvailable tools:\n${descs}`)
	}

	for (const m of messages) {
		const role = typeof m.role === "string" ? m.role : "user"

		if (role === "tool") {
			const callId = m.tool_call_id ?? "unknown"
			const body = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
			lines.push(`TOOL_RESULT (call_id: ${callId}): ${body}`)
			continue
		}

		if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
			const tcLines = m.tool_calls.map((tc) => {
				const fn = tc.function ?? ({} as OpenAiToolCall["function"])
				return `tool_call(id: ${tc.id ?? "?"}, name: ${fn.name ?? "?"}, args: ${fn.arguments ?? "{}"})`
			})
			const text = typeof m.content === "string" ? m.content : ""
			lines.push(`ASSISTANT: ${text ? `${text}\n` : ""}${tcLines.join("\n")}`)
			continue
		}

		const content = m.content
		if (typeof content === "string") {
			if (content.length > 0) lines.push(`${role.toUpperCase()}: ${content}`)
		} else if (Array.isArray(content)) {
			const textParts = content
				.filter(
					(p): p is { type: "text"; text: string } =>
						!!p && typeof p === "object" && p.type === "text" && typeof p.text === "string",
				)
				.map((p) => p.text)
			if (textParts.length) lines.push(`${role.toUpperCase()}: ${textParts.join("\n")}`)
		}
	}

	const hasToolResults = messages.some((m) => m.role === "tool")
	if (hasToolResults) {
		lines.push(
			"The above tool calls have been executed. Continue your response based on these results.",
		)
	}

	return lines.join("\n\n")
}

// ─── Stream Converter ───────────────────────────────────────────

interface StreamMeta {
	id: string
	model: string
	created: number
}

function sseData(payload: object): string {
	return `data: ${JSON.stringify(payload)}\n\n`
}

function chunkObj(
	meta: StreamMeta,
	delta: Record<string, unknown>,
	finishReason: string | null = null,
): object {
	return {
		id: meta.id,
		object: "chat.completion.chunk",
		created: meta.created,
		model: meta.model,
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	}
}

function toolCallChunks(
	meta: StreamMeta,
	toolCall: { id: string; name: string; arguments: string },
): object[] {
	return [
		chunkObj(meta, {
			role: "assistant",
			tool_calls: [
				{
					index: 0,
					id: toolCall.id,
					type: "function",
					function: { name: toolCall.name, arguments: toolCall.arguments },
				},
			],
		}),
		chunkObj(meta, {}, "tool_calls"),
	]
}

/**
 * Build an OpenAI-compatible usage chunk from cursor-agent's `result`
 * event. The `@ai-sdk/openai-compatible` provider reads:
 *   - `usage.prompt_tokens`            → AI SDK `inputTokens`
 *   - `usage.completion_tokens`        → AI SDK `outputTokens`
 *   - `usage.prompt_tokens_details.cached_tokens` → AI SDK cacheRead
 *
 * cursor-agent reports `inputTokens` as *non-cached* input and
 * `cacheReadTokens` separately. OpenAI semantics put cached tokens
 * *inside* prompt_tokens, so we sum them for the totals — otherwise
 * Loop's UsageBar (`input + output`) would read 0 whenever the whole
 * prompt was cache-hit, which is exactly the bug the user saw.
 */
function usageChunk(
	meta: StreamMeta,
	cursorUsage: CursorStreamEvent["usage"] | null,
): object | null {
	if (!cursorUsage) return null
	const input = cursorUsage.inputTokens ?? 0
	const output = cursorUsage.outputTokens ?? 0
	const cacheRead = cursorUsage.cacheReadTokens ?? 0
	const cacheWrite = cursorUsage.cacheWriteTokens ?? 0
	const promptTokens = input + cacheRead
	const totalTokens = promptTokens + output
	return {
		id: meta.id,
		object: "chat.completion.chunk",
		created: meta.created,
		model: meta.model,
		choices: [],
		usage: {
			prompt_tokens: promptTokens,
			completion_tokens: output,
			total_tokens: totalTokens,
			prompt_tokens_details: { cached_tokens: cacheRead },
			...(cacheWrite > 0 ? { prompt_tokens_details_cache_creation_tokens: cacheWrite } : {}),
		},
	}
}

export interface InterceptedToolCall {
	id: string
	name: string
	arguments: string
}

/**
 * Translates cursor-agent stream-json events to OpenAI SSE chunks.
 * When a tool_call event resolves to one of Loop's registered tools,
 * emits an `intercept` signal so the runtime can terminate the stream
 * with `finish_reason:"tool_calls"` and let Loop execute the tool.
 */
export class CursorStreamConverter {
	private readonly tracker = new DeltaTracker()
	private readonly emittedToolCalls = new Set<string>()
	private sawTextPartials = false
	private sawThinkingPartials = false
	private latestSessionId: string | null = null

	/**
	 * Per-segment accumulators dedup cursor-agent's mixed partial-emission
	 * strategies (see PartialAccumulator for the full taxonomy). They reset
	 * on tool_call/result boundaries so each segment between tool calls is
	 * tracked independently.
	 */
	private readonly textAccumulator = new PartialAccumulator()
	private readonly thinkingAccumulator = new PartialAccumulator()

	constructor(
		private readonly meta: StreamMeta,
		private readonly allowedTools: Set<string>,
	) {}

	get sessionId(): string | null {
		return this.latestSessionId
	}

	handle(event: CursorStreamEvent): {
		sse: string[]
		intercept: InterceptedToolCall | null
	} {
		if (event.session_id) this.latestSessionId = event.session_id
		const sseOut: string[] = []

		const isAssistantText =
			event.type === "assistant" && !!event.message?.content.some((c) => c.type === "text")
		const isAssistantThinking =
			event.type === "assistant" && !!event.message?.content.some((c) => c.type === "thinking")
		const isThinking = event.type === "thinking"

		// ─── assistant text ─────────────
		if (isAssistantText && event.message) {
			const isPartial = typeof event.timestamp_ms === "number"
			const text = event.message.content
				.filter((c) => c.type === "text")
				.map((c) => c.text ?? "")
				.join("")
			if (isPartial) {
				const delta = this.textAccumulator.next(text)
				if (delta) {
					this.sawTextPartials = true
					sseOut.push(sseData(chunkObj(this.meta, { content: delta })))
				}
			} else if (!this.sawTextPartials) {
				// No partials seen — non-partial snapshot carries the full text.
				const delta = this.tracker.nextText(text)
				if (delta) sseOut.push(sseData(chunkObj(this.meta, { content: delta })))
			}
		}

		// ─── thinking ─────────────
		if (isThinking || (isAssistantThinking && event.message)) {
			const isPartial = typeof event.timestamp_ms === "number"
			const text = isThinking
				? (event.text ?? "")
				: (event.message?.content ?? [])
						.filter((c) => c.type === "thinking")
						.map((c) => c.thinking ?? "")
						.join("")
			if (isPartial) {
				const delta = this.thinkingAccumulator.next(text)
				if (delta) {
					this.sawThinkingPartials = true
					sseOut.push(sseData(chunkObj(this.meta, { reasoning_content: delta })))
				}
			} else if (!this.sawThinkingPartials) {
				const delta = this.tracker.nextThinking(text)
				if (delta) sseOut.push(sseData(chunkObj(this.meta, { reasoning_content: delta })))
			}
		}

		// Reset accumulators on non-text event boundaries so a new text
		// segment after a tool_call/result starts fresh.
		if (!isAssistantText && !isThinking && !isAssistantThinking) {
			this.textAccumulator.reset()
			this.thinkingAccumulator.reset()
		}

		// ─── tool call ─────────────
		if (event.type === "tool_call" && event.tool_call) {
			const rawName = inferCursorToolName(event)
			const resolvedName = rawName ? resolveToolName(rawName, this.allowedTools) : null
			const callId = event.call_id ?? "unknown"

			if (this.emittedToolCalls.has(callId)) {
				return { sse: sseOut, intercept: null }
			}

			if (resolvedName) {
				const entry = Object.values(event.tool_call)[0]
				const args = entry?.args

				// Partial tool_call events sometimes arrive with args undefined
				// (cursor is still streaming args). Wait for the next event.
				if (args === undefined) {
					return { sse: sseOut, intercept: null }
				}

				const parsedArgs: unknown =
					typeof args === "string"
						? (() => {
								try {
									return JSON.parse(args)
								} catch {
									return { raw: args }
								}
							})()
						: args

				const translated = transformCursorArgs(resolvedName, parsedArgs)

				log.debug("cursor tool_call", {
					rawName,
					resolvedName,
					callId,
					rawArgs: parsedArgs,
					translated,
				})

				this.emittedToolCalls.add(callId)
				return {
					sse: sseOut,
					intercept: {
						id: callId,
						name: resolvedName,
						arguments: JSON.stringify(translated),
					},
				}
			}
			// Unknown tool — cursor handles it natively. Don't emit anything.
			log.debug("cursor tool_call (not intercepted)", { rawName, callId })
		}

		// ─── error result ─────────────
		if (event.type === "result" && event.is_error && event.error?.message) {
			log.warn("cursor result error", {
				message: event.error.message,
				code: event.error.code,
				details: event.error.details,
			})
			sseOut.push(sseData(chunkObj(this.meta, { content: `\n\nError: ${event.error.message}` })))
		}

		return { sse: sseOut, intercept: null }
	}
}

// ─── Spawn + Stream Orchestration ───────────────────────────────

export interface TurnCompleteInfo {
	sessionId: string | null
	usage: CursorStreamEvent["usage"] | null
	intercepted: boolean
	exitCode: number | null
	/** True when cursor-agent exited non-zero, likely a resume failure if
	 *  `resumeSessionId` was set. Callers should invalidate their cache. */
	errored: boolean
}

export interface RuntimeInput {
	prompt: string
	model: string
	allowedTools: Set<string>
	signal?: AbortSignal | null
	workspace?: string | null
	/** Cursor session id to --resume, or null to spawn fresh. */
	resumeSessionId?: string | null
	/** Called once per turn (on intercept, close, or error) with the
	 *  captured session id and usage. Callers use this to update a
	 *  session cache for subsequent --resume. */
	onTurnComplete?: (info: TurnCompleteInfo) => void
}

export function getCursorAgentCmd(): string {
	return process.env.CURSOR_AGENT_EXECUTABLE || "cursor-agent"
}

/**
 * Spawn cursor-agent and stream its stdout as OpenAI-compatible SSE.
 * When a tool_call for a Loop-registered tool is seen, the stream
 * terminates early with finish_reason:"tool_calls" so Loop's executor
 * runs the tool and the AI SDK re-POSTs with the result on the next turn.
 */
export function createCursorSseStream(input: RuntimeInput): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder()
	const meta: StreamMeta = {
		id: `cursor-${Date.now()}`,
		model: input.model,
		created: Math.floor(Date.now() / 1000),
	}
	const converter = new CursorStreamConverter(meta, input.allowedTools)

	return new ReadableStream({
		start(controller) {
			const cmd = getCursorAgentCmd()
			const args = [
				"--print",
				"--output-format",
				"stream-json",
				"--stream-partial-output",
				"--force",
			]
			if (input.workspace) args.push("--workspace", input.workspace)
			if (input.resumeSessionId) args.push("--resume", input.resumeSessionId)
			args.push("--model", input.model)

			let proc: ReturnType<typeof spawn>
			try {
				proc = spawn(cmd, args, {
					stdio: ["pipe", "pipe", "pipe"],
					shell: process.platform === "win32",
					cwd: input.workspace ?? undefined,
				})
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				emitFatalError(
					controller,
					encoder,
					meta,
					`cursor-agent could not be started: ${msg}\nInstall Cursor editor and ensure cursor-agent is on PATH.`,
				)
				return
			}

			const lineBuffer = new LineBuffer()
			let terminated = false
			let stderrBuffer = ""
			let capturedUsage: CursorStreamEvent["usage"] | null = null
			let capturedDurationMs: number | undefined
			const spawnTime = Date.now()
			let firstTokenTime: number | null = null
			let firstToolCallTime: number | null = null

			const processEvent = (event: CursorStreamEvent): void => {
				// Capture terminal-event metadata before the converter runs —
				// it's what makes the context-window display tick.
				if (event.type === "result" && event.usage) {
					capturedUsage = event.usage
					capturedDurationMs = event.duration_ms
				}
				const { sse, intercept } = converter.handle(event)
				for (const s of sse) controller.enqueue(encoder.encode(s))
				if (intercept) {
					if (!firstToolCallTime) firstToolCallTime = Date.now()
					for (const c of toolCallChunks(meta, intercept)) {
						controller.enqueue(encoder.encode(sseData(c)))
					}
					controller.enqueue(encoder.encode("data: [DONE]\n\n"))
					try {
						controller.close()
					} catch {
						// ignore
					}
					terminate()
				}
			}

			const abort = () => {
				if (proc.killed) return
				try {
					proc.kill()
				} catch {
					// ignore
				}
			}

			input.signal?.addEventListener("abort", abort, { once: true })

			const logPerf = (reason: "intercept" | "close" | "abort") => {
				log.info("cursor-agent turn done", {
					reason,
					durationMs: Date.now() - spawnTime,
					firstTokenMs: firstTokenTime ? firstTokenTime - spawnTime : null,
					firstToolCallMs: firstToolCallTime ? firstToolCallTime - spawnTime : null,
					cursorApiMs: capturedDurationMs,
					hasUsage: !!capturedUsage,
					resumed: !!input.resumeSessionId,
				})
			}

			const notifyComplete = (intercepted: boolean, exitCode: number | null): void => {
				if (!input.onTurnComplete) return
				try {
					input.onTurnComplete({
						sessionId: converter.sessionId,
						usage: capturedUsage,
						intercepted,
						exitCode,
						errored: exitCode !== null && exitCode !== 0,
					})
				} catch (err) {
					log.debug("onTurnComplete callback threw", {
						error: err instanceof Error ? err.message : String(err),
					})
				}
			}

			const terminate = () => {
				if (terminated) return
				terminated = true
				abort()
				input.signal?.removeEventListener("abort", abort)
				logPerf("intercept")
				notifyComplete(true, null)
			}

			proc.stdout?.on("data", (data: Buffer) => {
				if (terminated) return
				if (!firstTokenTime) firstTokenTime = Date.now()
				for (const line of lineBuffer.push(data)) {
					if (terminated) break
					let event: CursorStreamEvent
					try {
						event = JSON.parse(line) as CursorStreamEvent
					} catch {
						log.debug("Skipping malformed cursor-agent line", {
							preview: line.slice(0, 200),
						})
						continue
					}
					processEvent(event)
					if (terminated) return
				}
			})

			proc.stderr?.on("data", (data: Buffer) => {
				stderrBuffer += data.toString()
			})

			proc.on("close", (code) => {
				if (terminated) return
				terminated = true
				logPerf("close")

				// Flush any tail line the buffer is holding
				for (const line of lineBuffer.flush()) {
					try {
						const event = JSON.parse(line) as CursorStreamEvent
						if (event.type === "result" && event.usage) {
							capturedUsage = event.usage
							capturedDurationMs = event.duration_ms
						}
						const { sse } = converter.handle(event)
						for (const s of sse) controller.enqueue(encoder.encode(s))
					} catch {
						// ignore
					}
				}

				if (code !== 0 && code !== null && stderrBuffer.trim()) {
					const err = classifyCursorError(stderrBuffer)
					controller.enqueue(
						encoder.encode(sseData(chunkObj(meta, { content: `\n\n${formatCursorError(err)}` }))),
					)
					log.warn("cursor-agent exited non-zero", { code, type: err.type })
				}

				// Emit usage for the AI SDK to populate finish-step metadata
				// BEFORE the stop chunk, matching OpenAI's streaming protocol.
				const usageChunkPayload = usageChunk(meta, capturedUsage)
				if (usageChunkPayload) {
					controller.enqueue(encoder.encode(sseData(usageChunkPayload)))
				}

				controller.enqueue(encoder.encode(sseData(chunkObj(meta, {}, "stop"))))
				controller.enqueue(encoder.encode("data: [DONE]\n\n"))
				try {
					controller.close()
				} catch {
					// ignore
				}
				input.signal?.removeEventListener("abort", abort)
				notifyComplete(false, code)
			})

			proc.on("error", (err) => {
				if (terminated) return
				terminated = true
				const msg = err instanceof Error ? err.message : String(err)
				log.error("cursor-agent spawn error", { error: msg })
				notifyComplete(false, -1)
				emitFatalError(
					controller,
					encoder,
					meta,
					`cursor-agent failed to start: ${msg}\nInstall Cursor editor and ensure cursor-agent is on PATH.`,
				)
				input.signal?.removeEventListener("abort", abort)
			})

			try {
				proc.stdin?.write(input.prompt)
				proc.stdin?.end()
			} catch (err) {
				log.error("Failed to write prompt to cursor-agent stdin", {
					error: err instanceof Error ? err.message : String(err),
				})
			}
		},
	})
}

function emitFatalError(
	controller: ReadableStreamDefaultController<Uint8Array>,
	encoder: TextEncoder,
	meta: StreamMeta,
	message: string,
): void {
	controller.enqueue(encoder.encode(sseData(chunkObj(meta, { content: message }))))
	controller.enqueue(encoder.encode(sseData(chunkObj(meta, {}, "stop"))))
	controller.enqueue(encoder.encode("data: [DONE]\n\n"))
	try {
		controller.close()
	} catch {
		// ignore
	}
}
