import { z } from "zod"
import { processManager } from "../../process/manager"
import type { Tool } from "../shape"

/** Terminate a background bash process. */
export const bashKillTool: Tool.Shape = {
	id: "bash_kill",
	init() {
		return {
			description:
				"Terminate a background process started by bash with background:true. Sends SIGTERM, then SIGKILL if the process does not exit promptly. " +
				"Use when a dev server, watcher, or long-running command is no longer needed.",
			parameters: z.object({
				id: z.string().describe("Process id returned by bash with background:true"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "bash_kill",
					patterns: ["*"],
					always: ["*"],
					metadata: { reason: `Terminate background process ${input.id}` },
				})

				const ok = await processManager().kill(input.id)
				if (!ok) {
					return {
						output: `No background process found with id ${input.id}.`,
						metadata: { found: false },
					}
				}
				const result = processManager().read(input.id)
				return {
					output: `Background process ${input.id} terminated.${
						result?.exitCode !== null && result?.exitCode !== undefined
							? ` Exit code: ${result.exitCode}.`
							: ""
					}`,
					metadata: {
						processId: input.id,
						command: result?.command,
						status: result?.status,
						exitCode: result?.exitCode,
						description: result?.description,
					},
				}
			},
		}
	},
}
