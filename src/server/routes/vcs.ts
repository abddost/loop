import { Hono } from "hono"
import { vcs } from "../workspace/services/vcs"
import { requireWorkspace } from "./require-workspace"

export const vcsRoutes = new Hono()

/** GET /vcs/branch - Get current branch info for the workspace. */
vcsRoutes.get("/vcs/branch", async (c) => {
	requireWorkspace()
	const service = await vcs()
	const branch = await service.getBranch()
	return c.json(branch)
})
