/**
 * `ensureSession` — the single entrypoint for "I need this session in the store."
 *
 * Replaces the ad-hoc `apiClient.get(/sessions/:id/messages)` calls scattered
 * across hooks. Guarantees:
 *
 *   1. **Fast-path**: resolves immediately if the session + messages are already
 *      in the store — no fetch.
 *   2. **Dedupe by store reference** (WeakMap): N concurrent callers for the same
 *      store + session id share one in-flight request. When the LRU evicts a
 *      store, its dedupe map GCs and a fresh ensureSession on the new store
 *      starts a clean fetch.
 *   3. **Abort decoupled from fetch**: each caller owns its own AbortSignal and
 *      gets its own `Promise.race([shared, abort])`. One caller aborting does
 *      NOT poison the shared promise for other subscribers (classic dedupe
 *      bug). The underlying fetch is only cancelled when the last live
 *      subscriber goes away.
 *   4. **Retry chain is one outer promise**: subscribing during the backoff
 *      sleep doesn't spawn a second retry chain. Aborting cancels the pending
 *      `setTimeout` (no leaked timers).
 *   5. **Stale-store guard**: if the workspace store was evicted + recreated
 *      mid-flight, writes are redirected to the current store (or dropped if
 *      the directory has no store anymore — caller's effect cleanup will pick
 *      up the new store on next mount).
 *   6. **Archived sessions** are surfaced as `SessionNotFoundError` — caller
 *      treats them like 404 and redirects out of the route.
 */
import type { Session } from "@core/schema"
import type { StoreApi } from "zustand"
import { type WorkspaceState, workspaceStoreRegistry } from "../stores/workspace-store"
import { ApiError, apiClient } from "./api-client"

export class SessionNotFoundError extends Error {
	readonly code = "SESSION_NOT_FOUND"
	constructor(sessionId: string) {
		super(`Session not found: ${sessionId}`)
		this.name = "SessionNotFoundError"
	}
}

interface InflightEntry {
	/** The shared, signal-less fetch promise — every subscriber races against this. */
	promise: Promise<void>
	/** Live subscribers; when this drops to 0, the underlying fetch's controller aborts. */
	subscribers: number
	controller: AbortController
	/** Resolves the abort-race for currently-sleeping backoff. */
	cancelBackoff: (() => void) | null
}

const dedupe: WeakMap<StoreApi<WorkspaceState>, Map<string, InflightEntry>> = new WeakMap()

const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 400

function getEntries(store: StoreApi<WorkspaceState>): Map<string, InflightEntry> {
	let map = dedupe.get(store)
	if (!map) {
		map = new Map()
		dedupe.set(store, map)
	}
	return map
}

function jitter(ms: number): number {
	// ±20%
	return Math.round(ms * (0.8 + Math.random() * 0.4))
}

function isCacheHit(store: StoreApi<WorkspaceState>, sessionId: string): boolean {
	const s = store.getState()
	if (!s.sessions.find((sess) => sess.id === sessionId)) return false
	if (!s.messages.has(sessionId)) return false
	return true
}

/**
 * Apply server response to the *current* store for `directory`. If the original
 * store was evicted and recreated, route writes to the new one. If no store
 * exists for the directory anymore, drop the writes silently.
 */
function applyToStore(
	originalStore: StoreApi<WorkspaceState>,
	directory: string,
	sessionId: string,
	session: Session,
	messages: unknown[],
): void {
	const current = workspaceStoreRegistry.get(directory) ?? originalStore
	// `originalStore` may itself be evicted (no longer in the registry); only
	// write if we found *some* live store for the directory.
	const live = workspaceStoreRegistry.get(directory)
	if (!live) return
	const target = current
	target.getState().upsertSession(session)
	target.getState().setMessages(sessionId, messages as never)
}

