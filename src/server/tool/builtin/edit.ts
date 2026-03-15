import { resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

/** Edit a file with string replacement. Requires permission. */
export const editTool: Tool.Shape = {
	id: "edit",
	init() {
		return {
			description:
				"Edit a file by replacing a string. The old_string must appear in the file. If replace_all is false (default), old_string must be unique in the file.",
			parameters: z.object({
				path: z.string().describe("Relative path to the file within the workspace"),
				old_string: z.string().describe("The exact text to find and replace"),
				new_string: z.string().describe("The text to replace it with"),
				replace_all: z.boolean().optional().describe("Replace all occurrences (default: false)"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "edit",
					patterns: [input.path],
					always: ["*"],
					metadata: { reason: `Edit file: ${input.path}` },
				})

				const filePath = resolve(Workspace.dir(), input.path)
				const file = Bun.file(filePath)

				if (!(await file.exists())) {
					return { output: `File not found: ${input.path}` }
				}

				const content = await file.text()

				if (!content.includes(input.old_string)) {
					return {
						output: `old_string not found in ${input.path}. Make sure the string matches exactly, including whitespace and indentation.`,
					}
				}

				if (!input.replace_all) {
					const firstIndex = content.indexOf(input.old_string)
					const lastIndex = content.lastIndexOf(input.old_string)
					if (firstIndex !== lastIndex) {
						return {
							output: `old_string appears multiple times in ${input.path}. Provide more context to make it unique, or set replace_all to true.`,
						}
					}
				}

				const updated = input.replace_all
					? content.replaceAll(input.old_string, input.new_string)
					: content.replace(input.old_string, input.new_string)

				await Bun.write(filePath, updated)

				return {
					output: `Successfully edited ${input.path}`,
					metadata: { path: filePath },
				}
			},
		}
	},
}
