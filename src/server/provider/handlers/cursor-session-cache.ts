import type { OpenAiMessage } from "./cursor-runtime"

/**
 * In-memory cache of cursor-agent session ids so subsequent turns of
 * the same conversation can use `--resume <id>` instead of re-sending
 * the full transcript. Cursor keeps session history server-side; the
 * id is the reference.
 *
 * Why in-memory: session state is short-lived (server expires them,
 * and Loop might compact/reset at any turn), so DB persistence adds
 * complexity without durable benefit. A server restart loses the
 * cache, which just means the next turn falls back to a fresh spawn
 * with the full transcript — same behavior as before --resume existed.
 */

interface CachedSession {
	sessionId: string
	messagesSent: number
	lastUpdate: number
}

const CACHE = new Map<string, CachedSession>()
const MAX_ENTRIES = 200
const TTL_MS = 60 * 60 * 1000

/**
 * Derive a stable key for a conversation. Uses the system prompt + the
 * first user message, because both are invariant across all turns of a
 * single conversation (Loop's agent system prompt is regenerated per
 * turn but deterministic from the agent + workspace).
 *
 * Collisions are only a correctness problem if two distinct
 * conversations share identical system+user1 text AND are active
 * within TTL. In practice that happens only for "canned" test inputs;
 * treat it as acceptable since the fallback (wrong --resume) produces
 * an error that invalidates the cache and spawns fresh.
 */
export function conversationKey(workspace: string | null, messages: OpenAiMessage[]): string {
	let systemContent = ""
	let firstUser = ""
	for (const m of messages) {
		if (m.role === "system" && !systemContent) {
			systemContent = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
		}
		if (m.role === "user" && !firstUser) {
			firstUser = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
			break
		}
	}
	return `${workspace ?? "-"}||${systemContent.slice(0, 400)}||${firstUser.slice(0, 600)}`
}

export function getCachedSession(key: string): CachedSession | null {
	const entry = CACHE.get(key)
	if (!entry) return null
	if (Date.now() - entry.lastUpdate > TTL_MS) {
		CACHE.delete(key)
		return null
	}
	return entry
}

export function setCachedSession(key: string, sessionId: string, messagesSent: number): void {
	if (CACHE.size >= MAX_ENTRIES) {
		let oldestKey: string | null = null
		let oldestTime = Number.POSITIVE_INFINITY
		for (const [k, v] of CACHE) {
			if (v.lastUpdate < oldestTime) {
				oldestTime = v.lastUpdate
				oldestKey = k
			}
		}
		if (oldestKey) CACHE.delete(oldestKey)
	}
	CACHE.set(key, { sessionId, messagesSent, lastUpdate: Date.now() })
}

export function invalidateCachedSession(key: string): void {
	CACHE.delete(key)
}

/** Testing hook — reset cache. Not exported from the public barrel. */
export function _resetCache(): void {
	CACHE.clear()
}
