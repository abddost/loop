import { z } from "zod"
import { processManager } from "../../process/manager"
import type { Tool } from "../shape"

/** Read accumulated output from a background bash process. */
export const bashOutputTool: Tool.Shape = {
	id: "bash_output",
	init() {
		return {
			description:
				"Read the latest output of a background process started by bash with background:true. " +
				"Returns the current status, exit code (if exited), and the tail of stdout/stderr (most recent ~48KB). " +
				"Poll with sleep between calls when waiting for a long-running command to finish.",
			parameters: z.object({
				id: z.string().describe("Process id returned by bash with background:true"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "bash_output",
					patterns: ["*"],
					always: ["*"],
				})

				const result = processManager().read(input.id)
				if (!result) {
					return {
						output: `No background process found with id ${input.id}. It may have been evicted or never existed.`,
						metadata: { found: false },
					}
				}

				const lines = [`id: ${result.id}`, `command: ${result.command}`, `status: ${result.status}`]
				if (result.exitCode !== null) lines.push(`exitCode: ${result.exitCode}`)
				if (result.outputTruncated)
					lines.push("note: output exceeded buffer cap; older bytes dropped")
				lines.push("", result.output || "(no output yet)")

				return {
					output: lines.join("\n"),
					metadata: {
						processId: result.id,
						command: result.command,
						status: result.status,
						exitCode: result.exitCode,
						outputTruncated: result.outputTruncated,
						description: result.description,
						// Raw stdout for the UI renderer. The LLM-facing `output`
						// above keeps the id/status header so the agent can reason
						// about the process state.
						output: result.output,
					},
				}
			},
		}
	},
}
