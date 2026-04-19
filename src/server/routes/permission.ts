import type { PermissionReply } from "@core/schema/permission"
import { Hono } from "hono"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { getActiveQuery } from "../loop/claude-code/active-queries"
import { isPlanApprovalRequest, replyPlanApproval } from "../loop/claude-code/plan-approval"
import { resolveSdkPermissionMode } from "../loop/claude-code/prompts"
import { listPending, reply as permissionReply } from "../permission"
import { bus } from "../workspace/bus"
import { requireWorkspace } from "./require-workspace"

const log = createLogger("permission-route")

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

	// Route plan approval replies to the dedicated handler.
	if (isPlanApprovalRequest(requestId)) {
		replyPlanApproval(requestId, body.reply, body.message)
	} else {
		permissionReply(requestId, body.reply, body.message)
	}
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

	if (isPlanApprovalRequest(callId)) {
		replyPlanApproval(callId, replyType, body.message)
	} else {
		permissionReply(callId, replyType, body.message)
	}
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

	if (
		!["default", "auto-accept-edits", "full-access", "plan", "custom"].includes(body.permissionMode)
	) {
		return c.json(
			{
				error:
					"permissionMode must be 'default', 'auto-accept-edits', 'full-access', 'plan', or 'custom'",
			},
			400,
		)
	}

	queries.updateSession(sessionId, { permissionMode: body.permissionMode })

	// Forward the change into an in-flight Claude Code SDK turn so the
	// running agent picks up the new mode mid-conversation. Best-effort:
	// failures here are logged but do not fail the HTTP request — the
	// next turn will still see the persisted mode.
	const activeQuery = getActiveQuery(sessionId)
	if (activeQuery) {
		try {
			await activeQuery.setPermissionMode(resolveSdkPermissionMode(body.permissionMode))
		} catch (err) {
			log.warn("Failed to forward permission mode to active SDK query", {
				sessionId,
				mode: body.permissionMode,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	// Broadcast the change so all connected clients (and the active session
	// hook) re-render the selector. Without this, only the originating tab
	// sees the new mode after a reload.
	bus().emit("session:update", {
		sessionId,
		session: queries.findSessionById(sessionId),
	})

	return c.json({ ok: true, sessionId, permissionMode: body.permissionMode })
})
