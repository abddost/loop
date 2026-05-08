/**
 * Tool name + input/output field translation between OpenCode and Loop.
 *
 * OpenCode emits tool calls with its own naming and field conventions
 * (e.g. `webfetch`, `path`). Loop's frontend tool renderers (tool-call.tsx
 * `TOOL_REGISTRY`) expect a specific lowercase-kebab name and a specific
 * set of input field names (e.g. `web-fetch`, both `path` AND `file_path`).
 *
 * This module mirrors what cursor/adapter.ts does for ACP tool calls:
 *   - `mapOpenCodeToolName(raw)`: normalize OpenCode's tool name to the
 *     key Loop's `TOOL_REGISTRY` uses
 *   - `transformOpenCodeToolInput(rawName, input)`: rewrite/duplicate
 *     input fields so the per-tool renderer finds what it expects
 *   - `extractOpenCodeToolMetadata(rawName, state)`: extract metadata
 *     fields the renderers read (additions, deletions, diff, count, etc.)
 *
 * Without these mappings, Loop renders OpenCode's tools as the generic
 * `DefaultToolCall` JSON dump — losing the rich edit/read/grep/todo UI
 * that makes the chat usable.
 */

/** Lookup table: OpenCode tool ID → Loop renderer key. */
const OPENCODE_TOOL_NAME_MAP: Record<string, string> = {
	// File operations — names already match Loop's renderer keys.
	read: "read",
	write: "write",
	edit: "edit",
	multiedit: "multiedit",
	patch: "apply-patch",
	"apply-patch": "apply-patch",

	// Search.
	grep: "grep",
	glob: "glob",
	list: "list",
	ls: "list",

	// Shell.
	bash: "bash",
	shell: "bash",
	command: "bash",
	"bash-output": "bash-output",
	"bash-kill": "bash-kill",

	// Productivity / agent control.
	todowrite: "todowrite",
	todoread: "todoread",
	task: "task",
	question: "question",

	// Web.
	webfetch: "web-fetch",
	"web-fetch": "web-fetch",
	web_fetch: "web-fetch",
	websearch: "web-search",
	"web-search": "web-search",
	web_search: "web-search",

	// Plan.
	"plan-write": "plan-write",
	"plan-exit": "plan-exit",
	"plan-enter": "plan-enter",
	plan_write: "plan-write",
	plan_exit: "plan-exit",
	plan_enter: "plan-enter",
}

/**
 * Map an OpenCode tool name to Loop's `TOOL_REGISTRY` key.
 *
 * Defaults: lowercases, then looks up. Unknown tools (third-party MCP
 * tools, custom OpenCode plugins) fall through to the lowercased name —
 * Loop's `DefaultToolCall` will render them as a JSON card.
 */
export function mapOpenCodeToolName(raw: string): string {
	if (!raw) return raw
	const lower = raw.toLowerCase()
	return OPENCODE_TOOL_NAME_MAP[lower] ?? lower
}

/**
 * Translation from Loop's tool IDs (used in `ToolRegistry` and permission
 * rules) to OpenCode's native tool names. Used when building OpenCode's
 * tool deny filter from a Loop permission ruleset — without this
 * translation, denials like Loop's `apply_patch` (snake_case) silently fail
 * to disable OpenCode's `patch` / `apply-patch` tool, letting the plan
 * agent run mutating operations even though Loop's ruleset said "deny".
 *
 * One Loop tool can correspond to multiple OpenCode tool names (OpenCode
 * accepts both kebab- and snake-case spellings on some tools), so the
 * value is an array.
 */
const LOOP_TO_OPENCODE_TOOL_NAMES: Record<string, string[]> = {
	read: ["read"],
	write: ["write"],
	edit: ["edit"],
	multiedit: ["multiedit"],
	apply_patch: ["patch", "apply-patch"],
	"apply-patch": ["patch", "apply-patch"],
	bash: ["bash", "shell", "command"],
	bash_output: ["bash-output"],
	bash_kill: ["bash-kill"],
	grep: ["grep"],
	glob: ["glob"],
	list: ["list", "ls"],
	todowrite: ["todowrite"],
	todoread: ["todoread"],
	task: ["task"],
	question: ["question"],
	"web-fetch": ["webfetch", "web-fetch", "web_fetch"],
	"web-search": ["websearch", "web-search", "web_search"],
	plan_write: ["plan-write", "plan_write"],
	plan_exit: ["plan-exit", "plan_exit"],
}

/**
 * Resolve a Loop tool ID (or permission category) to the OpenCode tool
 * names it maps to. Used when building OpenCode's `tools` deny filter
 * from a Loop permission ruleset. Returns the loop name itself as a
 * single-element fallback so unknown tools still get blocked if their
 * name happens to match.
 */
export function loopToolToOpenCodeNames(loopToolId: string): string[] {
	const lower = loopToolId.toLowerCase()
	return LOOP_TO_OPENCODE_TOOL_NAMES[lower] ?? [lower]
}

