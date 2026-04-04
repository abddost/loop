import type { Agent } from "@core/schema/agent"

export const buildAgent: Agent = {
	name: "build",
	description:
		"Default agent with full access to all tools. Can edit files, run commands, and execute any action.",
	type: "primary",
	permission: [],
	steps: 100,
}
