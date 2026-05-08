import { createLogger } from "../../logger"
import { type OpenCodeConnection, connectOpenCode } from "../../provider/opencode/client"
import type { createOpenCodeAdapter } from "./adapter"

/**
 * Per-Loop-session runtime for OpenCode.
 *
 * Holds two long-lived resources scoped to a Loop session:
 *   1. The OpenCode connection (CLI subprocess or remote attach).
 *   2. A single `event.subscribe()` SSE stream feeding the active adapter.
 *
 * The adapter itself is per-turn — `runOpenCodeLoop` creates a fresh adapter
 * before each prompt (turn-scoped emitter binds the assistant messageId)
 * and attaches it via `attachAdapter`. The drain loop forwards every event
 * matching this OpenCode session ID to whichever adapter is currently
 * attached. When the turn finishes, `detachAdapter()` is called so late
 * events are dropped on the floor instead of poisoning the next turn.
 *
 * Why session-scoped (not per-turn):
 *   - Spawning the CLI per turn adds ~500ms to first-token latency.
 *   - The event stream is global; reusing one subscription avoids
 *     re-establishing the SSE connection between turns.
 *   - Mirrors the claude-code session-runtime pattern.
 */

const log = createLogger("opencode-session-runtime")

type Adapter = ReturnType<typeof createOpenCodeAdapter>

export interface OpenCodeSessionRuntime {
	connection: OpenCodeConnection
	openCodeSessionId: string
	directory: string
	/** Bind a turn-scoped adapter; events are forwarded until detached. */
	attachAdapter(adapter: Adapter): void
	/** Detach the adapter — late events are silently dropped after this. */
	detachAdapter(): void
	/**
	 * Wait for the adapter to signal idle (turn complete).
	 *
	 * @param timeoutMs Hard absolute cap — rejects if exceeded.
	 * @param staleEventTimeoutMs If set, also resolves when no events have
	 *        arrived from OpenCode for this duration after at least one event
	 *        has been seen. Catches "model done but server didn't fire idle".
	 */
	awaitIdle(timeoutMs?: number, staleEventTimeoutMs?: number): Promise<void>
	/**
	 * Caller invokes this from the adapter's `onIdle` callback. Decoupling
	 * the idle signal from a specific event type lets the adapter own the
	 * "what counts as idle" decision (`session.status` with `idle`,
	 * `session.idle`, `session.error`, etc.).
	 */
	signalIdle(): void
	/** Request abort of the OpenCode-side turn. */
	abortTurn(): Promise<void>
	/** Tear down the SSE subscription + connection. */
	close(): Promise<void>
}

interface RuntimeRecord {
	runtime: OpenCodeSessionRuntime
	signature: string
}

/** Map<Loop sessionId, runtime>. */
const runtimes = new Map<string, RuntimeRecord>()

interface EnsureInput {
	sessionId: string
	directory: string
	binaryPath: string
	serverUrl?: string
	serverPassword?: string
	/**
	 * Optional resume hint — if the long-lived server still knows this
	 * session id, we'll reuse it. Otherwise (or if no hint provided) we
	 * create a fresh OpenCode session via the runtime's own client.
	 *
	 * CRITICAL: this MUST flow through the runtime, not a one-shot
	 * connection. Local-mode OpenCode servers maintain their own per-process
	 * session state, so a session created on a throwaway connection is
	 * invisible to the long-lived server — the model would see no history.
	 */
	resumeOpenCodeSessionId?: string
	/** Title to use if we have to create a new OpenCode session. */
	sessionTitle?: string
}

/**
 * Get-or-create the session runtime. Signature is keyed on directory + server
 * config — any mismatch tears down and rebuilds (e.g. the user switched
 * server URL or binary path).
 *
 * The OpenCode session id itself is NOT part of the signature: the runtime
 * owns it and resolves it on first build (resume the persisted id if the
 * server still knows it, otherwise create a new one). This avoids the
 * process-isolation bug where session.create runs on a throwaway server
 * that the long-lived server never sees.
 */
