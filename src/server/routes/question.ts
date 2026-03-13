import { Hono } from "hono"
import { pendingQuestions } from "../loop/question"
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
 * Body: { answer: string }
 */
questionRoutes.post("/questions/:id", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const body = await c.req.json<{ answer: string }>()

	if (!body.answer) {
		return c.json({ error: "answer is required" }, 400)
	}

	const questions = pendingQuestions()
	const deferred = questions.get(id)
	if (!deferred) {
		return c.json({ error: "No pending question for this ID" }, 404)
	}

	deferred.resolve(body.answer)
	questions.delete(id)

	return c.json({ ok: true, questionId: id })
})
