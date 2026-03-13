import { AppError } from "@core/error"
import { Workspace } from "../workspace"

/**
 * Assert that a workspace context is available (ALS is active).
 * Throws a 400 AppError if the x-workspace-directory header was not sent.
 */
export function requireWorkspace(): { directory: string; projectId: string } {
	try {
		return { directory: Workspace.dir(), projectId: Workspace.project().id }
	} catch {
		throw new AppError("No workspace context. Send x-workspace-directory header.", {
			code: "WORKSPACE_REQUIRED",
			statusCode: 400,
		})
	}
}
