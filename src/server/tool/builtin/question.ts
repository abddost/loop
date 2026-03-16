import { ulid } from "@core/id"
import { Deferred } from "@core/util/async"
import { z } from "zod"
import { pendingQuestions } from "../../loop/question"
import { bus } from "../../workspace/bus"
import type { Tool } from "../shape"

interface QuestionOption {
	label: string
	description?: string
}

interface QuestionEntry {
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
				const answers: string[] = []

				for (const q of input.questions as QuestionEntry[]) {
					const questionId = ulid()
					const deferred = new Deferred<string>()

					// Register in pending questions store
					pendingQuestions().set(questionId, deferred)

					// Build display text
					let text = q.question
					if (q.options?.length) {
						const optionLines = q.options.map((o: QuestionOption, i: number) => {
							const desc = o.description ? ` - ${o.description}` : ""
							return `  ${i + 1}. ${o.label}${desc}`
						})
						text += `\n${optionLines.join("\n")}`
						if (q.multiple) {
							text += "\n(Multiple selections allowed)"
						}
					}

					// Emit question event for frontend
					bus().emit("question:request", {
						sessionId: ctx.sessionId,
						question: {
							id: questionId,
							text,
							sessionId: ctx.sessionId,
						},
					})

					try {
						const answer = await deferred.promise
						answers.push(answer)
					} finally {
						pendingQuestions().delete(questionId)
					}
				}

				if (answers.length === 1) {
					return { output: answers[0] }
				}

				const questions = input.questions as QuestionEntry[]
				const formatted = answers
					.map((a: string, i: number) => `Q${i + 1}: ${questions[i].question}\nA${i + 1}: ${a}`)
					.join("\n\n")
				return { output: formatted }
			},
		}
	},
}
