import type { Agent } from "@core/schema/agent"

export const universalAgent: Agent = {
	name: "universal",
	description:
		"General-purpose subagent with the same permissions as build, except todoread/todowrite. Used for parallel work.",
	type: "subagent",
	permission: {
		mode: "default",
		rules: [
			{ tool: "todoread", allow: false },
			{ tool: "todowrite", allow: false },
		],
	},
	prompt:
		"You are a focused subagent. Complete the assigned task efficiently and report back. Be concise.",
	steps: 50,
}
