import { basename } from "node:path"
import { AppError } from "@core/error"
import { ulid } from "@core/id"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { globalBus } from "../bus/global"
import { get as getDb } from "../db/index"
import {
	deleteProjectCascade,
	findProjectById,
	listProjects,
	listSessionsByProjectId,
	upsertProject,
} from "../db/queries"
import { projectTable } from "../db/schema"
import { enqueue } from "../lib/background-tasks"
import { createLogger } from "../logger"
import { cancelSession } from "../loop/status"
import { Workspace } from "../workspace"

const log = createLogger("project")

export const projectRoutes = new Hono()

/** GET /projects - List all projects ordered by most recently updated. */
projectRoutes.get("/projects", (c) => {
	const projects = listProjects()
	return c.json(projects)
})

/** POST /projects - Create a new project. Body: { directory, name? } */
projectRoutes.post("/projects", async (c) => {
	const body = await c.req.json<{ name?: string; directory: string }>()
	if (!body.directory) {
		return c.json({ error: "directory is required" }, 400)
	}
	const project = upsertProject({
		id: ulid(),
		name: body.name || basename(body.directory),
		directory: body.directory,
	})
	return c.json(project, 201)
})

/**
 * GET /project/current - Resolve current project for workspace.
 * Workspace-scoped: requires x-workspace-directory header.
 * Returns the project associated with the current workspace context.
 */
projectRoutes.get("/project/current", (c) => {
	try {
		const project = Workspace.project()
		return c.json(project)
	} catch {
		return c.json({ error: "No workspace context. Send x-workspace-directory header." }, 400)
	}
})

/** PATCH /projects/:id - Update a project. Body: partial { name, worktree, vcs } */
projectRoutes.patch("/projects/:id", async (c) => {
	const id = c.req.param("id")
	const existing = findProjectById(id)
	if (!existing) {
		throw new AppError("Project not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const body = await c.req.json<{ name?: string; worktree?: string; vcs?: string }>()
	getDb()
		.update(projectTable)
		.set({ ...body, updatedAt: Date.now() })
		.where(eq(projectTable.id, id))
		.run()

	const updated = findProjectById(id)
	return c.json(updated)
})

/**
 * DELETE /projects/:id - Delete a project and cascade all sessions/messages/parts.
 * Returns 202 immediately; deletion runs in the background.
 * Pending deletions block graceful shutdown.
 */
projectRoutes.delete("/projects/:id", (c) => {
	const id = c.req.param("id")
	const existing = findProjectById(id)
	if (!existing) {
		throw new AppError("Project not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const directory = existing.directory

	enqueue(async () => {
		// Cancel any running sessions before disposing the workspace
		try {
			const sessions = listSessionsByProjectId(id)
			const ctx = Workspace.get(directory)
			if (ctx) {
				await Workspace.run(ctx, () => {
					for (const s of sessions) {
						cancelSession(s.id)
					}
				})
				await Workspace.dispose(directory)
			}
		} catch (err) {
			log.warn("Error disposing workspace during project delete", { projectId: id, error: err })
		}

		deleteProjectCascade(id)
		globalBus.emit({ type: "project:delete", projectId: id })
		log.info("Project deleted", { projectId: id, directory })
	})

	return c.json({ ok: true }, 202)
})
