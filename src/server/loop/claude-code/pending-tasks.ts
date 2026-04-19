/**
 * Per-session registry of background subagent task IDs that are currently
 * in flight. Used as a lightweight side-channel into the adapter's task
 * tracking — useful for future UI aggregates and server-side diagnostics
 * without snooping the SDK event stream.
 *
 * Previously this module also drove a polling-based auto-follow-up when
 * task notifications were dropped by the closing query. That mechanism
 * is obsolete now that the session runtime keeps ONE query alive across
 * turns (see `session-runtime.ts`), so notifications arrive naturally.
 */

export interface PendingTask {
	taskId: string
	outputFile?: string
	description?: string
}

interface SessionPending {
	tasks: Map<string, PendingTask>
}

const registry = new Map<string, SessionPending>()

function getOrCreate(sessionId: string): SessionPending {
	let entry = registry.get(sessionId)
	if (!entry) {
		entry = { tasks: new Map() }
		registry.set(sessionId, entry)
	}
	return entry
}

export function markTaskStarted(sessionId: string, info: PendingTask): void {
	const entry = getOrCreate(sessionId)
	const existing = entry.tasks.get(info.taskId)
	// Merge so a later async_launched tool_result can backfill outputFile
	// even if task_started arrived first.
	entry.tasks.set(info.taskId, {
		taskId: info.taskId,
		outputFile: info.outputFile ?? existing?.outputFile,
		description: info.description ?? existing?.description,
	})
}

export function markTaskFinished(sessionId: string, taskId: string): void {
	const entry = registry.get(sessionId)
	if (!entry) return
	entry.tasks.delete(taskId)
}

export function hasPendingTasks(sessionId: string): boolean {
	const entry = registry.get(sessionId)
	return !!entry && entry.tasks.size > 0
}

export function getPendingTasks(sessionId: string): PendingTask[] {
	const entry = registry.get(sessionId)
	return entry ? Array.from(entry.tasks.values()) : []
}

/** Forget everything about this session (on session close / error). */
export function clearSession(sessionId: string): void {
	registry.delete(sessionId)
}
