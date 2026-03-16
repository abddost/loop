import { ulid } from "@core/id"
import { Deferred } from "@core/util/async"
import { z } from "zod"
import { pendingQuestions } from "../../loop/question"
import { bus } from "../../workspace/bus"
import type { Tool } from "../shape"

/**
 * Ask the user a yes/no question via the question bus mechanism.
 * Returns the user's answer string.
 */
async function askUser(sessionId: string, text: string): Promise<string> {
	const questionId = ulid()
	const deferred = new Deferred<string>()

	pendingQuestions().set(questionId, deferred)

	bus().emit("question:request", {
		sessionId,
		question: { id: questionId, text, sessionId },
	})

	try {
		return await deferred.promise
	} finally {
		pendingQuestions().delete(questionId)
	}
}

/** Enter plan mode — switch from the current agent to the plan agent. */
export const planEnterTool: Tool.Shape = {
	id: "plan_enter",
	init() {
		return {
			description:
				"Switch to plan mode. The plan agent can read and explore the codebase but cannot modify files or run destructive commands. Use this when you need to analyze the codebase and create an implementation plan before making changes.",
			parameters: z.object({
				reason: z.string().optional().describe("Why you want to switch to plan mode"),
			}),
			async execute(ctx, input) {
				const reason = input.reason ? ` Reason: ${input.reason}` : ""
				const answer = await askUser(
					ctx.sessionId,
					`Switch to plan mode?${reason}\nThe plan agent will analyze the codebase and create an implementation plan. It cannot modify files.`,
				)

				const accepted =
					answer.toLowerCase() === "yes" ||
					answer.toLowerCase() === "y" ||
					answer.toLowerCase() === "ok"

				if (!accepted) {
					return { output: "User declined to switch to plan mode. Continuing with current agent." }
				}

				return {
					output:
						"Switching to plan mode. The plan agent will now analyze the codebase and create an implementation plan.",
					metadata: { agent: "plan", synthetic: true },
				}
			},
		}
	},
}

/** Exit plan mode — switch from the plan agent back to the build agent. */
export const planExitTool: Tool.Shape = {
	id: "plan_exit",
	init() {
		return {
			description:
				"Exit plan mode and switch to the build agent. Use this when the plan is complete and you are ready to start implementing changes.",
			parameters: z.object({
				summary: z.string().optional().describe("Brief summary of the plan that was created"),
			}),
			async execute(ctx, input) {
				const summary = input.summary ? `\nPlan summary: ${input.summary}` : ""
				const answer = await askUser(
					ctx.sessionId,
					`Switch to build mode?${summary}\nThe build agent will implement changes based on the plan.`,
				)

				const accepted =
					answer.toLowerCase() === "yes" ||
					answer.toLowerCase() === "y" ||
					answer.toLowerCase() === "ok"

				if (!accepted) {
					return { output: "User declined to switch to build mode. Continuing in plan mode." }
				}

				return {
					output:
						"Switching to build mode. The build agent will now implement changes based on the plan.",
					metadata: { agent: "build", synthetic: true },
				}
			},
		}
	},
}