async function fetchWithRetry(
	sessionId: string,
	directory: string,
	signal: AbortSignal,
	entry: InflightEntry,
): Promise<{ session: Session; messages: unknown[] }> {
	let lastErr: unknown
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (signal.aborted) throw new DOMException("Aborted", "AbortError")
		try {
			const data = await apiClient.get<Session & { messages: unknown[] }>(
				`/sessions/${sessionId}`,
				{ directory, signal },
			)
			if (!data || typeof data.id !== "string" || !Array.isArray(data.messages)) {
				throw new Error("Malformed /sessions/:id response")
			}
			if (data.archivedAt != null) {
				throw new SessionNotFoundError(sessionId)
			}
			const { messages, ...session } = data
			return { session, messages }
		} catch (err) {
			lastErr = err
			// 404 is terminal — don't retry, no such session.
			if (err instanceof ApiError && err.status === 404) {
				throw new SessionNotFoundError(sessionId)
			}
			// Archived check above throws SessionNotFoundError directly — don't retry it.
			if (err instanceof SessionNotFoundError) throw err
			// Caller-initiated abort — bail out without retry.
			if (err instanceof DOMException && err.name === "AbortError") throw err
			// Transient — back off and retry, unless we've used all attempts.
			if (attempt === MAX_ATTEMPTS) break
			const delay = jitter(BASE_BACKOFF_MS * 2 ** (attempt - 1))
			await new Promise<void>((resolve) => {
				const id = setTimeout(resolve, delay)
				entry.cancelBackoff = () => {
					clearTimeout(id)
					resolve()
				}
			})
			entry.cancelBackoff = null
			if (signal.aborted) throw new DOMException("Aborted", "AbortError")
		}
	}
	throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export interface EnsureSessionOpts {
	signal?: AbortSignal
}

export function ensureSession(
	store: StoreApi<WorkspaceState>,
	sessionId: string,
	directory: string,
	opts: EnsureSessionOpts = {},
): Promise<void> {
	if (isCacheHit(store, sessionId)) return Promise.resolve()

	const entries = getEntries(store)
	let entry = entries.get(sessionId)

	if (!entry) {
		const controller = new AbortController()
		const placeholder: InflightEntry = {
			promise: undefined as unknown as Promise<void>,
			subscribers: 0,
			controller,
			cancelBackoff: null,
		}
		const fetchPromise = (async () => {
			try {
				const { session, messages } = await fetchWithRetry(
					sessionId,
					directory,
					controller.signal,
					placeholder,
				)
				applyToStore(store, directory, sessionId, session, messages)
			} finally {
				// Always clean up dedupe entry — next call after settlement starts fresh.
				const map = dedupe.get(store)
				if (map?.get(sessionId) === placeholder) map.delete(sessionId)
			}
		})()
		placeholder.promise = fetchPromise
		entries.set(sessionId, placeholder)
		entry = placeholder
	}

	const sharedEntry = entry
	sharedEntry.subscribers++

	const signal = opts.signal
	const onAbort = () => {
		sharedEntry.subscribers = Math.max(0, sharedEntry.subscribers - 1)
		if (sharedEntry.subscribers === 0) {
			sharedEntry.controller.abort()
			sharedEntry.cancelBackoff?.()
		}
	}

	if (signal?.aborted) {
		onAbort()
		return Promise.reject(new DOMException("Aborted", "AbortError"))
	}

	return new Promise<void>((resolve, reject) => {
		let settled = false
		const finish = (ok: boolean, err?: unknown) => {
			if (settled) return
			settled = true
			signal?.removeEventListener("abort", abortHandler)
			// Decrement subscriber count exactly once per call.
			sharedEntry.subscribers = Math.max(0, sharedEntry.subscribers - 1)
			if (ok) resolve()
			else reject(err)
		}
		const abortHandler = () => {
			if (settled) return
			// Don't decrement-then-decrement: route through a single finish().
			settled = true
			signal?.removeEventListener("abort", abortHandler)
			sharedEntry.subscribers = Math.max(0, sharedEntry.subscribers - 1)
			if (sharedEntry.subscribers === 0) {
				sharedEntry.controller.abort()
				sharedEntry.cancelBackoff?.()
			}
			reject(new DOMException("Aborted", "AbortError"))
		}
		signal?.addEventListener("abort", abortHandler)
		sharedEntry.promise.then(
			() => finish(true),
			(err) => finish(false, err),
		)
	})
}

/**
 * Test-only: clear the dedupe map for a given store. Used in vitest to ensure
 * test isolation. Production code never calls this.
 */
export function _resetDedupeForTesting(store: StoreApi<WorkspaceState>): void {
	dedupe.delete(store)
}
