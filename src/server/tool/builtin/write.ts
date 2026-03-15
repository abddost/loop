import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

/** Write content to a file in the workspace. Requires permission. */
export const writeTool: Tool.Shape = {
	id: "write",
	init() {
		return {
			description:
				"Write content to a file in the workspace. Creates the file and any parent directories if they don't exist. Overwrites existing content.",
			parameters: z.object({
				path: z.string().describe("Relative path to the file within the workspace"),
				content: z.string().describe("The content to write to the file"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "write",
					patterns: [input.path],
					always: ["*"],
					metadata: { reason: `Write file: ${input.path}` },
				})

				const filePath = resolve(Workspace.dir(), input.path)

				await mkdir(dirname(filePath), { recursive: true })
				await Bun.write(filePath, input.content)

				return {
					output: `Successfully wrote ${input.content.length} characters to ${input.path}`,
					metadata: { path: filePath, size: input.content.length },
				}
			},
		}
	},
}
