import { Hono } from "hono"
import { pendingQuestions } from "../loop/question"
import { RejectedError } from "../permission/types"
import { requireWorkspace } from "./require-workspace"

export const questionRoutes = new Hono()

/** GET /questions - List pending questions for current workspace. */
questionRoutes.get("/questions", (c) => {
	requireWorkspace()
	const questions = pendingQuestions()
	return c.json([...questions.keys()])
})

/**
 * POST /questions/:id - Answer a pending question.
 * Body: { answers: string[] } — one answer string per question in the batch.
 * Legacy: { answer: string } — single answer (plan tools, backward compat).
 */
questionRoutes.post("/questions/:id", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const body = await c.req.json<{ answers?: string[]; answer?: string }>()

	// Support both new batch format and legacy single-answer format
	const answers = body.answers ?? (body.answer ? [body.answer] : undefined)
	if (!answers || answers.length === 0) {
		return c.json({ error: "answers (array) or answer (string) is required" }, 400)
	}

	const questions = pendingQuestions()
	const deferred = questions.get(id)
	if (!deferred) {
		return c.json({ error: "No pending question for this ID" }, 404)
	}

	deferred.resolve(answers)
	questions.delete(id)

	return c.json({ ok: true, questionId: id })
})

/**
 * POST /questions/:id/reject - Dismiss a pending question.
 * Rejects with RejectedError — halts the agentic loop.
 */
questionRoutes.post("/questions/:id/reject", (c) => {
	requireWorkspace()
	const id = c.req.param("id")

	const questions = pendingQuestions()
	const deferred = questions.get(id)
	if (!deferred) {
		return c.json({ error: "No pending question for this ID" }, 404)
	}

	deferred.reject(new RejectedError())
	questions.delete(id)

	return c.json({ ok: true, questionId: id })
})
