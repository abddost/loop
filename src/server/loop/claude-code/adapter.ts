import { readFileSync as fsReadFileSync } from "node:fs"
import { ulid } from "@core/id"
import { createLogger } from "../../logger"

/**
 * Stateful translator that maps `SDKMessage` events from the Claude Agent SDK
 * into Loop's existing `Part` schema, emitting them through an injected
 * `PartEmitter`.
 *
 * The adapter is intentionally free of DB or bus imports so that unit tests
 * can spy on the emitter without touching the real workspace. The runtime
 * (`runtime.ts`) provides an emitter that wraps `Database.withEffects` +
 * `bus()` to match how `stream-processor.ts` persists parts.
 *
 * Design notes:
 *   - Text / reasoning use the same deferred-flush pattern as `processStream`:
 *     accumulate in memory, emit `part:delta` events per chunk, persist the
 *     final part on `content_block_stop`.
 *   - Tools follow the pending → running → completed state machine. The
 *     adapter persists a `pending` tool part on `content_block_start`, flips
 *     it to `running` once the input JSON parses, and finalizes it on a
 *     `user/tool_result` message.
 *   - `step-start` parts are emitted on `system/init` with the pre-run
 *     snapshot hash captured by the runtime (the adapter receives it via
 *     `beginTurn`).
 *   - `result` messages trigger `finalize()` which flushes any stragglers,
 *     captures the post-run snapshot (also provided by the runtime), and
 *     emits the `step-finish` + `edit` parts.
 *
 * The adapter never throws on malformed events — it logs and continues so a
 * flaky SDK cannot take down a session mid-turn. Callers inspect
 * `finalize()` for the resolved finish reason + usage.
 */

const log = createLogger("claude-code-adapter")

/** Anything we need to emit into the session for the UI to render. */
export type AdapterEmission =
	| {
			kind: "part"
			part: {
				id: string
				type: string
				[key: string]: unknown
			}
	  }
	| {
			kind: "delta"
			partId: string
			delta: string
			partType: "text" | "reasoning"
	  }

/** Outbound sink the runtime provides so parts reach the DB + bus. */
export interface PartEmitter {
	/**
	 * Persist a part to the DB and fan it out on the workspace bus. Mirrors
	 * the upsert pattern in `stream-processor.ts`.
	 */
	upsertPart(part: {
		id: string
		type: "text" | "reasoning" | "tool" | "step-start" | "step-finish" | "edit" | "compaction"
		data: Record<string, unknown>
	}): void
	/**
	 * Emit a streaming delta for text or reasoning parts. No DB write.
	 */
	emitDelta(args: { partId: string; delta: string; partType: "text" | "reasoning" }): void
}

export interface AdapterOptions {
	sessionId: string
	messageId: string
	emitter: PartEmitter
	/**
	 * Called when the adapter observes a new `session_id` on an incoming SDK
	 * message. The runtime uses this to persist the SDK resume cursor.
	 */
	onSessionId?: (sdkSessionId: string) => void
	/**
	 * Called when the adapter observes a `compact_boundary` system message.
	 * The runtime marks the session's compaction boundary.
	 */
	onCompactBoundary?: (metadata: {
		trigger: "manual" | "auto"
		preTokens?: number
		postTokens?: number
	}) => void
	/**
	 * Called when the adapter observes an `auth_status` message indicating
	 * the CLI is no longer authenticated. The runtime aborts the turn.
	 */
	onAuthFailure?: (message: string) => void
	/**
	 * Called on each `task_started` so the runtime can register the task
	 * id (and the output-file path we learned from async_launched) in
	 * its pending registry. The follow-up poll reads `outputFile`
	 * directly — `taskId` alone is query-scoped and expires.
	 */
	onTaskStarted?: (info: { taskId: string; outputFile?: string; description?: string }) => void
	/**
	 * Called on each terminal `task_notification` so the runtime can
	 * remove the task from pending.
	 */
	onTaskFinished?: (taskId: string) => void
	/**
	 * Called once per turn the first time the adapter observes main-agent
	 * activity (a `stream_event` / `assistant` message with
	 * `parent_tool_use_id === null`). Lets the runtime re-assert the
	 * session status as `busy` without the adapter having to know about
	 * the status module. Idempotent — the adapter only fires it once per
	 * `beginTurn`, so the runtime's implementation doesn't need to
	 * debounce.
	 */
	onMainAgentActive?: () => void
	/**
	 * Called every time accumulated turn usage changes. The runtime
	 * forwards this to `bus().emit("session:usage", ...)` so the UsageBar
	 * updates live during streaming. Mirrors the `session:usage`
	 * emission in `stream-processor.ts` for the main AI-SDK workflow.
	 */
	onUsageUpdate?: (usage: TurnUsage) => void
}

/** Accumulated usage for the current turn. Reset on `beginTurn`. */
export interface TurnUsage {
	input: number
	output: number
	reasoning: number
	cacheRead: number
	cacheWrite: number
}

/** Loose structural subset of `SDKMessage` — kept intentionally permissive
 *  so evolving SDK shapes do not require recompiling the adapter. */
export type SdkMessageLike = {
	type: string
	[key: string]: unknown
}

interface ToolState {
	partId: string
	callId: string
	toolName: string
	startedAt: number
	rawInput: string
	input?: Record<string, unknown>
	/** Content block index (for stream_event correlation). */
	blockIndex?: number
	/** True once `content_block_stop` closed the block (input JSON final). */
	closed: boolean
	/** True once a `tool_result` has been seen. */
	resolved: boolean
	/**
	 * Externally-attached metadata (e.g. plan content injected by the
	 * permission bridge from `canUseTool`). Survives across `persistTool`
	 * calls so it isn't lost when the tool_result upsert rebuilds the data.
	 */
	metadata?: Record<string, unknown>
}

interface TextState {
	partId: string
	buffer: string
	blockIndex: number
}

interface ReasoningState {
	partId: string
	buffer: string
	blockIndex: number
	startedAt: number
}

/** Background subagent (SDK `task_*` subtypes) tracked by stable task_id. */
interface TaskState {
	partId: string
	taskId: string
	startedAt: number
	toolUseId?: string
	description?: string
	taskType?: string
}

export interface FinalizeOptions {
	/** Post-turn snapshot hash, captured by the runtime after the SDK
	 *  finishes (or when abort fires). */
	snapshotHash?: string
	/** Optional file diff stats for the edit part. If omitted, no edit part
	 *  is emitted — the runtime decides whether to compute diffs. */
	editFiles?: Array<{
		path: string
		additions: number
		deletions: number
		status: "added" | "deleted" | "modified"
	}>
}

export interface FinalizeResult {
	finishReason: string
	usage?: {
		input: number
		output: number
		cacheRead?: number
		cacheWrite?: number
	}
	costUsd?: number
	durationMs?: number
	numTurns?: number
}

