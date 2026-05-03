import { existsSync } from "node:fs"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"

/**
 * Resume-cursor helpers for Cursor SDK sessions.
 *
 * `Agent.create()` returns a stable `agentId` that the Cursor SDK uses as
 * the unit of conversation state. We persist it on the Loop session row
 * alongside the `cwd` we passed to `local: { cwd }` at create time. The
 * next prompt calls `Agent.resume(agentId)` instead of starting fresh.
 *
 * If the persisted cwd has been deleted or moved we reset and create a
 * fresh agent rather than letting the SDK error mid-turn.
 */

const log = createLogger("cursor-session")

export interface CursorResumeState {
	/** The cursor SDK agent id from the previous turn, or null on first turn. */
	cursorAgentId: string | null
	/** Working directory the agent was created with. */
	cursorCwd: string | null
}

/** Read the Cursor resume state from the DB. */
export function readCursorResumeState(sessionId: string): CursorResumeState {
	const session = queries.findSessionById(sessionId)
	if (!session) {
		return { cursorAgentId: null, cursorCwd: null }
	}
	return {
		cursorAgentId: (session as { cursorAgentId?: string | null }).cursorAgentId ?? null,
		cursorCwd: (session as { cursorCwd?: string | null }).cursorCwd ?? null,
	}
}

/**
 * Decide whether a persisted Cursor agentId is still usable.
 *
 * Becomes stale when the recorded `cwd` no longer exists on disk or when
 * the agentId was never set. In both cases we want a fresh agent.
 */
export function resolveCursorResume(state: CursorResumeState): {
	shouldResume: boolean
	agentId?: string
	reason?: string
} {
	if (!state.cursorAgentId) {
		return { shouldResume: false, reason: "no prior agent id" }
	}
	if (state.cursorCwd && !existsSync(state.cursorCwd)) {
		log.info("Cursor resume cursor stale: cwd no longer exists", { cwd: state.cursorCwd })
		return { shouldResume: false, reason: "cwd missing" }
	}
	return { shouldResume: true, agentId: state.cursorAgentId }
}

/** Persist the Cursor agentId + cwd. Wrapped in withEffects to match Loop's write pattern. */
export function persistCursorResume(
	sessionId: string,
	data: { cursorAgentId?: string | null; cursorCwd?: string | null },
): void {
	Database.withEffects(() => {
		queries.updateSession(sessionId, data)
	})
}

/**
 * Reset the Cursor resume cursor. Called when the user switches providers
 * mid-session or after a fatal SDK failure.
 */
export function clearCursorResume(sessionId: string): void {
	persistCursorResume(sessionId, { cursorAgentId: null, cursorCwd: null })
}