/**
 * Rewrite OpenCode tool input so Loop's per-tool renderers find the
 * fields they expect. Bi-name acceptance is the rule: we keep the
 * OpenCode-native field AND set Loop's expected alias so renderers
 * looking at either spelling work.
 *
 * Verified against tool-call.tsx field reads (lines 561-1152).
 */
export function transformOpenCodeToolInput(
	rawName: string,
	input: Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (!input) return {}
	const name = mapOpenCodeToolName(rawName)
	const out: Record<string, unknown> = { ...input }

	switch (name) {
		case "read": {
			// Loop's ReadToolCall reads `path` OR `file_path`. OpenCode emits
			// `path` — duplicate to `file_path` for parity with the SDK
			// convention some renderers prefer.
			const path = input.path ?? input.file_path ?? input.filePath
			if (path !== undefined) {
				out.path = path
				out.file_path = path
			}
			// `offset`/`limit` already match.
			return out
		}

		case "edit":
		case "write":
		case "multiedit":
		case "apply-patch": {
			const path = input.path ?? input.file_path ?? input.filePath
			if (path !== undefined) {
				out.path = path
				out.file_path = path
			}
			// `content` (write) and `old_string`/`new_string` (edit) match.
			return out
		}

		case "bash":
		case "bash-output":
		case "bash-kill": {
			// OpenCode uses `command`; some renderer call sites read `cmd`.
			const command = input.command ?? input.cmd
			if (command !== undefined) {
				out.command = command
				out.cmd = command
			}
			return out
		}

		case "grep":
		case "glob": {
			// OpenCode: `pattern`, `path`. Loop renderers read both.
			const pattern = input.pattern ?? input.query ?? input.regex
			if (pattern !== undefined) out.pattern = pattern
			const path = input.path ?? input.directory ?? input.targetDirectory
			if (path !== undefined) out.path = path
			return out
		}

		case "list": {
			const path = input.path ?? input.directory ?? input.dir
			if (path !== undefined) out.path = path
			return out
		}

		case "todowrite":
		case "todoread": {
			// Normalise OpenCode's todo status/priority vocabulary to Loop's.
			// OpenCode emits `pending|in_progress|completed|cancelled` but
			// Loop's `TodoWriteToolCall` renderer compares strictly against
			// `done|in-progress|<other = pending>` — without this mapping
			// the model's "mark as done" updates land in the DB but render
			// as empty checkboxes since no condition matches.
			const todos = input.todos
			if (Array.isArray(todos)) {
				out.todos = todos.map((t) => normalizeOpenCodeTodo(t))
			}
			return out
		}

		case "web-fetch": {
			const url = input.url ?? input.uri
			if (url !== undefined) out.url = url
			return out
		}

		case "web-search": {
			const query = input.query ?? input.q ?? input.search
			if (query !== undefined) out.query = query
			return out
		}

		case "task": {
			// Subagent tool — Loop's TaskToolCall reads description / prompt /
			// subagent_type.
			const desc = input.description ?? input.task ?? input.name
			if (desc !== undefined) out.description = desc
			const prompt = input.prompt ?? input.instructions
			if (prompt !== undefined) out.prompt = prompt
			const subagentType = input.subagent_type ?? input.subagentType ?? input.type
			if (subagentType !== undefined) out.subagent_type = subagentType
			return out
		}

		case "plan-write": {
			const content = input.content ?? input.plan ?? input.text
			if (content !== undefined) out.content = content
			const path = input.path ?? input.planPath
			if (path !== undefined) out.path = path
			return out
		}

		default:
			// Unknown tools (custom MCP, third-party): pass through unchanged.
			return out
	}
}

/**
 * Extract metadata fields Loop's per-tool renderers read directly. These
 * are pulled from OpenCode's tool state (input + structured + content) and
 * surfaced as `metadata.{key}` on the tool part. The renderer already
 * prefers metadata over input, so this is the right channel for things
 * like edit diff stats and grep match counts.
 */
