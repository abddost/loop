import { Hono } from "hono"
import { findAllSandboxesWithProject, findSessionTitlesByDirectories } from "../db/queries"
import {
	pruneWorktrees,
	removeSandboxGlobal,
	worktreeService,
} from "../workspace/services/worktree"
import { requireWorkspace } from "./require-workspace"

export const worktreeRoutes = new Hono()

// ─── Global routes (no workspace context required) ──────────
// Registered first so they match before the workspace-scoped /worktree routes.

/** GET /worktree/all - List all worktrees across all projects with session titles (for settings). */
worktreeRoutes.get("/worktree/all", (c) => {
	const sandboxes = findAllSandboxesWithProject()
	const directories = sandboxes.map((s) => s.directory)
	const sessions = findSessionTitlesByDirectories(directories)

	// Group sessions by directory
	const sessionsByDir = new Map<string, { id: string; title: string | null }[]>()
	for (const s of sessions) {
		const list = sessionsByDir.get(s.directory)
		if (list) {
			list.push({ id: s.id, title: s.title })
		} else {
			sessionsByDir.set(s.directory, [{ id: s.id, title: s.title }])
		}
	}

	// Attach sessions to each sandbox
	const enriched = sandboxes.map((sb) => ({
		...sb,
		sessions: sessionsByDir.get(sb.directory) ?? [],
	}))

	return c.json(enriched)
})

/** POST /worktree/remove-global - Remove a worktree without workspace context. */
worktreeRoutes.post("/worktree/remove-global", async (c) => {
	const body = await c.req.json<{ sandboxId: string }>()
	await removeSandboxGlobal(body.sandboxId)
	return c.json({ ok: true })
})

/** POST /worktree/prune - Manually trigger worktree pruning. */
worktreeRoutes.post("/worktree/prune", async (c) => {
	const pruned = await pruneWorktrees()
	return c.json({ pruned })
})

// ─── Workspace-scoped routes ────────────────────────────────

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
