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
