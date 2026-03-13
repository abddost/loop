import type { Agent } from "@core/schema/agent"
import { PROMPT_TITLE } from "../prompt/templates/title"

export const titleAgent: Agent = {
	name: "title",
	description: "Generates a short session title from the first user message.",
	type: "primary",
	hidden: true,
	temperature: 0.5,
	permission: {
		mode: "default",
		rules: [
			{ tool: "bash", allow: false },
			{ tool: "edit", allow: false },
			{ tool: "write", allow: false },
			{ tool: "read", allow: false },
			{ tool: "glob", allow: false },
			{ tool: "grep", allow: false },
			{ tool: "list", allow: false },
		],
	},
	prompt: PROMPT_TITLE,
	steps: 1,
}
