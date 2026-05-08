import { ulid } from "@core/id"
import { createLogger } from "../../logger"
import type {
	ContentBlock,
	PlanEntry,
	SessionNotification,
	SessionUpdateBody,
	ToolCallContent,
	ToolCallLocation,
	ToolCallStatus,
	ToolKind,
} from "./acp/types"

/**
 * Translates ACP `session/update` notifications into Loop's `Part` schema.
 *
 * Cursor's ACP only exposes a thin tool envelope — `kind` (semantic
 * category), `title` (human-readable label), `rawInput` (opaque blob),
 * `locations[]` (file paths the tool touches), and `content[]` (diff +
 * text blocks the tool produces). Loop's frontend renderers want
 * specific fields like `input.path`, `input.command`, `metadata.diff`,
 * `metadata.additions/deletions`. This adapter is the bridge.
 *
 * Each ACP tool call is normalised through `deriveLoopTool()` which:
 *   1. Picks a Loop renderer name (read / bash / edit / grep / glob / list /
 *      todowrite / plan-write / etc.) from `kind` + parsed `title`.
 *   2. Synthesises the input fields that renderer expects, falling back
 *      across `rawInput`, `locations[0]`, and parsed-from-title operands.
 *   3. Extracts diff/text content from `content[]` and rolls it into the
 *      right metadata bucket (`diff`, `additions`, `output`, `todos`,
 *      `planContent`/`planPath`, `exitCode`, etc.).
 *
 * Streaming model:
 *   - `agent_message_chunk` (text)         → text deltas + on-block-boundary upsert
 *   - `agent_thought_chunk` (text)         → reasoning deltas + upsert
 *   - `tool_call` / `tool_call_update`     → in-memory ToolState, persisted on every
 *     status transition AND when content/locations change. Cursor's pre-formatted
 *     bash stdout streams in via successive `tool_call_update` events with growing
 *     `content[]`; we recompute the `metadata.output` view each time so the UI
 *     terminal box scrolls naturally.
 *   - `plan`                               → `metadata.planEntries` on session state
 *   - `usage_update`                       → `onUsageUpdate` callback
 *   - `current_mode_update`                → `onModeChange` callback (drives Loop's
 *     plan/build agent switch)
 *
 * Block-partition trick (mirrors claude-code/adapter.ts): each contiguous
 * text run gets its own partId. When a tool/reasoning interrupts text, we
 * close the current text part so the next text resumes with a NEW partId.
 * Loop's DB ordinal is assigned at first INSERT and never updates on
 * conflict, so this is what keeps text₁ < tool < text₂ ordering in the UI.
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
	 * Loop session id. Used by the plan-write detector so we recognise edits
	 * to `.loop/plans/<sessionId>.md` as plan writes (whether they came from
	 * Cursor's CreatePlan tool, a regular Edit/Write call, or the cursor/
	 * create_plan ACP extension).
	 */
	loopSessionId?: string
	/** Fires once on first assistant activity so the runtime can re-assert busy. */
	onActive?: () => void
	/** Usage / context-window updates from `usage_update` notifications. */
	onUsageUpdate?: (usage: {
		input?: number
		output?: number
		size: number
		used: number
		cost?: number
	}) => void
	/** Mode change notifications (plan ↔ default/build). */
	onModeChange?: (modeId: string) => void
	/** Plan entries (used by Loop's plan-write rendering path). */
	onPlanUpdate?: (entries: ReadonlyArray<PlanEntry>) => void
	/**
	 * Fires when the agent writes (or completes writing) the plan file for
	 * this Loop session. The runtime uses this as the trigger to ask the
	 * user for plan approval at end-of-turn.
	 */
	onPlanWritten?: (info: { planPath: string; planContent: string }) => void
	/**
	 * Defense 4: forbidden-tool detection. When plan mode is active and
	 * cursor emits a tool_call for a mutating tool on a non-plan-file
	 * path, this fires so the runtime can cancel the turn. Catches the
	 * case where cursor performs the edit WITHOUT first sending a
	 * `session/request_permission` (so the permissions.ts hard-reject
	 * never gets a chance to fire).
	 */
	onForbiddenTool?: (info: {
		callId: string
		tool: string
		kind: ToolKind | undefined
		targetPath: string | undefined
		reason: string
	}) => void
	/**
	 * When true, the adapter treats any mutating tool_call on a
	 * non-plan-file path as forbidden and fires `onForbiddenTool`. The
	 * runtime sets this when the active agent is `plan`/`explore` OR
	 * the session permission mode is `plan`.
	 */
	planModeActive?: boolean
}

interface ToolState {
	partId: string
	callId: string
	startedAt: number
	endedAt?: number
	finalized: boolean

	// Raw ACP fields (latest values seen)
	kind: ToolKind | undefined
	title: string | undefined
	status: ToolCallStatus
	locations: ReadonlyArray<ToolCallLocation> | undefined
	rawInput: unknown
	rawOutput: unknown
	content: ReadonlyArray<ToolCallContent>

	// Derived Loop-side fields recomputed on every update
	loopTool: string
	input: Record<string, unknown>
	metadata: Record<string, unknown>
	output: string | undefined
	error: string | undefined
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
	finishReason?: string
}

export interface CursorFinalizeResult {
	finishReason: string
}

type LastBlockKind = "text" | "reasoning" | "tool" | undefined

// ─────────────────────────────────────────────────────────────────────
// Public adapter
// ─────────────────────────────────────────────────────────────────────

