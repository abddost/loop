import type { Agent } from "@core/schema/agent"
import { PROMPT_EXPLORE } from "../prompt/templates/explore"

export const exploreAgent: Agent = {
	name: "explore",
	description:
		"Read-only exploration subagent. Can search and read the codebase but cannot modify anything.",
	type: "subagent",
	permission: [
		{ permission: "edit", pattern: "*", action: "deny" },
		{ permission: "write", pattern: "*", action: "deny" },
		{ permission: "task", pattern: "*", action: "deny" },
		{ permission: "bash", pattern: "*", action: "allow" },
	],
	prompt: PROMPT_EXPLORE,
	steps: 30,
}
