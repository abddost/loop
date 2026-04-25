import { type SDKUserMessage, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { bus } from "../../workspace/bus"
import { type PartEmitter, type SdkMessageLike, createClaudeCodeAdapter } from "./adapter"
import { clearSession as clearPendingTasks, getPendingTasks } from "./pending-tasks"
import { type QueryRef, makeCanUseTool } from "./permission"
import { type SdkPermissionMode, needsDangerousSkip } from "./prompts"

/**
 * Per-session SDK query + background stream processor.
 *
 * t3code-style architecture: one `query()` is created when the first turn
 * runs for a session and stays alive across every subsequent turn. User
 * prompts are pushed onto an async queue that backs the SDK's `prompt`
 * AsyncIterable, so the query never sees end-of-stream and keeps processing
 * SDK messages indefinitely. A long-running `streamTask` drains those
 * messages into the adapter.
 *
 * This is what lets background subagent notifications (`task_notification`)
 * actually arrive: in the per-turn query model, the query closes when the
 * turn's `result` fires and notifications are lost. Keeping the query alive
 * between turns means they flow in whenever the subagent finishes, and the
 * adapter updates the already-rendered Subagent parts in place.
 */

const log = createLogger("claude-code-session-runtime")

/**
 * Unbounded async queue whose `[Symbol.asyncIterator]()` never naturally
 * terminates — consumers wait until `push()` is called again or `close()`
 * is invoked. Used as the SDK query's `prompt` so the query stays open
 * across turns.
 */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
	private items: SDKUserMessage[] = []
	private waiters: Array<(v: IteratorResult<SDKUserMessage, undefined>) => void> = []
	private closed = false

	push(msg: SDKUserMessage): void {
		if (this.closed) return
		const waiter = this.waiters.shift()
		if (waiter) {
			waiter({ value: msg, done: false })
		} else {
			this.items.push(msg)
		}
	}

	close(): void {
		if (this.closed) return
		this.closed = true
		const doneResult: IteratorResult<SDKUserMessage, undefined> = {
			value: undefined,
			done: true,
		}
		for (const w of this.waiters) w(doneResult)
		this.waiters.length = 0
	}

	[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, undefined> {
		return {
			next: () => {
				if (this.items.length > 0) {
					return Promise.resolve({ value: this.items.shift() as SDKUserMessage, done: false })
				}
				if (this.closed) {
					return Promise.resolve({ value: undefined, done: true })
				}
				return new Promise<IteratorResult<SDKUserMessage, undefined>>((resolve) => {
					this.waiters.push(resolve)
				})
			},
			return: () => Promise.resolve({ value: undefined, done: true }),
		}
	}
}

/** Per-turn completion handle — resolved when the SDK emits `result`. */
interface TurnHandle {
	messageId: string
	resolve: (result: SdkResultPayload | undefined) => void
	reject: (err: Error) => void
}

export interface SdkResultPayload {
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

/** Options needed to build the session runtime's SDK query. */
export interface EnsureSessionRuntimeArgs {
	sessionId: string
	cwd: string
	binaryPath: string
	apiModelId: string
	sdkPermMode: SdkPermissionMode
	sdkEffort?: string
	resume?: string
	/** Invoked when the adapter observes each `session_id` from the SDK. */
	onSessionId?: (sdkSessionId: string) => void
	onCompactBoundary?: (metadata: {
		trigger: "manual" | "auto"
		preTokens?: number
		postTokens?: number
	}) => void
	onAuthFailure?: (message: string) => void
	onTaskStarted?: (info: { taskId: string; outputFile?: string; description?: string }) => void
	onTaskFinished?: (taskId: string) => void
	onPlanContent?: (toolUseId: string, plan: string) => void
	/** Fired once per turn on first main-agent stream activity. The runtime
	 *  uses this to re-assert `busy` session status as a safety net against
	 *  dropped / coalesced SSE status events. */
	onMainAgentActive?: () => void
	/** Session permission ruleset — pass-through to canUseTool. */
	sessionRuleset: import("@core/schema/permission").PermissionRuleset
	bypassPermissions: boolean
}

/** Everything needed to run one turn against the session's persistent query. */
export interface SessionRuntime {
	sessionId: string
	promptQueue: PromptQueue
	query: ReturnType<typeof sdkQuery>
	adapter: ReturnType<typeof createClaudeCodeAdapter>
	queryRef: QueryRef
	currentMessageId: string | undefined
	currentTurn: TurnHandle | undefined
	closed: boolean
	streamTask: Promise<void>
	sessionAbort: AbortController
	/** Signature used to detect stale runtimes — if the next turn needs
	 *  different `cwd`/`model`/`sdkPermMode`/`effort`, we tear this
	 *  runtime down and rebuild. */
	signature: string
	/** Path to the Claude Code binary. */
	binaryPath: string
}

const runtimes = new Map<string, SessionRuntime>()

function signatureOf(args: {
	cwd: string
	apiModelId: string
	sdkEffort?: string
}): string {
	// Only options that are immutable for the lifetime of a `query()` are in
	// the signature — `resume` is only used when building a fresh runtime
	// and `sdkPermMode` can be updated mid-query via `setPermissionMode`,
	// so changes to either shouldn't force a rebuild.
	return JSON.stringify([args.cwd, args.apiModelId, args.sdkEffort])
}

/**
 * Fetch the live session runtime if one exists and matches the requested
 * options. If the signature has changed (e.g. the user switched model mid
 * session), the stale runtime is closed and a fresh one is built.
 */
export async function ensureSessionRuntime(
	args: EnsureSessionRuntimeArgs,
): Promise<SessionRuntime> {
	const sig = signatureOf(args)
	const existing = runtimes.get(args.sessionId)
	if (existing && !existing.closed && existing.signature === sig) return existing
	if (existing) await closeSessionRuntime(args.sessionId)

	const promptQueue = new PromptQueue()
	const queryRef: QueryRef = {}
	const sessionAbort = new AbortController()

	// Mutable holder so the emitter and adapter can address the
	// turn-specific assistant message id that's set right before each
	// push to the prompt queue.
	const messageIdRef: { current: string | undefined } = { current: undefined }
	const emitter = createPartEmitter(args.sessionId, () => messageIdRef.current)

	const adapter = createClaudeCodeAdapter({
		sessionId: args.sessionId,
		messageId: "",
		emitter,
		onSessionId: args.onSessionId,
		onCompactBoundary: args.onCompactBoundary,
		onAuthFailure: args.onAuthFailure,
		onTaskStarted: args.onTaskStarted,
		onTaskFinished: args.onTaskFinished,
		onMainAgentActive: args.onMainAgentActive,
	})

	const canUseTool = makeCanUseTool({
		sessionId: args.sessionId,
		ruleset: args.sessionRuleset,
		bypass: args.bypassPermissions,
		turnSignal: sessionAbort.signal,
		queryRef,
		onPlanContent: (toolUseId, plan) => {
			args.onPlanContent?.(toolUseId, plan)
			adapter.attachToolMetadata(toolUseId, { planContent: plan })
		},
	})

	const sdkOptions: Parameters<typeof sdkQuery>[0]["options"] = {
		pathToClaudeCodeExecutable: args.binaryPath,
		cwd: args.cwd,
		model: args.apiModelId,
		permissionMode: args.sdkPermMode,
		includePartialMessages: true,
		settingSources: ["user", "project", "local"],
		canUseTool,
		env: process.env as Record<string, string>,
		...(args.resume ? { resume: args.resume } : {}),
		...(args.sdkEffort ? { effort: args.sdkEffort as "low" | "medium" | "high" | "max" } : {}),
		...(needsDangerousSkip(args.sdkPermMode) ? { allowDangerouslySkipPermissions: true } : {}),
	}

	const query = sdkQuery({ prompt: promptQueue, options: sdkOptions })
	queryRef.setPermissionMode = (mode) => query.setPermissionMode(mode)

	const runtime: SessionRuntime = {
		sessionId: args.sessionId,
		promptQueue,
		query,
		adapter,
		queryRef,
		currentMessageId: undefined,
		currentTurn: undefined,
		closed: false,
		streamTask: Promise.resolve(),
		sessionAbort,
		signature: sig,
		binaryPath: args.binaryPath,
	}

	runtimes.set(args.sessionId, runtime)

	runtime.streamTask = drainStream(runtime, messageIdRef)

	return runtime
}

/**
 * The long-running background loop. Drains `query` into `adapter.handle`
 * and resolves the current turn's handle when the SDK emits `result`.
 * Between turns, messages still flow in (e.g. `task_notification` for a
 * backgrounded subagent) and are handled by the adapter — parts key off
 * the original turn's `messageId` via `upsertPart`'s conflict behaviour,
 * so they update in-place on the assistant message that first rendered
 * them.
 */
async function drainStream(
	runtime: SessionRuntime,
	messageIdRef: { current: string | undefined },
): Promise<void> {
	let streamError: Error | undefined
	try {
		for await (const message of runtime.query) {
			if (runtime.closed || runtime.sessionAbort.signal.aborted) break

			runtime.adapter.handle(message as unknown as SdkMessageLike)

			// Sync the shared ref so emitter reads the latest messageId.
			if (runtime.currentMessageId) messageIdRef.current = runtime.currentMessageId

			// `result` terminates a turn. The adapter has already observed
			// it and buffered the payload via `finalize`-like state inside
			// itself; we signal the awaiting caller here.
			if ((message as { type?: string }).type === "result" && runtime.currentTurn) {
				const turn = runtime.currentTurn
				runtime.currentTurn = undefined
				turn.resolve(resultPayloadFrom(message))
			}
		}
	} catch (err) {
		streamError = err instanceof Error ? err : new Error(String(err))
		log.warn("SDK stream closed with error", {
			sessionId: runtime.sessionId,
			error: streamError.message,
		})
	} finally {
		runtime.closed = true
		// If the iterator exits with a turn still awaiting `result`, we
		// MUST reject it — otherwise `startTurn` hangs forever and the
		// session status never transitions back to "idle". This covers
		// both the error path above and the surprising-but-possible case
		// where the SDK closes its iterator without an explicit error
		// (e.g. subprocess died mid-turn).
		if (runtime.currentTurn) {
			const turn = runtime.currentTurn
			runtime.currentTurn = undefined
			turn.reject(streamError ?? new Error("Claude Code SDK stream ended before turn result"))
		}
	}
}

function resultPayloadFrom(message: unknown): SdkResultPayload | undefined {
	if (!message || typeof message !== "object") return undefined
	const m = message as {
		stop_reason?: string | null
		subtype?: string
		usage?: unknown
		total_cost_usd?: number
		duration_ms?: number
		num_turns?: number
	}
	return {
		finishReason: m.stop_reason ?? (m.subtype === "success" ? "stop" : "error"),
		usage: normalizeUsage(m.usage),
		costUsd: m.total_cost_usd,
		durationMs: m.duration_ms,
		numTurns: m.num_turns,
	}
}

function normalizeUsage(raw: unknown): SdkResultPayload["usage"] | undefined {
	if (!raw || typeof raw !== "object") return undefined
	const u = raw as {
		input_tokens?: number
		output_tokens?: number
		cache_read_input_tokens?: number
		cache_creation_input_tokens?: number
	}
	return {
		input: u.input_tokens ?? 0,
		output: u.output_tokens ?? 0,
		cacheRead: u.cache_read_input_tokens ?? 0,
		cacheWrite: u.cache_creation_input_tokens ?? 0,
	}
}

/**
 * Start a new turn by pushing a user message and returning a promise
 * that resolves when the SDK emits `result`. Caller must have set
 * `runtime.currentMessageId` first so the emitter targets the right
 * assistant message.
 */
export function startTurn(
	runtime: SessionRuntime,
	messageId: string,
	text: string,
): Promise<SdkResultPayload | undefined> {
	if (runtime.closed) {
		return Promise.reject(new Error("Session runtime is closed"))
	}
	if (runtime.currentTurn) {
		return Promise.reject(new Error("Another turn is already in flight for this session"))
	}
	runtime.currentMessageId = messageId
	return new Promise<SdkResultPayload | undefined>((resolve, reject) => {
		runtime.currentTurn = { messageId, resolve, reject }
		runtime.promptQueue.push({
			type: "user",
			message: {
				role: "user",
				content: [{ type: "text", text }],
			},
			parent_tool_use_id: null,
		})
	})
}

/** Abort the current turn gracefully via the SDK's interrupt(). */
export async function interruptCurrentTurn(sessionId: string): Promise<void> {
	const runtime = runtimes.get(sessionId)
	if (!runtime || runtime.closed) return
	try {
		await runtime.query.interrupt()
	} catch (err) {
		log.warn("query.interrupt() failed", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/**
 * Fully tear down the session runtime. Closes the prompt queue, aborts
 * the query, and awaits the stream task. Idempotent.
 *
 * `query.interrupt()` only halts the main turn — background subagents
 * started with `run_in_background: true` (the SDK's Agent tool) keep
 * running until they're explicitly stopped by `task_id`. We iterate the
 * pending-task registry and call `stopTask()` for each before interrupting
 * so a user cancel really stops everything the turn spawned.
 */
export async function closeSessionRuntime(sessionId: string): Promise<void> {
	const runtime = runtimes.get(sessionId)
	if (!runtime) return
	runtime.closed = true
	runtime.sessionAbort.abort()

	const pending = getPendingTasks(sessionId)
	await Promise.all(
		pending.map(async (task) => {
			try {
				await runtime.query.stopTask(task.taskId)
			} catch (err) {
				log.warn("query.stopTask() failed", {
					sessionId,
					taskId: task.taskId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		}),
	)
	clearPendingTasks(sessionId)

	try {
		await runtime.query.interrupt()
	} catch {
		// best-effort
	}
	runtime.promptQueue.close()
	runtimes.delete(sessionId)
	await runtime.streamTask.catch(() => {})
}

export function getSessionRuntime(sessionId: string): SessionRuntime | undefined {
	return runtimes.get(sessionId)
}

/**
 * Build the session-scoped part emitter.
 *
 * A part's `messageId` is pinned on first emit and reused for every
 * subsequent upsert against the same `id`. This matters for parts
 * that outlive the turn that created them — e.g. a background subagent's
 * Subagent part is created during turn 1 and updated by a
 * `task_notification` that arrives after turn 2 has started. Without the
 * pin, the bus event would carry turn 2's messageId and the frontend
 * store — which keys updates by `messageId + partId` — would fail to
 * locate the row to update.
 */
function createPartEmitter(sessionId: string, getMessageId: () => string | undefined): PartEmitter {
	const partMessageIds = new Map<string, string>()
	return {
		upsertPart({ id, type, data }) {
			const pinned = partMessageIds.get(id)
			const messageId = pinned ?? getMessageId()
			if (!messageId) {
				log.warn("Dropping part upsert — no active messageId", { sessionId, id, type })
				return
			}
			if (!pinned) partMessageIds.set(id, messageId)
			Database.withEffects((_tx, effect) => {
				queries.upsertPart({ id, sessionId, messageId, type, data })
				effect(() => {
					bus().emit("part:upsert", {
						sessionId,
						messageId,
						part: { id, ...(data as Record<string, unknown>) },
					})
				})
			})
		},
		emitDelta({ partId, delta, partType }) {
			const messageId = partMessageIds.get(partId) ?? getMessageId()
			if (!messageId) return
			bus().emit("part:delta", { sessionId, messageId, partId, delta, partType })
		},
	}
}
