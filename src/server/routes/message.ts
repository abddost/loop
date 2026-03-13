import { AppError } from "@core/error"
import { Hono } from "hono"
import { findMessagesBySessionId, findSessionById } from "../db/queries"

export const messageRoutes = new Hono()

/** GET /sessions/:id/messages - List messages for a session with their parts. */
messageRoutes.get("/sessions/:id/messages", (c) => {
	const sessionId = c.req.param("id")
	const session = findSessionById(sessionId)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const messages = findMessagesBySessionId(sessionId)
	return c.json(messages)
})
