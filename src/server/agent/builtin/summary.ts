import type { Agent } from "@core/schema/agent"
import { PROMPT_SUMMARY } from "../prompt/templates/summary"

export const summaryAgent: Agent = {
	name: "summary",
	description: "Generates a title/body/diffs summary for a conversation turn.",
	type: "primary",
	hidden: true,
	permission: [{ permission: "*", pattern: "*", action: "deny" }],
	prompt: PROMPT_SUMMARY,
	steps: 1,
}
