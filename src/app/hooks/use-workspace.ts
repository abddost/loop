import { useMemo, useSyncExternalStore } from "react"
import { useUIStore } from "../stores/ui-store"
import type { WorkspaceState } from "../stores/workspace-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"

/**
 * Track registry version so that components re-resolve the store when an entry
 * is created or evicted. Without this, `useMemo([directory])` would return a
 * cached `null` forever if the directory's store didn't yet exist when the hook
 * first ran — even after bootstrap created it later.
 */
function useRegistryVersion(): number {
	return useSyncExternalStore(
		workspaceStoreRegistry.subscribe,
		() => workspaceStoreRegistry.version,
		() => workspaceStoreRegistry.version,
	)
}

export function useWorkspace() {
	const directory = useUIStore((s) => s.activeDirectory)
	const registryVersion = useRegistryVersion()

	// biome-ignore lint/correctness/useExhaustiveDependencies: registryVersion forces re-resolution when stores are created/evicted
	const store = useMemo(() => {
		if (!directory) return null
		return workspaceStoreRegistry.get(directory) ?? null
	}, [directory, registryVersion])

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