export function createCursorAdapter(opts: CursorAdapterOptions) {
	const {
		emitter,
		loopSessionId,
		onActive,
		onUsageUpdate,
		onModeChange,
		onPlanUpdate,
		onPlanWritten,
		onForbiddenTool,
		planModeActive = false,
	} = opts
	const forbiddenToolFired = new Set<string>()

	let textState: TextState | undefined
	let reasoningState: ReasoningState | undefined
	const toolsByCallId = new Map<string, ToolState>()
	let stepStartEmitted = false
	let activeFired = false
	let preSnapshotHash: string | undefined
	let lastBlockKind: LastBlockKind
	let lastUsage:
		| { input?: number; output?: number; size: number; used: number; cost?: number }
		| undefined
	/** Tracks the most recently observed plan write for this turn, fed to onPlanWritten on completion. */
	let pendingPlanWrite: { planPath: string; planContent: string } | undefined
	const planWriteFiredCallIds = new Set<string>()
	/**
	 * Stable partId for the synthesized todowrite tool emitted on
	 * `sessionUpdate.plan`. Cursor streams plan/todo updates as plan
	 * entries; we surface them as a single, mutable todo part so the UI
	 * shows todo progress live. Reset per turn in beginTurn().
	 */
	let planTodoPartId: string | undefined
	let planTodoStartedAt: number | undefined
	/**
	 * Cumulative todo list across the session. Cursor's UpdateTodos
	 * extension sends incremental patches when `merge: true`; we keep
	 * the merged snapshot so the next patch can pick up where the
	 * previous one left off.
	 */
	let todoListSnapshot:
		| ReadonlyArray<{
				id: string
				content: string
				status: string
				priority: string
		  }>
		| undefined

	function ensureStepStart(): void {
		if (stepStartEmitted) return
		stepStartEmitted = true
		emitter.upsertPart({
			id: ulid(),
			type: "step-start",
			data: { type: "step-start", ...(preSnapshotHash ? { snapshot: preSnapshotHash } : {}) },
		})
	}

	function fireActive(): void {
		if (activeFired) return
		activeFired = true
		onActive?.()
	}

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

	function appendText(text: string): void {
		if (!text) return
		ensureStepStart()
		fireActive()
		if (lastBlockKind && lastBlockKind !== "text") {
			flushTextFinal()
			flushReasoningFinal()
		}
		if (!textState) textState = { partId: ulid(), buffer: "" }
		textState.buffer += text
		emitter.emitDelta({ partId: textState.partId, delta: text, partType: "text" })
		lastBlockKind = "text"
	}

	function appendReasoning(text: string): void {
		if (!text) return
		ensureStepStart()
		fireActive()
		if (lastBlockKind && lastBlockKind !== "reasoning") {
			flushTextFinal()
			flushReasoningFinal()
		}
		if (!reasoningState) reasoningState = { partId: ulid(), buffer: "", startedAt: Date.now() }
		reasoningState.buffer += text
		emitter.emitDelta({ partId: reasoningState.partId, delta: text, partType: "reasoning" })
		lastBlockKind = "reasoning"
	}

	function persistTool(state: ToolState): void {
		const data: Record<string, unknown> = {
			type: "tool",
			callId: state.callId,
			tool: state.loopTool,
			state: mapAcpStatusToLoopState(state.status),
			time: {
				start: state.startedAt,
				...(state.endedAt !== undefined ? { end: state.endedAt } : {}),
			},
		}
		if (Object.keys(state.input).length > 0) data.input = state.input
		if (state.output !== undefined && state.output.length > 0) data.output = state.output
		if (state.error !== undefined && state.error.length > 0) data.error = state.error
		if (Object.keys(state.metadata).length > 0) data.metadata = state.metadata
		emitter.upsertPart({ id: state.partId, type: "tool", data })
	}

	function applyToolCall(
		snapshot: {
			toolCallId: string
			title?: string | null
			kind?: ToolKind | null
			status?: ToolCallStatus | null
			content?: ReadonlyArray<ToolCallContent> | null
			locations?: ReadonlyArray<ToolCallLocation> | null
			rawInput?: unknown
			rawOutput?: unknown
		},
		isUpdate: boolean,
	): void {
		ensureStepStart()
		fireActive()
		flushTextFinal()
		flushReasoningFinal()

		let tool = toolsByCallId.get(snapshot.toolCallId)
		if (!tool) {
			tool = {
				partId: ulid(),
				callId: snapshot.toolCallId,
				startedAt: Date.now(),
				endedAt: undefined,
				finalized: false,
				kind: undefined,
				title: undefined,
				status: "pending",
				locations: undefined,
				rawInput: undefined,
				rawOutput: undefined,
				content: [],
				loopTool: "tool",
				input: {},
				metadata: {},
				output: undefined,
				error: undefined,
			}
			toolsByCallId.set(snapshot.toolCallId, tool)
		}

		// Merge incoming snapshot fields. Update events use null=leave-existing
		// semantics; missing keys also leave existing.
		if (snapshot.kind !== undefined && snapshot.kind !== null) tool.kind = snapshot.kind
		if (snapshot.title !== undefined && snapshot.title !== null) tool.title = snapshot.title
		if (snapshot.status !== undefined && snapshot.status !== null) tool.status = snapshot.status
		if (snapshot.locations !== undefined && snapshot.locations !== null)
			tool.locations = snapshot.locations
		if (snapshot.rawInput !== undefined) tool.rawInput = snapshot.rawInput
		if (snapshot.rawOutput !== undefined) tool.rawOutput = snapshot.rawOutput
		if (snapshot.content !== undefined && snapshot.content !== null) {
			// On the initial tool_call event, content[] is authoritative; on
			// updates it's the FULL replacement set Cursor wants us to display
			// (per ACP schema). Always replace so we get the latest text/diff.
			tool.content = snapshot.content
		}

		// Once we've recorded a terminal state, ignore subsequent reverts. ACP
		// agents occasionally re-emit pending/in_progress events after a brief
		// completed flash (e.g. when a follow-up content block lands).
		if (tool.finalized && (tool.status === "pending" || tool.status === "in_progress")) {
			tool.status = "completed"
		}

		// Recompute Loop-side derived fields from the latest snapshot.
		const derived = deriveLoopTool({
			kind: tool.kind,
			title: tool.title,
			rawInput: tool.rawInput,
			rawOutput: tool.rawOutput,
			locations: tool.locations,
			content: tool.content,
			status: tool.status,
			loopSessionId,
		})
		tool.loopTool = derived.tool
		tool.input = derived.input
		tool.metadata = derived.metadata
		tool.output = derived.output
		tool.error = derived.error

		// Defense 4: forbidden-tool detection for plan mode.
		// If plan mode is active and the resolved tool is a mutating tool
		// targeting a non-plan-file path, fire the callback so the runtime
		// can cancel the turn. We also locally mark the tool as "failed"
		// so the UI shows the rejection rather than a successful edit.
		// This catches cursors that perform edits WITHOUT first sending
		// a `session/request_permission` (so the permissions.ts hard-
		// reject never gets a chance to block).
		if (planModeActive && !forbiddenToolFired.has(tool.callId)) {
			const violation = isForbiddenPlanModeTool(tool, derived, loopSessionId)
			if (violation) {
				forbiddenToolFired.add(tool.callId)
				tool.status = "failed"
				tool.endedAt = Date.now()
				tool.finalized = true
				tool.error = `Plan mode forbids ${violation.reason}`
				if (!tool.metadata.error) {
					tool.metadata = { ...tool.metadata, error: tool.error, planModeBlock: true }
				}
				log.warn("Plan-mode forbidden tool detected (Defense 4)", {
					callId: tool.callId,
					tool: tool.loopTool,
					kind: tool.kind,
					targetPath: violation.targetPath,
					reason: violation.reason,
				})
				onForbiddenTool?.({
					callId: tool.callId,
					tool: tool.loopTool,
					kind: tool.kind,
					targetPath: violation.targetPath,
					reason: violation.reason,
				})
			}
		}

		// Plan-write detection: on completion of a plan-write tool (whether
		// from Cursor's CreatePlan, an Edit/Write to .loop/plans/<id>.md, or
		// any other path the title/kind heuristic catches), capture the
		// content for the runtime to ask the user for approval at end-of-turn.
		if (
			tool.loopTool === "plan-write" &&
			tool.status === "completed" &&
			!planWriteFiredCallIds.has(tool.callId)
		) {
			const planPath =
				typeof tool.metadata.planPath === "string" ? tool.metadata.planPath : undefined
			const planContent =
				typeof tool.metadata.planContent === "string" ? tool.metadata.planContent : undefined
			if (planPath && planContent) {
				planWriteFiredCallIds.add(tool.callId)
				// Eager callback for runtimes that need it now; pendingPlanWrite
				// stays cleared so notifyPlanIfWritten() doesn't double-deliver.
				pendingPlanWrite = undefined
				onPlanWritten?.({ planPath, planContent })
			}
		}

		if (tool.status === "completed" || tool.status === "failed") {
			if (!tool.finalized) tool.endedAt = Date.now()
			tool.finalized = true
		}

		// Skip stub `todowrite` tool_call events. Cursor sends UpdateTodos
		// data via the `cursor/update_todos` extension request (handled
		// in runtime.ts → adapter.injectExternalTodoWrite, which uses a
		// stable `planTodoPartId` and renders the actual items).
		// The mirror tool_call event has empty rawInput on most cursor
		// versions and would otherwise produce a separate "Todo: 0 tasks"
		// row in the work-log alongside the populated extension row.
		// Suppress it once we have a populated todo row.
		const isEmptyTodoStub =
			tool.loopTool === "todowrite" &&
			!hasPopulatedTodos(tool) &&
			(planTodoPartId !== undefined || todoListSnapshot !== undefined)
		if (isEmptyTodoStub) {
			log.debug("Skipping empty todowrite tool_call (extension owns the row)", {
				callId: snapshot.toolCallId,
				status: tool.status,
			})
			return
		}

		persistTool(tool)
		lastBlockKind = "tool"

		// NOTE: We deliberately do NOT emit a per-tool `edit` Part here.
		// The end-of-turn snapshot diff (computed by finalizeTurn from
		// the workspace snapshot) is the canonical source for the
		// bottom-of-message EditDiff aggregator. Cursor's tool-call diff
		// paths (often raw / inconsistent — `App.tsx` vs `src/App.tsx`)
		// don't dedupe cleanly against git's workspace-relative paths,
		// so emitting both led to duplicate file rows in the aggregator
		// (one path per source). The per-tool inline diff display still
		// works because FileMutationToolCall reads `metadata.diff`
		// directly off the tool Part — no edit Part needed for that.

		log.debug("tool_call applied", {
			callId: snapshot.toolCallId,
			kind: tool.kind,
			status: tool.status,
			loopTool: tool.loopTool,
			isUpdate,
		})
	}

	function handle(notification: SessionNotification): void {
		try {
			const update = notification.update as SessionUpdateBody
			switch (update.sessionUpdate) {
				case "agent_message_chunk":
					appendText(contentBlockText(update.content))
					return
				case "agent_thought_chunk":
					appendReasoning(contentBlockText(update.content))
					return
				case "user_message_chunk":
					return
				case "tool_call":
					applyToolCall(update, false)
					return
				case "tool_call_update":
					applyToolCall(update, true)
					return
				case "plan":
					onPlanUpdate?.(update.entries)
					emitPlanAsTodos(update.entries)
					return
				case "current_mode_update":
					onModeChange?.(update.currentModeId)
					return
				case "usage_update":
					lastUsage = {
						size: update.size,
						used: update.used,
						...(update.cost ? { cost: update.cost.amount } : {}),
					}
					onUsageUpdate?.(lastUsage)
					return
				case "config_option_update":
				case "available_commands_update":
				case "session_info_update":
					return
				default: {
					const tag = (update as { sessionUpdate?: string }).sessionUpdate
					log.debug("Unhandled session/update variant", { tag })
				}
			}
		} catch (err) {
			log.warn("Adapter handler threw", {
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	/**
	 * Surface Cursor's `sessionUpdate: "plan"` notifications as a stable
	 * `todowrite` tool part so the existing TodoWriteToolCall renderer
	 * picks them up. Cursor uses the plan stream for live to-do progress
	 * (separate from the final plan written to .loop/plans/<id>.md).
	 *
	 * We synthesize ONE part per turn keyed by `planTodoPartId` and
	 * upsert it on each plan update — the renderer reads
	 * `metadata.todos` and re-renders with the latest status.
	 */
	function emitPlanAsTodos(entries: ReadonlyArray<PlanEntry>): void {
		if (entries.length === 0) return
		ensureStepStart()
		fireActive()
		// Flush any open text/reasoning so the todo block doesn't merge
		// with surrounding agent output in the timeline.
		if (lastBlockKind && lastBlockKind !== "tool") {
			flushTextFinal()
			flushReasoningFinal()
		}
		if (!planTodoPartId) {
			planTodoPartId = ulid()
			planTodoStartedAt = Date.now()
		}
		const todos = entries.map((entry, i) => ({
			id: `todo-${i}`,
			content: entry.content && entry.content.trim().length > 0 ? entry.content : `Step ${i + 1}`,
			status: mapPlanStatusToTodoStatus(entry.status),
			priority: entry.priority ?? "medium",
		}))
		const allDone = todos.every((t) => t.status === "done")
		emitter.upsertPart({
			id: planTodoPartId,
			type: "tool",
			data: {
				type: "tool",
				callId: planTodoPartId,
				tool: "todowrite",
				state: allDone ? "completed" : "running",
				time: { start: planTodoStartedAt ?? Date.now() },
				metadata: { todos, source: "cursor-plan-stream" },
			},
		})
		lastBlockKind = "tool"
	}

	function beginTurn(snapshotHash: string | undefined): void {
		preSnapshotHash = snapshotHash
		stepStartEmitted = false
		activeFired = false
		textState = undefined
		reasoningState = undefined
		lastBlockKind = undefined
		lastUsage = undefined
		toolsByCallId.clear()
		pendingPlanWrite = undefined
		planTodoPartId = undefined
		planTodoStartedAt = undefined
		planWriteFiredCallIds.clear()
	}

	function finalize(opts: CursorFinalizeOptions = {}): CursorFinalizeResult {
		flushTextFinal()
		flushReasoningFinal()

		// Tools that never reached a terminal state (transport drop, abort) get
		// flipped to error so the UI exits the running shimmer state.
		for (const tool of toolsByCallId.values()) {
			if (!tool.finalized) {
				tool.status = "failed"
				tool.endedAt = Date.now()
				tool.finalized = true
				if (!tool.error) tool.error = opts.finishReason ?? "Tool did not complete"
				persistTool(tool)
			}
		}

		const finishReason = opts.finishReason ?? "stop"

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

	function notifyPlanIfWritten(): { planPath: string; planContent: string } | undefined {
		if (pendingPlanWrite) {
			const info = pendingPlanWrite
			pendingPlanWrite = undefined
			return info
		}
		return undefined
	}

	/**
	 * Used by the runtime when cursor's `cursor/update_todos` extension
	 * request fires. Cursor sends the todos data through this dedicated
	 * RPC channel — NOT via a regular `tool_call` (or it sends a
	 * tool_call but with empty `rawInput.todos`). Without injecting,
	 * the work-log shows `Todo: 0 tasks` for every UpdateTodos call.
	 *
	 * `merge` mirrors cursor's wire flag: false replaces the list,
	 * true patches existing items by id (cursor's incremental update
	 * path). We dedupe by stable `planTodoPartId` so successive calls
	 * mutate the same UI row instead of stacking.
	 */
	function injectExternalTodoWrite(args: {
		todos: ReadonlyArray<{
			id?: string
			content?: string
			title?: string
			status?: string
			priority?: string
			activeForm?: string
		}>
		merge?: boolean
	}): void {
		ensureStepStart()
		fireActive()
		if (lastBlockKind && lastBlockKind !== "tool") {
			flushTextFinal()
			flushReasoningFinal()
		}
		if (!planTodoPartId) {
			planTodoPartId = ulid()
			planTodoStartedAt = Date.now()
		}
		// Normalize: cursor's status set is { pending, in_progress,
		// completed, cancelled }. Loop's TodoWriteToolCall expects
		// { pending, in-progress, done }. Map accordingly.
		const incoming = args.todos.map((t, i) => {
			const id = typeof t.id === "string" && t.id.length > 0 ? t.id : `todo-${i}`
			const content =
				typeof t.content === "string" && t.content.length > 0
					? t.content
					: typeof t.title === "string" && t.title.length > 0
						? t.title
						: `Step ${i + 1}`
			const status = mapCursorTodoStatusToLoop(t.status)
			const priority =
				typeof t.priority === "string" && t.priority.length > 0 ? t.priority : "medium"
			return { id, content, status, priority }
		})
		// Merge semantics: when cursor sends `merge: true`, patch by id;
		// otherwise replace the list.
		let combined: typeof incoming
		if (args.merge) {
			const existing = (todoListSnapshot ?? []) as typeof incoming
			const byId = new Map(existing.map((t) => [t.id, t]))
			for (const t of incoming) byId.set(t.id, t)
			combined = Array.from(byId.values())
		} else {
			combined = incoming
		}
		todoListSnapshot = combined
		const allDone = combined.length > 0 && combined.every((t) => t.status === "done")
		emitter.upsertPart({
			id: planTodoPartId,
			type: "tool",
			data: {
				type: "tool",
				callId: planTodoPartId,
				tool: "todowrite",
				state: allDone ? "completed" : "running",
				time: { start: planTodoStartedAt ?? Date.now() },
				metadata: { todos: combined, source: "cursor-update-todos-ext" },
			},
		})
		lastBlockKind = "tool"
	}

	function injectExternalPlanWrite(info: { planPath: string; planContent: string }): void {
		// Used by the runtime when a plan arrives via a non-tool path (e.g.
		// Cursor's `cursor/create_plan` ACP extension request). Persists a
		// synthetic plan-write tool part so the timeline shows the plan, and
		// queues the onPlanWritten callback for end-of-turn approval.
		ensureStepStart()
		fireActive()
		flushTextFinal()
		flushReasoningFinal()
		const partId = ulid()
		const callId = `plan-ext-${partId}`
		emitter.upsertPart({
			id: partId,
			type: "tool",
			data: {
				type: "tool",
				callId,
				tool: "plan-write",
				state: "completed",
				time: { start: Date.now(), end: Date.now() },
				metadata: {
					planPath: info.planPath,
					planContent: info.planContent,
					title: "Plan written",
					kind: "edit",
				},
			},
		})
		lastBlockKind = "tool"
		// onPlanWritten fires eagerly — keep pendingPlanWrite empty so a
		// later notifyPlanIfWritten() call doesn't deliver the same payload twice.
		pendingPlanWrite = undefined
		planWriteFiredCallIds.add(callId)
		onPlanWritten?.(info)
	}

	return {
		handle,
		beginTurn,
		finalize,
		notifyPlanIfWritten,
		injectExternalPlanWrite,
		injectExternalTodoWrite,
		get currentUsage() {
			return lastUsage
		},
	}
}

// ─────────────────────────────────────────────────────────────────────
// Per-tool synthesis: ACP snapshot → Loop renderer-shaped fields
// ─────────────────────────────────────────────────────────────────────

interface DerivedLoopTool {
	tool: string
	input: Record<string, unknown>
	metadata: Record<string, unknown>
	output: string | undefined
	error: string | undefined
	editFiles?: Array<{
		path: string
		additions: number
		deletions: number
		status: "added" | "deleted" | "modified"
	}>
}

function deriveLoopTool(args: {
	kind: ToolKind | undefined
	title: string | undefined
	rawInput: unknown
	rawOutput: unknown
	locations: ReadonlyArray<ToolCallLocation> | undefined
	content: ReadonlyArray<ToolCallContent>
	status: ToolCallStatus
	loopSessionId?: string
}): DerivedLoopTool {
	const rawInputObj = isRecord(args.rawInput) ? args.rawInput : undefined
	const rawOutputObj = isRecord(args.rawOutput) ? args.rawOutput : undefined
	const firstLocation = args.locations?.[0]
	const titleStr = args.title?.trim() || ""
	const titleLower = titleStr.toLowerCase()
	const isFinal = args.status === "completed" || args.status === "failed"
	const isError = args.status === "failed"

	// First pass: identify the Loop tool name. We start from `kind` and
	// refine using `title` (which often contains the actual operation, e.g.
	// "Bash: git status" → bash, "Read foo.ts" → read, "Glob *.ts" → glob).
	let tool = pickLoopTool(args.kind, titleLower, rawInputObj)

	// Path-based plan-write override: if Cursor's Edit/Write tool is
	// targeting `.loop/plans/<sessionId>.md` we treat it as a plan write so
	// the renderer shows the PlanCard and the runtime knows to ask for
	// approval at end-of-turn. Works regardless of whether Cursor used its
	// Edit, Write, or CreatePlan tool — they all funnel through the same
	// path detector.
	//
	// Cursor often emits Edit tool calls with empty `rawInput` and a
	// generic title like "Edited File"; the real path arrives in the
	// `diff` content blocks (`tool.content[].path` for type === "diff"
	// blocks). Probe ALL three sources so plan-writes are recognised
	// even when only the diff blocks carry the path.
	if (tool === "edit" || tool === "write" || tool === "multiedit") {
		const candidatePaths: string[] = []
		const fromInput = pickString(rawInputObj, [
			"path",
			"file_path",
			"filePath",
			"target",
			"absolute_path",
			"absolutePath",
		])
		if (fromInput) candidatePaths.push(fromInput)
		if (args.locations) {
			for (const loc of args.locations) {
				if (typeof loc.path === "string" && loc.path.length > 0) candidatePaths.push(loc.path)
			}
		}
		if (args.content) {
			for (const c of args.content) {
				if (c.type === "diff" && typeof c.path === "string" && c.path.length > 0) {
					candidatePaths.push(c.path)
				}
			}
		}
		// Also probe rawOutput for cursor versions that report the
		// written path in the result (`{ path: ..., bytesWritten: ... }`).
		const fromOutput = pickPathFromRaw(args.rawOutput)
		if (fromOutput) candidatePaths.push(fromOutput)
		if (candidatePaths.some((p) => isPlanFilePath(p, args.loopSessionId))) {
			tool = "plan-write"
		}
	}

	const metadata: Record<string, unknown> = {}
	if (titleStr) metadata.title = titleStr
	if (args.kind) metadata.kind = args.kind
	if (args.locations && args.locations.length > 0) {
		metadata.locations = args.locations.map((l) => ({
			path: l.path,
			...(typeof l.line === "number" ? { line: l.line } : {}),
		}))
	}

	switch (tool) {
		case "read": {
			const path = pickPath(rawInputObj, firstLocation, titleStr, ["Read", "Reading"])
			const offset = pickNumber(rawInputObj, ["offset", "startLine", "start_line"])
			const limit = pickNumber(rawInputObj, ["limit", "lineCount", "line_count"])
			const totalLines = pickNumberFromRaw(args.rawOutput, [
				"totalLines",
				"total_lines",
				"lineCount",
				"line_count",
			])
			const hasMore = pickBoolFromRaw(args.rawOutput, ["truncated", "hasMore", "more"])
			const input: Record<string, unknown> = {}
			if (path) input.path = path
			if (typeof offset === "number") input.offset = offset
			if (typeof limit === "number") input.limit = limit
			if (typeof totalLines === "number") metadata.totalLines = totalLines
			if (hasMore) metadata.hasMore = true
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "write":
		case "edit":
		case "multiedit": {
			// Cursor often emits Edit tool calls with empty rawInput and a
			// generic title like "Edited File" — the real path lives in
			// the `diff` content blocks. Probe diff blocks BEFORE falling
			// through to the title-parser, otherwise the per-tool UI
			// display shows "File" instead of the actual filename.
			const diffBlockPath = (() => {
				if (!args.content) return undefined
				for (const c of args.content) {
					if (c.type === "diff" && typeof c.path === "string" && c.path.length > 0) {
						return c.path
					}
				}
				return undefined
			})()
			const path =
				pickPath(rawInputObj, firstLocation, "", [
					"Write",
					"Edit",
					"Editing",
					"Edited",
					"Created",
					"Updated",
					"Modified",
					"MultiEdit",
				]) ??
				diffBlockPath ??
				extractPathFromTitle(titleStr, [
					"Write",
					"Edit",
					"Editing",
					"Edited",
					"Created",
					"Updated",
					"Modified",
					"MultiEdit",
				])
			const input: Record<string, unknown> = {}
			if (path) {
				input.path = path
				input.file_path = path
			}
			const fileContent = pickString(rawInputObj, [
				"content",
				"fileText",
				"file_text",
				"newText",
				"new_text",
			])
			if (fileContent !== undefined) input.content = fileContent
			const oldString = pickString(rawInputObj, ["oldString", "old_string", "oldText"])
			if (oldString !== undefined) input.old_string = oldString
			const newString = pickString(rawInputObj, ["newString", "new_string", "newText"])
			if (newString !== undefined) input.new_string = newString

			// Pull diff blocks out of content[]. ACP `{type: "diff", path, oldText, newText}`
			// → unified diff string.
			const diffBlocks = collectDiffBlocks(args.content)
			if (diffBlocks.length > 0) {
				const unified = diffBlocks
					.map((d) => unifiedDiffFor(d.path, d.oldText, d.newText))
					.join("\n")
				metadata.diff = unified
				let totalAdds = 0
				let totalDels = 0
				const editFiles: Array<{
					path: string
					additions: number
					deletions: number
					status: "added" | "deleted" | "modified"
				}> = []
				for (const d of diffBlocks) {
					const stats = countDiffStats(d.oldText, d.newText)
					totalAdds += stats.additions
					totalDels += stats.deletions
					editFiles.push({
						path: d.path,
						additions: stats.additions,
						deletions: stats.deletions,
						status:
							d.oldText == null
								? "added"
								: stats.deletions === 0 && stats.additions === 0
									? "modified"
									: "modified",
					})
				}
				if (totalAdds > 0) metadata.additions = totalAdds
				if (totalDels > 0) metadata.deletions = totalDels
				metadata.editCount = diffBlocks.length

				const out = extractTextOnly(args.content)
				return {
					tool,
					input,
					metadata,
					output: isFinal && !isError ? out : extractTextOnly(args.content),
					error: isError ? extractContentText(args.content, args.rawOutput) : undefined,
					editFiles,
				}
			}

			// No diff blocks: fall through to text content for output / streaming preview.
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "bash": {
			const command =
				pickString(rawInputObj, ["command", "cmd"]) ??
				extractCommandFromTitle(titleStr) ??
				composeFromExecutable(rawInputObj)
			const cwd = pickString(rawInputObj, ["cwd", "workingDirectory", "working_directory"])
			const timeout = pickNumber(rawInputObj, ["timeout", "timeoutMs", "timeout_ms"])
			const input: Record<string, unknown> = {}
			if (command) input.command = command
			if (cwd) input.cwd = cwd
			if (typeof timeout === "number") input.timeout = timeout

			const exitCode = pickNumberFromRaw(args.rawOutput, ["exitCode", "exit_code", "exit"])
			if (typeof exitCode === "number") metadata.exitCode = exitCode
			const status = pickStringFromRaw(args.rawOutput, ["status"])
			if (status) metadata.status = status

			// Bash streams output via successive content[] additions. While the
			// tool is running, expose accumulated text via metadata.output so
			// the UI's TerminalCardShell auto-scrolls. On completion we move
			// the same text into `output` so the collapsed card shows it.
			const text = extractContentText(args.content, args.rawOutput)
			if (!isFinal && text) {
				metadata.output = text
				return { tool, input, metadata, output: undefined, error: undefined }
			}
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? text : undefined,
				error: isError ? text : undefined,
			}
		}

		case "grep": {
			const pattern =
				pickString(rawInputObj, ["pattern", "query", "regex", "search"]) ??
				extractGrepPatternFromTitle(titleStr)
			const path =
				pickPath(rawInputObj, firstLocation, "", []) ??
				pickString(rawInputObj, ["path", "directory", "targetDirectory", "target_directory"]) ??
				pickFirst(rawInputObj, ["targetDirectories", "paths"])
			const input: Record<string, unknown> = {}
			if (pattern) input.pattern = pattern
			if (path) input.path = path
			const matchCount = pickNumberFromRaw(args.rawOutput, ["matchCount", "matches", "count"])
			const fileCount = pickNumberFromRaw(args.rawOutput, ["fileCount", "files"])
			if (typeof matchCount === "number") metadata.matchCount = matchCount
			if (typeof fileCount === "number") metadata.fileCount = fileCount
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "glob": {
			const pattern =
				pickString(rawInputObj, ["pattern", "globPattern", "glob"]) ??
				extractGrepPatternFromTitle(titleStr)
			const path = pickString(rawInputObj, ["path", "targetDirectory", "target_directory"])
			const input: Record<string, unknown> = {}
			if (pattern) input.pattern = pattern
			if (path) input.path = path
			const count = pickNumberFromRaw(args.rawOutput, ["count", "matches"])
			const totalCount = pickNumberFromRaw(args.rawOutput, ["totalCount", "total"])
			if (typeof count === "number") metadata.count = count
			if (typeof totalCount === "number") metadata.totalCount = totalCount
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "list": {
			const path =
				pickString(rawInputObj, ["path", "directory", "dir"]) ??
				firstLocation?.path ??
				extractPathFromTitle(titleStr, ["List", "Listed", "Listing", "Ls"])
			const input: Record<string, unknown> = {}
			if (path) input.path = path
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "todowrite": {
			const todosRaw = rawInputObj?.todos
			const todos =
				Array.isArray(todosRaw) && todosRaw.length > 0
					? todosRaw
					: extractTodosFromOutput(args.rawOutput)
			const input: Record<string, unknown> = {}
			if (todos) input.todos = todos
			if (todos) metadata.todos = todos
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "plan-write": {
			// planPath fallback chain. Cursor often emits Edit/Write with
			// empty rawInput — the real path lives in `diff` content blocks
			// (or rawOutput on some versions). Probe all four sources so
			// the plan-write detection here matches what the Edit→plan-
			// write reclassifier already accepted.
			const diffBlockPath = (() => {
				if (!args.content) return undefined
				for (const c of args.content) {
					if (c.type === "diff" && typeof c.path === "string" && c.path.length > 0) {
						return c.path
					}
				}
				return undefined
			})()
			const planPath =
				pickString(rawOutputObj, ["filePath", "file_path", "path", "planPath"]) ??
				pickString(rawInputObj, [
					"filePath",
					"file_path",
					"path",
					"planPath",
					"target",
					"absolute_path",
					"absolutePath",
				]) ??
				firstLocation?.path ??
				diffBlockPath
			// planContent fallback chain: rawInput.content/plan/newText → diff
			// blocks → text content blocks → rawOutput → file on disk.
			let planContent = pickString(rawInputObj, [
				"content",
				"plan",
				"fileText",
				"file_text",
				"newText",
				"new_text",
			])
			if (planContent === undefined) {
				const diffBlocks = collectDiffBlocks(args.content)
				if (diffBlocks.length > 0) planContent = diffBlocks[0].newText
			}
			if (planContent === undefined) {
				planContent = extractTextOnly(args.content)
			}
			if (planContent === undefined && planPath && isFinal && !isError) {
				// Last resort: read the file from disk. Cursor's Edit/Write
				// tools may not echo the full content in rawInput when the
				// patch was applied incrementally.
				try {
					// Lazy require to avoid pulling node:fs into bundlers that
					// expect this file to be tree-shaken.
					// eslint-disable-next-line @typescript-eslint/no-require-imports
					const fs = require("node:fs") as typeof import("node:fs")
					if (fs.existsSync(planPath)) planContent = fs.readFileSync(planPath, "utf-8")
				} catch {
					// best-effort
				}
			}
			if (planPath) metadata.planPath = planPath
			if (planContent) metadata.planContent = planContent
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input: {},
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "plan-exit": {
			const planPath =
				pickString(rawOutputObj, ["filePath", "file_path", "path", "planPath"]) ??
				pickString(rawInputObj, ["filePath", "file_path", "path", "planPath"])
			const planContent =
				pickString(rawInputObj, ["plan", "content", "planContent"]) ??
				pickString(rawOutputObj, ["plan", "planContent"])
			if (planPath) metadata.planPath = planPath
			if (planContent) metadata.planContent = planContent
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input: {},
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "fetch":
		case "web-fetch": {
			const url = pickString(rawInputObj, ["url"]) ?? extractUrlFromTitle(titleStr)
			const input: Record<string, unknown> = {}
			if (url) input.url = url
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool: "web-fetch",
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		case "task": {
			const description = pickString(rawInputObj, ["description", "task", "name"])
			const prompt = pickString(rawInputObj, ["prompt", "instructions"])
			const subagentType = pickString(rawInputObj, ["subagent_type", "subagentType", "type"])
			const input: Record<string, unknown> = {}
			if (description) input.description = description
			if (prompt) input.prompt = prompt
			if (subagentType) input.subagent_type = subagentType
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}

		default: {
			// Generic fallback — surface whatever rawInput has plus any title.
			const input: Record<string, unknown> = {}
			if (rawInputObj) {
				for (const [k, v] of Object.entries(rawInputObj)) {
					if (v === undefined) continue
					input[k] = v
				}
			}
			const out = extractContentText(args.content, args.rawOutput)
			return {
				tool,
				input,
				metadata,
				output: isFinal && !isError ? out : undefined,
				error: isError ? out : undefined,
			}
		}
	}
}

// ─────────────────────────────────────────────────────────────────────
// Tool name resolution
// ─────────────────────────────────────────────────────────────────────

function pickLoopTool(
	kind: ToolKind | undefined,
	titleLower: string,
	rawInput: Record<string, unknown> | undefined,
): string {
	// Title-based fast paths cover Cursor's common pre-rendered titles
	// ("Read foo.ts", "Bash: …", "Search …").
	if (
		titleLower.startsWith("bash") ||
		titleLower.startsWith("shell") ||
		titleLower.startsWith("$ ")
	)
		return "bash"
	if (titleLower.startsWith("read")) return "read"
	if (titleLower.startsWith("write")) return "write"
	if (
		titleLower.startsWith("edit") ||
		titleLower.startsWith("multiedit") ||
		titleLower.startsWith("modified")
	)
		return "edit"
	if (titleLower.startsWith("created ")) return "write"
	if (
		titleLower.startsWith("grep") ||
		titleLower.startsWith("search") ||
		titleLower.startsWith("semsearch")
	)
		return "grep"
	if (titleLower.startsWith("glob")) return "glob"
	if (titleLower.startsWith("list ") || titleLower === "list" || titleLower.startsWith("ls "))
		return "list"
	if (titleLower.startsWith("delete") || titleLower.startsWith("removed")) return "list"
	if (titleLower.startsWith("readlints") || titleLower.startsWith("read lints")) return "list"
	if (
		titleLower.startsWith("updatetodos") ||
		titleLower.startsWith("update todos") ||
		titleLower.startsWith("updated todos") ||
		titleLower.startsWith("todowrite") ||
		titleLower.startsWith("todo write")
	)
		return "todowrite"
	if (
		titleLower.startsWith("createplan") ||
		titleLower.startsWith("create plan") ||
		titleLower.startsWith("plan write")
	)
		return "plan-write"
	if (
		titleLower.includes("plan_exit") ||
		titleLower.includes("plan exit") ||
		titleLower.includes("exit plan mode")
	)
		return "plan-exit"
	if (titleLower.startsWith("fetch") || titleLower.startsWith("get ")) return "web-fetch"
	if (titleLower.startsWith("task") || titleLower.startsWith("subagent")) return "task"

	// Fallback: ACP semantic kind.
	switch (kind) {
		case "read":
			return "read"
		case "edit":
			return "edit"
		case "delete":
			return "list"
		case "move":
			return "list"
		case "search":
			return "grep"
		case "execute":
			return "bash"
		case "fetch":
			return "web-fetch"
		case "switch_mode":
			return "switch-mode"
		case "think":
			return "think"
		default:
			break
	}

	// Last-resort: rawInput hints
	if (rawInput) {
		if (typeof rawInput.command === "string") return "bash"
		if (typeof rawInput.pattern === "string" || typeof rawInput.query === "string") return "grep"
		if (typeof rawInput.path === "string" || typeof rawInput.file_path === "string") return "read"
	}
	return "tool"
}

function mapAcpStatusToLoopState(
	status: ToolCallStatus,
): "pending" | "running" | "completed" | "error" {
	switch (status) {
		case "pending":
			return "pending"
		case "in_progress":
			return "running"
		case "completed":
			return "completed"
		case "failed":
			return "error"
	}
}

/**
 * Map ACP plan-entry status to Loop's todo status convention.
 * TodoWriteToolCall renders "done" / "in-progress" / "pending".
 */
function mapPlanStatusToTodoStatus(
	status: "pending" | "in_progress" | "completed" | undefined,
): "done" | "in-progress" | "pending" {
	switch (status) {
		case "completed":
			return "done"
		case "in_progress":
			return "in-progress"
		default:
			return "pending"
	}
}

/**
 * True iff a tool's input or metadata carries a non-empty todos array.
 * Used to detect stub `todowrite` tool_call events from cursor (the
 * `cursor/update_todos` extension carries the real data; the tool_call
 * is sometimes emitted with empty rawInput as a stub).
 */
function hasPopulatedTodos(tool: {
	input: Record<string, unknown>
	metadata: Record<string, unknown>
}): boolean {
	const fromInput = tool.input?.todos
	if (Array.isArray(fromInput) && fromInput.length > 0) return true
	const fromMeta = tool.metadata?.todos
	if (Array.isArray(fromMeta) && fromMeta.length > 0) return true
	return false
}

/**
 * Map cursor's UpdateTodos status set to Loop's TodoWriteToolCall renderer
 * shape. Cursor uses `pending | in_progress | inProgress | completed |
 * cancelled`; the renderer expects `pending | in-progress | done`.
 * Cancelled rows render as plain pending — same visual as not-yet-done.
 */
function mapCursorTodoStatusToLoop(status: string | undefined): "done" | "in-progress" | "pending" {
	if (typeof status !== "string") return "pending"
	const normalised = status.toLowerCase().replace(/[_\s]+/g, "-")
	if (normalised === "completed" || normalised === "done") return "done"
	if (normalised === "in-progress" || normalised === "inprogress") return "in-progress"
	return "pending"
}

// ─────────────────────────────────────────────────────────────────────
// Content / input extraction helpers
// ─────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v)
}

function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
	if (!obj) return undefined
	for (const k of keys) {
		const v = obj[k]
		if (typeof v === "string" && v.length > 0) return v
	}
	return undefined
}

function pickNumber(obj: Record<string, unknown> | undefined, keys: string[]): number | undefined {
	if (!obj) return undefined
	for (const k of keys) {
		const v = obj[k]
		if (typeof v === "number" && Number.isFinite(v)) return v
	}
	return undefined
}

function pickStringFromRaw(raw: unknown, keys: string[]): string | undefined {
	if (!isRecord(raw)) return undefined
	return pickString(raw, keys)
}
function pickNumberFromRaw(raw: unknown, keys: string[]): number | undefined {
	if (!isRecord(raw)) return undefined
	return pickNumber(raw, keys)
}
function pickBoolFromRaw(raw: unknown, keys: string[]): boolean | undefined {
	if (!isRecord(raw)) return undefined
	for (const k of keys) {
		const v = raw[k]
		if (typeof v === "boolean") return v
	}
	return undefined
}

/**
 * Pull a target file path out of a tool's `rawOutput`. Cursor reports
 * the written path in several shapes across versions
 * (`{ path }`, `{ filePath }`, `{ file: { path } }`, etc.) so probe a
 * conservative set of common keys.
 */
function pickPathFromRaw(raw: unknown): string | undefined {
	if (!isRecord(raw)) return undefined
	const direct = pickString(raw, [
		"path",
		"file_path",
		"filePath",
		"target",
		"absolute_path",
		"absolutePath",
		"uri",
	])
	if (direct) return direct
	const nestedFile = raw.file
	if (isRecord(nestedFile)) {
		const nested = pickString(nestedFile, ["path", "filePath", "absolute_path"])
		if (nested) return nested
	}
	return undefined
}

function pickFirst(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
	if (!obj) return undefined
	for (const k of keys) {
		const v = obj[k]
		if (Array.isArray(v) && v.length > 0 && typeof v[0] === "string") return v[0]
	}
	return undefined
}

function pickPath(
	rawInput: Record<string, unknown> | undefined,
	location: ToolCallLocation | undefined,
	title: string,
	verbsToStrip: string[],
): string | undefined {
	const fromInput = pickString(rawInput, [
		"path",
		"file_path",
		"filePath",
		"target",
		"file",
		"uri",
		"absolute_path",
		"absolutePath",
	])
	if (fromInput) return fromInput
	if (location?.path) return location.path
	const fromTitle = extractPathFromTitle(title, verbsToStrip)
	// Reject generic title-extracts that don't look like real paths
	// ("Read File" → "File"). Without this, the per-tool UI renders a
	// broken FileReference for a non-file. The renderer will fall back
	// to metadata.title for the inline label.
	if (fromTitle && looksLikeRealPath(fromTitle)) return fromTitle
	return undefined
}

/**
 * Heuristic: does this string look like a real file path / filename?
 *
 * Cursor's tool titles are often generic placeholders ("Read File",
 * "Edited File") — extracting "File" as a path causes the per-tool UI
 * to render `Read File` with broken navigation links. Reject single
 * words that lack a path separator AND a file extension AND aren't
 * obviously a known file (e.g. `package.json`, `.env`, `Makefile`).
 */
function looksLikeRealPath(p: string): boolean {
	if (!p) return false
	// Path separator → definitely a path.
	if (p.includes("/") || p.includes("\\")) return true
	// File extension (with at least one alphanumeric char after the dot)
	// → likely a filename. Excludes bare `.` or `..` though those don't
	// usually leak in here anyway.
	if (/\.[A-Za-z0-9]+$/.test(p)) return true
	// Known well-shaped extensionless filenames.
	const KNOWN_EXTENSIONLESS = new Set([
		"Makefile",
		"Dockerfile",
		"Containerfile",
		"Procfile",
		"Vagrantfile",
		"Brewfile",
		"Gemfile",
		"Rakefile",
		"LICENSE",
		"README",
		"CHANGELOG",
		"CONTRIBUTING",
		"NOTICE",
	])
	if (KNOWN_EXTENSIONLESS.has(p)) return true
	return false
}

/** "Read foo/bar.ts" → "foo/bar.ts", "Bash: `ls`" → undefined. */
function extractPathFromTitle(title: string, verbs: string[]): string | undefined {
	if (!title) return undefined
	for (const verb of verbs) {
		const re = new RegExp(`^${verb}\\s+(.+?)(?:\\s+L\\d+|$)`, "i")
		const m = re.exec(title)
		if (m) {
			const path = m[1].trim().replace(/^["'`]|["'`]$/g, "")
			if (path && !path.includes("\n")) return path
		}
	}
	return undefined
}

/** Backtick-quoted command inside title, e.g. "Run `git status`" → "git status". */
function extractCommandFromTitle(title: string): string | undefined {
	if (!title) return undefined
	const m = /`([^`]+)`/.exec(title)
	if (m) return m[1].trim() || undefined
	const colon = /^[a-z\s]+:\s*(.+)$/i.exec(title)
	if (colon) return colon[1].trim().replace(/^["'`]|["'`]$/g, "")
	return undefined
}

function composeFromExecutable(rawInput: Record<string, unknown> | undefined): string | undefined {
	if (!rawInput) return undefined
	const exec = typeof rawInput.executable === "string" ? rawInput.executable.trim() : ""
	const args = rawInput.args
	if (!exec) return undefined
	if (Array.isArray(args)) {
		const joined = args
			.map((a) => (typeof a === "string" ? a : ""))
			.filter(Boolean)
			.join(" ")
		return joined ? `${exec} ${joined}` : exec
	}
	if (typeof args === "string" && args.trim()) return `${exec} ${args.trim()}`
	return exec
}

/** "Grep \"foo\"" or "Search foo" → "foo". */
function extractGrepPatternFromTitle(title: string): string | undefined {
	if (!title) return undefined
	const quoted = /["'`]([^"'`]+)["'`]/.exec(title)
	if (quoted) return quoted[1].trim() || undefined
	const m = /^(?:grep|search|semsearch)\s+(.+?)(?:\s+in\s|$)/i.exec(title)
	if (m) return m[1].trim().replace(/^["'`]|["'`]$/g, "") || undefined
	return undefined
}

function extractUrlFromTitle(title: string): string | undefined {
	const m = /(https?:\/\/\S+)/i.exec(title)
	return m ? m[1] : undefined
}

function extractTodosFromOutput(rawOutput: unknown): unknown[] | undefined {
	if (!isRecord(rawOutput)) return undefined
	if (Array.isArray(rawOutput.todos)) return rawOutput.todos
	if (Array.isArray(rawOutput.newTodos)) return rawOutput.newTodos
	return undefined
}

function contentBlockText(block: ContentBlock): string {
	switch (block.type) {
		case "text":
			return block.text
		case "image":
			return `[image ${block.mimeType}]`
		case "audio":
			return `[audio ${block.mimeType}]`
		case "resource_link":
			return block.title ? `[${block.title}](${block.uri})` : `[${block.name}](${block.uri})`
		case "resource": {
			const r = block.resource
			if (typeof r.text === "string" && r.text.length > 0) return r.text
			if (typeof r.blob === "string")
				return `[binary resource ${r.mimeType ?? "application/octet-stream"}]`
			return `[resource ${r.uri ?? ""}]`
		}
	}
}

/** Extract just text from content[] (used for streaming output preview). */
function extractTextOnly(content: ReadonlyArray<ToolCallContent>): string | undefined {
	if (content.length === 0) return undefined
	const lines: string[] = []
	for (const c of content) {
		if (c.type === "content") lines.push(contentBlockText(c.content))
	}
	const joined = lines.join("\n").trim()
	return joined.length > 0 ? joined : undefined
}

/** Extract a textual representation including diff/terminal placeholders. */
function extractContentText(
	content: ReadonlyArray<ToolCallContent>,
	rawOutput: unknown,
): string | undefined {
	// Cursor's Read tool sometimes returns ONLY a `resource_link`
	// content block (a URI pointer with no body), while the actual
	// file content lives in `rawOutput.content` (or .text/.output).
	// Without this, the tool card renders just a link with no body
	// — users see "empty" Read output. Detect link-only content and
	// prefer rawOutput when it has a real body.
	const linkOnly = content.length > 0 && content.every(isLinkOnlyBlock)
	if (linkOnly) {
		const fromRaw = extractTextFromRawOutput(rawOutput)
		if (fromRaw && fromRaw.length > 0) return fromRaw
	}
	if (content.length > 0) {
		const lines: string[] = []
		for (const c of content) {
			if (c.type === "content") {
				lines.push(contentBlockText(c.content))
			} else if (c.type === "diff") {
				lines.push(unifiedDiffFor(c.path, c.oldText, c.newText))
			} else if (c.type === "terminal") {
				lines.push(`[terminal ${c.terminalId}]`)
			}
		}
		const joined = lines.filter(Boolean).join("\n").trim()
		if (joined.length > 0) return joined
	}
	const fromRaw = extractTextFromRawOutput(rawOutput)
	if (fromRaw !== undefined) return fromRaw
	return undefined
}

function isLinkOnlyBlock(c: ToolCallContent): boolean {
	if (c.type !== "content") return false
	return c.content.type === "resource_link"
}

function extractTextFromRawOutput(rawOutput: unknown): string | undefined {
	if (rawOutput === undefined || rawOutput === null) return undefined
	if (typeof rawOutput === "string") return rawOutput
	if (isRecord(rawOutput)) {
		// Common Cursor Read/Write output shapes: prefer the body fields
		// over the full JSON dump so the rendered output is a clean file
		// preview rather than a pretty-printed wrapper object.
		for (const key of ["content", "text", "output", "stdout", "body", "data"]) {
			const v = rawOutput[key]
			if (typeof v === "string" && v.length > 0) return v
		}
	}
	try {
		return JSON.stringify(rawOutput, null, 2)
	} catch {
		return String(rawOutput)
	}
}

function collectDiffBlocks(
	content: ReadonlyArray<ToolCallContent>,
): Array<{ path: string; oldText: string | null | undefined; newText: string }> {
	const out: Array<{ path: string; oldText: string | null | undefined; newText: string }> = []
	for (const c of content) {
		if (c.type === "diff") out.push({ path: c.path, oldText: c.oldText, newText: c.newText })
	}
	return out
}

/** Build a minimal unified diff for a file change. */
function unifiedDiffFor(path: string, oldText: string | null | undefined, newText: string): string {
	const oldLines = oldText == null ? [] : oldText.split("\n")
	const newLines = newText.split("\n")
	const header = `--- a/${path}\n+++ b/${path}`
	// Cheap synthetic hunk: we don't have line-level diffs here, just dump
	// the whole-file replacement. The DiffBlock renderer handles big hunks.
	const removed = oldLines.map((l) => `-${l}`).join("\n")
	const added = newLines.map((l) => `+${l}`).join("\n")
	const sep = removed && added ? "\n" : ""
	return `${header}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${removed}${sep}${added}`
}

/**
 * Detect whether a tool's target path is the active plan file.
 *
 * Loop's plan tool persists to `<workspace>/.loop/plans/<sessionId>.md`
 * (see `src/server/plan/index.ts`). Cursor's Edit/Write/CreatePlan all
 * pass paths that may be relative or absolute. We accept any path whose
 * trailing segments match `.loop/plans/<sessionId>.md`. When the
 * sessionId isn't known we fall back to a generic ULID-shaped match so
 * we still recognise plan writes for unknown sessions (with a slightly
 * higher false-positive risk — acceptable since plan files are an
 * unusual location to edit by hand).
 */
function isPlanFilePath(path: string, loopSessionId: string | undefined): boolean {
	const normalised = path.replace(/\\/g, "/").replace(/^\.\//, "")
	if (loopSessionId) {
		const suffix = `.loop/plans/${loopSessionId}.md`
		if (normalised === suffix || normalised.endsWith(`/${suffix}`)) return true
	}
	return /(?:^|\/)\.loop\/plans\/[A-Za-z0-9_-]+\.md$/.test(normalised)
}

/**
 * Decide whether a tool_call is forbidden under plan mode.
 *
 * Returns the violation `{ reason, targetPath }` if forbidden, or
 * undefined if the call is plan-mode-safe. Used by Defense 4 in
 * applyToolCall to short-circuit edits that bypass the permission
 * request flow.
 *
 * The rule mirrors permissions.ts:reasonToHardReject — the loop tool
 * is forbidden when it's a known mutating tool name AND the resolved
 * target path (if any) is NOT the plan file. We DON'T fire on cursor's
 * built-in plan-write detection (loopTool === "plan-write") because
 * that's an allowed path.
 */
function isForbiddenPlanModeTool(
	tool: ToolState,
	derived: { editFiles?: ReadonlyArray<{ path: string }> },
	loopSessionId: string | undefined,
): { reason: string; targetPath: string | undefined } | undefined {
	const mutatingLoopTools = new Set(["edit", "multiedit", "write", "apply-patch", "delete"])
	if (!mutatingLoopTools.has(tool.loopTool)) return undefined
	// Plan-writes are explicitly allowed under plan mode.
	if (tool.loopTool === "plan-write") return undefined

	// Cursor's initial `tool_call` event for an edit/write often arrives
	// with empty rawInput and a generic title like "Edited File" — the
	// real path lands in a later `tool_call_update` (or in the diff
	// content blocks). Don't preemptively reject on the first event;
	// wait until cursor actually starts the work AND we have a concrete
	// path from rawInput, locations, or derived.editFiles.
	if (tool.status !== "in_progress" && tool.status !== "completed") return undefined

	// Use ONLY concrete sources of truth for the target path:
	// - rawInput.path / file_path / filePath / target / absolute_path / absolutePath / uri
	//   (these come straight from cursor's tool input — authoritative)
	// - locations[] (cursor's structured location annotations)
	// - derived.editFiles (parsed from `diff` content blocks once cursor
	//   actually emits the edit)
	//
	// We deliberately do NOT use `tool.input.path` because that's the
	// derived Loop input, which deriveLoopTool fills in from the tool's
	// TITLE when rawInput is empty. A title like "Edited File" would
	// resolve to "File" — a false positive.
	const candidates: string[] = []
	const rawInputObj =
		tool.rawInput && typeof tool.rawInput === "object" && !Array.isArray(tool.rawInput)
			? (tool.rawInput as Record<string, unknown>)
			: {}
	for (const key of [
		"path",
		"file_path",
		"filePath",
		"target",
		"absolute_path",
		"absolutePath",
		"uri",
	]) {
		const v = rawInputObj[key]
		if (typeof v === "string" && v.length > 0) candidates.push(v)
	}
	if (tool.locations) {
		for (const loc of tool.locations) {
			if (typeof loc.path === "string" && loc.path.length > 0) candidates.push(loc.path)
		}
	}
	if (derived.editFiles) {
		for (const f of derived.editFiles) {
			if (typeof f.path === "string" && f.path.length > 0) candidates.push(f.path)
		}
	}

	// No concrete path evidence yet — let the call proceed. The
	// permission handler (Defense 3) and the upstream system prompt
	// (Defense 1) handle this case. Defense 4 only kicks in when we
	// have ACTUAL path data, to avoid false positives that block the
	// plan agent's legitimate plan-file write.
	if (candidates.length === 0) return undefined

	const allPlanFile = candidates.every((p) => isPlanFilePath(p, loopSessionId))
	if (allPlanFile) return undefined
	const offending = candidates.find((p) => !isPlanFilePath(p, loopSessionId))
	return {
		reason: `${tool.loopTool} on ${offending} (only the plan file may be modified in plan mode)`,
		targetPath: offending,
	}
}

function countDiffStats(
	oldText: string | null | undefined,
	newText: string,
): { additions: number; deletions: number } {
	const oldLines = oldText == null ? 0 : oldText.split("\n").length
	const newLines = newText.split("\n").length
	if (oldText == null) return { additions: newLines, deletions: 0 }
	// Without per-line diff, approximate: count line-count delta as
	// minimum additions; treat the rest as modifications. This is good
	// enough for the UI badge — the real diff renderer shows the actual
	// hunks.
	if (newLines >= oldLines) {
		return { additions: newLines - oldLines, deletions: 0 }
	}
	return { additions: 0, deletions: oldLines - newLines }
}
