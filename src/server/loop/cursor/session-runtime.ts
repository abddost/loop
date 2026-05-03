import { Agent, type ModelSelection, type Run, type SDKAgent } from "@cursor/sdk"
import { createLogger } from "../../logger"
import { Workspace } from "../../workspace"

/**
 * Per-Loop-session Cursor SDK agent lifecycle.
 *
 * One `SDKAgent` is created per Loop session and reused across turns to
 * preserve conversation context inside the Cursor SDK. We persist the
 * agent's `agentId` so a process restart can call `Agent.resume(agentId)`
 * instead of starting fresh.
 *
 * Turn rejection: the SDK enforces a single in-flight run per agent —
 * starting a second `agent.send()` while one is running rejects on the
 * server side. Loop's outer dispatcher already serializes turns per
 * session, so we don't add a queue here. If a stale runtime is detected
 * (different cwd or model from what was persisted), we close it and
 * rebuild — see `signatureOf`.
 *
 * Cancellation: callers hold the active `Run` and call `run.cancel()` on
 * abort. After cancel we do NOT close the SDKAgent — the next turn will
 * resume the same agent so context is retained across user-cancelled
 * turns.
 */

const log = createLogger("cursor-session-runtime")

export interface EnsureCursorAgentArgs {
	sessionId: string
	apiKey: string
	cwd: string
	model: ModelSelection
	/** Persisted agentId from a prior turn, if any. */
	resumeAgentId?: string
	/** Friendly name for `Agent.list()` listings. */
	name?: string
}

export interface CursorSessionRuntime {
	sessionId: string
	agent: SDKAgent
	cwd: string
	model: ModelSelection
	apiKey: string
	closed: boolean
	currentRun: Run | undefined
	/** Detect stale runtimes (cwd / apiKey changes force a rebuild). */
	signature: string
	/**
	 * True after the first `agent.send` that anchored Loop's full system
	 * prompt + agent instructions into the SDKAgent's conversation context.
	 * Cursor's agent retains context across `agent.send()` calls, so we only
	 * inject the system prompt once per runtime; subsequent turns send just
	 * the user's text.
	 */
	systemPromptInjected: boolean
	/**
	 * Stable signature of (agent, model, ruleset) the system prompt was
	 * anchored against. Re-inject when this changes — different agent,
	 * different model header, or different forbidden-tools list all require
	 * the SDKAgent to see a fresh system prompt.
	 */
	anchoredPromptSignature: string | undefined
}

/**
 * Per-workspace SDKAgent cache. Sessions in different workspaces can share
 * IDs without colliding because each workspace gets its own Map. Disposed
 * automatically when the workspace closes (Workspace.disposeAll on shutdown
 * or per-workspace disposal on project deletion).
 */
