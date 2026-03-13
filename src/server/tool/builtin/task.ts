import { z } from "zod"
import type { Tool } from "../shape"

/** Spawn a subagent to handle a subtask. */
export const taskTool: Tool.Shape = {
	id: "task",
	init() {
		return {
			description:
				"Spawn a sub-agent to handle a specific task. The sub-agent runs in its own session and reports results back. Use this to delegate focused work like running tests, researching code, or performing multi-step operations.",
			parameters: z.object({
				description: z.string().describe("Short description of what the subtask should accomplish"),
				prompt: z.string().describe("Detailed instructions for the sub-agent"),
				agent: z.string().optional().describe("Name of the agent to use (default: current agent)"),
			}),
			async execute(_ctx, _input) {
				// TODO: Implement sub-session spawning via session manager
				return {
					output:
						"Subtask execution is not yet implemented. This will spawn a sub-session in a future update.",
				}
			},
		}
	},
}
