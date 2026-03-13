import type { Agent } from "@core/schema/agent"
import { PROMPT_COMPACTION } from "../prompt/templates/compaction"

export const compactionAgent: Agent = {
	name: "compaction",
	description: "Summarizes conversation history for context compaction.",
	type: "primary",
	hidden: true,
	temperature: 0,
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
	prompt: PROMPT_COMPACTION,
	steps: 1,
}
