import type { Agent } from "@core/schema/agent"
import { PROMPT_AGENT } from "../prompt/templates/agent"

export const buildAgent: Agent = {
	name: "build",
	description:
		"Default agent with full access to all tools. Can edit files, run commands, and execute any action.",
	type: "primary",
	permission: [],
	prompt: PROMPT_AGENT,
	steps: 100,
}
