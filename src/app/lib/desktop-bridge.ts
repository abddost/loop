/**
 * Desktop bridge. In development mode (browser), returns defaults.
 * In Electron, reads from window.desktopBridge set by the preload script.
 */
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
		}
	}
}
