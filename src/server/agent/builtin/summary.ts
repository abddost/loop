import type { Agent } from "@core/schema/agent"
import { PROMPT_SUMMARY } from "../prompt/templates/summary"

export const summaryAgent: Agent = {
	name: "summary",
	description: "Generates a title/body/diffs summary for a conversation turn.",
	type: "primary",
	hidden: true,
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
	prompt: PROMPT_SUMMARY,
	steps: 1,
}
