import { useCallback } from "react"
import { useWorkspaceState } from "./use-workspace"

/** Stable empty array to avoid new references on every snapshot call. */
const EMPTY_MESSAGES: readonly any[] = []

const FALLBACK = { session: null, messages: EMPTY_MESSAGES, status: "idle" as const }

export function useActiveSession() {
	const activeSessionId = useWorkspaceState(useCallback((s) => s.activeSessionId, []))
	const session = useWorkspaceState(
		useCallback(
			(s) => {
				if (!activeSessionId) return null
				return s.sessions.find((sess) => sess.id === activeSessionId) ?? null
			},
			[activeSessionId],
		),
	)
	const messages = useWorkspaceState(
		useCallback(
			(s) => {
				if (!activeSessionId) return EMPTY_MESSAGES
				return s.messages.get(activeSessionId) ?? EMPTY_MESSAGES
			},
			[activeSessionId],
		),
	)
	const status = useWorkspaceState(
		useCallback(
			(s) => {
				if (!activeSessionId) return "idle"
				return s.sessionStatus.get(activeSessionId) ?? "idle"
			},
			[activeSessionId],
		),
	)

	if (!session) return FALLBACK

	return {
		session,
		messages: messages ?? EMPTY_MESSAGES,
		status: status ?? "idle",
	}
}
