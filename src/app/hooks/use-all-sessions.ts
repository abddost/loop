import type { SessionStatus } from "@core/schema/session"
import { useCallback, useRef, useSyncExternalStore } from "react"
import { useProjectStore } from "../stores/project-store"
import type { Session } from "../stores/workspace-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"
import { useWorktreeStore } from "../stores/worktree-store"

const EMPTY_SESSIONS: Session[] = []

/**
 * Track registry version so subscriptions re-bind when stores are created/evicted.
 */
function useRegistryVersion(): number {
	return useSyncExternalStore(
		workspaceStoreRegistry.subscribe,
		() => workspaceStoreRegistry.version,
		() => workspaceStoreRegistry.version,
	)
}

/**
 * Collect all relevant directories: project directories + worktree directories.
 * Used to subscribe to and read from workspace stores for both main and worktree workspaces.
 */
function getProjectDirectories(
	projects: { id: string; directory: string }[],
	worktrees: Map<string, { parentDirectory: string; directory: string }>,
): Map<string, string[]> {
	const result = new Map<string, string[]>()
	for (const p of projects) {
		const dirs = [p.directory]
		for (const wt of worktrees.values()) {
			if (wt.parentDirectory === p.directory) {
				dirs.push(wt.directory)
			}
		}
		result.set(p.id, dirs)
	}
	return result
}

/**
 * Subscribe to sessions from ALL workspace stores so the sidebar
 * re-renders when any project's sessions change (not just the active one).
 *
 * Includes sessions from worktree workspace stores, merged with main sessions.
 * Returns a stable (referentially equal) map of projectId → Session[]
 * that only changes when the underlying session arrays actually change.
 */
export function useAllProjectSessions(): Record<string, Session[]> {
	const projects = useProjectStore((s) => s.projects)
	const registryVersion = useRegistryVersion()
	const allWorktrees = useWorktreeStore((s) => s.worktrees)
	const cacheRef = useRef<Record<string, Session[]>>({})
	const sourceRef = useRef(new Map<string, Session[]>())

	// biome-ignore lint/correctness/useExhaustiveDependencies: registryVersion forces re-subscription when stores are created/evicted
	const subscribe = useCallback(
		(cb: () => void) => {
			const unsubscribes: Array<() => void> = []
			unsubscribes.push(workspaceStoreRegistry.subscribe(cb))

			const dirMap = getProjectDirectories(projects, allWorktrees)
			for (const dirs of dirMap.values()) {
				for (const dir of dirs) {
					const store = workspaceStoreRegistry.get(dir)
					if (store) unsubscribes.push(store.subscribe(cb))
				}
			}

			return () => {
				for (const unsub of unsubscribes) unsub()
			}
		},
		[projects, registryVersion, allWorktrees],
	)

	// biome-ignore lint/correctness/useExhaustiveDependencies: registryVersion ensures snapshot reads from newly-created stores
	const getSnapshot = useCallback(() => {
		const prev = cacheRef.current
		const prevSources = sourceRef.current
		let changed = false

		const dirMap = getProjectDirectories(projects, allWorktrees)

		// Check if any source array reference changed
		for (const dirs of dirMap.values()) {
			for (const dir of dirs) {
				const store = workspaceStoreRegistry.get(dir)
				const sessions = store?.getState().sessions ?? EMPTY_SESSIONS
				if (prevSources.get(dir) !== sessions) {
					changed = true
					break
				}
			}
			if (changed) break
		}

		if (!changed && Object.keys(prev).length !== projects.length) {
			changed = true
		}

		if (!changed) return prev

		// Rebuild merged result
		const next: Record<string, Session[]> = {}
		const newSources = new Map<string, Session[]>()

		for (const p of projects) {
			const dirs = dirMap.get(p.id) ?? [p.directory]
			const mainStore = workspaceStoreRegistry.get(p.directory)
			const mainSessions = mainStore?.getState().sessions ?? EMPTY_SESSIONS
			newSources.set(p.directory, mainSessions)

			// Collect sessions from worktree stores
			const extraSessions: Session[] = []
			for (let i = 1; i < dirs.length; i++) {
				const wtStore = workspaceStoreRegistry.get(dirs[i])
				const wtSessions = wtStore?.getState().sessions ?? EMPTY_SESSIONS
				newSources.set(dirs[i], wtSessions)
				for (const s of wtSessions) extraSessions.push(s)
			}

			next[p.id] =
				extraSessions.length > 0
					? [...mainSessions, ...extraSessions].sort((a, b) => b.updatedAt - a.updatedAt)
					: mainSessions
		}

		sourceRef.current = newSources
		cacheRef.current = next
		return next
	}, [projects, registryVersion, allWorktrees])

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Subscribe to session statuses from ALL workspace stores (including worktrees).
 * Returns a flat map of sessionId → SessionStatus for all non-idle sessions.
 */
export function useAllSessionStatuses(): Record<string, SessionStatus> {
	const projects = useProjectStore((s) => s.projects)
	const registryVersion = useRegistryVersion()
	const allWorktrees = useWorktreeStore((s) => s.worktrees)
	const cacheRef = useRef<Record<string, SessionStatus>>({})

	// biome-ignore lint/correctness/useExhaustiveDependencies: registryVersion forces re-subscription when stores are created/evicted
	const subscribe = useCallback(
		(cb: () => void) => {
			const unsubscribes: Array<() => void> = []
			unsubscribes.push(workspaceStoreRegistry.subscribe(cb))

			const dirMap = getProjectDirectories(projects, allWorktrees)
			for (const dirs of dirMap.values()) {
				for (const dir of dirs) {
					const store = workspaceStoreRegistry.get(dir)
					if (store) unsubscribes.push(store.subscribe(cb))
				}
			}

			return () => {
				for (const unsub of unsubscribes) unsub()
			}
		},
		[projects, registryVersion, allWorktrees],
	)

	// biome-ignore lint/correctness/useExhaustiveDependencies: registryVersion ensures snapshot reads from newly-created stores
	const getSnapshot = useCallback(() => {
		const next: Record<string, SessionStatus> = {}
		let changed = false

		const dirMap = getProjectDirectories(projects, allWorktrees)
		for (const dirs of dirMap.values()) {
			for (const dir of dirs) {
				const store = workspaceStoreRegistry.get(dir)
				if (!store) continue
				const statusMap = store.getState().sessionStatus
				for (const [id, status] of statusMap) {
					next[id] = status
					if (cacheRef.current[id] !== status) changed = true
				}
			}
		}

		// Check for removed entries
		if (!changed && Object.keys(cacheRef.current).length !== Object.keys(next).length) {
			changed = true
		}

		if (!changed) return cacheRef.current
		cacheRef.current = next
		return next
	}, [projects, registryVersion, allWorktrees])

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
