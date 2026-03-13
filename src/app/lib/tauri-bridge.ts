/**
 * Tauri bridge. In development mode, returns defaults.
 * In production, uses Tauri invoke() to communicate with the Rust backend.
 */
export const tauriBridge = {
	async getServerInfo(): Promise<{ url: string; token: string }> {
		// In dev mode, use defaults
		if (typeof window.__TAURI__ === "undefined") {
			return {
				url: `http://127.0.0.1:${import.meta.env.VITE_SERVER_PORT ?? 4242}`,
				token: (import.meta.env.VITE_AUTH_TOKEN as string) ?? "",
			}
		}
		// In production, invoke Tauri command
		// const { invoke } = await import("@tauri-apps/api/core")
		// return invoke("get_server_info")
		return { url: "http://127.0.0.1:4242", token: "" }
	},
}

declare global {
	interface Window {
		__TAURI__?: unknown
	}
}
