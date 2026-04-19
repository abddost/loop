import { createLogger } from "../../logger"

/**
 * Module-level registry of active Claude Code subprocess PIDs.
 *
 * The SDK does not expose its child process PID directly — runtime.ts is
 * responsible for snooping the `cli.js` PID via `ps` on startup, and
 * registering it here. On app quit (Electron `will-quit`) the main process
 * calls `killAll()` to avoid orphaning CLI processes that outlive the GUI.
 *
 * Tracking is intentionally best-effort: if we can't capture a PID we log
 * and move on. The SDK's own `interrupt()` is always tried first on an
 * abort — this tracker is a belt-and-suspenders for the "user force-quit
 * the app during a long-running tool" case.
 */

const log = createLogger("claude-code-subprocess")

interface TrackedProcess {
	pid: number
	sessionId: string
	startedAt: number
}

const tracked = new Map<number, TrackedProcess>()

/** Register a subprocess so cleanup finds it later. */
export function track(pid: number, sessionId: string): void {
	if (!pid || pid <= 0) return
	tracked.set(pid, { pid, sessionId, startedAt: Date.now() })
	log.debug("Tracking Claude Code subprocess", { pid, sessionId })
}

/** Remove a subprocess from tracking — called when it exits cleanly. */
export function untrack(pid: number): void {
	if (!pid) return
	tracked.delete(pid)
}

/** Stop tracking every process associated with a given session. */
export function untrackSession(sessionId: string): void {
	for (const [pid, entry] of tracked) {
		if (entry.sessionId === sessionId) tracked.delete(pid)
	}
}

/**
 * Send `SIGTERM` then `SIGKILL` to a single tracked PID. Safe to call
 * multiple times — non-existent PIDs simply throw `ESRCH` which we swallow.
 */
export function killOne(pid: number, { delayMs = 5000 } = {}): void {
	try {
		process.kill(pid, "SIGTERM")
	} catch (err) {
		// ESRCH → process already gone. Anything else is worth logging
		// but not fatal.
		const code = (err as NodeJS.ErrnoException).code
		if (code !== "ESRCH") log.warn("SIGTERM failed", { pid, code })
		tracked.delete(pid)
		return
	}

	// Escalate if the process is still alive after `delayMs`.
	setTimeout(() => {
		try {
			process.kill(pid, "SIGKILL")
		} catch {
			// Already gone — ignore.
		}
		tracked.delete(pid)
	}, delayMs).unref?.()
}

/**
 * Kill every tracked subprocess. Called from Electron's `will-quit`
 * handler so a forced app shutdown does not leak `claude` processes.
 */
export function killAll(): void {
	if (tracked.size === 0) return
	log.info("Killing tracked Claude Code subprocesses", { count: tracked.size })
	for (const { pid } of tracked.values()) {
		try {
			process.kill(pid, "SIGTERM")
		} catch {
			// ignore
		}
	}
	tracked.clear()
}

/** Inspect the live tracking map (tests only). */
export function listTracked(): ReadonlyArray<TrackedProcess> {
	return Array.from(tracked.values())
}
