import { relative } from "node:path"
import { Hono } from "hono"
import { PathEscapeError, resolveInWorkspace } from "../lib/filesystem"
import { Workspace } from "../workspace"
import { bus } from "../workspace/bus"
import { vcs } from "../workspace/services/vcs"
import { requireWorkspace } from "./require-workspace"

export const vcsRoutes = new Hono()

/**
 * Validate an incoming path parameter: ensure it resolves inside the workspace
 * and return it as a workspace-relative path suitable for git pathspec args.
 * This blocks path traversal (`..`, absolute paths, symlink escapes) before
 * anything reaches `git add` / `git checkout` / `Bun.file` / `unlink`.
 */
function safeRelativePath(
	inputPath: string,
): { ok: true; rel: string } | { ok: false; error: string } {
	try {
		const canonical = resolveInWorkspace(Workspace.dir(), inputPath)
		const rel = relative(Workspace.dir(), canonical)
		// Empty string means the workspace root itself — disallow for file operations.
		if (rel === "" || rel.startsWith("..")) {
			return { ok: false, error: "Path escapes workspace" }
		}
		return { ok: true, rel }
	} catch (err) {
		if (err instanceof PathEscapeError) return { ok: false, error: err.message }
		throw err
	}
}

/** GET /vcs/branch - Get current branch info for the workspace. */
vcsRoutes.get("/vcs/branch", async (c) => {
	requireWorkspace()
	const service = await vcs()
	const branch = await service.getBranch()
	return c.json(branch)
})

/** GET /vcs/branches - List all local and remote branches. */
vcsRoutes.get("/vcs/branches", async (c) => {
	requireWorkspace()
	const service = await vcs()
	const branches = await service.listBranches()
	return c.json(branches)
})

/** GET /vcs/status - Get git status (changed files) for the workspace. */
vcsRoutes.get("/vcs/status", async (c) => {
	requireWorkspace()
	const service = await vcs()
	const changes = await service.getStatus()
	return c.json(changes)
})

/** GET /vcs/diff - Get diff for a specific file. */
vcsRoutes.get("/vcs/diff", async (c) => {
	requireWorkspace()
	const path = c.req.query("path")
	if (!path) return c.json({ error: "path required" }, 400)
	const safe = safeRelativePath(path)
	if (!safe.ok) return c.json({ error: safe.error }, 400)
	const cached = c.req.query("cached") === "true"
	const service = await vcs()
	const result = await service.getDiff(safe.rel, cached)
	return c.json(result)
})

/** POST /vcs/revert - Revert a file to its last committed state. */
vcsRoutes.post("/vcs/revert", async (c) => {
	requireWorkspace()
	const { path } = await c.req.json<{ path: string }>()
	if (!path) return c.json({ error: "path required" }, 400)
	const safe = safeRelativePath(path)
	if (!safe.ok) return c.json({ error: safe.error }, 400)
	const service = await vcs()
	await service.revertFile(safe.rel)
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})

/** POST /vcs/stage - Stage a file. */
vcsRoutes.post("/vcs/stage", async (c) => {
	requireWorkspace()
	const { path } = await c.req.json<{ path: string }>()
	if (!path) return c.json({ error: "path required" }, 400)
	const safe = safeRelativePath(path)
	if (!safe.ok) return c.json({ error: safe.error }, 400)
	const service = await vcs()
	await service.stageFile(safe.rel)
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})

/** POST /vcs/unstage - Unstage a file. */
vcsRoutes.post("/vcs/unstage", async (c) => {
	requireWorkspace()
	const { path } = await c.req.json<{ path: string }>()
	if (!path) return c.json({ error: "path required" }, 400)
	const safe = safeRelativePath(path)
	if (!safe.ok) return c.json({ error: safe.error }, 400)
	const service = await vcs()
	await service.unstageFile(safe.rel)
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})

/** POST /vcs/stage-all - Stage all changes. */
vcsRoutes.post("/vcs/stage-all", async (c) => {
	requireWorkspace()
	const service = await vcs()
	await service.stageAll()
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})

/** POST /vcs/unstage-all - Unstage all changes. */
vcsRoutes.post("/vcs/unstage-all", async (c) => {
	requireWorkspace()
	const service = await vcs()
	await service.unstageAll()
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})

/** POST /vcs/commit - Commit staged changes. */
vcsRoutes.post("/vcs/commit", async (c) => {
	requireWorkspace()
	const { message } = await c.req.json<{ message: string }>()
	if (!message?.trim()) return c.json({ error: "message required" }, 400)
	const service = await vcs()
	const result = await service.commit(message.trim())
	bus().emit("vcs:changed", {})
	return c.json(result)
})

/** POST /vcs/push - Push to remote. */
vcsRoutes.post("/vcs/push", async (c) => {
	requireWorkspace()
	const body = await c.req.json<{ remote?: string; branch?: string; setUpstream?: boolean }>()
	const service = await vcs()
	await service.push(body.remote, body.branch, body.setUpstream)
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})

/** POST /vcs/switch - Switch to a branch. */
vcsRoutes.post("/vcs/switch", async (c) => {
	requireWorkspace()
	const { branch } = await c.req.json<{ branch: string }>()
	if (!branch?.trim()) return c.json({ error: "branch required" }, 400)
	const service = await vcs()
	await service.switchBranch(branch.trim())
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})

/** POST /vcs/create-branch - Create a new branch. */
vcsRoutes.post("/vcs/create-branch", async (c) => {
	requireWorkspace()
	const { name, checkout } = await c.req.json<{ name: string; checkout?: boolean }>()
	if (!name?.trim()) return c.json({ error: "name required" }, 400)
	const service = await vcs()
	await service.createBranch(name.trim(), checkout ?? true)
	bus().emit("vcs:changed", {})
	return c.json({ ok: true })
})
