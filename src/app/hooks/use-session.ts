import { useCallback, useMemo } from "react"
import { useUIStore } from "../stores/ui-store"
import { useWorkspaceState } from "./use-workspace"

/** Stable empty array to avoid new references on every snapshot call. */
const EMPTY_MESSAGES: readonly any[] = []

const FALLBACK = { session: null, messages: EMPTY_MESSAGES, status: "idle" as const }

/**
 * Returns live session state for the given session ID.
 *
 * Callers with URL param access (SessionPage) MUST pass `id ?? null` so the
 * display is always derived from the route. This avoids the stale-title and
 * "Loading session..." flash that occurs when workspace-store.activeSessionId
 * lags behind the route by a render cycle.
 *
 * Callers without URL access (TaskPanel, etc.) may omit the argument; the hook
 * then falls back to ui-store.activeSessionId, which is updated synchronously
 * before every navigation and is therefore always current.
 *
 * Draft sessions (client-generated ULIDs not yet POSTed) are NOT synthesized
 * here — that turned out to risk unstable getSnapshot via the surrounding
 * `useSyncExternalStore`. Callers that need to render before the server row
 * exists (e.g. SessionPage's welcome view) handle the draft case themselves.
 */
export function useActiveSession(explicitSessionId?: string | null) {
	const uiActiveSessionId = useUIStore((s) => s.activeSessionId)
	const sessionId = explicitSessionId !== undefined ? explicitSessionId : uiActiveSessionId

	const session = useWorkspaceState(
		useCallback(
			(s) => {
				if (!sessionId) return null
				return s.sessions.find((sess) => sess.id === sessionId) ?? null
			},
			[sessionId],
		),
	)
	const rawMessages = useWorkspaceState(
		useCallback(
			(s) => {
				if (!sessionId) return EMPTY_MESSAGES
				return s.messages.get(sessionId) ?? EMPTY_MESSAGES
			},
			[sessionId],
		),
	)
	const status = useWorkspaceState(
		useCallback(
			(s) => {
				if (!sessionId) return "idle"
				return s.sessionStatus.get(sessionId) ?? "idle"
			},
			[sessionId],
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
