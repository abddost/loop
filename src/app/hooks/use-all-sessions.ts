import type { SessionStatus } from "@core/schema/session"
import { useCallback, useRef, useSyncExternalStore } from "react"
import { useProjectStore } from "../stores/project-store"
import type { Session } from "../stores/workspace-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"

const EMPTY_SESSIONS: Session[] = []

/**
 * Subscribe to sessions from ALL workspace stores so the sidebar
 * re-renders when any project's sessions change (not just the active one).
 *
 * Returns a stable (referentially equal) map of projectId → Session[]
 * that only changes when the underlying session arrays actually change.
 */
export function useAllProjectSessions(): Record<string, Session[]> {
	const projects = useProjectStore((s) => s.projects)
	const cacheRef = useRef<Record<string, Session[]>>({})

	const subscribe = useCallback(
		(cb: () => void) => {
			const unsubscribes: Array<() => void> = []
			for (const p of projects) {
				const store = workspaceStoreRegistry.get(p.directory)
				if (store) {
					unsubscribes.push(store.subscribe(cb))
				}
			}
			return () => {
				for (const unsub of unsubscribes) unsub()
			}
		},
		[projects],
	)

	const getSnapshot = useCallback(() => {
		const prev = cacheRef.current
		let changed = false

		// Check if any session array reference has changed
		for (const p of projects) {
			const store = workspaceStoreRegistry.get(p.directory)
			const sessions = store?.getState().sessions ?? EMPTY_SESSIONS
			if (prev[p.id] !== sessions) {
				changed = true
				break
			}
		}

		// Also check if projects list changed (added/removed)
		if (!changed) {
			const prevKeys = Object.keys(prev)
			if (prevKeys.length !== projects.length) {
				changed = true
			}
		}

		if (!changed) return prev

		const next: Record<string, Session[]> = {}
		for (const p of projects) {
			const store = workspaceStoreRegistry.get(p.directory)
			next[p.id] = store?.getState().sessions ?? EMPTY_SESSIONS
		}
		cacheRef.current = next
		return next
	}, [projects])

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Subscribe to session statuses from ALL workspace stores.
 * Returns a flat map of sessionId → SessionStatus for all non-idle sessions.
 */
export function useAllSessionStatuses(): Record<string, SessionStatus> {
	const projects = useProjectStore((s) => s.projects)
	const cacheRef = useRef<Record<string, SessionStatus>>({})

	const subscribe = useCallback(
		(cb: () => void) => {
			const unsubscribes: Array<() => void> = []
			for (const p of projects) {
				const store = workspaceStoreRegistry.get(p.directory)
				if (store) {
					unsubscribes.push(store.subscribe(cb))
				}
			}
			return () => {
				for (const unsub of unsubscribes) unsub()
			}
		},
		[projects],
	)

	const getSnapshot = useCallback(() => {
		const next: Record<string, SessionStatus> = {}
		let changed = false

		for (const p of projects) {
			const store = workspaceStoreRegistry.get(p.directory)
			if (!store) continue
			const statusMap = store.getState().sessionStatus
			for (const [id, status] of statusMap) {
				next[id] = status
				if (cacheRef.current[id] !== status) changed = true
			}
		}

		// Check for removed entries
		if (!changed && Object.keys(cacheRef.current).length !== Object.keys(next).length) {
			changed = true
		}

		if (!changed) return cacheRef.current
		cacheRef.current = next
		return next
	}, [projects])

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
