import { stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"
import { computeDiff, replace, trimDiff } from "./edit"

function resolvePath(inputPath: string): string {
	return isAbsolute(inputPath) ? inputPath : resolve(Workspace.dir(), inputPath)
}

/** Apply multiple sequential edits to a single file. */
export const multiEditTool: Tool.Shape = {
	id: "multiedit",
	init() {
		return {
			description:
				"Apply multiple edits to a single file sequentially. Each edit's result is used as the input for the next edit. Uses the same fuzzy matching strategies as the edit tool.",
			parameters: z.object({
				path: z.string().describe("Path to the file (absolute or relative to workspace)"),
				edits: z
					.array(
						z.object({
							old_string: z.string().describe("The text to find and replace"),
							new_string: z.string().describe("The text to replace it with"),
							replace_all: z
								.boolean()
								.optional()
								.describe("Replace all occurrences (default: false)"),
						}),
					)
					.describe("Array of edits to apply sequentially"),
			}),
			async execute(ctx, input) {
				const filePath = resolvePath(input.path)

				// Validate file exists and is not a directory
				let fileStat: Awaited<ReturnType<typeof stat>>
				try {
					fileStat = await stat(filePath)
				} catch {
					return { output: `File not found: ${input.path}` }
				}
				if (fileStat.isDirectory()) {
					return { output: `Path is a directory, not a file: ${input.path}` }
				}

				if (input.edits.length === 0) {
					return { output: "No edits provided." }
				}

				await ctx.ask({
					permission: "edit",
					patterns: [input.path],
					always: ["*"],
					metadata: { reason: `Multi-edit file: ${input.path} (${input.edits.length} edits)` },
				})

				const file = Bun.file(filePath)
				const originalContent = (await file.text()).replace(/\r\n/g, "\n")

				let current = originalContent
				let totalMatchCount = 0

				for (let i = 0; i < input.edits.length; i++) {
					const edit = input.edits[i]
					const oldStr = edit.old_string.replace(/\r\n/g, "\n")
					const newStr = edit.new_string.replace(/\r\n/g, "\n")
					const doReplaceAll = edit.replace_all ?? false

					if (oldStr === newStr) continue

					const result = replace(current, oldStr, newStr, doReplaceAll)
					if (!result) {
						return {
							output: `Edit ${i + 1}/${input.edits.length} failed: old_string not found in ${input.path}. Previous edits were not applied.`,
						}
					}

					current = result.content
					totalMatchCount += result.matchCount
				}

				await Bun.write(filePath, current)

				const { diff, additions, deletions } = computeDiff(input.path, originalContent, current)

				ctx.metadata({
					metadata: {
						path: filePath,
						diff: trimDiff(diff),
						additions,
						deletions,
						editCount: input.edits.length,
						totalMatchCount,
						type: "multiedit",
					},
				})

				return {
					output: `Successfully applied ${input.edits.length} edits to ${input.path}`,
					metadata: {
						path: filePath,
						diff: trimDiff(diff),
						additions,
						deletions,
						editCount: input.edits.length,
						totalMatchCount,
					},
				}
			},
		}
	},
}
