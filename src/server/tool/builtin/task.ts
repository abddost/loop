import { z } from "zod"
import type { Tool } from "../shape"

/**
 * Spawn a subagent to handle a subtask.
 *
 * Available subagent types:
 * - build: Full-access agent for implementing changes (default)
 * - plan: Read-only agent for analysis and planning
 * - explore: Lightweight agent for codebase exploration
 * - universal: General-purpose agent
 */
export const taskTool: Tool.Shape = {
	id: "task",
	init() {
		return {
			description: `Spawn a sub-agent to handle a specific task in its own session. Use this to delegate focused work like running tests, researching code, or performing multi-step operations.

Available subagent types:
- "build" (default): Full access to all tools. Use for implementing changes.
- "plan": Read-only. Can read the codebase and create plans but cannot modify files.
- "explore": Lightweight codebase exploration. Good for quick research.
- "universal": General-purpose agent with balanced capabilities.

Pass task_id to resume a previously spawned task instead of creating a new one.`,
			parameters: z.object({
				description: z.string().describe("Short description of what the subtask should accomplish"),
				prompt: z.string().describe("Detailed instructions for the sub-agent"),
				subagent_type: z
					.enum(["build", "plan", "explore", "universal"])
					.optional()
					.describe("Type of sub-agent to use (default: build)"),
				task_id: z
					.string()
					.optional()
					.describe(
						"ID of a previous task to resume. If provided, the sub-agent continues from where it left off.",
					),
			}),
			async execute(ctx, input) {
				const agentType = input.subagent_type ?? "build"

				await ctx.ask({
					permission: "task",
					patterns: [input.description],
					always: ["*"],
					metadata: {
						reason: `Spawn subtask (${agentType}): ${input.description}`,
						subagent_type: agentType,
						task_id: input.task_id,
					},
				})

				// TODO: Implement sub-session spawning via session manager
				// When implemented, this should:
				// 1. Create a new session (or resume if task_id is provided)
				// 2. Set the agent type to input.subagent_type
				// 3. Send input.prompt as the initial user message
				// 4. Wait for completion and return the result
				return {
					output: `Subtask execution is not yet implemented. This will spawn a "${agentType}" sub-session in a future update.${input.task_id ? ` (Would resume task: ${input.task_id})` : ""}`,
				}
			},
		}
	},
}
