import type { Agent } from "@core/schema/agent"
import { PROMPT_COMPACTION } from "../prompt/templates/compaction"

export const compactionAgent: Agent = {
	name: "compaction",
	description: "Summarizes conversation history for context compaction.",
	type: "primary",
	hidden: true,
	temperature: 0,
	permission: [{ permission: "*", pattern: "*", action: "deny" }],
	prompt: PROMPT_COMPACTION,
	steps: 1,
}
