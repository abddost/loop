import { useMemo, useSyncExternalStore } from "react"
import { useUIStore } from "../stores/ui-store"
import type { WorkspaceState } from "../stores/workspace-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"

export function useWorkspace() {
	const directory = useUIStore((s) => s.activeDirectory)

	const store = useMemo(() => {
		if (!directory) return null
		return workspaceStoreRegistry.get(directory) ?? null
	}, [directory])

	return { directory, store }
}

/**
 * Subscribe to a slice of workspace state with proper reactivity.
 * Uses useSyncExternalStore under the hood so components re-render
 * whenever the selected slice changes.
 */
export function useWorkspaceState<T>(selector: (state: WorkspaceState) => T): T | undefined {
	const { store } = useWorkspace()

	const subscribe = useMemo(() => {
		if (!store) return (_cb: () => void) => () => {}
		return (cb: () => void) => store.subscribe(cb)
	}, [store])

	const getSnapshot = useMemo(() => {
		if (!store) return () => undefined as T | undefined
		return () => selector(store.getState())
	}, [store, selector])

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