const cursorRuntimes = Workspace.state(
	() => new Map<string, CursorSessionRuntime>(),
	async (map) => {
		for (const rt of map.values()) {
			rt.closed = true
			try {
				await rt.agent[Symbol.asyncDispose]()
			} catch (err) {
				log.warn("Cursor agent dispose threw on workspace close", {
					sessionId: rt.sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		}
		map.clear()
	},
)

function signatureOf(args: { cwd: string; apiKey: string }): string {
	// Model can change per-send via SendOptions.model — not part of signature.
	// apiKey + cwd are immutable for the lifetime of a created agent.
	return JSON.stringify([args.cwd, args.apiKey.slice(0, 8)])
}

/** Get the active runtime, or undefined if none. */
export function getCursorSessionRuntime(sessionId: string): CursorSessionRuntime | undefined {
	return cursorRuntimes().get(sessionId)
}

/**
 * Ensure a live SDKAgent for `sessionId`. Returns the cached one when its
 * signature matches; otherwise tears the old one down and rebuilds.
 *
 * On first call for a session we either:
 *   - `Agent.resume(resumeAgentId)` when a prior agentId is on the session row, or
 *   - `Agent.create(...)` to start fresh.
 *
 * The caller (runtime.ts) is responsible for persisting the new agentId
 * back to the session row via `persistCursorResume`.
 */
export async function ensureCursorAgent(
	args: EnsureCursorAgentArgs,
): Promise<CursorSessionRuntime> {
	const runtimes = cursorRuntimes()
	const sig = signatureOf(args)
	const existing = runtimes.get(args.sessionId)
	if (existing && !existing.closed && existing.signature === sig) {
		// Update model — Cursor SDK accepts a per-send override, but we keep
		// the runtime's model in sync so callers can see the latest.
		existing.model = args.model
		return existing
	}
	if (existing) await closeCursorSessionRuntime(args.sessionId)

	const agent = await createOrResume(args)

	const runtime: CursorSessionRuntime = {
		sessionId: args.sessionId,
		agent,
		cwd: args.cwd,
		model: args.model,
		apiKey: args.apiKey,
		closed: false,
		currentRun: undefined,
		signature: sig,
		systemPromptInjected: false,
		anchoredPromptSignature: undefined,
	}
	runtimes.set(args.sessionId, runtime)
	return runtime
}

async function createOrResume(args: EnsureCursorAgentArgs): Promise<SDKAgent> {
	// Match the cookbook (sdk/coding-agent-cli/src/agent.ts and sdk/app-builder)
	// shape EXACTLY: `Agent.create({ apiKey, name?, model, local: { cwd } })`.
	//
	// CRUCIAL: We do NOT call `Agent.resume`. Both reference apps always
	// `Agent.create` a fresh agent per session-class instance and rely on
	// in-memory reuse for cross-turn context. We mirror that:
	//   - in-memory `cursorRuntimes` Map keeps the same SDKAgent across
	//     turns within one Loop server lifetime;
	//   - on server restart we drop and re-create. Conversation context is
	//     held by the SDK's internal store; the model still sees the prior
	//     transcript via Cursor's own state, and Loop's DB has its own copy.
	//
	// Why no resume? Resumed agents inherit the `mcpServers` / `agents`
	// configuration baked in at original creation. Sessions created by
	// older Loop builds (which DID pass those fields) hold tainted agents
	// whose built-in Read/Glob/Grep return empty results — the surface
	// exactly matches what users have been reporting. Always-create-fresh
	// guarantees we never replay that bad config.
	if (args.resumeAgentId) {
		log.info("Skipping persisted Cursor resume; creating fresh agent", {
			sessionId: args.sessionId,
			discardedAgentId: args.resumeAgentId,
		})
	}

	log.info("Creating fresh Cursor agent", { sessionId: args.sessionId, cwd: args.cwd })
	return Agent.create({
		apiKey: args.apiKey,
		model: args.model,
		local: { cwd: args.cwd },
		...(args.name ? { name: args.name } : {}),
	})
}

/**
 * Track the currently in-flight Run on a session runtime. The runtime
 * uses this to forward `cancel()` requests when the user aborts a turn.
 */
export function setCurrentRun(sessionId: string, run: Run | undefined): void {
	const rt = cursorRuntimes().get(sessionId)
	if (!rt) return
	rt.currentRun = run
}

/**
 * Cancel the in-flight Run for a session, if any. Best-effort — if the
 * Run doesn't support cancel or has already finished, this is a no-op.
 */
export async function cancelCurrentRun(sessionId: string): Promise<void> {
	const rt = cursorRuntimes().get(sessionId)
	if (!rt?.currentRun) return
	const run = rt.currentRun
	if (!run.supports("cancel")) {
		log.info("Cursor run does not support cancel", {
			sessionId,
			reason: run.unsupportedReason("cancel"),
		})
		return
	}
	try {
		await run.cancel()
	} catch (err) {
		log.warn("run.cancel threw", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/** Tear down the per-session runtime. Disposes the SDKAgent. */
export async function closeCursorSessionRuntime(sessionId: string): Promise<void> {
	const runtimes = cursorRuntimes()
	const rt = runtimes.get(sessionId)
	if (!rt) return
	runtimes.delete(sessionId)
	rt.closed = true
	try {
		await rt.agent[Symbol.asyncDispose]()
	} catch (err) {
		log.warn("Cursor agent dispose threw", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/**
 * Tear down cursor runtimes across every known workspace. Used at server
 * shutdown — at that point we're not inside any specific workspace's
 * `Workspace.run()` context, so we explicitly iterate `Workspace.list()`
 * and dispatch the per-workspace teardown. `Workspace.disposeAll()` will
 * also fire the configured disposer (defense in depth), but calling this
 * first keeps the existing comment ordering in `server/index.ts` valid:
 * SDK channels close before generic workspace disposal touches anything
 * else.
 */
export async function closeAllCursorRuntimes(): Promise<void> {
	const directories = Workspace.list()
	await Promise.all(
		directories.map(async (dir) => {
			const ctx = Workspace.get(dir)
			if (!ctx) return
			await Workspace.run(ctx, async () => {
				const runtimes = cursorRuntimes()
				const ids = Array.from(runtimes.keys())
				await Promise.all(ids.map((id) => closeCursorSessionRuntime(id)))
			})
		}),
	)
}
