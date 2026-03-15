import type { Agent } from "@core/schema/agent"
import { PROMPT_TITLE } from "../prompt/templates/title"

export const titleAgent: Agent = {
	name: "title",
	description: "Generates a short session title from the first user message.",
	type: "primary",
	hidden: true,
	temperature: 0.5,
	permission: [{ permission: "*", pattern: "*", action: "deny" }],
	prompt: PROMPT_TITLE,
	steps: 1,
}
