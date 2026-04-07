import type { Sandbox } from "@core/schema/sandbox"
import { apiClient } from "./api-client"

/** Worktree API client — thin wrappers around the backend endpoints. */
export const worktreeApi = {
	/** List existing worktrees (sandboxes) for the project at the given directory. */
	list(directory: string): Promise<Sandbox[]> {
		return apiClient.get<Sandbox[]>("/worktree", { directory })
	},

	/** Create a new worktree. Returns immediately; bootstrap is async (listen for SSE events). */
	create(directory: string, opts?: { name?: string }): Promise<Sandbox> {
		return apiClient.post<Sandbox>("/worktree", opts, { directory })
	},

	/** Remove a worktree by sandbox ID. */
	remove(sandboxId: string, directory: string): Promise<void> {
		return apiClient.post("/worktree/remove", { sandboxId }, { directory })
	},

	/** Reset a worktree to the default branch. */
	reset(sandboxId: string, directory: string): Promise<void> {
		return apiClient.post("/worktree/reset", { sandboxId }, { directory })
	},
}
