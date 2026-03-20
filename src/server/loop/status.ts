import { Workspace } from "../workspace"
import { bus } from "../workspace/bus"

export interface SessionState {
	abort: AbortController
	status: "idle" | "busy" | "retry" | "awaiting-permission" | "awaiting-question"
	callbacks: Array<{ resolve: () => void; reject: (err: Error) => void }>
}

/**
 * Per-workspace session states. Maps sessionId to SessionState.
 * Automatically disposes (aborts all, rejects all callbacks) when workspace closes.
 */
export const sessionStates = Workspace.state(
	() => ({}) as Record<string, SessionState>,
	async (states) => {
		for (const state of Object.values(states)) {
			state.abort.abort(new Error("workspace disposed"))
			for (const cb of state.callbacks) cb.reject(new Error("workspace disposed"))
		}
	},
)

/**
 * Update the status of a session and emit the change via bus.
 * This is the SINGLE source of truth for status changes — following OpenCode's
 * SessionStatus.set() pattern where state update + bus event are atomic.
 * NEVER update state.status directly without going through this function.
 */
export function setSessionStatus(sessionId: string, status: SessionState["status"]): void {
	const states = sessionStates()
	const state = states[sessionId]
	if (state) state.status = status
	bus().emit("session:status", { sessionId, status })
}

/** Get the current status of a session. Defaults to "idle" if unknown. */
export function getSessionStatus(sessionId: string): SessionState["status"] {
	return sessionStates()[sessionId]?.status ?? "idle"
}

/** Get status for all active (non-idle) sessions in the current workspace. */
export function listSessionStatuses(): Record<string, SessionState["status"]> {
	const states = sessionStates()
	const result: Record<string, SessionState["status"]> = {}
	for (const [id, state] of Object.entries(states)) {
		if (state.status !== "idle") {
			result[id] = state.status
		}
	}
	return result
}
