import type { Project } from "@core/schema/project"
import { StateContainer } from "./state"

/**
 * Internal workspace context. Consumer code never passes this around —
 * it's accessed via Workspace.current() from ALS.
 */
export interface WorkspaceContext {
	readonly directory: string
	readonly project: Project
	/** @internal State container for Workspace.state() and Workspace.lazy() */
	readonly _store: StateContainer
	/** Dispose all state in this workspace */
	dispose(): Promise<void>
}

/** Create a new workspace context for the given directory and project. */
export function createWorkspaceContext(directory: string, project: Project): WorkspaceContext {
	const store = new StateContainer()
	return {
		directory,
		project,
		_store: store,
		dispose: () => store.disposeAll(),
	}
}
