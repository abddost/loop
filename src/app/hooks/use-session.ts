import { useCallback, useMemo } from "react"
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
	const rawMessages = useWorkspaceState(
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

	// Filter synthetic / internal messages outside the selector to avoid
	// creating new array references on every store snapshot (which would
	// cause infinite re-renders via useSyncExternalStore's Object.is check).
	const messages = useMemo(() => {
		const msgs = rawMessages ?? EMPTY_MESSAGES
		if (msgs === EMPTY_MESSAGES) return EMPTY_MESSAGES
		const filtered = msgs.filter((m: any) => {
			// Explicit synthetic flag (tool-created messages like plan_exit)
			if (m.metadata?.synthetic) return false
			// Compaction summary (assistant message with summary: true)
			if (m.role === "assistant" && m.metadata?.summary === true) return false
			// Messages composed entirely of internal parts (compaction boundaries,
			// synthetic continuation prompts, overflow replays)
			const parts = m.parts as any[] | undefined
			if (
				parts?.length &&
				parts.every((p: any) => p.type === "compaction" || (p.type === "text" && p.synthetic))
			)
				return false
			return true
		})
		return filtered.length === msgs.length ? msgs : filtered
	}, [rawMessages])

	if (!session) return FALLBACK

	return {
		session,
		messages,
		status: status ?? "idle",
	}
}