/**
 * Sentinel used as the outer key for state maps that partition content-block
 * streams by `parent_tool_use_id`. The SDK emits `stream_event`, `assistant`,
 * and `user` messages for both the main agent (parent_tool_use_id === null)
 * and any in-flight subagents (parent_tool_use_id === the Agent tool_use_id).
 * Block-index numbers are only unique within a single parent, so we partition
 * by parent to prevent main-agent and subagent blocks from clobbering each
 * other on the same index.
 */
const ROOT_STREAM: string = "__root__"

/** Create a fresh adapter for a single Claude Code turn. */
export function createClaudeCodeAdapter(opts: AdapterOptions) {
	const {
		emitter,
		onSessionId,
		onCompactBoundary,
		onAuthFailure,
		onTaskStarted,
		onTaskFinished,
		onMainAgentActive,
		onUsageUpdate,
	} = opts

	/** Per-turn latch: true after the first main-agent activity fires the
	 *  `onMainAgentActive` callback, reset by `beginTurn`. Prevents the
	 *  callback from firing on every stream event. */
	let mainAgentActiveFiredThisTurn = false

	/** parent_tool_use_id ("__root__" for main agent) → block index → text state. */
	const texts = new Map<string, Map<number, TextState>>()
	/** parent_tool_use_id → block index → reasoning state. */
	const reasonings = new Map<string, Map<number, ReasoningState>>()
	/** parent_tool_use_id → block index → tool state (active correlations). */
	const toolsByIndex = new Map<string, Map<number, ToolState>>()
	/** Tool-use-id → tool state. Flat — SDK tool_use_ids are unique across
	 *  all parents, so the fast-path lookup on `tool_result` never needs the
	 *  parent scope. Entries are also tracked in the per-parent
	 *  `toolsByIndex` map above and get removed from both on resolve. */
	const toolsById = new Map<string, ToolState>()

	/** Resolve the partition key for a message. `parent_tool_use_id` is a
	 *  string when the message belongs to a subagent, null (or missing) for
	 *  the main agent. Only the root partition is populated today — subagent
	 *  activity is filtered out in the handlers — but the maps are still
	 *  keyed by parent so a future design that renders subagent content can
	 *  switch partitions without reshaping state. */
	function parentKey(msg: SdkMessageLike): string {
		const raw = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id
		return typeof raw === "string" && raw.length > 0 ? raw : ROOT_STREAM
	}

	function getTextMap(parent: string): Map<number, TextState> {
		let m = texts.get(parent)
		if (!m) {
			m = new Map()
			texts.set(parent, m)
		}
		return m
	}
	function getReasoningMap(parent: string): Map<number, ReasoningState> {
		let m = reasonings.get(parent)
		if (!m) {
			m = new Map()
			reasonings.set(parent, m)
		}
		return m
	}
	function getToolIndexMap(parent: string): Map<number, ToolState> {
		let m = toolsByIndex.get(parent)
		if (!m) {
			m = new Map()
			toolsByIndex.set(parent, m)
		}
		return m
	}
	/** Background subagent task_id → task state. Updated across task_started,
	 *  task_progress, and task_notification so the same part is upserted. */
	const tasksById = new Map<string, TaskState>()
	/** tool_use_id of the Agent tool call → outputFile path captured from
	 *  its async_launched tool_result. task_started correlates by
	 *  tool_use_id so we hand the outputFile off to the pending-tasks
	 *  registry where it survives the query closing. */
	const outputFilesByToolUseId = new Map<string, string>()

	/** Captured at `beginTurn`. Persisted when we emit `step-finish`. */
	let preSnapshotHash: string | undefined
	let stepStartEmitted = false

	/**
	 * Accumulated usage across every API call observed in this turn.
	 * Reset by `beginTurn`. Each `assistant` SDK message carries a
	 * per-step `message.usage`; we additively accumulate it (matching
	 * the main AI-SDK loop's behaviour in `stream-processor.ts`) and
	 * fire `onUsageUpdate` so the UsageBar gets live updates instead of
	 * waiting for the result message.
	 */
	let totalUsage: TurnUsage = {
		input: 0,
		output: 0,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
	}

	/** Most recent result payload seen on the SDK stream. */
	let resultPayload:
		| {
				finishReason: string
				usage?: FinalizeResult["usage"]
				costUsd?: number
				durationMs?: number
				numTurns?: number
		  }
		| undefined

	/** Remember the resume session_id so the runtime can persist it. */
	let sdkSessionId: string | undefined

	/** Notify once per distinct SDK session id. */
	function noteSessionId(id: unknown): void {
		if (typeof id !== "string" || !id) return
		if (sdkSessionId === id) return
		sdkSessionId = id
		onSessionId?.(id)
	}

	/** Persist and reset a text block. */
	function flushText(state: TextState): void {
		if (!state.buffer) return
		emitter.upsertPart({
			id: state.partId,
			type: "text",
			data: { type: "text", text: state.buffer },
		})
	}

	/** Persist and reset a reasoning block. */
	function flushReasoning(state: ReasoningState): void {
		if (!state.buffer) return
		emitter.upsertPart({
			id: state.partId,
			type: "reasoning",
			data: {
				type: "reasoning",
				text: state.buffer,
				time: { start: state.startedAt, end: Date.now() },
			},
		})
	}

	/** Persist a tool part in its current state. */
	function persistTool(
		tool: ToolState,
		state: "pending" | "running" | "completed" | "error",
		extra: {
			output?: string
			error?: string
			endedAt?: number
			metadata?: Record<string, unknown>
		} = {},
	): void {
		log.info("[tool-state]", {
			tool: tool.toolName,
			callId: tool.callId,
			partId: tool.partId,
			state,
			error: extra.error,
		})
		const data: Record<string, unknown> = {
			type: "tool",
			callId: tool.callId,
			tool: tool.toolName,
			state,
			input: prepareToolInputForEmit(tool.toolName, tool.input),
			time: {
				start: tool.startedAt,
				...(extra.endedAt !== undefined ? { end: extra.endedAt } : {}),
			},
		}
		if (extra.output !== undefined) data.output = extra.output
		if (extra.error !== undefined) data.error = extra.error
		// Merge externally-attached metadata (tool.metadata) with any
		// call-site metadata. tool.metadata is the durable store —
		// extra.metadata may also write back into it so future calls see it.
		if (extra.metadata) {
			tool.metadata = { ...tool.metadata, ...extra.metadata }
		}
		if (tool.metadata) data.metadata = tool.metadata
		emitter.upsertPart({
			id: tool.partId,
			type: "tool",
			data,
		})
	}

	/** Handle a streaming `stream_event` (content_block_* deltas + lifecycle). */
	function handleStreamEvent(
		msg: SdkMessageLike & { event?: { type?: string; [key: string]: unknown } },
	): void {
		const ev = msg.event
		if (!ev || typeof ev !== "object" || !("type" in ev)) return

		const parent = parentKey(msg)
		// Subagent activity is surfaced separately via `task_started` /
		// `task_progress` / `task_notification` system messages (rendered as
		// Subagent tool cards). We do NOT render subagent text/reasoning/tools
		// into the main assistant message — that would make the main session
		// timeline look like the main agent is still streaming even after its
		// turn has ended (main turn's `result` has already fired), which in
		// turn keeps the UI looking busy when the session status is correctly
		// idle. Match the t3code model: agent teams are background work; the
		// main session only shows main-agent output.
		if (parent !== ROOT_STREAM) return

		// First main-agent activity on this turn — let the runtime re-assert
		// `busy` in case any earlier status event was dropped/coalesced on the
		// client. Latched so we only fire once per turn.
		if (!mainAgentActiveFiredThisTurn) {
			mainAgentActiveFiredThisTurn = true
			onMainAgentActive?.()
		}

		const textMap = getTextMap(parent)
		const reasoningMap = getReasoningMap(parent)
		const toolIndexMap = getToolIndexMap(parent)

		switch (ev.type) {
			case "message_start": {
				// No-op — we already opened the assistant message before the turn.
				break
			}

			case "content_block_start": {
				const index = (ev as { index?: number }).index
				const block = (ev as { content_block?: { type?: string; [k: string]: unknown } })
					.content_block
				if (typeof index !== "number" || !block || typeof block !== "object") return

				switch (block.type) {
					case "text": {
						const state: TextState = { partId: ulid(), buffer: "", blockIndex: index }
						textMap.set(index, state)
						// Reserve the part's position at block-start time. Without this
						// the client only learns of the text part on its first delta —
						// by then a sibling tool_use's upsert may have pushed ahead,
						// visually swapping their order.
						emitter.emitDelta({ partId: state.partId, delta: "", partType: "text" })
						break
					}
					case "thinking": {
						const state: ReasoningState = {
							partId: ulid(),
							buffer: "",
							blockIndex: index,
							startedAt: Date.now(),
						}
						reasoningMap.set(index, state)
						emitter.emitDelta({ partId: state.partId, delta: "", partType: "reasoning" })
						break
					}
					case "tool_use": {
						const b = block as { id?: string; name?: string; input?: unknown }
						const callId = b.id ?? `cc-tool-${index}`
						// The SDK canonical name is "Agent" but older models still
						// emit "Task" (the grandfathered alias). Normalize here so
						// downstream (metadata extraction, UI registry) only has to
						// handle one name.
						const rawName = b.name ?? "unknown"
						const toolName = rawName === "Task" ? "Agent" : rawName
						const tool: ToolState = {
							partId: ulid(),
							callId,
							toolName,
							startedAt: Date.now(),
							rawInput: "",
							input:
								b.input && typeof b.input === "object"
									? (b.input as Record<string, unknown>)
									: undefined,
							blockIndex: index,
							closed: false,
							resolved: false,
						}
						toolIndexMap.set(index, tool)
						toolsById.set(callId, tool)
						persistTool(tool, "pending")
						break
					}
					default: {
						// Ignore server_tool_use, web_search_tool_result, etc. —
						// Claude Code can generate these but Loop's UI doesn't
						// render them as tools. Fall through to no-op.
						break
					}
				}
				break
			}

			case "content_block_delta": {
				const index = (ev as { index?: number }).index
				const delta = (ev as { delta?: { type?: string; [k: string]: unknown } }).delta
				if (typeof index !== "number" || !delta) return

				switch (delta.type) {
					case "text_delta": {
						const text = (delta as { text?: string }).text
						if (!text) return
						const state = textMap.get(index)
						if (!state) return
						state.buffer += text
						emitter.emitDelta({ partId: state.partId, delta: text, partType: "text" })
						break
					}
					case "thinking_delta": {
						const thinking = (delta as { thinking?: string }).thinking
						if (!thinking) return
						const state = reasoningMap.get(index)
						if (!state) return
						state.buffer += thinking
						emitter.emitDelta({ partId: state.partId, delta: thinking, partType: "reasoning" })
						break
					}
					case "input_json_delta": {
						const partialJson = (delta as { partial_json?: string }).partial_json
						if (typeof partialJson !== "string") return
						const tool = toolIndexMap.get(index)
						if (!tool) return
						tool.rawInput += partialJson
						// Lenient parse: try strict first, fall back to
						// closing unterminated strings + open containers so
						// early fields (e.g. Write's `file_path`) surface
						// before the full JSON is balanced. UI sees input as
						// it arrives.
						const parsed = tryParsePartialJsonObject(tool.rawInput)
						if (parsed) {
							tool.input = parsed
							persistTool(tool, "pending")
						}
						break
					}
					case "signature_delta":
					case "citations_delta":
						break
					default:
						break
				}
				break
			}

			case "content_block_stop": {
				const index = (ev as { index?: number }).index
				if (typeof index !== "number") return

				// Finalize whichever collection owns this index within this parent.
				const text = textMap.get(index)
				if (text) {
					flushText(text)
					textMap.delete(index)
					return
				}
				const reasoning = reasoningMap.get(index)
				if (reasoning) {
					flushReasoning(reasoning)
					reasoningMap.delete(index)
					return
				}
				const tool = toolIndexMap.get(index)
				if (tool) {
					tool.closed = true
					// Re-parse one last time in case the final delta closed out
					// the JSON at the same moment as the block stop. Prefer
					// strict here — at block close the JSON must be valid.
					const parsed = tryParseJson(tool.rawInput)
					if (parsed && typeof parsed === "object") {
						tool.input = parsed as Record<string, unknown>
					}
					// For ExitPlanMode, extract plan metadata from the input now
					// so the frontend can render the plan card immediately —
					// the tool_result may arrive later or not at all.
					const earlyMeta = extractToolMetadata(tool.toolName, undefined, tool.input)
					persistTool(tool, "running", { metadata: earlyMeta })
					toolIndexMap.delete(index)
				}
				break
			}

			case "message_delta": {
				const stopReason = (ev as { delta?: { stop_reason?: string | null } }).delta?.stop_reason
				if (stopReason) {
					// Stash it so `finalize()` picks it up even if no SDKResult
					// arrives (abort path).
					if (!resultPayload) {
						resultPayload = { finishReason: stopReason }
					} else {
						resultPayload.finishReason = stopReason
					}
				}
				break
			}

			case "message_stop": {
				break
			}

			default:
				break
		}
	}

	/** Handle a `user` SDK message — these carry `tool_result` blocks. */
	function handleUserMessage(msg: SdkMessageLike): void {
		// Subagent-internal tool_results arrive with parent_tool_use_id set.
		// We don't track those tools (see `handleStreamEvent`), so the matching
		// tool_result would never find a tool to update. Skip them so we don't
		// log misleading "unknown tool" warnings and don't pollute the main
		// message's timeline.
		if (parentKey(msg) !== ROOT_STREAM) return

		const message = (msg as { message?: { content?: unknown } }).message
		if (!message || typeof message !== "object") return
		const content = (message as { content?: unknown }).content
		if (!Array.isArray(content)) return

		for (const block of content) {
			if (!block || typeof block !== "object") continue
			const b = block as {
				type?: string
				tool_use_id?: string
				content?: unknown
				is_error?: boolean
			}
			if (b.type !== "tool_result" || typeof b.tool_use_id !== "string") continue

			const tool = toolsById.get(b.tool_use_id)
			if (!tool) {
				// Unknown tool — nothing to update. Claude Code occasionally
				// replays tool results from previous turns during resume; log
				// at debug so it doesn't clutter prod logs.
				log.debug("tool_result for unknown tool", { toolUseId: b.tool_use_id })
				continue
			}

			const outputText = stringifyToolResultContent(b.content)
			tool.resolved = true
			toolsById.delete(b.tool_use_id)
			// Also drop the entry from whichever per-parent index map owns it
			// so finalize() doesn't see it as a stragger.
			for (const indexMap of toolsByIndex.values()) {
				for (const [idx, entry] of indexMap) {
					if (entry === tool) {
						indexMap.delete(idx)
						break
					}
				}
			}

			// Extract structured metadata for specific tools.
			// Pass the tool's INPUT as well — for ExitPlanMode the plan
			// content lives in the input, not the result output.
			const metadata = extractToolMetadata(tool.toolName, b.content, tool.input)

			// Stash the Agent tool's outputFile keyed by tool_use_id so
			// the task_started correlator can hand it to pending-tasks.
			if (tool.toolName === "Agent" && metadata && typeof metadata.outputFile === "string") {
				outputFilesByToolUseId.set(tool.callId, metadata.outputFile)
			}

			if (b.is_error) {
				persistTool(tool, "error", {
					error: outputText || "Tool execution failed",
					endedAt: Date.now(),
					metadata,
				})
			} else {
				persistTool(tool, "completed", {
					output: outputText,
					endedAt: Date.now(),
					metadata,
				})
			}
		}
	}

	/**
	 * Handle a final assistant message.
	 *
	 * Main agent (parent_tool_use_id === null): the streaming path via
	 * `stream_event` is authoritative for content — we already emitted
	 * text / reasoning / tool parts during deltas. We DO extract per-step
	 * `message.usage` here so `onUsageUpdate` can fire live during the
	 * turn (each `assistant` represents one completed API call).
	 *
	 * Subagent (parent_tool_use_id !== null): do nothing. Subagent content
	 * must NOT be rendered into the main assistant message — the emitter
	 * would attribute it to the main session's messageId, making the UI
	 * look like the main agent is still streaming long after its `result`
	 * has fired and the session status has correctly flipped to idle. The
	 * user would see a mismatch: "main agent working, status idle".
	 * Subagent activity is surfaced via Subagent tool cards driven by
	 * `task_started` / `task_progress` / `task_notification`.
	 */
	function handleAssistantMessage(msg: SdkMessageLike): void {
		if (parentKey(msg) !== ROOT_STREAM) return
		const message = (msg as { message?: { usage?: unknown } }).message
		if (!message || typeof message !== "object") return
		accumulateUsage(message.usage)
	}

	/** Add an incoming SDK usage object into `totalUsage` and notify. */
	function accumulateUsage(raw: unknown): void {
		const u = parseSdkUsage(raw)
		if (!u) return
		totalUsage = {
			input: totalUsage.input + u.input,
			output: totalUsage.output + u.output,
			reasoning: totalUsage.reasoning + u.reasoning,
			cacheRead: totalUsage.cacheRead + u.cacheRead,
			cacheWrite: totalUsage.cacheWrite + u.cacheWrite,
		}
		onUsageUpdate?.(totalUsage)
	}

	/** Handle a `system` SDK message. Subtypes drive session setup,
	 *  compaction markers, auth failures, and status changes. */
	function handleSystemMessage(msg: SdkMessageLike): void {
		const subtype = (msg as { subtype?: string }).subtype
		switch (subtype) {
			case "init": {
				// Captured pre-snapshot in `beginTurn` — emit the step-start
				// now that we have a session_id from the SDK.
				if (!stepStartEmitted) {
					const partId = ulid()
					emitter.upsertPart({
						id: partId,
						type: "step-start",
						data: {
							type: "step-start",
							snapshot: preSnapshotHash,
						},
					})
					stepStartEmitted = true
				}
				break
			}
			case "compact_boundary": {
				const meta = (msg as { compact_metadata?: Record<string, unknown> }).compact_metadata
				const trigger =
					(meta?.trigger as "manual" | "auto" | undefined) === "manual" ? "manual" : "auto"
				const preTokens = typeof meta?.pre_tokens === "number" ? meta.pre_tokens : undefined
				const postTokens = typeof meta?.post_tokens === "number" ? meta.post_tokens : undefined

				onCompactBoundary?.({ trigger, preTokens, postTokens })

				// Emit an on-timeline compaction marker so the UI renders
				// the boundary like the AI SDK codepath does.
				emitter.upsertPart({
					id: ulid(),
					type: "compaction",
					data: { type: "compaction", auto: trigger === "auto" },
				})
				break
			}
			case "task_started":
				handleTaskStarted(msg)
				break
			case "task_progress":
				handleTaskProgress(msg)
				break
			case "task_updated":
				handleTaskUpdated(msg)
				break
			case "task_notification":
				handleTaskNotification(msg)
				break
			case "status":
			case "session_state_changed":
			case "notification":
			case "api_retry":
			case "plugin_install":
				break
			default:
				break
		}
	}

	/** Track a background Agent/Task subagent by its stable `task_id`. */
	function handleTaskStarted(msg: SdkMessageLike): void {
		const m = msg as {
			task_id?: string
			tool_use_id?: string
			description?: string
			task_type?: string
		}
		if (typeof m.task_id !== "string") return
		const task = tasksById.get(m.task_id) ?? {
			partId: ulid(),
			taskId: m.task_id,
			startedAt: Date.now(),
			toolUseId: m.tool_use_id,
			description: m.description,
			taskType: m.task_type,
		}
		task.description = m.description ?? task.description
		task.taskType = m.task_type ?? task.taskType
		task.toolUseId = m.tool_use_id ?? task.toolUseId
		tasksById.set(m.task_id, task)
		persistTask(task, "running", {})
		const outputFile = m.tool_use_id ? outputFilesByToolUseId.get(m.tool_use_id) : undefined
		onTaskStarted?.({ taskId: m.task_id, outputFile, description: task.description })
	}

	function handleTaskProgress(msg: SdkMessageLike): void {
		const m = msg as {
			task_id?: string
			tool_use_id?: string
			description?: string
			usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
			last_tool_name?: string
		}
		if (typeof m.task_id !== "string") return
		const task = tasksById.get(m.task_id)
		if (!task) return
		task.description = m.description ?? task.description
		task.toolUseId = m.tool_use_id ?? task.toolUseId
		persistTask(task, "running", {
			usage: m.usage,
			lastToolName: m.last_tool_name,
		})
	}

	/**
	 * Handle SDKTaskUpdatedMessage — the SDK's incremental-patch channel
	 * for background tasks, including `in_process_teammate` tasks that
	 * share the leader's process and often never emit a terminal
	 * `task_notification`. The `patch.status` field drives the state
	 * transition; terminal values (`completed` / `failed` / `killed`)
	 * finalise the Subagent part the same way a task_notification does.
	 */
	function handleTaskUpdated(msg: SdkMessageLike): void {
		const m = msg as {
			task_id?: string
			patch?: {
				status?: "pending" | "running" | "completed" | "failed" | "killed"
				description?: string
				end_time?: number
				error?: string
				is_backgrounded?: boolean
			}
		}
		if (typeof m.task_id !== "string" || !m.patch) return
		const task = tasksById.get(m.task_id)
		if (!task) return

		if (typeof m.patch.description === "string") task.description = m.patch.description

		const status = m.patch.status
		if (status === "completed" || status === "failed" || status === "killed") {
			const partState: "completed" | "error" = status === "completed" ? "completed" : "error"
			persistTask(task, partState, {
				status: status === "completed" ? "completed" : status === "killed" ? "stopped" : "failed",
				endedAt: m.patch.end_time ?? Date.now(),
				summary: m.patch.error,
			})
			tasksById.delete(m.task_id)
			onTaskFinished?.(m.task_id)
			return
		}

		// Non-terminal update: just refresh the description; leave state running.
		persistTask(task, "running", {})
	}

	function handleTaskNotification(msg: SdkMessageLike): void {
		const m = msg as {
			task_id?: string
			tool_use_id?: string
			status?: "completed" | "failed" | "stopped"
			output_file?: string
			summary?: string
			usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
		}
		if (typeof m.task_id !== "string") return
		const task = tasksById.get(m.task_id) ?? {
			partId: ulid(),
			taskId: m.task_id,
			startedAt: Date.now(),
			toolUseId: m.tool_use_id,
		}
		task.toolUseId = m.tool_use_id ?? task.toolUseId
		tasksById.set(m.task_id, task)
		const state = m.status === "completed" ? "completed" : "error"
		persistTask(task, state, {
			status: m.status,
			outputFile: m.output_file,
			summary: m.summary,
			usage: m.usage,
			endedAt: Date.now(),
		})
		tasksById.delete(m.task_id)
		onTaskFinished?.(m.task_id)
	}

	/** Emit a task part reusing the tool-part shape (tool: "Task"). */
	function persistTask(
		task: TaskState,
		state: "running" | "completed" | "error",
		extra: {
			usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
			lastToolName?: string
			status?: "completed" | "failed" | "stopped"
			outputFile?: string
			summary?: string
			endedAt?: number
		},
	): void {
		const input: Record<string, unknown> = { task_id: task.taskId }
		if (task.description) input.description = task.description
		if (task.taskType) input.task_type = task.taskType
		if (task.toolUseId) input.tool_use_id = task.toolUseId

		const metadata: Record<string, unknown> = { taskId: task.taskId }
		if (extra.usage) metadata.usage = extra.usage
		if (extra.lastToolName) metadata.lastToolName = extra.lastToolName
		if (extra.status) metadata.status = extra.status
		if (extra.outputFile) metadata.outputFile = extra.outputFile
		if (extra.summary) metadata.summary = extra.summary

		const data: Record<string, unknown> = {
			type: "tool",
			callId: task.taskId,
			tool: "Subagent",
			state,
			input,
			metadata,
			time: {
				start: task.startedAt,
				...(extra.endedAt !== undefined ? { end: extra.endedAt } : {}),
			},
		}
		if (extra.summary) {
			if (state === "error") {
				data.error = extra.summary
			} else {
				data.output = extra.summary
			}
		}

		emitter.upsertPart({
			id: task.partId,
			type: "tool",
			data,
		})
	}

	function handleAuthStatus(msg: SdkMessageLike): void {
		const error = (msg as { error?: string; output?: unknown }).error
		const message =
			error ?? "Claude Code CLI reported an auth failure. Run `claude login` and try again."
		onAuthFailure?.(message)
	}

	/** Public API ------------------------------------------------------- */

	return {
		/**
		 * Seed the adapter with the pre-turn snapshot hash. The runtime
		 * captures the snapshot before calling `query()` and hands it here.
		 */
		beginTurn(preHash: string | undefined): void {
			preSnapshotHash = preHash
			mainAgentActiveFiredThisTurn = false
			totalUsage = {
				input: 0,
				output: 0,
				reasoning: 0,
				cacheRead: 0,
				cacheWrite: 0,
			}
		},

		/** Snapshot of the current accumulated usage. Used by the runtime
		 *  to emit a final `session:usage` even when `finalize()` runs
		 *  with no `result` payload (abort path). */
		get currentUsage(): TurnUsage {
			return totalUsage
		},

		/**
		 * Feed one SDK message into the adapter. Errors are caught and
		 * logged so one malformed event cannot poison the whole turn.
		 */
		handle(msg: SdkMessageLike): void {
			try {
				if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return

				log.info("[sdk-msg]", {
					type: msg.type,
					subtype: (msg as { subtype?: string }).subtype,
					isReplay: (msg as { isReplay?: boolean }).isReplay,
					parentToolUseId: (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id,
					eventType:
						msg.type === "stream_event"
							? ((msg as { event?: { type?: string } }).event?.type ?? undefined)
							: undefined,
					toolResults:
						msg.type === "user"
							? collectToolResultIds(msg as { message?: { content?: unknown } })
							: undefined,
				})

				if ("session_id" in msg) noteSessionId((msg as { session_id?: unknown }).session_id)

				switch (msg.type) {
					case "stream_event":
						handleStreamEvent(msg as SdkMessageLike & { event?: any })
						break
					case "user":
						handleUserMessage(msg)
						break
					case "assistant":
						handleAssistantMessage(msg)
						break
					case "system":
						handleSystemMessage(msg)
						break
					case "result":
						// Buffered on the way out — the actual emission of
						// step-finish happens in `finalize()` so the runtime
						// can attach the post-turn snapshot + edit files.
						resultPayload = {
							finishReason:
								(msg as { stop_reason?: string | null }).stop_reason ??
								((msg as { subtype?: string }).subtype === "success" ? "stop" : "error"),
							usage: normalizeUsage((msg as { usage?: unknown }).usage),
							costUsd: (msg as { total_cost_usd?: number }).total_cost_usd,
							durationMs: (msg as { duration_ms?: number }).duration_ms,
							numTurns: (msg as { num_turns?: number }).num_turns,
						}
						break
					case "auth_status":
						handleAuthStatus(msg)
						break
					case "stream":
					case "control_request":
					case "control_response":
					case "hook_started":
					case "hook_progress":
					case "hook_response":
					case "prompt_suggestion":
					case "rate_limit_event":
					case "tool_progress":
					case "elicitation_complete":
					case "memory_recall":
					case "files_persisted":
					case "tool_use_summary":
					case "local_command_output":
						// Informational / pass-through — nothing to persist.
						break
					default:
						log.debug("Unhandled SDK message type", { type: msg.type })
						break
				}
			} catch (err) {
				log.error("Adapter failed to handle SDK message", {
					type: (msg as { type?: unknown } | undefined)?.type,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		},

		/**
		 * Flush any unclosed parts (for an abort or early stream end), emit
		 * the step-finish + edit parts, and return what the runtime needs to
		 * persist on the assistant message (finish reason, usage, etc.).
		 */
		finalize(finalizeOpts: FinalizeOptions = {}): FinalizeResult {
			// Flush any text/reasoning blocks that never saw a stop event —
			// partial streams + aborts land here. Walk every parent partition
			// so subagent blocks get flushed alongside main-agent blocks.
			for (const textMap of texts.values()) {
				for (const state of textMap.values()) flushText(state)
			}
			texts.clear()
			for (const reasoningMap of reasonings.values()) {
				for (const state of reasoningMap.values()) flushReasoning(state)
			}
			reasonings.clear()

			// Tools still in flight: mark as errors. Mirrors
			// cleanupPendingTools() in stream-processor.ts.
			for (const indexMap of toolsByIndex.values()) {
				for (const tool of indexMap.values()) {
					persistTool(tool, "error", {
						error: "Stream ended before tool completed",
						endedAt: Date.now(),
					})
					toolsById.delete(tool.callId)
				}
			}
			toolsByIndex.clear()
			for (const tool of toolsById.values()) {
				// Tool opened successfully but never got a tool_result back.
				if (tool.resolved) continue
				persistTool(tool, "error", {
					error: "Stream ended before tool result arrived",
					endedAt: Date.now(),
				})
			}
			toolsById.clear()

			const finishReason = resultPayload?.finishReason ?? "stop"
			const costUsd = resultPayload?.costUsd
			const durationMs = resultPayload?.durationMs
			const numTurns = resultPayload?.numTurns

			// Prefer the live-accumulated total over the result payload's
			// snapshot — it survives the abort path (where `result` may
			// never arrive) and matches the value already emitted to the
			// UsageBar via `onUsageUpdate`. Fall back to result.usage when
			// no assistant messages were observed (rare edge case).
			const usage: FinalizeResult["usage"] =
				totalUsage.input > 0 || totalUsage.output > 0
					? {
							input: totalUsage.input,
							output: totalUsage.output,
							cacheRead: totalUsage.cacheRead,
							cacheWrite: totalUsage.cacheWrite,
						}
					: resultPayload?.usage

			// Always emit step-finish so the UI gets a closing timestamp.
			emitter.upsertPart({
				id: ulid(),
				type: "step-finish",
				data: {
					type: "step-finish",
					finishReason,
					usage,
					cost: costUsd,
					snapshot: finalizeOpts.snapshotHash,
				},
			})

			// Only emit an edit part if the runtime computed diff stats for us.
			if (
				finalizeOpts.editFiles &&
				finalizeOpts.editFiles.length > 0 &&
				finalizeOpts.snapshotHash
			) {
				const edit = {
					type: "edit" as const,
					hash: finalizeOpts.snapshotHash,
					files: finalizeOpts.editFiles,
					totalAdditions: finalizeOpts.editFiles.reduce((s, f) => s + f.additions, 0),
					totalDeletions: finalizeOpts.editFiles.reduce((s, f) => s + f.deletions, 0),
				}
				emitter.upsertPart({
					id: ulid(),
					type: "edit",
					data: edit,
				})
			}

			return {
				finishReason,
				usage,
				costUsd,
				durationMs,
				numTurns,
			}
		},

		/** Most recent SDK session id, for the runtime to persist. */
		get currentSessionId(): string | undefined {
			return sdkSessionId
		},

		/**
		 * Attach metadata to an in-flight tool part by its SDK call ID.
		 *
		 * Used by the permission bridge to inject data that is only available
		 * through the `canUseTool` callback (e.g. the plan text for
		 * ExitPlanMode, which the SDK enriches beyond the streamed input).
		 */
		attachToolMetadata(callId: string, metadata: Record<string, unknown>): void {
			const tool = toolsById.get(callId)
			if (!tool) {
				log.debug("attachToolMetadata: tool not found", { callId })
				return
			}
			// Write into tool.metadata so it survives across persistTool calls.
			tool.metadata = { ...tool.metadata, ...metadata }
			persistTool(tool, tool.closed ? "running" : "pending")
		},
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Summarise tool_result blocks in a user SDK message for diagnostic logging. */
function collectToolResultIds(
	msg: { message?: { content?: unknown } } | undefined,
): Array<{ id: string; isError: boolean }> | undefined {
	const content = msg?.message?.content
	if (!Array.isArray(content)) return undefined
	const out: Array<{ id: string; isError: boolean }> = []
	for (const block of content) {
		if (!block || typeof block !== "object") continue
		const b = block as { type?: string; tool_use_id?: string; is_error?: boolean }
		if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
			out.push({ id: b.tool_use_id, isError: b.is_error === true })
		}
	}
	return out.length > 0 ? out : undefined
}

/** Best-effort JSON parse — returns undefined on failure instead of throwing. */
function tryParseJson(raw: string): unknown | undefined {
	if (!raw) return undefined
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

/**
 * Best-effort parse of an incomplete JSON object from streamed
 * `input_json_delta` chunks. Tries strict parse first; if that fails,
 * truncates `raw` at the last position where closing open containers
 * produces valid JSON. The goal is to surface fields that have
 * streamed in before the full input is balanced — e.g. Write's
 * `file_path` appearing before the (potentially large) `content`
 * string finishes.
 *
 * Not a general-purpose tolerant JSON parser — only handles the
 * streaming-prefix case (input starts with `{`).
 */
export function tryParsePartialJsonObject(raw: string): Record<string, unknown> | undefined {
	if (!raw) return undefined
	const strict = tryParseJson(raw)
	if (strict && typeof strict === "object" && !Array.isArray(strict)) {
		return strict as Record<string, unknown>
	}
	const completed = completeUnterminatedJson(raw)
	if (!completed) return undefined
	const lenient = tryParseJson(completed)
	if (lenient && typeof lenient === "object" && !Array.isArray(lenient)) {
		return lenient as Record<string, unknown>
	}
	return undefined
}

/**
 * Truncate `raw` at the last position where the prefix forms a valid
 * JSON start, then append closing brackets. Returns undefined if no
 * usable prefix exists or `raw` isn't a JSON object.
 *
 * "Safe" positions are those between pairs — right after an opening
 * `{`/`[`, right after a closing `}`/`]`, right after a completed
 * value (closing quote of a value string, end of a primitive), or
 * right before a `,`.
 */
function completeUnterminatedJson(raw: string): string | undefined {
	const trimmed = raw.trimStart()
	if (!trimmed.startsWith("{")) return undefined

	type Pos = "key" | "colon" | "value" | "after"
	const stack: Array<"{" | "["> = []
	let pos: Pos = "after"
	let inString = false
	let escaped = false
	let lastSafe = -1

	let i = 0
	while (i < trimmed.length) {
		const ch = trimmed[i]

		if (escaped) {
			escaped = false
			i++
			continue
		}
		if (inString) {
			if (ch === "\\") {
				escaped = true
				i++
				continue
			}
			if (ch === '"') {
				inString = false
				if (pos === "key") {
					pos = "colon"
				} else if (pos === "value") {
					pos = "after"
					lastSafe = i + 1
				}
			}
			i++
			continue
		}

		if (/\s/.test(ch)) {
			i++
			continue
		}

		if (ch === '"') {
			inString = true
			i++
			continue
		}

		if (ch === "{") {
			stack.push("{")
			pos = "key"
			lastSafe = i + 1
			i++
			continue
		}
		if (ch === "[") {
			stack.push("[")
			pos = "value"
			lastSafe = i + 1
			i++
			continue
		}
		if (ch === "}" || ch === "]") {
			stack.pop()
			pos = "after"
			lastSafe = i + 1
			i++
			continue
		}
		if (ch === ":") {
			if (pos === "colon") pos = "value"
			i++
			continue
		}
		if (ch === ",") {
			if (pos === "after") {
				lastSafe = i
				const parent = stack[stack.length - 1]
				pos = parent === "{" ? "key" : "value"
			}
			i++
			continue
		}

		// Primitive (number, true, false, null) — only valid in value position.
		if (pos === "value") {
			const start = i
			while (i < trimmed.length && !/[\s,\]}]/.test(trimmed[i])) i++
			const primText = trimmed.slice(start, i)
			try {
				JSON.parse(primText)
				pos = "after"
				lastSafe = i
			} catch {
				break
			}
			continue
		}

		break
	}

	if (lastSafe < 0) return undefined

	let result = trimmed.slice(0, lastSafe)
	const closers = computeClosers(result)
	while (closers.length > 0) result += closers.pop()
	return result
}

/** Walk `raw` and return the stack of closers needed to balance it. */
function computeClosers(raw: string): string[] {
	const closers: string[] = []
	let inString = false
	let escaped = false
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i]
		if (escaped) {
			escaped = false
			continue
		}
		if (inString) {
			if (ch === "\\") {
				escaped = true
				continue
			}
			if (ch === '"') inString = false
			continue
		}
		if (ch === '"') {
			inString = true
			continue
		}
		if (ch === "{") closers.push("}")
		else if (ch === "[") closers.push("]")
		else if (ch === "}" || ch === "]") closers.pop()
	}
	return closers
}

/**
 * Shape the tool input that goes onto the UI-facing part. Most tools
 * pass through as-is; TodoWrite needs its todo statuses remapped from
 * the SDK's `"pending" | "in_progress" | "completed"` to Loop's
 * `"pending" | "in-progress" | "done"` so the frontend's status
 * checks render the right checkbox as the input streams in.
 */
function prepareToolInputForEmit(
	toolName: string,
	input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!input) return input
	if (toolName !== "TodoWrite") return input
	const todos = input.todos
	if (!Array.isArray(todos)) return input
	const normalized = todos.map((t) =>
		t && typeof t === "object"
			? {
					...(t as Record<string, unknown>),
					status: normalizeTodoStatus((t as Record<string, unknown>).status),
				}
			: t,
	)
	return { ...input, todos: normalized }
}

/**
 * Convert an SDK tool_result content payload into a plain string for the
 * `tool.output` field. Handles the three shapes the Anthropic SDK emits:
 *   - string
 *   - array of `{ type: "text", text: string }` blocks
 *   - unknown object → JSON string
 */
function stringifyToolResultContent(content: unknown): string {
	if (content === undefined || content === null) return ""
	if (typeof content === "string") return content
	if (Array.isArray(content)) {
		const pieces: string[] = []
		for (const item of content) {
			if (!item || typeof item !== "object") continue
			const b = item as { type?: string; text?: string }
			if (b.type === "text" && typeof b.text === "string") {
				pieces.push(b.text)
			} else {
				pieces.push(JSON.stringify(b))
			}
		}
		return pieces.join("\n")
	}
	try {
		return JSON.stringify(content)
	} catch {
		return String(content)
	}
}

/**
 * Extract structured metadata from a tool result for tools that need
 * richer data than just a stringified output. Returns undefined if no
 * metadata is applicable.
 *
 * Handled tools:
 *   - Write / Edit / MultiEdit — extract gitDiff (patch, additions, deletions)
 *   - TodoWrite — extract newTodos and normalize status values
 *   - ExitPlanMode — extract plan content (from input) and filePath (from result)
 */
function extractToolMetadata(
	toolName: string,
	resultContent: unknown,
	toolInput?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	switch (toolName) {
		case "Write":
		case "Edit":
			return extractFileMutationMetadata(resultContent)

		case "MultiEdit": {
			const resultParsed = parseToolResultJson(resultContent)
			if (!resultParsed) return undefined
			const metadata: Record<string, unknown> = {}
			// MultiEdit wraps results in an `edits` array; aggregate diffs.
			const edits = Array.isArray(resultParsed.edits) ? resultParsed.edits : []
			if (edits.length > 0) {
				metadata.editCount = edits.length
				let totalAdd = 0
				let totalDel = 0
				const patches: string[] = []
				for (const edit of edits) {
					const gd = (edit as Record<string, unknown>)?.gitDiff as
						| Record<string, unknown>
						| undefined
					if (gd) {
						if (typeof gd.additions === "number") totalAdd += gd.additions
						if (typeof gd.deletions === "number") totalDel += gd.deletions
						if (typeof gd.patch === "string") patches.push(gd.patch)
					}
				}
				if (patches.length > 0) metadata.diff = patches.join("\n")
				if (totalAdd > 0) metadata.additions = totalAdd
				if (totalDel > 0) metadata.deletions = totalDel
			} else {
				// Fallback: single-result shape (same as Write/Edit).
				return extractFileMutationMetadata(resultContent)
			}
			return Object.keys(metadata).length > 0 ? metadata : undefined
		}

		case "TodoWrite":
			return extractTodoWriteMetadata(resultContent)

		case "ExitPlanMode":
			return extractExitPlanModeMetadata(resultContent, toolInput)

		case "Agent":
			return extractAgentMetadata(resultContent, toolInput)

		default:
			return undefined
	}
}

/**
 * Extract metadata from the Agent tool's discriminated output. The
 * `status` field distinguishes three terminal shapes:
 *   - "async_launched" — background subagent queued (run_in_background)
 *   - "completed"      — in-line subagent finished
 *   - "sub_agent_entered" — interactive handoff
 *
 * We surface a `phase` hint to the UI so the Agent card can render
 * "Launched" (background) vs "Completed" (inline) vs the subagent-entered
 * banner, instead of the generic completed state.
 */
function extractAgentMetadata(
	resultContent: unknown,
	toolInput?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const parsed = parseToolResultJson(resultContent)
	if (!parsed) return undefined
	const status = typeof parsed.status === "string" ? parsed.status : undefined
	if (!status) return undefined

	const metadata: Record<string, unknown> = { agentStatus: status }
	if (typeof parsed.agentId === "string") metadata.agentId = parsed.agentId
	if (typeof parsed.description === "string") metadata.description = parsed.description
	else if (toolInput && typeof toolInput.description === "string") {
		metadata.description = toolInput.description
	}
	if (typeof parsed.prompt === "string") metadata.prompt = parsed.prompt
	else if (toolInput && typeof toolInput.prompt === "string") {
		metadata.prompt = toolInput.prompt
	}
	if (typeof parsed.outputFile === "string") metadata.outputFile = parsed.outputFile
	if (typeof parsed.canReadOutputFile === "boolean") {
		metadata.canReadOutputFile = parsed.canReadOutputFile
	}
	if (toolInput && typeof toolInput.subagent_type === "string") {
		metadata.subagentType = toolInput.subagent_type
	}
	if (typeof parsed.totalTokens === "number") metadata.totalTokens = parsed.totalTokens
	if (typeof parsed.totalToolUseCount === "number") {
		metadata.totalToolUseCount = parsed.totalToolUseCount
	}
	if (typeof parsed.totalDurationMs === "number") metadata.totalDurationMs = parsed.totalDurationMs
	if (status === "sub_agent_entered" && typeof parsed.message === "string") {
		metadata.enteredMessage = parsed.message
	}
	return metadata
}

/** Extract gitDiff metadata from a Write or Edit tool result. */
function extractFileMutationMetadata(resultContent: unknown): Record<string, unknown> | undefined {
	const parsed = parseToolResultJson(resultContent)
	if (!parsed) return undefined
	const gd = parsed.gitDiff as Record<string, unknown> | undefined
	if (!gd) return undefined
	const metadata: Record<string, unknown> = {}
	if (typeof gd.patch === "string") metadata.diff = gd.patch
	if (typeof gd.additions === "number") metadata.additions = gd.additions
	if (typeof gd.deletions === "number") metadata.deletions = gd.deletions
	return Object.keys(metadata).length > 0 ? metadata : undefined
}

/**
 * Extract newTodos from a TodoWrite result and normalize SDK status
 * values (`"completed"` → `"done"`, `"in_progress"` → `"in-progress"`)
 * so the frontend's existing status checks work uniformly.
 */
function extractTodoWriteMetadata(resultContent: unknown): Record<string, unknown> | undefined {
	const parsed = parseToolResultJson(resultContent)
	if (!parsed) return undefined
	const newTodos = Array.isArray(parsed.newTodos) ? parsed.newTodos : undefined
	if (!newTodos || newTodos.length === 0) return undefined
	// Normalize status values from SDK conventions to Loop conventions.
	const normalized = newTodos.map((t: Record<string, unknown>) => ({
		...t,
		status: normalizeTodoStatus(t.status),
	}))
	return { todos: normalized }
}

/** Map SDK todo status strings to Loop's frontend conventions. */
function normalizeTodoStatus(status: unknown): string {
	if (typeof status !== "string") return "pending"
	switch (status) {
		case "completed":
			return "done"
		case "in_progress":
			return "in-progress"
		default:
			return status
	}
}

/** Extract plan content from ExitPlanMode input + result. */
function extractExitPlanModeMetadata(
	resultContent: unknown,
	toolInput?: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {}

	// 1. Primary: plan text from the tool INPUT (where the SDK places it).
	if (toolInput && typeof toolInput.plan === "string" && toolInput.plan.trim()) {
		metadata.planContent = toolInput.plan.trim()
	}

	// 2. Parse the tool result for filePath (and plan as a fallback).
	const resultParsed = parseToolResultJson(resultContent)
	if (resultParsed) {
		if (typeof resultParsed.filePath === "string" && resultParsed.filePath) {
			metadata.planPath = resultParsed.filePath
		}
		if (
			!metadata.planContent &&
			typeof resultParsed.plan === "string" &&
			resultParsed.plan.trim()
		) {
			metadata.planContent = resultParsed.plan.trim()
		}
	}

	// 3. Last resort: read the plan file from disk.
	if (!metadata.planContent && metadata.planPath) {
		const planText = readPlanFile(metadata.planPath as string)
		if (planText) metadata.planContent = planText
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined
}

/**
 * Parse a tool_result content payload into a JSON object.
 * Handles string, single-element text array, or object shapes.
 */
function parseToolResultJson(content: unknown): Record<string, unknown> | undefined {
	if (!content) return undefined

	// Direct object — the SDK sometimes passes the parsed result directly.
	if (typeof content === "object" && !Array.isArray(content)) {
		return content as Record<string, unknown>
	}

	// String — try JSON parse.
	if (typeof content === "string") {
		try {
			const parsed = JSON.parse(content)
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>
			}
		} catch {
			return undefined
		}
	}

	// Array of text blocks — concatenate and parse.
	if (Array.isArray(content)) {
		const pieces: string[] = []
		for (const item of content) {
			if (!item || typeof item !== "object") continue
			const b = item as { type?: string; text?: string }
			if (b.type === "text" && typeof b.text === "string") {
				pieces.push(b.text)
			}
		}
		if (pieces.length === 0) return undefined
		try {
			const parsed = JSON.parse(pieces.join(""))
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>
			}
		} catch {
			return undefined
		}
	}

	return undefined
}

