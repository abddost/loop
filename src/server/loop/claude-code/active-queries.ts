import type { SdkPermissionMode } from "./prompts"

/**
 * Session-scoped registry of in-flight Claude Code SDK queries.
 *
 * Lives at module scope so non-runtime callers (e.g. the permission PATCH
 * route) can forward `setPermissionMode` calls into the active SDK query
 * without holding a reference to the runtime invocation.
 *
 * The runtime (`runtime.ts`) registers itself in step 10 and unregisters
 * in the `finally` block of step 11, so entries are bounded by the live
 * turn. Stale entries are not possible under normal teardown — but the
 * registry tolerates double-unregister and lookups for unknown sessions.
 */

interface ActiveQueryHandle {
	/** Forward a permission mode change into the running SDK query. */
	setPermissionMode(mode: SdkPermissionMode): Promise<void>
}

const active = new Map<string, ActiveQueryHandle>()

/** Register an in-flight query for `sessionId`. Overwrites any prior entry. */
export function registerActiveQuery(sessionId: string, handle: ActiveQueryHandle): void {
	active.set(sessionId, handle)
}

/** Remove the registered query for `sessionId`. Safe to call when none exists. */
export function unregisterActiveQuery(sessionId: string): void {
	active.delete(sessionId)
}

/** Look up the in-flight query handle for `sessionId`, if any. */
export function getActiveQuery(sessionId: string): ActiveQueryHandle | undefined {
	return active.get(sessionId)
}
