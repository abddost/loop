import { AppError } from "@core/error"
import { ulid } from "@core/id"
import { eq } from "drizzle-orm"
import { Hono } from "hono"
import { get as getDb } from "../db/index"
import { findProjectById, listProjects, upsertProject } from "../db/queries"
import { projectTable } from "../db/schema"
import { Workspace } from "../workspace"

export const projectRoutes = new Hono()

/** GET /projects - List all projects ordered by most recently updated. */
projectRoutes.get("/projects", (c) => {
	const projects = listProjects()
	return c.json(projects)
})

/** POST /projects - Create a new project. Body: { name, directory } */
projectRoutes.post("/projects", async (c) => {
	const body = await c.req.json<{ name: string; directory: string }>()
	if (!body.name || !body.directory) {
		return c.json({ error: "name and directory are required" }, 400)
	}
	const project = upsertProject({
		id: ulid(),
		name: body.name,
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

/** DELETE /projects/:id - Delete a project by ID. */
projectRoutes.delete("/projects/:id", (c) => {
	const id = c.req.param("id")
	const existing = findProjectById(id)
	if (!existing) {
		throw new AppError("Project not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	getDb().delete(projectTable).where(eq(projectTable.id, id)).run()
	return c.json({ ok: true })
})
