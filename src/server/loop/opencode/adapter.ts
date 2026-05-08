import { ulid } from "@core/id"
import { createLogger } from "../../logger"
import {
	extractOpenCodeToolMetadata,
	mapOpenCodeToolName,
	normalizeOpenCodeTodos,
	transformOpenCodeToolInput,
} from "./tool-mapping"

/**
 * Translates OpenCode SDK events into Loop's `Part` schema.
 *
 * OpenCode's wire protocol uses TWO event channels for streaming, both of
 * which we consume:
 *
 *   1. `message.part.updated` — full Part snapshot whenever a part is
 *      created or its state changes. Drives upserts of the canonical part
 *      state in our DB (text, reasoning, tool, step-start, step-finish).
 *      Each event carries the OpenCode-assigned `partID`, which we use
 *      directly as the Loop partId — this preserves DB ordinal order
 *      because we upsert in the same arrival sequence the server emits.
 *
 *   2. `message.part.delta` — incremental delta with `{ partID, field,
 *      delta }`. Used purely for the live streaming UX — emit `part:delta`
 *      to the bus so the frontend's streamingBuffer accumulates the chunks
 *      without re-rendering markdown until the next snapshot lands.
 *
 * The streaming protocol mirrors `stream-processor.ts` (the AI-SDK loop)
 * and the cursor / claude-code adapters: deltas to the bus only, snapshots
 * to the DB. The adapter is DB/bus-free — the runtime injects a
 * `PartEmitter` that wraps `Database.withEffects` + `bus()` calls.
 *
 * Other events handled:
 *   - `session.status` (with `status.type === "idle"`) — turn complete
 *     signal, surfaced via `onIdle` callback.
 *   - `session.idle` — fallback idle marker on older builds.
 *   - `session.error` — fatal session-level error.
 *   - `permission.asked` — forwarded to the runtime → permission bridge.
 *   - `message.updated` / `session.created` / `session.updated` — used
 *     only to resolve the OpenCode session id for the resume cursor.
 */

const log = createLogger("opencode-adapter")

// ── PartEmitter interface (DB/bus-free contract) ───────────────────────

export interface OpenCodePartEmitter {
	upsertPart(part: {
		id: string
		type: "text" | "reasoning" | "tool" | "step-start" | "step-finish" | "edit"
		data: Record<string, unknown>
	}): void
	emitDelta(args: { partId: string; delta: string; partType: "text" | "reasoning" }): void
}

// ── Inputs / callbacks ─────────────────────────────────────────────────

export interface OpenCodeAdapterOptions {
	emitter: OpenCodePartEmitter
	/** Fires when the OpenCode session ID is first observed. */
	onSessionId?: (sessionId: string) => void
	/** Fires once per turn on first assistant activity. */
	onActive?: () => void
	/** Per-step token usage updates so the UsageBar refreshes live. */
	onUsageUpdate?: (usage: TurnUsage) => void
	/** Forwarded permission requests (handled by the runtime + permission bridge). */
	onPermissionAsked?: (req: OpenCodePermissionRequest) => void
	/** Fatal session-level error (turn-killing). */
	onSessionError?: (message: string) => void
	/** Idle signal — turn finished, the runtime should stop awaiting. */
	onIdle?: () => void
}

export interface TurnUsage {
	input: number
	output: number
	reasoning: number
	cacheRead: number
	cacheWrite: number
}

export interface OpenCodePermissionRequest {
	id: string
	sessionID: string
	permission: string
	patterns: string[]
	always: string[]
	metadata: Record<string, unknown>
	tool?: { messageID: string; callID: string }
}

export interface OpenCodeFinalizeResult {
	finishReason: string
	usage: TurnUsage
	cost: number
	durationMs?: number
}

// ── Internal state ─────────────────────────────────────────────────────

interface TextLikeState {
	/** Last text we emitted to the bus — used to compute deltas from snapshots. */
	emittedText: string
	/** Loop part type (text or reasoning). */
	partType: "text" | "reasoning"
	/** Whether we've already flushed the final state via upsert. */
	finalized: boolean
}

interface ToolPartState {
	finalizedStatus?: "completed" | "error"
	/** Last seen mapped tool name. Used by `finalize()` so a stream that
	 *  ends mid-turn can still emit a meaningful error tool part instead
	 *  of the literal string "tool". */
	tool?: string
	/** Last seen callId — preserved for the same reason. */
	callId?: string
	/** Wallclock when the tool part was first observed. */
	startedAt?: number
}

