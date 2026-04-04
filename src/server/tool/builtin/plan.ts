import { ulid } from "@core/id"
import { Deferred } from "@core/util/async"
import { z } from "zod"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { pendingQuestions } from "../../loop/question"
import { planPath, readPlan, writePlan } from "../../plan"
import { bus } from "../../workspace/bus"
import { Tool } from "../shape"

const log = createLogger("tool:plan")

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000

// ────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────

/**
 * Ask the user a yes/no question via the question bus mechanism.
 * Returns the user's answer string.
 * Rejects after QUESTION_TIMEOUT_MS if the user never responds.
 */
async function askUser(sessionId: string, text: string, tool: string): Promise<string> {
	const questionId = ulid()
	const deferred = new Deferred<string[]>()

	pendingQuestions().set(questionId, deferred)

	bus().emit("question:request", {
		sessionId,
		question: { id: questionId, sessionId, tool, text },
	})

	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const answers = await Promise.race([
			deferred.promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Plan question timed out after ${QUESTION_TIMEOUT_MS / 1000}s`)),
					QUESTION_TIMEOUT_MS,
				)
			}),
		])
		return answers[0] ?? ""
	} finally {
		clearTimeout(timer)
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
 * Persists to DB and emits SSE events so the loop picks up the
 * new agent on next iteration.
 */
function createSyntheticMessage(sessionId: string, agent: string, text: string): void {
	const messageId = ulid()
	const partId = ulid()

	try {
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
	} catch (err) {
		log.error("Failed to create synthetic message for agent switch", { sessionId, agent, err })
		throw err
	}
}

// ────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────

/** Write or update the plan file for this session. */
export const planWriteTool = Tool.define("plan_write", {
	description:
		"Write or update the implementation plan for this session. Saves to .loop/plans/<sessionId>.md. This is the ONLY way to create or modify the plan file.",
	parameters: z.object({
		content: z.string().describe("The full plan content in markdown format"),
	}),
	async execute(ctx, input) {
		const filePath = writePlan(ctx.sessionId, input.content)
		ctx.metadata({ metadata: { planPath: filePath } })
		return { output: `Plan written to ${filePath}`, metadata: { planPath: filePath } }
	},
})

/** Enter plan mode — switch from the current agent to the plan agent. */
export const planEnterTool = Tool.define("plan_enter", {
	description:
		"Switch to plan mode. The plan agent can read and explore the codebase but cannot modify files or run destructive commands. Use this when you need to analyze the codebase and create an implementation plan before making changes.",
	parameters: z.object({
		reason: z.string().optional().describe("Why you want to switch to plan mode"),
	}),
	async execute(ctx, input) {
		if (ctx.agent === "plan") {
			return { output: "Already in plan mode. Continue planning." }
		}

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
})

/** Exit plan mode — switch from the plan agent back to the build agent. */
export const planExitTool = Tool.define("plan_exit", {
	description:
		"Exit plan mode and switch to the build agent. Use this when your plan is complete and written to .loop/plans/. The plan will be shown to the user for approval before switching.",
	parameters: z.object({
		summary: z.string().optional().describe("Brief summary of the plan that was created"),
	}),
	async execute(ctx, input) {
		if (ctx.agent !== "plan") {
			return { output: "Not in plan mode. Use plan_enter to switch to plan mode first." }
		}

		const plan = readPlan(ctx.sessionId)
		const path = planPath(ctx.sessionId)

		ctx.metadata({
			metadata: {
				planPath: path,
				planContent: plan ?? null,
				summary: input.summary ?? null,
			},
		})

		const summary = input.summary ? `\nSummary: ${input.summary}` : ""
		const planPreview = plan
			? `\nPlan file: ${path}\n\n${plan.length > 500 ? `${plan.slice(0, 500)}...` : plan}`
			: "\nNo plan file found."

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

		// Path-only synthetic message — insertReminders is the single source
		// of truth for injecting plan content into the model context.
		createSyntheticMessage(
			ctx.sessionId,
			"build",
			`The plan at ${path} has been approved. Execute the plan.`,
		)

		return {
			output:
				"Plan approved. Switching to build mode. The build agent will now implement changes based on the plan.",
			metadata: { agent: "build", synthetic: true, planPath: path },
		}
	},
})