export function extractOpenCodeToolMetadata(
	rawName: string,
	state: {
		input?: Record<string, unknown>
		output?: string
		structured?: Record<string, unknown>
		content?: ReadonlyArray<{ type?: string; text?: string }>
		title?: string
	},
): Record<string, unknown> {
	const name = mapOpenCodeToolName(rawName)
	const meta: Record<string, unknown> = {}
	const structured = state.structured ?? {}

	switch (name) {
		case "edit":
		case "write":
		case "multiedit":
		case "apply-patch": {
			// Renderers (FileMutationToolCall) read: diff, additions, deletions,
			// editCount. OpenCode often surfaces these in `structured`.
			if (typeof structured.diff === "string") meta.diff = structured.diff
			if (typeof structured.additions === "number") meta.additions = structured.additions
			if (typeof structured.deletions === "number") meta.deletions = structured.deletions
			if (typeof structured.editCount === "number") meta.editCount = structured.editCount
			if (state.title) meta.description = state.title
			break
		}

		case "bash":
		case "bash-output":
		case "bash-kill": {
			if (typeof structured.exitCode === "number") meta.exitCode = structured.exitCode
			if (typeof structured.exit_code === "number") meta.exitCode = structured.exit_code
			if (typeof structured.status === "string") meta.status = structured.status
			if (state.title) meta.description = state.title
			if (state.output) meta.output = state.output
			break
		}

		case "read": {
			if (typeof structured.totalLines === "number") meta.totalLines = structured.totalLines
			if (typeof structured.hasMore === "boolean") meta.hasMore = structured.hasMore
			break
		}

		case "grep": {
			const matches = structured.matchCount ?? structured.matches ?? structured.count
			if (typeof matches === "number") meta.matchCount = matches
			const files = structured.fileCount ?? structured.files
			if (typeof files === "number") meta.fileCount = files
			break
		}

		case "glob": {
			const count = structured.count ?? structured.matches
			if (typeof count === "number") meta.count = count
			const total = structured.totalCount ?? structured.total
			if (typeof total === "number") meta.totalCount = total
			break
		}

		case "todowrite":
		case "todoread": {
			// Renderer reads metadata.todos preferentially over input.todos so
			// post-execution status updates land. Pull from structured first,
			// fall back to input. Normalise statuses to Loop's vocabulary
			// (see normalizeOpenCodeTodo for the mapping).
			const todos = structured.todos ?? state.input?.todos
			if (Array.isArray(todos)) {
				meta.todos = todos.map((t) => normalizeOpenCodeTodo(t))
			}
			break
		}

		case "web-fetch": {
			if (typeof structured.format === "string") meta.format = structured.format
			break
		}

		case "web-search": {
			const count = structured.resultCount ?? structured.count ?? structured.totalResults
			if (typeof count === "number") meta.resultCount = count
			break
		}

		case "task": {
			// Subagent tool — childSessionId carries Loop's TaskPanel link.
			const child = structured.childSessionId ?? structured.sessionId
			if (typeof child === "string") meta.childSessionId = child
			const agentType = structured.agentType ?? state.input?.subagent_type
			if (typeof agentType === "string") meta.agentType = agentType
			if (typeof structured.toolCount === "number") meta.toolCount = structured.toolCount
			if (typeof structured.errorCount === "number") meta.errorCount = structured.errorCount
			break
		}

		case "plan-exit":
		case "plan-write": {
			// Renderers (PlanExitToolCall, PlanWriteToolCall) read planContent
			// + planPath from metadata. OpenCode-side these may sit under
			// structured or be the actual `output` text.
			const planContent =
				structured.planContent ?? structured.plan ?? structured.content ?? state.output ?? ""
			if (typeof planContent === "string" && planContent.trim().length > 0) {
				meta.planContent = planContent
			}
			const planPath = structured.planPath ?? structured.path ?? state.input?.path
			if (typeof planPath === "string") meta.planPath = planPath
			break
		}

		default:
			break
	}

	return meta
}

/**
 * Translate OpenCode's todo array into Loop's vocabulary. Status mapping:
 * `pending → todo`, `in_progress → in-progress`, `completed → done`,
 * `cancelled → done`. Priorities collapse `urgent → high`. Synthesises a
 * stable `id` from the content hash when OpenCode doesn't provide one.
 */
export function normalizeOpenCodeTodos(raw: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(raw)) return []
	return raw.map((t) => normalizeOpenCodeTodo(t))
}

function normalizeOpenCodeTodo(raw: unknown): Record<string, unknown> {
	if (!raw || typeof raw !== "object")
		return { content: String(raw ?? ""), status: "todo", priority: "medium" }
	const t = raw as {
		id?: unknown
		content?: unknown
		status?: unknown
		priority?: unknown
	}
	const content = typeof t.content === "string" ? t.content : ""
	const status = mapTodoStatus(typeof t.status === "string" ? t.status : "")
	const priority = mapTodoPriority(typeof t.priority === "string" ? t.priority : "")
	const id = typeof t.id === "string" && t.id.length > 0 ? t.id : `oc-${djb2(content)}`
	return { id, content, status, priority }
}

function mapTodoStatus(raw: string): "todo" | "in-progress" | "done" {
	switch (raw.toLowerCase().replace(/_/g, "-")) {
		case "in-progress":
		case "running":
			return "in-progress"
		case "completed":
		case "done":
		case "cancelled":
		case "canceled":
			return "done"
		default:
			return "todo"
	}
}

function mapTodoPriority(raw: string): "high" | "medium" | "low" {
	switch (raw.toLowerCase()) {
		case "high":
		case "urgent":
			return "high"
		case "low":
			return "low"
		default:
			return "medium"
	}
}

/** Tiny stable hash for synthesizing todo ids when OpenCode omits them. */
function djb2(str: string): string {
	let hash = 5381
	for (let i = 0; i < str.length; i++) hash = (hash * 33) ^ str.charCodeAt(i)
	return (hash >>> 0).toString(36)
}
