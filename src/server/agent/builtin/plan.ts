import type { Agent } from "@core/schema/agent"

export const planAgent: Agent = {
	name: "plan",
	description:
		"Read-only planning agent. Can read the codebase and create plans in .loop/plans/*.md. Cannot edit other files.",
	type: "primary",
	permission: [
		// Deny all destructive/write operations
		{ permission: "edit", pattern: "*", action: "deny" },
		{ permission: "apply-patch", pattern: "*", action: "deny" },
		{ permission: "multiedit", pattern: "*", action: "deny" },
		// { permission: "bash", pattern: "*", action: "deny" },
		{ permission: "write", pattern: "*", action: "deny" },
		// Allow plan_write (dedicated plan tool, no permission check)
		{ permission: "plan_write", pattern: "*", action: "allow" },
		// Allow plan exit
		{ permission: "plan_exit", pattern: "*", action: "allow" },
	],
	steps: 50,
}
