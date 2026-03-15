import { resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

/** Read a file from the workspace. Safe tool -- no permission required. */
export const readTool: Tool.Shape = {
	id: "read",
	init() {
		return {
			description:
				"Read a file from the workspace. Returns the file content with line numbers. Optionally specify offset and limit to read a portion of a large file.",
			parameters: z.object({
				path: z.string().describe("Relative path to the file within the workspace"),
				offset: z.number().optional().describe("Line number to start reading from (1-based)"),
				limit: z.number().optional().describe("Maximum number of lines to read"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "read",
					patterns: [input.path],
					always: ["*"],
				})

				const filePath = resolve(Workspace.dir(), input.path)
				const file = Bun.file(filePath)

				if (!(await file.exists())) {
					return { output: `File not found: ${input.path}` }
				}

				const text = await file.text()
				const lines = text.split("\n")

				const offset = Math.max(0, (input.offset ?? 1) - 1)
				const limit = input.limit ?? lines.length
				const slice = lines.slice(offset, offset + limit)

				const numbered = slice
					.map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`)
					.join("\n")

				return {
					output: numbered,
					metadata: { totalLines: lines.length },
				}
			},
		}
	},
}
