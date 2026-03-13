import type { Agent } from "@core/schema/agent"

export const buildAgent: Agent = {
	name: "build",
	description:
		"Default agent with full access to all tools. Can edit files, run commands, and execute any action.",
	type: "primary",
	permission: {
		mode: "default",
		rules: [],
	},
	prompt:
		"You are a skilled software engineer. Help the user by writing code, fixing bugs, running tests, and completing programming tasks. Be concise and focused.",
	steps: 100,
}
