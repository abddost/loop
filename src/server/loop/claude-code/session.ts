import { existsSync } from "node:fs"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"

/**
 * Resume-cursor helpers for Claude Code sessions.
 *
 * The SDK assigns a `session_id` on the first message of every run and that
 * id is what we pass back to `query({ resume })` on subsequent turns. We
 * persist it on the Loop session row alongside the `cwd` we saw at the
 * time — if the user has since deleted or moved the working directory, we
 * reset and start fresh rather than letting the CLI crash.
 */

const log = createLogger("claude-code-session")

export interface ResumeState {
	/** The SDK session id from the previous turn. */
	claudeCodeSessionId: string | null
	/** Working directory the CLI was running in when the session id was captured. */
	claudeCodeCwd: string | null
	/** Last SDK message UUID from the previous turn. */
	claudeCodeLastTurnId: string | null
}

/** Read the Claude Code resume state from the DB. */
export function readResumeState(sessionId: string): ResumeState {
	const session = queries.findSessionById(sessionId)
	if (!session) {
		return {
			claudeCodeSessionId: null,
			claudeCodeCwd: null,
			claudeCodeLastTurnId: null,
		}
	}
	return {
		claudeCodeSessionId: (session as any).claudeCodeSessionId ?? null,
		claudeCodeCwd: (session as any).claudeCodeCwd ?? null,
		claudeCodeLastTurnId: (session as any).claudeCodeLastTurnId ?? null,
	}
}

/**
 * Decide whether a persisted SDK session id is still usable.
 *
 * A resume cursor becomes stale when the recorded `cwd` has been deleted
 * or the resume id was never set. In both cases we want to start a fresh
 * CLI conversation instead of letting the SDK error out halfway through.
 */
export function resolveResumeCursor(state: ResumeState): {
	shouldResume: boolean
	resumeSessionId?: string
	reason?: string
} {
	if (!state.claudeCodeSessionId) {
		return { shouldResume: false, reason: "no prior session id" }
	}
	if (state.claudeCodeCwd && !existsSync(state.claudeCodeCwd)) {
		log.info("Claude Code resume cursor stale: cwd no longer exists", {
			cwd: state.claudeCodeCwd,
		})
		return { shouldResume: false, reason: "cwd missing" }
	}
	return { shouldResume: true, resumeSessionId: state.claudeCodeSessionId }
}

/**
 * Persist the SDK session id + cwd after observing them on an SDK message.
 *
 * Wraps the write in a `Database.withEffects` so that if the caller is
 * already inside a transaction (runtime holds a transaction-like scope per
 * turn) the SSE flush happens after commit — matching the rest of Loop's
 * write patterns.
 */
export function persistResumeCursor(
	sessionId: string,
	data: {
		claudeCodeSessionId?: string | null
		claudeCodeCwd?: string | null
		claudeCodeLastTurnId?: string | null
	},
): void {
	Database.withEffects(() => {
		queries.updateSession(sessionId, data)
	})
}

/**
 * Reset the resume cursor to null. Called when the user switches to a
 * different provider mid-session (the next Claude Code turn must start
 * fresh) or after a fatal auth/spawn failure.
 */
export function clearResumeCursor(sessionId: string): void {
	persistResumeCursor(sessionId, {
		claudeCodeSessionId: null,
		claudeCodeCwd: null,
		claudeCodeLastTurnId: null,
	})
}
