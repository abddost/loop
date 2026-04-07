/**
 * Worktree readiness state machine.
 *
 * Tracks pending → ready / failed transitions for worktree directories.
 * Uses deferred promises so multiple callers can await the same worktree.
 * This is a standalone module (not Zustand) because Promises can't be immer-managed.
 */

export type WorktreeStatus = "pending" | "ready" | "failed"

interface Entry {
	status: WorktreeStatus
	error?: string
	resolve: (status: WorktreeStatus) => void
	promise: Promise<WorktreeStatus>
}

/** Normalize directory path for consistent map lookups. */
function normalize(dir: string): string {
	return dir.replace(/\/+$/, "")
}

const state = new Map<string, Entry>()

function createEntry(status: WorktreeStatus): Entry {
	let resolve!: (status: WorktreeStatus) => void
	const promise = new Promise<WorktreeStatus>((r) => {
		resolve = r
	})
	return { status, resolve, promise }
}

export const worktreeState = {
	/** Get the current state for a directory. */
	get(directory: string): Entry | undefined {
		return state.get(normalize(directory))
	},

	/** Mark a directory as pending. Idempotent — won't overwrite terminal states. */
	pending(directory: string): void {
		const key = normalize(directory)
		const existing = state.get(key)
		if (existing && existing.status !== "pending") return // Already resolved
		if (!existing) {
			state.set(key, createEntry("pending"))
		}
	},

	/** Mark a directory as ready. Resolves all waiters. */
	ready(directory: string): void {
		const key = normalize(directory)
		const existing = state.get(key)
		if (!existing) return
		if (existing.status !== "pending") return
		existing.status = "ready"
		existing.resolve("ready")
	},

	/** Mark a directory as failed. Resolves all waiters with the error. */
	failed(directory: string, error?: string): void {
		const key = normalize(directory)
		const existing = state.get(key)
		if (!existing) return
		if (existing.status !== "pending") return
		existing.status = "failed"
		existing.error = error
		existing.resolve("failed")
	},

	/**
	 * Wait for a directory to become ready or failed.
	 * Returns immediately if already resolved.
	 * Multiple callers share the same Promise.
	 */
	wait(directory: string): Promise<WorktreeStatus> {
		const key = normalize(directory)
		const existing = state.get(key)
		if (!existing) return Promise.resolve("ready") // Not tracked = assume ready
		if (existing.status !== "pending") return Promise.resolve(existing.status)
		return existing.promise
	},

	/** Remove a directory entry (cleanup). */
	remove(directory: string): void {
		state.delete(normalize(directory))
	},

	/** Clear all state (used on disconnect/reconnect). */
	clear(): void {
		state.clear()
	},
}
