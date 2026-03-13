import { Workspace } from "../workspace"

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

/** Update the status of a session and emit the change via bus. */
export function updateSessionStatus(sessionId: string, status: SessionState["status"]): void {
	const states = sessionStates()
	const state = states[sessionId]
	if (state) state.status = status
}

/** Get the current status of a session. Defaults to "idle" if unknown. */
export function getSessionStatus(sessionId: string): SessionState["status"] {
	return sessionStates()[sessionId]?.status ?? "idle"
}
