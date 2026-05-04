/**
 * Desktop bridge. In development mode (browser), returns defaults.
 * In Electron, reads from window.desktopBridge set by the preload script.
 */

export interface PopoutContext {
	sessionId: string
	directory: string
	title: string
	type?: "session" | "file-panel"
}

export type DesktopUpdateStatus =
	| "disabled"
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "downloaded"
	| "error"

export interface DesktopUpdateState {
	enabled: boolean
	status: DesktopUpdateStatus
	currentVersion: string
	availableVersion: string | null
	downloadedVersion: string | null
	downloadPercent: number | null
	checkedAt: string | null
	message: string | null
	errorContext: "check" | "download" | "install" | null
	canRetry: boolean
}

export interface DesktopUpdateActionResult {
	ok: boolean
	message?: string
}

export const desktopBridge = {
	async getServerInfo(): Promise<{ url: string; token: string }> {
		// Electron: preload exposes window.desktopBridge
		if (window.desktopBridge) {
			return window.desktopBridge.getServerInfo()
		}
		// Browser dev mode: use Vite env or defaults
		return {
			url: `http://127.0.0.1:${import.meta.env.VITE_SERVER_PORT ?? 4242}`,
			token: (import.meta.env.VITE_AUTH_TOKEN as string) ?? "",
		}
	},

	/** Open a session in a popout window. Returns false if already open (focused instead). */
	async popoutSession(sessionId: string, directory: string, title: string): Promise<boolean> {
		if (window.desktopBridge?.popoutSession) {
			return window.desktopBridge.popoutSession(sessionId, directory, title)
		}
		return false
	},

	/** Open the file panel in a popout window. */
	async popoutFilePanel(directory: string, title: string): Promise<boolean> {
		if (window.desktopBridge?.popoutFilePanel) {
			return window.desktopBridge.popoutFilePanel(directory, title)
		}
		return false
	},

	/** Move session back to main window and close this popout. */
	async returnToMain(sessionId: string, directory: string): Promise<boolean> {
		if (window.desktopBridge?.returnToMain) {
			return window.desktopBridge.returnToMain(sessionId, directory)
		}
		return false
	},

	/** Close the current popout window. */
	async closePopout(): Promise<void> {
		if (window.desktopBridge?.closePopout) {
			return window.desktopBridge.closePopout()
		}
	},

	/** Whether this renderer is a popout window. */
	isPopout(): boolean {
		return window.desktopBridge?.isPopout?.() ?? false
	},

	/** Get the popout context (sessionId, directory, title). Null in main window. */
	getPopoutContext(): PopoutContext | null {
		return window.desktopBridge?.getPopoutContext?.() ?? null
	},

	// ── Auto-update ──────────────────────────────────────────────────────
	/** Snapshot of the current update state. Returns null in browser dev. */
	async getUpdateState(): Promise<DesktopUpdateState | null> {
		return (await window.desktopBridge?.getUpdateState?.()) ?? null
	},

	/** Begin downloading the available update. */
	async downloadUpdate(): Promise<DesktopUpdateActionResult> {
		return (
			(await window.desktopBridge?.downloadUpdate?.()) ?? {
				ok: false,
				message: "Auto-update unavailable in this build",
			}
		)
	},

	/** Quit and install the downloaded update. */
	async installUpdate(): Promise<DesktopUpdateActionResult> {
		return (
			(await window.desktopBridge?.installUpdate?.()) ?? {
				ok: false,
				message: "Auto-update unavailable in this build",
			}
		)
	},

	/** Subscribe to update state changes. Returns an unsubscribe function. */
	onUpdateState(listener: (state: DesktopUpdateState) => void): () => void {
		return window.desktopBridge?.onUpdateState?.(listener) ?? (() => {})
	},
}

declare global {
	interface Window {
		desktopBridge?: {
			getServerInfo(): { url: string; token: string }
			pickFolder(): Promise<string | null>
			confirm(message: string): Promise<boolean>
			setTheme(theme: "light" | "dark" | "system"): Promise<void>
			openExternal(url: string): Promise<boolean>
			onMenuAction(listener: (action: string) => void): () => void

			// Auto-update
			getUpdateState(): Promise<DesktopUpdateState>
			downloadUpdate(): Promise<DesktopUpdateActionResult>
			installUpdate(): Promise<DesktopUpdateActionResult>
			onUpdateState(listener: (state: DesktopUpdateState) => void): () => void

			// Popout windows
			popoutSession(sessionId: string, directory: string, title: string): Promise<boolean>
			popoutFilePanel(directory: string, title: string): Promise<boolean>
			returnToMain(sessionId: string, directory: string): Promise<boolean>
			closePopout(): Promise<void>
			isPopout(): boolean
			getPopoutContext(): PopoutContext | null
			onNavigateToSession(listener: (sessionId: string, directory: string) => void): () => void
		}
	}
}
