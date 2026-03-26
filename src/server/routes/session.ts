import { AppError } from "@core/error"
import { ulid } from "@core/id"
import { Hono } from "hono"
import { globalBus } from "../bus/global"
import {
	createSession,
	deleteSession,
	findChildSessions,
	findMessagesBySessionId,
	findSessionById,
	listArchivedSessions,
	listSessionsByDirectory,
	updateSession,
} from "../db/queries"
import { createLogger } from "../logger"
import { promptSession } from "../loop/prompt"
import { cleanupRevert, revertToMessage, unrevert } from "../loop/revert"
import { cancelSession, listSessionStatuses, setSessionStatus } from "../loop/status"
import { requireWorkspace } from "./require-workspace"

const log = createLogger("session")

export const sessionRoutes = new Hono()

/** GET /sessions - List sessions for current workspace directory, newest first. */
sessionRoutes.get("/sessions", (c) => {
	const { directory } = requireWorkspace()
	const sessions = listSessionsByDirectory(directory)
	return c.json(sessions)
})

/** POST /sessions - Create a new session in current workspace. */
sessionRoutes.post("/sessions", async (c) => {
	const { directory, projectId } = requireWorkspace()
	const body = await c.req.json<{ title?: string; permissionMode?: string }>().catch(() => ({}))
	const parsed = body as { title?: string; permissionMode?: string }
	const session = createSession({
		id: ulid(),
		projectId,
		directory,
		title: parsed.title,
		permissionMode: parsed.permissionMode,
	})
	return c.json(session, 201)
})

/** GET /sessions/status - Runtime status for all sessions in workspace (used by bootstrap). */
sessionRoutes.get("/sessions/status", (c) => {
	requireWorkspace()
	return c.json(listSessionStatuses())
})

/** GET /sessions/archived - List archived sessions with pagination. */
sessionRoutes.get("/sessions/archived", (c) => {
	const limit = Math.min(Number(c.req.query("limit")) || 20, 100)
	const offset = Math.max(Number(c.req.query("offset")) || 0, 0)
	return c.json(listArchivedSessions(limit, offset))
})

/** GET /sessions/:id - Get session with all messages and parts. */
sessionRoutes.get("/sessions/:id", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	const messages = findMessagesBySessionId(id)
	return c.json({ ...session, messages })
})

/** PATCH /sessions/:id - Update session (title, archive). Emits SSE for multi-client sync. */
sessionRoutes.patch("/sessions/:id", async (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const body = await c.req.json<{
		title?: string | null
		archivedAt?: number | null
	}>()
	updateSession(id, body)

	const updated = findSessionById(id)!
	globalBus.emit({
		type: "session:update",
		directory: updated.directory,
		sessionId: id,
		session: updated as any,
	})
	return c.json(updated)
})

/** DELETE /sessions/:id - Delete session and all messages/parts. */
sessionRoutes.delete("/sessions/:id", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	deleteSession(id)
	return c.json({ ok: true })
})

/**
 * POST /sessions/:id/prompt - Submit a prompt to a session.
 * Delegates to promptSession which handles user message creation and the agentic loop.
 * Returns 202 Accepted immediately. Results are streamed via SSE.
 */
sessionRoutes.post("/sessions/:id/prompt", async (c) => {
	requireWorkspace()
	const sessionId = c.req.param("id")
	const session = findSessionById(sessionId)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const body = await c.req.json<{
		messageId?: string
		text?: string
		files?: Array<{ path: string; mimeType: string; content: string }>
		model?: { modelId: string; providerId: string }
		agent?: string
		option?: string
	}>()

	// Fire-and-forget: promptSession creates user message + runs the agentic loop.
	// Fan-out: if a loop is already running, the caller attaches as a callback.
	promptSession(sessionId, body).catch((err) =>
		log.error("Prompt failed", { sessionId, error: err }),
	)

	return c.json({ status: "accepted", sessionId }, 202)
})

/**
 * POST /sessions/:id/cancel - Cancel a running session.
 * Aborts the running agentic loop for this session.
 */
sessionRoutes.post("/sessions/:id/cancel", (c) => {
	const sessionId = c.req.param("id")
	const session = findSessionById(sessionId)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	cancelSession(sessionId)
	setSessionStatus(sessionId, "idle")

	return c.json({ status: "cancelled", sessionId })
})

/** GET /sessions/:id/children - List child sessions (subagent sessions) for a parent. */
sessionRoutes.get("/sessions/:id/children", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	return c.json(findChildSessions(id))
})

/** GET /sessions/:id/messages - Get messages for any session (parent or child). */
sessionRoutes.get("/sessions/:id/messages", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	return c.json(findMessagesBySessionId(id))
})

/**
 * GET /sessions/:id/usage - Accumulated token usage and cost for a session.
 * Computed from StepFinishParts. Fallback for when SSE events were missed.
 */
sessionRoutes.get("/sessions/:id/usage", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	const messages = findMessagesBySessionId(id)
	let input = 0
	let output = 0
	let reasoning = 0
	let cacheRead = 0
	let cacheWrite = 0
	let cost = 0
	for (const msg of messages) {
		for (const part of msg.parts) {
			const data = part as Record<string, unknown>
			if (data.type === "step-finish") {
				const usage = data.usage as Record<string, number> | undefined
				if (usage) {
					input += usage.input ?? 0
					output += usage.output ?? 0
					reasoning += usage.reasoning ?? 0
					cacheRead += usage.cacheRead ?? 0
					cacheWrite += usage.cacheWrite ?? 0
				}
				cost += (data.cost as number) ?? 0
			}
		}
	}
	return c.json({ usage: { input, output, reasoning, cacheRead, cacheWrite }, cost })
})

/**
 * POST /sessions/:id/revert - Revert assistant file changes.
 * Body: { messageId: string, partId?: string }
 */
sessionRoutes.post("/sessions/:id/revert", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const body = await c.req.json<{ messageId: string; partId?: string }>()
	const result = await revertToMessage(id, body.messageId, body.partId)
	if (!result.success) {
		throw new AppError(result.error ?? "Revert failed", { code: "BAD_REQUEST", statusCode: 400 })
	}
	return c.json(result)
})

/** POST /sessions/:id/unrevert - Undo a revert (restore pre-revert state). */
sessionRoutes.post("/sessions/:id/unrevert", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const result = await unrevert(id)
	if (!result.success) {
		throw new AppError(result.error ?? "Unrevert failed", { code: "BAD_REQUEST", statusCode: 400 })
	}
	return c.json(result)
})

/** POST /sessions/:id/revert/cleanup - Remove messages after revert point. */
sessionRoutes.post("/sessions/:id/revert/cleanup", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const result = await cleanupRevert(id)
	if (!result.success) {
		throw new AppError(result.error ?? "Cleanup failed", { code: "BAD_REQUEST", statusCode: 400 })
	}
	return c.json(result)
})
