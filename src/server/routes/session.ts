import { AppError } from "@core/error"
import { ulid } from "@core/id"
import { Hono } from "hono"
import {
	createSession,
	deleteSession,
	findMessagesBySessionId,
	findSessionById,
	listSessionsByDirectory,
	updateSession,
} from "../db/queries"
import { createLogger } from "../logger"
import { promptSession } from "../loop/prompt"
import { sessionStates } from "../loop/status"
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

/** PATCH /sessions/:id - Update session (title, archive). */
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

	const updated = findSessionById(id)
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

	const states = sessionStates()
	const state = states[sessionId]
	if (state && state.status !== "idle") {
		state.abort.abort()
	}

	return c.json({ status: "cancelled", sessionId })
})
