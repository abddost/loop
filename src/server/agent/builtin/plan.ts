import type { Agent } from "@core/schema/agent"

export const planAgent: Agent = {
	name: "plan",
	description:
		"Read-only planning agent. Can read the codebase and create plans in .loop/plans/*.md. Cannot edit other files.",
	type: "primary",
	permission: {
		mode: "default",
		rules: [
			{ tool: "edit", allow: false },
			{ tool: "write", allow: false },
			{ tool: "bash", allow: false },
			{ tool: "plan_exit", allow: true },
		],
	},
	prompt: `You are a planning agent. Your job is to analyze the codebase and create detailed implementation plans.

Rules:
- Read and explore the codebase freely
- Write plans ONLY to .loop/plans/*.md files
- Do NOT edit any source files
- Do NOT run commands that modify anything
- When the plan is complete, use plan_exit to signal readiness for build mode`,
	steps: 50,
}
