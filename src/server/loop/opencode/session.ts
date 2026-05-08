import { existsSync } from "node:fs"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"

/**
 * Resume-cursor helpers for OpenCode SDK sessions.
 *
 * OpenCode assigns a session ID via `session.create()` that we pass back
 * on subsequent turns so the upstream provider sees one coherent
 * conversation. We persist the ID + the working directory on the Loop
 * session row so process restarts can re-attach instead of orphaning the
 * conversation. If the persisted cwd has been deleted or moved we reset
 * and create a fresh session rather than letting the SDK error mid-turn.
 *
 * Mirrors `src/server/loop/cursor/session.ts` — same DB-backed shape.
 */

const log = createLogger("opencode-session")

export interface OpenCodeResumeState {
	/** The OpenCode session ID from the previous turn (null = fresh). */
	openCodeSessionId: string | null
	/** Working directory the session was created with. */
	openCodeCwd: string | null
}

/** Read the resume state for a Loop session from the DB. */
export function readOpenCodeResumeState(sessionId: string): OpenCodeResumeState {
	const session = queries.findSessionById(sessionId)
	if (!session) return { openCodeSessionId: null, openCodeCwd: null }
	return {
		openCodeSessionId: (session as { openCodeSessionId?: string | null }).openCodeSessionId ?? null,
		openCodeCwd: (session as { openCodeCwd?: string | null }).openCodeCwd ?? null,
	}
}

/**
 * Decide whether a persisted OpenCode session id is still usable.
 *
 * Becomes stale when the recorded `cwd` no longer exists on disk or when
 * the session id was never set. In both cases we want a fresh session.
 */
export function resolveOpenCodeResume(state: OpenCodeResumeState): {
	shouldResume: boolean
	openCodeSessionId?: string
	reason?: string
} {
	if (!state.openCodeSessionId) {
		return { shouldResume: false, reason: "no prior session id" }
	}
	if (state.openCodeCwd && !existsSync(state.openCodeCwd)) {
		log.info("OpenCode resume cursor stale: cwd no longer exists", { cwd: state.openCodeCwd })
		return { shouldResume: false, reason: "cwd missing" }
	}
	return { shouldResume: true, openCodeSessionId: state.openCodeSessionId }
}

/** Persist the OpenCode session id + cwd. Wrapped in `withEffects` to
 *  match Loop's write pattern. */
export function persistOpenCodeResume(
	sessionId: string,
	data: { openCodeSessionId?: string | null; openCodeCwd?: string | null },
): void {
	Database.withEffects(() => {
		queries.updateSession(sessionId, data)
	})
}

/**
 * Reset the OpenCode resume cursor. Called when the user switches
 * providers mid-session or after a fatal SDK failure.
 */
export function clearResumeState(sessionId: string): void {
	persistOpenCodeResume(sessionId, { openCodeSessionId: null, openCodeCwd: null })
}
