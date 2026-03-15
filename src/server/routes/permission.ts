import type { PermissionReply } from "@core/schema/permission"
import { Hono } from "hono"
import * as queries from "../db/queries"
import { listPending, reply as permissionReply } from "../permission"
import { requireWorkspace } from "./require-workspace"

export const permissionRoutes = new Hono()

// ────────────────────────────────────────────────────────────
// Permission request response
// ────────────────────────────────────────────────────────────

/**
 * POST /permissions/:requestId/reply
 * Respond to a pending permission request.
 * Body: { reply: "once" | "always" | "reject", message?: string }
 */
permissionRoutes.post("/permissions/:requestId/reply", async (c) => {
	requireWorkspace()
	const requestId = c.req.param("requestId")
	const body = await c.req.json<{
		reply: PermissionReply
		message?: string
	}>()

	if (!body.reply || !["once", "always", "reject"].includes(body.reply)) {
		return c.json({ error: "reply must be 'once', 'always', or 'reject'" }, 400)
	}

	permissionReply(requestId, body.reply, body.message)
	return c.json({ ok: true, requestId, reply: body.reply })
})

/**
 * POST /permissions/:callId
 * Legacy-compatible endpoint.
 * Accepts both old format { allow: boolean, action: string }
 * and new format { reply: "once" | "always" | "reject" }
 */
permissionRoutes.post("/permissions/:callId", async (c) => {
	requireWorkspace()
	const callId = c.req.param("callId")

	const body = await c.req.json<{
		allow?: boolean
		action?: string
		reply?: PermissionReply
		message?: string
	}>()

	// Map legacy and new formats to reply type
	let replyType: PermissionReply
	if (body.reply) {
		replyType = body.reply
	} else if (body.action === "allow" || body.allow === true) {
		replyType = "once"
	} else if (body.action === "allow_always") {
		replyType = "always"
	} else if (body.action === "deny" || body.allow === false) {
		replyType = "reject"
	} else {
		return c.json({ error: "Invalid request body" }, 400)
	}

	permissionReply(callId, replyType, body.message)
	return c.json({ ok: true, callId, reply: replyType })
})

// ────────────────────────────────────────────────────────────
// Pending permissions
// ────────────────────────────────────────────────────────────

/** GET /permissions - List all pending permission requests. */
permissionRoutes.get("/permissions", (c) => {
	requireWorkspace()
	const pending = listPending()
	return c.json(pending)
})

// ────────────────────────────────────────────────────────────
// Session permission mode
// ────────────────────────────────────────────────────────────

/** PATCH /sessions/:sessionId/permission - Update session permission mode. */
permissionRoutes.patch("/sessions/:sessionId/permission", async (c) => {
	requireWorkspace()
	const sessionId = c.req.param("sessionId")
	const body = await c.req.json<{
		permissionMode: string
	}>()

	if (!["default", "full-access", "custom"].includes(body.permissionMode)) {
		return c.json({ error: "permissionMode must be 'default', 'full-access', or 'custom'" }, 400)
	}

	queries.updateSession(sessionId, { permissionMode: body.permissionMode })
	return c.json({ ok: true, sessionId, permissionMode: body.permissionMode })
})