/**
 * Best-effort synchronous file read — used to load plan files from
 * `~/.claude/plans/`. Returns undefined on any error.
 */
function readPlanFile(path: string): string | undefined {
	try {
		return fsReadFileSync(path, "utf-8")
	} catch {
		return undefined
	}
}

/** Coerce an SDK usage object into Loop's usage shape.
 *
 *  Anthropic reports input as three disjoint buckets — `input_tokens`
 *  (uncached), `cache_creation_input_tokens` and `cache_read_input_tokens`
 *  — but the UsageBar's `input + output` formula expects a single total.
 *  We fold all three into `input` (matching t3code's `normalizeClaudeTokenUsage`
 *  and the AI SDK's `inputTokens` semantics) so the ring fills correctly,
 *  and keep the cache buckets separately for cost/tooltip detail. */
function normalizeUsage(raw: unknown): FinalizeResult["usage"] | undefined {
	const parsed = parseSdkUsage(raw)
	if (!parsed) return undefined
	return {
		input: parsed.input,
		output: parsed.output,
		cacheRead: parsed.cacheRead,
		cacheWrite: parsed.cacheWrite,
	}
}

/** Parse an Anthropic-shaped usage object into the per-step delta we
 *  accumulate. See `normalizeUsage` for the input-folding rationale.
 *  Returns undefined when nothing useful is present so the caller can
 *  skip the update + notification. */
function parseSdkUsage(raw: unknown): TurnUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined
	const u = raw as {
		input_tokens?: number
		output_tokens?: number
		cache_read_input_tokens?: number
		cache_creation_input_tokens?: number
	}
	const rawInput = typeof u.input_tokens === "number" ? u.input_tokens : 0
	const cacheRead = typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : 0
	const cacheWrite =
		typeof u.cache_creation_input_tokens === "number" ? u.cache_creation_input_tokens : 0
	const output = typeof u.output_tokens === "number" ? u.output_tokens : 0
	const input = rawInput + cacheRead + cacheWrite
	if (input === 0 && output === 0) return undefined
	return { input, output, reasoning: 0, cacheRead, cacheWrite }
}
