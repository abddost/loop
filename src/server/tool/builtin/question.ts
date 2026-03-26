import { ulid } from "@core/id"
import { Deferred } from "@core/util/async"
import { z } from "zod"
import { pendingQuestions } from "../../loop/question"
import { setSessionStatus } from "../../loop/status"
import { RejectedError } from "../../permission/types"
import { bus } from "../../workspace/bus"
import type { Tool } from "../shape"

export interface QuestionOption {
	label: string
	description?: string
}

export interface QuestionEntry {
	question: string
	options?: QuestionOption[]
	multiple?: boolean
}

/** Ask the user one or more questions and wait for responses. */
export const questionTool: Tool.Shape = {
	id: "question",
	init() {
		return {
			description:
				"Ask the user one or more questions. Each question can optionally provide a list of options for the user to choose from. The tool blocks until the user responds.",
			parameters: z.object({
				questions: z.array(
					z.object({
						question: z.string().describe("The question to ask the user"),
						options: z
							.array(
								z.object({
									label: z.string().describe("Short label for the option"),
									description: z.string().optional().describe("Longer description of the option"),
								}),
							)
							.optional()
							.describe("Optional list of choices for the user"),
						multiple: z
							.boolean()
							.optional()
							.describe("Whether multiple options can be selected (default: false)"),
					}),
				),
			}),
			async execute(ctx, input) {
				const questions = input.questions as QuestionEntry[]
				const questionId = ulid()
				const deferred = new Deferred<string[]>()

				pendingQuestions().set(questionId, deferred)

				// Signal frontend that we're waiting for user input
				setSessionStatus(ctx.sessionId, "awaiting-permission")

				// Emit structured question event
				bus().emit("question:request", {
					sessionId: ctx.sessionId,
					question: {
						id: questionId,
						sessionId: ctx.sessionId,
						tool: "question",
						questions: questions.map((q) => ({
							question: q.question,
							options: q.options,
							multiple: q.multiple,
						})),
					},
				})

				// Race the deferred against the abort signal so cancellation doesn't
				// leave the tool blocking forever.
				let abortHandler: (() => void) | undefined
				if (ctx.signal) {
					if (ctx.signal.aborted) {
						deferred.reject(new RejectedError())
					} else {
						abortHandler = () => {
							if (!deferred.settled) deferred.reject(new RejectedError())
						}
						ctx.signal.addEventListener("abort", abortHandler, { once: true })
					}
				}

				try {
					const answers = await deferred.promise
					setSessionStatus(ctx.sessionId, "busy")

					// Format output: one answer per question
					if (answers.length === 1) {
						return { output: answers[0] }
					}

					const formatted = answers
						.map((a, i) => `Q${i + 1}: ${questions[i].question}\nA${i + 1}: ${a}`)
						.join("\n\n")
					return { output: formatted }
				} finally {
					pendingQuestions().delete(questionId)
					if (abortHandler && ctx.signal) {
						ctx.signal.removeEventListener("abort", abortHandler)
					}
				}
			},
		}
	},
}