export async function ensureSessionRuntime(input: EnsureInput): Promise<OpenCodeSessionRuntime> {
	const signature = JSON.stringify({
		dir: input.directory,
		url: input.serverUrl ?? "",
		password: input.serverPassword ?? "",
		// Binary path matters only for local mode (no serverUrl).
		binary: input.serverUrl ? "" : input.binaryPath,
	})

	const existing = runtimes.get(input.sessionId)
	if (existing && existing.signature === signature) {
		return existing.runtime
	}
	if (existing) {
		log.info("Rebuilding OpenCode session runtime: signature mismatch", {
			sessionId: input.sessionId,
		})
		await closeSessionRuntime(input.sessionId)
	}

	const runtime = await buildRuntime(input)
	runtimes.set(input.sessionId, { runtime, signature })
	return runtime
}

/** Look up the runtime — undefined when none has been built. */
export function getSessionRuntime(sessionId: string): OpenCodeSessionRuntime | undefined {
	return runtimes.get(sessionId)?.runtime
}

/** Tear down + remove the runtime for a Loop session. */
export async function closeSessionRuntime(sessionId: string): Promise<void> {
	const entry = runtimes.get(sessionId)
	if (!entry) return
	runtimes.delete(sessionId)
	await entry.runtime.close().catch((err) => {
		log.warn("Failed to close OpenCode session runtime", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	})
}

/** Tear down every cached runtime — called on shutdown / tests. */
export async function closeAllSessionRuntimes(): Promise<void> {
	const ids = Array.from(runtimes.keys())
	await Promise.all(ids.map(closeSessionRuntime))
}

// ── Internals ──────────────────────────────────────────────────────────

interface DeferredVoid {
	promise: Promise<void>
	resolve: () => void
	reject: (err: unknown) => void
}

function createDeferred(): DeferredVoid {
	let resolve!: () => void
	let reject!: (err: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

async function buildRuntime(input: EnsureInput): Promise<OpenCodeSessionRuntime> {
	const connection = await connectOpenCode({
		binaryPath: input.binaryPath,
		directory: input.directory,
		...(input.serverUrl ? { serverUrl: input.serverUrl } : {}),
		...(input.serverPassword ? { serverPassword: input.serverPassword } : {}),
	})

	// Resolve the OpenCode session id on THIS connection. If we have a resume
	// hint, try `session.get` to confirm the long-lived server still knows it.
	// On failure (server restart, GC'd session, fresh process), fall through
	// to creating a new one.
	let openCodeSessionId: string | undefined
	if (input.resumeOpenCodeSessionId) {
		try {
			const got = await connection.client.session.get({
				sessionID: input.resumeOpenCodeSessionId,
				directory: input.directory,
			})
			if (got.data?.id) openCodeSessionId = got.data.id
		} catch (err) {
			log.info("OpenCode resume id not recognised by server — creating new", {
				sessionId: input.sessionId,
				resumeId: input.resumeOpenCodeSessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}
	if (!openCodeSessionId) {
		const created = await connection.client.session.create({
			directory: input.directory,
			title: input.sessionTitle ?? "Loop session",
		})
		openCodeSessionId = created.data?.id
		if (!openCodeSessionId) {
			await connection.dispose().catch(() => {})
			throw new Error("OpenCode session.create returned no session ID.")
		}
	}

	let currentAdapter: Adapter | undefined
	let idleDeferred = createDeferred()
	let aborted = false
	const subscriptionAbort = new AbortController()
	/** Wallclock of the most recent event we forwarded to the adapter for the
	 *  CURRENT turn. Reset to 0 in `attachAdapter`; bumped in the drain. The
	 *  stale-event watchdog in `awaitIdle` reads this. */
	let lastTurnEventAt = 0

	const subscription = await connection.client.event.subscribe(
		{ directory: input.directory },
		{ signal: subscriptionAbort.signal },
	)

	const drainPromise = (async () => {
		try {
			for await (const event of subscription.stream) {
				if (aborted) break
				const ev = event as { type: string; properties?: unknown }
				if (!matchesSession(ev, openCodeSessionId)) continue

				const adapter = currentAdapter
				if (adapter) {
					lastTurnEventAt = Date.now()
					adapter.handle(ev as { type: string; properties?: Record<string, unknown> })
				}
			}
		} catch (err) {
			if (!aborted) {
				log.warn("OpenCode event stream errored", {
					sessionId: input.sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		} finally {
			// If the stream ends without an idle signal (server bounce, network
			// drop), unblock any waiter so the runtime doesn't hang.
			idleDeferred.resolve()
		}
	})()

	const runtime: OpenCodeSessionRuntime = {
		connection,
		openCodeSessionId,
		directory: input.directory,
		attachAdapter(adapter: Adapter): void {
			currentAdapter = adapter
			// Replace the deferred so a stale idle signal from an earlier turn
			// doesn't immediately resolve this one.
			idleDeferred = createDeferred()
			lastTurnEventAt = 0
		},
		detachAdapter(): void {
			currentAdapter = undefined
		},
		signalIdle(): void {
			idleDeferred.resolve()
		},
		awaitIdle(timeoutMs?: number, staleEventTimeoutMs?: number): Promise<void> {
			const current = idleDeferred
			const promises: Array<Promise<void>> = [current.promise]

			if (timeoutMs && timeoutMs > 0) {
				promises.push(
					new Promise<void>((_, reject) =>
						setTimeout(
							() => reject(new Error(`Timed out waiting for OpenCode idle after ${timeoutMs}ms`)),
							timeoutMs,
						),
					),
				)
			}

			if (staleEventTimeoutMs && staleEventTimeoutMs > 0) {
				// Stale-event watchdog: poll every 5s. Once we've seen at least
				// one event for this turn, if no further events arrive for
				// `staleEventTimeoutMs`, declare idle. Catches builds where
				// `session.idle` / `session.status: idle` never fires.
				promises.push(
					new Promise<void>((resolve) => {
						const tick = () => {
							if (lastTurnEventAt > 0 && Date.now() - lastTurnEventAt >= staleEventTimeoutMs) {
								log.info("OpenCode stale-event watchdog tripped — declaring idle", {
									sessionId: input.sessionId,
									staleMs: Date.now() - lastTurnEventAt,
								})
								resolve()
								return
							}
							timer = setTimeout(tick, 5_000)
						}
						let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 5_000)
						// Clean up timer when any other promise resolves.
						current.promise.finally(() => clearTimeout(timer))
					}),
				)
			}

			return Promise.race(promises)
		},
		async abortTurn(): Promise<void> {
			try {
				await connection.client.session.abort({
					sessionID: openCodeSessionId,
					directory: input.directory,
				})
			} catch (err) {
				log.warn("OpenCode session.abort failed", {
					sessionId: input.sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		},
		async close(): Promise<void> {
			aborted = true
			currentAdapter = undefined
			subscriptionAbort.abort()
			idleDeferred.resolve()
			try {
				await drainPromise
			} catch {
				/* swallow */
			}
			await connection.dispose()
		},
	}

	return runtime
}

function matchesSession(
	event: { type: string; properties?: unknown },
	openCodeSessionId: string,
): boolean {
	const props = event.properties as Record<string, unknown> | undefined
	if (!props) return false
	if (props.sessionID === openCodeSessionId) return true
	// `message.updated` / `session.created` nest the session id under `info`.
	if (typeof props.info === "object" && props.info !== null) {
		const info = props.info as Record<string, unknown>
		if (info.sessionID === openCodeSessionId) return true
		if (info.id === openCodeSessionId) return true
	}
	return false
}
