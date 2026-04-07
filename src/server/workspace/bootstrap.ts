import { bridgeWorkspaceBus } from "../bus/bridge"
import { initFromConfig as initMcp } from "../mcp"
import { bus } from "./bus"
import { fileWatcher } from "./services/file-watcher"

/**
 * Bootstrap a workspace. Called on first request to a workspace directory.
 * Initializes the workspace bus, bridges it to the global bus,
 * and starts MCP server connections from config.
 *
 * @param directory - Absolute workspace path
 */
export function bootstrapWorkspace(directory: string): void {
	// Trigger bus initialization (this creates the mitt instance)
	const wsBus = bus()

	// Bridge workspace bus to global bus
	bridgeWorkspaceBus(wsBus, directory)

	// Initialize MCP servers from config (fire-and-forget)
	initMcp().catch((err) => {
		console.error("[workspace:bootstrap] MCP init failed:", err)
	})

	// Start file watcher for real-time file change notifications
	fileWatcher().catch((err) => {
		console.error("[workspace:bootstrap] File watcher init failed:", err)
	})
}
