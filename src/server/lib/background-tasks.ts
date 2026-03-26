import { createLogger } from "../logger"

const log = createLogger("background-tasks")

/**
 * Tracks in-flight background tasks that must complete before shutdown.
 * Module-scoped (not workspace-scoped) since tasks like project deletion
 * survive workspace disposal.
 */
const pending = new Set<Promise<void>>()

/**
 * Enqueue an async function as a background task.
 * The task is tracked until it settles (resolve or reject).
 * Errors are logged but do not propagate.
 */
export function enqueue(fn: () => Promise<void>): void {
	const task = fn()
		.catch((err) => log.error("Background task failed", { error: err }))
		.finally(() => pending.delete(task))
	pending.add(task)
}

/**
 * Wait for all pending background tasks to settle.
 * Called during graceful shutdown to prevent data loss.
 */
export async function drainAll(): Promise<void> {
	if (pending.size === 0) return
	log.info("Draining background tasks", { count: pending.size })
	await Promise.allSettled([...pending])
}
