import { bridgeWorkspaceBus } from "../bus/bridge"
import { bus } from "./bus"

/**
 * Bootstrap a workspace. Called on first request to a workspace directory.
 * Initializes the workspace bus and bridges it to the global bus.
 * Services (LSP, VCS, file watcher) are lazy — initialized on first use.
 *
 * @param directory - Absolute workspace path
 */
export function bootstrapWorkspace(directory: string): void {
	// Trigger bus initialization (this creates the mitt instance)
	const wsBus = bus()

	// Bridge workspace bus to global bus
	bridgeWorkspaceBus(wsBus, directory)

	// Services are lazy-initialized — no need to start them here
	// LSP, VCS, FileWatcher, Snapshot will init on first access via Workspace.lazy()
}
