import { basename } from "node:path"
import { ulid } from "@core/id"
import type { Project } from "@core/schema/project"
import { createMiddleware } from "hono/factory"
import { findProjectByDirectory, upsertProject } from "../db/queries"
import { Workspace } from "../workspace"
import { bootstrapWorkspace } from "../workspace/bootstrap"

/**
 * Resolve an existing project by directory or create a new one.
 * Used by the workspace init flow to ensure a project record exists.
 */
function resolveOrCreateProject(directory: string): Project {
	const existing = findProjectByDirectory(directory)
	if (existing) return existing as Project

	const project = upsertProject({
		id: ulid(),
		name: basename(directory),
		directory,
	})
	return project as Project
}

/**
 * Workspace context middleware.
 * Extracts directory from x-workspace-directory header and runs
 * the request within the workspace's ALS context.
 * Also triggers workspace bootstrap on first init.
 */
export const workspaceMiddleware = createMiddleware(async (c, next) => {
	const dir = c.req.header("x-workspace-directory")
	if (!dir) return next()

	const isNew = !Workspace.has(dir)
	const ctx = await Workspace.init(dir, resolveOrCreateProject)

	if (isNew) {
		Workspace.run(ctx, () => bootstrapWorkspace(dir))
	}

	return Workspace.run(ctx, () => next())
})