/** Shape of a text-like Part snapshot we receive from OpenCode. */
interface TextSnapshotInput {
	id: string
	type: "text" | "reasoning"
	text?: string
	time?: { start?: number; end?: number }
}

// ── Event shape (loose typing — we only inspect known fields) ──────────

interface RawEvent {
	type: string
	properties?: Record<string, unknown>
	id?: string
}

// ── Public adapter ──────────────────────────────────────────────────────

export function createOpenCodeAdapter(opts: OpenCodeAdapterOptions) {
	const {
		emitter,
		onSessionId,
		onActive,
		onUsageUpdate,
		onPermissionAsked,
		onSessionError,
		onIdle,
	} = opts

	// Per-turn state. `textParts` / `toolParts` are keyed on OpenCode's
	// partID (which we use directly as the Loop partId) and track streaming
	// state so `message.part.delta` events can compute incremental deltas.
	//
	// `messageRoleById` lets us filter out user-message parts. OpenCode
	// emits `message.part.updated` for BOTH the user prompt echo and the
	// assistant response — without this gate, the user's text would be
	// echoed onto the assistant message in Loop.
	//
	// `pendingTextPartsByMessage` buffers text/reasoning parts that arrived
	// before their message's role was known. When `message.updated` later
	// confirms the role is "assistant", we drain the buffer through the
	// normal handler. If the role turns out to be "user", we drop them.
	const textParts = new Map<string, TextLikeState>()
	const toolParts = new Map<string, ToolPartState>()
	const messageRoleById = new Map<string, "user" | "assistant">()
	const pendingTextPartsByMessage = new Map<
		string,
		Array<{ part: TextSnapshotInput; messageId: string }>
	>()
	let activeFired = false
	let preSnapshotHash: string | undefined
	let stepStartEmitted = false
	let openCodeSessionIdSeen: string | undefined
	let finishReason = "stop"
	/** Most recently observed model `todowrite` partId. `todo.updated` events
	 *  refresh THIS partId so the canonical tool-call card is updated in
	 *  place rather than producing a duplicate row. Falls back to allocating
	 *  a fresh id only when the model never called todowrite directly (rare
	 *  defensive case). */
	let lastTodoToolPartId: string | undefined
	/** Set when we've already surfaced an EditPart from `session.diff` so the
	 *  runtime's pre/post snapshot fallback (Layer C4) can skip the redundant
	 *  emit. */
	let emittedEditFromDiff = false
	/** Tool partIds currently in pending or running state. Lets the idle
	 *  detector distinguish "model paused waiting for tools" from "model
	 *  done" — a step.ended with finish !== "tool_calls" AND no in-flight
	 *  tools is a reliable end-of-turn signal. */
	const toolsInFlight = new Set<string>()
	const accumulatedUsage: TurnUsage = {
		input: 0,
		output: 0,
		reasoning: 0,
		cacheRead: 0,
		cacheWrite: 0,
	}
	let accumulatedCost = 0
	let turnStartedAt = Date.now()

	function reset(snapshotHash: string | undefined): void {
		textParts.clear()
		toolParts.clear()
		messageRoleById.clear()
		pendingTextPartsByMessage.clear()
		toolsInFlight.clear()
		activeFired = false
		stepStartEmitted = false
		preSnapshotHash = snapshotHash
		finishReason = "stop"
		lastTodoToolPartId = undefined
		emittedEditFromDiff = false
		accumulatedUsage.input = 0
		accumulatedUsage.output = 0
		accumulatedUsage.reasoning = 0
		accumulatedUsage.cacheRead = 0
		accumulatedUsage.cacheWrite = 0
		accumulatedCost = 0
		turnStartedAt = Date.now()
	}

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

	function noteSessionId(id: string | undefined): void {
		if (!id || openCodeSessionIdSeen === id) return
		openCodeSessionIdSeen = id
		onSessionId?.(id)
	}

	/**
	 * Track a tool's lifecycle in `toolsInFlight`. Pending/running adds the
	 * id; completed/error removes it. The idle detector reads this set to
	 * decide whether `step.ended` means "done" or "paused waiting on tools".
	 */
	function trackToolInFlight(
		partId: string,
		status: "pending" | "running" | "completed" | "error",
	): void {
		if (status === "pending" || status === "running") {
			toolsInFlight.add(partId)
		} else {
			toolsInFlight.delete(partId)
		}
	}

	/**
	 * Store the role for a message id, then drain any text parts that
	 * arrived for it before the role was known. Assistant role replays the
	 * buffered parts through the normal handler; user role drops them.
	 */
	function recordMessageRole(messageId: string, role: "user" | "assistant"): void {
		const previous = messageRoleById.get(messageId)
		if (previous === role) return
		messageRoleById.set(messageId, role)

		const pending = pendingTextPartsByMessage.get(messageId)
		if (!pending || pending.length === 0) return
		pendingTextPartsByMessage.delete(messageId)
		if (role !== "assistant") return
		for (const entry of pending) {
			handleTextPartSnapshot(entry.part, entry.messageId)
		}
	}

	// ── Part-snapshot handlers ──────────────────────────────────────────

	/**
	 * Handle a text/reasoning Part snapshot — gated by message role.
	 *
	 * If the role of the part's owning message is unknown we BUFFER the
	 * snapshot. `message.updated` later resolves the role; an "assistant"
	 * resolution drains the buffer through this handler again, and a
	 * "user" resolution drops the buffer entirely. This stops user-prompt
	 * echoes from leaking onto the assistant message in the UI.
	 */
	function handleTextPartSnapshot(part: TextSnapshotInput, messageId: string): void {
		const role = messageRoleById.get(messageId)
		if (role === "user") return
		if (!role) {
			let pending = pendingTextPartsByMessage.get(messageId)
			if (!pending) {
				pending = []
				pendingTextPartsByMessage.set(messageId, pending)
			}
			pending.push({ part, messageId })
			return
		}

		const partType = part.type
		const text = typeof part.text === "string" ? part.text : ""
		const finalized = part.time?.end !== undefined

		ensureStepStart()
		fireActive()

		const existing = textParts.get(part.id)
		if (!existing) {
			// First time we've seen this part. Reserve the partId in the DB
			// (locks ordinal) and emit an empty placeholder delta so the
			// frontend's streaming buffer creates a slot in the right
			// position before the next chunk arrives.
			textParts.set(part.id, { emittedText: "", partType, finalized: false })
			emitter.upsertPart({
				id: part.id,
				type: partType,
				data: buildTextData(partType, "", part.time),
			})
			emitter.emitDelta({ partId: part.id, delta: "", partType })
		}

		const state = textParts.get(part.id)!
		// Compute the incremental delta from the snapshot. We use this when
		// `message.part.delta` events are missing or arrive out of order;
		// the snapshot is always authoritative.
		if (text.length > state.emittedText.length && text.startsWith(state.emittedText)) {
			const delta = text.slice(state.emittedText.length)
			state.emittedText = text
			emitter.emitDelta({ partId: part.id, delta, partType })
		} else if (text !== state.emittedText) {
			// Snapshot diverged from our buffer (server rewrote). Resync the
			// frontend by emitting the text as a single delta — the
			// streaming buffer overwrites on conflict via the upsert below.
			state.emittedText = text
		}

		if (finalized && !state.finalized) {
			state.finalized = true
			emitter.upsertPart({
				id: part.id,
				type: partType,
				data: buildTextData(partType, text, part.time),
			})
		}
	}

	function handleToolPartSnapshot(part: {
		id: string
		type: "tool"
		callID?: string
		tool: string
		state: {
			status: "pending" | "running" | "completed" | "error"
			input?: Record<string, unknown>
			output?: string
			error?: string
			content?: Array<{ type?: string; text?: string }>
			time?: { start?: number; end?: number }
			title?: string
		}
		metadata?: Record<string, unknown>
	}): void {
		ensureStepStart()
		fireActive()

		const toolName = mapOpenCodeToolName(part.tool)

		// Todos: render the model's tool part directly. We used to short-circuit
		// here and rely solely on `todo.updated`, but that event isn't
		// guaranteed to fire on every OpenCode build — when it doesn't, todos
		// silently disappear. The model's tool part always carries the canonical
		// `input.todos`, and `extractOpenCodeToolMetadata` mirrors it into
		// `metadata.todos` so Loop's TodoWriteToolCall renderer (which prefers
		// metadata over input) shows the right state. We track the partId so
		// any subsequent `todo.updated` can refresh THIS row instead of opening
		// a duplicate one.
		if (toolName === "todowrite" || toolName === "todoread") {
			lastTodoToolPartId = part.id
		}

		const tracker = toolParts.get(part.id) ?? {}
		toolParts.set(part.id, tracker)
		// Don't downgrade from terminal back to running (out-of-order events).
		if (tracker.finalizedStatus && part.state.status !== tracker.finalizedStatus) return

		const callId = part.callID ?? part.id
		const start = part.state.time?.start ?? Date.now()
		const end = part.state.time?.end
		// Capture for finalize() — if the stream ends without a terminal
		// status, we still want to emit a meaningful error part instead of
		// the literal "tool" placeholder.
		tracker.tool = toolName
		tracker.callId = callId
		if (tracker.startedAt === undefined) tracker.startedAt = start

		// Track in-flight tool count so the multi-signal idle detector can
		// distinguish "model paused waiting for tools" from "model done".
		trackToolInFlight(part.id, part.state.status)

		// Translate OpenCode's tool name + field shape to Loop's expectations
		// so the per-tool renderers in tool-call.tsx find what they expect.
		// Without this, OpenCode tool calls render through DefaultToolCall as
		// raw JSON and lose the rich edit/read/grep/todo UI.
		const mappedInput = transformOpenCodeToolInput(part.tool, part.state.input)
		const derivedMeta = extractOpenCodeToolMetadata(part.tool, part.state)
		const metadata = mergeMetadata(part.metadata, derivedMeta)

		switch (part.state.status) {
			case "pending":
				emitter.upsertPart({
					id: part.id,
					type: "tool",
					data: {
						type: "tool",
						callId,
						tool: toolName,
						state: "pending",
						time: { start },
					},
				})
				return
			case "running":
				emitter.upsertPart({
					id: part.id,
					type: "tool",
					data: {
						type: "tool",
						callId,
						tool: toolName,
						state: "running",
						input: mappedInput,
						...(metadata ? { metadata } : {}),
						time: { start },
					},
				})
				return
			case "completed": {
				tracker.finalizedStatus = "completed"
				const output =
					typeof part.state.output === "string"
						? part.state.output
						: collectToolText(part.state.content ?? [])
				emitter.upsertPart({
					id: part.id,
					type: "tool",
					data: {
						type: "tool",
						callId,
						tool: toolName,
						state: "completed",
						input: mappedInput,
						output,
						...(metadata ? { metadata } : {}),
						time: { start, ...(end ? { end } : {}) },
					},
				})
				return
			}
			case "error": {
				tracker.finalizedStatus = "error"
				const errorMessage = typeof part.state.error === "string" ? part.state.error : "Tool failed"
				emitter.upsertPart({
					id: part.id,
					type: "tool",
					data: {
						type: "tool",
						callId,
						tool: toolName,
						state: "error",
						input: mappedInput,
						error: errorMessage,
						...(metadata ? { metadata } : {}),
						time: { start, ...(end ? { end } : {}) },
					},
				})
				return
			}
		}
	}

	/** Merge OpenCode-supplied metadata with our derived metadata. */
	function mergeMetadata(
		base: Record<string, unknown> | undefined,
		derived: Record<string, unknown>,
	): Record<string, unknown> | undefined {
		if (!base && Object.keys(derived).length === 0) return undefined
		return { ...(base ?? {}), ...derived }
	}

	/**
	 * Translate an OpenCode `subtask` or `agent` part into Loop's
	 * `tool: "Subagent"` envelope so the frontend's TaskPanel surfaces it
	 * (TaskPanel filters for that exact tool name and tool-call.tsx
	 * suppresses inline rendering for it). The tracker prevents duplicate
	 * upserts when both subtask and agent updates arrive for the same id.
	 */
	function handleSubagentPartSnapshot(part: {
		id: string
		type: "subtask" | "agent"
		description?: string
		name?: string
		agent?: string
		prompt?: string
		model?: { providerID: string; modelID: string }
		command?: string
	}): void {
		ensureStepStart()
		fireActive()

		const tracker = toolParts.get(part.id) ?? {}
		toolParts.set(part.id, tracker)
		if (tracker.finalizedStatus) return

		const description = part.description ?? part.name ?? part.agent ?? "Subagent"
		const subagentType = part.agent ?? "explore"
		const start = Date.now()

		emitter.upsertPart({
			id: part.id,
			type: "tool",
			data: {
				type: "tool",
				callId: part.id,
				tool: "Subagent",
				state: "running",
				input: {
					description,
					...(part.prompt ? { prompt: part.prompt } : {}),
					subagent_type: subagentType,
				},
				metadata: {
					description,
					agentType: subagentType,
					...(part.model ? { model: part.model } : {}),
				},
				time: { start },
			},
		})
	}

	function handleStepStartSnapshot(part: { id: string; snapshot?: string }): void {
		stepStartEmitted = true
		emitter.upsertPart({
			id: part.id,
			type: "step-start",
			data: { type: "step-start", ...(part.snapshot ? { snapshot: part.snapshot } : {}) },
		})
	}

	function handleStepFinishSnapshot(part: {
		id: string
		reason?: string
		snapshot?: string
		cost?: number
		tokens?: {
			input?: number
			output?: number
			reasoning?: number
			cache?: { read?: number; write?: number }
		}
	}): void {
		const usage: TurnUsage = {
			input: part.tokens?.input ?? 0,
			output: part.tokens?.output ?? 0,
			reasoning: part.tokens?.reasoning ?? 0,
			cacheRead: part.tokens?.cache?.read ?? 0,
			cacheWrite: part.tokens?.cache?.write ?? 0,
		}
		const cost = part.cost ?? 0
		accumulatedUsage.input += usage.input
		accumulatedUsage.output += usage.output
		accumulatedUsage.reasoning += usage.reasoning
		accumulatedUsage.cacheRead += usage.cacheRead
		accumulatedUsage.cacheWrite += usage.cacheWrite
		accumulatedCost += cost
		if (part.reason) finishReason = part.reason
		onUsageUpdate?.({ ...accumulatedUsage })

		emitter.upsertPart({
			id: part.id,
			type: "step-finish",
			data: {
				type: "step-finish",
				finishReason: part.reason ?? "stop",
				usage,
				cost,
				...(part.snapshot ? { snapshot: part.snapshot } : {}),
			},
		})
		// Allow a fresh step-start for any subsequent step in the same turn.
		stepStartEmitted = false

		// Multi-signal idle detection: OpenCode's `session.idle` event isn't
		// reliable for long-running turns, so we fire `onIdle` early when a
		// step ends with a terminal finish reason AND no tools are still
		// in flight. The runtime de-bounces — calling signalIdle() multiple
		// times resolves the same deferred once.
		const reason = part.reason ?? ""
		const isTerminalFinish = reason === "stop" || reason === "end_turn" || reason === "length"
		if (isTerminalFinish && toolsInFlight.size === 0) {
			onIdle?.()
		}
	}

	// ── Event dispatch ──────────────────────────────────────────────────

	function handle(raw: RawEvent): void {
		try {
			dispatch(raw)
		} catch (err) {
			// The OpenCode SDK's stream is unbounded — a thrown adapter error
			// would interrupt the entire turn. Log and swallow.
			log.warn("Adapter handler error", {
				type: raw.type,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	function dispatch(raw: RawEvent): void {
		const props = (raw.properties ?? {}) as Record<string, unknown>

		switch (raw.type) {
			case "message.part.updated": {
				const part = props.part as
					| {
							id: string
							messageID?: string
							type: string
							[k: string]: unknown
					  }
					| undefined
				if (!part?.id || typeof part.type !== "string") return
				const messageId = typeof part.messageID === "string" ? part.messageID : undefined

				switch (part.type) {
					case "text":
					case "reasoning":
						// Gate by message role — user-message parts get filtered
						// out (or buffered until role is resolved). Without this
						// gate the user's prompt echo would render as assistant
						// text in Loop.
						if (!messageId) return
						handleTextPartSnapshot(part as TextSnapshotInput, messageId)
						return
					case "tool":
						handleToolPartSnapshot(part as Parameters<typeof handleToolPartSnapshot>[0])
						return
					case "step-start":
						handleStepStartSnapshot(part as { id: string; snapshot?: string })
						return
					case "step-finish":
						handleStepFinishSnapshot(part as Parameters<typeof handleStepFinishSnapshot>[0])
						return
					case "subtask":
					case "agent":
						// Translate to Loop's `tool` part with `tool: "Subagent"` so
						// the existing TaskPanel renderer surfaces it (it filters
						// for that exact tool name and suppresses inline rendering).
						handleSubagentPartSnapshot(
							part as {
								id: string
								type: "subtask" | "agent"
								description?: string
								name?: string
								agent?: string
								prompt?: string
								model?: { providerID: string; modelID: string }
								command?: string
							},
						)
						return
					default:
						// File / snapshot / patch / retry / compaction — drop.
						// Loop's renderers don't have a place for these yet.
						return
				}
			}

			case "message.part.delta": {
				const partId = typeof props.partID === "string" ? props.partID : undefined
				const delta = typeof props.delta === "string" ? props.delta : ""
				const messageId = typeof props.messageID === "string" ? props.messageID : undefined
				if (!partId || !delta) return
				// User-message deltas: drop. The role check on snapshots already
				// kept user parts out of `textParts`, so a missing entry is the
				// signal — but message.part.delta can race ahead of the snapshot
				// for assistant parts too, so we only short-circuit on a known
				// "user" role to avoid losing the first assistant chunk.
				if (messageId && messageRoleById.get(messageId) === "user") return

				const state = textParts.get(partId)
				if (!state) {
					// Delta arrived before snapshot — buffer it lazily by emitting
					// once the snapshot creates the part. We don't have the
					// partType yet (text vs reasoning), so we just drop this
					// pre-snapshot delta. Snapshots always include the full text
					// so nothing is lost — only the live streaming UX briefly
					// stalls until the snapshot lands.
					return
				}
				ensureStepStart()
				fireActive()
				state.emittedText += delta
				emitter.emitDelta({ partId, delta, partType: state.partType })
				return
			}

			case "message.part.removed": {
				const partId = typeof props.partID === "string" ? props.partID : undefined
				if (partId) {
					textParts.delete(partId)
					toolParts.delete(partId)
				}
				return
			}

			case "message.updated": {
				const info = isPlainObject(props.info)
					? (props.info as {
							id?: string
							sessionID?: string
							role?: "user" | "assistant"
						})
					: undefined
				if (info?.sessionID) noteSessionId(info.sessionID)
				if (info?.id && (info.role === "user" || info.role === "assistant")) {
					recordMessageRole(info.id, info.role)
				}
				return
			}

			case "session.created":
			case "session.updated": {
				const info = isPlainObject(props.info) ? (props.info as { id?: string }) : undefined
				if (info?.id) noteSessionId(info.id)
				return
			}

			case "session.status": {
				const status = props.status as { type?: string } | undefined
				if (status?.type === "idle") {
					onIdle?.()
				}
				return
			}

			case "session.idle": {
				onIdle?.()
				return
			}

			case "session.error": {
				const errorObj = isPlainObject(props.error) ? (props.error as Record<string, unknown>) : {}
				const data = isPlainObject(errorObj.data) ? (errorObj.data as Record<string, unknown>) : {}
				const message =
					typeof data.message === "string"
						? data.message
						: typeof errorObj.name === "string"
							? errorObj.name
							: "OpenCode session error"
				onSessionError?.(message)
				return
			}

			case "permission.asked": {
				const req = props as unknown as OpenCodePermissionRequest
				if (req && typeof req.id === "string") {
					onPermissionAsked?.(req)
				}
				return
			}

			case "todo.updated": {
				// Refresh the model's most recent `todowrite` tool part with
				// OpenCode's canonical post-execution todo state. The renderer
				// reads `metadata.todos` preferentially, so this update is what
				// drives a freshly-checked-off task to appear ticked.
				//
				// If the model hasn't called `todowrite` yet in this turn (or
				// the build doesn't surface it as a tool part), allocate a
				// fresh partId — we still want to show the todos somewhere.
				//
				// Statuses MUST be normalised to Loop's vocabulary; the
				// renderer compares strictly against `done`/`in-progress`,
				// so OpenCode's `completed`/`in_progress` would otherwise
				// render as empty checkboxes.
				const rawTodos = Array.isArray(props.todos) ? (props.todos as unknown[]) : undefined
				if (!rawTodos) return
				const todos = normalizeOpenCodeTodos(rawTodos)
				ensureStepStart()
				fireActive()
				const partId = lastTodoToolPartId ?? ulid()
				if (!lastTodoToolPartId) lastTodoToolPartId = partId
				emitter.upsertPart({
					id: partId,
					type: "tool",
					data: {
						type: "tool",
						callId: partId,
						tool: "todowrite",
						state: "completed",
						input: { todos },
						output: `Updated ${todos.length} todo${todos.length === 1 ? "" : "s"}`,
						metadata: { todos },
						time: { start: turnStartedAt, end: Date.now() },
					},
				})
				return
			}

			case "session.diff": {
				// Layer C2 — translate OpenCode's per-file unified diff into
				// Loop's `EditPart` shape so the existing edit-aggregator
				// renderer (`EditDiff`) at the message foot picks them up.
				const diffs = Array.isArray(props.diff) ? (props.diff as unknown[]) : undefined
				if (!diffs || diffs.length === 0) return
				const files: Array<{
					path: string
					additions: number
					deletions: number
					status: "added" | "deleted" | "modified"
				}> = []
				for (const entry of diffs) {
					if (!entry || typeof entry !== "object") continue
					const f = entry as {
						file?: string
						additions?: number
						deletions?: number
						status?: string
					}
					if (typeof f.file !== "string") continue
					files.push({
						path: f.file,
						additions: typeof f.additions === "number" ? f.additions : 0,
						deletions: typeof f.deletions === "number" ? f.deletions : 0,
						status: f.status === "added" || f.status === "deleted" ? f.status : "modified",
					})
				}
				if (files.length === 0) return
				const totalAdditions = files.reduce((s, f) => s + f.additions, 0)
				const totalDeletions = files.reduce((s, f) => s + f.deletions, 0)
				const editPartId = ulid()
				emittedEditFromDiff = true
				emitter.upsertPart({
					id: editPartId,
					type: "edit",
					data: {
						type: "edit",
						hash: `opencode:${editPartId}`,
						files,
						totalAdditions,
						totalDeletions,
					},
				})
				return
			}

			default:
				// Ignore the long tail of TUI / pty / lsp / file-watcher events.
				return
		}
	}

	function finalize(): OpenCodeFinalizeResult {
		// Force-final any text parts whose snapshot didn't include `time.end`
		// (e.g. the stream closed mid-update). Loop expects every part to be
		// upserted at terminal state so the `streaming` flag drops.
		for (const [partId, state] of textParts) {
			if (state.finalized) continue
			emitter.upsertPart({
				id: partId,
				type: state.partType,
				data: buildTextData(state.partType, state.emittedText, undefined),
			})
		}
		// Tools that never reached completed/error — mark as error so the UI
		// stops spinning. Mirrors stream-processor's cleanupPendingTools().
		for (const [partId, tracker] of toolParts) {
			if (tracker.finalizedStatus) continue
			emitter.upsertPart({
				id: partId,
				type: "tool",
				data: {
					type: "tool",
					callId: tracker.callId ?? partId,
					tool: tracker.tool ?? "tool",
					state: "error",
					error: "Stream interrupted before tool completed",
					time: { start: tracker.startedAt ?? turnStartedAt, end: Date.now() },
				},
			})
		}
		textParts.clear()
		toolParts.clear()
		return {
			finishReason,
			usage: { ...accumulatedUsage },
			cost: accumulatedCost,
			durationMs: Date.now() - turnStartedAt,
		}
	}

	return {
		beginTurn(snapshotHash: string | undefined): void {
			reset(snapshotHash)
		},
		handle,
		finalize,
		/** Inspection for tests / runtime debugging. */
		hasActivePart(): boolean {
			return textParts.size > 0 || toolParts.size > 0
		},
		/**
		 * True when this turn already surfaced an EditPart from OpenCode's
		 * `session.diff` event. The runtime uses this to decide whether the
		 * pre/post snapshot fallback (Layer C4) needs to fire.
		 */
		didEmitEditFromDiff(): boolean {
			return emittedEditFromDiff
		},
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────

function buildTextData(
	partType: "text" | "reasoning",
	text: string,
	time: { start?: number; end?: number } | undefined,
): Record<string, unknown> {
	if (partType === "text") {
		return { type: "text", text }
	}
	const start = time?.start ?? Date.now()
	const end = time?.end
	return {
		type: "reasoning",
		text,
		time: end !== undefined ? { start, end } : { start },
	}
}

function collectToolText(content: ReadonlyArray<{ type?: string; text?: string }>): string {
	return content
		.flatMap((entry) => {
			if (!entry || typeof entry !== "object") return []
			if (entry.type === "text" && typeof entry.text === "string") return [entry.text]
			return []
		})
		.join("")
		.trim()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}
