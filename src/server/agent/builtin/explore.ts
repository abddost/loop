import type { Agent } from "@core/schema/agent"
import { PROMPT_EXPLORE } from "../prompt/templates/explore"

export const exploreAgent: Agent = {
	name: "explore",
	description:
		"Read-only exploration subagent. Can search and read the codebase but cannot modify anything.",
	type: "subagent",
	permission: {
		mode: "default",
		rules: [
			{ tool: "grep", allow: true },
			{ tool: "glob", allow: true },
			{ tool: "list", allow: true },
			{ tool: "bash", allow: true },
			{ tool: "read", allow: true },
			{ tool: "web-fetch", allow: true },
			{ tool: "web-search", allow: true },
			{ tool: "edit", allow: false },
			{ tool: "write", allow: false },
			{ tool: "todoread", allow: false },
			{ tool: "todowrite", allow: false },
		],
	},
	prompt: PROMPT_EXPLORE,
	steps: 30,
}
