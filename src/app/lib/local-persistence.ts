/**
 * localStorage persistence for last-used project/session.
 * Reads are wrapped in try/catch for graceful degradation
 * (private browsing, storage disabled, etc.).
 */

const KEYS = {
	lastProjectId: "loop:lastProjectId",
	lastSessionId: "loop:lastSessionId",
	lastDirectory: "loop:lastDirectory",
} as const

function get(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function set(key: string, value: string | null): void {
	try {
		if (value === null) {
			localStorage.removeItem(key)
		} else {
			localStorage.setItem(key, value)
		}
	} catch {
		// Storage unavailable — silently ignore
	}
}

export function getLastProjectId(): string | null {
	return get(KEYS.lastProjectId)
}

export function setLastProjectId(id: string | null): void {
	set(KEYS.lastProjectId, id)
}

export function getLastSessionId(): string | null {
	return get(KEYS.lastSessionId)
}

export function setLastSessionId(id: string | null): void {
	set(KEYS.lastSessionId, id)
}

export function getLastDirectory(): string | null {
	return get(KEYS.lastDirectory)
}

export function setLastDirectory(dir: string | null): void {
	set(KEYS.lastDirectory, dir)
}
