/**
 * localStorage persistence for last-used project/session.
 * Reads are wrapped in try/catch for graceful degradation
 * (private browsing, storage disabled, etc.).
 */

const KEYS = {
	lastProjectId: "loop:lastProjectId",
	lastSessionId: "loop:lastSessionId",
	lastDirectory: "loop:lastDirectory",
	projectsCollapsed: "loop:projectsCollapsed",
	terminalPanelClosed: "loop:terminalPanelClosed",
	pinnedSessions: "loop:pinnedSessions",
	glassDisabled: "loop:glassDisabled",
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

export function getProjectsCollapsed(): boolean {
	return get(KEYS.projectsCollapsed) === "true"
}

export function setProjectsCollapsed(collapsed: boolean): void {
	set(KEYS.projectsCollapsed, collapsed ? "true" : null)
}

export function getTerminalPanelClosed(): boolean {
	return get(KEYS.terminalPanelClosed) === "true"
}

export function setTerminalPanelClosed(closed: boolean): void {
	set(KEYS.terminalPanelClosed, closed ? "true" : null)
}

export function getPinnedSessionIds(): string[] {
	const raw = get(KEYS.pinnedSessions)
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw)
		return Array.isArray(parsed) ? parsed : []
	} catch {
		return []
	}
}

export function setPinnedSessionIds(ids: string[]): void {
	set(KEYS.pinnedSessions, ids.length > 0 ? JSON.stringify(ids) : null)
}

export function getGlassDisabled(): boolean {
	return get(KEYS.glassDisabled) === "true"
}

export function setGlassDisabled(disabled: boolean): void {
	set(KEYS.glassDisabled, disabled ? "true" : null)
}
