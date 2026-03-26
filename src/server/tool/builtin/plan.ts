import { ulid } from "@core/id"
import { Deferred } from "@core/util/async"
import { z } from "zod"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { pendingQuestions } from "../../loop/question"
import { planPath, readPlan } from "../../plan"
import { bus } from "../../workspace/bus"
import type { Tool } from "../shape"

/**
 * Ask the user a yes/no question via the question bus mechanism.
 * Returns the user's answer string.
 */
async function askUser(sessionId: string, text: string, tool: string): Promise<string> {
	const questionId = ulid()
	const deferred = new Deferred<string[]>()

	pendingQuestions().set(questionId, deferred)

	bus().emit("question:request", {
		sessionId,
		question: { id: questionId, sessionId, tool, text },
	})

	try {
		const answers = await deferred.promise
		return answers[0] ?? ""
	} finally {
		pendingQuestions().delete(questionId)
	}
}

/** Check if a user answer is affirmative. */
function isAccepted(answer: string): boolean {
	const lower = answer.toLowerCase().trim()
	return lower === "yes" || lower === "y" || lower === "ok"
}

/**
 * Create a synthetic user message that triggers an agent switch.
 * This persists the message to the DB and emits SSE events so the
 * loop picks up the new agent on next iteration.
 */
function createSyntheticMessage(sessionId: string, agent: string, text: string): void {
	const messageId = ulid()
	const partId = ulid()

	Database.withEffects((_tx, effect) => {
		queries.createMessage({
			id: messageId,
			sessionId,
			role: "user",
			metadata: { agent, synthetic: true },
		})

		queries.upsertPart({
			id: partId,
			sessionId,
			messageId,
			type: "text",
			data: { type: "text", text, synthetic: true },
		})

		effect(() => {
			bus().emit("message:create", {
				sessionId,
				message: {
					id: messageId,
					sessionId,
					role: "user",
					metadata: { agent, synthetic: true },
					createdAt: Date.now(),
					updatedAt: Date.now(),
					parts: [{ id: partId, type: "text", text, synthetic: true }],
				},
			})
		})
	})
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
					"plan_enter",
				)

				if (!isAccepted(answer)) {
					return { output: "User declined to switch to plan mode. Continuing with current agent." }
				}

				createSyntheticMessage(
					ctx.sessionId,
					"plan",
					`Switching to plan mode.${reason} Analyze the codebase and write a plan to .loop/plans/.`,
				)

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
				"Exit plan mode and switch to the build agent. Use this when your plan is complete and written to .loop/plans/. The plan will be shown to the user for approval before switching.",
			parameters: z.object({
				summary: z.string().optional().describe("Brief summary of the plan that was created"),
			}),
			async execute(ctx, input) {
				// Read the plan file for this session
				const plan = readPlan(ctx.sessionId)
				const path = planPath(ctx.sessionId)

				// Store plan metadata for the frontend
				ctx.metadata({
					metadata: {
						planPath: path,
						planContent: plan ?? null,
						summary: input.summary ?? null,
					},
				})

				const planPreview = plan
					? `\nPlan file: ${path}\n\n${plan.length > 500 ? `${plan.slice(0, 500)}...` : plan}`
					: "\nNo plan file found."
				const summary = input.summary ? `\nSummary: ${input.summary}` : ""

				const answer = await askUser(
					ctx.sessionId,
					`Approve plan and switch to build mode?${summary}${planPreview}\n\nThe build agent will implement changes based on this plan.`,
					"plan_exit",
				)

				if (!isAccepted(answer)) {
					return {
						output: `User declined to switch to build mode. Feedback: "${answer}". Revise the plan based on this feedback and try again.`,
					}
				}

				// Build the synthetic message text referencing the plan
				const planRef = plan
					? `Implement the plan from ${path}:\n\n${plan}`
					: `Implement the plan.${summary}`

				createSyntheticMessage(ctx.sessionId, "build", planRef)

				return {
					output:
						"Plan approved. Switching to build mode. The build agent will now implement changes based on the plan.",
					metadata: { agent: "build", synthetic: true, planPath: path },
				}
			},
		}
	},
}
