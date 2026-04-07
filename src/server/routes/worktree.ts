import { Hono } from "hono"
import { worktreeService } from "../workspace/services/worktree"
import { requireWorkspace } from "./require-workspace"

export const worktreeRoutes = new Hono()

/** POST /worktree - Create a new worktree. Returns 202 (bootstrap is async). */
worktreeRoutes.post("/worktree", async (c) => {
	requireWorkspace()
	const body = await c.req.json<{ name?: string }>().catch(() => ({}))
	const service = await worktreeService()
	const sandbox = await service.create(body)
	return c.json(sandbox, 202)
})

/** GET /worktree - List all worktrees for the current project. */
worktreeRoutes.get("/worktree", async (c) => {
	requireWorkspace()
	const service = await worktreeService()
	const sandboxes = await service.list()
	return c.json(sandboxes)
})

/** POST /worktree/remove - Remove a worktree by sandbox ID. */
worktreeRoutes.post("/worktree/remove", async (c) => {
	requireWorkspace()
	const body = await c.req.json<{ sandboxId: string }>()
	const service = await worktreeService()
	await service.remove(body.sandboxId)
	return c.json({ ok: true })
})

/** POST /worktree/reset - Reset a worktree to the default branch. */
worktreeRoutes.post("/worktree/reset", async (c) => {
	requireWorkspace()
	const body = await c.req.json<{ sandboxId: string }>()
	const service = await worktreeService()
	await service.reset(body.sandboxId)
	return c.json({ ok: true })
})
