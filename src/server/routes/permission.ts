import { Hono } from "hono"
import { pendingPermissions } from "../tool/permission"
import { requireWorkspace } from "./require-workspace"

export const permissionRoutes = new Hono()

/** GET /permissions - Get current workspace permission ruleset. */
permissionRoutes.get("/permissions", (c) => {
	requireWorkspace()
	// TODO: resolve permissions from session state or workspace config
	return c.json({
		mode: "default",
		rules: [],
	})
})

/**
 * POST /permissions/:callId - Resolve a pending permission request.
 * Body: { allow: boolean, remember?: boolean, prefix?: string }
 */
permissionRoutes.post("/permissions/:callId", async (c) => {
	requireWorkspace()
	const callId = c.req.param("callId")
	const body = await c.req.json<{
		allow: boolean
		remember?: boolean
		prefix?: string
	}>()

	if (typeof body.allow !== "boolean") {
		return c.json({ error: "allow (boolean) is required" }, 400)
	}

	// Resolve the pending permission Deferred to unblock the agentic loop
	const permissions = pendingPermissions()
	const deferred = permissions.get(callId)
	if (!deferred) {
		return c.json({ error: "No pending permission for this callId" }, 404)
	}

	deferred.resolve(body.allow)
	permissions.delete(callId)

	return c.json({ ok: true, callId, allow: body.allow })
})
